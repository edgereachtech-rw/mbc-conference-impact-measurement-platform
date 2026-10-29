import { cva, type VariantProps } from 'class-variance-authority';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  InboxIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/*
 * Console design system: the building blocks every signed-in screen is made of, for staff and
 * delegates alike. Dark blue, yellow and white: navy ink and primary actions, amber accents, white
 * surfaces on a pale blue-grey background. Inter, sharp edges, one content column, 44px tap
 * targets. Docs: docs/design-tokens.md, "Console system".
 */

interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  /** Small uppercase label above the title, e.g. the area or the event. */
  eyebrow?: string;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Pills or facts shown under the description. */
  meta?: ReactNode;
  /** Primary and secondary actions, right-aligned on desktop, full width on phones. */
  actions?: ReactNode;
}

/** Page header: breadcrumb, eyebrow, title, one-line description, optional meta row and actions. */
export function PageHeader({
  title,
  eyebrow,
  description,
  breadcrumbs,
  meta,
  actions,
}: PageHeaderProps) {
  return (
    <header className="border-b border-corp-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-gutter py-5 md:px-8 md:py-7">
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
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-1.5 border-l-4 border-corp-accent pl-4">
            {eyebrow ? (
              <p className="text-xs font-semibold tracking-[0.12em] text-corp-accent-text uppercase">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="font-corporate text-2xl font-semibold tracking-tight text-corp-ink md:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="max-w-prose text-sm text-corp-text md:text-base">{description}</p>
            ) : null}
            {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Consistent content column under the page header. */
export function PageContent({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-gutter py-6 md:px-8 md:py-8">
      {children}
    </div>
  );
}

interface SectionHeaderProps {
  id: string;
  title: string;
  description?: ReactNode;
  /** Right-aligned link or count. */
  aside?: ReactNode;
}

/** Section title with an optional description and a right-aligned aside, used above panels. */
export function SectionHeader({ id, title, description, aside }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
      <div>
        <h2 id={id} className="font-corporate text-lg font-semibold tracking-tight text-corp-ink">
          {title}
        </h2>
        {description ? <p className="text-sm text-corp-muted">{description}</p> : null}
      </div>
      {aside ? <div className="text-sm text-corp-muted">{aside}</div> : null}
    </div>
  );
}

interface PanelProps {
  children: ReactNode;
  className?: string;
  /** Removes the padding, for tables that fill the panel. */
  flush?: boolean;
}

/** The console surface: white, hairline border, sharp corners, a whisper of shadow. */
export function Panel({ children, className, flush = false }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-none border border-corp-line bg-white shadow-panel',
        flush ? 'overflow-hidden' : 'p-4 md:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Tables scroll sideways inside their panel on phones instead of breaking the page width. */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'positive' | 'attention';
}

/** KPI tile: amber rule on top, label above, value large in navy, optional hint. */
export function StatTile({ label, value, hint, tone = 'neutral' }: StatTileProps) {
  const valueTone =
    tone === 'positive'
      ? 'text-corp-green-text'
      : tone === 'attention'
        ? 'text-brand-danger'
        : 'text-corp-ink';
  return (
    <div className="rounded-none border border-corp-line border-t-4 border-t-corp-accent bg-white p-4 shadow-panel">
      <p className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums',
          valueTone,
        )}
      >
        {value}
      </p>
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
      ? 'bg-corp-accent-soft text-corp-ink'
      : tone === 'attention'
        ? 'bg-brand-danger/10 text-brand-danger'
        : 'bg-corp-surface text-corp-muted';
  return (
    <span
      className={`inline-flex items-center rounded-none px-2.5 py-0.5 text-xs font-semibold ${classes}`}
    >
      {children}
    </span>
  );
}

/** Button classes for the console; use on `<button>` and `<Link>` alike. */
export const consoleButton = cva(
  'inline-flex items-center justify-center gap-2 rounded-none text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-corp-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** Navy: the one main action of a screen. */
        primary: 'bg-corp-green text-white shadow-button hover:bg-corp-ink',
        /** Amber: the call to action that must stand out (send, confirm). */
        accent: 'bg-corp-accent text-corp-ink shadow-button hover:bg-corp-accent-deep',
        /** Navy outline: secondary actions. */
        secondary:
          'border border-corp-green bg-white text-corp-green-text hover:bg-corp-accent-soft',
        /** Quiet: tertiary actions and toolbars. */
        ghost: 'border border-corp-line bg-white text-corp-ink hover:bg-corp-surface',
        dark: 'bg-corp-ink text-white hover:bg-corp-green',
        danger: 'bg-brand-danger text-white hover:bg-corp-ink',
      },
      size: {
        default: 'min-h-tap px-5',
        sm: 'min-h-10 px-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);
export type ConsoleButtonVariants = VariantProps<typeof consoleButton>;

interface StatePanelProps {
  kind: 'loading' | 'empty' | 'error';
  title?: string;
  description?: ReactNode;
  requestId?: string;
  action?: ReactNode;
}

/** Loading, empty and error states with one look; the error is announced as an alert. */
export function StatePanel({ kind, title, description, requestId, action }: StatePanelProps) {
  if (kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> {title ?? 'Loading…'}
      </p>
    );
  }
  const error = kind === 'error';
  return (
    <div
      role={error ? 'alert' : undefined}
      className={cn(
        'rounded-none border bg-white p-5',
        error ? 'border-brand-danger/40' : 'border-dashed border-corp-line',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-none',
            error ? 'bg-brand-danger/10 text-brand-danger' : 'bg-corp-accent-soft text-corp-ink',
          )}
        >
          {error ? (
            <TriangleAlertIcon className="size-4" aria-hidden="true" />
          ) : (
            <InboxIcon className="size-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-corp-ink">
            {title ?? (error ? 'Something went wrong' : 'Nothing here yet')}
          </p>
          {description ? <p className="mt-1 text-sm text-corp-text">{description}</p> : null}
          {requestId ? (
            <p className="mt-1 text-xs text-corp-muted">Request id {requestId}</p>
          ) : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

export const PAGE_SIZES = [10, 20, 50, 100] as const;

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** What the rows are, for the summary: "delegates", "messages". */
  noun?: string;
}

/**
 * Table footer: "1–10 of 87", rows-per-page picker (10 by default), previous and next. Works for
 * server paging (the owner refetches) and client paging (the owner slices) alike.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  noun = 'rows',
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col gap-3 border-t border-corp-line bg-corp-surface/60 px-4 py-3 text-sm text-corp-muted sm:flex-row sm:items-center sm:justify-between">
      <p>
        {from}–{to} of {total} {noun}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-10 rounded-none border border-corp-line bg-white px-2 text-sm text-corp-ink"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            <ChevronLeftIcon aria-hidden="true" />
            <span className="hidden sm:inline">Previous</span>
          </button>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRightIcon aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Client-side slice for lists the API returns whole. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}
