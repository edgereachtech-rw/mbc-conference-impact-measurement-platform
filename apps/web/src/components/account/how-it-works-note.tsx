'use client';

import { eventNounOf, type EventType } from '@mbc/shared';
import { XIcon } from 'lucide-react';
import { useState } from 'react';

import { consoleButton } from '@/components/console/page';
import { apiFetch } from '@/lib/api';

const STORAGE_KEY = 'mbc.dashboard-note.dismissed';

/**
 * The three-phase story from the welcome pack, on the dashboard itself (decision 2026-11-19), so
 * a delegate who never opened the email still knows what the figures and the next step are for.
 * Shown until the delegate closes it; the closing is kept on the account, with the browser as a
 * fallback while the request is in flight or fails.
 */
export function HowItWorksNote({
  dismissed,
  eventType,
}: {
  /** Whether the account already closed it (from the session). */
  dismissed: boolean;
  /** The next event's kind, for the wording; conference when unknown. */
  eventType?: EventType | null;
}) {
  const [open, setOpen] = useState(() => {
    if (dismissed) return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  if (!open) return null;
  const noun = eventNounOf(eventType);

  function close() {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // The account keeps the closing; the browser note is only a convenience.
    }
    void apiFetch('/me/dashboard-note/dismiss', { method: 'POST' }).catch(() => undefined);
  }

  return (
    <aside
      aria-labelledby="how-it-works-title"
      className="relative rounded-none border border-corp-green-line bg-corp-accent-soft p-4 pr-12 text-sm text-corp-ink"
    >
      <h2 id="how-it-works-title" className="font-corporate text-base font-semibold text-corp-ink">
        How this works
      </h2>
      <p className="mt-1 text-corp-text">
        This is where you record what you want to get out of the {noun}, and what you do with it
        afterwards, so the value shows up in your work.
      </p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="font-semibold">Before</dt>
          <dd className="text-corp-text">
            A short check-in: where you are now and what you want to change.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">At the {noun}</dt>
          <dd className="text-corp-text">
            Check in each day with your code, give feedback on sessions, and build your Transfer
            Plan.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Afterwards</dt>
          <dd className="text-corp-text">
            Short follow-ups at 30, 60 and 90 days, and later, asking what you have been able to
            apply.
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-corp-muted">
        The figures above count your events; the &ldquo;Start here&rdquo; panel always names the one
        thing to do now.
      </p>
      <button
        type="button"
        onClick={close}
        aria-label="Close this note"
        className={`${consoleButton({ variant: 'ghost', size: 'sm' })} absolute top-2 right-2`}
      >
        <XIcon aria-hidden="true" />
      </button>
    </aside>
  );
}
