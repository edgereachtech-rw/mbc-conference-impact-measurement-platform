import { cn } from '@/lib/utils';

interface StepProgressProps {
  /** 1-based index of the current step. */
  current: number;
  total: number;
  /** Optional step names; the current one is shown under the bar. */
  labels?: string[];
  className?: string;
}

/** "Step 2 of 5" indicator for multi-step forms. */
export function StepProgress({ current, total, labels, className }: StepProgressProps) {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(Math.max(1, current), safeTotal);
  const percent = Math.round((safeCurrent / safeTotal) * 100);
  const label = labels?.[safeCurrent - 1];

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-eyebrow tracking-[0.14em] text-brand-primary uppercase">
          Step {safeCurrent} of {safeTotal}
        </p>
        {label ? <p className="truncate text-sm text-brand-muted">{label}</p> : null}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={safeCurrent}
        aria-valuetext={`Step ${safeCurrent} of ${safeTotal}${label ? `: ${label}` : ''}`}
        className="h-2 w-full overflow-hidden rounded-full bg-brand-line"
      >
        <div
          className="h-full rounded-full bg-brand-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
