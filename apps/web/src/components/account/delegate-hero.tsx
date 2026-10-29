import { CalendarDaysIcon, MapPinIcon } from 'lucide-react';

import { ParticipationBadge } from '@/components/badges/participation-badge';
import { event } from '@/config/event';
import type { ParticipationMode } from '@/config/event';

interface DelegateHeroProps {
  displayName: string;
  participationMode?: ParticipationMode;
}

/**
 * Delegate welcome band in the ITTEC event identity (navy, amber): the same surface as the
 * landing hero, so a delegate always knows they are inside the conference, never the admin console.
 */
export function DelegateHero({ displayName, participationMode }: DelegateHeroProps) {
  return (
    <section
      aria-labelledby="delegate-hero-title"
      className="on-dark bg-brand-primary bg-[radial-gradient(ellipse_at_top_right,rgb(255_183_3/0.14),transparent_50%),linear-gradient(160deg,var(--brand-primary),var(--brand-footer))] text-white"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-gutter py-8 md:px-6 md:py-12">
        <p className="font-display text-eyebrow tracking-[0.14em] text-brand-accent uppercase">
          Delegate · {event.shortName}
        </p>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 id="delegate-hero-title" className="text-h1 text-white md:text-[2.5rem]">
              Welcome, {displayName}
            </h1>
            <p className="max-w-prose text-base text-white/85 md:text-lg">
              {event.tagline}. This is your space to record what you take back to work.
            </p>
          </div>
          {participationMode ? (
            <ParticipationBadge
              mode={participationMode}
              className="shrink-0 self-start md:self-end"
            />
          ) : null}
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
            <CalendarDaysIcon
              className="mt-0.5 size-5 shrink-0 text-brand-accent"
              aria-hidden="true"
            />
            <div>
              <dt className="font-display text-eyebrow tracking-[0.14em] text-white/70 uppercase">
                Dates
              </dt>
              <dd className="text-sm font-medium md:text-base">{event.dates.display}</dd>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
            <MapPinIcon className="mt-0.5 size-5 shrink-0 text-brand-accent" aria-hidden="true" />
            <div>
              <dt className="font-display text-eyebrow tracking-[0.14em] text-white/70 uppercase">
                Venue
              </dt>
              <dd className="text-sm font-medium md:text-base">
                {event.venue.name}, {event.venue.city}
              </dd>
            </div>
          </div>
        </dl>
      </div>
    </section>
  );
}

const JOURNEY = [
  { step: 'Before', title: 'Pre-conference check-in', note: 'Opens before the conference' },
  { step: 'Day 1', title: 'Check-in and transfer planning', note: event.dates.start },
  { step: 'Day 2', title: 'Check-in, plan and evaluation', note: event.dates.end },
  { step: 'After', title: 'Follow-ups at 30, 60, 90 days', note: 'Scheduled by M.Bryan' },
] as const;

/** The delegate journey as a horizontal strip on phones and a four-up row on larger screens. */
export function JourneyStrip() {
  return (
    <section aria-labelledby="journey-title" className="space-y-3">
      <h2
        id="journey-title"
        className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase"
      >
        Your journey
      </h2>
      <ol className="-mx-gutter flex snap-x gap-3 overflow-x-auto px-gutter pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {JOURNEY.map((item, index) => (
          <li
            key={item.step}
            className="flex min-w-[14rem] snap-start flex-col gap-1 rounded-lg border border-brand-line bg-card p-4 shadow-card md:min-w-0"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-accent font-display text-sm font-semibold text-brand-primary">
              {index + 1}
            </span>
            <span className="font-display text-eyebrow tracking-[0.14em] text-brand-muted uppercase">
              {item.step}
            </span>
            <span className="font-medium text-brand-primary">{item.title}</span>
            <span className="text-sm text-brand-muted">{item.note}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
