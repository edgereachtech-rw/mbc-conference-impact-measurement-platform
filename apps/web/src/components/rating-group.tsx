'use client';

import { useId } from 'react';

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export interface RatingOption {
  value: string;
  label: string;
  /** Optional helper text under the label. */
  description?: string;
}

interface RatingGroupProps {
  /** Question text, rendered as the group's accessible name. */
  legend: string;
  /** Four or five options, lowest to highest. Labels come from the question bank, not from here. */
  options: RatingOption[];
  name?: string;
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Error text shown under the options; also marks the group invalid. */
  error?: string;
  hint?: string;
  className?: string;
}

/**
 * Single-choice rating scale (4- or 5-point) with full-width 44px rows on phones and one row of
 * equal columns from md up. Built on the themed RadioGroup so keyboard and screen-reader
 * behaviour come from Base UI.
 */
export function RatingGroup({
  legend,
  options,
  name,
  value,
  defaultValue,
  onValueChange,
  required,
  disabled,
  error,
  hint,
  className,
}: RatingGroupProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const columns = options.length === 4 ? 'md:grid-cols-4' : 'md:grid-cols-5';

  return (
    <div className={cn('space-y-2', className)}>
      <RadioGroup
        name={name}
        value={value ?? undefined}
        defaultValue={defaultValue}
        onValueChange={(next) => onValueChange?.(String(next))}
        required={required}
        disabled={disabled}
        aria-label={legend}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        data-scale={options.length}
        className={cn('grid gap-2', columns)}
      >
        <p className="mb-1 text-base font-medium text-brand-primary md:col-span-full">{legend}</p>
        {hint ? (
          <p id={hintId} className="-mt-1 text-sm text-brand-muted md:col-span-full">
            {hint}
          </p>
        ) : null}
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-h-tap cursor-pointer items-center gap-3 rounded-md border border-brand-line bg-card px-3 py-2 text-base transition-colors',
              'hover:bg-surface-tint has-[[data-checked]]:border-brand-primary has-[[data-checked]]:bg-accent',
              'has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
              'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
              'md:min-h-20 md:flex-col md:items-center md:justify-center md:gap-2 md:px-2 md:text-center md:text-sm',
            )}
          >
            <RadioGroupItem value={option.value} />
            <span className="flex flex-col">
              <span className="font-medium text-brand-text">{option.label}</span>
              {option.description ? (
                <span className="text-sm text-brand-muted md:text-xs">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </RadioGroup>
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
