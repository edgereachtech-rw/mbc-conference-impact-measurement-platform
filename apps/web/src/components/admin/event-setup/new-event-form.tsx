'use client';

import type { EventDetail, EventProfileFields } from '@mbc/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

import { DatePicker } from './date-picker';
import { EventProfileForm } from './event-profile-form';

/**
 * Creating an event (brief sections 3 and 4): the profile and at least one date in one step.
 * Sessions, assessment stages and publication follow on the event's own page.
 */
export function NewEventForm() {
  const router = useRouter();
  const [dates, setDates] = useState<string[]>([]);
  const [datesError, setDatesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);

  async function create(profile: EventProfileFields) {
    if (dates.length === 0) {
      setDatesError('Select at least one event date.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>('/events', {
        method: 'POST',
        body: JSON.stringify({ ...profile, dates }),
      });
      router.push(`/admin/events/${result.event.id}`);
    } catch (e) {
      setFailure(describeError(e, 'The event could not be created.'));
      setBusy(false);
    }
  }

  return (
    <EventProfileForm
      mode="create"
      busy={busy}
      submitLabel="Create event"
      error={failure}
      onSubmit={(profile) => void create(profile)}
    >
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          Event dates
        </legend>
        <DatePicker
          value={dates}
          onChange={(next) => {
            setDates(next);
            setDatesError(null);
          }}
          disabled={busy}
        />
        {datesError ? (
          <p role="alert" className="text-xs text-brand-danger">
            {datesError}
          </p>
        ) : null}
      </fieldset>
    </EventProfileForm>
  );
}
