import { z } from 'zod';

/** Human-readable platform name. Event-specific names live in the database, not in code. */
export const APP_NAME = 'Conference Impact Measurement Platform';

/**
 * Placeholder schema proving the shared package wiring.
 * Real question, scoring and status schemas replace this in later increments.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export { isSensitiveKey, REDACTED, scrubEventPayload, scrubString, scrubValue } from './scrub.js';
export * from './schemas/auth.js';
export * from './schemas/imports.js';
export * from './schemas/imports-resolution.js';
export * from './schemas/my-events.js';
export * from './schemas/admin.js';
export * from './schemas/delegates.js';
export * from './schemas/messages.js';
export * from './message-body.js';
export * from './schemas/events.js';
export * from './schemas/assessments.js';
export * from './schemas/dashboard.js';
export * from './schemas/attendance.js';
