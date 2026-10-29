import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface Crumb {
  label: string;
  href?: string;
}

interface AdminPageHeaderProps {
  title: string;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Primary and secondary actions, right-aligned on desktop, full width on phones. */
  actions?: ReactNode;
}

/** Console page header: breadcrumb, title, one-line description and the page's actions. */
export function AdminPageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: AdminPageHeaderProps) {
  return (
    <header className="border-b border-corp-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-gutter py-5 md:px-8 md:py-6">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-corp-muted">
              {breadcrumbs.map((crumb, index) => (
                <li key={crumb.label} className="flex items-center gap-1">
                  {index > 0 ? <ChevronRightIcon className="size-3" aria-hidden="true" /> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="hover:text-corp-ink">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="font-medium text-corp-ink">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="font-corporate text-h2 text-corp-ink md:text-h1">{title}</h1>
            {description ? (
              <p className="max-w-prose text-sm text-corp-text md:text-base">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">{actions}</div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Consistent content column under the page header. */
export function AdminContent({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-gutter py-6 md:px-8 md:py-8">
      {children}
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'positive' | 'attention';
}

/** KPI tile: label above, value large, optional hint. */
export function StatTile({ label, value, hint, tone = 'neutral' }: StatTileProps) {
  const valueTone =
    tone === 'positive'
      ? 'text-corp-green-text'
      : tone === 'attention'
        ? 'text-brand-warning-text'
        : 'text-corp-ink';
  return (
    <div className="rounded-none border border-corp-line bg-white p-4">
      <p className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-corp-muted">{hint}</p> : null}
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: 'positive' | 'neutral' | 'attention';
  children: ReactNode;
}) {
  const classes =
    tone === 'positive'
      ? 'bg-corp-green-soft text-corp-green-text'
      : tone === 'attention'
        ? 'bg-brand-warning/20 text-brand-warning-text'
        : 'bg-corp-surface text-corp-muted';
  return (
    <span
      className={`inline-flex items-center rounded-none px-2.5 py-0.5 text-xs font-semibold ${classes}`}
    >
      {children}
    </span>
  );
}
