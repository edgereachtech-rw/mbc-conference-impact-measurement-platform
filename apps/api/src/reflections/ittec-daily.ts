import type { ReflectionQuestionFields } from '@mbc/shared';

import type { Prisma } from '../generated/prisma/client.js';

/**
 * ITTEC 2026's Daily Learning Reflections (task of 2026-10-31, section 6), the agreed wording.
 * Pilot content, seeded as the ITTEC event's own data for its two conference days; the feature
 * itself is per event date and holds nothing ITTEC-specific. Both are seeded as drafts: the
 * admin sets the window and publishes.
 */
export interface DailyReflectionContent {
  /** The event date (YYYY-MM-DD) the questionnaire belongs to. */
  date: string;
  title: string;
  questions: ReflectionQuestionFields[];
}

export const ITTEC_DAILY_REFLECTIONS: readonly DailyReflectionContent[] = [
  {
    date: '2026-11-12',
    title: 'Day 1 reflection',
    questions: [
      {
        prompt: 'What is the most valuable thing you learned today?',
        type: 'long_text',
        required: true,
        concern: false,
      },
      {
        prompt:
          'What idea, tool, practice, model, or framework from today could you apply in your work?',
        type: 'long_text',
        required: true,
        concern: false,
      },
      {
        prompt:
          'Is there anything about your conference experience that the ITTEC team should address before Day 2?',
        type: 'long_text',
        required: false,
        concern: true,
      },
    ],
  },
  {
    date: '2026-11-13',
    title: 'Day 2 reflection',
    questions: [
      {
        prompt: 'What is the most valuable thing you learned on Day 2?',
        type: 'long_text',
        required: true,
        concern: false,
      },
      {
        prompt: 'Which Day 2 session, discussion or activity was most relevant to your work?',
        type: 'long_text',
        required: true,
        concern: false,
      },
      {
        prompt: 'What idea from Day 2 would you like to explore or apply?',
        type: 'long_text',
        required: true,
        concern: false,
      },
      {
        prompt: 'What question remains on your mind after today’s sessions?',
        type: 'long_text',
        required: false,
        concern: false,
      },
    ],
  },
];

/**
 * Creates the reflection of each content item for the matching event date, as a draft, when
 * that date has none yet. Dates without content stay disabled.
 */
export async function seedDailyReflections(
  tx: Prisma.TransactionClient,
  eventId: string,
  content: readonly DailyReflectionContent[] = ITTEC_DAILY_REFLECTIONS,
): Promise<number> {
  const dates = await tx.eventDate.findMany({
    where: { eventId },
    select: { id: true, date: true, reflection: { select: { id: true } } },
  });
  let created = 0;
  for (const item of content) {
    const date = dates.find((d) => d.date.toISOString().slice(0, 10) === item.date);
    if (!date || date.reflection) continue;
    await tx.reflectionActivity.create({
      data: {
        eventId,
        eventDateId: date.id,
        title: item.title,
        questions: {
          create: item.questions.map((q, i) => ({
            eventId,
            order: i + 1,
            prompt: q.prompt,
            type: q.type,
            required: q.required,
            concern: q.concern,
          })),
        },
      },
    });
    created += 1;
  }
  return created;
}
