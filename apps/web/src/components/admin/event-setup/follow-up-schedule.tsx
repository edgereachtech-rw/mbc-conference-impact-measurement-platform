'use client';

import {
  DEFAULT_FOLLOW_UP_WAVES,
  FOLLOW_UP_OPEN_DAYS,
  FOLLOW_UP_REMINDER_AFTER_DAYS,
  FOLLOW_UP_REMINDER_LIMIT,
  type EventDetail,
} from '@mbc/shared';
import { CalendarPlusIcon, Loader2Icon } from 'lucide-react';
import { useState } from 'react';

import { consoleButton } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

/**
 * Creating the follow-up schedule (backlog E12-1), added 2026-11-03.
 *
 * The waves were reachable only through the API, so an event created before the schedule existed
 * showed its single follow-up round and nothing else, with no way to get the rest. This offers the
 * three waves once, as drafts with their default dates, and then steps out of the way: the cards
 * below are how each one is reviewed, moved and enabled.
 */
export function FollowUpSchedule({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const waves = event.assessmentStages.filter((s) => s.stage === 'follow_up');
  const scheduled = waves.filter((s) => s.dueAfterDays !== null);
  // Nothing to offer once the three default waves exist; the longer-term one is added separately.
  if (scheduled.length >= DEFAULT_FOLLOW_UP_WAVES.length) return null;

  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      await apiFetch(`/events/${event.id}/assessments/follow-ups`, {
        method: 'POST',
        body: JSON.stringify({ waves: [...DEFAULT_FOLLOW_UP_WAVES] }),
      });
      // The schedule route answers with the waves; the event itself is read again for the cards.
      const refreshed = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`);
      onSaved(refreshed.event);
    } catch (err) {
      setProblem(describeError(err, 'The follow-up schedule could not be created.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Follow-up schedule"
      className="space-y-2 border border-dashed border-corp-line bg-white p-4"
    >
      <h3 className="font-semibold text-corp-ink">Set up the follow-up schedule</h3>
      <p className="text-sm text-corp-text">
        Follow-ups run in waves: <strong className="font-semibold">30, 60 and 90 days</strong> after
        the last day of the event. Each wave gets its own questions, dates and invitations. They are
        created as drafts, {FOLLOW_UP_OPEN_DAYS} days open, chasing anyone who has not answered
        every {FOLLOW_UP_REMINDER_AFTER_DAYS} days up to {FOLLOW_UP_REMINDER_LIMIT} times — nothing
        is sent until you enable a wave.
      </p>
      {waves.length > 0 && scheduled.length === 0 ? (
        <p className="text-sm text-corp-muted">
          This event has one follow-up round from before the schedule existed. It is left exactly as
          it is; the three waves are added alongside it.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        className={consoleButton({ variant: 'accent', size: 'sm' })}
      >
        {busy ? (
          <Loader2Icon className="animate-spin" aria-hidden="true" />
        ) : (
          <CalendarPlusIcon aria-hidden="true" />
        )}
        Create the 30, 60 and 90-day waves
      </button>
    </section>
  );
}
