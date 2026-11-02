import { safeReturnPath } from '@mbc/shared';
import { redirect } from 'next/navigation';

import { MbryanLogo } from '@/components/brand/logo';
import { event } from '@/config/event';
import { apiInternalUrl } from '@/lib/api';
import { getSession } from '@/lib/session';

import { SignInForm } from './sign-in-form';

/** The email an invitation link stands for, or null when the link is unknown, used or expired. */
async function invitedEmail(token: string | undefined): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 256) return null;
  try {
    const res = await fetch(
      `${apiInternalUrl()}/api/v1/auth/invitations/${encodeURIComponent(token)}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const { email } = (await res.json()) as { email: string };
    return email;
  } catch {
    return null;
  }
}

export interface SignInState {
  safeNext?: string;
  initialEmail: string | null;
}

/**
 * What the sign-in panel needs, resolved on the server: someone already signed in never sees
 * the panel at all, and an invitation link is exchanged for the address it stands for. Kept
 * apart from the rendering so both routes share one copy of it.
 */
export async function resolveSignIn({
  next,
  invite,
}: {
  next?: string;
  invite?: string;
}): Promise<SignInState> {
  const session = await getSession();
  const safeNext = safeReturnPath(next);
  if (session) redirect(safeNext ?? '/account');
  return { safeNext, initialEmail: await invitedEmail(invite) };
}

/**
 * Signing in is the platform's front door (2026-11-02: the marketing landing page was removed,
 * and with it the bar above and the footer below). The page stands on its own: one card, one
 * thing to do, and the contact line it needs carried inside it. It is served both at `/` and at
 * `/signin`, so every link already sent out keeps working — invitation emails carry
 * `/signin?invite=`, and protected pages redirect with `?next=`.
 */
export function SignInPanel({ safeNext, initialEmail, invite }: SignInState & { invite?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-raised bg-[radial-gradient(ellipse_at_top,rgb(0_42_94/0.07),transparent_60%)] px-gutter py-10 md:px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-5 text-center">
          <a
            href={event.organiser.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${event.organiser.name} website (opens in a new tab)`}
            className="inline-flex min-h-tap items-center justify-center rounded-md"
          >
            <MbryanLogo priority className="h-16 w-auto md:h-20" />
          </a>
          <div className="space-y-2">
            <p className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase">
              Conference Impact Measurement Platform
            </p>
            <h1 className="text-h1">{initialEmail ? 'Activate your account' : 'Sign in'}</h1>
            <p className="text-base text-brand-muted">
              {initialEmail
                ? 'Your invitation is ready. Confirm your email below and we will send a one-time link and code.'
                : 'No password needed. We email a secure link and a one-time code to the address you registered with.'}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-brand-line bg-card p-5 shadow-card md:p-6">
          {invite && !initialEmail ? (
            <p className="mb-4 text-sm text-brand-muted" role="note">
              This invitation link is no longer valid. Sign in with the email address you registered
              with; a new link and code will be sent to it.
            </p>
          ) : null}
          <SignInForm
            next={safeNext}
            supportEmail={event.contactEmail}
            initialEmail={initialEmail ?? undefined}
          />
        </div>

        <div className="space-y-2 text-center text-xs text-brand-muted">
          <p>
            For registered delegates and the conference team. Nothing is created for an email that
            is not registered.
          </p>
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <a
              href={`mailto:${event.contactEmail}`}
              className="font-semibold text-corp-green-text hover:underline"
            >
              {event.contactEmail}
            </a>
            <span aria-hidden="true">·</span>
            <span>{event.copyright}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
