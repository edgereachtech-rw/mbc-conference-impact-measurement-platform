import { safeReturnPath } from '@mbc/shared';
import { CheckCircle2Icon } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MbryanLogoOnDark } from '@/components/brand/logo';
import { platform } from '@/config/platform';
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

/** What the platform is for, said once, on the panel beside the form. */
const WHAT_IT_DOES = [
  'Record what you want to get out of the conference, before it starts.',
  'Check in each day, give session feedback and build your transfer plan.',
  'Follow up at 30, 60,  90 and beyond days on what you have been able to apply.',
];

/**
 * Signing in is the platform's front door (2026-11-02: the marketing landing page was removed,
 * and with it the bar above and the footer below). Served both at `/` and at `/signin`, so every
 * link already sent out keeps working — invitation emails carry `/signin?invite=`, and protected
 * pages redirect with `?next=`.
 *
 * Two sides from `lg` up (redesigned 2026-11-03): the navy panel carries the brand and what the
 * platform is for, and the white side carries nothing but the sign-in. Below `lg` the navy panel
 * becomes a short band above the form rather than a screen of its own, so a delegate on a phone
 * reaches the one thing there is to do without scrolling past an advert.
 */
export function SignInPanel({ safeNext, initialEmail, invite }: SignInState & { invite?: string }) {
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      {/* ---------------------------------------------------------------- brand */}
      <aside className="flex flex-col justify-between bg-brand-primary bg-[radial-gradient(ellipse_at_top_left,rgb(255_255_255/0.10),transparent_55%)] px-gutter py-6 text-white md:px-10 lg:py-12 xl:px-16">
        <a
          href={platform.company.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${platform.company.name} website (opens in a new tab)`}
          className="inline-flex min-h-tap w-fit items-center rounded-md"
        >
          <MbryanLogoOnDark priority className="h-12 w-auto md:h-14" />
        </a>

        <div className="mt-6 max-w-md lg:mt-0">
          <p className="font-display text-eyebrow tracking-[0.14em] text-brand-accent uppercase">
            {platform.shortName}
          </p>
          <h2 className="mt-3 font-display text-2xl leading-tight font-semibold text-white md:text-3xl xl:text-4xl">
            The true value of learning is what changes afterwards.
          </h2>
          {/* Hidden below `lg`: with it, the band pushed the form off a 360px screen, and the
              form is the only thing a delegate came here to do. */}
          <ul className="mt-6 hidden space-y-3 lg:block">
            {WHAT_IT_DOES.map((line) => (
              <li key={line} className="flex gap-3 text-sm text-white/85 md:text-base">
                <CheckCircle2Icon
                  className="mt-0.5 size-5 shrink-0 text-brand-accent"
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-8 hidden text-xs text-white/60 lg:mt-0 lg:block">
          {platform.company.name} · {platform.copyright}
        </p>
      </aside>

      {/* ---------------------------------------------------------------- sign in */}
      {/* A div, not a main: the root layout owns the one main landmark the skip link targets. */}
      <div className="flex flex-1 flex-col justify-center bg-surface-raised px-gutter py-10 md:px-10 xl:px-16">
        <div className="mx-auto w-full max-w-md space-y-6">
          <div className="space-y-2">
            <h1 className="text-h1">{initialEmail ? 'Activate your account' : 'Sign in'}</h1>
            <p className="text-base text-brand-muted">
              {initialEmail
                ? 'Your invitation is ready. Confirm your email below and we will send a one-time link and code.'
                : 'No password needed. We email a secure link and a one-time code to the email address you registered with.'}
            </p>
          </div>

          <div className="rounded-lg border border-brand-line bg-card p-5 shadow-card md:p-6">
            {invite && !initialEmail ? (
              <p className="mb-4 text-sm text-brand-muted" role="note">
                This invitation link is no longer valid. Sign in with the email address you
                registered with; a new link and code will be sent to it.
              </p>
            ) : null}
            <SignInForm
              next={safeNext}
              supportEmail={platform.contactEmail}
              initialEmail={initialEmail ?? undefined}
            />
          </div>

          <div className="space-y-2 text-xs text-brand-muted">
            <p>
              expectations, knowledge, confidence, and learning needs to help us tailor your
              conference experience and measure your progress afterwards
            </p>
            <p className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
              <Link href="/privacy" className="font-semibold text-corp-green-text hover:underline">
                How we use your information
              </Link>
              <a
                href={`mailto:${platform.contactEmail}`}
                className="font-semibold text-corp-green-text hover:underline"
              >
                {platform.contactEmail}
              </a>
            </p>
            <p className="lg:hidden">
              {platform.company.name} · {platform.copyright}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
