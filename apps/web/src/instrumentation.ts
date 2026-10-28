import * as Sentry from '@sentry/nextjs';

import { scrubEventPayload } from '@mbc/shared';

/**
 * Server-side Sentry for the Next.js app. Enabled only when SENTRY_DSN is set at runtime.
 * Every event is scrubbed (emails, names, tokens, cookies, query strings) before it leaves.
 * Release = SENTRY_RELEASE, else IMAGE_TAG (the git SHA from CI).
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE ?? process.env.IMAGE_TAG,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
    initialScope: { tags: { service: 'web' } },
    beforeSend: (event) => scrubEventPayload(event),
    beforeSendTransaction: () => null,
  });
}

export const onRequestError = Sentry.captureRequestError;
