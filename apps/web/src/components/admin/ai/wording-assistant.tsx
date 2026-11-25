'use client';

import { aiWordingMaxLength, type AiWordingMode } from '@mbc/shared';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
import { consoleButton } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

import { useAiEnabled } from './use-ai-status';

type Field = HTMLInputElement | HTMLTextAreaElement;

const MODES: Array<{ mode: AiWordingMode; label: string }> = [
  { mode: 'improve', label: 'Improve' },
  { mode: 'shorter', label: 'Shorter' },
  { mode: 'formal', label: 'More formal' },
  { mode: 'friendlier', label: 'Friendlier' },
];

const TEXT_INPUT_TYPES = new Set(['', 'text']);

/**
 * Whether the writing assistant offers itself on a field (2026-11-25): every text box and
 * one-line text field of the admin console, except a field inside [data-no-ai] (delegate
 * details, search boxes, the assistant's own dialog), a read-only or disabled one, and inputs
 * that are not free text (email, number, date, password…).
 */
export function isAssistable(el: Element | null): el is Field {
  if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return false;
  if (el instanceof HTMLInputElement && !TEXT_INPUT_TYPES.has(el.getAttribute('type') ?? '')) {
    return false;
  }
  if (el.readOnly || el.disabled) return false;
  if (el.closest('[data-no-ai], [role="search"]')) return false;
  const hint = `${el.name} ${el.placeholder} ${el.getAttribute('aria-label') ?? ''}`;
  if (/search|filter|e-?mail|phone/i.test(hint)) return false;
  return true;
}

/** The field's label as the admin sees it, sent as context. */
export function labelOf(el: Field): string {
  const text =
    el.labels?.[0]?.textContent ?? el.getAttribute('aria-label') ?? el.placeholder ?? el.name ?? '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/\(optional\)/i, '')
    .trim()
    .slice(0, 200);
}

/** Sets a field's value the way typing does, so React and React Hook Form both see it. */
export function setFieldValue(el: Field, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The admin console's writing assistant (2026-11-25). When an admin is in a text field (a
 * question, an option, a section, an email's wording, a message), a small "Improve wording"
 * button sits at the field's top right. It opens the suggestion beside the original; the field
 * changes only when the admin chooses "Use this wording". Off when the server has no OpenAI key.
 */
export function WordingAssistant() {
  const enabled = useAiEnabled();
  const [target, setTarget] = useState<Field | null>(null);
  const targetRef = useRef<Field | null>(null);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const [open, setOpen] = useState<{ field: Field; original: string; label: string } | null>(null);

  const measure = useCallback((el: Field | null) => {
    if (!el || !el.isConnected) return setPlace(null);
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return setPlace(null);
    const above = r.top >= 36;
    setPlace({
      top: above ? r.top - 30 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (isAssistable(el)) {
        setTarget(el);
        measure(el);
      }
    };
    const onBlur = () => {
      // Clicking the button keeps focus in the field (mousedown is cancelled); anything else
      // that takes focus away hides the button.
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!isAssistable(active)) setTarget(null);
      }, 0);
    };
    const onMove = () => measure(targetRef.current);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [enabled, measure]);

  if (!enabled) return null;
  const length = target?.value.trim().length ?? 0;

  return (
    <>
      {target && place && !open && length >= 2 && length <= aiWordingMaxLength ? (
        <button
          type="button"
          data-no-ai
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen({ field: target, original: target.value, label: labelOf(target) })}
          style={{ position: 'fixed', top: place.top, right: place.right, zIndex: 60 }}
          className={`${consoleButton({ variant: 'secondary', size: 'sm' })} h-7 px-2 text-xs shadow-panel`}
        >
          <SparklesIcon aria-hidden="true" /> Improve wording
        </button>
      ) : null}
      {open ? (
        <SuggestionDialog
          original={open.original}
          label={open.label}
          singleLine={open.field instanceof HTMLInputElement}
          onClose={() => setOpen(null)}
          onUse={(text) => {
            setFieldValue(open.field, text);
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

function SuggestionDialog({
  original,
  label,
  singleLine,
  onClose,
  onUse,
}: {
  original: string;
  label: string;
  singleLine: boolean;
  onClose: () => void;
  onUse: (text: string) => void;
}) {
  const [mode, setMode] = useState<AiWordingMode>('improve');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; text: string } | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  const asked = useRef(0);

  /** A suggestion as the state to show, without touching state itself. */
  const fetchSuggestion = useCallback(
    (m: AiWordingMode): Promise<typeof state> =>
      apiFetch<{ suggestion: string }>('/ai/wording', {
        method: 'POST',
        body: JSON.stringify({
          text: original,
          mode: m,
          singleLine,
          ...(label ? { field: label } : {}),
        }),
      }).then(
        ({ suggestion }) => ({ kind: 'ready' as const, text: suggestion }),
        (e: unknown) => ({
          kind: 'error' as const,
          message: describeError(e, 'No suggestion could be made.').message,
        }),
      ),
    [original, label, singleLine],
  );

  /** Only the latest request's answer is shown. */
  function ask(m: AiWordingMode) {
    const ticket = ++asked.current;
    setMode(m);
    setState({ kind: 'loading' });
    void fetchSuggestion(m).then((next) => ticket === asked.current && setState(next));
  }

  // The first suggestion comes as the dialog opens (state starts as loading).
  useEffect(() => {
    const ticket = ++asked.current;
    void fetchSuggestion('improve').then((next) => ticket === asked.current && setState(next));
  }, [fetchSuggestion]);

  return (
    <div data-no-ai>
      <Dialog
        title="Improve wording"
        description={label ? `Field: ${label}` : undefined}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className={consoleButton({ variant: 'secondary' })}
            >
              Keep mine
            </button>
            <button
              type="button"
              disabled={state.kind !== 'ready' || state.text.trim() === ''}
              onClick={() => state.kind === 'ready' && onUse(state.text)}
              className={consoleButton({ variant: 'primary' })}
            >
              Use this wording
            </button>
          </>
        }
      >
        <div className="space-y-4" data-no-ai>
          <div role="group" aria-label="How to reword" className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                aria-pressed={mode === m.mode}
                onClick={() => ask(m.mode)}
                className={consoleButton({
                  variant: mode === m.mode ? 'accent' : 'ghost',
                  size: 'sm',
                })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              Yours
            </p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-corp-text">{original}</p>
          </div>
          <div>
            <label
              htmlFor="ai-suggestion"
              className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase"
            >
              Suggested
            </label>
            {state.kind === 'loading' ? (
              <p role="status" className="mt-1 flex items-center gap-2 text-sm text-corp-muted">
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Writing a
                suggestion…
              </p>
            ) : state.kind === 'error' ? (
              <p role="alert" className="mt-1 text-sm font-semibold text-danger">
                {state.message}
              </p>
            ) : (
              <textarea
                id="ai-suggestion"
                value={state.text}
                onChange={(e) => setState({ kind: 'ready', text: e.target.value })}
                rows={singleLine ? 2 : Math.min(12, Math.max(3, state.text.split('\n').length + 1))}
                className="mt-1 w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base text-corp-ink md:text-sm"
              />
            )}
          </div>
          <p className="text-xs text-corp-muted">
            Written by AI. Check names, dates and links before you use it; you can edit the
            suggestion here first.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
