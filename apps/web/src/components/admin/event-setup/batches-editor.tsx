'use client';

import type { EventBatchView, EventDetail } from '@mbc/shared';
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import { consoleButton, Panel } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { formatDateShort } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface Props {
  event: EventDetail;
  readOnly: boolean;
  onSaved: (event: EventDetail) => void;
}

/**
 * Batches (decision 2026-11-19): named groups of delegates, each on one of the event's days.
 * A delegate in a batch has that day alone for check-in, attendance and reflection; a
 * delegate in no batch has every day. Delegates are put in a batch from the Delegates tab, by
 * hand or with a whole import file.
 */
export function BatchesEditor({ event, readOnly, onSaved }: Props) {
  const id = useId();
  const batches = event.batches ?? [];
  const [name, setName] = useState('');
  const [eventDateId, setEventDateId] = useState(event.dates[0]?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const disabled = readOnly || busy !== null || event.dates.length === 0;

  async function run(key: string, action: () => Promise<{ event: EventDetail }>) {
    setBusy(key);
    setProblem(null);
    try {
      const result = await action();
      onSaved(result.event);
      return true;
    } catch (e) {
      setProblem(describeError(e, 'The batch could not be saved.').message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const dateId = eventDateId || event.dates[0]?.id;
    if (!name.trim() || !dateId) {
      setProblem('Name the batch and choose its day.');
      return;
    }
    const ok = await run('add', () =>
      apiFetch<{ event: EventDetail }>(`/events/${event.id}/batches`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), eventDateId: dateId }),
      }),
    );
    if (ok) setName('');
  }

  function move(batch: EventBatchView, nextDateId: string) {
    if (nextDateId === batch.eventDateId) return;
    void run(batch.id, () =>
      apiFetch<{ event: EventDetail }>(`/events/${event.id}/batches/${batch.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ eventDateId: nextDateId }),
      }),
    );
  }

  function rename(batch: EventBatchView, nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === batch.name) return;
    void run(batch.id, () =>
      apiFetch<{ event: EventDetail }>(`/events/${event.id}/batches/${batch.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      }),
    );
  }

  function remove(batch: EventBatchView) {
    const who =
      batch.delegates === 0
        ? ''
        : ` Its ${batch.delegates} delegate${batch.delegates === 1 ? '' : 's'} stay in the event, on every day.`;
    if (!window.confirm(`Delete “${batch.name}”?${who}`)) return;
    void run(batch.id, () =>
      apiFetch<{ event: EventDetail }>(`/events/${event.id}/batches/${batch.id}`, {
        method: 'DELETE',
      }),
    );
  }

  const input =
    'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm disabled:bg-corp-surface';

  return (
    <Panel>
      <h3 className="font-corporate text-base font-semibold text-corp-ink">Batches</h3>
      <p className="mt-1 text-sm text-corp-muted">
        For an event that runs the same day for different groups: each batch comes on one of the
        dates above. A delegate in a batch gets that day&rsquo;s check-in code, attendance and
        reflection only; a delegate in no batch takes part on every day. Assign delegates on the
        Delegates tab, one by one or with a whole import file.
      </p>
      {event.dates.length === 0 ? (
        <p className="mt-3 text-sm text-corp-muted">Save the event dates first.</p>
      ) : null}
      {batches.length > 0 ? (
        <ul aria-label="Batches" className="mt-4 divide-y divide-corp-line border border-corp-line">
          {batches.map((batch) => (
            <li
              key={batch.id}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3"
            >
              <input
                aria-label={`Name of ${batch.name}`}
                defaultValue={batch.name}
                maxLength={80}
                disabled={disabled}
                onBlur={(e) => rename(batch, e.target.value)}
                className={`${input} sm:max-w-xs`}
              />
              <NativeSelect
                aria-label={`Day of ${batch.name}`}
                value={batch.eventDateId}
                disabled={disabled}
                onChange={(e) => move(batch, e.target.value)}
                className="rounded-none sm:w-56"
              >
                {event.dates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {formatDateShort(d.date)}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm text-corp-muted sm:ml-auto">
                {batch.delegates} delegate{batch.delegates === 1 ? '' : 's'}
              </span>
              {!readOnly ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => remove(batch)}
                  aria-label={`Delete ${batch.name}`}
                  className={consoleButton({ variant: 'ghost', size: 'sm' })}
                >
                  {busy === batch.id ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2Icon aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!readOnly ? (
        <form
          aria-label="New batch"
          onSubmit={(e) => void add(e)}
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1">
            <label htmlFor={`${id}-name`} className="text-sm font-semibold text-corp-ink">
              Batch name
            </label>
            <input
              id={`${id}-name`}
              value={name}
              maxLength={80}
              disabled={disabled}
              placeholder={`Batch ${batches.length + 1}`}
              onChange={(e) => setName(e.target.value)}
              className={input}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-date`} className="text-sm font-semibold text-corp-ink">
              Day
            </label>
            <NativeSelect
              id={`${id}-date`}
              value={eventDateId || event.dates[0]?.id || ''}
              disabled={disabled}
              onChange={(e) => setEventDateId(e.target.value)}
              className="rounded-none sm:w-56"
            >
              {event.dates.map((d) => (
                <option key={d.id} value={d.id}>
                  {formatDateShort(d.date)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <button
            type="submit"
            disabled={disabled}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy === 'add' ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <PlusIcon aria-hidden="true" />
            )}
            Add batch
          </button>
        </form>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
    </Panel>
  );
}
