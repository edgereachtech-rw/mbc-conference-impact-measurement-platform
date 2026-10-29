import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ImportWizard } from '@/components/imports/import-wizard';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeading } from '@/components/section-heading';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/error-state';
import { importsAccess } from '@/lib/imports-access';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Registration imports' };

/**
 * Admin import screen (E2-1). The page decides only what to render; every request the screen
 * makes is authorised by the API, so hiding the tool is a courtesy, not the access control.
 */
export default async function ImportsPage() {
  const session = await getSession();
  const access = importsAccess(session);
  if (access === 'signed-out') redirect('/signin?next=/admin/imports');

  return (
    <PageContainer size="wide" className="flex flex-1 flex-col gap-6">
      <SectionHeading
        as="h1"
        eyebrow="Admin"
        title="Registration imports"
        description="Import an event's registered delegates from a CSV or XLSX export: map the columns, review the preview, then confirm."
      />
      {access === 'forbidden' ? (
        <ErrorState
          title="Admins only"
          description="Registration imports are run by M.Bryan admins. Your account does not have that role."
          action={
            <Link href="/" className={buttonVariants({ variant: 'outline' })}>
              Back to home
            </Link>
          }
        />
      ) : (
        <ImportWizard />
      )}
    </PageContainer>
  );
}
