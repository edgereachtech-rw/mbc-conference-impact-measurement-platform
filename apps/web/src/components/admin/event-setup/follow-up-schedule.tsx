'use client';

import {
  DEFAULT_FOLLOW_UP_WAVES,
  defaultWaveOpensAt,
  FOLLOW_UP_OPEN_DAYS,
  FOLLOW_UP_REMINDER_AFTER_DAYS,
  FOLLOW_UP_REMINDER_LIMIT,
  followUpWaveOf,
  LONGER_TERM_WAVE,
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
 *
 * The longer-term wave (requirement 11.5) is offered separately and stays available after the
 * three are created: it is not part of the usual programme, and an event asks for it only when
 * results need longer than 90 days to show.
 */
export function FollowUpSchedule({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const [busy, setBusy] = useState<'default' | 'longer' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const waves = event.assessmentStages.filter((s) => s.stage === 'follow_up');
  const scheduled = waves.filter((s) => s.dueAfterDays !== null);
  const hasDefaults = scheduled.length >= DEFAULT_FOLLOW_UP_WAVES.length;
  const hasLongerTerm = waves.some((s) => s.wave === LONGER_TERM_WAVE);
  // Both done: the wave cards below are the whole story from here.
  if (hasDefaults && hasLongerTerm) return null;

  async function create(which: 'default' | 'longer') {
    setBusy(which);
    setProblem(null);
    try {
      await apiFetch(`/events/${event.id}/assessments/follow-ups`, {
        method: 'POST',
        body: JSON.stringify({
          waves: which === 'default' ? [...DEFAULT_FOLLOW_UP_WAVES] : [LONGER_TERM_WAVE],
        }),
      });
      // The schedule route answers with the waves; the event itself is read again for the cards.
      const refreshed = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`);
      onSaved(refreshed.event);
    } catch (err) {
      setProblem(describeError(err, 'The follow-up schedule could not be created.').message);
    } finally {
      setBusy(null);
    }
  }

  const longerTerm = followUpWaveOf(LONGER_TERM_WAVE);
  const longerTermDate =
    longerTerm && event.endsOn
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: event.timezone,
        }).format(defaultWaveOpensAt(event.endsOn, longerTerm.dueAfterDays, event.timezone))
      : null;

  return (
    <section
      aria-label="Follow-up schedule"
      className="space-y-4 border border-dashed border-corp-line bg-white p-4"
    >
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}

      {!hasDefaults ? (
        <div className="space-y-2">
          <h3 className="font-semibold text-corp-ink">Set up the follow-up schedule</h3>
          <p className="text-sm text-corp-text">
            Follow-ups run in waves: <strong className="font-semibold">30, 60 and 90 days</strong>{' '}
            after the last day of the event. Each wave gets its own questions, dates and
            invitations. They are created as drafts, {FOLLOW_UP_OPEN_DAYS} days open, chasing anyone
            who has not answered every {FOLLOW_UP_REMINDER_AFTER_DAYS} days up to{' '}
            {FOLLOW_UP_REMINDER_LIMIT} times — nothing is sent until you enable a wave.
          </p>
          {waves.length > 0 && scheduled.length === 0 ? (
            <p className="text-sm text-corp-muted">
              This event has one follow-up round from before the schedule existed. It is left
              exactly as it is; the three waves are added alongside it.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void create('default')}
            disabled={busy !== null}
            className={consoleButton({ variant: 'accent', size: 'sm' })}
          >
            {busy === 'default' ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <CalendarPlusIcon aria-hidden="true" />
            )}
            Create the 30, 60 and 90-day waves
          </button>
        </div>
      ) : null}

      {!hasLongerTerm && longerTerm ? (
        <div className={`space-y-2${!hasDefaults ? ' border-t border-corp-line pt-4' : ''}`}>
          <h3 className="font-semibold text-corp-ink">Longer-term follow-up (optional)</h3>
          <p className="text-sm text-corp-text">
            A further wave about{' '}
            <strong className="font-semibold">{longerTerm.dueAfterDays} days</strong> after the
            event{longerTermDate ? `, which would open on ${longerTermDate}` : ''}, for results that
            need longer than 90 days to show. It is created as a draft with no questions, and a wave
            with no questions cannot be opened — add its questions, review the date, then enable it.
          </p>
          <p role="note" className="text-sm text-corp-muted">
            It invites <strong className="font-semibold">every delegate</strong> of this event, as
            the other waves do. Sending it to only some delegates or organisations is not built yet,
            so do not enable it expecting a smaller audience.
          </p>
          <button
            type="button"
            onClick={() => void create('longer')}
            disabled={busy !== null}
            className={consoleButton({ variant: 'secondary', size: 'sm' })}
          >
            {busy === 'longer' ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <CalendarPlusIcon aria-hidden="true" />
            )}
            Add the longer-term follow-up
          </button>
        </div>
      ) : null}
    </section>
  );
}
