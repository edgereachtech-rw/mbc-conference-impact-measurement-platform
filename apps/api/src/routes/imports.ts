import {
  IMPORT_MAX_FILE_BYTES,
  importPreviewRequestSchema,
  importResolutionRequestSchema,
  importRowOutcomes,
  importSourceSchema,
  type ImportPreviewRequest,
  type ImportResolutionRequest,
} from '@mbc/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { clientOf, principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { canRunImports, IMPORT_ROLES } from '../auth/policies.js';
import type { ConflictResolver } from '../imports/resolution.js';
import type { ImportService } from '../imports/service.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';

interface Deps {
  imports: ImportService;
  resolver: ConflictResolver;
  middleware: ReturnType<typeof createAuthMiddleware>;
}

const SPLIT_HINT = 'Split the export into smaller files and import each one.';

/** Memory upload with the decided size limit; the parser applies the row limit and type rules. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1, fields: 5 },
});

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new HttpError(
            413,
            'file_too_large',
            `The file is larger than ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB. ${SPLIT_HINT}`,
          ),
        );
        return;
      }
      next(new HttpError(422, 'upload_invalid', 'Send one file in the "file" field.'));
      return;
    }
    next(error);
  });
}

/**
 * Registration imports (E2-1, E2-8 to E2-11). Every route is M.Bryan-admin-only (D9): the role
 * check runs before the body is read, and the policy is checked again in each handler.
 */
export function importRouter({ imports, resolver, middleware }: Deps): Router {
  const router = Router();
  const adminOnly = middleware.requireRole(...IMPORT_ROLES);
  const assertPolicy = (res: Response) => {
    const principal = principalOf(res);
    if (!canRunImports(principal)) throw new HttpError(403, 'forbidden', 'Admins only.');
    return principal;
  };

  router.get('/imports/status', adminOnly, async (_req, res) => {
    assertPolicy(res);
    res.json(await imports.featureState());
  });

  router.post('/events/:eventId/imports', adminOnly, uploadSingle, async (req, res) => {
    const principal = assertPolicy(res);
    const source = importSourceSchema.safeParse((req.body as { source?: unknown })?.source);
    if (!source.success) {
      throw new HttpError(422, 'validation_failed', 'source: choose the registration source.');
    }
    const file = req.file;
    if (!file) throw new HttpError(422, 'upload_invalid', 'Send the file in the "file" field.');
    const result = await imports.createRun({
      eventId: String(req.params.eventId),
      actor: { userId: principal.userId },
      client: clientOf(res),
      source: source.data,
      fileName: file.originalname,
      bytes: file.buffer,
    });
    res.status(201).json(result);
  });

  router.post(
    '/imports/:runId/preview',
    adminOnly,
    validate(importPreviewRequestSchema),
    async (req, res) => {
      const principal = assertPolicy(res);
      const result = await imports.preview(
        String(req.params.runId),
        { userId: principal.userId },
        clientOf(res),
        req.body as ImportPreviewRequest,
      );
      res.json(result);
    },
  );

  router.post('/imports/:runId/confirm', adminOnly, async (req, res) => {
    const principal = assertPolicy(res);
    const result = await imports.confirm(
      String(req.params.runId),
      { userId: principal.userId },
      clientOf(res),
    );
    res.json(result);
  });

  router.post('/imports/:runId/discard', adminOnly, async (req, res) => {
    const principal = assertPolicy(res);
    await imports.discard(String(req.params.runId), { userId: principal.userId }, clientOf(res));
    res.status(204).end();
  });

  router.get('/events/:eventId/imports', adminOnly, async (req, res) => {
    assertPolicy(res);
    res.json({ runs: await imports.listRuns(String(req.params.eventId)) });
  });

  // Conflict resolution (D5): one decision per quarantined row, validated and applied on the server.
  router.post(
    '/imports/rows/:rowId/resolve',
    adminOnly,
    validate(importResolutionRequestSchema),
    async (req, res) => {
      const principal = assertPolicy(res);
      const result = await resolver.resolve(
        String(req.params.rowId),
        req.body as ImportResolutionRequest,
        { userId: principal.userId },
        clientOf(res),
      );
      res.json(result);
    },
  );

  router.get('/events/:eventId/imports/conflicts', adminOnly, async (req, res) => {
    assertPolicy(res);
    res.json({ conflicts: await imports.conflicts(String(req.params.eventId)) });
  });

  router.get('/imports/:runId', adminOnly, async (req, res) => {
    assertPolicy(res);
    const outcome = typeof req.query.outcome === 'string' ? req.query.outcome : undefined;
    if (outcome && !(importRowOutcomes as readonly string[]).includes(outcome)) {
      throw new HttpError(422, 'validation_failed', 'outcome: unknown value.');
    }
    res.json(await imports.getRun(String(req.params.runId), outcome));
  });

  router.get('/imports/:runId/report.csv', adminOnly, async (req, res) => {
    const principal = assertPolicy(res);
    const { fileName, csv } = await imports.reportCsv(
      String(req.params.runId),
      { userId: principal.userId },
      clientOf(res),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  });

  return router;
}
