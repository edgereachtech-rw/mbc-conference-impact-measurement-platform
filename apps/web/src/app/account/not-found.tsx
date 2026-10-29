import Link from 'next/link';

import { consoleButton, PageContent, PageHeader, StatePanel } from '@/components/console/page';

/** 404 inside the delegate area, kept within the frame so the navigation stays available. */
export default function AccountNotFound() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/account' }, { label: 'Not found' }]}
        title="We could not find that"
        description="The link may be out of date, or it may point to an event you are not registered for."
      />
      <PageContent>
        <StatePanel
          kind="empty"
          title="Nothing to show here"
          description="Your events and registration details are all reachable from the dashboard."
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/account" className={consoleButton()}>
                Go to my dashboard
              </Link>
              <Link href="/account/events" className={consoleButton({ variant: 'secondary' })}>
                My events
              </Link>
            </div>
          }
        />
      </PageContent>
    </>
  );
}
