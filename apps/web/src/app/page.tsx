import {
  CalendarDaysIcon,
  ClipboardCheckIcon,
  MapPinIcon,
  RepeatIcon,
  TargetIcon,
} from 'lucide-react';
import Link from 'next/link';

import { MbryanLogo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui/button';
import { event } from '@/config/event';
import { cn } from '@/lib/utils';

const JOURNEY = [
  {
    step: 'Before',
    title: 'Set your intent',
    text: 'A short pre-conference check-in on what you want to learn and do differently.',
    icon: <TargetIcon className="size-5" aria-hidden="true" />,
  },
  {
    step: 'During',
    title: 'Build your Transfer Plan',
    text: 'Daily check-ins and one plan for the actions you will take back to work.',
    icon: <ClipboardCheckIcon className="size-5" aria-hidden="true" />,
  },
  {
    step: 'After',
    title: 'Show what changed',
    text: 'Brief follow-ups at 30, 60, 90 and 180 days turn learning into measured impact.',
    icon: <RepeatIcon className="size-5" aria-hidden="true" />,
  },
] as const;

/** Public landing page: the conference, what the platform does for delegates, and sign-in. */
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="on-dark bg-brand-primary bg-[radial-gradient(ellipse_at_top_left,rgb(255_255_255/0.08),transparent_55%),linear-gradient(160deg,var(--brand-primary),var(--brand-footer))] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-gutter py-12 md:px-6 md:py-20 lg:grid-cols-[3fr_2fr] lg:items-end lg:py-24">
          <div className="max-w-3xl space-y-5">
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
            <p className="max-w-2xl text-lg text-white/85 md:text-xl">
              {event.tagline}. This platform follows every delegate from a pre-conference check-in,
              through the conference days, to follow-ups afterwards, so that learning turns into
              measurable results at work.
            </p>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
              <Link
                href="/signin"
                className={cn(buttonVariants({ variant: 'cta', size: 'lg' }), 'w-full sm:w-auto')}
              >
                Sign in
              </Link>
              <p className="text-sm text-white/75">
                For registered delegates and the conference team. Use the email you registered with.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <span className="inline-block bg-brand-accent px-5 py-2 font-display text-lg font-semibold tracking-[0.14em] text-brand-primary uppercase">
                {event.format.label}
              </span>
              <p className="text-sm font-medium text-white/90 md:text-base">{event.format.note}</p>
            </div>
            <dl className="grid gap-3">
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
                <MapPinIcon
                  className="mt-0.5 size-5 shrink-0 text-brand-accent"
                  aria-hidden="true"
                />
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
          </div>
        </div>
      </section>

      <section aria-labelledby="journey-heading" className="bg-surface-raised">
        <div className="mx-auto max-w-6xl px-gutter py-12 md:px-6 md:py-16">
          <div className="max-w-2xl space-y-2">
            <p className="font-display text-eyebrow tracking-[0.14em] text-brand-secondary uppercase">
              How it works
            </p>
            <h2 id="journey-heading" className="text-h2">
              Three moments, one record of your impact
            </h2>
            <p className="text-base text-brand-muted">
              Everything takes a few minutes on your phone. Attendance is recorded at the
              conference; nothing is claimed on your behalf.
            </p>
          </div>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {JOURNEY.map((item, index) => (
              <li
                key={item.step}
                className="flex flex-col gap-3 rounded-lg border border-brand-line bg-card p-5 shadow-card"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white">
                    {item.icon}
                  </span>
                  <span className="font-display text-eyebrow tracking-[0.14em] text-brand-muted uppercase">
                    {index + 1} · {item.step}
                  </span>
                </div>
                <h3 className="text-h3">{item.title}</h3>
                <p className="text-sm text-brand-muted">{item.text}</p>
              </li>
            ))}
          </ol>
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
            className="inline-flex min-h-tap shrink-0 items-center justify-center rounded-none bg-corp-green px-6 text-sm font-semibold text-white transition-colors hover:bg-corp-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-corp-green"
          >
            Visit mbryanconsultinggroup.com
          </a>
        </div>
      </section>
    </main>
  );
}
