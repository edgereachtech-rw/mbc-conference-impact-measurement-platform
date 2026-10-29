import type { ImportConflictReason, ImportRowOutcome } from '@mbc/shared';

import {
  detailKey,
  identityPartDiffers,
  normaliseNameKey,
  repeatKey,
  UPDATABLE_FIELDS,
  type NormalisedRow,
  type RowValues,
  type UpdatableField,
} from './normalise.js';

/**
 * Row classification (backlog D5, D5.1). Pure: it takes the normalised rows and a snapshot of
 * the event's registrations and of the ownership of every address in the file, and returns one
 * outcome per row. The preview and the commit run the same function; the commit re-runs it inside
 * the transaction and refuses to proceed if any outcome differs from the preview (D3 step 5).
 *
 * Nothing here merges identities on names, moves a registration between identities, or changes
 * an identity's address: conflicts are quarantined with both sides recorded.
 */

export interface ExistingRegistration {
  id: string;
  identityId: string | null;
  /** Normalised email as imported for this event. */
  email: string;
  name: string;
  organisation: string | null;
  jobTitle: string | null;
  country: string | null;
  attendanceFormat: 'physical' | 'virtual';
  capacity: 'individual' | 'nominee' | 'other';
  nominatingOrganisation: string | null;
  registrationStatus: 'valid' | 'cancelled' | 'duplicate' | 'test';
  externalRegistrationId: string | null;
  registrationSource: string | null;
}

export interface AddressOwner {
  identityId: string;
  kind: 'current' | 'historical' | 'provisional';
  displayName: string;
  userAccountId: string | null;
  accountStatus: 'active' | 'inactive' | null;
}

export interface MatchContext {
  source: string;
  /** Registrations of the event that are not marked duplicate. */
  registrations: readonly ExistingRegistration[];
  /** Owner of each normalised address in the file that any identity holds (any kind). */
  owners: ReadonlyMap<string, AddressOwner>;
}

export interface ConflictSides {
  row: {
    email: string;
    name: string;
    externalRegistrationId: string | null;
    organisation: string | null;
  };
  existing: {
    delegateId?: string;
    identityId?: string;
    name?: string;
    email?: string;
    externalRegistrationId?: string | null;
    addressKind?: AddressOwner['kind'];
    rows?: number[];
  };
}

export interface FieldChange {
  field: UpdatableField;
  from: string | null;
  to: string | null;
}

export interface ClassifiedRow {
  rowNumber: number;
  values: RowValues | null;
  outcome: ImportRowOutcome;
  reasonCode: ImportConflictReason | string | null;
  reasonDetail: string | null;
  possibleDuplicate: boolean;
  conflict: ConflictSides | null;
  /** Registration the row updates or leaves unchanged. */
  delegateId: string | null;
  /** Identity the row links to (linked) or that owns the touched registration. */
  identityId: string | null;
  /** For `updated`: the fields that change, with old and new values. */
  changes: FieldChange[];
}

export interface RowInput {
  rowNumber: number;
  normalised: NormalisedRow;
}

/** The parts of a row outcome that must be identical at confirmation (D3 step 5). */
export function outcomeSignature(
  row: Pick<ClassifiedRow, 'outcome' | 'reasonCode' | 'delegateId' | 'identityId'>,
): string {
  return [row.outcome, row.reasonCode ?? '', row.delegateId ?? '', row.identityId ?? ''].join('|');
}

function sides(values: RowValues, existing: ConflictSides['existing']): ConflictSides {
  return {
    row: {
      email: values.email,
      name: values.name,
      externalRegistrationId: values.externalRegistrationId,
      organisation: values.organisation,
    },
    existing,
  };
}

function base(rowNumber: number, values: RowValues | null): ClassifiedRow {
  return {
    rowNumber,
    values,
    outcome: 'accepted',
    reasonCode: null,
    reasonDetail: null,
    possibleDuplicate: false,
    conflict: null,
    delegateId: null,
    identityId: null,
    changes: [],
  };
}

function conflict(
  row: ClassifiedRow,
  reason: ImportConflictReason,
  detail: string,
  existing: ConflictSides['existing'],
): ClassifiedRow {
  return {
    ...row,
    outcome: 'conflict',
    reasonCode: reason,
    reasonDetail: detail,
    conflict: sides(row.values!, existing),
  };
}

function registrationChanges(values: RowValues, reg: ExistingRegistration): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of UPDATABLE_FIELDS) {
    const to = values[field];
    const from = reg[field] as string | null;
    if (field === 'externalRegistrationId' && to === null) continue; // never clear an id
    if (field === 'registrationStatus' && (from === 'duplicate' || from === 'test')) continue;
    if ((from ?? null) !== (to ?? null))
      changes.push({ field, from: from ?? null, to: to ?? null });
  }
  return changes;
}

