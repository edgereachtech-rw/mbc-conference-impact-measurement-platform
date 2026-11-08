'use client';

import {
  transferPlanVisibilities,
  transferPlanVisibilityLabels,
  transferPlanVisible,
  type EventDetail,
  type TransferPlanVisibility,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { consoleButton } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { formatInstant, isoToZonedLocal, zonedLocalToIso } from '@/lib/events';
import { describeError } from '@/lib/imports';

/**
 * Whether delegates see Transfer Planning (2026-11-08): shown, hidden, or hidden until a date
 * and time, for example until the first Transfer Planning session starts. Hidden means no
 * "Transfer plans" tab, no next step on the dashboard, no reminders and no "where your actions
 * stand" step in the follow-ups. Nothing is deleted: the plans and their data come back as they
 * were when Transfer Planning is shown again. The organisers' pages are not affected.
 */
export function TransferPlanVisibilitySetting({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const [visibility, setVisibility] = useState<TransferPlanVisibility>(
    event.transferPlanVisibility,
  );
  const [shownFrom, setShownFrom] = useState(
    isoToZonedLocal(event.transferPlanShownFrom, event.timezone),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const id = useId();
  const readOnly = event.status === 'archived';
  const visibleNow = transferPlanVisible(event, new Date());

  async function save() {
    const at = visibility === 'scheduled' ? zonedLocalToIso(shownFrom, event.timezone) : null;
    if (visibility === 'scheduled' && !at) {
      setProblem('Enter the date and time from which delegates see Transfer Planning.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ transferPlanVisibility: visibility, transferPlanShownFrom: at }),
      });
      onSaved(result.event);
      setSaved(
        visibility === 'shown'
          ? 'Transfer Planning is shown to delegates.'
          : visibility === 'hidden'
            ? 'Transfer Planning is hidden from delegates. Their plans are kept.'
            : `Transfer Planning is hidden until ${formatInstant(at, event.timezone)}.`,
      );
    } catch (err) {
      setProblem(describeError(err, 'The setting could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Transfer Planning visibility"
      className="space-y-3 border border-corp-line bg-white p-4"
    >
      <div>
        <h3 className="font-semibold text-corp-ink">Transfer Planning for delegates</h3>
        <p className="text-sm text-corp-text">
          Hide Transfer Planning from delegates for the whole event, or until a date and time such
          as the start of the first Transfer Planning session. Hidden means no tab on their event
          page, no step on their dashboard, no reminders and no action statuses in the follow-ups.
          Their plans and everything recorded on them are kept and come back when it is shown again.
          Your own pages here are not affected.
        </p>
        <p className="mt-1 text-xs text-corp-muted">
          Right now: {visibleNow ? 'shown to delegates' : 'hidden from delegates'}
          {event.transferPlanVisibility === 'scheduled' && event.transferPlanShownFrom
            ? ` (shown from ${formatInstant(event.transferPlanShownFrom, event.timezone)})`
            : ''}
          .
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-visibility`} className="text-sm font-semibold text-corp-ink">
            Delegates see Transfer Planning
          </label>
          <NativeSelect
            id={`${id}-visibility`}
            value={visibility}
            disabled={busy || readOnly}
            onChange={(e) => {
              setVisibility(e.target.value as TransferPlanVisibility);
              setProblem(null);
              setSaved(null);
            }}
            className="rounded-none border-corp-line"
          >
            {transferPlanVisibilities.map((v) => (
              <option key={v} value={v}>
                {transferPlanVisibilityLabels[v]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {visibility === 'scheduled' ? (
          <div className="space-y-1">
            <label htmlFor={`${id}-from`} className="text-sm font-semibold text-corp-ink">
              Shown from
            </label>
            <p className="text-xs text-corp-muted">Time in {event.timezone}.</p>
            <input
              id={`${id}-from`}
              type="datetime-local"
              value={shownFrom}
              disabled={busy || readOnly}
              onChange={(e) => {
                setShownFrom(e.target.value);
                setProblem(null);
                setSaved(null);
              }}
              className="h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
            />
          </div>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-xs text-corp-green-text">
          {saved}
        </p>
      ) : null}
      {!readOnly ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className={consoleButton({ variant: 'secondary' })}
        >
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          Save visibility
        </button>
      ) : null}
    </section>
  );
}
