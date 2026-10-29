'use client';

import { CalendarDaysIcon, LayoutDashboardIcon, UserRoundIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { ConsoleShell, type ConsoleNavItem } from '@/components/console/shell';

export const DELEGATE_NAV: ConsoleNavItem[] = [
  {
    href: '/account',
    label: 'Dashboard',
    icon: <LayoutDashboardIcon aria-hidden="true" />,
    exact: true,
  },
  { href: '/account/events', label: 'My events', icon: <CalendarDaysIcon aria-hidden="true" /> },
  { href: '/account/profile', label: 'Profile', icon: <UserRoundIcon aria-hidden="true" /> },
];

interface DelegateShellProps {
  displayName: string;
  email: string;
  children: ReactNode;
}

/** The delegate area: the shared console frame with the delegate navigation. */
export function DelegateShell({ displayName, email, children }: DelegateShellProps) {
  return (
    <ConsoleShell
      areaLabel="Delegate"
      navLabel="Delegate navigation"
      nav={DELEGATE_NAV}
      user={{ name: displayName, detail: email }}
    >
      {children}
    </ConsoleShell>
  );
}
