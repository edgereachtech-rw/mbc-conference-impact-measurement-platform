import { z } from 'zod';

import { withoutBlankValues } from '../lib/env.js';

/**
 * Import feature settings (backlog D9 Files, D10 dependencies, OQ-22).
 *
 *   IMPORT_UPLOADS_ENABLED       kept for compatibility and ignored: uploads are always on by
 *                                the decision of 2026-10-31. Set it to "false" and uploads still
 *                                work, so remove it from your environment files rather than
 *                                relying on it.
 *   IMPORT_FILE_RETENTION_DAYS   the source-file retention period, if a policy has been approved.
 *                                Optional everywhere now; nothing refuses to start without it.
 *
 * Nothing gates an upload any more: neither the retention policy (OQ-22) nor the migration gate
 * (a durable `migration.identity_backfill` pass report). Both waivers are recorded against D9 and
 * D6.1 in docs/backlog.md.
 */
const schema = z.object({
  IMPORT_UPLOADS_ENABLED: z.enum(['true', 'false']).optional(),
  IMPORT_FILE_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  NODE_ENV: z.string().optional(),
});

export interface ImportConfig {
  /** Always true (decision of 2026-10-31). */
  uploadsEnabled: true;
  fileRetentionDays: number | null;
  production: boolean;
  /** Always false: the migration gate no longer holds uploads back. */
  requireMigrationGate: false;
}

export function importConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ImportConfig {
  const parsed = schema.safeParse(withoutBlankValues(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid import configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    uploadsEnabled: true,
    fileRetentionDays: e.IMPORT_FILE_RETENTION_DAYS ?? null,
    production: e.NODE_ENV === 'production',
    requireMigrationGate: false,
  };
}
