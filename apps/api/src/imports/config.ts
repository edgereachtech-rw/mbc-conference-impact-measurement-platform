import { z } from 'zod';

import { withoutBlankValues } from '../lib/env.js';

/**
 * Import feature settings (backlog D9 Files, D10 dependencies, OQ-22).
 *
 *   IMPORT_UPLOADS_ENABLED       "true" to accept uploads at all; default false (fail closed).
 *   IMPORT_FILE_RETENTION_DAYS   the approved source-file retention period. Production refuses
 *                                to enable uploads without it (temporary safeguard, OQ-22). The
 *                                original file is not retained by this increment at all, so the
 *                                value records the approved policy for the retention job to come.
 *
 * In production, uploads additionally require the migration gate (a durable
 * `migration.identity_backfill` pass report with no later unreported run), checked per request.
 */
const schema = z.object({
  IMPORT_UPLOADS_ENABLED: z.enum(['true', 'false']).optional(),
  IMPORT_FILE_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  NODE_ENV: z.string().optional(),
});

export interface ImportConfig {
  uploadsEnabled: boolean;
  fileRetentionDays: number | null;
  production: boolean;
  /** Whether the migration gate must have passed before an upload is accepted. */
  requireMigrationGate: boolean;
}

export function importConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ImportConfig {
  const parsed = schema.safeParse(withoutBlankValues(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid import configuration: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const uploadsEnabled = e.IMPORT_UPLOADS_ENABLED === 'true';
  if (production && uploadsEnabled && !e.IMPORT_FILE_RETENTION_DAYS) {
    throw new Error(
      'invalid import configuration: IMPORT_UPLOADS_ENABLED=true requires IMPORT_FILE_RETENTION_DAYS (approved retention policy, OQ-22) in production',
    );
  }
  return {
    uploadsEnabled,
    fileRetentionDays: e.IMPORT_FILE_RETENTION_DAYS ?? null,
    production,
    requireMigrationGate: production,
  };
}
