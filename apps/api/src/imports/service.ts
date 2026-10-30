import { createHash } from 'node:crypto';

import {
  IMPORT_PREVIEW_TTL_MINUTES,
  importValueMappedFields,
  type ImportMapping,
  type ImportPreviewRequest,
  type ImportValueMappedField,
  type ImportValueMappings,
} from '@mbc/shared';

import type { ClientContext } from '../auth/service.js';
import type { PrismaClient } from '../db.js';
import { Prisma } from '../generated/prisma/client.js';
import { importFeatureState } from '../identity/report.js';
import { audit } from '../lib/audit.js';
import { normaliseEmail } from '../lib/email.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';
import type { ImportConfig } from './config.js';
import {
  headerSignature,
  isAttendanceRecordColumn,
  suggestMapping,
  validateMapping,
} from './mapping.js';
import {
  classifyRows,
  countRows,
  outcomeSignature,
  type AddressOwner,
  type ClassifiedRow,
  type Counts,
  type ExistingRegistration,
  type MatchContext,
} from './matching.js';
import { normaliseRow, type RowValues } from './normalise.js';
import { parseImportFile } from './parse.js';

/**
 * Registration import runs (backlog E2-1, E2-8 to E2-11; D3, D5, D9).
 *
 * Lifecycle: upload (parse, store rows) -> preview (map, validate, classify, fingerprint) ->
 * confirm (re-run everything inside one transaction, refuse if anything differs, apply) or discard.
 * Success audit events are written inside the commit transaction; refusals and failures outside
 * it, in their own write, after the rollback (D9 audit contract).
 */

export interface ImportHooks {
  /** Test hook: runs inside the commit transaction after revalidation and before any write. */
  beforeCommitWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** Test hook: replaces the migration-gate read (the audit log is append-only, so tests cannot stage it). */
  migrationGatePassed?: () => Promise<boolean>;
}

export interface ImportServiceDeps {
  prisma: () => PrismaClient;
  config: ImportConfig;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  now?: () => Date;
  hooks?: ImportHooks;
}

export interface Actor {
  userId: string;
}

type Db = PrismaClient | Prisma.TransactionClient;

