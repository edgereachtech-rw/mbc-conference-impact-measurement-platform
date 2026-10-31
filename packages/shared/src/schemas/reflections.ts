import { z } from 'zod';

/**
 * Daily Learning Reflections (task of 2026-10-31): an optional questionnaire per event date,
 * configured and published by admins, answered once by each registered delegate at the end of
 * that day. A distinct activity: never attendance, session feedback, the Transfer Plan or an
 * assessment stage. Questions are data, versioned; answers keep the wording they answered.
 */

export const reflectionStatuses = ['draft', 'published', 'closed'] as const;
export type ReflectionStatus = (typeof reflectionStatuses)[number];

export const reflectionQuestionTypes = ['short_text', 'long_text'] as const;
export type ReflectionQuestionType = (typeof reflectionQuestionTypes)[number];

export const reflectionStatusLabels: Record<ReflectionStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  closed: 'Closed',
};
export const reflectionQuestionTypeLabels: Record<ReflectionQuestionType, string> = {
  short_text: 'Short answer',
  long_text: 'Long answer',
};

const isoInstant = z.iso.datetime({ offset: true });

export const reflectionActivityFieldsSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the reflection a title').max(200),
    opensAt: isoInstant.nullable().optional(),
    closesAt: isoInstant.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.opensAt && v.closesAt && new Date(v.closesAt) <= new Date(v.opensAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'The deadline must be later than the opening time.',
      });
    }
  });
export type ReflectionActivityFields = z.infer<typeof reflectionActivityFieldsSchema>;

export const reflectionQuestionFieldsSchema = z.object({
  prompt: z.string().trim().min(1, 'Write the question').max(500),
  type: z.enum(reflectionQuestionTypes).default('long_text'),
  required: z.boolean().default(true),
  /** Answers are participant concerns the organisers must see promptly (Day 1, question 3). */
  concern: z.boolean().default(false),
});
export type ReflectionQuestionFields = z.infer<typeof reflectionQuestionFieldsSchema>;
export const reflectionQuestionPatchSchema = reflectionQuestionFieldsSchema.partial();
export const reflectionQuestionOrderSchema = z.object({
  questionIds: z.array(z.uuid()).min(1).max(100),
});

export const reflectionQuestionViewSchema = z.object({
  id: z.uuid(),
  questionKey: z.uuid(),
  version: z.number().int(),
  order: z.number().int(),
  prompt: z.string(),
  type: z.enum(reflectionQuestionTypes),
  required: z.boolean(),
  concern: z.boolean(),
  /** Answers stored against this version; an edit then creates a new version. */
  responseCount: z.number().int(),
});
export type ReflectionQuestionView = z.infer<typeof reflectionQuestionViewSchema>;

export const reflectionActivityViewSchema = z.object({
  id: z.uuid(),
  eventDateId: z.uuid(),
  date: z.string(),
  title: z.string(),
  status: z.enum(reflectionStatuses),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  questions: z.array(reflectionQuestionViewSchema),
  submitted: z.number().int(),
  registered: z.number().int(),
});
export type ReflectionActivityView = z.infer<typeof reflectionActivityViewSchema>;

/** Every selected date of the event, with its reflection when one is enabled. */
export const reflectionDateViewSchema = z.object({
  date: z.object({ id: z.uuid(), date: z.string() }),
  activity: reflectionActivityViewSchema.nullable(),
});
export type ReflectionDateView = z.infer<typeof reflectionDateViewSchema>;

const delegateRef = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  organisation: z.string().nullable(),
});

/** One answer to a concern question, for the organisers' prompt view. */
export const reflectionConcernSchema = z.object({
  activityId: z.uuid(),
  activityTitle: z.string(),
  date: z.string(),
  questionId: z.uuid(),
  prompt: z.string(),
  delegate: delegateRef,
  value: z.string(),
  submittedAt: z.string(),
});
export type ReflectionConcern = z.infer<typeof reflectionConcernSchema>;

export const reflectionResponsesSchema = z.object({
  activity: reflectionActivityViewSchema,
  rows: z.array(
    z.object({
      delegate: delegateRef,
      submittedAt: z.string(),
      /** Question id to the answer text; questions re-versioned after the answer map by key. */
      answers: z.record(z.uuid(), z.string()),
    }),
  ),
  notSubmitted: z.array(delegateRef),
});
export type ReflectionResponses = z.infer<typeof reflectionResponsesSchema>;

// ------------------------------------------------------------------ delegate

export const myReflectionStatuses = ['upcoming', 'open', 'closed'] as const;

export const myReflectionSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  title: z.string(),
  status: z.enum(myReflectionStatuses),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  questions: z.array(reflectionQuestionViewSchema.omit({ responseCount: true })),
  submission: z
    .object({ submittedAt: z.string(), answers: z.record(z.uuid(), z.string()) })
    .nullable(),
  /** Open, inside the window, not yet submitted. */
  canSubmit: z.boolean(),
});
export type MyReflection = z.infer<typeof myReflectionSchema>;

export const reflectionSubmitSchema = z.object({
  /** Question id to answer text; blank answers are left out. */
  answers: z.record(z.uuid(), z.string().max(5_000)),
});
export type ReflectionSubmit = z.infer<typeof reflectionSubmitSchema>;

/**
 * What delegates see: hidden while a draft, closed once closed or past the deadline, upcoming
 * before the opening time, open otherwise (a published activity without a window is open).
 */
export function reflectionWindowState(
  activity: {
    status: ReflectionStatus;
    opensAt: string | Date | null;
    closesAt: string | Date | null;
  },
  at: Date,
): 'hidden' | 'upcoming' | 'open' | 'closed' {
  if (activity.status === 'draft') return 'hidden';
  if (activity.status === 'closed') return 'closed';
  const opens = activity.opensAt ? new Date(activity.opensAt) : null;
  const closes = activity.closesAt ? new Date(activity.closesAt) : null;
  if (opens && at < opens) return 'upcoming';
  if (closes && at > closes) return 'closed';
  return 'open';
}
