'use client';

import {
  findUnknownPlaceholders,
  messagePlaceholderLabels,
  messagePlaceholders,
  renderMessageBody,
  substitutePlaceholders,
  type MessagePlaceholder,
} from '@mbc/shared';
import {
  BoldIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  Loader2Icon,
  SendIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';
import {
  formattingHint,
  previewValues,
  type DelegateMessageRecipients,
  type DelegateMessageSendResult,
  type PreviewSample,
} from '@/lib/messages';

interface Props {
  eventId: string;
  eventName: string;
  /** Who the message goes to, exactly as the API will receive it. */
  recipients: DelegateMessageRecipients;
  /** How many delegates that is, for the labels; the API reports the exact figure after sending. */
  recipientCount: number;
  /** Delegate used to fill the preview placeholders. */
  sample?: PreviewSample;
  onClose: () => void;
  onSent: (result: DelegateMessageSendResult) => void;
}

type Stage =
  | { kind: 'write' }
  | { kind: 'confirm' }
  | { kind: 'sending' }
  | { kind: 'sent'; result: DelegateMessageSendResult };

const SUBJECT_MAX = 150;
const BODY_MAX = 20_000;

/**
 * Compose and send one email to the selected delegates (E2-14). The admin writes in a small
 * markdown subset with a formatting toolbar, switches to a preview rendered exactly as the email
 * will be, confirms the audience, and sees the per-recipient outcome. The API validates
 * everything again and does the sending.
 */
export function MessageComposer({
  eventId,
  eventName,
  recipients,
  recipientCount,
  sample,
  onClose,
  onSent,
}: Props) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [stage, setStage] = useState<Stage>({ kind: 'write' });
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const subjectId = useId();

  const busy = stage.kind === 'sending';
  const unknown = findUnknownPlaceholders(`${subject}\n${body}`);
  const canSend =
    subject.trim().length > 0 && body.trim().length > 0 && unknown.length === 0 && !busy;
  const values = previewValues(sample, eventName);
  const audience =
    'delegateIds' in recipients
      ? `${recipientCount} selected delegate${recipientCount === 1 ? '' : 's'}`
      : `all ${recipientCount} delegate${recipientCount === 1 ? '' : 's'} matching the current filter`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && stage.kind !== 'sending') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, stage.kind]);

  /** Replaces the current selection of the body with `make(selected)` and reselects the result. */
  function editSelection(make: (selected: string) => { text: string; cursor?: [number, number] }) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const { text, cursor } = make(selected);
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    setTab('write');
    const [from, to] = cursor ?? [start, start + text.length];
    setTimeout(() => {
      const target = bodyRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(from, to);
    }, 0);
  }
  const wrap = (mark: string, placeholder: string) =>
    editSelection((s) => ({ text: `${mark}${s || placeholder}${mark}` }));
  const prefixLines = (prefix: (i: number) => string, placeholder: string) =>
    editSelection((s) => {
      const lines = (s || placeholder).split('\n');
      const atLineStart =
        (bodyRef.current?.selectionStart ?? 0) === 0 ||
        body[(bodyRef.current?.selectionStart ?? 1) - 1] === '\n';
      const text = lines.map((line, i) => `${prefix(i)}${line}`).join('\n');
      return { text: atLineStart ? text : `\n${text}` };
    });
  const insertPlaceholder = (key: MessagePlaceholder) =>
    editSelection(() => ({ text: `{{${key}}}` }));

  async function send() {
    setStage({ kind: 'sending' });
    setError(null);
    try {
      const result = await apiFetch<DelegateMessageSendResult>(`/events/${eventId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ subject: subject.trim(), body, recipients }),
      });
      setStage({ kind: 'sent', result });
      onSent(result);
    } catch (e) {
      setError(describeError(e, 'The message could not be sent.'));
      setStage({ kind: 'write' });
    }
  }

  const toolButton =
    'inline-flex size-10 items-center justify-center rounded-none border border-corp-line bg-white text-corp-ink hover:bg-corp-surface disabled:opacity-50';
  const preview = renderMessageBody(body, values);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-corp-ink/60 sm:items-start sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-dvh w-full flex-col border border-corp-line bg-white sm:mt-6 sm:max-h-[calc(100dvh-6rem)] sm:max-w-3xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-corp-line px-4 py-3 md:px-6">
          <div>
            <h2 id={titleId} className="font-corporate text-h3 text-corp-ink">
              New message
            </h2>
            <p className="mt-0.5 text-sm text-corp-text">
              To: <span className="font-semibold text-corp-ink">{audience}</span> · {eventName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className={toolButton}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {stage.kind === 'sent' ? (
            <div role="status" className="space-y-3">
              <p className="text-lg font-semibold text-corp-ink">
                {stage.result.failed === 0
                  ? `Sent to ${stage.result.sent} delegate${stage.result.sent === 1 ? '' : 's'}.`
                  : `Sent to ${stage.result.sent} of ${stage.result.total} delegates; ${stage.result.failed} could not be delivered.`}
              </p>
              {stage.result.skipped > 0 ? (
                <p className="text-sm text-corp-text">
                  {stage.result.skipped} selected registration
                  {stage.result.skipped === 1 ? '' : 's'} shared an address with another and
                  received one copy.
                </p>
              ) : null}
              <p className="text-sm text-corp-text">
                The message is listed under Messages with the outcome for each delegate.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {error ? (
                <div role="alert" className="border border-brand-danger/40 bg-white p-3 text-sm">
                  <p className="font-semibold text-brand-danger">{error.message}</p>
                  {error.requestId ? (
                    <p className="mt-1 text-xs text-corp-muted">Request id {error.requestId}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-1">
                <label
                  htmlFor={subjectId}
                  className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase"
                >
                  Subject
                </label>
                <input
                  id={subjectId}
                  value={subject}
                  maxLength={SUBJECT_MAX}
                  autoFocus
                  disabled={busy}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. {{firstName}}, your ITTEC pre-conference check-in"
                  className="h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor={bodyId}
                    className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase"
                  >
                    Message
                  </label>
                  <div className="flex gap-1" role="group" aria-label="Editor view">
                    {(['write', 'preview'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={tab === t}
                        onClick={() => setTab(t)}
                        className={
                          tab === t
                            ? 'min-h-9 rounded-none border border-corp-ink bg-corp-ink px-3 text-sm font-medium text-white'
                            : 'min-h-9 rounded-none border border-corp-line bg-white px-3 text-sm font-medium text-corp-text hover:bg-corp-surface'
                        }
                      >
                        {t === 'write' ? 'Write' : 'Preview'}
                      </button>
                    ))}
                  </div>
                </div>

                {tab === 'write' ? (
                  <>
                    <div
                      className="flex flex-wrap items-center gap-1"
                      role="toolbar"
                      aria-label="Formatting"
                    >
                      <button
                        type="button"
                        className={toolButton}
                        aria-label="Bold"
                        title="Bold"
                        disabled={busy}
                        onClick={() => wrap('**', 'bold text')}
                      >
                        <BoldIcon className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={toolButton}
                        aria-label="Italic"
                        title="Italic"
                        disabled={busy}
                        onClick={() => wrap('*', 'italic text')}
                      >
                        <ItalicIcon className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={toolButton}
                        aria-label="Heading"
                        title="Heading"
                        disabled={busy}
                        onClick={() => prefixLines(() => '## ', 'Heading')}
                      >
                        <Heading2Icon className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={toolButton}
                        aria-label="Bulleted list"
                        title="Bulleted list"
                        disabled={busy}
                        onClick={() => prefixLines(() => '- ', 'List item')}
                      >
                        <ListIcon className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={toolButton}
                        aria-label="Numbered list"
                        title="Numbered list"
                        disabled={busy}
                        onClick={() => prefixLines((i) => `${i + 1}. `, 'List item')}
                      >
                        <ListOrderedIcon className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={toolButton}
                        aria-label="Link"
                        title="Link"
                        disabled={busy}
                        onClick={() =>
                          editSelection((s) => {
                            const label = s || 'link text';
                            const text = `[${label}](https://)`;
                            return { text, cursor: [label.length + 3, label.length + 11] };
                          })
                        }
                      >
                        <LinkIcon className="size-4" aria-hidden="true" />
                      </button>
                      <NativeSelect
                        aria-label="Insert placeholder"
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          const key = e.target.value as MessagePlaceholder | '';
                          if (key) insertPlaceholder(key);
                        }}
                        className="h-10 w-auto rounded-none text-sm"
                      >
                        <option value="">Insert placeholder…</option>
                        {messagePlaceholders.map((key) => (
                          <option key={key} value={key}>
                            {messagePlaceholderLabels[key]} {`{{${key}}}`}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <textarea
                      id={bodyId}
                      ref={bodyRef}
                      value={body}
                      maxLength={BODY_MAX}
                      disabled={busy}
                      onChange={(e) => setBody(e.target.value)}
                      rows={12}
                      placeholder={'Dear {{firstName}},\n\nWrite your message here.'}
                      className="min-h-60 w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base leading-6 md:text-sm"
                    />
                    <p className="text-xs text-corp-muted">
                      {formattingHint} {body.length.toLocaleString()}/{BODY_MAX.toLocaleString()}
                    </p>
                  </>
                ) : (
                  <div className="border border-corp-line bg-corp-surface p-4">
                    <p className="text-xs text-corp-muted">
                      Preview as it will read for {values.name}
                      {sample ? '' : ' (example delegate)'}. The event header and footer are added
                      around it.
                    </p>
                    <p className="mt-3 text-lg font-semibold text-corp-ink">
                      {substitutePlaceholders(subject, values) || '(no subject)'}
                    </p>
                    <div
                      aria-label="Message preview"
                      className="mt-3 border border-corp-line bg-white p-4"
                      // The shared renderer escapes everything it is given; this is its output.
                      dangerouslySetInnerHTML={{
                        __html: preview.html || '<p style="color:#64748b">(empty message)</p>',
                      }}
                    />
                  </div>
                )}
                {unknown.length ? (
                  <p role="alert" className="text-sm text-brand-danger">
                    Unknown placeholder{unknown.length === 1 ? '' : 's'}:{' '}
                    {unknown.map((k) => `{{${k}}}`).join(', ')}. Use{' '}
                    {messagePlaceholders.map((k) => `{{${k}}}`).join(', ')}.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-corp-line px-4 py-3 sm:flex-row sm:items-center sm:justify-end md:px-6">
          {stage.kind === 'sent' ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-tap items-center justify-center rounded-none bg-corp-ink px-5 text-sm font-semibold text-white hover:bg-corp-green"
            >
              Done
            </button>
          ) : stage.kind === 'confirm' ? (
            <>
              <p className="text-sm text-corp-ink sm:mr-auto">
                Send this message to {audience}? This cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => setStage({ kind: 'write' })}
                className="inline-flex min-h-tap items-center justify-center rounded-none border border-corp-line bg-white px-5 text-sm font-semibold text-corp-ink hover:bg-corp-surface"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void send()}
                className="inline-flex min-h-tap items-center justify-center gap-2 rounded-none bg-corp-green px-5 text-sm font-semibold text-white hover:bg-corp-ink"
              >
                <SendIcon className="size-4" aria-hidden="true" /> Send now
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="inline-flex min-h-tap items-center justify-center rounded-none border border-corp-line bg-white px-5 text-sm font-semibold text-corp-ink hover:bg-corp-surface disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => setStage({ kind: 'confirm' })}
                className="inline-flex min-h-tap items-center justify-center gap-2 rounded-none bg-corp-green px-5 text-sm font-semibold text-white hover:bg-corp-ink disabled:opacity-50"
              >
                {busy ? (
                  <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <SendIcon className="size-4" aria-hidden="true" />
                )}
                {busy
                  ? 'Sending…'
                  : `Send to ${recipientCount} delegate${recipientCount === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
