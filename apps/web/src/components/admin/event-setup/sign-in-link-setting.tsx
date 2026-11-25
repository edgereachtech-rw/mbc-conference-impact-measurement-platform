'use client';

import { signInLinkTtlChoices, type EventDetail } from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';

import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';

/**
 * How sign-in links sent to this event's delegates behave (2026-11-25): how long they last
 * (the platform's setting, longer, or not at all) and whether one can be used more than once.
 * For delegates whose company mail server holds emails until a link has expired. It never
 * applies to staff, and switching back stops the long or reusable links already sent.
 */
export function SignInLinkSetting({
  event,
  onSaved,
}: {
  event: EventDetail;
  onSaved: (event: EventDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ttl = event.signInLinkTtlMinutes ?? null;
  const reusable = event.signInLinkReusable ?? false;
  const known = signInLinkTtlChoices.some((c) => c.minutes === ttl);

  async function save(patch: {
    signInLinkTtlMinutes?: number | null;
    signInLinkReusable?: boolean;
  }) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<{ event: EventDetail }>(`/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onSaved(result.event);
    } catch (err) {
      setProblem(describeError(err, 'The setting could not be saved.').message);
    } finally {
      setBusy(false);
    }
  }

  const relaxed = ttl !== null || reusable;

  return (
    <section aria-label="Sign-in links" className="space-y-3 border border-corp-line bg-white p-4">
      <h3 className="flex items-center gap-2 font-semibold text-corp-ink">
        Sign-in links
        {busy ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : null}
      </h3>
      <p className="text-sm text-corp-text">
        How long the sign-in link and code emailed to this event&apos;s delegates keep working. Use
        a longer time when a company mail server holds emails until the link has expired. Staff
        sign-in links are not affected.
      </p>
      <div className="grid gap-1 sm:max-w-xs">
        <label htmlFor={`${event.id}-link-ttl`} className="text-sm font-semibold text-corp-ink">
          Link expires after
        </label>
        <select
          id={`${event.id}-link-ttl`}
          value={ttl === null ? '' : String(ttl)}
          disabled={busy}
          onChange={(e) =>
            void save({
              signInLinkTtlMinutes: e.target.value === '' ? null : Number(e.target.value),
            })
          }
          className="min-h-tap w-full rounded-none border border-corp-line bg-white px-3 text-base text-corp-ink md:text-sm"
        >
          {signInLinkTtlChoices.map((c) => (
            <option key={String(c.minutes)} value={c.minutes === null ? '' : String(c.minutes)}>
              {c.label}
            </option>
          ))}
          {!known && ttl !== null ? <option value={String(ttl)}>{ttl} minutes</option> : null}
        </select>
      </div>
      <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
        <input
          type="checkbox"
          checked={reusable}
          disabled={busy}
          onChange={(e) => void save({ signInLinkReusable: e.target.checked })}
          className="size-5 accent-corp-green"
        />
        A link can be used more than once
      </label>
      {relaxed ? (
        <p
          role="note"
          className="border-l-4 border-corp-accent bg-corp-accent-soft p-2 text-xs text-corp-ink"
        >
          While this is on, anyone who gets hold of a delegate&apos;s sign-in email
          {ttl === 0 ? ', at any time,' : ' within that time'} can sign in as them. Switch back to
          &quot;Platform setting&quot; and untick reuse once delegates have signed in: links already
          sent then stop working as soon as the platform&apos;s own time has passed.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-brand-danger">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
