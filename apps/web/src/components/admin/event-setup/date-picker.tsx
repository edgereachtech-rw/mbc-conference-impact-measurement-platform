'use client';

import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { formatDateLong, formatDateShort } from '@/lib/events';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  /** Selected dates, YYYY-MM-DD; the picker always hands back a sorted, de-duplicated list. */
  value: string[];
  onChange: (dates: string[]) => void;
  /** Dates that cannot be removed because sessions sit on them, with the count (brief 8.10). */
  locked?: Record<string, number>;
  disabled?: boolean;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** The 7-column grid of one month, Monday first, with nulls for the leading blanks. */
export function monthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(iso(year, month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * Calendar for picking event dates one by one (brief section 4): any number of dates, consecutive
 * or not, each kept individually. Tapping a day toggles it; the chosen dates are listed in order
 * underneath with a remove button, except dates that still carry sessions.
 */
export function DatePicker({ value, onChange, locked = {}, disabled = false }: DatePickerProps) {
  const selected = [...new Set(value)].sort();
  const anchor = selected[0] ?? new Date().toISOString().slice(0, 10);
  const [view, setView] = useState({
    year: Number(anchor.slice(0, 4)),
    month: Number(anchor.slice(5, 7)) - 1,
  });
  const cells = monthGrid(view.year, view.month);
  const monthLabel = new Date(Date.UTC(view.year, view.month, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  function toggle(date: string) {
    if (disabled) return;
    if (selected.includes(date)) {
      if (locked[date]) return;
      onChange(selected.filter((d) => d !== date));
    } else {
      onChange([...selected, date].sort());
    }
  }
  function shift(delta: number) {
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="rounded-none border border-corp-line bg-white p-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="flex size-9 items-center justify-center rounded-none border border-corp-line hover:bg-corp-surface"
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
          <p className="text-sm font-semibold text-corp-ink" aria-live="polite">
            {monthLabel}
          </p>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="flex size-9 items-center justify-center rounded-none border border-corp-line hover:bg-corp-surface"
          >
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1" aria-label={`Calendar, ${monthLabel}`}>
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="py-1 text-center text-[0.65rem] font-semibold tracking-[0.08em] text-corp-muted uppercase"
            >
              {d}
            </div>
          ))}
          {cells.map((date, i) =>
            date ? (
              <button
                key={date}
                type="button"
                aria-pressed={selected.includes(date)}
                aria-label={formatDateLong(date)}
                disabled={disabled || (selected.includes(date) && Boolean(locked[date]))}
                title={locked[date] ? `${locked[date]} session(s) scheduled` : undefined}
                onClick={() => toggle(date)}
                className={cn(
                  'flex h-10 items-center justify-center rounded-none border text-sm tabular-nums',
                  selected.includes(date)
                    ? 'border-corp-green bg-corp-green font-semibold text-white'
                    : 'border-transparent text-corp-ink hover:border-corp-line hover:bg-corp-surface',
                  'disabled:cursor-not-allowed disabled:opacity-70',
                )}
              >
                {Number(date.slice(8, 10))}
              </button>
            ) : (
              <div key={`blank-${i}`} aria-hidden="true" />
            ),
          )}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          Selected dates ({selected.length})
        </p>
        {selected.length === 0 ? (
          <p className="rounded-none border border-dashed border-corp-line bg-white p-4 text-sm text-corp-text">
            No dates yet. Tap the days the event takes place; they need not be consecutive.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-2" aria-label="Selected dates">
            {selected.map((date) => (
              <li
                key={date}
                className="inline-flex items-center gap-2 rounded-none border border-corp-line bg-white pl-3 text-sm text-corp-ink"
              >
                <span>{formatDateShort(date)}</span>
                {locked[date] ? (
                  <span className="pr-3 text-xs text-corp-muted">{locked[date]} sessions</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(date)}
                    disabled={disabled}
                    aria-label={`Remove ${formatDateLong(date)}`}
                    className="flex size-9 items-center justify-center text-corp-muted hover:bg-corp-surface hover:text-corp-ink"
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-corp-muted">
          The event runs from the earliest to the latest selected date; days in between that are not
          selected are not event days.
        </p>
      </div>
    </div>
  );
}
