'use client';

import {
  BarChart3Icon,
  CalendarDaysIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  UploadIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { ConsoleShell, type ConsoleNavItem } from '@/components/console/shell';

const NAV: ConsoleNavItem[] = [
  {
    href: '/admin',
    label: 'Overview',
    icon: <LayoutDashboardIcon aria-hidden="true" />,
    exact: true,
  },
  { href: '/admin/events', label: 'Events', icon: <CalendarDaysIcon aria-hidden="true" /> },
  { href: '/admin/imports', label: 'Imports', icon: <UploadIcon aria-hidden="true" /> },
  {
    href: '/admin/staff',
    label: 'Staff',
    icon: <ShieldCheckIcon aria-hidden="true" />,
    soon: true,
  },
  {
    href: '/admin/reports',
    label: 'Reports',
    icon: <BarChart3Icon aria-hidden="true" />,
    soon: true,
  },
];

interface AdminShellProps {
  displayName: string;
  role: string;
  children: ReactNode;
}

/** The staff console: the shared console frame with the admin navigation. */
export function AdminShell({ displayName, role, children }: AdminShellProps) {
  return (
    <ConsoleShell
      areaLabel="Admin console"
      navLabel="Admin navigation"
      nav={NAV}
      user={{ name: displayName, detail: role }}
    >
      {children}
    </ConsoleShell>
  );
}
