'use client';

import { AlertTriangleIcon, Loader2Icon, RotateCcwIcon } from 'lucide-react';
import Link from 'next/link';

import { consoleButton } from '@/components/console/page';
import { platform } from '@/config/platform';

/**
 * What a page shows while it is being rendered, and what it shows when that fails (task of
 * 2026-11-03).
 *
 * Every route here is server-rendered on demand, so between a tap and the new page there is a
 * round trip to the API. Without a `loading` boundary the browser keeps the old page on screen,
 * unchanged, which on a slow connection reads as a button that did nothing — so people tap again.
 * These are deliberately plain: a skeleton of the page frame rather than a spinner alone, so the
 * layout does not jump when the content arrives.
 */

export function RouteLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex-1 bg-corp-surface" aria-busy="true">
      <div className="border-b border-corp-line bg-white">
        <div className="mx-auto max-w-6xl space-y-3 px-gutter py-6 md:px-6 md:py-8">
          <div className="h-3 w-24 animate-pulse bg-corp-line" />
          <div className="h-7 w-2/3 max-w-sm animate-pulse bg-corp-line" />
          <div className="h-4 w-full max-w-md animate-pulse bg-corp-line/70" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-gutter py-6 md:px-6 md:py-8">
        <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {label}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse border border-corp-line bg-white" />
          ))}
        </div>
        <div className="mt-6 h-48 animate-pulse border border-corp-line bg-white" />
      </div>
    </div>
  );
}

/**
 * The page could not be rendered at all. Next shows its own page when no boundary exists, which
 * carries no branding, no way back and no support address; this one carries all three, and the
 * retry re-runs the server render rather than reloading the whole app.
 */
export function RouteError({
  reset,
  home,
  homeLabel,
}: {
  reset: () => void;
  home: string;
  homeLabel: string;
}) {
  return (
    <div className="flex flex-1 items-center bg-corp-surface">
      <div className="mx-auto w-full max-w-lg px-gutter py-12 md:px-6">
        <div className="border border-corp-line bg-white p-5 md:p-6">
          <p className="flex items-center gap-2 font-corporate text-sm font-semibold tracking-[0.14em] text-corp-muted uppercase">
            <AlertTriangleIcon className="size-4 text-brand-danger" aria-hidden="true" />
            Something went wrong
          </p>
          <h1 className="mt-2 font-corporate text-h2 text-corp-ink">This page did not load</h1>
          <p className="mt-2 text-sm text-corp-text">
            Nothing you entered has been lost, and nothing was changed. Try again; if it keeps
            happening, write to us and we will look into it.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={reset} className={consoleButton({ variant: 'accent' })}>
              <RotateCcwIcon aria-hidden="true" /> Try again
            </button>
            <Link href={home} className={consoleButton({ variant: 'secondary' })}>
              {homeLabel}
            </Link>
          </div>
          <p className="mt-4 border-t border-corp-line pt-3 text-xs text-corp-muted">
            <a
              href={`mailto:${platform.contactEmail}`}
              className="font-semibold text-corp-green-text hover:underline"
            >
              {platform.contactEmail}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
