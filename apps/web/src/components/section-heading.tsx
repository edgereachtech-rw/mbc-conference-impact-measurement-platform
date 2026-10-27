import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface SectionHeadingProps {
  title: string;
  /** Small Oswald label above the title, as on the site's section headings. */
  eyebrow?: string;
  description?: ReactNode;
  /** Right-aligned slot for an action (button or link). Wraps under the title on phones. */
  action?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}

const titleSizes = {
  h1: 'text-h1',
  h2: 'text-h2',
  h3: 'text-h3',
} as const;

export function SectionHeading({
  title,
  eyebrow,
  description,
  action,
  as: Heading = 'h2',
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6',
        className,
      )}
    >
      <div className="space-y-1">
        {eyebrow ? (
          <p className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <Heading className={titleSizes[Heading]}>{title}</Heading>
        {description ? <p className="text-base text-brand-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
