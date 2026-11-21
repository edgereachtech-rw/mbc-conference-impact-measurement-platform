'use client';

import {
  confirmationAlignmentLabels,
  confirmationAlignments,
  confirmationToneLabels,
  confirmationTones,
  DEFAULT_CONFIRMATION,
  type AssessmentConfirmation,
  type AssessmentConfirmationInput,
  type AssessmentStage,
  type EventDetail,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import {
  DEFAULT_ALL_DETAIL,
  DEFAULT_ALL_MESSAGE,
  DEFAULT_ALL_TITLE,
  SubmissionConfirmation,
} from '@/components/account/submission-confirmation';
import { consoleButton, Panel } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

interface Draft {
  submitLabel: string;
  title: string;
  message: string;
  detail: string;
  tone: AssessmentConfirmation['tone'];
  align: AssessmentConfirmation['align'];
  showIcon: boolean;
  highlight: boolean;
}

const draftOf = (c: AssessmentConfirmation | null | undefined): Draft => ({
  submitLabel: c?.submitLabel ?? '',
  title: c?.title ?? '',
  message: c?.message ?? '',
  detail: c?.detail ?? '',
  tone: c?.tone ?? DEFAULT_CONFIRMATION.tone,
  align: c?.align ?? DEFAULT_CONFIRMATION.align,
  showIcon: c?.showIcon ?? DEFAULT_CONFIRMATION.showIcon,
  highlight: c?.highlight ?? DEFAULT_CONFIRMATION.highlight,
});

const blank = (v: string) => (v.trim() ? v.trim() : null);

/** What the server is sent: blanks become null, which means "the default wording". */
export function confirmationPayload(d: Draft): AssessmentConfirmationInput {
  return {
    submitLabel: blank(d.submitLabel),
    title: blank(d.title),
    message: blank(d.message),
    detail: blank(d.detail),
    tone: d.tone,
    align: d.align,
    showIcon: d.showIcon,
    highlight: d.highlight,
  };
}

interface Props {
  event: EventDetail;
  stage: AssessmentStage;
  wave: number;
  readOnly: boolean;
  onSaved: () => void;
}

/**
 * The confirmation a delegate sees once this assessment is fully submitted (decision
 * 2026-11-19): its title, message and closing line, and how it looks. Blank text keeps the
 * platform's wording; the preview shows exactly what the delegate will get.
 */
export function ConfirmationEditor({ event, stage, wave, readOnly, onSaved }: Props) {
  const id = useId();
  const current = event.assessmentStages.find((s) => s.stage === stage && s.wave === wave);
  const [draft, setDraft] = useState<Draft>(() => draftOf(current?.confirmation ?? null));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setNotice(null);
  };
  const disabled = readOnly || busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    try {
      await apiFetch(`/events/${event.id}/assessments/${stage}/confirmation?wave=${wave}`, {
        method: 'PUT',
        body: JSON.stringify(confirmationPayload(draft)),
      });
      setNotice({
        ok: true,
        text: 'Confirmation saved. Delegates see it from their next submission.',
      });
      onSaved();
    } catch (err) {
      setNotice({
        ok: false,
        text: describeError(err, 'The confirmation could not be saved.').message,
      });
    } finally {
      setBusy(false);
    }
  }

  const input =
    'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm disabled:bg-corp-surface';
  const area =
    'w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm disabled:bg-corp-surface';
  const label = 'text-sm font-semibold text-corp-ink';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <form
          aria-label="Submission confirmation"
          onSubmit={(e) => void submit(e)}
          className="space-y-4"
        >
          <div>
            <h2 className="font-corporate text-h3 text-corp-ink">Submission confirmation</h2>
            <p className="mt-1 text-sm text-corp-muted">
              Shown in the popup once the delegate has submitted every section of this assessment.
              Leave a field blank to keep the platform&rsquo;s wording.
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-submit`} className={label}>
              Submit button text
            </label>
            <input
              id={`${id}-submit`}
              value={draft.submitLabel}
              maxLength={40}
              placeholder="Submit answers"
              disabled={disabled}
              onChange={(e) => set('submitLabel', e.target.value)}
              className={input}
            />
            <p className="text-xs text-corp-muted">
              The words on the button delegates press to submit this assessment, and each of its
              sections. Blank keeps “Submit answers” (“Submit section” when it has several).
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-title`} className={label}>
              Title
            </label>
            <input
              id={`${id}-title`}
              value={draft.title}
              maxLength={120}
              placeholder={DEFAULT_ALL_TITLE}
              disabled={disabled}
              onChange={(e) => set('title', e.target.value)}
              className={input}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-message`} className={label}>
              Message
            </label>
            <textarea
              id={`${id}-message`}
              rows={3}
              value={draft.message}
              maxLength={600}
              placeholder={DEFAULT_ALL_MESSAGE}
              disabled={disabled}
              onChange={(e) => set('message', e.target.value)}
              className={area}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-detail`} className={label}>
              Closing line
            </label>
            <textarea
              id={`${id}-detail`}
              rows={2}
              value={draft.detail}
              maxLength={600}
              placeholder={DEFAULT_ALL_DETAIL}
              disabled={disabled}
              onChange={(e) => set('detail', e.target.value)}
              className={area}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${id}-tone`} className={label}>
                Colour
              </label>
              <NativeSelect
                id={`${id}-tone`}
                value={draft.tone}
                disabled={disabled}
                onChange={(e) => set('tone', e.target.value as Draft['tone'])}
                className="rounded-none"
              >
                {confirmationTones.map((t) => (
                  <option key={t} value={t}>
                    {confirmationToneLabels[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-align`} className={label}>
                Alignment
              </label>
              <NativeSelect
                id={`${id}-align`}
                value={draft.align}
                disabled={disabled}
                onChange={(e) => set('align', e.target.value as Draft['align'])}
                className="rounded-none"
              >
                {confirmationAlignments.map((a) => (
                  <option key={a} value={a}>
                    {confirmationAlignmentLabels[a]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
            <input
              type="checkbox"
              checked={draft.showIcon}
              disabled={disabled}
              onChange={(e) => set('showIcon', e.target.checked)}
              className="size-5 accent-corp-green"
            />
            Show the check icon
          </label>
          <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
            <input
              type="checkbox"
              checked={draft.highlight}
              disabled={disabled}
              onChange={(e) => set('highlight', e.target.checked)}
              className="size-5 accent-corp-green"
            />
            Highlight the message in a tinted panel
          </label>
          {notice ? (
            <p
              role={notice.ok ? 'status' : 'alert'}
              className={
                notice.ok
                  ? 'text-sm font-semibold text-corp-green-text'
                  : 'text-sm font-semibold text-brand-danger'
              }
            >
              {notice.text}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={disabled}
              className={consoleButton({ variant: 'accent' })}
            >
              {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              Save confirmation
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setDraft(draftOf(null));
                setNotice(null);
              }}
              className={consoleButton({ variant: 'secondary' })}
            >
              Back to the defaults
            </button>
          </div>
        </form>
      </Panel>
      <Panel>
        <h3 className="font-corporate text-base font-semibold text-corp-ink">Preview</h3>
        <p className="mt-1 mb-3 text-xs text-corp-muted">
          As the delegate sees it, under the title &ldquo;{blank(draft.title) ?? DEFAULT_ALL_TITLE}
          &rdquo;.
        </p>
        <div aria-label="Preview" className="border border-corp-line bg-white p-4">
          <SubmissionConfirmation confirmation={confirmationPayload(draft)} scope="all" />
        </div>
      </Panel>
    </div>
  );
}
