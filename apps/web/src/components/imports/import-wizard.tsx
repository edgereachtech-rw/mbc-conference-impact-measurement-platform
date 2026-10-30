'use client';

import { IMPORT_FILE_EXTENSIONS, IMPORT_MAX_FILE_BYTES, importSourceSchema } from '@mbc/shared';
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { ErrorState } from '@/components/error-state';
import { StepProgress } from '@/components/step-progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, apiUpload } from '@/lib/api';
import {
  describeError,
  draftFromMapping,
  isStalePreviewError,
  mappingFromDraft,
  type ConfirmResult,
  type EventSummary,
  type ImportFeatureStatus,
  type ImportValueMappings,
  type MappingDraft,
  type PreviewResult,
  type UploadResult,
} from '@/lib/imports';

import { MappingForm } from './mapping-form';
import { NativeSelect } from './native-select';
import { CountSummary, PreviewPanel } from './preview-panel';
import { RunHistory } from './run-history';

type Step = 'setup' | 'mapping' | 'preview' | 'done';
type Tab = 'import' | 'history';

const STEP_LABELS = ['Event and file', 'Map columns', 'Review preview', 'Done'];

function hasValueMappings(mappings: ImportValueMappings): boolean {
  return Object.values(mappings).some((table) => table && Object.keys(table).length > 0);
}
const STEP_INDEX: Record<Step, number> = { setup: 1, mapping: 2, preview: 3, done: 4 };

interface Failure {
  message: string;
  requestId?: string;
}

/**
 * Admin registration import (E2-1, E2-8 to E2-11): event and file, mapping, preview, confirm,
 * history. Every call goes to the API, which authorises it; the screen never decides access.
 */
