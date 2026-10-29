import type { Metadata } from 'next';

import { VerifyLink } from '@/components/auth/verify-link';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeading } from '@/components/section-heading';
import { event } from '@/config/event';

export const metadata: Metadata = { title: 'Signing in', robots: { index: false } };

interface VerifyPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { token } = await searchParams;
  return (
    <PageContainer size="narrow" className="flex flex-1 flex-col gap-6">
      <SectionHeading as="h1" eyebrow={event.shortName} title="Signing you in" />
      <div className="rounded-lg border border-brand-line bg-card p-4 shadow-card md:p-6">
        <VerifyLink token={token ?? null} supportEmail={event.contactEmail} />
      </div>
    </PageContainer>
  );
}
