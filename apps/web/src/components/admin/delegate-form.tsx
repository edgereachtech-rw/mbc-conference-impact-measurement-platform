'use client';

import type {
  DelegateCreateInput,
  DelegateCreateResult,
  DelegateListStatus,
  DelegatePatch,
  DelegateRecord,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

const STATUS_LABEL: Record<DelegateListStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  cancelled: 'Cancelled',
  duplicate: 'Duplicate',
  test: 'Test',
};
/** Statuses an admin may set by hand (E2-4, E2-5); duplicate and test are never set this way. */
const SETTABLE: DelegateListStatus[] = ['active', 'pending', 'cancelled'];

interface Fields {
  name: string;
  email: string;
  organisation: string;
  nominatingOrganisation: string;
  jobTitle: string;
  country: string;
  attendanceFormat: 'physical' | 'virtual';
  capacity: 'individual' | 'nominee' | 'other';
  registrationStatus: DelegateListStatus;
}

const EMPTY: Fields = {
  name: '',
  email: '',
  organisation: '',
  nominatingOrganisation: '',
  jobTitle: '',
  country: '',
  attendanceFormat: 'physical',
  capacity: 'individual',
  registrationStatus: 'active',
};

function fieldsOf(record: DelegateRecord): Fields {
  return {
    name: record.name,
    email: record.email,
    organisation: record.organisation ?? '',
    nominatingOrganisation: record.nominatingOrganisation ?? '',
    jobTitle: record.jobTitle ?? '',
    country: record.country ?? '',
    attendanceFormat: record.attendanceFormat,
    capacity: record.capacity,
    registrationStatus: record.registrationStatus,
  };
}

const blank = (value: string) => (value.trim() ? value.trim() : null);

/** The fields that changed, as the correction route takes them; empty when nothing changed. */
function patchOf(before: Fields, after: Fields): DelegatePatch {
  const patch: DelegatePatch = {};
  if (after.name.trim() !== before.name) patch.name = after.name.trim();
  for (const key of ['organisation', 'nominatingOrganisation', 'jobTitle', 'country'] as const) {
    if (blank(after[key]) !== blank(before[key])) patch[key] = blank(after[key]);
  }
  if (after.attendanceFormat !== before.attendanceFormat)
    patch.attendanceFormat = after.attendanceFormat;
  if (after.capacity !== before.capacity) patch.capacity = after.capacity;
  if (
    after.registrationStatus !== before.registrationStatus &&
    (after.registrationStatus === 'active' ||
      after.registrationStatus === 'pending' ||
      after.registrationStatus === 'cancelled')
  ) {
    patch.registrationStatus = after.registrationStatus;
  }
  return patch;
}

export type DelegateFormMode = { kind: 'create' } | { kind: 'edit'; delegateId: string };

interface Props {
  eventId: string;
  mode: DelegateFormMode;
  onClose: () => void;
  /** Called once the server accepted the change, with a sentence for the page to show. */
  onSaved: (message: string) => void;
}

/**
 * Adding a delegate by hand and correcting one (decision 2026-11-12; backlog E2-4). The same
 * fields an import takes; the email is set once and changed only through the identity
 * email-change workflow. The server finds or creates the person's identity, refuses a second
 * registration of the same person, and audits every change; this form only reports its answer.
 */
