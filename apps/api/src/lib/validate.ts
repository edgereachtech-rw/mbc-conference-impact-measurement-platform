import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

import { HttpError } from './errors.js';

/**
 * Validates req.body with a shared Zod schema. The parsed value replaces req.body so handlers
 * only ever see normalised data (trimmed, lower-cased emails, ...). Invalid input becomes
 * 422 validation_failed with the issue paths in the message, never a stack trace.
 */
export function validate<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const detail = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      next(new HttpError(422, 'validation_failed', detail));
      return;
    }
    req.body = result.data;
    next();
  };
}
