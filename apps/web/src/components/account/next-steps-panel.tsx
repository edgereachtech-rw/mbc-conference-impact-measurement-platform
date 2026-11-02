'use client';

import { nextSteps, type Journey, type MyEvent, type NextStep } from '@mbc/shared';
import { ArrowRightIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Panel } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { shortEventName } from '@/lib/my-events';

/**
 * `for` is the event the state belongs to, so a change of event reads as loading without setting
 * state inside the effect to reset it.
 */
type State = { for: string } & (
  | { kind: 'loading' }
  | { kind: 'ready'; steps: NextStep[] }
  /** A failure here is not worth an alarm on the dashboard: the panel simply stays away. */
  | { kind: 'unavailable' }
);

/**
 * What to do next, on the way in (task of 2026-11-03).
 *
 * The dashboard showed counts and event cards; whatever a delegate still owed was two taps away
 * inside an event and behind the right tab. This reads the journey of the event in focus and lists
 * the outstanding items, each linking straight to the tab that holds it. One request, for one
 * event: the next upcoming one, or the most recent if the conference has passed.
 */
export function NextStepsPanel({ event }: { event: MyEvent }) {
  const [loaded, setLoaded] = useState<State>({ kind: 'loading', for: event.id });
  const state: State = loaded.for === event.id ? loaded : { kind: 'loading', for: event.id };

  useEffect(() => {
    let cancelled = false;
    apiFetch<Journey>(`/me/events/${event.id}/journey`).then(
      (journey) => {
        if (!cancelled) setLoaded({ kind: 'ready', steps: nextSteps(journey), for: event.id });
      },
      () => {
        if (!cancelled) setLoaded({ kind: 'unavailable', for: event.id });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  if (state.kind === 'unavailable') return null;

  return (
    <section aria-labelledby="next-steps-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="next-steps-title" className="font-corporate text-h3 text-corp-ink">
          What to do next
        </h2>
        <Link
          href={`/account/events/${event.id}`}
          className="text-sm font-semibold text-corp-green-text hover:underline"
        >
          {shortEventName(event.name)}
        </Link>
      </div>

      {state.kind === 'loading' ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            Checking what is waiting for you…
          </p>
        </Panel>
      ) : state.steps.length === 0 ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-corp-text">
            <CheckCircle2Icon className="size-4 shrink-0 text-corp-green-text" aria-hidden="true" />
            Nothing is waiting for you right now. We will email you when the next step opens.
          </p>
        </Panel>
      ) : (
        <ul className="space-y-2">
          {state.steps.map((step) => (
            <li key={step.key}>
              <Link
                href={`/account/events/${event.id}#${step.tab}`}
                className="flex min-h-tap items-center justify-between gap-3 border border-corp-line border-l-4 border-l-corp-accent bg-white p-4 transition-shadow hover:shadow-elevated"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-corp-ink">{step.label}</span>
                  <span className="block text-sm text-corp-muted">{step.hint}</span>
                </span>
                <ArrowRightIcon className="size-4 shrink-0 text-corp-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
