import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { getSession } from '@/lib/session';

/**
 * Every `/admin/*` screen sits in the console frame. Anonymous visitors go to sign-in and
 * delegates to their own home; the API still authorises each request the screens make.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/signin?next=/admin');
  if (session.role === 'delegate') redirect('/account');
  return (
    <AdminShell displayName={session.displayName} role={session.role}>
      {children}
    </AdminShell>
  );
}
