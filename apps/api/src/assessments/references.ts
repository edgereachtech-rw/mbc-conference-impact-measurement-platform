import {
  describeAnswer,
  planHasContent,
  type PlanStatusValue,
  type QuestionOption,
} from '@mbc/shared';

import type { PrismaClient } from '../db.js';

export interface ReferenceAnswer {
  questionKey: string;
  prompt: string;
  answer: string | null;
}

type Db = Pick<
  PrismaClient,
  'eventReferenceQuestion' | 'assessmentQuestion' | 'assessmentAnswer' | 'transferPlan'
>;

/**
 * The delegate's own answers to the event's reference questions (the pre-event questions the
 * admin chose to show back), in the admin's order, as text, whichever version of the question
 * they answered. The first one is the expectation the built-in expectations block asks about.
 */
export async function referenceAnswersFor(
  db: Db,
  eventId: string,
  delegateId: string,
): Promise<ReferenceAnswer[]> {
  const refs = await db.eventReferenceQuestion.findMany({
    where: { eventId },
    orderBy: { order: 'asc' },
  });
  const out: ReferenceAnswer[] = [];
  for (const ref of refs) {
    const question = await db.assessmentQuestion.findFirst({
      where: { questionKey: ref.questionKey, eventId },
      orderBy: { version: 'desc' },
      select: { prompt: true },
    });
    if (!question) continue;
    const answer = await db.assessmentAnswer.findFirst({
      where: {
        question: { questionKey: ref.questionKey },
        response: { delegateId, stage: { eventId } },
      },
      orderBy: { createdAt: 'desc' },
      select: { value: true, question: { select: { type: true, options: true } } },
    });
    out.push({
      questionKey: ref.questionKey,
      prompt: question.prompt,
      answer: answer
        ? describeAnswer(
            {
              type: answer.question.type,
              options: (answer.question.options as QuestionOption[] | null) ?? null,
            },
            answer.value,
          ) || null
        : null,
    });
  }
  return out;
}

/** Whether the delegate's Transfer Plan is submitted, started or absent (backlog E11-11). */
export async function planStatusFor(
  db: Db,
  eventId: string,
  delegateId: string,
): Promise<PlanStatusValue> {
  const plan = await db.transferPlan.findUnique({
    where: { eventId_delegateId: { eventId, delegateId } },
    select: { status: true, actions: { select: { action: true } } },
  });
  if (!plan) return 'no';
  if (plan.status === 'submitted') return 'yes';
  return planHasContent(plan.actions) ? 'started' : 'no';
}
