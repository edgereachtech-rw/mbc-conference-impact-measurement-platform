'use client';

import type { AssessmentStage, PairedResults } from '@mbc/shared';
import { useEffect, useState } from 'react';

import { consoleButton, Panel, StatePanel, StatTile } from '@/components/console/page';
import { apiFetch } from '@/lib/api';
import { stageLabels } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface PairedResultsProps {
  eventId: string;
  stage: AssessmentStage;
}

const signed = (n: number | null, unit = '') =>
  n === null ? '—' : `${n > 0 ? '+' : ''}${n}${unit}`;

/**
 * Before-and-after results of the sections this stage repeats from another stage (backlog
 * E11-5, E11-7): only delegates who answered at both stages count, so every change is the
 * same people's change. Knowledge sections report the paired number, averages in percent and
 * the change in percentage points; rating-scale sections report each statement, labelled as
 * self-reported.
 */
export function PairedResults({ eventId, stage }: PairedResultsProps) {
  const [data, setData] = useState<PairedResults | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ paired: PairedResults }>(`/events/${eventId}/assessments/${stage}/paired`).then(
      (r) => {
        if (!cancelled) {
          setData(r.paired);
          setError(null);
        }
      },
      (e: unknown) => {
        if (!cancelled) setError(describeError(e, 'The paired results could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, stage, attempt]);

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Paired results unavailable"
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
  if (!data) return <StatePanel kind="loading" title="Loading paired results…" />;
  if (data.sections.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="Nothing to pair yet"
        description="This stage repeats no section of another stage. Under Questions, use “Repeat a section” to ask the same knowledge or confidence questions again; the results of the same delegates are then paired here."
      />
    );
  }
  return (
    <div className="space-y-6">
      {data.sections.map((s) => (
        <section key={s.sectionId} aria-label={s.title} className="space-y-3">
          <div>
            <h3 className="font-corporate text-base font-semibold text-corp-ink">{s.title}</h3>
            <p className="text-sm text-corp-muted">
              Repeats “{s.sourceTitle}” from the {stageLabels[s.sourceStage].toLowerCase()}. Only
              delegates who submitted both stages count; the change is theirs, never a comparison of
              two different groups.
            </p>
          </div>
          {s.knowledge ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Delegates paired"
                value={s.knowledge.paired}
                hint={`Answered all ${s.knowledge.questions} questions both times`}
              />
              <StatTile
                label="Average before"
                value={
                  s.knowledge.averageBeforePercent === null
                    ? '—'
                    : `${s.knowledge.averageBeforePercent}%`
                }
              />
              <StatTile
                label="Average after"
                value={
                  s.knowledge.averageAfterPercent === null
                    ? '—'
                    : `${s.knowledge.averageAfterPercent}%`
                }
              />
              <StatTile
                label="Change"
                value={signed(s.knowledge.changePoints, ' pp')}
                tone={
                  s.knowledge.changePoints === null
                    ? 'neutral'
                    : s.knowledge.changePoints >= 0
                      ? 'positive'
                      : 'attention'
                }
                hint="Percentage points"
              />
            </div>
          ) : null}
          {s.statements.length > 0 ? (
            <Panel flush>
              <table className="w-full text-sm">
                <caption className="px-4 py-3 text-left font-corporate text-sm font-semibold text-corp-ink">
                  Self-reported confidence, before and after (average of option weights; “Not
                  applicable” and unanswered excluded)
                </caption>
                <thead className="bg-corp-surface text-xs tracking-[0.08em] text-corp-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">
                      Statement
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">
                      Paired
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">
                      Before
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">
                      After
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.statements.map((st) => (
                    <tr key={st.questionId} className="border-t border-corp-line">
                      <td className="px-4 py-2 text-corp-text">{st.prompt}</td>
                      <td className="px-4 py-2 text-right text-corp-ink tabular-nums">
                        {st.paired}
                      </td>
                      <td className="px-4 py-2 text-right text-corp-ink tabular-nums">
                        {st.averageBefore ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-corp-ink tabular-nums">
                        {st.averageAfter ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-corp-ink tabular-nums">
                        {signed(st.change)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : null}
          {!s.knowledge && s.statements.length === 0 ? (
            <p className="text-sm text-corp-muted">
              This section is not marked as knowledge or as a rating scale, so there is nothing
              numeric to pair; its answers are in the submissions.
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
