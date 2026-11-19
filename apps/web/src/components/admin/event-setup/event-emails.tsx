'use client';

import {
  DEFAULT_EMAIL_STYLE,
  emailAlignmentLabels,
  emailAlignments,
  emailFontSizeLabels,
  emailFontSizes,
  emailPlaceholderLabels,
  emailStyleIsDefault,
  type EmailCustomisation,
  type EmailCustomisationInput,
  type EmailParts,
  type EmailPreview,
  type EmailStyle,
  type EventDetail,
  type EventEmailView,
  type EventEmailsResponse,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { consoleButton, Panel, StatePanel } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

type Mode = 'parts' | 'whole';

interface Draft {
  mode: Mode;
  subject: string;
  title: string;
  intro: string;
  closing: string;
  buttonLabel: string;
  body: string;
  style: EmailStyle;
}

type PartKey = 'subject' | 'title' | 'intro' | 'closing' | 'buttonLabel';

/** The platform's content as one text, the starting point for writing the whole email. */
const wholeOf = (defaults: EmailParts) =>
  [defaults.intro, defaults.closing].filter(Boolean).join('\n\n');

/**
 * The fields start from the real wording (the organisers' where set, else the platform's), so
 * editing means changing a sentence rather than writing one from a hint (2026-11-19).
 */
const draftOf = (c: EmailCustomisation | null, defaults: EmailParts): Draft => ({
  mode: c?.body ? 'whole' : 'parts',
  subject: c?.subject ?? defaults.subject,
  title: c?.title ?? defaults.title,
  intro: c?.intro ?? defaults.intro,
  closing: c?.closing ?? defaults.closing,
  buttonLabel: c?.buttonLabel ?? defaults.buttonLabel,
  body: c?.body ?? wholeOf(defaults),
  style: { ...DEFAULT_EMAIL_STYLE, ...(c?.style ?? {}) },
});

/**
 * What the server is sent: a field that still reads as the platform's wording, or is blank, is
 * null, so the platform's own words (and any later improvement to them) stay in force. In
 * whole-email mode the body carries the content and the parts it replaces are null.
 */
export function emailPayload(d: Draft, defaults: EmailParts): EmailCustomisationInput {
  const own = (key: PartKey) => {
    const value = d[key].trim();
    return value && value !== defaults[key].trim() ? value : null;
  };
  const whole = d.mode === 'whole';
  return {
    subject: own('subject'),
    title: own('title'),
    intro: whole ? null : own('intro'),
    closing: whole ? null : own('closing'),
    buttonLabel: own('buttonLabel'),
    body: whole && d.body.trim() ? d.body.trim() : null,
    style: emailStyleIsDefault(d.style) ? null : d.style,
  };
}

/**
 * The organisers' own wording and look for every email the platform sends for this event
 * (decision 2026-11-19): one card per kind. Either edit the parts of the platform's email, or
 * write the whole content; set the colours, alignment and size either way. The frame (header,
 * logo, footer), the title, the button and the welcome pack's codes stay.
 */
export function EventEmails({ event }: { event: EventDetail }) {
  const [emails, setEmails] = useState<EventEmailView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const readOnly = event.status === 'archived';

  useEffect(() => {
    let cancelled = false;
    apiFetch<EventEmailsResponse>(`/events/${event.id}/emails`).then(
      (r) => {
        if (!cancelled) setEmails(r.emails);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The emails could not be loaded.').message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, attempt]);

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Emails unavailable"
        description={error}
        action={
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={consoleButton({ variant: 'secondary' })}
          >
            Try again
          </button>
        }
      />
    );
  }
  if (!emails) return <StatePanel kind="loading" title="Loading the emails…" />;

  return (
    <div className="space-y-6">
      <Panel>
        <h2 className="font-corporate text-h3 text-corp-ink">Emails</h2>
        <p className="mt-1 text-sm text-corp-muted">
          What the platform writes to delegates for this event. Edit the parts of each email, or
          write the whole content yourself; set the colours, alignment and text size either way. The
          frame with the logo and footer, the button and the welcome pack&rsquo;s check-in codes
          always stay. Placeholders such as{' '}
          <code className="font-mono text-xs">{'{{firstName}}'}</code> are filled per delegate.
        </p>
      </Panel>
      {emails.map((email) => (
        <EmailCard
          key={email.kind}
          eventId={event.id}
          email={email}
          readOnly={readOnly}
          onSaved={(next) =>
            setEmails((all) => all?.map((e) => (e.kind === next.kind ? next : e)) ?? null)
          }
        />
      ))}
    </div>
  );
}

function EmailCard({
  eventId,
  email,
  readOnly,
  onSaved,
}: {
  eventId: string;
  email: EventEmailView;
  readOnly: boolean;
  onSaved: (email: EventEmailView) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(email.custom, email.defaults));
  const [preview, setPreview] = useState<EmailPreview>(email.preview);
  const [busy, setBusy] = useState<'save' | 'preview' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const payload = emailPayload(draft, email.defaults);
  const customised = Object.values(payload).some((v) => v);
  const disabled = readOnly || busy !== null;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setNotice(null);
  };
  const setStyle = <K extends keyof EmailStyle>(key: K, value: EmailStyle[K]) => {
    setDraft((d) => ({ ...d, style: { ...d.style, [key]: value } }));
    setNotice(null);
  };

  const refreshPreview = useCallback(async () => {
    setBusy('preview');
    try {
      setPreview(
        await apiFetch<EmailPreview>(`/events/${eventId}/emails/${email.kind}/preview`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );
      setNotice(null);
    } catch (e) {
      setNotice({ ok: false, text: describeError(e, 'The preview could not be made.').message });
    } finally {
      setBusy(null);
    }
  }, [payload, email.kind, eventId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setBusy('save');
    try {
      const result = await apiFetch<{ email: EventEmailView }>(
        `/events/${eventId}/emails/${email.kind}`,
        { method: 'PUT', body: JSON.stringify(payload) },
      );
      onSaved(result.email);
      setPreview(result.email.preview);
      setNotice({
        ok: true,
        text: customised
          ? 'Saved. Delegates get this from the next send.'
          : 'Back to the platform’s wording and look.',
      });
    } catch (err) {
      setNotice({ ok: false, text: describeError(err, 'The email could not be saved.').message });
    } finally {
      setBusy(null);
    }
  }

  const input =
    'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm disabled:bg-corp-surface';
  const area =
    'w-full rounded-none border border-corp-line bg-white px-3 py-2 font-mono text-sm disabled:bg-corp-surface';
  const label = 'text-sm font-semibold text-corp-ink';
  const text = (key: 'subject' | 'title' | 'buttonLabel', title: string) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className={label}>
        {title}
      </label>
      <input
        id={`${id}-${key}`}
        value={draft[key]}
        disabled={disabled}
        maxLength={key === 'buttonLabel' ? 80 : 200}
        onChange={(e) => set(key, e.target.value)}
        className={input}
      />
    </div>
  );
  const textarea = (
    key: 'intro' | 'closing' | 'body',
    title: string,
    rows: number,
    max: number,
  ) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className={label}>
        {title}
      </label>
      <textarea
        id={`${id}-${key}`}
        rows={rows}
        value={draft[key]}
        disabled={disabled}
        maxLength={max}
        onChange={(e) => set(key, e.target.value)}
        className={area}
      />
    </div>
  );
  const colour = (key: 'accentColor' | 'textColor' | 'headingColor', title: string) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className={label}>
        {title}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`${id}-${key}`}
          type="color"
          value={draft.style[key] ?? '#000000'}
          disabled={disabled}
          onChange={(e) => setStyle(key, e.target.value.toUpperCase())}
          className="h-11 w-14 rounded-none border border-corp-line bg-white"
        />
        <span className="font-mono text-xs text-corp-muted">
          {draft.style[key] ?? 'platform’s'}
        </span>
        {draft.style[key] ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setStyle(key, null)}
            className={consoleButton({ variant: 'ghost', size: 'sm' })}
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-corporate text-base font-semibold text-corp-ink">{email.label}</h3>
          <p className="mt-1 text-sm text-corp-muted">{email.description}</p>
          <p className="mt-1 text-xs text-corp-muted">
            {email.custom?.body
              ? 'Your whole content is in use.'
              : email.custom
                ? 'Your wording or look is in use.'
                : 'The platform’s wording is in use.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          className={consoleButton({ variant: 'secondary' })}
        >
          {open ? 'Close' : 'Edit email'}
        </button>
      </div>
      {open ? (
        <div id={`${id}-panel`} className="mt-4 grid gap-4 lg:grid-cols-2">
          <form
            aria-label={`${email.label} wording`}
            onSubmit={(e) => void save(e)}
            className="space-y-3"
          >
            <fieldset className="space-y-1">
              <legend className={label}>What to edit</legend>
              {(
                [
                  ['parts', 'Edit the parts of the platform’s email'],
                  ['whole', 'Write the whole email (the frame, title, button and codes stay)'],
                ] as const
              ).map(([mode, title]) => (
                <label
                  key={mode}
                  className="flex min-h-tap items-center gap-2 text-sm text-corp-ink"
                >
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    value={mode}
                    checked={draft.mode === mode}
                    disabled={disabled}
                    onChange={() => set('mode', mode)}
                    className="size-5 accent-corp-green"
                  />
                  {title}
                </label>
              ))}
            </fieldset>
            {text('subject', 'Subject')}
            {text('title', 'Title')}
            {draft.mode === 'whole' ? (
              <>
                {textarea('body', 'Content', 12, 20_000)}
                <p className="text-xs text-corp-muted">
                  Blank line for a new paragraph, <code className="font-mono">## Heading</code>,{' '}
                  <code className="font-mono">**bold**</code>,{' '}
                  <code className="font-mono">*italic*</code>, <code className="font-mono">- </code>{' '}
                  for bullets, <code className="font-mono">1. </code> for a numbered list,{' '}
                  <code className="font-mono">[label](https://…)</code> for a link. The button
                  follows your content; <code className="font-mono">{'{{link}}'}</code> is its
                  address if you want it in the text too.
                </p>
              </>
            ) : (
              <>
                {textarea('intro', 'Introduction (paragraphs separated by a blank line)', 5, 4_000)}
                {textarea('closing', 'Closing notes (one per line)', 2, 2_000)}
              </>
            )}
            {text('buttonLabel', 'Button label')}
            <p className="text-xs text-corp-muted">
              Placeholders:{' '}
              {email.placeholders.map((key, i) => (
                <span key={key}>
                  {i > 0 ? ', ' : ''}
                  <code className="font-mono">{`{{${key}}}`}</code>
                  {emailPlaceholderLabels[key] ? ` (${emailPlaceholderLabels[key]})` : ''}
                </span>
              ))}
            </p>
            <fieldset className="space-y-3 border border-corp-line p-3">
              <legend className="px-1 text-sm font-semibold text-corp-ink">Styling</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {colour('accentColor', 'Button colour')}
                {colour('headingColor', 'Title colour')}
                {colour('textColor', 'Text colour')}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor={`${id}-align`} className={label}>
                    Alignment
                  </label>
                  <NativeSelect
                    id={`${id}-align`}
                    value={draft.style.align}
                    disabled={disabled}
                    onChange={(e) => setStyle('align', e.target.value as EmailStyle['align'])}
                    className="rounded-none"
                  >
                    {emailAlignments.map((a) => (
                      <option key={a} value={a}>
                        {emailAlignmentLabels[a]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${id}-size`} className={label}>
                    Text size
                  </label>
                  <NativeSelect
                    id={`${id}-size`}
                    value={draft.style.fontSize}
                    disabled={disabled}
                    onChange={(e) => setStyle('fontSize', e.target.value as EmailStyle['fontSize'])}
                    className="rounded-none"
                  >
                    {emailFontSizes.map((f) => (
                      <option key={f} value={f}>
                        {emailFontSizeLabels[f]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            </fieldset>
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
                {busy === 'save' ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : null}
                Save email
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void refreshPreview()}
                className={consoleButton({ variant: 'secondary' })}
              >
                {busy === 'preview' ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : null}
                Preview
              </button>
              <button
                type="button"
                disabled={disabled || !customised}
                onClick={() => {
                  setDraft(draftOf(null, email.defaults));
                  setNotice(null);
                }}
                className={consoleButton({ variant: 'ghost' })}
              >
                Back to the platform’s email
              </button>
            </div>
          </form>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-corp-ink">Preview</p>
            <p className="text-xs text-corp-muted">
              Subject: <span className="text-corp-ink">{preview.subject}</span>. Sample delegate and
              facts; press Preview after editing to see your changes.
            </p>
            <iframe
              title={`${email.label} preview`}
              srcDoc={preview.html}
              sandbox=""
              className="h-[32rem] w-full border border-corp-line bg-white"
            />
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
