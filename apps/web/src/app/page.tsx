import { CalendarDaysIcon, MapPinIcon } from 'lucide-react';
import Link from 'next/link';

import { MbryanLogo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';
import { event } from '@/config/event';
import { cn } from '@/lib/utils';

/** Public landing page: theme, dates, venue, hybrid label and the sign-in entry point. */
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="on-dark bg-brand-primary bg-[radial-gradient(ellipse_at_top_left,rgb(255_255_255/0.08),transparent_55%),linear-gradient(160deg,var(--brand-primary),var(--brand-footer))] text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-gutter py-12 md:px-6 md:py-20 lg:py-24">
          <div className="max-w-3xl space-y-4">
            <p className="font-display text-eyebrow tracking-[0.14em] text-brand-accent uppercase">
              Theme: {event.theme}
            </p>
            <h1 className="font-display text-display font-bold tracking-wide text-white uppercase md:text-[4.5rem] md:leading-[1.05] lg:text-[5.5rem]">
              {event.shortName}
            </h1>
            <p className="text-lg font-medium text-white/95 md:text-xl">{event.fullName}</p>
            <p className="inline-block rounded-md bg-brand-secondary px-4 py-2 text-base font-semibold text-white md:text-lg">
              {event.strapline}
            </p>
            <p className="max-w-2xl text-lg text-white/85 md:text-xl">{event.tagline}</p>
          </div>

          <div className="space-y-2">
            <span className="inline-block bg-brand-accent px-5 py-2 font-display text-lg font-semibold tracking-[0.14em] text-brand-primary uppercase">
              {event.format.label}
            </span>
            <p className="text-sm font-medium text-white/90 md:text-base">{event.format.note}</p>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 md:max-w-2xl">
            <div className="flex items-start gap-3 rounded-lg border border-white/15 bg-white/5 p-4">
              <CalendarDaysIcon
                className="mt-0.5 size-5 shrink-0 text-brand-accent"
                aria-hidden="true"
              />
              <div>
                <dt className="font-display text-eyebrow tracking-[0.14em] text-white/70 uppercase">
                  Dates
                </dt>
                <dd className="text-base font-medium">{event.dates.display}</dd>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-white/15 bg-white/5 p-4">
              <MapPinIcon className="mt-0.5 size-5 shrink-0 text-brand-accent" aria-hidden="true" />
              <div>
                <dt className="font-display text-eyebrow tracking-[0.14em] text-white/70 uppercase">
                  Venue
                </dt>
                <dd className="text-base font-medium">
                  {event.venue.name}, {event.venue.area}, {event.venue.city}
                </dd>
              </div>
            </div>
          </dl>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signin"
              className={cn(buttonVariants({ variant: 'cta', size: 'lg' }), 'w-full sm:w-auto')}
            >
              Sign in
            </Link>
            <p className="text-sm text-white/75">
              For registered delegates. Use the email you registered with.
            </p>
          </div>
        </div>
      </section>

      {/* Organiser band: M.Bryan corporate identity (slate ink, emerald actions, Inter). */}
      <section
        aria-labelledby="organiser-heading"
        className="border-t border-corp-line bg-corp-surface font-corporate text-corp-text"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-gutter py-10 md:flex-row md:items-center md:justify-between md:px-6 md:py-12">
          <div className="flex items-start gap-4">
            <a
              href={event.organiser.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="M.Bryan Consulting Limited website (opens in a new tab)"
              className="flex min-h-tap shrink-0 items-center rounded-md"
            >
              <MbryanLogo className="h-12 md:h-14" />
            </a>
            <div className="space-y-1">
              <p className="text-xs font-semibold tracking-[0.14em] text-corp-green-text uppercase">
                Organised by
              </p>
              <h2 id="organiser-heading" className="font-corporate text-h3 text-corp-ink">
                M.Bryan Consulting Limited
              </h2>
              <p className="max-w-prose text-sm leading-relaxed md:text-base">
                Training transfer effectiveness specialists: turning training into measurable
                workplace performance, return on expectations and return on investment.
              </p>
            </div>
          </div>
          <a
            href={event.organiser.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-tap shrink-0 items-center justify-center rounded-full bg-corp-green px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-corp-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-corp-green"
          >
            Visit mbryanconsultinggroup.com
          </a>
        </div>
      </section>
    </main>
  );
}
