'use client';

import { CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import {
  describeError,
  permittedActions,
  reasonLabel,
  resolutionActionHelp,
  resolutionActionLabels,
  resolutionLabels,
  type ResolutionAction,
  type ResolutionResult,
  type StoredRow,
} from '@/lib/imports';

interface ConflictQueueProps {
  conflicts: StoredRow[];
  /** Called after a decision was applied so the caller refreshes the queue and the history. */
  onResolved: (result: ResolutionResult) => void;
}

/** Open conflicts of the event with one decision form per row (D5 valid actions). */
export function ConflictQueue({ conflicts, onResolved }: ConflictQueueProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (conflicts.length === 0) {
    return <p className="text-sm text-brand-muted">No open conflicts for this event.</p>;
  }
  return (
    <ul
      className="divide-y divide-brand-line rounded-lg border border-brand-line bg-card"
      aria-label="Open conflicts"
    >
      {conflicts.map((row) => (
        <li key={row.id} className="space-y-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="font-medium text-brand-text">
                Row {row.rowNumber}: {row.values?.name ?? ''}{' '}
                <span className="font-normal text-brand-muted">{row.values?.email ?? ''}</span>
              </p>
              <p className="text-brand-muted">
                {reasonLabel({
                  outcome: 'conflict',
                  reasonCode: row.reasonCode,
                  reasonDetail: row.reasonDetail,
                })}
              </p>
              {row.conflict?.existing && typeof row.conflict.existing.name === 'string' ? (
                <p className="text-brand-muted">
                  Existing person: {String(row.conflict.existing.name)}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant={openId === row.id ? 'ghost' : 'outline'}
              size="sm"
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
              aria-expanded={openId === row.id}
            >
              {openId === row.id ? 'Close' : 'Resolve'}
            </Button>
          </div>
          {openId === row.id ? <ResolutionForm row={row} onResolved={onResolved} /> : null}
        </li>
      ))}
    </ul>
  );
}

interface ResolutionFormProps {
  row: StoredRow;
  onResolved: (result: ResolutionResult) => void;
}

function ResolutionForm({ row, onResolved }: ResolutionFormProps) {
  const ids = { base: useId() };
  const actions = permittedActions(row);
  const [action, setAction] = useState<ResolutionAction>(actions[0] ?? 'reject');
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [done, setDone] = useState<ResolutionResult | null>(null);
  const existingIdentityId =
    typeof row.conflict?.existing.identityId === 'string' ? row.conflict.existing.identityId : null;
  const needsConfirmation = action === 'link_existing' || action === 'create_identity';
  const canSubmit = !busy && (!needsConfirmation || confirmed);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { action, ...(note.trim() ? { note: note.trim() } : {}) };
    if (action === 'link_existing') {
      if (!existingIdentityId) {
        setError({ message: 'This conflict has no existing person to link to.' });
        return;
      }
      body.identityId = existingIdentityId;
      body.samePerson = confirmed;
    }
    if (action === 'create_identity') body.differentPerson = confirmed;
    setBusy(true);
    try {
      const result = await apiFetch<ResolutionResult>(`/imports/rows/${row.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setDone(result);
      onResolved(result);
    } catch (err) {
      setError(describeError(err, 'The decision could not be applied. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="flex items-center gap-2 text-sm text-success" role="status">
        <CheckCircle2Icon className="size-4" aria-hidden="true" />
        {resolutionLabels[done.row.resolution]}
        {done.alreadyResolved ? ' (was already applied)' : ''}
      </p>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-md border border-brand-line bg-background p-3"
      noValidate
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-brand-primary">
          Decision for row {row.rowNumber}
        </legend>
        {actions.map((a) => (
          <label key={a} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${ids.base}-action`}
              value={a}
              checked={action === a}
              onChange={() => {
                setAction(a);
                setConfirmed(false);
                setError(null);
              }}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-brand-text">{resolutionActionLabels[a]}</span>
              <span className="block text-brand-muted">{resolutionActionHelp[a]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {needsConfirmation ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            {action === 'link_existing'
              ? 'I have established that this row is the same person as the existing person.'
              : 'I have established that this row is a different person from anyone already registered.'}
          </span>
        </label>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor={`${ids.base}-note`}>Note (optional, kept with the decision)</Label>
        <input
          id={`${ids.base}-note`}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error.message}
          {error.requestId ? (
            <span className="block text-xs font-normal">Request id {error.requestId}</span>
          ) : null}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Applying…' : 'Apply decision'}
        </Button>
      </div>
    </form>
  );
}
