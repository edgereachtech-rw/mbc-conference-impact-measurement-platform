import { z } from 'zod';

import { participationModes } from './auth.js';

/**
 * My Events (backlog E3-10, D7, Increment 1c). The list shows the events linked to the caller's
 * identity through its own registrations; records of later epics (assessments, plans, follow-ups)
 * are added to `MyEvent` as they arrive. Attendance is only ever shown from an attendance record
 * (E6); until one exists it is "not recorded".
 */

export const myEventPeriods = ['upcoming', 'past'] as const;
export type MyEventPeriod = (typeof myEventPeriods)[number];

export const myEventSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  theme: z.string().nullable(),
  /** ISO dates (YYYY-MM-DD) in the event timezone. */
  startsOn: z.string(),
  endsOn: z.string(),
  timezone: z.string(),
  location: z.string().nullable(),
  format: z.enum(['physical', 'virtual', 'hybrid']),
  period: z.enum(myEventPeriods),
  /** The caller's own registration for this event. */
  registration: z.object({
    id: z.uuid(),
    status: z.enum(['valid', 'test']),
    attendanceFormat: z.enum(participationModes),
    capacity: z.enum(['individual', 'nominee', 'other']),
    organisation: z.string().nullable(),
    jobTitle: z.string().nullable(),
    country: z.string().nullable(),
    signedUpAt: z.string().nullable(),
  }),
  /** Attendance comes only from an attendance record (E6); none exist before Increment 3. */
  attendance: z.object({ status: z.literal('not_recorded') }),
});
export type MyEvent = z.infer<typeof myEventSchema>;

export const myEventsResponseSchema = z.object({ events: z.array(myEventSchema) });
export type MyEventsResponse = z.infer<typeof myEventsResponseSchema>;

export const myEventResponseSchema = z.object({ event: myEventSchema });
export type MyEventResponse = z.infer<typeof myEventResponseSchema>;
