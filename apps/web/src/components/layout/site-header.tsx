import Link from 'next/link';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { ParticipationBadge } from '@/components/badges/participation-badge';
import { IttecLogo, MbryanLogo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';
import { event } from '@/config/event';
import type { ShellSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface SiteHeaderProps {
  session: ShellSession | null;
}

/**
 * Compact app header: ITTEC logo, delegate slot, M.Bryan logo.
 * Sign-out revokes the server session through the API (E3-3).
 */
export function SiteHeader({ session }: SiteHeaderProps) {
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
          {session ? (
            <>
              <div className="flex min-w-0 flex-col items-end gap-0.5">
                <p className="hidden max-w-[10rem] truncate text-sm leading-tight font-medium text-brand-primary min-[420px]:block md:max-w-xs">
                  {session.displayName}
                </p>
                {session.participationMode ? (
                  <ParticipationBadge mode={session.participationMode} />
                ) : session.role !== 'delegate' ? (
                  <span className="rounded-full bg-corp-ink px-2 py-0.5 font-corporate text-[0.65rem] font-semibold tracking-[0.14em] text-white uppercase">
                    {session.role}
                  </span>
                ) : null}
              </div>
              <SignOutButton variant="icon" className="md:hidden" />
              <SignOutButton variant="text" className="hidden md:inline-flex" />
            </>
          ) : (
            <Link
              href="/signin"
              className={cn(buttonVariants({ variant: 'cta', size: 'sm' }), 'text-sm')}
            >
              Sign in
            </Link>
          )}

          <a
            href={event.organiser.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${event.organiser.name} website (opens in a new tab)`}
            className="flex min-h-tap shrink-0 items-center rounded-sm"
          >
            <MbryanLogo />
          </a>
        </div>
      </div>
    </header>
  );
}
