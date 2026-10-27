'use client';

import { CheckCircle2Icon, CloudOffIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusProps {
  state: SaveState;
  /** When the last successful save happened; drives "Saved just now" / "Saved 3 min ago". */
  savedAt?: Date | null;
  /** Shown when state is "error". */
  errorMessage?: string;
  className?: string;
}

export function formatSavedAgo(savedAt: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - savedAt.getTime()) / 1000));
  if (seconds < 60) return 'Saved just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Saved ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Saved ${hours} h ago`;
  return `Saved on ${savedAt.toLocaleDateString()}`;
}

/** Autosave indicator for long forms. Announced politely to screen readers on change. */
export function SaveStatus({ state, savedAt, errorMessage, className }: SaveStatusProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (state !== 'saved') return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [state]);

  let icon = null;
  let text = '';
  let tone = 'text-brand-muted';

  if (state === 'saving') {
    icon = <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />;
    text = 'Saving…';
  } else if (state === 'saved') {
    icon = <CheckCircle2Icon className="size-4" aria-hidden="true" />;
    text = savedAt ? formatSavedAgo(savedAt, now) : 'Saved';
    tone = 'text-success';
  } else if (state === 'error') {
    icon = <CloudOffIcon className="size-4" aria-hidden="true" />;
    text = errorMessage ?? 'Not saved. Check your connection and try again.';
    tone = 'text-danger';
  }

  return (
    <p
      role="status"
      aria-live="polite"
      data-state={state}
      className={cn('flex min-h-5 items-center gap-1.5 text-sm', tone, className)}
    >
      {icon}
      {text}
    </p>
  );
}
