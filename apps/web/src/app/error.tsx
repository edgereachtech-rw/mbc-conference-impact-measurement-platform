'use client';

import { RouteError } from '@/components/layout/route-states';

/** Any page that fails to render lands here rather than on Next's unbranded error page. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <RouteError reset={reset} home="/signin" homeLabel="Go to sign-in" />;
}
