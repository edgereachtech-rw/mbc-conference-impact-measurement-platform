'use client';

import type { EventDetail, EventProfileFields } from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AttendanceManager } from '@/components/admin/attendance/attendance-manager';
import { EventWorkspace } from '@/components/admin/event-workspace';
import { consoleButton } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

import { AssessmentConfig } from './assessment-config';
import { DatePicker } from './date-picker';
import { EventProfileForm } from './event-profile-form';
import { PublishPanel } from './publish-panel';
import { SessionsEditor } from './sessions-editor';

type Tab =
  'profile' | 'dates' | 'sessions' | 'assessments' | 'publish' | 'delegates' | 'attendance';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'profile', label: 'Event profile' },
  { id: 'dates', label: 'Event dates' },
  { id: 'sessions', label: 'Sessions and schedule' },
  { id: 'assessments', label: 'Assessment configuration' },
  { id: 'publish', label: 'Review and publication' },
  { id: 'delegates', label: 'Delegates' },
  { id: 'attendance', label: 'Attendance' },
];

interface EventSettingsProps {
  initialEvent: EventDetail;
}

/**
 * The event management sections (brief section 7) as tabs, plus the delegates and the messages
 * sent to them as a tab of their own. Every save goes to the admin-only API and the returned
 * event replaces the local copy; the page header is refreshed so the name and status it shows
 * stay in step.
 */
export function EventSettings({ initialEvent }: EventSettingsProps) {
  const router = useRouter();
  const [event, setEvent] = useState(initialEvent);
  const [tab, setTab] = useState<Tab>('profile');
  const [dates, setDates] = useState(() => event.dates.map((d) => d.date));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);
  const readOnly = event.status === 'archived';

  function saved(next: EventDetail) {
    setEvent(next);
    setDates(next.dates.map((d) => d.date));
    setFailure(null);
    router.refresh();
  }

  async function saveProfile(profile: EventProfileFields) {
    setBusy(true);
    setFailure(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify(profile),
      });
      saved(result.event);
    } catch (e) {
      setFailure(describeError(e, 'The profile could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDates() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}/dates`, {
        method: 'PUT',
        body: JSON.stringify({ dates }),
      });
      saved(result.event);
    } catch (e) {
      setFailure(describeError(e, 'The dates could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  const locked: Record<string, number> = {};
  for (const s of event.sessions) locked[s.date] = (locked[s.date] ?? 0) + 1;
  const datesChanged = dates.join(',') !== event.dates.map((d) => d.date).join(',');

  return (
    <section aria-label="Event configuration" className="space-y-4">
      <div
        role="tablist"
        aria-label="Event sections"
        className="flex gap-1 overflow-x-auto border-b border-corp-line"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
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
      {readOnly ? (
        <p
          role="note"
          className="rounded-none border border-corp-line bg-corp-accent-soft px-4 py-3 text-sm text-corp-ink"
        >
          This event is archived and read-only. Restore it to draft under Review and publication to
          make changes.
        </p>
      ) : null}
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="rounded-none border border-corp-line bg-white p-4 md:p-6"
      >
        {tab === 'profile' ? (
          <EventProfileForm
            key={event.updatedAt}
            mode="edit"
            code={event.code}
            initial={event}
            busy={busy || readOnly}
            submitLabel="Save profile"
            error={failure}
            onSubmit={(profile) => void saveProfile(profile)}
          />
        ) : null}
        {tab === 'dates' ? (
          <div className="space-y-4">
            <DatePicker value={dates} onChange={setDates} locked={locked} disabled={readOnly} />
            {failure ? (
              <div
                role="alert"
                className="rounded-none border border-brand-danger/40 bg-white p-3 text-sm"
              >
                <p className="font-semibold text-brand-danger">{failure.message}</p>
                {failure.requestId ? (
                  <p className="mt-1 text-xs text-corp-muted">Request id {failure.requestId}</p>
                ) : null}
              </div>
            ) : null}
            {!readOnly ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={busy || !datesChanged}
                  onClick={() => setDates(event.dates.map((d) => d.date))}
                  className={consoleButton({ variant: 'ghost' })}
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  disabled={busy || !datesChanged || dates.length === 0}
                  onClick={() => void saveDates()}
                  className={consoleButton({ variant: 'accent' })}
                >
                  {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                  Save dates
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {tab === 'sessions' ? <SessionsEditor event={event} onSaved={saved} /> : null}
        {tab === 'assessments' ? <AssessmentConfig event={event} onSaved={saved} /> : null}
        {tab === 'publish' ? <PublishPanel event={event} onSaved={saved} /> : null}
        {tab === 'delegates' ? (
          <div className="space-y-8">
            <EventWorkspace eventId={event.id} eventName={event.name} />
          </div>
        ) : null}
        {tab === 'attendance' ? <AttendanceManager event={event} /> : null}
      </div>
    </section>
  );
}
