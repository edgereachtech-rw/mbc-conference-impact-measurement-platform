import type { Prisma } from '../generated/prisma/client.js';

/**
 * ITTEC pilot content: which of the seeded pre-conference prompts the event shows back beside
 * the Transfer Plan, in this order (the first is the expectation the end-of-conference
 * evaluation asks about). Matched by prompt text once; an admin can change the list later and
 * the seed never removes a choice.
 */
export const ITTEC_REFERENCE_PROMPTS: readonly string[] = [
  'What would you like to learn or gain from the conference?',
  'What would you like to do differently after the conference?',
];

export async function seedReferenceQuestions(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<number> {
  const existing = await tx.eventReferenceQuestion.findMany({ where: { eventId } });
  if (existing.length) return 0;
  let order = 0;
  for (const prompt of ITTEC_REFERENCE_PROMPTS) {
    const question = await tx.assessmentQuestion.findFirst({
      where: { eventId, prompt, stage: { stage: 'pre_conference' } },
      orderBy: { version: 'desc' },
      select: { questionKey: true },
    });
    if (!question) continue;
    order += 1;
    await tx.eventReferenceQuestion.create({
      data: { eventId, order, questionKey: question.questionKey },
    });
  }
  return order;
}
