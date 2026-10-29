'use client';

import {
  BarChart3Icon,
  CalendarDaysIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  UploadIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Items without a screen yet are listed, disabled, so the information architecture is visible. */
  soon?: boolean;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: <LayoutDashboardIcon aria-hidden="true" /> },
  { href: '/admin/imports', label: 'Imports', icon: <UploadIcon aria-hidden="true" /> },
  {
    href: '/admin/events',
    label: 'Events',
    icon: <CalendarDaysIcon aria-hidden="true" />,
  },
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

/**
 * Console frame in the M.Bryan corporate identity: a fixed sidebar from `lg` up and a bottom tab
 * bar on phones, both driven by one navigation list. The frame never decides access: every
 * admin request is authorised by the API.
 */
export function AdminShell({ displayName, role, children }: AdminShellProps) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/admin' ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex flex-1 bg-corp-surface font-corporate text-corp-text">
      <aside
        className="hidden w-64 shrink-0 flex-col border-r border-corp-line bg-white lg:flex"
        aria-label="Sidebar"
      >
        <p className="border-b border-corp-line px-5 py-4 text-xs font-semibold tracking-[0.14em] text-corp-muted uppercase">
          Console
        </p>
        <nav className="flex-1 space-y-1 p-3" aria-label="Admin navigation">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>
        <div className="border-t border-corp-line px-5 py-4">
          <p className="truncate text-sm font-semibold text-corp-ink">{displayName}</p>
          <p className="text-xs tracking-[0.14em] text-corp-green-text uppercase">{role}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 pb-[calc(var(--spacing-tap)+1.5rem)] lg:pb-0">{children}</div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-corp-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Admin navigation"
      >
        {NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} compact />
        ))}
      </nav>
    </div>
  );
}

function NavLink({
  item,
  active,
  compact = false,
}: {
  item: NavItem;
  active: boolean;
  compact?: boolean;
}) {
  const base = compact
    ? 'flex min-h-tap flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.7rem] font-medium [&_svg]:size-5'
    : 'flex min-h-tap items-center gap-3 rounded-none px-3 text-sm font-medium [&_svg]:size-5';
  if (item.soon) {
    return (
      <span
        className={cn(base, 'cursor-not-allowed text-corp-muted/70')}
        aria-disabled="true"
        title="Coming soon"
      >
        {item.icon}
        <span>{item.label}</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        active
          ? 'bg-corp-green-soft text-corp-green-text'
          : 'text-corp-text hover:bg-corp-surface hover:text-corp-ink',
        compact && active && 'border-t-2 border-corp-green bg-transparent',
      )}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}
