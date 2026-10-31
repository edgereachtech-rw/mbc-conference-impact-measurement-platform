import { z } from 'zod';

import { sessionTypes } from './events.js';

/**
 * Session feedback (task of 2026-10-31): a questionnaire per session, reached by the session's
 * link or QR code, answered after the session by delegates recorded as attending it. One
 * response per delegate, updatable; the dashboard counts the latest. Separate from the daily
 * reflections, the Transfer Plan, the assessment stages and attendance (which it never creates).
 */

export const feedbackRatings = ['excellent', 'good', 'fair', 'poor'] as const;
export type FeedbackRating = (typeof feedbackRatings)[number];
export const feedbackRatingLabels: Record<FeedbackRating, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

export const feedbackQuestionTypes = ['rating', 'long_text'] as const;
export type FeedbackQuestionType = (typeof feedbackQuestionTypes)[number];
export const feedbackQuestionTypeLabels: Record<FeedbackQuestionType, string> = {
  rating: 'Rating (Excellent to Poor)',
  long_text: 'Written answer',
};

/** The default questionnaire a session gets when feedback is enabled (agreed wording). */
export const DEFAULT_FEEDBACK_QUESTIONS: ReadonlyArray<{
  prompt: string;
  type: FeedbackQuestionType;
  required: boolean;
}> = [
  {
    prompt: 'How would you rate the relevance of this session to your work?',
    type: 'rating',
    required: true,
  },
  {
    prompt: 'How would you rate the clarity and quality of the session delivery?',
    type: 'rating',
    required: true,
  },
  {
    prompt: 'How would you rate the practical usefulness of the session?',
    type: 'rating',
    required: true,
  },
  { prompt: 'What was your main takeaway from this session?', type: 'long_text', required: false },
  { prompt: 'What could be improved about this session?', type: 'long_text', required: false },
];

/** The encouraged completion window after a session, in minutes; never a hard deadline. */
export const FEEDBACK_ENCOURAGED_MINUTES = 5;

// ------------------------------------------------------------------ commands

const isoInstant = z.iso.datetime({ offset: true });

export const feedbackSettingsSchema = z.object({
  enabled: z.boolean(),
  /** The configured deadline; null keeps the form open until the organisers close it. */
  closesAt: isoInstant.nullable().optional(),
});
export type FeedbackSettings = z.infer<typeof feedbackSettingsSchema>;

export const feedbackQuestionFieldsSchema = z.object({
  prompt: z.string().trim().min(1, 'Write the question').max(500),
  type: z.enum(feedbackQuestionTypes).default('rating'),
  required: z.boolean().default(true),
});
export const feedbackQuestionPatchSchema = feedbackQuestionFieldsSchema.partial();
export const feedbackQuestionOrderSchema = z.object({
  questionIds: z.array(z.uuid()).min(1).max(50),
});

export const feedbackSubmitSchema = z.object({
  /** Question id to a rating code or written text; blank written answers are left out. */
  answers: z.record(z.uuid(), z.string().max(5_000)),
});
export type FeedbackSubmit = z.infer<typeof feedbackSubmitSchema>;

// ------------------------------------------------------------------ views

export const feedbackQuestionViewSchema = z.object({
  id: z.uuid(),
  questionKey: z.uuid(),
  version: z.number().int(),
  order: z.number().int(),
  prompt: z.string(),
  type: z.enum(feedbackQuestionTypes),
  required: z.boolean(),
  responseCount: z.number().int(),
});
export type FeedbackQuestionView = z.infer<typeof feedbackQuestionViewSchema>;

export const feedbackSessionViewSchema = z.object({
  id: z.uuid(),
  eventDateId: z.uuid(),
  date: z.string(),
  title: z.string(),
  sessionType: z.enum(sessionTypes),
  startTime: z.string(),
  endTime: z.string(),
  speaker: z.string().nullable(),
  enabled: z.boolean(),
  /** The code in the link and QR; null until feedback is enabled. */
  code: z.string().nullable(),
  /** The delegate-facing path, /feedback/{code}; null until enabled. */
  path: z.string().nullable(),
  openedAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** What delegates see right now. */
  window: z.enum(['disabled', 'open', 'closed']),
  questions: z.array(feedbackQuestionViewSchema),
  /** Delegates recorded as attending the session. */
  attended: z.number().int(),
  /** Delegates with a response (latest counts once). */
  submitted: z.number().int(),
});
export type FeedbackSessionView = z.infer<typeof feedbackSessionViewSchema>;

