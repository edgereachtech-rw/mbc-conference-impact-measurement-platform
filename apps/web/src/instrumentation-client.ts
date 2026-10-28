import * as Sentry from '@sentry/nextjs';

import { scrubEventPayload } from '@mbc/shared';

/**
 * Browser-side Sentry. NEXT_PUBLIC_SENTRY_DSN is inlined at build time, so it must be passed as
 * a build argument when the web image is built; without it nothing is initialised or sent.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: (event) => scrubEventPayload(event),
    beforeSendTransaction: () => null,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
