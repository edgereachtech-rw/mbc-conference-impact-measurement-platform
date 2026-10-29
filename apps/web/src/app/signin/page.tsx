import { safeReturnPath } from '@mbc/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { PageContainer } from '@/components/layout/page-container';
import { event } from '@/config/event';
import { apiInternalUrl } from '@/lib/api';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

interface SignInPageProps {
  searchParams: Promise<{ next?: string; invite?: string }>;
}

/** The email an invitation link stands for, or null when the link is unknown, used or expired. */
async function invitedEmail(token: string | undefined): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 256) return null;
  try {
    const res = await fetch(
      `${apiInternalUrl()}/api/v1/auth/invitations/${encodeURIComponent(token)}`,
      {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    const { email } = (await res.json()) as { email: string };
    return email;
  } catch {
    return null;
  }
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await getSession();
  const { next, invite } = await searchParams;
  const safeNext = safeReturnPath(next);
  if (session) redirect(safeNext ?? '/account');
  const initialEmail = await invitedEmail(invite);

  return (
    <PageContainer size="narrow" className="flex flex-1 flex-col justify-center gap-6">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <p className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase">
            {event.shortName}
          </p>
          <h1 className="text-h1">{initialEmail ? 'Activate your account' : 'Sign in'}</h1>
          <p className="text-base text-brand-muted">
            {initialEmail
              ? 'Your invitation is ready. Confirm your email below and we will send a one-time link and code.'
              : 'No password needed. We email a secure link and a one-time code to the address you registered with.'}
          </p>
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
        <p className="text-center text-xs text-brand-muted">
          For registered delegates and the conference team. Nothing is created for an email that is
          not registered.
        </p>
      </div>
    </PageContainer>
  );
}
