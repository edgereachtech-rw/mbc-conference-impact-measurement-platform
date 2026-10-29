'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ConsoleNavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Match the path exactly (the area's home) instead of by prefix. */
  exact?: boolean;
  /** Items without a screen yet are listed, disabled, so the information architecture is visible. */
  soon?: boolean;
}

interface ConsoleShellProps {
  /** Short name of the area, shown above the navigation: "Admin console", "Delegate". */
  areaLabel: string;
  /** Accessible name of both navigation landmarks. */
  navLabel: string;
  nav: ConsoleNavItem[];
  user: { name: string; detail: string };
  children: ReactNode;
}

/**
 * The console frame shared by staff and delegates: a navy sidebar that stays put under the top
 * bar while the page scrolls (from `lg` up) and a bottom tab bar on phones, both driven by one
 * navigation list. The frame never decides access: every request the screens make is authorised
 * by the API.
 */
export function ConsoleShell({ areaLabel, navLabel, nav, user, children }: ConsoleShellProps) {
  const pathname = usePathname();
  const isActive = (item: ConsoleNavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="console-area flex flex-1 items-start bg-corp-surface font-corporate text-corp-text">
      <aside
        className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 flex-col overflow-hidden bg-corp-ink text-white md:top-16 md:h-[calc(100dvh-4rem)] lg:flex"
        aria-label="Sidebar"
      >
        <p className="border-b border-white/10 px-5 py-4 text-xs font-semibold tracking-[0.14em] text-corp-accent uppercase">
          {areaLabel}
        </p>
        <nav className="flex-1 space-y-1 p-3" aria-label={navLabel}>
          {nav.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item)} />
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-sm font-semibold text-white">{user.name}</p>
          <p className="truncate text-xs text-white/60">{user.detail}</p>
        </div>
      </aside>

      <div className="flex min-h-full min-w-0 flex-1 flex-col self-stretch">
        <div className="flex-1 pb-[calc(var(--spacing-tap)+1.5rem)] lg:pb-0">{children}</div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-corp-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        aria-label={navLabel}
      >
        {nav.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item)} compact />
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
  item: ConsoleNavItem;
  active: boolean;
  compact?: boolean;
}) {
  if (compact) {
    const base =
      'flex min-h-tap flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.7rem] font-medium [&_svg]:size-5';
    if (item.soon) {
      return (
        <span className={cn(base, 'cursor-not-allowed text-corp-muted/70')} aria-disabled="true">
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
            ? 'border-t-2 border-corp-accent text-corp-ink'
            : 'text-corp-muted hover:text-corp-ink',
        )}
      >
        {item.icon}
        <span>{item.label}</span>
      </Link>
    );
  }
  const base =
    'flex min-h-tap items-center gap-3 rounded-none border-l-4 px-3 text-sm font-medium [&_svg]:size-5';
  if (item.soon) {
    return (
      <span
        className={cn(base, 'cursor-not-allowed border-transparent text-white/40')}
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
          ? 'border-corp-accent bg-white/10 text-corp-accent'
          : 'border-transparent text-white/80 hover:bg-white/5 hover:text-white',
      )}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}
