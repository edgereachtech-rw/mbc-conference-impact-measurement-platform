'use client';

import {
  DEFAULT_FOLLOW_UP_WAVES,
  defaultWaveWindow,
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
 * Creating the Transfer Plan follow-up schedule (backlog E12-1; windows of 2026-11-09).
 *
 * Offers the three default follow-ups once, as drafts with their default windows (days 1 to 30,
 * 31 to 60 and 61 to 90 after the event's last day), and then steps out of the way: the cards
 * below are how each one is reviewed, moved and enabled. The longer-term follow-up (requirement
 * 11.5) is offered separately and stays available after the three are created: it is not part of
 * the usual programme, and an event asks for it only when results need longer than 90 days to
 * show. Its window starts on day 91 and has no end until an admin sets one.
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
  const longerTermFrom =
    longerTerm && event.endsOn
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: event.timezone,
        }).format(defaultWaveWindow(event.endsOn, LONGER_TERM_WAVE, event.timezone).opensAt)
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
            Three follow-ups, each covering a stretch of days after the last day of the event:{' '}
            <strong className="font-semibold">days 1 to 30, 31 to 60 and 61 to 90</strong>. Each has
            its own questions and its own window, which you can move on its card. They are created
            as drafts; nothing is sent until you enable one. Delegates are pointed to the open
            follow-up by the reminders they chose on their Transfer Plan.
          </p>
          {waves.length > 0 && scheduled.length === 0 ? (
            <p className="text-sm text-corp-muted">
              This event has one follow-up round from before the schedule existed. It is left
              exactly as it is; the three follow-ups are added alongside it.
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
            Create the 30, 60 and 90-day follow-ups
          </button>
        </div>
      ) : null}

      {!hasLongerTerm && longerTerm ? (
        <div className={`space-y-2${!hasDefaults ? ' border-t border-corp-line pt-4' : ''}`}>
          <h3 className="font-semibold text-corp-ink">Longer-term follow-up (optional)</h3>
          <p className="text-sm text-corp-text">
            A further follow-up from <strong className="font-semibold">day 91</strong> onwards
            {longerTermFrom ? `, which would open on ${longerTermFrom}` : ''}, with no end until you
            set one, for results that need longer than 90 days to show. It is created as a draft
            with no questions, and a follow-up with no questions cannot be opened — add its
            questions, review the window, then enable it.
          </p>
          <p role="note" className="text-sm text-corp-muted">
            It invites <strong className="font-semibold">every delegate</strong> of this event, as
            the other follow-ups do. Sending it to only some delegates or organisations is not built
            yet, so do not enable it expecting a smaller audience.
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
