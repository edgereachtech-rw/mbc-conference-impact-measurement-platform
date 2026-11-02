import { RouteLoading } from '@/components/layout/route-states';

/** Shown while any top-level page is being rendered on the server. */
export default function Loading() {
  return <RouteLoading />;
}
