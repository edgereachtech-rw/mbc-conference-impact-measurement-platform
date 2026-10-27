import { TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  /** Usually a "Try again" button. */
  action?: ReactNode;
  className?: string;
}

/** Something went wrong panel. Announced as an alert so assistive tech reads it immediately. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this. Check your connection and try again.',
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center rounded-lg border border-danger/30 bg-card px-4 py-10 text-center md:py-14',
        className,
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <TriangleAlertIcon className="size-6" aria-hidden="true" />
      </div>
      <h3 className="text-h3">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-prose text-base text-brand-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
