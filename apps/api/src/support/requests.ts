import type { SupportFlag } from '@mbc/shared';

import type { Prisma } from '../generated/prisma/client.js';

/** The answers of one follow-up save that matter here: what was said, to which question. */
export interface FollowUpAnswer {
  questionId: string;
  sectionKey: string;
  /** How the question feeds the Support page (2026-11-09). */
  supportFlag: SupportFlag;
  value: unknown;
}

/**
 * Raises the Support page items of the sections just submitted in a follow-up (brief 11.7,
 * E13-1; flags of 2026-11-09): a support request from each answered question flagged "support
 * requested", with the barrier named in the same section beside it for context, and a barrier
 * item from each answered question flagged "barrier". A section submitted once never raises the
 * same item twice: the (response, question) pair is unique, and a repeat save of a locked section
 * changes nothing.
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
  // A yes/no "would you like..." or a blank line is not a request for anything.
  const said = (v: unknown) => {
    const t = text(v);
    return t && !/^(yes|no|true|false)$/i.test(t) ? t : '';
  };
  let raised = 0;
  for (const key of input.submittedKeys) {
    const inSection = input.answers.filter((a) => a.sectionKey === key);
    const barrierBeside = inSection.find((a) => a.supportFlag === 'barrier' && said(a.value));
    for (const a of inSection) {
      if (a.supportFlag === 'none') continue;
      const request = said(a.value);
      if (!request) continue;
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
          kind: a.supportFlag === 'barrier' ? 'barrier' : 'support',
          responseId: input.responseId,
          questionId: a.questionId,
          context: input.context,
          request,
          barrier:
            a.supportFlag === 'support_requested' && barrierBeside ? said(barrierBeside.value) : '',
        },
      });
      raised += 1;
    }
  }
  return raised;
}
