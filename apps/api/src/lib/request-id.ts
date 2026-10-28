import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Gives every request an id. An incoming X-Request-Id is honoured when it looks sane (so the
 * proxy or a client can correlate), otherwise a UUID is generated.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  // pino-http declares `id` on IncomingMessage; it is echoed in X-Request-Id and error bodies.
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function pathOnly(url: string | undefined): string {
  if (!url) return '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}
