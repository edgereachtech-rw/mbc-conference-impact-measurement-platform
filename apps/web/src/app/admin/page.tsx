import { ConstructionIcon, UploadIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EmptyState } from '@/components/empty-state';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeading } from '@/components/section-heading';
import { buttonVariants } from '@/components/ui/button';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin' };

export default async function AdminPage() {
  const session = await getSession();
  const access = importsAccess(session);
  if (access === 'signed-out') redirect('/signin?next=/admin');

  return (
    <PageContainer size="narrow" className="flex flex-1 flex-col gap-6">
      <SectionHeading
        as="h1"
        title="Admin"
        description="Conference setup, delegate records, dashboards and exports for the M.Bryan team."
      />
      {access === 'allowed' ? (
        <Link
          href="/admin/imports"
          className="flex items-center gap-3 rounded-lg border border-brand-line bg-card p-4 shadow-card"
        >
          <UploadIcon className="size-6 shrink-0 text-brand-primary" aria-hidden="true" />
          <span className="space-y-0.5">
            <span className="block font-medium text-brand-primary">Registration imports</span>
            <span className="block text-sm text-brand-muted">
              Import an event&apos;s registered delegates from CSV or XLSX, review the preview,
              confirm.
            </span>
          </span>
        </Link>
      ) : null}
      <EmptyState
        icon={<ConstructionIcon className="size-6" aria-hidden="true" />}
        title="More coming soon"
        description="Conference setup, delegate records, dashboards and exports arrive in later increments."
        action={
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>
            Back to home
          </Link>
        }
      />
    </PageContainer>
  );
}
