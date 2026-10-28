import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Any client that can write: the shared PrismaClient or the `tx` inside $transaction. */
export type AuditWriter = Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient;

export interface AuditEntry {
  /** Dotted verb, past tense: "delegate.status_changed", "export.created", "signin.failed". */
  action: string;
  /** Table or domain object name, e.g. "delegate", "event", "report". */
  entityType: string;
  entityId?: string | null;
  eventId?: string | null;
  /** The signed-in user performing the action; null for system jobs. */
  actorUserId?: string | null;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Writes one append-only audit row (backlog E17-4). Call it inside the same transaction as the
 * change it describes so the row and the change commit together:
 *
 *   await prisma.$transaction(async (tx) => {
 *     const updated = await tx.delegate.update(...);
 *     await audit(tx, { action: 'delegate.status_changed', entityType: 'delegate', ... });
 *   });
 *
 * Rows can never be updated or deleted: a database trigger rejects both.
 */
export async function audit(db: AuditWriter, entry: AuditEntry) {
  return db.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      eventId: entry.eventId ?? null,
      actorUserId: entry.actorUserId ?? null,
      oldValue: entry.oldValue ?? undefined,
      newValue: entry.newValue ?? undefined,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}
