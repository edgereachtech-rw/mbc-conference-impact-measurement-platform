'use client';

import {
  delegateMessageMaxRecipients,
  type AssessmentStage,
  type StageNonCompleter,
  type StageResponseDetail,
  type StageResponseListItem,
  type StageSummary,
} from '@mbc/shared';
import { DownloadIcon, EyeIcon, Loader2Icon, MailIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { MessageComposer } from '@/components/admin/message-composer';
import { Dialog } from '@/components/console/dialog';
import { consoleButton, Panel, StatePanel, StatTile, StatusPill } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { formatInstant } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface StageSubmissionsProps {
  eventId: string;
  eventName: string;
  stage: AssessmentStage;
  timezone: string;
  /** Archived events show the figures but offer no reminders. */
  readOnly?: boolean;
}

/**
 * Submissions of one assessment stage (backlog E5-6, E5-9, E5-10): who was invited, started and
 * submitted, the knowledge average, the statement averages, the CSV export, every delegate's
 * response with its section progress (and the full answers of one delegate, section by
 * section), and the list of delegates who have not submitted, with a reminder through the
 * message composer.
 */
export function StageSubmissions({
  eventId,
  eventName,
  stage,
  timezone,
  readOnly,
}: StageSubmissionsProps) {
  const [summary, setSummary] = useState<StageSummary | null>(null);
  const [pending, setPending] = useState<StageNonCompleter[]>([]);
  const [responses, setResponses] = useState<StageResponseListItem[]>([]);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<
    | null
    | { kind: 'loading'; delegateId: string; name: string }
    | { kind: 'ready'; detail: StageResponseDetail }
    | { kind: 'error'; name: string; message: string }
  >(null);
  const base = `/events/${eventId}/assessments/${stage}`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ summary?: StageSummary }>(`${base}/summary`),
      apiFetch<{ delegates?: StageNonCompleter[] }>(`${base}/non-completers`),
      apiFetch<{ responses?: StageResponseListItem[] }>(`${base}/responses`),
    ]).then(
      ([s, p, r]) => {
        if (cancelled) return;
        setSummary(s.summary ?? null);
        setPending(p.delegates ?? []);
        setResponses(r.responses ?? []);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The submissions could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base, attempt]);

  async function view(item: StageResponseListItem) {
    setViewing({ kind: 'loading', delegateId: item.delegateId, name: item.name });
    try {
      const result = await apiFetch<{ response: StageResponseDetail }>(
        `${base}/responses/${item.delegateId}`,
      );
      setViewing({ kind: 'ready', detail: result.response });
    } catch (e) {
      setViewing({
        kind: 'error',
        name: item.name,
        message: describeError(e, 'The response could not be loaded.').message,
      });
    }
  }

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Submissions unavailable"
        description={error.message}
        requestId={error.requestId}
        action={
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={consoleButton({ variant: 'secondary', size: 'sm' })}
          >
            Try again
          </button>
        }
      />
    );
  }
  if (!summary) return <StatePanel kind="loading" title="Loading submissions…" />;

  const recipients = pending.slice(0, delegateMessageMaxRecipients);
  const knowledge = summary.knowledge;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Invited" value={summary.invited} />
        <StatTile label="Started" value={summary.started} hint="Saved a draft or submitted" />
        <StatTile
          label="Submitted"
          value={summary.submitted}
          tone={summary.submitted > 0 ? 'positive' : 'neutral'}
          hint={
            summary.responseRate === null ? 'Nobody invited' : `${summary.responseRate}% of invited`
          }
        />
      </div>

      {knowledge ? (
        <Panel>
          <h3 className="font-corporate text-sm font-semibold text-corp-ink">Knowledge score</h3>
          <p className="mt-1 text-sm text-corp-text">
            {knowledge.averageScore === null
              ? `No delegate has submitted answers to all ${knowledge.questions} knowledge questions yet.`
              : `Average ${knowledge.averageScore} of ${knowledge.questions} (${knowledge.averagePercent}%) across ${knowledge.respondents} submitted ${knowledge.respondents === 1 ? 'response' : 'responses'} that answered every knowledge question.`}
          </p>
        </Panel>
      ) : null}

      {summary.statements.length ? (
        <Panel flush>
          <table className="w-full text-sm">
            <caption className="px-4 py-3 text-left font-corporate text-sm font-semibold text-corp-ink">
              Rating-scale statements (average of option weights; “Not applicable” excluded)
            </caption>
            <thead className="bg-corp-surface text-xs tracking-[0.08em] text-corp-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-semibold">
                  Statement
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Answers
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Average
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.statements.map((s) => (
                <tr key={s.questionId} className="border-t border-corp-line">
                  <td className="px-4 py-2 text-corp-text">{s.prompt}</td>
                  <td className="px-4 py-2 text-right text-corp-ink tabular-nums">{s.responses}</td>
                  <td className="px-4 py-2 text-right text-corp-ink tabular-nums">
                    {s.average === null ? '—' : s.average}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {summary.submitted > 0 ? (
          <a
            href={`/api/v1${base}/responses.csv`}
            download
            className={consoleButton({ variant: 'secondary' })}
          >
            <DownloadIcon aria-hidden="true" /> Download responses (CSV)
          </a>
        ) : (
          <p className="text-sm text-corp-muted">
            The CSV export appears once the first response is submitted.
          </p>
        )}
      </div>

      <Panel flush>
        <div className="px-4 py-3">
          <h3 className="font-corporate text-sm font-semibold text-corp-ink">
            Responses ({responses.length})
          </h3>
          <p className="text-xs text-corp-muted">
            Every delegate who started or submitted, with the sections submitted so far. Open one to
            read all their answers, section by section.
          </p>
        </div>
        {responses.length === 0 ? (
          <p className="border-t border-corp-line px-4 py-3 text-sm text-corp-muted">
            No delegate has started yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Responses by delegate">
              <thead className="bg-corp-surface text-xs tracking-[0.08em] text-corp-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Delegate
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Progress
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">
                    Submitted
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => (
                  <tr key={r.delegateId} className="border-t border-corp-line align-top">
                    <td className="px-4 py-2">
                      <span className="font-semibold text-corp-ink">{r.name}</span>
                      {r.organisation ? (
                        <span className="block text-xs text-corp-muted">{r.organisation}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-corp-text">
                      {r.sectionsSubmitted} of {r.sectionsTotal} section
                      {r.sectionsTotal === 1 ? '' : 's'} · {r.answered} answer
                      {r.answered === 1 ? '' : 's'}
                    </td>
                    <td className="px-4 py-2">
                      {r.submittedAt ? (
                        <StatusPill tone="positive">
                          {formatInstant(r.submittedAt, timezone)}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="attention">In progress</StatusPill>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`View answers: ${r.name}`}
                        onClick={() => void view(r)}
                        className={consoleButton({ variant: 'ghost', size: 'sm' })}
                      >
                        <EyeIcon aria-hidden="true" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-corporate text-sm font-semibold text-corp-ink">
            Not yet submitted ({pending.length})
          </h3>
          {!readOnly && recipients.length ? (
            <button
              type="button"
              onClick={() => {
                setSentNotice(null);
                setComposerOpen(true);
              }}
              className={consoleButton({ variant: 'accent', size: 'sm' })}
            >
              <MailIcon aria-hidden="true" /> Email these delegates
              {pending.length > recipients.length ? ` (first ${recipients.length})` : ''}
            </button>
          ) : null}
        </div>
        {sentNotice ? (
          <p role="status" className="mt-2 text-sm text-corp-green-text">
            {sentNotice}
          </p>
        ) : null}
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-corp-muted">Everyone invited has submitted.</p>
        ) : (
          <ul
            aria-label="Delegates who have not submitted"
            className="mt-3 max-h-96 divide-y divide-corp-line overflow-y-auto text-sm"
          >
            {pending.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span>
                  <span className="font-semibold text-corp-ink">{d.name}</span>
                  {d.organisation ? ` · ${d.organisation}` : ''}
                </span>
                <span className="text-corp-muted">
                  {!d.signedUp ? 'Not signed up' : d.started ? 'Started' : 'Not started'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {viewing ? (
        <Dialog
          title={
            viewing.kind === 'ready'
              ? `Answers: ${viewing.detail.delegate.name}`
              : `Answers: ${viewing.name}`
          }
          description={
            viewing.kind === 'ready'
              ? `${viewing.detail.delegate.email}${viewing.detail.delegate.organisation ? ` · ${viewing.detail.delegate.organisation}` : ''} · ${
                  viewing.detail.submittedAt
                    ? `submitted ${formatInstant(viewing.detail.submittedAt, timezone)}`
                    : 'in progress'
                }`
              : undefined
          }
          onClose={() => setViewing(null)}
          footer={
            <button
              type="button"
              onClick={() => setViewing(null)}
              className={consoleButton({ variant: 'secondary' })}
            >
              Close
            </button>
          }
        >
          {viewing.kind === 'loading' ? (
            <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading answers…
            </p>
          ) : viewing.kind === 'error' ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {viewing.message}
            </p>
          ) : (
            <div className="space-y-6">
              {viewing.detail.sections.map((section) => (
                <section
                  key={section.key}
                  aria-label={`Section: ${section.title}`}
                  className="space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-corp-line pb-1">
                    <h3 className="font-corporate text-sm font-semibold text-corp-ink">
                      {section.title}
                    </h3>
                    {section.submittedAt ? (
                      <StatusPill tone="positive">
                        Submitted {formatInstant(section.submittedAt, timezone)}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="attention">Not submitted</StatusPill>
                    )}
                  </div>
                  <dl className="space-y-3">
                    {section.questions.map((q) => (
                      <div key={q.id}>
                        <dt className="text-sm text-corp-text">{q.prompt}</dt>
                        <dd className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              q.answer
                                ? 'text-sm font-semibold text-corp-ink'
                                : 'text-sm text-corp-muted'
                            }
                          >
                            {q.answer || 'No answer'}
                          </span>
                          {q.isKnowledge && q.correct !== null ? (
                            <StatusPill tone={q.correct ? 'positive' : 'attention'}>
                              {q.correct ? 'Correct · 1 point' : 'Wrong · 0 points'}
                            </StatusPill>
                          ) : null}
                          {!q.isKnowledge && q.score !== null && section.marking === 'scored' ? (
                            <span className="text-xs text-corp-muted">weight {q.score}</span>
                          ) : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}
        </Dialog>
      ) : null}

      {composerOpen && recipients.length ? (
        <MessageComposer
          eventId={eventId}
          eventName={eventName}
          recipients={{ delegateIds: recipients.map((d) => d.id) }}
          recipientCount={recipients.length}
          sample={{
            name: recipients[0]!.name,
            email: recipients[0]!.email,
            organisation: recipients[0]!.organisation,
          }}
          onClose={() => setComposerOpen(false)}
          onSent={(result) => {
            setComposerOpen(false);
            setSentNotice(
              `Reminder sent to ${result.sent} of ${result.total} delegate${result.total === 1 ? '' : 's'}.`,
            );
          }}
        />
      ) : null}
    </div>
  );
}
