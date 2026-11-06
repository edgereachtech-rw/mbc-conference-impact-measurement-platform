import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { consoleButton } from '@/components/console/page';
import { consentGate } from '@/lib/consent-server';
import { deepLinkDestination, deepLinkPath, deepLinkTab } from '@/lib/deep-links';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Opening your event' };

/**
 * `/go/:eventId/:target`: the page behind the QR codes the organisers show in the room (task of
 * 2026-11-06). A delegate who is not signed in goes to sign-in and comes straight back here; the
 * page then sends them to the one section the code names (a daily reflection, an assessment,
 * their transfer plan), so nobody navigates the platform to reach it. Session feedback has its
 * own `/feedback/:code` link. The event page itself still decides what this delegate may see.
 */
export default async function DeepLinkPage({
  params,
}: {
  params: Promise<{ eventId: string; target: string }>;
}) {
  const { eventId, target } = await params;
  const eventOk = /^[0-9a-f-]{36}$/i.test(eventId);
  const tab = deepLinkTab(target);
  if (eventOk && tab) {
    const here = deepLinkPath(eventId, tab);
    const session = await getSession();
    if (!session) redirect(`/signin?next=${encodeURIComponent(here)}`);
    const gate = await consentGate(here);
    if (gate) redirect(gate);
    redirect(deepLinkDestination(eventId, tab));
  }

  return (
    <>
      <AdminPageHeader title="This code is not valid" />
      <AdminContent>
        <div role="alert" className="space-y-3 rounded-none border border-corp-line bg-white p-5">
          <p className="font-semibold text-corp-ink">This link does not point to a section.</p>
          <p className="text-sm text-corp-text">
            Scan the code again, or open your events and choose the section from there.
          </p>
          <Link href="/account/events" className={consoleButton({ variant: 'secondary' })}>
            My events
          </Link>
        </div>
      </AdminContent>
    </>
  );
}
