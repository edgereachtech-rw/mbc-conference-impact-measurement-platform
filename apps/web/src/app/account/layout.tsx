import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { DelegateShell } from '@/components/account/delegate-shell';
import { consentGate } from '@/lib/consent-server';
import { getSession } from '@/lib/session';

/**
 * Every `/account/*` screen sits in the delegate frame (Dashboard, My events, Profile). Anonymous
 * visitors go to sign-in and staff to the console; the API still authorises each request the
 * screens make.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/signin?next=/account');
  if (session.role !== 'delegate') redirect('/admin');
  // Nothing of theirs opens until they have read the privacy notice (E3-7, section 6.4).
  const gate = await consentGate('/account');
  if (gate) redirect(gate);
  return (
    <DelegateShell displayName={session.displayName} email={session.user.email}>
      {children}
    </DelegateShell>
  );
}
