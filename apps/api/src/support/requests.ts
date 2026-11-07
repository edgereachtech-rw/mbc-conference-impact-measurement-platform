import { isBarrierArea, isSupportArea } from '@mbc/shared';

import type { Prisma } from '../generated/prisma/client.js';

/** The answers of one follow-up save that matter here: what was said, to which question. */
export interface FollowUpAnswer {
  questionId: string;
  sectionKey: string;
  area: string | null;
  value: unknown;
}

/**
 * Raises a support request from each answered support question of the sections just submitted
 * in a follow-up (brief 11.7, E13-1), one per answer, with the barrier the delegate named in the
 * same section beside it. A section submitted once never raises the same request twice: the
 * (response, question) pair is unique, and a repeat save of a locked section changes nothing.
 */
export async function raiseFollowUpSupportRequests(
  db: Prisma.TransactionClient,
  input: {
    eventId: string;
    delegateId: string;
    responseId: string;
    /** The wave in words, "30-day follow-up". */
    context: string;
    submittedKeys: readonly string[];
    answers: readonly FollowUpAnswer[];
  },
): Promise<number> {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  let raised = 0;
  for (const key of input.submittedKeys) {
    const inSection = input.answers.filter((a) => a.sectionKey === key);
    const barrier = inSection.find((a) => isBarrierArea(a.area) && text(a.value));
    for (const a of inSection) {
      if (!isSupportArea(a.area)) continue;
      const request = text(a.value);
      // A yes/no "would you like..." or a blank line is not a request for anything.
      if (!request || /^(yes|no|true|false)$/i.test(request)) continue;
      const existing = await db.supportRequest.findUnique({
        where: {
          responseId_questionId: { responseId: input.responseId, questionId: a.questionId },
        },
        select: { id: true },
      });
      if (existing) continue;
      await db.supportRequest.create({
        data: {
          eventId: input.eventId,
          delegateId: input.delegateId,
          source: 'follow_up',
          responseId: input.responseId,
          questionId: a.questionId,
          context: input.context,
          request,
          barrier: barrier ? text(barrier.value) : '',
        },
      });
      raised += 1;
    }
  }
  return raised;
}
