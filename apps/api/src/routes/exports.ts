import { safeFileName, workbookRequestSchema } from '@mbc/shared';
import { Router } from 'express';

import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { REPORT_ROLES } from '../auth/policies.js';
import { MEDIA_TYPES, toXlsx } from '../export/xlsx.js';
import { HttpError } from '../lib/errors.js';
import { organiserName } from '../mail/branding.js';
import { validate } from '../lib/validate.js';

interface Deps {
  middleware: ReturnType<typeof createAuthMiddleware>;
}

/**
 * Spreadsheet formatting for the two admin tables that are built in the browser (task of
 * 2026-11-02): the transfer-plan list and the measures-and-evidence report. The browser posts the
 * rows it is already showing and gets an .xlsx back.
 *
 * This route reads and writes nothing: it cannot disclose a record the caller was not already
 * served, and there is nothing to audit beyond the request that produced the data, which its own
 * route audited. It is admin-only regardless, and the shared schema bounds the size of the file a
 * request can ask for.
 */
export function exportsRouter({ middleware }: Deps): Router {
  const router = Router();

  router.post(
    '/exports/workbook',
    middleware.requireRole(...REPORT_ROLES),
    validate(workbookRequestSchema),
    async (req, res) => {
      const principal = principalOf(res);
      if (!REPORT_ROLES.includes(principal.role)) {
        throw new HttpError(403, 'forbidden', 'Admins only.');
      }
      const { filename, title, sheets } = req.body;
      const file = await toXlsx(sheets, { title, organiser: organiserName() });
      res.setHeader('Content-Type', MEDIA_TYPES.xlsx);
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileName(filename)}.xlsx"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(file);
    },
  );

  return router;
}
