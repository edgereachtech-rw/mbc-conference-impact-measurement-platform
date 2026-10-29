import Link from 'next/link';

import { PageContainer } from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button';
import { event } from '@/config/event';

/** Branded 404 for any route or record that does not exist or is not the visitor's to see. */
export default function NotFound() {
  return (
    <PageContainer size="narrow" className="flex flex-1 flex-col justify-center gap-6">
      <div className="space-y-3">
        <p className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase">
          {event.shortName}
        </p>
        <h1 className="text-h1">We could not find that page</h1>
        <p className="max-w-prose text-base text-brand-muted">
          The link may be out of date, or the page may not be yours to see. Delegates find
          everything about their events from their dashboard.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/account" className={buttonVariants({ variant: 'cta' })}>
          Go to my dashboard
        </Link>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          Back to home
        </Link>
      </div>
      <p className="text-sm text-brand-muted">
        Need help? Write to{' '}
        <a
          href={`mailto:${event.contactEmail}`}
          className="font-medium text-brand-primary underline"
        >
          {event.contactEmail}
        </a>
        .
      </p>
    </PageContainer>
  );
}
