import { safeReturnPath } from '@mbc/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeading } from '@/components/section-heading';
import { event } from '@/config/event';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

interface SignInPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await getSession();
  const { next } = await searchParams;
  const safeNext = safeReturnPath(next);
  if (session) redirect(safeNext ?? '/account');

  return (
    <PageContainer size="narrow" className="flex flex-1 flex-col gap-6">
      <SectionHeading
        as="h1"
        eyebrow={event.shortName}
        title="Sign in"
        description="For registered delegates and the conference team. Use the email address you registered with."
      />
      <div className="rounded-lg border border-brand-line bg-card p-4 shadow-card md:p-6">
        <SignInForm next={safeNext} supportEmail={event.contactEmail} />
      </div>
    </PageContainer>
  );
}
