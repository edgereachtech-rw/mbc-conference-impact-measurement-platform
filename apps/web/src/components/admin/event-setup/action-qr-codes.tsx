'use client';

import type { EventDetail, FeedbackSessionView, ReflectionDateView } from '@mbc/shared';
import { DownloadIcon, PrinterIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { consoleButton, Panel, StatePanel } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { assessmentTarget, deepLinkPath, reflectionTarget } from '@/lib/deep-links';
import { formatDateShort, stageLabels } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface Code {
  key: string;
  group: 'Daily reflection' | 'Session feedback' | 'Transfer plan' | 'Assessments';
  title: string;
  hint: string;
  /** In-app path; the QR carries it on this site's origin. */
  path: string;
}

/**
 * One QR code per action a delegate takes (task of 2026-11-06): each day's reflection, each
 * session's feedback, the transfer plan and every assessment the event runs. Shown in the room
 * or printed; a scan signs the delegate in if need be and lands on that section, with no
 * navigating through the platform. Session feedback reuses the session's own feedback link.
 */
export function ActionQrCodes({ event }: { event: EventDetail }) {
  const [sessions, setSessions] = useState<FeedbackSessionView[] | null>(null);
  const [dates, setDates] = useState<ReflectionDateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ sessions: FeedbackSessionView[] }>(`/events/${event.id}/feedback`),
      apiFetch<{ dates: ReflectionDateView[] }>(`/events/${event.id}/reflections`),
    ]).then(
      ([feedback, reflections]) => {
        if (cancelled) return;
        setSessions(feedback.sessions);
        setDates(reflections.dates);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The links could not be loaded.').message);
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
        title="QR codes unavailable"
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
  if (!sessions || !dates) return <StatePanel kind="loading" title="Preparing the QR codes…" />;

  // One code per day's reflection (2026-11-07): day 1 and day 2 land on different tabs.
  const codes: Code[] = [
    ...dates
      .filter((d) => d.activity)
      .map<Code>((d) => ({
        key: `reflection:${d.activity!.id}`,
        group: 'Daily reflection',
        title: d.activity!.title,
        hint: `${formatDateShort(d.date.date)}. Lands on this day's reflection; it answers once the organisers publish it.`,
        path: deepLinkPath(event.id, reflectionTarget(d.activity!.id)),
      })),
    ...sessions
      .filter((s) => s.enabled && s.path)
      .map<Code>((s) => ({
        key: `session:${s.id}`,
        group: 'Session feedback',
        title: s.title,
        hint: `${formatDateShort(s.date)}, ${s.startTime}–${s.endTime}. Lands on this session's feedback form${s.window === 'open' ? ', open now' : s.window === 'closed' ? ', closed' : '; it answers once you press Start on the Session feedback tab'}.`,
        path: s.path!,
      })),
    {
      key: 'transfer-plan',
      group: 'Transfer plan',
      title: 'Transfer plan',
      hint: 'For the Transfer Planning sessions: the delegate lands on their own plan.',
      path: deepLinkPath(event.id, 'transfer-plan'),
    },
    ...event.assessmentStages
      .filter((s) => s.enabled && s.questionCount > 0)
      .map<Code>((s) => ({
        key: `assessment:${s.stage}:${s.wave}`,
        group: 'Assessments',
        title: s.waveLabel || stageLabels[s.stage],
        hint:
          s.stage === 'end_of_conference'
            ? 'For the closing session: the delegate lands on the evaluation.'
            : 'The delegate lands on this assessment; it answers only while it is open.',
        path: deepLinkPath(event.id, assessmentTarget(s.stage, s.wave)),
      })),
  ];
  const groups = ['Daily reflection', 'Session feedback', 'Transfer plan', 'Assessments'] as const;

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-corporate text-h3 text-corp-ink">QR codes</h2>
            <p className="mt-1 text-sm text-corp-muted">
              Show a code on the screen or print it. Scanning opens that one section on the
              delegate&rsquo;s phone, after sign-in if they are not signed in, with nothing to find
              or choose. The codes work for every delegate of this event.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className={consoleButton({ variant: 'secondary' })}
          >
            <PrinterIcon aria-hidden="true" /> Print all
          </button>
        </div>
      </Panel>
      {groups.map((group) => {
        const items = codes.filter((c) => c.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`qr-${group}`} className="space-y-3">
            <h3 id={`qr-${group}`} className="font-corporate text-base font-semibold text-corp-ink">
              {group}
            </h3>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2">
              {items.map((c) => (
                <li key={c.key}>
                  <QrCard code={c} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function QrCard({ code }: { code: Code }) {
  const [image, setImage] = useState<string | null>(null);
  const url = typeof window === 'undefined' ? code.path : `${window.location.origin}${code.path}`;
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 360 }).then((data) => {
      if (!cancelled) setImage(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const fileName = `${code.title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-qr.png`;
  return (
    <article
      aria-label={code.title}
      className="flex h-full flex-col items-center gap-2 border border-corp-line bg-white p-4 text-center break-inside-avoid"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={`QR code: ${code.title}`}
          width={360}
          height={360}
          className="w-full max-w-[18rem]"
        />
      ) : (
        <div className="h-72 w-72 max-w-full animate-pulse bg-corp-surface" aria-hidden="true" />
      )}
      {/* The name sits under the code, as a caption: once printed and cut out, the sheet still says
          what each square is for (2026-11-07). */}
      <h4 className="font-corporate text-lg font-bold text-corp-ink">{code.title}</h4>
      <p className="text-xs text-corp-muted">{code.hint}</p>
      <p className="font-mono text-[0.7rem] break-all text-corp-muted">{url}</p>
      <div className="mt-auto flex flex-wrap justify-center gap-2 print:hidden">
        <a
          href={image ?? '#'}
          download={fileName}
          aria-disabled={!image}
          className={consoleButton({ variant: 'ghost', size: 'sm' })}
        >
          <DownloadIcon aria-hidden="true" /> Download PNG
        </a>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(url)}
          className={consoleButton({ variant: 'ghost', size: 'sm' })}
        >
          Copy link
        </button>
      </div>
    </article>
  );
}
