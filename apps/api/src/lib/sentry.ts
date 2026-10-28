import { scrubEventPayload } from '@mbc/shared';
import * as Sentry from '@sentry/node';

export type SentryService = 'api' | 'worker';

/**
 * Initialises Sentry only when SENTRY_DSN is set. Without a DSN nothing is loaded or sent.
 * Every event passes through the shared scrubber (emails, names, tokens, cookies, query strings
 * removed; user reduced to an id). Release = SENTRY_RELEASE, else IMAGE_TAG (the git SHA in CI).
 */
export function initSentry(service: SentryService): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE ?? process.env.IMAGE_TAG ?? undefined,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    initialScope: { tags: { service } },
    beforeSend: (event) => scrubEventPayload(event),
    beforeSendTransaction: () => null,
  });
  return true;
}

export function captureException(error: unknown, context?: { requestId?: string }): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(
    error,
    context?.requestId ? { tags: { requestId: context.requestId } } : undefined,
  );
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  await Sentry.flush(timeoutMs);
}
