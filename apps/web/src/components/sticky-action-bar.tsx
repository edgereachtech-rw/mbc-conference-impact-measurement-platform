import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface StickyActionBarProps {
  /** Usually a "Save draft" and a "Submit" button. */
  children: ReactNode;
  /** Optional status line (for example SaveStatus) shown above the buttons on phones. */
  status?: ReactNode;
  className?: string;
}

/**
 * Pins form actions to the bottom of the screen on phones so delegates never scroll to find
 * Submit. Respects the home-indicator safe area. From md up it sits inline at the end of the form.
 * Place it at the end of the form; it renders its own spacer so content is not hidden behind it.
 */
export function StickyActionBar({ children, status, className }: StickyActionBarProps) {
  return (
    <>
      <div className="h-action-bar md:hidden" aria-hidden="true" />
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 border-t border-brand-line bg-surface-raised/95 px-gutter pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-elevated backdrop-blur',
          'md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none',
          className,
        )}
      >
        {status ? <div className="mb-2 md:mb-3">{status}</div> : null}
        <div className="flex gap-3 *:flex-1 md:justify-end md:*:flex-none">{children}</div>
      </div>
    </>
  );
}
