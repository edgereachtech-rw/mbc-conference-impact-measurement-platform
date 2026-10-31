'use client';

import { overallAttendanceLabels, type MyEvent } from '@mbc/shared';
import { useState, useSyncExternalStore } from 'react';

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
import { ReflectionsPanel } from './reflections-panel';
import { SessionFeedbackList } from './session-feedback-list';
import { TransferPlanPanel } from './transfer-plan-panel';

type Tab = 'overview' | 'assessments' | 'attendance' | 'reflections' | 'feedback' | 'transfer-plan';

/** In journey order: before the event, at the event, after it. */
const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'overview', label: 'Overview', hint: 'The event and your registration' },
  { id: 'assessments', label: 'Assessments', hint: 'Before, during and after the event' },
  { id: 'attendance', label: 'Attendance', hint: 'Your check-in codes and record' },
  { id: 'reflections', label: 'Daily reflections', hint: 'A short reflection per day' },
  { id: 'feedback', label: 'Session feedback', hint: 'Feedback on sessions you attended' },
  { id: 'transfer-plan', label: 'Transfer plan', hint: 'What you will do differently' },
];

const tabIds = new Set<string>(TABS.map((t) => t.id));
const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = () => window.location.hash.replace(/^#/, '');

/**
 * One event as the API serves it to the delegate, arranged in tabs: the overview (event facts,
 * registration, journey) first, then one tab per record the delegate owns. Links such as the
 * reminder email's `#transfer-plan` open that tab directly; choosing a tab updates the address
 * so a reload keeps it. The attendance line only ever comes from an attendance record.
 */
export function EventDetail({ event, contactEmail }: { event: MyEvent; contactEmail: string }) {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '');
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab: Tab = chosen ?? (tabIds.has(hash) ? (hash as Tab) : 'overview');

  function choose(next: Tab) {
    setChosen(next);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', next === 'overview' ? '#' : `#${next}`);
    }
  }

  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Your records for this event"
        className="-mx-gutter flex gap-1 overflow-x-auto border-b border-corp-line px-gutter md:mx-0 md:px-0"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => choose(t.id)}
            className={
              tab === t.id
                ? '-mb-px shrink-0 border-b-2 border-corp-accent px-3 py-3 text-sm font-semibold whitespace-nowrap text-corp-ink'
                : 'shrink-0 border-b-2 border-transparent px-3 py-3 text-sm font-medium whitespace-nowrap text-corp-muted hover:text-corp-ink'
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-6">
        {tab !== 'overview' ? (
          <div>
            <h2 className="font-corporate text-h3 text-corp-ink">{current.label}</h2>
            <p className="text-sm text-corp-muted">{current.hint}</p>
          </div>
        ) : null}
        {tab === 'overview' ? <Overview event={event} contactEmail={contactEmail} /> : null}
        {tab === 'assessments' ? (
          <AssessmentsPanel eventId={event.id} timezone={event.timezone} />
        ) : null}
        {tab === 'attendance' ? <AttendanceCodes eventId={event.id} /> : null}
        {tab === 'reflections' ? (
          <ReflectionsPanel eventId={event.id} timezone={event.timezone} />
        ) : null}
        {tab === 'feedback' ? (
          <SessionFeedbackList eventId={event.id} timezone={event.timezone} />
        ) : null}
        {tab === 'transfer-plan' ? (
          <TransferPlanPanel eventId={event.id} timezone={event.timezone} />
        ) : null}
      </div>
    </div>
  );
}

function Overview({ event, contactEmail }: { event: MyEvent; contactEmail: string }) {
  const r = event.registration;
  const attendanceTone =
    event.attendance.status === 'attended' || event.attendance.status === 'partial'
      ? 'positive'
      : event.attendance.status === 'absent'
        ? 'attention'
        : 'neutral';
  return (
    <>
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
              <StatusPill tone={attendanceTone}>
                {overallAttendanceLabels[event.attendance.status]}
              </StatusPill>
              <span className="mt-1 block text-xs text-corp-muted">
                Recorded by the organisers at the event. Your codes are under Attendance.
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

      {event.period === 'upcoming' ? <JourneyStrip event={event} /> : null}
    </>
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
