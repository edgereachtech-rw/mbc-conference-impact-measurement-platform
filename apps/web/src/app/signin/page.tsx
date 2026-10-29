import { safeReturnPath } from '@mbc/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeading } from '@/components/section-heading';
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
    <PageContainer size="narrow" className="flex flex-1 flex-col gap-6">
      <SectionHeading
        as="h1"
        eyebrow={event.shortName}
        title="Sign in"
        description="For registered delegates and the conference team. Use the email address you registered with."
      />
      <div className="rounded-lg border border-brand-line bg-card p-4 shadow-card md:p-6">
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
    </PageContainer>
  );
}
