import { overallAttendanceLabels, type MyEvent } from '@mbc/shared';

import { StatusPill } from '@/components/admin/page-header';
import {
  attendanceFormatLabel,
  capacityLabel,
  formatDay,
  formatEventDates,
  formatLabel,
} from '@/lib/my-events';

import { AssessmentsPanel } from './assessments-panel';
import { AttendanceCodes } from './attendance-codes';
import { JourneyStrip } from './journey-strip';

/**
 * One event as the API serves it to the delegate: the event facts, their own registration, the
 * attendance line (only ever from an attendance record) and the journey ahead.
 */
export function EventDetail({ event, contactEmail }: { event: MyEvent; contactEmail: string }) {
  const r = event.registration;
  return (
    <div className="space-y-8">
      <section aria-labelledby="event-facts-title" className="space-y-3">
        <h2 id="event-facts-title" className="font-corporate text-h3 text-corp-ink">
          Event
        </h2>
        <dl className="grid gap-4 rounded-none border border-corp-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
          <Fact
            label="Dates"
            value={formatEventDates(event.startsOn, event.endsOn)}
            hint={event.timezone}
          />
          <Fact
            label={event.location ? 'Venue' : 'Where'}
            value={event.location ?? formatLabel[event.format]}
          />
          <Fact label="Format" value={formatLabel[event.format]} />
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              Status
            </dt>
            <dd className="mt-1">
              <StatusPill tone={event.period === 'upcoming' ? 'positive' : 'neutral'}>
                {event.period === 'upcoming' ? 'Upcoming' : 'Past'}
              </StatusPill>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="event-registration-title" className="space-y-3">
        <h2 id="event-registration-title" className="font-corporate text-h3 text-corp-ink">
          Your registration
        </h2>
        <dl className="grid gap-4 rounded-none border border-corp-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              Registration
            </dt>
            <dd className="mt-1">
              <StatusPill tone={r.status === 'active' ? 'positive' : 'attention'}>
                {r.status === 'active' ? 'Registered' : 'Test registration'}
              </StatusPill>
            </dd>
          </div>
          <Fact label="Taking part" value={attendanceFormatLabel[r.attendanceFormat]} />
          <Fact label="Organisation" value={r.organisation} />
          <Fact label="Job title" value={r.jobTitle} />
          <Fact label="Country" value={r.country} />
          <Fact label="Capacity" value={capacityLabel[r.capacity]} />
          <Fact label="First signed in" value={r.signedUpAt ? formatDay(r.signedUpAt) : null} />
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              Attendance
            </dt>
            <dd className="mt-1">
              <StatusPill
                tone={
                  event.attendance.status === 'attended' || event.attendance.status === 'partial'
                    ? 'positive'
                    : event.attendance.status === 'absent'
                      ? 'attention'
                      : 'neutral'
                }
              >
                {overallAttendanceLabels[event.attendance.status]}
              </StatusPill>
              <span className="mt-1 block text-xs text-corp-muted">
                Recorded by the organisers at the event. Your codes are below.
              </span>
            </dd>
          </div>
        </dl>
        <p className="text-sm text-corp-text">
          Spotted a mistake? Write to{' '}
          <a
            href={`mailto:${contactEmail}`}
            className="font-semibold text-corp-green-text underline"
          >
            {contactEmail}
          </a>
          ; the organisers correct registrations and every change is recorded.
        </p>
      </section>

      <section aria-labelledby="event-attendance-title" className="space-y-3">
        <h2 id="event-attendance-title" className="font-corporate text-h3 text-corp-ink">
          Your attendance
        </h2>
        <AttendanceCodes eventId={event.id} />
      </section>

      <section aria-labelledby="event-assessments-title" className="space-y-3">
        <h2 id="event-assessments-title" className="font-corporate text-h3 text-corp-ink">
          Your assessments
        </h2>
        <AssessmentsPanel eventId={event.id} timezone={event.timezone} />
      </section>

      {event.period === 'upcoming' ? <JourneyStrip event={event} /> : null}
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-corp-ink">
        {value ?? <span className="text-corp-muted">Not provided</span>}
      </dd>
      {hint ? <dd className="text-xs text-corp-muted">{hint}</dd> : null}
    </div>
  );
}
