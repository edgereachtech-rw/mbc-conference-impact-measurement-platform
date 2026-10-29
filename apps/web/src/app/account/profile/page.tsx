import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ProfilePanel } from '@/components/account/profile-panel';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { event } from '@/config/event';
import { loadMyEvents } from '@/lib/my-events-server';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Profile' };

/**
 * `/account/profile`: who the platform knows the delegate as, and each registration's details.
 * Read-only: corrections go through the organisers (backlog E2-4, E3-4), never self-service.
 */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/signin?next=/account/profile');
  const initialEvents = await loadMyEvents();
  return (
    <>
      <AdminPageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/account' }, { label: 'Profile' }]}
        title="Profile"
        description="Your account and the details of each registration, as the organisers hold them."
      />
      <AdminContent>
        <ProfilePanel
          displayName={session.displayName}
          email={session.user.email}
          initialEvents={initialEvents}
          contactEmail={event.contactEmail}
        />
      </AdminContent>
    </>
  );
}
