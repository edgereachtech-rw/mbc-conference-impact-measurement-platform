'use client';

import { RouteError } from '@/components/layout/route-states';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <RouteError reset={reset} home="/account" homeLabel="Go to my dashboard" />;
}
