import { InboxIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Primary action, usually a Button or link. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Friendly "nothing here yet" panel for lists and dashboards. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed border-brand-line bg-card px-4 py-10 text-center md:py-14',
        className,
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-brand-primary">
        {icon ?? <InboxIcon className="size-6" aria-hidden="true" />}
      </div>
      <h3 className="text-h3">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-prose text-base text-brand-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