export function ImportWizard() {
  const ids = { event: useId(), source: useId(), file: useId() };
  const [status, setStatus] = useState<ImportFeatureStatus | null | 'error'>(null);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [loadError, setLoadError] = useState<Failure | null>(null);
  const [tab, setTab] = useState<Tab>('import');
  const [step, setStep] = useState<Step>('setup');
  const [eventId, setEventId] = useState('');
  const [source, setSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [draft, setDraft] = useState<MappingDraft>(draftFromMapping(null));
  const [attendanceDefault, setAttendanceDefault] = useState<'' | 'physical' | 'virtual'>('');
  const [valueMappings, setValueMappings] = useState<ImportValueMappings>({});
  const [saveMapping, setSaveMapping] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  // No synchronous state writes here: the effect only starts the request, and the state is
  // written when the API answers. Retrying resets the state in the click handler first.
  // `attempt` restarts the initial load; the effect only subscribes to the request and writes
  // state when the API answers (or when the component is still mounted on failure).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<ImportFeatureStatus>('/imports/status'),
      apiFetch<{ events: EventSummary[] }>('/events'),
    ]).then(
      ([feature, { events }]) => {
        if (cancelled) return;
        setStatus(feature);
        setEvents(events);
      },
      (e: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setLoadError(
          describeError(e, 'We could not reach the API. Check your connection and try again.'),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const load = useCallback(() => {
    setLoadError(null);
    setStatus(null);
    setAttempt((n) => n + 1);
  }, []);

  const selectedEvent = events?.find((e) => e.id === eventId) ?? null;
  /** In-person-only or online-only events fix the attendance format of every registration. */
  const fixedAttendanceFormat =
    selectedEvent && selectedEvent.format !== 'hybrid' ? selectedEvent.format : null;
  const uploadsEnabled = status !== null && status !== 'error' && status.uploadsEnabled;
  const fail = (e: unknown, fallback: string) => setFailure(describeError(e, fallback));

  async function submitUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const parsedSource = importSourceSchema.safeParse(source);
    if (!eventId) return setFailure({ message: 'Choose the event the file belongs to.' });
    if (selectedEvent?.status === 'archived') {
      return setFailure({
        message: 'Imports into an archived event are refused. Choose another event.',
      });
    }
    if (!parsedSource.success)
      return setFailure({ message: 'Name the registration source the file was exported from.' });
    if (!file) return setFailure({ message: 'Choose a .csv or .xlsx file.' });
    const lower = file.name.toLowerCase();
    if (!IMPORT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return setFailure({ message: 'Only .csv and .xlsx files can be imported (not .xls).' });
    }
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      return setFailure({
        message:
          'The file is larger than 10 MB. Split the export into smaller files and import each one.',
      });
    }
    const body = new FormData();
    body.append('source', parsedSource.data);
    body.append('file', file, file.name);
    setBusy(true);
    try {
      const uploaded = await apiUpload<UploadResult>(`/events/${eventId}/imports`, body);
      setUpload(uploaded);
      setDraft(
        draftFromMapping(
          uploaded.savedMapping?.reusable
            ? uploaded.savedMapping.mapping
            : uploaded.suggestedMapping,
        ),
      );
      setAttendanceDefault(fixedAttendanceFormat ?? '');
      setValueMappings({});
      setSaveMapping(false);
      setPreview(null);
      setStaleMessage(null);
      setStep('mapping');
    } catch (err) {
      fail(err, 'The upload did not complete. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function buildPreview() {
    if (!upload) return;
    setFailure(null);
    const built = mappingFromDraft(draft, fixedAttendanceFormat ?? attendanceDefault);
    if ('problem' in built) return setFailure({ message: built.problem });
    const { attendanceFormat: mappedAttendance, ...mappingWithout } = built.mapping;
    const mapping = fixedAttendanceFormat ? mappingWithout : built.mapping;
    const attendanceFormatDefault = fixedAttendanceFormat
      ? fixedAttendanceFormat
      : attendanceDefault && !mappedAttendance
        ? attendanceDefault
        : undefined;
    setBusy(true);
    try {
      const previewed = await apiFetch<PreviewResult>(`/imports/${upload.run.id}/preview`, {
        method: 'POST',
        body: JSON.stringify({
          mapping,
          ...(attendanceFormatDefault ? { attendanceFormatDefault } : {}),
          ...(hasValueMappings(valueMappings) ? { valueMappings } : {}),
          ...(saveMapping ? { saveMapping: true } : {}),
        }),
      });
      setPreview(previewed);
      setStaleMessage(null);
      setStep('preview');
    } catch (err) {
      fail(err, 'The preview could not be built. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!upload) return;
    setFailure(null);
    setBusy(true);
    try {
      const committed = await apiFetch<ConfirmResult>(`/imports/${upload.run.id}/confirm`, {
        method: 'POST',
      });
      setResult(committed);
      setHistoryKey((k) => k + 1);
      setStep('done');
    } catch (err) {
      if (isStalePreviewError(err)) {
        setStaleMessage(
          err.code === 'preview_expired'
            ? 'This preview has expired. Build a fresh preview, review it again and then confirm.'
            : 'Records changed since this preview was built, so nothing was imported. Build a fresh preview, review it again and then confirm.',
        );
      } else {
        fail(err, 'The confirmation did not complete. Nothing was changed; you can try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!upload) return;
    setFailure(null);
    setBusy(true);
    try {
      await apiFetch<void>(`/imports/${upload.run.id}/discard`, { method: 'POST' });
      reset();
    } catch (err) {
      fail(err, 'The upload could not be discarded.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setUpload(null);
    setPreview(null);
    setResult(null);
    setStaleMessage(null);
    setFile(null);
    setFailure(null);
    setStep('setup');
  }

  if (status === null && !loadError) {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading…
      </p>
    );
  }
  if (loadError) {
    return (
      <ErrorState
        title="Imports unavailable"
        description={
          <>
            {loadError.message}
            {loadError.requestId ? (
              <span className="block text-xs">Request id {loadError.requestId}</span>
            ) : null}
          </>
        }
        action={
          <Button type="button" variant="outline" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {status !== 'error' && status && !status.uploadsEnabled ? (
        <Alert variant="warning">
          <AlertTitle>Registration imports are disabled in this environment</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {status.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2" role="tablist" aria-label="Import screens">
        {(['import', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? 'min-h-11 rounded-md bg-brand-primary px-4 text-sm font-medium text-white'
                : 'min-h-11 rounded-md border border-brand-line bg-card px-4 text-sm font-medium text-brand-primary'
            }
          >
            {t === 'import' ? 'New import' : 'History and conflicts'}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <div className="space-y-4">
          <div className="max-w-md space-y-2">
            <Label htmlFor={`${ids.event}-history`}>Event</Label>
            <NativeSelect
              id={`${ids.event}-history`}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">Choose an event…</option>
              {events?.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {eventId ? (
            <RunHistory eventId={eventId} refreshKey={historyKey} />
          ) : (
            <p className="text-sm text-brand-muted">Choose an event to see its imports.</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <StepProgress current={STEP_INDEX[step]} total={4} labels={STEP_LABELS} />

          {failure ? (
            <Alert variant="destructive">
              <AlertTitle>{failure.message}</AlertTitle>
              {failure.requestId ? (
                <AlertDescription>Request id {failure.requestId}</AlertDescription>
              ) : null}
            </Alert>
          ) : null}

          {step === 'setup' ? (
            <form onSubmit={submitUpload} className="space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor={ids.event}>Event</Label>
                <NativeSelect
                  id={ids.event}
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  required
                >
                  <option value="">Choose an event…</option>
                  {events?.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                      {ev.status === 'archived' ? ' (archived)' : ''}
                    </option>
                  ))}
                </NativeSelect>
                {events && events.length === 0 ? (
                  <p className="text-sm text-brand-muted">No events exist yet.</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor={ids.source}>Registration source</Label>
                <Input
                  id={ids.source}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Eventbrite"
                  required
                />
                <p className="text-sm text-brand-muted">
                  The platform the file was exported from. Saved column mappings are kept per
                  source.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={ids.file}>
                  Registration file (.csv or .xlsx, up to 10 MB and 5,000 rows)
                </Label>
                <Input
                  id={ids.file}
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>
              <p className="text-sm text-brand-muted">
                Registration data only: attendance, check-in and presence columns are ignored, and
                nothing is written before you confirm the preview.
              </p>
              <Button type="submit" disabled={busy || !uploadsEnabled}>
                {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                {busy ? 'Uploading…' : 'Upload and continue'}
              </Button>
            </form>
          ) : null}

          {step === 'mapping' && upload ? (
            <MappingForm
              upload={upload}
              draft={draft}
              onDraftChange={setDraft}
              attendanceFormatDefault={attendanceDefault}
              fixedAttendanceFormat={fixedAttendanceFormat}
              onAttendanceFormatDefaultChange={setAttendanceDefault}
              saveMapping={saveMapping}
              onSaveMappingChange={setSaveMapping}
              busy={busy}
              problem={null}
              onSubmit={() => void buildPreview()}
              onBack={() => void discard()}
            />
          ) : null}

          {step === 'preview' && preview ? (
            <PreviewPanel
              counts={preview.counts}
              rows={preview.rows}
              ignoredColumns={preview.ignoredColumns}
              unrecognisedValues={preview.unrecognisedValues}
              valueMappings={valueMappings}
              onValueMappingsChange={setValueMappings}
              previewExpiresAt={preview.previewExpiresAt}
              staleMessage={staleMessage}
              busy={busy}
              onConfirm={() => void confirm()}
              onRefreshPreview={() => void buildPreview()}
              onBack={() => {
                setStaleMessage(null);
                setStep('mapping');
              }}
              onDiscard={() => void discard()}
            />
          ) : null}

          {step === 'done' && result ? (
            <div className="space-y-5" aria-live="polite">
              <div className="flex items-start gap-3 rounded-lg border border-brand-line bg-card p-4 shadow-card">
                <CheckCircle2Icon
                  className="mt-0.5 size-6 shrink-0 text-success"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <p className="font-medium text-brand-primary">
                    {result.alreadyCommitted
                      ? 'This import had already been committed'
                      : 'Import committed'}
                  </p>
                  <p className="text-sm text-brand-muted">
                    {result.run.fileName} into {selectedEvent?.name ?? 'the event'}. Conflicts, if
                    any, are quarantined and listed under History and conflicts.
                  </p>
                </div>
              </div>
              <CountSummary counts={result.counts} />
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  className="inline-flex h-11 items-center justify-center rounded-md border border-brand-primary/40 px-4 text-sm font-medium text-brand-primary"
                  href={`/api/v1/imports/${result.run.id}/report.csv`}
                  download
                >
                  Download row report (CSV)
                </a>
                <Button type="button" variant="outline" onClick={() => setTab('history')}>
                  View history and conflicts
                </Button>
                <Button type="button" onClick={reset}>
                  Start another import
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