export function DelegateFormDialog({ eventId, mode, onClose, onSaved }: Props) {
  const id = useId();
  const [loaded, setLoaded] = useState<DelegateRecord | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const editing = mode.kind === 'edit';
  const delegateId = mode.kind === 'edit' ? mode.delegateId : null;

  useEffect(() => {
    if (!delegateId) return;
    let cancelled = false;
    apiFetch<{ delegate: DelegateRecord }>(`/delegates/${delegateId}`).then(
      ({ delegate }) => {
        if (cancelled) return;
        setLoaded(delegate);
        setFields(fieldsOf(delegate));
      },
      (e: unknown) => {
        if (!cancelled) setProblem(describeError(e, 'The delegate could not be loaded.').message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [delegateId]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));
  const statusSettable =
    !editing || (loaded ? SETTABLE.includes(loaded.registrationStatus) : false);
  const ready = !editing || loaded !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setProblem(null);
    setBusy(true);
    try {
      if (editing && loaded) {
        const patch = patchOf(fieldsOf(loaded), fields);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        await apiFetch(`/delegates/${loaded.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        onSaved(`Changes to ${fields.name.trim()} saved.`);
      } else {
        const body: DelegateCreateInput = {
          name: fields.name.trim(),
          email: fields.email.trim(),
          organisation: blank(fields.organisation),
          nominatingOrganisation: blank(fields.nominatingOrganisation),
          jobTitle: blank(fields.jobTitle),
          country: blank(fields.country),
          attendanceFormat: fields.attendanceFormat,
          capacity: fields.capacity,
          registrationStatus: fields.registrationStatus === 'pending' ? 'pending' : 'active',
        };
        const result = await apiFetch<DelegateCreateResult>(`/events/${eventId}/delegates`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        onSaved(
          `${result.delegate.name} added. ` +
            (result.identity === 'linked'
              ? 'They were already known to the platform from another event, so this registration is linked to them.'
              : 'Nothing was emailed: send the invitation from this tab when you are ready.'),
        );
      }
    } catch (e) {
      setProblem(
        describeError(
          e,
          editing ? 'The changes could not be saved.' : 'The delegate could not be added.',
        ).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const input =
    'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm';
  const label = 'text-sm font-semibold text-corp-ink';
  const text = (
    key: 'name' | 'organisation' | 'nominatingOrganisation' | 'jobTitle' | 'country',
    title: string,
    required = false,
  ) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className={label}>
        {title}
      </label>
      <input
        id={`${id}-${key}`}
        value={fields[key]}
        required={required}
        maxLength={key === 'country' ? 100 : 200}
        disabled={busy || !ready}
        onChange={(e) => set(key, e.target.value)}
        className={input}
      />
    </div>
  );

  return (
    <Dialog
      title={editing ? 'Edit delegate' : 'Add a delegate'}
      description={
        editing
          ? 'Every change is recorded with who made it and the previous value.'
          : 'A registration that came by no file. The person is matched to the platform by email, as an import would.'
      }
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={consoleButton({ variant: 'secondary' })}
          >
            Cancel
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            disabled={busy || !ready}
            className={consoleButton({ variant: 'accent' })}
          >
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {editing ? 'Save changes' : 'Add delegate'}
          </button>
        </>
      }
    >
      {problem ? (
        <p role="alert" className="mb-3 text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
      {editing && !loaded && !problem ? (
        <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading the delegate…
        </p>
      ) : null}
      <form id={`${id}-form`} onSubmit={(e) => void submit(e)} className="grid gap-3">
        {text('name', 'Full name', true)}
        <div className="space-y-1">
          <label htmlFor={`${id}-email`} className={label}>
            Email address
          </label>
          <input
            id={`${id}-email`}
            type="email"
            value={fields.email}
            required
            readOnly={editing}
            disabled={busy || !ready}
            onChange={(e) => set('email', e.target.value)}
            className={editing ? `${input} bg-corp-surface text-corp-muted` : input}
          />
          <p className="text-xs text-corp-muted">
            {editing
              ? 'The address is changed only through the email-change workflow, so the person keeps every record attached to them.'
              : 'The address they will sign in with. An address already on the platform links this registration to that person.'}
          </p>
        </div>
        {text('organisation', 'Organisation')}
        {text('nominatingOrganisation', 'Nominating organisation')}
        <p className="-mt-2 text-xs text-corp-muted">
          Shown as the organisation when the delegate has none of their own.
        </p>
        {text('jobTitle', 'Job title')}
        {text('country', 'Country')}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor={`${id}-format`} className={label}>
              Attendance
            </label>
            <NativeSelect
              id={`${id}-format`}
              value={fields.attendanceFormat}
              disabled={busy || !ready}
              onChange={(e) =>
                set('attendanceFormat', e.target.value as Fields['attendanceFormat'])
              }
              className="rounded-none"
            >
              <option value="physical">In person</option>
              <option value="virtual">Virtual</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-capacity`} className={label}>
              Capacity
            </label>
            <NativeSelect
              id={`${id}-capacity`}
              value={fields.capacity}
              disabled={busy || !ready}
              onChange={(e) => set('capacity', e.target.value as Fields['capacity'])}
              className="rounded-none"
            >
              <option value="individual">Individual</option>
              <option value="nominee">Nominee of an organisation</option>
              <option value="other">Other</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-status`} className={label}>
              Status
            </label>
            {statusSettable ? (
              <NativeSelect
                id={`${id}-status`}
                value={fields.registrationStatus}
                disabled={busy || !ready}
                onChange={(e) => set('registrationStatus', e.target.value as DelegateListStatus)}
                className="rounded-none"
              >
                {(editing ? SETTABLE : (['active', 'pending'] as const)).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <p id={`${id}-status`} className="flex h-11 items-center text-sm text-corp-text">
                {loaded ? STATUS_LABEL[loaded.registrationStatus] : ''}
                <span className="ml-1 text-xs text-corp-muted">
                  {loaded?.registrationStatus === 'test'
                    ? '(set from the selection bar)'
                    : '(merged by an import)'}
                </span>
              </p>
            )}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