export const ratingDistributionSchema = z.object({
  questionId: z.uuid(),
  prompt: z.string(),
  total: z.number().int(),
  ratings: z.array(
    z.object({
      rating: z.enum(feedbackRatings),
      count: z.number().int(),
      /** count ÷ total × 100, one decimal; 0 when nobody answered. */
      percent: z.number(),
    }),
  ),
});
export type RatingDistribution = z.infer<typeof ratingDistributionSchema>;

export const feedbackDashboardSchema = z.object({
  event: z.object({ id: z.uuid(), name: z.string() }),
  session: feedbackSessionViewSchema,
  distributions: z.array(ratingDistributionSchema),
  written: z.array(
    z.object({
      questionId: z.uuid(),
      prompt: z.string(),
      responses: z.array(
        z.object({
          /** Null in the anonymised (speaker-facing) view. */
          delegate: z.object({ id: z.uuid(), name: z.string() }).nullable(),
          value: z.string(),
          submittedAt: z.string(),
        }),
      ),
    }),
  ),
  /** True when delegate identities were left out (for sharing with the speaker). */
  anonymised: z.boolean(),
  generatedAt: z.string(),
});
export type FeedbackDashboard = z.infer<typeof feedbackDashboardSchema>;

/** The delegate's view of one session's feedback, reached through the link or QR code. */
export const myFeedbackSchema = z.object({
  session: z.object({
    id: z.uuid(),
    eventId: z.uuid(),
    eventName: z.string(),
    date: z.string(),
    title: z.string(),
    speaker: z.string().nullable(),
    startTime: z.string(),
    endTime: z.string(),
    timezone: z.string(),
  }),
  window: z.enum(['open', 'closed']),
  openedAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** Recorded as attending this session; required to submit. */
  attended: z.boolean(),
  questions: z.array(feedbackQuestionViewSchema.omit({ responseCount: true })),
  response: z
    .object({
      submittedAt: z.string(),
      updatedAt: z.string(),
      revision: z.number().int(),
      answers: z.record(z.uuid(), z.string()),
    })
    .nullable(),
  canSubmit: z.boolean(),
});
export type MyFeedback = z.infer<typeof myFeedbackSchema>;

/** The delegate's sessions with feedback, for the event page list. */
export const myFeedbackListItemSchema = z.object({
  sessionId: z.uuid(),
  code: z.string(),
  path: z.string(),
  date: z.string(),
  title: z.string(),
  speaker: z.string().nullable(),
  window: z.enum(['open', 'closed']),
  attended: z.boolean(),
  submittedAt: z.string().nullable(),
});
export type MyFeedbackListItem = z.infer<typeof myFeedbackListItemSchema>;

// ------------------------------------------------------------------ helpers

/** Count and percentage per rating over the valid answers to one question; safe when empty. */
export function ratingDistribution(values: readonly string[]): {
  total: number;
  ratings: Array<{ rating: FeedbackRating; count: number; percent: number }>;
} {
  const valid = values.filter((v): v is FeedbackRating =>
    (feedbackRatings as readonly string[]).includes(v),
  );
  const total = valid.length;
  return {
    total,
    ratings: feedbackRatings.map((rating) => {
      const count = valid.filter((v) => v === rating).length;
      return { rating, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 };
    }),
  };
}

/** Open while enabled and before the deadline; the five minutes are encouragement only. */
export function feedbackWindowState(
  session: { enabled: boolean; closesAt: string | Date | null },
  at: Date,
): 'disabled' | 'open' | 'closed' {
  if (!session.enabled) return 'disabled';
  if (session.closesAt && at > new Date(session.closesAt)) return 'closed';
  return 'open';
}
