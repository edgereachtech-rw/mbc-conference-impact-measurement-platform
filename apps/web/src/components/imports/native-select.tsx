import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A plain `<select>` styled like the Input. The mapping form has up to ten of them and phones
 * open the system picker for a native select, which is the most usable control for that job.
 */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
