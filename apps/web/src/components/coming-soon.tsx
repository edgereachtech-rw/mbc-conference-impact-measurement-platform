import { ConstructionIcon } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageContainer } from '@/components/layout/page-container';
import { SectionHeading } from '@/components/section-heading';
import { buttonVariants } from '@/components/ui/button';

interface ComingSoonProps {
  title: string;
  description: string;
}

/** Placeholder body for routes whose features arrive in later increments. */
export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <PageContainer size="narrow" className="flex flex-1 flex-col gap-6">
      <SectionHeading as="h1" title={title} description={description} />
      <EmptyState
        icon={<ConstructionIcon className="size-6" aria-hidden="true" />}
        title="Coming soon"
        description="This part of the platform is being built. Check back closer to the conference."
        action={
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>
            Back to home
          </Link>
        }
      />
    </PageContainer>
  );
}
