'use client';

import { nextSteps, type Journey, type MyEvent, type NextStep } from '@mbc/shared';
import { ArrowRightIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { consoleButton, Panel } from '@/components/console/page';
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

/** The verb on the one big button: what the delegate does when they tap it. */
function callToAction(step: NextStep): string {
  if (step.tab === 'attendance') return 'Cclick to view your  QR codes';
  return step.started ? 'Continue' : 'Start now';
}

/**
 * What to do next, on the way in (task of 2026-11-03).
 *
 * The dashboard showed counts and event cards; whatever a delegate still owed was two taps away
 * inside an event and behind the right tab. This reads the journey of the event in focus and lists
 * the outstanding items, each linking straight to the tab that holds it. One request, for one
 * event: the next upcoming one, or the most recent if the conference has passed.
 *
 * The first outstanding item is the one thing the delegate should do now, so it is a large card
 * with the only accent button on the screen rather than one row among several (2026-11-06). For
 * a delegate arriving before the conference that is the pre-conference assessment: `nextSteps`
 * lists assessments first, in stage order, so it leads whenever it is open.
 */
export function NextStepsPanel({ event }: { event: MyEvent }) {
  const [loaded, setLoaded] = useState<State>({ kind: 'loading', for: event.id });
  const state: State = loaded.for === event.id ? loaded : { kind: 'loading', for: event.id };

  useEffect(() => {
    let cancelled = false;
    // The API wraps the journey (`{ journey }`). The catch follows the success branch so a body of
    // the wrong shape ends as "unavailable" rather than a spinner that never stops.
    apiFetch<{ journey: Journey }>(`/me/events/${event.id}/journey`)
      .then(({ journey }) => {
        if (!cancelled) setLoaded({ kind: 'ready', steps: nextSteps(journey), for: event.id });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ kind: 'unavailable', for: event.id });
      });
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  if (state.kind === 'unavailable') return null;

  const [first, ...rest] = state.kind === 'ready' ? state.steps : [];
  const eventName = shortEventName(event.name);
  // Before the conference the pre-conference assessment leads, and the heading says what it is
  // for in the delegate's own terms (2026-11-06). Any other first step keeps the plain heading.
  const heading = first?.key.startsWith('assessment:pre_conference:')
    ? 'First thing, create your expectation'
    : 'What to do next';

  return (
    <section aria-labelledby="next-steps-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="next-steps-title" className="font-corporate text-h3 text-corp-ink">
          {heading}
        </h2>
        <Link
          href={`/account/events/${event.id}`}
          className="text-sm font-semibold text-corp-green-text hover:underline"
        >
          {eventName}
        </Link>
      </div>

      {state.kind === 'loading' ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            Checking what is waiting for you…
          </p>
        </Panel>
      ) : !first ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-corp-text">
            <CheckCircle2Icon className="size-4 shrink-0 text-corp-green-text" aria-hidden="true" />
            Nothing is waiting for you right now. We will email you when the next step opens.
          </p>
        </Panel>
      ) : (
        <>
          <article
            aria-labelledby="start-here-title"
            className="border-2 border-corp-accent bg-white p-5 shadow-elevated md:p-6"
          >
            <p className="inline-flex max-w-full items-center rounded-none bg-corp-accent px-2.5 py-1 text-sm font-bold tracking-[0.08em] text-corp-ink uppercase shadow-button">
              {first.started ? 'Continue where you left off' : 'Start here'} · {eventName}
            </p>
            <h3 id="start-here-title" className="mt-2 font-corporate text-h2 text-corp-ink">
              {first.label}
            </h3>
            <p className="mt-2 max-w-prose text-sm text-corp-text">{first.hint}</p>
            <Link
              href={`/account/events/${event.id}#${first.tab}`}
              aria-label={`${callToAction(first)}: ${first.label}`}
              className={`${consoleButton({ variant: 'accent' })} mt-4 w-full sm:w-auto`}
            >
              {callToAction(first)}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </article>

          {rest.length > 0 ? (
            <p className="pt-1 text-sm font-semibold text-corp-muted">Also waiting for you</p>
          ) : null}
        </>
      )}

      {rest.length > 0 ? (
        <ul className="space-y-2">
          {rest.map((step) => (
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
      ) : null}
    </section>
  );
}
