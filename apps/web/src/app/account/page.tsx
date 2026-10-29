import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ComingSoon } from '@/components/coming-soon';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  // The page itself is still a placeholder; it is gated so the sign-in flow has a destination.
  const session = await getSession();
  if (!session) redirect('/signin?next=/account');

  return (
    <ComingSoon
      title={`Welcome, ${session.displayName}`}
      description="Your profile, participation mode, reminder preferences and progress through the programme."
    />
  );
}
