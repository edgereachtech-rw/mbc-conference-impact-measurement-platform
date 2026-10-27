import type { ReactNode } from 'react';
import { useId } from 'react';

import { cn } from '@/lib/utils';

interface FormSectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Groups related fields in a white card with a heading, one section per screen on phones.
 * Renders a fieldset so screen readers announce the group name with each field.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  const descriptionId = useId();

  return (
    <fieldset
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        'min-w-0 rounded-lg border border-brand-line bg-card p-4 shadow-card md:p-6',
        className,
      )}
    >
      <legend className="float-left mb-1 w-full font-heading text-h3 text-brand-primary">
        {title}
      </legend>
      {description ? (
        <p id={descriptionId} className="mb-4 text-sm text-brand-muted">
          {description}
        </p>
      ) : (
        <div className="mb-4" aria-hidden="true" />
      )}
      <div className="flex flex-col gap-5">{children}</div>
    </fieldset>
  );
}
