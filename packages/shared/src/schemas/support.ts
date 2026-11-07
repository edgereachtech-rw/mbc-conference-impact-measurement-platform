import { z } from 'zod';

/**
 * Transfer support (brief 11.7; backlog E13). A support request is a delegate asking M.Bryan, or
 * another stakeholder through M.Bryan, for help applying their learning. It is raised from a
 * follow-up answer (any follow-up question whose area names "support", once that section is
 * submitted) or by the delegate from their plan page, and tracked by the organisers until it is
 * addressed: who asked, what for, the barrier behind it, the action taken, and whether it is
 * still open.
 */

export const supportRequestSources = ['follow_up', 'delegate'] as const;
export type SupportRequestSource = (typeof supportRequestSources)[number];
export const supportRequestSourceLabels: Record<SupportRequestSource, string> = {
  follow_up: 'From a follow-up answer',
  delegate: 'Asked from the plan page',
};

export const supportRequestStatuses = ['open', 'addressed'] as const;
export type SupportRequestStatus = (typeof supportRequestStatuses)[number];
export const supportRequestStatusLabels: Record<SupportRequestStatus, string> = {
  open: 'Open',
  addressed: 'Addressed',
};

// ------------------------------------------------------------------ commands

/** A delegate asks for support from their plan page (E13-1). */
export const supportRequestCreateSchema = z.object({
  request: z.string().trim().min(1, 'Say what support you need.').max(2000),
  /** What stands in the way, in the delegate's words; optional. */
  barrier: z.string().trim().max(2000).default(''),
  /** The planned action it concerns, when it concerns one. */
  actionId: z.uuid().nullable().default(null),
});
export type SupportRequestCreate = z.infer<typeof supportRequestCreateSchema>;

/** The organisers record what was done and whether the request is addressed (E13-3, E13-4). */
export const supportRequestUpdateSchema = z.object({
  status: z.enum(supportRequestStatuses),
  actionTaken: z.string().trim().max(4000).default(''),
});
export type SupportRequestUpdate = z.infer<typeof supportRequestUpdateSchema>;

// ------------------------------------------------------------------ views

export const supportRequestViewSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  delegate: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    organisation: z.string().nullable(),
  }),
  source: z.enum(supportRequestSources),
  /** Where it came from in words: the wave ("30-day follow-up") or the plan page. */
  context: z.string(),
  /** The planned action it concerns, when it concerns one. */
  action: z.string().nullable(),
  request: z.string(),
  barrier: z.string(),
  status: z.enum(supportRequestStatuses),
  actionTaken: z.string(),
  /** Who addressed it, as the organisers know them; null while open. */
  addressedBy: z.string().nullable(),
  addressedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SupportRequestView = z.infer<typeof supportRequestViewSchema>;

/** What the delegate sees of their own requests: the same, without the delegate block. */
export const mySupportRequestSchema = supportRequestViewSchema.omit({ delegate: true });
export type MySupportRequest = z.infer<typeof mySupportRequestSchema>;

/** The organisers' view of an event's requests (E13-2, E13-4, E13-5). */
export const supportRequestsSchema = z.object({
  requests: z.array(supportRequestViewSchema),
  counts: z.object({ open: z.number().int(), addressed: z.number().int() }),
  /**
   * The barriers named so far, as written, grouped where the wording is the same (case and
   * spacing aside), most frequent first. Tagging by category is for the organisers to add later.
   */
  barriers: z.array(z.object({ text: z.string(), count: z.number().int() })),
});
export type SupportRequests = z.infer<typeof supportRequestsSchema>;

// ------------------------------------------------------------------ helpers

/** Groups free-text barriers by their wording, case and surrounding space aside. */
export function groupBarriers(texts: readonly string[]): Array<{ text: string; count: number }> {
  const groups = new Map<string, { text: string; count: number }>();
  for (const raw of texts) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    const found = groups.get(key);
    if (found) found.count += 1;
    else groups.set(key, { text, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

/** A follow-up question raises a request when its area speaks of support. */
export const isSupportArea = (area: string | null | undefined) => /support/i.test(area ?? '');
/** A follow-up question names a barrier when its area speaks of barriers. */
export const isBarrierArea = (area: string | null | undefined) => /barrier/i.test(area ?? '');