export function classifyRows(inputs: readonly RowInput[], ctx: MatchContext): ClassifiedRow[] {
  const out = new Map<number, ClassifiedRow>();
  const candidates: Array<{ rowNumber: number; values: RowValues }> = [];

  for (const input of inputs) {
    if (!input.normalised.ok) {
      const reasons = input.normalised.rejections;
      out.set(input.rowNumber, {
        ...base(input.rowNumber, null),
        outcome: 'rejected',
        reasonCode: reasons[0]?.reason ?? 'invalid',
        reasonDetail: reasons.map((r) => `${r.field}: ${r.reason}`).join('; '),
      });
    } else {
      candidates.push({ rowNumber: input.rowNumber, values: input.normalised.values });
    }
  }

  // Within the file: identical repeats are duplicates; any difference quarantines every row (D5).
  const byEmail = new Map<string, Array<{ rowNumber: number; values: RowValues }>>();
  for (const c of candidates) {
    const list = byEmail.get(c.values.email) ?? [];
    list.push(c);
    byEmail.set(c.values.email, list);
  }
  const settled = new Set<number>();
  for (const [, group] of byEmail) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const allIdentical = group.every((g) => repeatKey(g.values) === repeatKey(first.values));
    if (allIdentical) {
      for (const g of group.slice(1)) {
        out.set(g.rowNumber, {
          ...base(g.rowNumber, g.values),
          outcome: 'duplicate_in_file',
          reasonCode: 'duplicate_in_file',
          reasonDetail: `identical to row ${first.rowNumber}`,
        });
        settled.add(g.rowNumber);
      }
      continue;
    }
    const differsInIdentity = group.some((g) => identityPartDiffers(g.values, first.values));
    const reason: ImportConflictReason = differsInIdentity
      ? 'shared_email_in_file'
      : 'inconsistent_repeat';
    const rows = group.map((g) => g.rowNumber);
    for (const g of group) {
      out.set(
        g.rowNumber,
        conflict(
          base(g.rowNumber, g.values),
          reason,
          `rows ${rows.join(', ')} share this email${differsInIdentity ? ' with different names or ids' : ' with different details'}`,
          { rows: rows.filter((r) => r !== g.rowNumber) },
        ),
      );
      settled.add(g.rowNumber);
    }
  }

  // Within the file: one external id, two emails.
  const byExt = new Map<string, Array<{ rowNumber: number; values: RowValues }>>();
  for (const c of candidates) {
    if (settled.has(c.rowNumber) || !c.values.externalRegistrationId) continue;
    const list = byExt.get(c.values.externalRegistrationId) ?? [];
    list.push(c);
    byExt.set(c.values.externalRegistrationId, list);
  }
  for (const [, group] of byExt) {
    const emails = new Set(group.map((g) => g.values.email));
    if (emails.size < 2) continue;
    const rows = group.map((g) => g.rowNumber);
    for (const g of group) {
      out.set(
        g.rowNumber,
        conflict(
          base(g.rowNumber, g.values),
          'external_id_mismatch',
          `rows ${rows.join(', ')} carry the same registration id with different emails`,
          { rows: rows.filter((r) => r !== g.rowNumber) },
        ),
      );
      settled.add(g.rowNumber);
    }
  }

  // Against the database snapshot.
  const regByEmail = new Map<string, ExistingRegistration>();
  const regByExt = new Map<string, ExistingRegistration>();
  const nameOrgIndex = new Map<string, string[]>(); // nameKey|orgKey -> emails
  for (const reg of ctx.registrations) {
    regByEmail.set(reg.email, reg);
    if (reg.externalRegistrationId && reg.registrationSource === ctx.source) {
      regByExt.set(reg.externalRegistrationId, reg);
    }
    const key = `${normaliseNameKey(reg.name)}|${detailKey(reg.organisation)}`;
    nameOrgIndex.set(key, [...(nameOrgIndex.get(key) ?? []), reg.email]);
  }
  const acceptedNameOrg = new Map<string, string[]>();

  for (const c of candidates) {
    if (settled.has(c.rowNumber)) continue;
    const { values } = c;
    const row = base(c.rowNumber, values);
    const owner = ctx.owners.get(values.email);
    const byExtReg = values.externalRegistrationId
      ? regByExt.get(values.externalRegistrationId)
      : undefined;
    const byEmailReg = regByEmail.get(values.email);

    let result: ClassifiedRow;
    if (byExtReg && byEmailReg && byExtReg.id !== byEmailReg.id) {
      // Rule 2: the id belongs to another registration than the one holding this address.
      result = conflict(
        row,
        'external_id_mismatch',
        'the registration id belongs to a different registration than this email',
        {
          delegateId: byExtReg.id,
          identityId: byExtReg.identityId ?? undefined,
          email: byExtReg.email,
          externalRegistrationId: byExtReg.externalRegistrationId,
        },
      );
    } else if (byExtReg && !byEmailReg) {
      // Same id, new email. Allowed only as an old-email row of the record's own identity (D5 a).
      if (owner && byExtReg.identityId && owner.identityId === byExtReg.identityId) {
        result = { ...row, delegateId: byExtReg.id, identityId: byExtReg.identityId };
        result = applyUpdate(result, values, byExtReg);
      } else {
        result = conflict(
          row,
          'external_id_mismatch',
          'this registration id already exists in the event with a different email',
          {
            delegateId: byExtReg.id,
            identityId: byExtReg.identityId ?? undefined,
            name: byExtReg.name,
            email: byExtReg.email,
            externalRegistrationId: byExtReg.externalRegistrationId,
          },
        );
      }
    } else if (byEmailReg) {
      const reg = byEmailReg;
      if (!reg.identityId) {
        result = conflict(
          row,
          'address_under_migration_review',
          'the existing registration has no identity yet',
          { delegateId: reg.id, email: reg.email, name: reg.name },
        );
      } else if (owner && owner.identityId !== reg.identityId) {
        result = conflict(
          row,
          'email_owned_by_other_identity',
          'this email belongs to a different identity than the existing registration',
          {
            delegateId: reg.id,
            identityId: owner.identityId,
            name: owner.displayName,
            addressKind: owner.kind,
          },
        );
      } else if (owner?.kind === 'provisional') {
        result = conflict(
          row,
          'address_under_migration_review',
          'this address is reserved pending a migration decision',
          { identityId: owner.identityId, addressKind: owner.kind },
        );
      } else if (
        values.externalRegistrationId &&
        reg.externalRegistrationId &&
        reg.registrationSource === ctx.source &&
        reg.externalRegistrationId !== values.externalRegistrationId
      ) {
        result = conflict(
          row,
          'external_id_mismatch',
          'the existing registration for this email carries a different registration id',
          {
            delegateId: reg.id,
            identityId: reg.identityId,
            email: reg.email,
            externalRegistrationId: reg.externalRegistrationId,
          },
        );
      } else {
        result = applyUpdate(
          { ...row, delegateId: reg.id, identityId: reg.identityId },
          values,
          reg,
        );
      }
    } else if (!owner) {
      result = { ...row, outcome: 'accepted' };
    } else if (owner.kind === 'provisional') {
      result = conflict(
        row,
        'address_under_migration_review',
        'this address is reserved pending a migration decision',
        { identityId: owner.identityId, addressKind: owner.kind },
      );
    } else if (owner.kind === 'historical') {
      result = conflict(
        row,
        'previous_email_of_identity',
        'this address is a previous address of an identity and the row has no registration linkage in this event',
        { identityId: owner.identityId, name: owner.displayName, addressKind: owner.kind },
      );
    } else if (owner.accountStatus === 'inactive') {
      result = conflict(row, 'inactive_account', 'the identity is linked to an inactive account', {
        identityId: owner.identityId,
        name: owner.displayName,
      });
    } else if (normaliseNameKey(owner.displayName) !== normaliseNameKey(values.name)) {
      result = conflict(
        row,
        'name_mismatch',
        'the name differs from the name on the identity that holds this email',
        { identityId: owner.identityId, name: owner.displayName },
      );
    } else {
      result = { ...row, outcome: 'linked', identityId: owner.identityId };
    }

    if (result.outcome === 'accepted' || result.outcome === 'linked') {
      const key = `${normaliseNameKey(values.name)}|${detailKey(values.organisation)}`;
      const others = [...(nameOrgIndex.get(key) ?? []), ...(acceptedNameOrg.get(key) ?? [])].filter(
        (e) => e !== values.email,
      );
      if (others.length > 0) {
        result = {
          ...result,
          possibleDuplicate: true,
          reasonDetail: 'same name and organisation as a registration with another email',
        };
      }
      acceptedNameOrg.set(key, [...(acceptedNameOrg.get(key) ?? []), values.email]);
    }
    out.set(c.rowNumber, result);
  }

  return [...out.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}

function applyUpdate(
  row: ClassifiedRow,
  values: RowValues,
  reg: ExistingRegistration,
): ClassifiedRow {
  const changes = registrationChanges(values, reg);
  return changes.length === 0
    ? { ...row, outcome: 'unchanged', reasonDetail: 'updated (no change)' }
    : { ...row, outcome: 'updated', changes };
}

export interface Counts {
  total: number;
  accepted: number;
  updated: number;
  unchanged: number;
  linked: number;
  duplicateInFile: number;
  rejected: number;
  conflict: number;
  possibleDuplicate: number;
}

export function countRows(rows: readonly ClassifiedRow[]): Counts {
  const counts: Counts = {
    total: rows.length,
    accepted: 0,
    updated: 0,
    unchanged: 0,
    linked: 0,
    duplicateInFile: 0,
    rejected: 0,
    conflict: 0,
    possibleDuplicate: 0,
  };
  for (const row of rows) {
    if (row.outcome === 'duplicate_in_file') counts.duplicateInFile += 1;
    else counts[row.outcome] += 1;
    if (row.possibleDuplicate) counts.possibleDuplicate += 1;
  }
  return counts;
}
