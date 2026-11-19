'use client';

import {
  emailPlaceholderLabels,
  type EmailCustomisation,
  type EmailCustomisationInput,
  type EmailParts,
  type EmailPreview,
  type EventDetail,
  type EventEmailView,
  type EventEmailsResponse,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { consoleButton, Panel, StatePanel } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

interface Draft {
  subject: string;
  title: string;
  intro: string;
  closing: string;
  buttonLabel: string;
}

const KEYS: ReadonlyArray<keyof Draft> = ['subject', 'title', 'intro', 'closing', 'buttonLabel'];

/**
 * The fields start from the real wording (the organisers' where set, else the platform's), so
 * editing means changing a sentence rather than writing one from a hint (2026-11-19).
 */
const draftOf = (c: EmailCustomisation | null, defaults: EmailParts): Draft => ({
  subject: c?.subject ?? defaults.subject,
  title: c?.title ?? defaults.title,
  intro: c?.intro ?? defaults.intro,
  closing: c?.closing ?? defaults.closing,
  buttonLabel: c?.buttonLabel ?? defaults.buttonLabel,
});

/**
 * What the server is sent: a field that still reads as the platform's wording, or is blank, is
 * null, so the platform's own words (and any later improvement to them) stay in force.
 */
export function emailPayload(d: Draft, defaults: EmailParts): EmailCustomisationInput {
  const own = (key: keyof Draft) => {
    const value = d[key].trim();
    return value && value !== defaults[key].trim() ? value : null;
  };
  return {
    subject: own('subject'),
    title: own('title'),
    intro: own('intro'),
    closing: own('closing'),
    buttonLabel: own('buttonLabel'),
  };
}

/**
 * The organisers' own wording for every email the platform sends for this event (decision
 * 2026-11-19): one card per kind, each with the platform's wording as the starting point, the
 * placeholders it understands, a preview, and its own save. The structure, the facts and the
 * button of each email stay the platform's; the words around them are the organisers'.
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
          What the platform writes to delegates for this event. Each email keeps its facts and its
          button; you set the subject, the title, the introduction, the closing notes and the button
          label. Leave a field blank to keep the platform&rsquo;s wording. Placeholders such as{' '}
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
  const customised = KEYS.some((key) => payload[key]);
  const disabled = readOnly || busy !== null;

  const set = (key: keyof Draft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
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
          ? 'Saved. Delegates get this wording from the next send.'
          : 'Back to the platform’s wording.',
      });
    } catch (err) {
      setNotice({ ok: false, text: describeError(err, 'The wording could not be saved.').message });
    } finally {
      setBusy(null);
    }
  }

  const input =
    'h-11 w-full rounded-none border border-corp-line bg-white px-3 text-base md:text-sm disabled:bg-corp-surface';
  const area =
    'w-full rounded-none border border-corp-line bg-white px-3 py-2 font-mono text-sm disabled:bg-corp-surface';
  const label = 'text-sm font-semibold text-corp-ink';
  const field = (key: keyof Draft, title: string, kind: 'input' | 'area', rows = 3) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className={label}>
        {title}
      </label>
      {kind === 'input' ? (
        <input
          id={`${id}-${key}`}
          value={draft[key]}
          disabled={disabled}
          maxLength={key === 'buttonLabel' ? 80 : 200}
          onChange={(e) => set(key, e.target.value)}
          className={input}
        />
      ) : (
        <textarea
          id={`${id}-${key}`}
          rows={rows}
          value={draft[key]}
          disabled={disabled}
          maxLength={key === 'intro' ? 4000 : 2000}
          onChange={(e) => set(key, e.target.value)}
          className={area}
        />
      )}
    </div>
  );

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-corporate text-base font-semibold text-corp-ink">{email.label}</h3>
          <p className="mt-1 text-sm text-corp-muted">{email.description}</p>
          <p className="mt-1 text-xs text-corp-muted">
            {email.custom ? 'Your wording is in use.' : 'The platform’s wording is in use.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className={consoleButton({ variant: 'secondary' })}
        >
          {open ? 'Close' : email.custom ? 'Edit wording' : 'Edit wording'}
        </button>
      </div>
      {open ? (
        <div id={`${id}-body`} className="mt-4 grid gap-4 lg:grid-cols-2">
          <form
            aria-label={`${email.label} wording`}
            onSubmit={(e) => void save(e)}
            className="space-y-3"
          >
            {field('subject', 'Subject', 'input')}
            {field('title', 'Title', 'input')}
            {field('intro', 'Introduction (paragraphs separated by a blank line)', 'area', 5)}
            {field('closing', 'Closing notes (one per line)', 'area', 2)}
            {field('buttonLabel', 'Button label', 'input')}
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
                Save wording
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
                Clear to the platform’s wording
              </button>
            </div>
          </form>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-corp-ink">Preview</p>
            <p className="text-xs text-corp-muted">
              Subject: <span className="text-corp-ink">{preview.subject}</span>. Sample delegate and
              facts; press Preview after editing to see your wording.
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
