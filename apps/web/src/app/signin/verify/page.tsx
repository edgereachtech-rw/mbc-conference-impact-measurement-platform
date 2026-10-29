import type { Metadata } from 'next';

import { VerifyLink } from '@/components/auth/verify-link';
import { PageContainer } from '@/components/layout/page-container';
import { event } from '@/config/event';

export const metadata: Metadata = { title: 'Signing in', robots: { index: false } };

interface VerifyPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { token } = await searchParams;
  return (
    <PageContainer size="narrow" className="flex flex-1 flex-col justify-center gap-6">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <p className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase">
            {event.shortName}
          </p>
          <h1 className="text-h1">Signing you in</h1>
        </div>
        <div className="rounded-lg border border-brand-line bg-card p-5 shadow-card md:p-6">
          <VerifyLink token={token ?? null} supportEmail={event.contactEmail} />
        </div>
      </div>
    </PageContainer>
  );
}
