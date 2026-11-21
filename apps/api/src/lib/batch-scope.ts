import type { PrismaClient } from '../db.js';
import { HttpError } from './errors.js';

const UUID = /^[0-9a-f-]{36}$/i;

/** One batch a download is narrowed to (2026-11-22), or null for every delegate. */
export interface BatchScope {
  id: string;
  name: string;
  /** The batch's day (YYYY-MM-DD). */
  date: string;
  eventDateId: string;
}

/**
 * The `?batch=` of a download (2026-11-22): every report and export of an event in batches can
 * be narrowed to one batch's delegates. Absent or empty: everyone. A batch of another event, or
 * no batch at all, is "not found" rather than silently everyone.
 */
export async function batchScopeOf(
  prisma: PrismaClient,
  eventId: string,
  raw: unknown,
): Promise<BatchScope | null> {
  if (raw === undefined || raw === null || raw === '') return null;
  const id = String(raw);
  const row = UUID.test(id)
    ? await prisma.eventBatch.findFirst({
        where: { id, eventId },
        select: { id: true, name: true, eventDateId: true, eventDate: { select: { date: true } } },
      })
    : null;
  if (!row) throw new HttpError(404, 'not_found', 'No such batch in this event.');
  return {
    id: row.id,
    name: row.name,
    eventDateId: row.eventDateId,
    date: row.eventDate.date.toISOString().slice(0, 10),
  };
}

/** The delegate filter of a scope, to spread into a `delegate` where clause. */
export const inBatch = (scope: BatchScope | null) => (scope ? { batchId: scope.id } : {});
