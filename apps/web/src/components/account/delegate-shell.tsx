'use client';

import { CalendarDaysIcon, LayoutDashboardIcon, UserRoundIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

export const DELEGATE_NAV: NavItem[] = [
  { href: '/account', label: 'Dashboard', icon: <LayoutDashboardIcon aria-hidden="true" /> },
  { href: '/account/events', label: 'My events', icon: <CalendarDaysIcon aria-hidden="true" /> },
  { href: '/account/profile', label: 'Profile', icon: <UserRoundIcon aria-hidden="true" /> },
];

interface DelegateShellProps {
  displayName: string;
  email: string;
  children: ReactNode;
}

/**
 * Delegate frame in the M.Bryan corporate identity, the same frame as the admin console: a fixed
 * sidebar from `lg` up and a bottom tab bar on phones, both driven by one navigation list. The
 * frame never decides access: every request the screens make is authorised by the API.
 */
export function DelegateShell({ displayName, email, children }: DelegateShellProps) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/account' ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex flex-1 bg-corp-surface font-corporate text-corp-text">
      <aside
        className="hidden w-64 shrink-0 flex-col border-r border-corp-line bg-white lg:flex"
        aria-label="Sidebar"
      >
        <p className="border-b border-corp-line px-5 py-4 text-xs font-semibold tracking-[0.14em] text-corp-muted uppercase">
          Delegate
        </p>
        <nav className="flex-1 space-y-1 p-3" aria-label="Delegate navigation">
          {DELEGATE_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>
        <div className="border-t border-corp-line px-5 py-4">
          <p className="truncate text-sm font-semibold text-corp-ink">{displayName}</p>
          <p className="truncate text-xs text-corp-muted">{email}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 pb-[calc(var(--spacing-tap)+1.5rem)] lg:pb-0">{children}</div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-corp-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Delegate navigation"
      >
        {DELEGATE_NAV.map((item) => (
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
