import { z } from 'zod';

import { stageSummarySchema } from './assessments.js';
import { delegateListStatuses } from './delegates.js';
import {
  assessmentStages,
  assessmentStageStatuses,
  eventFormats,
  eventStatuses,
  stageWindowStates,
} from './events.js';

/**
 * The event dashboard (one call, admin only): the event's facts, its delegates, each assessment
 * stage with its response counts, and the messages sent. Everything is counted on the server;
 * the page shows what the API answers.
 */
export const eventDashboardSchema = z.object({
  event: z.object({
    id: z.uuid(),
    name: z.string(),
    code: z.string(),
    status: z.enum(eventStatuses),
    format: z.enum(eventFormats),
    startsOn: z.string(),
    endsOn: z.string(),
    timezone: z.string(),
    days: z.number().int(),
    sessions: z.number().int(),
  }),
  delegates: z.object({
    /** Registrations the platform serves (active, plus test where allowed). */
    registered: z.number().int(),
    /** Registered delegates with a platform account. */
    signedUp: z.number().int(),
    /** Registered delegates sent at least one invitation. */
    invited: z.number().int(),
    physical: z.number().int(),
    virtual: z.number().int(),
    /** Every registration status, whether served or not. */
    byStatus: z.record(z.enum(delegateListStatuses), z.number().int()),
  }),
  stages: z.array(
    z.object({
      stage: z.enum(assessmentStages),
      enabled: z.boolean(),
      status: z.enum(assessmentStageStatuses),
      opensAt: z.string().nullable(),
      closesAt: z.string().nullable(),
      /** What delegates see right now. */
      window: z.enum(stageWindowStates),
      questions: z.number().int(),
      /** Null for a disabled stage or one without questions. */
      summary: stageSummarySchema.omit({ statements: true }).nullable(),
      /** Registered delegates without a submitted response (0 when the summary is null). */
      nonCompleters: z.number().int(),
    }),
  ),
  messages: z.object({
    sent: z.number().int(),
    recipients: z.number().int(),
    delivered: z.number().int(),
    failed: z.number().int(),
    last: z.object({ subject: z.string(), createdAt: z.string(), status: z.string() }).nullable(),
  }),
  generatedAt: z.string(),
});
export type EventDashboard = z.infer<typeof eventDashboardSchema>;
