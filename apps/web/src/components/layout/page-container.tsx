import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: ReactNode;
  /** narrow: forms and reading (max 42rem). default: dashboards (max 64rem). wide: tables (max 80rem). */
  size?: 'narrow' | 'default' | 'wide';
  className?: string;
}

const sizes = {
  narrow: 'max-w-2xl',
  default: 'max-w-4xl',
  wide: 'max-w-6xl',
} as const;

/** Horizontal page frame: 16px gutters on phones, centred column on larger screens. */
export function PageContainer({ children, size = 'default', className }: PageContainerProps) {
  return (
    <main className={cn('mx-auto w-full px-gutter py-6 md:px-6 md:py-10', sizes[size], className)}>
      {children}
    </main>
  );
}
