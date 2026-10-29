import Link from 'next/link';

import { consoleButton, PageContent, PageHeader, StatePanel } from '@/components/console/page';

/** 404 inside the console, kept within the frame so the navigation stays available. */
export default function AdminNotFound() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Overview', href: '/admin' }, { label: 'Not found' }]}
        title="We could not find that"
        description="The link may be out of date, or the record may have been removed."
      />
      <PageContent>
        <StatePanel
          kind="empty"
          title="Nothing to show here"
          description="Events, registrations and imports are all reachable from the overview."
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/admin" className={consoleButton()}>
                Go to the overview
              </Link>
              <Link href="/admin/events" className={consoleButton({ variant: 'secondary' })}>
                Events
              </Link>
            </div>
          }
        />
      </PageContent>
    </>
  );
}