const RUN_SUMMARY = {
  id: true,
  eventId: true,
  actorUserId: true,
  source: true,
  fileName: true,
  fileSizeBytes: true,
  rowCount: true,
  status: true,
  counts: true,
  previewExpiresAt: true,
  committedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ROW_FIELDS = {
  id: true,
  rowNumber: true,
  values: true,
  outcome: true,
  reasonCode: true,
  reasonDetail: true,
  possibleDuplicate: true,
  conflict: true,
  delegateId: true,
  identityId: true,
  resolution: true,
  resolvedAt: true,
} as const;

class CommitRefused extends Error {
  constructor(
    public readonly code: 'preview_out_of_date' | 'preview_expired' | 'run_not_previewed',
    message: string,
  ) {
    super(message);
    this.name = 'CommitRefused';
  }
}

function sha256(parts: readonly string[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\u0000');
  return h.digest('hex');
}

/**
 * An in-person-only or online-only event has one attendance format for every registration (E1
 * brief, section 3), so the import never asks for it: any mapped attendance column and its value
 * translations are dropped and the event's format is applied to every row. Hybrid events keep
 * the mapping or the run-wide default the admin chose.
 */
export function applyEventFormat(
  request: ImportPreviewRequest,
  format: 'physical' | 'virtual' | 'hybrid',
): ImportPreviewRequest {
  if (format === 'hybrid') return request;
  const { attendanceFormat: _column, ...mapping } = request.mapping;
  const { attendanceFormat: _values, ...valueMappings } = request.valueMappings ?? {};
  return {
    ...request,
    mapping: mapping as ImportPreviewRequest['mapping'],
    attendanceFormatDefault: format,
    ...(request.valueMappings ? { valueMappings } : {}),
  };
}

export class ImportService {
  private readonly now: () => Date;

  constructor(private readonly deps: ImportServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get prisma(): PrismaClient {
    return this.deps.prisma();
  }

  // ---------------------------------------------------------------- feature gate

  /** Uploads disabled by configuration, or the migration gate not passed in production. */
  async uploadBlocker(): Promise<string | null> {
    if (!this.deps.config.uploadsEnabled) return 'uploads_disabled';
    if (this.deps.config.requireMigrationGate) {
      const passed = this.deps.hooks?.migrationGatePassed
        ? await this.deps.hooks.migrationGatePassed()
        : (await importFeatureState(this.prisma)).gatePassed;
      if (!passed) return 'migration_gate_not_passed';
    }
    return null;
  }

  async featureState() {
    const gate = await importFeatureState(this.prisma);
    return {
      uploadsEnabled: this.deps.config.uploadsEnabled,
      productionGateRequired: this.deps.config.requireMigrationGate,
      migrationGatePassed: gate.gatePassed,
      blockers: gate.blockers,
    };
  }

  /** Refuses the upload with an audited refusal (criterion 41); never throws silently. */
  async assertUploadsAllowed(eventId: string, actor: Actor, client: ClientContext): Promise<void> {
    const blocker = await this.uploadBlocker();
    if (!blocker) return;
    await audit(this.prisma, {
      action: 'import.upload_refused',
      entityType: 'event',
      entityId: eventId,
      eventId,
      actorUserId: actor.userId,
      newValue: { reason: blocker },
      ...client,
    });
    throw new HttpError(
      503,
      'imports_disabled',
      blocker === 'uploads_disabled'
        ? 'Registration imports are not enabled in this environment.'
        : 'Registration imports stay disabled until the identity migration gate has passed.',
    );
  }

  // ---------------------------------------------------------------- upload

  async createRun(input: {
    eventId: string;
    actor: Actor;
    client: ClientContext;
    source: string;
    fileName: string;
    bytes: Uint8Array;
  }) {
    await this.assertUploadsAllowed(input.eventId, input.actor, input.client);
    const event = await this.prisma.event.findUnique({
      where: { id: input.eventId },
      select: { id: true, status: true },
    });
    if (!event) throw new HttpError(404, 'not_found', 'Event not found.');
    if (event.status === 'archived') {
      throw new HttpError(409, 'event_archived', 'Imports into an archived event are refused.');
    }
    const parsed = await parseImportFile(input.bytes, input.fileName);
    const run = await this.prisma.importRun.create({
      data: {
        eventId: event.id,
        actorUserId: input.actor.userId,
        source: input.source,
        fileName: input.fileName.slice(0, 255),
        fileHash: parsed.fileHash,
        fileSizeBytes: input.bytes.byteLength,
        rowCount: parsed.rows.length,
        headers: parsed.headers,
        rows: {
          create: parsed.rows.map((raw, i) => ({ rowNumber: i + 2, raw })),
        },
      },
      select: RUN_SUMMARY,
    });
    this.deps.logger.info(
      { runId: run.id, eventId: event.id, rows: run.rowCount, bytes: run.fileSizeBytes },
      'import file parsed',
    );
    const suggestion = suggestMapping(parsed.headers);
    const saved = await this.prisma.importSourceMapping.findUnique({
      where: { source: input.source },
    });
    const signature = headerSignature(parsed.headers);
    return {
      run,
      headers: parsed.headers,
      delimiter: parsed.delimiter,
      encoding: parsed.encoding,
      warnings:
        parsed.encoding && parsed.encoding !== 'utf-8'
          ? [
              `The file was not UTF-8; it was read as ${parsed.encoding}. Check accented names and special characters in the preview, or export it again as UTF-8 CSV or XLSX.`,
            ]
          : [],
      suggestedMapping: suggestion.mapping,
      unmappedColumns: suggestion.unmapped,
      attendanceRecordColumns: parsed.headers.filter(isAttendanceRecordColumn),
      savedMapping: saved
        ? { mapping: saved.mapping as ImportMapping, reusable: saved.headerSignature === signature }
        : null,
    };
  }

  // ---------------------------------------------------------------- preview

  async preview(runId: string, actor: Actor, client: ClientContext, request: ImportPreviewRequest) {
    const run = await this.loadRun(runId);
    if (run.status === 'committed' || run.status === 'discarded') {
      throw new HttpError(409, 'run_closed', `This import run is ${run.status}.`);
    }
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: run.eventId },
      select: { format: true },
    });
    request = applyEventFormat(request, event.format);
    const headers = run.headers as string[];
    const { ignoredColumns } = validateMapping(
      request.mapping,
      headers,
      request.attendanceFormatDefault,
    );

    const rawRows = await this.prisma.importRow.findMany({
      where: { runId },
      select: { rowNumber: true, raw: true },
      orderBy: { rowNumber: 'asc' },
    });
    const classified = await this.classify(this.prisma, run.eventId, run.source, rawRows, request);
    const counts = countRows(classified.rows);
    const unrecognisedValues = this.unrecognisedValues(rawRows, request);
    const fingerprint = this.fingerprint(run.fileHash, request, classified.snapshot);
    const now = this.now();
    const previewExpiresAt = new Date(now.getTime() + IMPORT_PREVIEW_TTL_MINUTES * 60_000);

    await this.prisma.$transaction(async (tx) => {
      for (const row of classified.rows) {
        await tx.importRow.update({
          where: { runId_rowNumber: { runId, rowNumber: row.rowNumber } },
          data: {
            values: row.values ? (row.values as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
            outcome: row.outcome,
            reasonCode: row.reasonCode,
            reasonDetail: row.reasonDetail,
            possibleDuplicate: row.possibleDuplicate,
            conflict: row.conflict
              ? (row.conflict as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            delegateId: row.delegateId,
            identityId: row.identityId,
          },
        });
      }
      await tx.importRun.update({
        where: { id: runId },
        data: {
          mapping: request.mapping as Prisma.InputJsonValue,
          attendanceFormatDefault: request.attendanceFormatDefault ?? null,
          valueMappings: request.valueMappings
            ? (request.valueMappings as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          status: 'previewed',
          fingerprint,
          previewExpiresAt,
          counts: counts as unknown as Prisma.InputJsonValue,
        },
      });
      if (request.saveMapping) {
        await tx.importSourceMapping.upsert({
          where: { source: run.source },
          create: {
            source: run.source,
            headerSignature: headerSignature(headers),
            mapping: request.mapping as Prisma.InputJsonValue,
            updatedByUserId: actor.userId,
          },
          update: {
            headerSignature: headerSignature(headers),
            mapping: request.mapping as Prisma.InputJsonValue,
            updatedByUserId: actor.userId,
          },
        });
      }
      await audit(tx, {
        action: 'import.previewed',
        entityType: 'import_run',
        entityId: runId,
        eventId: run.eventId,
        actorUserId: actor.userId,
        newValue: {
          runId,
          counts,
          mapping: mappingColumns(request.mapping),
          attendanceFormatDefault: request.attendanceFormatDefault ?? null,
          valueMappings: request.valueMappings ?? null,
          ignoredColumns: ignoredColumns.length,
          mappingSaved: request.saveMapping === true,
        } as unknown as Prisma.InputJsonValue,
        ...client,
      });
    });

    this.deps.logger.info({ runId, counts }, 'import previewed');
    return {
      run: await this.prisma.importRun.findUniqueOrThrow({
        where: { id: runId },
        select: RUN_SUMMARY,
      }),
      counts,
      ignoredColumns,
      unrecognisedValues,
      previewExpiresAt,
      rows: classified.rows.map(publicRow),
    };
  }

  // ---------------------------------------------------------------- confirm

  async confirm(runId: string, actor: Actor, client: ClientContext) {
    const before = await this.loadRun(runId);
    if (before.status === 'committed') {
      // Safe retry: the run was applied once; report the same result and change nothing.
      return { run: before, counts: before.counts as unknown as Counts, alreadyCommitted: true };
    }
    if (before.status === 'discarded') {
      throw new HttpError(409, 'run_closed', 'This import run was discarded.');
    }
    const blocker = await this.uploadBlocker();
    if (blocker) {
      await this.commitFailed(before.eventId, runId, actor, client, blocker);
      throw new HttpError(503, 'imports_disabled', 'Registration imports are disabled.');
    }

    let result: { counts: Counts; alreadyCommitted: boolean } | undefined;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:event:${before.eventId}`}))`;
          const run = await tx.importRun.findUniqueOrThrow({ where: { id: runId } });
          if (run.status === 'committed') {
            return { counts: run.counts as unknown as Counts, alreadyCommitted: true };
          }
          if (run.status !== 'previewed' || !run.mapping || !run.fingerprint) {
            throw new CommitRefused('run_not_previewed', 'Produce a preview before confirming.');
          }
          const now = this.now();
          if (!run.previewExpiresAt || run.previewExpiresAt.getTime() < now.getTime()) {
            throw new CommitRefused(
              'preview_expired',
              'The preview has expired. Produce a fresh preview.',
            );
          }
          const event = await tx.event.findUniqueOrThrow({
            where: { id: run.eventId },
            select: { status: true },
          });
          if (event.status === 'archived') {
            throw new CommitRefused(
              'preview_out_of_date',
              'The event was archived since the preview.',
            );
          }
          const request: ImportPreviewRequest = {
            mapping: run.mapping as ImportMapping,
            attendanceFormatDefault: run.attendanceFormatDefault ?? undefined,
            valueMappings: (run.valueMappings as ImportValueMappings | null) ?? undefined,
          };
          const stored = await tx.importRow.findMany({
            where: { runId },
            select: {
              rowNumber: true,
              raw: true,
              outcome: true,
              reasonCode: true,
              delegateId: true,
              identityId: true,
            },
            orderBy: { rowNumber: 'asc' },
          });

          // Serialise on every address the run may write (D5.1 invariant 9), in a fixed order.
          const emails = new Set<string>();
          for (const r of stored) {
            if (r.outcome === 'accepted' || r.outcome === 'linked' || r.outcome === 'updated') {
              const email = this.emailOf(r.raw as Record<string, string>, request);
              if (email) emails.add(email);
            }
          }
          for (const email of [...emails].sort()) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email:${email}`}))`;
          }

          const classified = await this.classify(tx, run.eventId, run.source, stored, request);
          const fingerprint = this.fingerprint(run.fileHash, request, classified.snapshot);
          if (fingerprint !== run.fingerprint) {
            throw new CommitRefused(
              'preview_out_of_date',
              'Records changed since the preview. Produce a fresh preview.',
            );
          }
          const byNumber = new Map(stored.map((r) => [r.rowNumber, r]));
          for (const row of classified.rows) {
            const previous = byNumber.get(row.rowNumber);
            if (
              !previous ||
              outcomeSignature(row) !==
                outcomeSignature({
                  outcome: previous.outcome ?? 'rejected',
                  reasonCode: previous.reasonCode,
                  delegateId: previous.delegateId,
                  identityId: previous.identityId,
                })
            ) {
              throw new CommitRefused(
                'preview_out_of_date',
                `Row ${row.rowNumber} would import differently now. Produce a fresh preview.`,
              );
            }
          }

          await this.deps.hooks?.beforeCommitWrite?.(tx);

          const counts = countRows(classified.rows);
          await this.apply(
            tx,
            run.id,
            run.eventId,
            run.source,
            classified.rows,
            actor,
            client,
            now,
          );
          await tx.importRun.update({
            where: { id: runId },
            data: {
              status: 'committed',
              committedAt: now,
              counts: counts as unknown as Prisma.InputJsonValue,
            },
          });
          await audit(tx, {
            action: 'import.committed',
            entityType: 'import_run',
            entityId: runId,
            eventId: run.eventId,
            actorUserId: actor.userId,
            newValue: {
              runId,
              counts,
              attendanceFormatDefault: run.attendanceFormatDefault ?? null,
            } as unknown as Prisma.InputJsonValue,
            ...client,
          });
          return { counts, alreadyCommitted: false };
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (error instanceof CommitRefused) {
        await this.commitFailed(before.eventId, runId, actor, client, error.code);
        throw new HttpError(409, error.code, error.message);
      }
      this.deps.logger.error(
        { runId, name: error instanceof Error ? error.name : 'unknown' },
        'import commit failed; transaction rolled back',
      );
      captureException(error, { requestId: `import:${runId}` });
      await this.commitFailed(before.eventId, runId, actor, client, 'internal_error');
      throw new HttpError(
        500,
        'import_commit_failed',
        'The import could not be committed. Nothing was written; you can retry the confirmation.',
      );
    }

    this.deps.logger.info(
      { runId, counts: result.counts, retry: result.alreadyCommitted },
      'import committed',
    );
    return {
      run: await this.prisma.importRun.findUniqueOrThrow({
        where: { id: runId },
        select: RUN_SUMMARY,
      }),
      counts: result.counts,
      alreadyCommitted: result.alreadyCommitted,
    };
  }

  /** Failure event in its own write, after the rollback; a failed write is logged and captured. */
  private async commitFailed(
    eventId: string,
    runId: string,
    actor: Actor,
    client: ClientContext,
    reason: string,
  ) {
    try {
      await audit(this.prisma, {
        action: 'import.commit_failed',
        entityType: 'import_run',
        entityId: runId,
        eventId,
        actorUserId: actor.userId,
        newValue: { runId, reason },
        ...client,
      });
    } catch (error) {
      this.deps.logger.error(
        { runId, reason },
        'import.commit_failed audit entry could not be written',
      );
      captureException(error, { requestId: `import:${runId}` });
    }
  }

  // ---------------------------------------------------------------- discard, history, reports

  async discard(runId: string, actor: Actor, client: ClientContext) {
    const run = await this.loadRun(runId);
    if (run.status === 'committed')
      throw new HttpError(409, 'run_closed', 'A committed run cannot be discarded.');
    if (run.status === 'discarded') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.importRun.update({ where: { id: runId }, data: { status: 'discarded' } });
      await audit(tx, {
        action: 'import.discarded',
        entityType: 'import_run',
        entityId: runId,
        eventId: run.eventId,
        actorUserId: actor.userId,
        newValue: { runId, previousStatus: run.status },
        ...client,
      });
    });
  }

  async listRuns(eventId: string) {
    return this.prisma.importRun.findMany({
      where: { eventId },
      select: RUN_SUMMARY,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRun(runId: string, outcome?: string) {
    const run = await this.loadRun(runId);
    const rows = await this.prisma.importRow.findMany({
      where: { runId, ...(outcome ? { outcome: outcome as never } : {}) },
      select: ROW_FIELDS,
      orderBy: { rowNumber: 'asc' },
    });
    return { run, rows };
  }

  /** Open conflicts of the event: quarantined rows of committed runs (D3 step 7). */
  async conflicts(eventId: string) {
    return this.prisma.importRow.findMany({
      where: { outcome: 'conflict', resolution: null, run: { eventId, status: 'committed' } },
      select: {
        ...ROW_FIELDS,
        runId: true,
        run: { select: { fileName: true, committedAt: true } },
      },
      orderBy: [{ run: { committedAt: 'desc' } }, { rowNumber: 'asc' }],
    });
  }

  /** Row-level report as CSV; the download is audited (D9). Formula-like cells are neutralised. */
  async reportCsv(
    runId: string,
    actor: Actor,
    client: ClientContext,
  ): Promise<{ fileName: string; csv: string }> {
    const { run, rows } = await this.getRun(runId);
    await audit(this.prisma, {
      action: 'import.report_downloaded',
      entityType: 'import_run',
      entityId: runId,
      eventId: run.eventId,
      actorUserId: actor.userId,
      newValue: { runId, rows: rows.length },
      ...client,
    });
    const columns = [
      'row',
      'outcome',
      'reason',
      'detail',
      'possible_duplicate',
      'email',
      'name',
      'organisation',
      'job_title',
      'country',
      'attendance_format',
      'capacity',
      'nominating_organisation',
      'registration_status',
      'external_registration_id',
      'delegate_id',
      'identity_id',
    ];
    const lines = [columns.join(',')];
    for (const r of rows) {
      const v = (r.values ?? {}) as Partial<RowValues>;
      lines.push(
        [
          r.rowNumber,
          r.outcome ?? '',
          r.reasonCode ?? '',
          r.reasonDetail ?? '',
          r.possibleDuplicate ? 'yes' : '',
          v.email ?? '',
          v.name ?? '',
          v.organisation ?? '',
          v.jobTitle ?? '',
          v.country ?? '',
          v.attendanceFormat ?? '',
          v.capacity ?? '',
          v.nominatingOrganisation ?? '',
          v.registrationStatus ?? '',
          v.externalRegistrationId ?? '',
          r.delegateId ?? '',
          r.identityId ?? '',
        ]
          .map((cell) => csvCell(String(cell ?? '')))
          .join(','),
      );
    }
    return { fileName: `import-${runId}-report.csv`, csv: `${lines.join('\r\n')}\r\n` };
  }

  // ---------------------------------------------------------------- internals

  private async loadRun(runId: string) {
    const run = await this.prisma.importRun.findUnique({
      where: { id: runId },
      select: {
        ...RUN_SUMMARY,
        headers: true,
        fileHash: true,
        mapping: true,
        attendanceFormatDefault: true,
        valueMappings: true,
        fingerprint: true,
      },
    });
    if (!run) throw new HttpError(404, 'not_found', 'Import run not found.');
    return run;
  }

  private emailOf(raw: Record<string, string>, request: ImportPreviewRequest): string | null {
    const normalised = normaliseRow(
      raw,
      request.mapping,
      request.attendanceFormatDefault,
      request.valueMappings,
    );
    if (normalised.ok) return normalised.values.email;
    const cell = raw[request.mapping.email];
    return cell ? normaliseEmail(cell) : null;
  }

  private async classify(
    db: Db,
    eventId: string,
    source: string,
    rawRows: ReadonlyArray<{ rowNumber: number; raw: unknown }>,
    request: ImportPreviewRequest,
  ): Promise<{ rows: ClassifiedRow[]; snapshot: string }> {
    const inputs = rawRows.map((r) => ({
      rowNumber: r.rowNumber,
      normalised: normaliseRow(
        r.raw as Record<string, string>,
        request.mapping,
        request.attendanceFormatDefault,
        request.valueMappings,
      ),
    }));
    const emails = [
      ...new Set(
        inputs
          .filter((i) => i.normalised.ok)
          .map((i) => (i.normalised as { ok: true; values: RowValues }).values.email),
      ),
    ];
    const ctx = await this.loadContext(db, eventId, source, emails);
    return { rows: classifyRows(inputs, ctx.context), snapshot: ctx.snapshot };
  }

  /** The event's registrations and the ownership of the file's addresses, plus a snapshot token. */
  private async loadContext(
    db: Db,
    eventId: string,
    source: string,
    emails: string[],
  ): Promise<{ context: MatchContext; snapshot: string }> {
    const registrations = await db.delegate.findMany({
      where: { eventId, registrationStatus: { not: 'duplicate' } },
      select: {
        id: true,
        identityId: true,
        email: true,
        name: true,
        organisation: true,
        jobTitle: true,
        country: true,
        attendanceFormat: true,
        capacity: true,
        nominatingOrganisation: true,
        registrationStatus: true,
        externalRegistrationId: true,
        registrationSource: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    });
    const owners: AddressOwner[] = [];
    const ownerRows: Array<{
      emailNormalised: string;
      identityId: string;
      kind: AddressOwner['kind'];
      identity: {
        displayName: string;
        updatedAt: Date;
        userAccount: { id: string; status: 'active' | 'inactive' } | null;
      };
    }> = [];
    for (let i = 0; i < emails.length; i += 500) {
      const chunk = emails.slice(i, i + 500);
      const found = await db.identityEmail.findMany({
        where: { emailNormalised: { in: chunk } },
        select: {
          emailNormalised: true,
          identityId: true,
          kind: true,
          identity: {
            select: {
              displayName: true,
              updatedAt: true,
              userAccount: { select: { id: true, status: true } },
            },
          },
        },
        orderBy: { emailNormalised: 'asc' },
      });
      ownerRows.push(...found);
    }
    const ownerMap = new Map<string, AddressOwner>();
    for (const row of ownerRows) {
      const owner: AddressOwner = {
        identityId: row.identityId,
        kind: row.kind,
        displayName: row.identity.displayName,
        userAccountId: row.identity.userAccount?.id ?? null,
        accountStatus: row.identity.userAccount?.status ?? null,
      };
      owners.push(owner);
      ownerMap.set(row.emailNormalised, owner);
    }
    const existing: ExistingRegistration[] = registrations.map((r) => ({
      id: r.id,
      identityId: r.identityId,
      email: normaliseEmail(r.email),
      name: r.name,
      organisation: r.organisation,
      jobTitle: r.jobTitle,
      country: r.country,
      attendanceFormat: r.attendanceFormat,
      capacity: r.capacity,
      nominatingOrganisation: r.nominatingOrganisation,
      registrationStatus: r.registrationStatus,
      externalRegistrationId: r.externalRegistrationId,
      registrationSource: r.registrationSource,
    }));
    const snapshot = sha256([
      ...registrations.map((r) => `${r.id}|${r.updatedAt.toISOString()}|${r.identityId ?? ''}`),
      '#',
      ...ownerRows.map(
        (r) =>
          `${r.emailNormalised}|${r.identityId}|${r.kind}|${r.identity.updatedAt.toISOString()}|${r.identity.userAccount?.status ?? ''}`,
      ),
    ]);
    return { context: { source, registrations: existing, owners: ownerMap }, snapshot };
  }

  /** Key order of the stored mapping is not stable (jsonb), so the mapping is serialised canonically. */
  private fingerprint(fileHash: string, request: ImportPreviewRequest, snapshot: string): string {
    return sha256([
      fileHash,
      stableStringify(request.mapping),
      request.attendanceFormatDefault ?? '',
      stableStringify(request.valueMappings ?? null),
      snapshot,
    ]);
  }

  /**
   * File values of the enumerated fields that neither a synonym nor a translation recognises, with
   * how many rows carry each, so the admin can translate them explicitly (D4).
   */
  private unrecognisedValues(
    rawRows: ReadonlyArray<{ raw: unknown }>,
    request: ImportPreviewRequest,
  ): Record<ImportValueMappedField, Array<{ value: string; count: number }>> {
    const reasons: Record<ImportValueMappedField, string> = {
      attendanceFormat: 'attendance_format_unknown',
      capacity: 'capacity_unknown',
      registrationStatus: 'registration_status_unknown',
    };
    const tallies: Record<ImportValueMappedField, Map<string, number>> = {
      attendanceFormat: new Map(),
      capacity: new Map(),
      registrationStatus: new Map(),
    };
    for (const r of rawRows) {
      const raw = r.raw as Record<string, string>;
      const result = normaliseRow(
        raw,
        request.mapping,
        request.attendanceFormatDefault,
        request.valueMappings,
      );
      if (result.ok) continue;
      for (const field of importValueMappedFields) {
        const column = request.mapping[field];
        if (!column || !result.rejections.some((x) => x.reason === reasons[field])) continue;
        const value = (raw[column] ?? '').trim();
        tallies[field].set(value, (tallies[field].get(value) ?? 0) + 1);
      }
    }
    const out = {} as Record<ImportValueMappedField, Array<{ value: string; count: number }>>;
    for (const field of importValueMappedFields) {
      out[field] = [...tallies[field].entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, 50);
    }
    return out;
  }

  /** Applies the classified rows: identities, addresses, registrations, per-record audit, row links. */
  private async apply(
    tx: Prisma.TransactionClient,
    runId: string,
    eventId: string,
    source: string,
    rows: readonly ClassifiedRow[],
    actor: Actor,
    client: ClientContext,
    now: Date,
  ): Promise<void> {
    for (const row of rows) {
      let delegateId = row.delegateId;
      let identityId = row.identityId;
      const v = row.values;
      if (row.outcome === 'accepted' && v) {
        const identity = await tx.delegateIdentity.create({
          data: {
            displayName: v.name,
            emails: {
              create: {
                emailNormalised: v.email,
                kind: 'current',
                evidence: 'import',
                actorUserId: actor.userId,
              },
            },
          },
          select: { id: true },
        });
        identityId = identity.id;
        await audit(tx, {
          action: 'identity.created',
          entityType: 'delegate_identity',
          entityId: identityId,
          eventId,
          actorUserId: actor.userId,
          newValue: { identityId, runId, row: row.rowNumber },
          ...client,
        });
        delegateId = (await this.createRegistration(tx, eventId, source, identityId, null, v, now))
          .id;
        await audit(tx, {
          action: 'delegate.imported',
          entityType: 'delegate',
          entityId: delegateId,
          eventId,
          actorUserId: actor.userId,
          newValue: { delegateId, identityId, runId, row: row.rowNumber },
          ...client,
        });
      } else if (row.outcome === 'linked' && v && identityId) {
        const identity = await tx.delegateIdentity.findUniqueOrThrow({
          where: { id: identityId },
          select: { userAccountId: true },
        });
        delegateId = (
          await this.createRegistration(
            tx,
            eventId,
            source,
            identityId,
            identity.userAccountId,
            v,
            now,
          )
        ).id;
        await audit(tx, {
          action: 'identity.linked',
          entityType: 'delegate_identity',
          entityId: identityId,
          eventId,
          actorUserId: actor.userId,
          newValue: { identityId, delegateId, runId, row: row.rowNumber },
          ...client,
        });
        await audit(tx, {
          action: 'delegate.imported',
          entityType: 'delegate',
          entityId: delegateId,
          eventId,
          actorUserId: actor.userId,
          newValue: { delegateId, identityId, runId, row: row.rowNumber },
          ...client,
        });
      } else if (row.outcome === 'updated' && v && delegateId) {
        const data: Prisma.DelegateUpdateInput = { importedAt: now };
        const oldValue: Record<string, string | null> = {};
        const newValue: Record<string, string | null> = {};
        for (const change of row.changes) {
          (data as Record<string, unknown>)[change.field] = change.to;
          oldValue[change.field] = change.from;
          newValue[change.field] = change.to;
        }
        if (row.changes.some((c) => c.field === 'externalRegistrationId'))
          data.registrationSource = source;
        await tx.delegate.update({ where: { id: delegateId }, data });
        await audit(tx, {
          action: 'delegate.updated_by_import',
          entityType: 'delegate',
          entityId: delegateId,
          eventId,
          actorUserId: actor.userId,
          oldValue,
          newValue: { ...newValue, runId, row: row.rowNumber } as Prisma.InputJsonValue,
          ...client,
        });
      }
      await tx.importRow.update({
        where: { runId_rowNumber: { runId, rowNumber: row.rowNumber } },
        data: { delegateId, identityId },
      });
    }
  }

  private createRegistration(
    tx: Prisma.TransactionClient,
    eventId: string,
    source: string,
    identityId: string,
    userAccountId: string | null,
    v: RowValues,
    now: Date,
  ) {
    return tx.delegate.create({
      data: {
        eventId,
        identityId,
        userAccountId,
        name: v.name,
        email: v.email,
        organisation: v.organisation,
        jobTitle: v.jobTitle,
        country: v.country,
        attendanceFormat: v.attendanceFormat,
        capacity: v.capacity,
        nominatingOrganisation: v.nominatingOrganisation,
        registrationStatus: v.registrationStatus,
        registrationSource: source,
        externalRegistrationId: v.externalRegistrationId,
        importedAt: now,
      },
      select: { id: true },
    });
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function mappingColumns(
  mapping: ImportMapping,
): Record<string, string | { first: string; last: string } | null> {
  const out: Record<string, string | { first: string; last: string } | null> = {};
  for (const [field, value] of Object.entries(mapping)) out[field] = value ?? null;
  return out;
}

function publicRow(row: ClassifiedRow) {
  return {
    rowNumber: row.rowNumber,
    outcome: row.outcome,
    reasonCode: row.reasonCode,
    reasonDetail: row.reasonDetail,
    possibleDuplicate: row.possibleDuplicate,
    values: row.values,
    conflict: row.conflict,
    delegateId: row.delegateId,
    identityId: row.identityId,
    changes: row.changes,
  };
}

/** CSV cell with RFC 4180 quoting; a leading = + - @ is prefixed so spreadsheets treat it as text. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}
