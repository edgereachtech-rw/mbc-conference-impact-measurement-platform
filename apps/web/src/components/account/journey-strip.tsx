'use client';

import type { Journey, MyEvent } from '@mbc/shared';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { journeyFor } from '@/lib/my-events';

/**
 * One event's journey as a stepper: a horizontal strip on phones (scrolls) and a row on larger
 * screens.
 *
 * Each step reports where the delegate actually stands (fixed 2026-11-03). Every step used to
 * read "Opens later" — written when none of the epics had shipped, and left behind once they
 * had, so the strip told every delegate on every event that there was nothing to do even while
 * their pre-conference assessment was open. The state comes from the same journey the "My
 * journey" tab reads; while it loads, or if it cannot be read, a step says nothing rather than
 * something wrong.
 */

type StepState = { label: string; tone: 'done' | 'now' | 'later' };

const TONES: Record<StepState['tone'], string> = {
  done: 'bg-corp-accent-soft text-corp-green-text',
  now: 'bg-corp-ink text-white',
  later: 'bg-corp-surface text-corp-muted',
};

/** The pre-conference stage, which is what the "Before" step is about. */
function beforeState(journey: Journey): StepState {
  const pre = (journey.assessments ?? []).find((a) => a.stage === 'pre_conference');
  switch (pre?.state) {
    case 'submitted':
      return { label: 'Submitted', tone: 'done' };
    case 'draft':
      return { label: 'Draft saved', tone: 'now' };
    case 'open':
      return { label: 'Open now', tone: 'now' };
    case 'closed':
      return { label: 'Closed', tone: 'later' };
    case 'not_configured':
      return { label: 'Not part of this event', tone: 'later' };
    default:
      return { label: 'Opens later', tone: 'later' };
  }
}

/** A conference day: attendance is only ever read from an attendance record (E6). */
function dayState(journey: Journey, date: string | undefined): StepState {
  const day = date ? (journey.attendance?.dates ?? []).find((d) => d.date === date) : undefined;
  if (!day) return { label: 'Attendance not recorded', tone: 'later' };
  if (day.status === 'attended') return { label: 'Attended', tone: 'done' };
  if (day.status === 'partial') return { label: 'Partly attended', tone: 'done' };
  if (day.status === 'absent') return { label: 'Absent', tone: 'later' };
  return day.closed
    ? { label: 'Attendance not recorded', tone: 'later' }
    : { label: 'Check in on the day', tone: 'now' };
}

/** The follow-up waves together: the soonest thing the delegate can do decides the label. */
function afterState(journey: Journey): StepState {
  const waves = (journey.assessments ?? []).filter(
    (a) => a.stage === 'follow_up' && a.state !== 'not_configured',
  );
  if (waves.length === 0) return { label: 'Opens later', tone: 'later' };
  if (waves.some((w) => w.state === 'open' || w.state === 'draft')) {
    return { label: 'Open now', tone: 'now' };
  }
  const submitted = waves.filter((w) => w.state === 'submitted').length;
  if (submitted === waves.length) return { label: 'All submitted', tone: 'done' };
  if (submitted > 0) return { label: `${submitted} of ${waves.length} submitted`, tone: 'done' };
  return { label: 'Opens later', tone: 'later' };
}

export function JourneyStrip({ event }: { event: Pick<MyEvent, 'id' | 'startsOn' | 'endsOn'> }) {
  const steps = journeyFor(event);
  const [journey, setJourney] = useState<Journey | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Journey>(`/me/events/${event.id}/journey`).then(
      (data) => {
        if (!cancelled) setJourney(data);
      },
      () => {
        // The strip is a summary of what the tabs below show in full: it stays quiet on failure.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  // The conference steps sit between "Before" and "After"; one per event date when there are two.
  const dates = (journey?.attendance?.dates ?? []).map((d) => d.date);
  const stateFor = (index: number): StepState | null => {
    if (!journey) return null;
    if (index === 0) return beforeState(journey);
    if (index === steps.length - 1) return afterState(journey);
    const conferenceIndex = index - 1;
    return dayState(journey, dates[conferenceIndex] ?? dates[0]);
  };

  return (
    <section aria-labelledby="journey-title" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="journey-title" className="font-corporate text-h3 text-corp-ink">
          Your journey
        </h2>
        <span className="text-xs text-corp-muted">{steps.length} steps</span>
      </div>
      <ol className="-mx-gutter flex snap-x gap-3 overflow-x-auto px-gutter pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {steps.map((item, index) => {
          const state = stateFor(index);
          return (
            <li
              key={item.step}
              className="flex min-w-[14rem] snap-start flex-col gap-2 rounded-none border border-corp-line bg-white p-4 md:min-w-0"
            >
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-corp-ink text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                  {item.step}
                </span>
              </div>
              <span className="text-sm font-semibold text-corp-ink">{item.title}</span>
              <span className="text-xs text-corp-muted">{item.note}</span>
              <span
                className={`mt-auto inline-flex w-fit items-center rounded-none px-2 py-0.5 text-xs font-semibold ${
                  state ? TONES[state.tone] : 'bg-corp-surface text-corp-muted'
                }`}
              >
                {state ? state.label : '…'}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
