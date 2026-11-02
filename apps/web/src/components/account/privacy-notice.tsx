'use client';

import type { ConsentNotice, ConsentState } from '@mbc/shared';
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { consoleButton, Panel } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface Props {
  notice: ConsentNotice;
  /** The signed-in delegate's state, or null for a visitor just reading the notice. */
  state: ConsentState | null;
  /** Where to send the delegate once they have accepted. */
  next: string;
  timezone: string;
}

/**
 * The privacy notice (backlog E3-7, brief section 6.4) and, for a delegate who has not accepted
 * the current version, the acceptance. The wording comes from the API, which reads it from the
 * database: this component never carries the text.
 *
 * A delegate cannot reach their records until they accept, so the notice is the first thing a new
 * delegate reads. Afterwards the page stays readable — from the sign-in page, the profile and the
 * footer — because the point is that they can go back and check what they agreed to.
 */
export function PrivacyNotice({ notice, state, next, timezone }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const outstanding = state?.outstanding ?? false;

  async function accept() {
    setBusy(true);
    setProblem(null);
    try {
      await apiFetch('/me/consent', {
        method: 'POST',
        body: JSON.stringify({ document: notice.document, version: notice.version }),
      });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setProblem(describeError(err, 'Your acceptance could not be recorded.').message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <h2 className="font-corporate text-h3 text-corp-ink">{notice.headline}</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-corp-text">
          {notice.paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
        <p className="mt-4 border-t border-corp-line pt-3 text-xs text-corp-muted">
          {notice.title} · version {notice.version} · in force since{' '}
          {formatInstant(notice.effectiveFrom, timezone)}
        </p>
      </Panel>

      {outstanding ? (
        <Panel>
          <h3 className="font-semibold text-corp-ink">Before you continue</h3>
          <p className="mt-1 text-sm text-corp-muted">
            Please confirm you have read this. We record the date and which version you were shown,
            and you can read it again at any time from your profile.
          </p>
          {problem ? (
            <p role="alert" className="mt-3 text-sm font-semibold text-brand-danger">
              {problem}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void accept()}
            disabled={busy}
            className={`${consoleButton({ variant: 'accent' })} mt-3`}
          >
            {busy ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2Icon aria-hidden="true" />
            )}
            I have read this and want to continue
          </button>
        </Panel>
      ) : state?.acceptedAt ? (
        <Panel>
          <p className="flex flex-wrap items-center gap-2 text-sm text-corp-text">
            <CheckCircle2Icon className="size-4 text-corp-green-text" aria-hidden="true" />
            You accepted version {state.acceptedVersion} on{' '}
            {formatInstant(state.acceptedAt, timezone)}.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
