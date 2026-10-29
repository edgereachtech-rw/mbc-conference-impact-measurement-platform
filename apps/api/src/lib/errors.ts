import { scrubString } from '@mbc/shared';
import type { ErrorRequestHandler, Request, Response } from 'express';

import { pathOnly } from './request-id.js';

/** Error with an HTTP status and a stable machine-readable code; message is safe to show. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** 429 with the seconds after which the client may retry (sent as Retry-After). */
export class RateLimitError extends HttpError {
  constructor(
    public readonly retryAfterSeconds: number,
    message = 'Too many attempts. Try again later.',
  ) {
    super(429, 'rate_limited', message);
    this.name = 'RateLimitError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

const bodyParserCodes: Record<string, string> = {
  'entity.parse.failed': 'invalid_json',
  'entity.too.large': 'payload_too_large',
  'encoding.unsupported': 'unsupported_encoding',
  'charset.unsupported': 'unsupported_charset',
  'entity.verify.failed': 'invalid_body',
};

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation_failed';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'request_failed';
  }
}

function requestIdOf(req: Request): string {
  return typeof req.id === 'string' ? req.id : String(req.id ?? '');
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ErrorBody = {
    error: {
      code: 'not_found',
      message: `No route for ${req.method} ${pathOnly(req.originalUrl)}`,
      requestId: requestIdOf(req),
    },
  };
  res.status(404).json(body);
}

export interface ErrorHandlerOptions {
  /** Forwards 5xx errors to error tracking (Sentry) when configured. */
  captureException?: (error: unknown, context: { requestId: string }) => void;
  /** Defaults to NODE_ENV === "production": hides internal messages from clients. */
  production?: boolean;
}

/**
 * Central error handler: always JSON `{ error: { code, message, requestId } }`, never a stack
 * trace. 5xx are logged at error level with the request id and sent to error tracking; 4xx are
 * logged at warn level. Internal messages are replaced by a generic one in production.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const production = options.production ?? process.env.NODE_ENV === 'production';

  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const e = (err ?? {}) as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      type?: unknown;
      expose?: unknown;
      message?: unknown;
      retryAfterSeconds?: unknown;
    };
    const rawStatus =
      typeof e.status === 'number'
        ? e.status
        : typeof e.statusCode === 'number'
          ? e.statusCode
          : 500;
    const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    const requestId = requestIdOf(req);
    const isServerError = status >= 500;

    let code = codeForStatus(status);
    if (typeof e.type === 'string' && bodyParserCodes[e.type]) code = bodyParserCodes[e.type]!;
    else if (err instanceof HttpError) code = err.code;

    let message: string;
    if (isServerError) {
      message = production
        ? 'Something went wrong on our side. Quote the request id when asking for help.'
        : scrubString(typeof e.message === 'string' ? e.message : 'Internal error');
    } else {
      const exposable = e.expose !== false && typeof e.message === 'string' && e.message.length > 0;
      message = exposable
        ? scrubString(e.message as string)
        : 'The request could not be processed.';
    }

    const log = req.log ?? undefined;
    if (isServerError) {
      log?.error({ err, requestId, status }, 'request failed');
      options.captureException?.(err, { requestId });
    } else {
      log?.warn({ requestId, status, code }, 'request rejected');
    }

    if (typeof e.retryAfterSeconds === 'number' && e.retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(Math.ceil(e.retryAfterSeconds)));
    }
    const body: ErrorBody = { error: { code, message, requestId } };
    res.status(status).json(body);
  };
}
