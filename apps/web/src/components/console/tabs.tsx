'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';

/**
 * The tab strip used by the screens that hold many sections (task of 2026-11-03).
 *
 * Three things the hand-rolled strips did not do:
 *  - A phone shows two or three of eleven tabs. The row scrolls, but nothing said so, so the rest
 *    were invisible rather than merely off-screen. This one fades at whichever edge has more to
 *    show and scrolls the chosen tab into view.
 *  - `role="tablist"` promises arrow-key movement to a screen reader. Left, Right, Home and End
 *    now work, and only the selected tab is in the tab order, as the pattern expects.
 *  - Losing your place on a refresh. `useTabState` keeps the chosen tab in the address bar, so a
 *    reload, a bookmark and a shared link all land on the same section.
 */

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
}

interface TabStripProps<Id extends string> {
  label: string;
  tabs: ReadonlyArray<TabItem<Id>>;
  current: Id;
  onChoose: (id: Id) => void;
  /** Lets the strip bleed to the screen edge on a phone, as the delegate event page does. */
  bleed?: boolean;
}

export function TabStrip<Id extends string>({
  label,
  tabs,
  current,
  onChoose,
  bleed = false,
}: TabStripProps<Id>) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > 4, end: max > 4 && el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = strip.current;
    if (!el) return;
    // ResizeObserver catches the strip changing width without the window doing so (the sidebar
    // appearing, a font loading). Where it is missing the resize listener alone is enough.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, tabs.length]);

  // Keep the selected tab in view: chosen from the keyboard, or restored from the address bar.
  useEffect(() => {
    const selected = strip.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    // jsdom has no layout and so no scrollIntoView; nothing to scroll there either.
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    measure();
  }, [current, measure]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const at = tabs.findIndex((t) => t.id === current);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : e.key === 'ArrowLeft'
            ? (at - 1 + tabs.length) % tabs.length
            : (at + 1) % tabs.length;
    const target = tabs[next];
    if (!target) return;
    onChoose(target.id);
    strip.current?.querySelector<HTMLElement>(`#tab-${target.id}`)?.focus();
  }

  return (
    <div className={cn('relative', bleed && '-mx-gutter md:mx-0')}>
      <div
        ref={strip}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        onScroll={measure}
        className={cn(
          'flex gap-1 overflow-x-auto border-b border-corp-line',
          bleed && 'px-gutter md:px-0',
        )}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={current === t.id ? 0 : -1}
            onClick={() => onChoose(t.id)}
            className={cn(
              'shrink-0 border-b-2 px-3 py-3 text-sm whitespace-nowrap',
              current === t.id
                ? '-mb-px border-corp-accent font-semibold text-corp-ink'
                : 'border-transparent font-medium text-corp-muted hover:text-corp-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* The only clue a phone gets that the row continues. Decorative: the tabs carry the meaning. */}
      {edges.start ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-corp-surface to-transparent"
        />
      ) : null}
      {edges.end ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-corp-surface to-transparent"
        />
      ) : null}
    </div>
  );
}

const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = () => window.location.hash.replace(/^#/, '');

/**
 * The chosen tab, kept in the address bar so a reload or a shared link lands on the same section.
 * `#tab` is used rather than a query string because it never reaches the server and so never
 * re-renders the page.
 */
export function useTabState<Id extends string>(
  ids: ReadonlyArray<Id>,
  fallback: Id,
): [Id, (id: Id) => void] {
  const known = new Set<string>(ids);
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '');
  const [chosen, setChosen] = useState<Id | null>(null);
  const current = chosen ?? (known.has(hash) ? (hash as Id) : fallback);

  const choose = (id: Id) => {
    setChosen(id);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', id === fallback ? '#' : `#${id}`);
    }
  };
  return [current, choose];
}
