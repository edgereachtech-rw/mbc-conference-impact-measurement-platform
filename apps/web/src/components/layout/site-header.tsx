import Link from 'next/link';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { IttecLogo, MbryanLogo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';
import { event } from '@/config/event';
import type { ShellSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface SiteHeaderProps {
  session: ShellSession | null;
}

/**
 * Top bar. Signed-in people (staff and delegates) get the corporate console bar; visitors the
 * event bar. Sign-out revokes the server session through the API (E3-3).
 */
export function SiteHeader({ session }: SiteHeaderProps) {
  if (session) return <ConsoleHeader session={session} />;
  return <EventHeader />;
}

/** Two-letter monogram for the avatar: initials of the first and last word of the name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
}

/**
 * Signed-in top bar in the M.Bryan corporate identity: the corporate logo on the left as the home
 * link of the area (console for staff, dashboard for delegates), the signed-in person with a
 * monogram and role on the right, then sign-out. No event branding.
 */
function ConsoleHeader({ session }: { session: ShellSession }) {
  const delegate = session.role === 'delegate';
  return (
    <header className="console-area sticky top-0 z-40 border-b border-white/10 bg-corp-ink font-corporate text-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-gutter md:h-16 md:px-6">
        <Link
          href={delegate ? '/account' : '/admin'}
          aria-label={delegate ? 'Delegate home' : 'Admin console home'}
          className="flex min-h-tap shrink-0 items-center gap-3 rounded-none"
        >
          <span className="flex h-9 items-center rounded-none bg-white px-2 md:h-10">
            <MbryanLogo priority className="h-7 md:h-8" />
          </span>
          <span className="hidden border-l border-white/20 pl-3 text-sm font-semibold text-white sm:inline">
            {delegate ? 'Delegate' : 'Admin console'}
          </span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-3 md:gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-none bg-corp-accent text-xs font-semibold tracking-wide text-corp-ink"
            >
              {initialsOf(session.displayName)}
            </span>
            <div className="hidden min-w-0 flex-col leading-tight min-[420px]:flex">
              <p className="max-w-[12rem] truncate text-sm font-semibold text-white md:max-w-xs">
                {session.displayName}
              </p>
              <span className="text-[0.65rem] font-semibold tracking-[0.14em] text-corp-accent uppercase">
                {session.role}
              </span>
            </div>
          </div>
          <SignOutButton
            variant="icon"
            className="text-white hover:bg-white/10 hover:text-white md:hidden"
          />
          <SignOutButton
            variant="text"
            className="hidden border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white md:inline-flex"
          />
        </div>
      </div>
    </header>
  );
}

/** Public top bar in the ITTEC event identity, for visitors who are not signed in. */
function EventHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-line bg-surface-raised shadow-card">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-gutter md:h-16 md:gap-4 md:px-6">
        <Link
          href="/"
          aria-label={`${event.shortName} home`}
          className="flex min-h-tap shrink-0 items-center rounded-sm"
        >
          <IttecLogo priority />
        </Link>
        <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
          <Link
            href="/signin"
            className={cn(buttonVariants({ variant: 'cta', size: 'sm' }), 'text-sm')}
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
