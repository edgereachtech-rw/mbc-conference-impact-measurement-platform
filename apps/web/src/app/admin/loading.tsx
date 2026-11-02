import { RouteLoading } from '@/components/layout/route-states';

/** Shown while a console page is being rendered; the frame and navigation stay in place. */
export default function Loading() {
  return <RouteLoading label="Loading the console…" />;
}
