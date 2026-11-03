import type { Metadata } from 'next';

import { MbryanLogo } from '@/components/brand/logo';
import { VerifyLink } from '@/components/auth/verify-link';
import { platform } from '@/config/platform';

export const metadata: Metadata = { title: 'Signing in', robots: { index: false } };

interface VerifyPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { token } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-raised bg-[radial-gradient(ellipse_at_top,rgb(0_42_94/0.07),transparent_60%)] px-gutter py-10 md:px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-5 text-center">
          <MbryanLogo priority className="mx-auto h-16 w-auto md:h-20" />
          <div className="space-y-2">
            <p className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase">
              Conference Impact Measurement Platform
            </p>
            <h1 className="text-h1">Signing you in</h1>
          </div>
        </div>
        <div className="rounded-lg border border-brand-line bg-card p-5 shadow-card md:p-6">
          <VerifyLink token={token ?? null} supportEmail={platform.contactEmail} />
        </div>
      </div>
    </div>
  );
}
