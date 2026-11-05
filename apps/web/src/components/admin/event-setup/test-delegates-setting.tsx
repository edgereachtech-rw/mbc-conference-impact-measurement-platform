'use client';

import type { EventDetail } from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';

import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

/**
 * Whether test delegates count in this event's figures (decision of 2026-11-05).
 *
 * Test delegates let staff walk the platform from the delegate's side. Their answers are real
 * rows, so the event decides whether reports, dashboards and summaries include them. Off is the
 * safe default: a rehearsal should never move a figure. On is for checking that a report reads
 * correctly before any real delegate has answered.
 */
export function TestDelegatesSetting({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(countTestDelegates: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ countTestDelegates }),
      });
      onSaved(result.event);
    } catch (err) {
      setProblem(describeError(err, 'The setting could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Test delegates" className="space-y-2 border border-corp-line bg-white p-4">
      <h3 className="font-semibold text-corp-ink">Test delegates</h3>
      <p className="text-sm text-corp-text">
        Mark registrations as test delegates in the list below to try the platform from a
        delegate&apos;s side. Their answers are kept out of this event&apos;s reports, dashboards
        and summaries unless you say otherwise here. Whether they can sign in is set per
        environment, not per event.
      </p>
      <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
        <input
          type="checkbox"
          checked={event.countTestDelegates}
          disabled={busy}
          onChange={(e) => void save(e.target.checked)}
          className="size-5 accent-corp-green"
        />
        Count test delegates in reports and figures
        {busy ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : null}
      </label>
      {event.countTestDelegates ? (
        <p role="note" className="text-xs text-corp-muted">
          On: every figure for this event now includes test delegates. Switch it off before
          reporting to anyone.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
