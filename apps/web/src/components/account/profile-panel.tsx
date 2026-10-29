'use client';

import type { MyEvent } from '@mbc/shared';
import Link from 'next/link';

import { StatusPill } from '@/components/admin/page-header';
import { attendanceFormatLabel, capacityLabel, formatDay, formatEventDates } from '@/lib/my-events';

import { MyEventsStatus, useMyEvents } from './my-events';

interface Props {
  displayName: string;
  email: string;
  initialEvents?: MyEvent[] | null;
  contactEmail: string;
}

/**
 * The delegate's profile: identity as the platform holds it, then the details of each
 * registration as imported for that event. Nothing here is editable; the note says who to ask.
 */
export function ProfilePanel({ displayName, email, initialEvents, contactEmail }: Props) {
  const { state, retry } = useMyEvents(initialEvents);
  return (
    <div className="space-y-8">
      <section aria-labelledby="profile-identity-title" className="space-y-3">
        <h2 id="profile-identity-title" className="font-corporate text-h3 text-corp-ink">
          Your account
        </h2>
        <div className="rounded-none border border-corp-line bg-white p-4 md:p-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                Name
              </dt>
              <dd className="mt-1 text-sm text-corp-ink">{displayName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                Sign-in email
              </dt>
              <dd className="mt-1 text-sm break-all text-corp-ink">{email}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-corp-text">
            You sign in with a link or code sent to this address. To change it, write to{' '}
            <a
              href={`mailto:${contactEmail}`}
              className="font-semibold text-corp-green-text underline"
            >
              {contactEmail}
            </a>
            ; the organisers verify the request before anything changes.
          </p>
        </div>
      </section>

      <section aria-labelledby="profile-registrations-title" className="space-y-3">
        <h2 id="profile-registrations-title" className="font-corporate text-h3 text-corp-ink">
          Your registrations
        </h2>
        {state.kind !== 'ready' || state.events.length === 0 ? (
          <MyEventsStatus state={state} contactEmail={contactEmail} onRetry={retry} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {state.events.map((ev) => (
              <li key={ev.id} className="flex">
                <article
                  aria-label={ev.name}
                  className="flex w-full flex-col gap-3 rounded-none border border-corp-line bg-white p-4 md:p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={ev.period === 'upcoming' ? 'positive' : 'neutral'}>
                      {ev.period === 'upcoming' ? 'Upcoming' : 'Past'}
                    </StatusPill>
                    <StatusPill tone="neutral">
                      {attendanceFormatLabel[ev.registration.attendanceFormat]}
                    </StatusPill>
                    <StatusPill
                      tone={ev.registration.status === 'active' ? 'positive' : 'attention'}
                    >
                      {ev.registration.status === 'active' ? 'Registered' : 'Test registration'}
                    </StatusPill>
                  </div>
                  <div>
                    <h3 className="font-corporate text-base font-semibold text-corp-ink">
                      {ev.name}
                    </h3>
                    <p className="text-sm text-corp-muted">
                      {formatEventDates(ev.startsOn, ev.endsOn)}
                    </p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Organisation" value={ev.registration.organisation} />
                    <Field label="Job title" value={ev.registration.jobTitle} />
                    <Field label="Country" value={ev.registration.country} />
                    <Field label="Capacity" value={capacityLabel[ev.registration.capacity]} />
                    <Field
                      label="First signed in"
                      value={
                        ev.registration.signedUpAt ? formatDay(ev.registration.signedUpAt) : null
                      }
                    />
                  </dl>
                  <div className="mt-auto border-t border-corp-line pt-3">
                    <Link
                      href={`/account/events/${ev.id}`}
                      className="text-sm font-semibold text-corp-green-text hover:underline"
                    >
                      View event
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-corp-text">
          Spotted a mistake in a registration? The organisers correct it for you; every change is
          recorded.
        </p>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-corp-ink">
        {value ?? <span className="text-corp-muted">Not provided</span>}
      </dd>
    </div>
  );
}
