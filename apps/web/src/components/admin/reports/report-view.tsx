'use client';

import {
  actionProgressLabels,
  actionProgressStatuses,
  dataStateLabels,
  evidenceSupportLabels,
  evidenceSupports,
  formatFigure,
  improvementDirectionLabels,
  measureOutcomeLabels,
  measureSummaries,
  measureSummaryLabels,
  reminderFrequencies,
  reminderFrequencyLabels,
  reportSectionLabels,
  type ChoiceDistribution,
  type DataState,
  type EventReport,
  type Figure,
  type ReportSection,
  type StageParticipation,
  type StatementAverage,
  type TextAnswers,
} from '@mbc/shared';
import { AlertTriangleIcon } from 'lucide-react';

import { Panel, StatTile, StatusPill, TableScroll } from '@/components/console/page';
import { formatDateShort, formatInstant, stageLabels } from '@/lib/events';

/**
 * Renders one report document (task of 2026-10-31, §2 and §5): every figure with its count,
 * its denominator and its definition, states instead of zeros where nothing could be answered
 * yet, the self-reported labels, and the limitations. The same component serves the dashboard
 * and every report kind; what it may show was already decided by the API for that audience.
 */

const stateText = (s: DataState) => dataStateLabels[s] || '';

/** A measure value with its unit; a blank value reads as a dash, never as a bare unit. */
function withUnit(value: string, unit: string) {
  const v = value.trim();
  if (!v) return '—';
  return unit.trim() ? `${v} ${unit.trim()}` : v;
}

function FigureLine({ label, value }: { label: string; value: Figure }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
      <dt className="text-corp-text">
        {label}
        <span className="block text-xs text-corp-muted">{value.definition}</span>
      </dt>
      <dd className="font-semibold text-corp-ink tabular-nums">{formatFigure(value)}</dd>
    </div>
  );
}

function StageLine({ stage }: { stage: StageParticipation }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
      <span className="text-corp-text">{stageLabels[stage.stage]}</span>
      {stage.state === 'not_configured' ? (
        <StatusPill tone="neutral">{stateText(stage.state)}</StatusPill>
      ) : (
        <span className="text-corp-ink tabular-nums">
          {stage.submitted} of {stage.invited} submitted
          {stage.responseRate === null ? '' : ` (${stage.responseRate}%)`} ·{' '}
          {stage.started - stage.submitted} started only · {stage.notSubmitted} no submission
          {stage.state === 'not_yet_available' ? ` · ${stateText(stage.state)}` : ''}
        </span>
      )}
    </div>
  );
}

function Distribution({ d }: { d: ChoiceDistribution }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-corp-ink">
        {d.prompt}
        {d.sectionTitle ? (
          <span className="font-normal text-corp-muted"> · {d.sectionTitle}</span>
        ) : null}
      </p>
      <p className="text-xs text-corp-muted">
        {d.responses} answered{d.multiple ? ', several options allowed' : ''}.
        {d.state === 'ok' ? '' : ` ${stateText(d.state)}.`}
      </p>
      {d.responses > 0 ? (
        <dl className="divide-y divide-corp-line text-sm">
          {d.options.map((o) => (
            <div key={o.value} className="flex items-center justify-between gap-2 py-1">
              <dt className="text-corp-text">{o.label}</dt>
              <dd className="text-corp-ink tabular-nums">
                {o.count}
                {o.percent === null ? '' : ` (${o.percent}%)`}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function Statements({ title, rows }: { title: string; rows: StatementAverage[] }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-corp-ink">{title}</p>
      <p className="text-xs text-corp-muted">
        Self-reported. Average of the option scores; “Not applicable” and blanks are excluded from
        the average.
      </p>
      <TableScroll>
        <table className="w-full text-sm">
          <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
            <tr>
              <th className="px-3 py-2">Statement</th>
              <th className="px-3 py-2">Respondents</th>
              <th className="px-3 py-2">Average</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-corp-line">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-1.5 text-corp-text">{r.prompt}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.responses}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.average ?? stateText(r.state)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

function Texts({ t }: { t: TextAnswers }) {
  return (
    <details className="border-t border-corp-line pt-2">
      <summary className="cursor-pointer text-sm font-semibold text-corp-green-text">
        {t.prompt} ({t.responses})
        {t.sectionTitle ? (
          <span className="font-normal text-corp-muted"> · {t.sectionTitle}</span>
        ) : null}
      </summary>
      {t.answers.length === 0 ? (
        <p className="mt-1 text-xs text-corp-muted">{stateText(t.state)}.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-corp-text">
          {t.answers.map((a, i) => (
            <li key={i} className="border-l-2 border-corp-line pl-3">
              {a.delegate ? (
                <span className="font-semibold text-corp-ink">
                  {a.delegate.name}
                  {a.delegate.organisation ? ` (${a.delegate.organisation})` : ''}:{' '}
                </span>
              ) : null}
              {a.value}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Counts({ label, rows }: { label: string; rows: Array<[string, number]> }) {
  return (
    <div>
      <p className="text-sm font-semibold text-corp-ink">{label}</p>
      <dl className="mt-1 divide-y divide-corp-line text-sm">
        {rows.map(([name, value]) => (
          <div key={name} className="flex items-center justify-between py-1">
            <dt className="text-corp-text">{name}</dt>
            <dd className="font-semibold text-corp-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SectionHeading({ id, section }: { id: string; section: ReportSection }) {
  return (
    <h2 id={id} className="font-corporate text-h3 text-corp-ink">
      {reportSectionLabels[section]}
    </h2>
  );
}

export function ReportView({ report, timezone }: { report: EventReport; timezone: string }) {
  const unapproved = report.approval?.required && !report.approval.covers;
  return (
    <div className="space-y-8">
      {unapproved ? (
        <div
          role="alert"
          className="flex items-start gap-2 border border-brand-danger/40 bg-brand-danger/10 p-3 text-sm text-brand-danger"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Draft: not approved for sharing.</span> This report is
            for an external audience. Review it and record M.Bryan’s approval before it can be
            downloaded or shared. The platform never sends a report anywhere by itself.
          </p>
        </div>
      ) : null}

      <Panel>
        <h2 className="font-corporate text-sm font-semibold text-corp-ink">
          What this report covers
        </h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-corp-muted">Event</dt>
            <dd className="text-corp-ink">
              {report.event.name} ({report.event.code}) · {formatDateShort(report.event.startsOn)}{' '}
              to {formatDateShort(report.event.endsOn)} · {report.event.timezone}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-corp-muted">Reporting date</dt>
            <dd className="text-corp-ink">{formatInstant(report.generatedAt, timezone)}</dd>
          </div>
          <div>
            <dt className="text-xs text-corp-muted">Reporting period</dt>
            <dd className="text-corp-ink">
              {report.filters.from || report.filters.to
                ? `${report.filters.from ?? 'event start'} to ${report.filters.to ?? 'the reporting date'}`
                : 'Everything recorded to the reporting date'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-corp-muted">Population</dt>
            <dd className="text-corp-ink">
              {report.population.registered} delegates. {report.population.description}.
            </dd>
          </div>
          {report.approval?.current ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-corp-muted">Approved for sharing</dt>
              <dd className="text-corp-ink">
                {formatInstant(report.approval.current.approvedAt, timezone)}
                {report.approval.current.approvedBy
                  ? ` by ${report.approval.current.approvedBy}`
                  : ''}{' '}
                · sections:{' '}
                {report.approval.current.sections.map((s) => reportSectionLabels[s]).join(', ')}
                {report.approval.current.note ? ` · ${report.approval.current.note}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-3 border-t border-corp-line pt-3">
          <p className="text-sm font-semibold text-corp-ink">How to read it</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-corp-text">
            {report.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      </Panel>

      {report.participation ? (
        <section aria-labelledby="report-participation" className="space-y-3">
          <SectionHeading id="report-participation" section="participation" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile
              label="Registered"
              value={report.participation.registered.count}
              hint="in scope"
            />
            <StatTile
              label="Platform accounts"
              value={report.participation.accounts.count}
              hint={formatFigure(report.participation.accounts)}
            />
            <StatTile
              label="Signed in"
              value={report.participation.signedIn.count}
              hint={formatFigure(report.participation.signedIn)}
            />
            <StatTile
              label="Attended"
              value={report.participation.attended.count}
              hint={formatFigure(report.participation.attended)}
              tone={report.participation.attended.count ? 'positive' : 'neutral'}
            />
            <StatTile
              label="Assessed"
              value={report.participation.assessed.count}
              hint={formatFigure(report.participation.assessed)}
            />
          </div>
          <Panel>
            <dl aria-label="Participation figures" className="divide-y divide-corp-line text-sm">
              <FigureLine label="Registered delegates" value={report.participation.registered} />
              <FigureLine label="With a platform account" value={report.participation.accounts} />
              <FigureLine label="Signed in at least once" value={report.participation.signedIn} />
              <FigureLine
                label="Attended at least one date"
                value={report.participation.attended}
              />
              <FigureLine
                label="Submitted at least one assessment"
                value={report.participation.assessed}
              />
            </dl>
          </Panel>
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">By attendance format</p>
            <TableScroll>
              <table className="mt-2 w-full text-sm">
                <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                  <tr>
                    <th className="px-3 py-2">Format</th>
                    <th className="px-3 py-2">Registered</th>
                    <th className="px-3 py-2">Accounts</th>
                    <th className="px-3 py-2">Attended</th>
                    <th className="px-3 py-2">Attended %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-corp-line">
                  {report.participation.byFormat.map((f) => (
                    <tr key={f.format}>
                      <td className="px-3 py-1.5">
                        {f.format === 'physical' ? 'In person' : 'Online'}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{f.registered}</td>
                      <td className="px-3 py-1.5 tabular-nums">{f.accounts}</td>
                      <td className="px-3 py-1.5 tabular-nums">{f.attended}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {f.attendedRate === null ? '—' : `${f.attendedRate}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
          {report.participation.byDate.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">Attendance by event date</p>
              <TableScroll>
                <table className="mt-2 w-full text-sm">
                  <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Attended</th>
                      <th className="px-3 py-2">Partial</th>
                      <th className="px-3 py-2">Absent</th>
                      <th className="px-3 py-2">Not checked in</th>
                      <th className="px-3 py-2">In person</th>
                      <th className="px-3 py-2">Online</th>
                      <th className="px-3 py-2">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-corp-line">
                    {report.participation.byDate.map((d) => (
                      <tr key={d.id}>
                        <td className="px-3 py-1.5">
                          {formatDateShort(d.date)}
                          <span className="block text-xs text-corp-muted">
                            {d.closed ? 'closed' : 'open'}
                            {d.state === 'ok' ? '' : ` · ${stateText(d.state)}`}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 tabular-nums">{d.attended}</td>
                        <td className="px-3 py-1.5 tabular-nums">{d.partial}</td>
                        <td className="px-3 py-1.5 tabular-nums">{d.absent}</td>
                        <td className="px-3 py-1.5 tabular-nums">{d.notCheckedIn}</td>
                        <td className="px-3 py-1.5 tabular-nums">{d.physical}</td>
                        <td className="px-3 py-1.5 tabular-nums">{d.virtual}</td>
                        <td className="px-3 py-1.5 tabular-nums">
                          {d.rate === null ? '—' : `${d.rate}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          ) : null}
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">Assessment completion</p>
            <dl aria-label="Assessment completion" className="mt-1 divide-y divide-corp-line">
              {report.participation.stages.map((s) => (
                <StageLine key={s.stage} stage={s} />
              ))}
            </dl>
          </Panel>
          {report.participation.feedback.sessionsEnabled ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">Session feedback response rates</p>
              <dl className="mt-1 divide-y divide-corp-line text-sm">
                {report.participation.feedback.sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  >
                    <dt className="text-corp-text">
                      {formatDateShort(s.date)} · {s.title}
                    </dt>
                    <dd className="text-corp-ink tabular-nums">
                      {s.submitted} of {s.attended} who attended
                      {s.rate === null ? ` · ${stateText(s.state)}` : ` (${s.rate}%)`}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">Definitions</p>
            <dl className="mt-1 space-y-1 text-xs text-corp-text">
              {report.participation.definitions.map((d) => (
                <div key={d.term}>
                  <dt className="inline font-semibold text-corp-ink">{d.term}: </dt>
                  <dd className="inline">{d.definition}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </section>
      ) : null}

      {report.expectations ? (
        <section aria-labelledby="report-expectations" className="space-y-3">
          <SectionHeading id="report-expectations" section="expectations" />
          {report.expectations.stage ? (
            <Panel>
              <dl className="divide-y divide-corp-line">
                <StageLine stage={report.expectations.stage} />
              </dl>
            </Panel>
          ) : null}
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">Baseline knowledge</p>
            <p className="mt-1 text-sm text-corp-text">
              {!report.expectations.knowledge
                ? 'No knowledge questions in the pre-conference assessment.'
                : report.expectations.knowledge.state === 'ok'
                  ? `Average ${report.expectations.knowledge.averageScore} of ${report.expectations.knowledge.questions} (${report.expectations.knowledge.averagePercent}%), from ${report.expectations.knowledge.respondents} delegates who answered every knowledge question.`
                  : stateText(report.expectations.knowledge.state)}
            </p>
          </Panel>
          {report.expectations.statements.length ? (
            <Panel>
              <Statements
                title="Baseline self-reported confidence and current practices"
                rows={report.expectations.statements}
              />
            </Panel>
          ) : null}
          {report.expectations.choices.length ? (
            <Panel>
              <div className="space-y-4">
                {report.expectations.choices.map((d) => (
                  <Distribution key={d.key} d={d} />
                ))}
              </div>
            </Panel>
          ) : null}
          {report.expectations.texts.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">
                Expectations and priority challenges, as delegates wrote them
              </p>
              <div className="mt-2 space-y-2">
                {report.expectations.texts.map((t) => (
                  <Texts key={t.key} t={t} />
                ))}
              </div>
            </Panel>
          ) : null}
          <p className="text-xs text-corp-muted">
            Nominating organisation expectations:{' '}
            {stateText(report.expectations.organisationExpectations.state)}.
          </p>
        </section>
      ) : null}

      {report.experience ? (
        <section aria-labelledby="report-experience" className="space-y-3">
          <SectionHeading id="report-experience" section="experience" />
          {report.experience.stage ? (
            <Panel>
              <dl className="divide-y divide-corp-line">
                <StageLine stage={report.experience.stage} />
              </dl>
            </Panel>
          ) : null}
          {(['all', 'physical', 'virtual'] as const).some(
            (k) => report.experience!.ratings[k].length,
          ) ? (
            <Panel>
              <div className="space-y-4">
                <Statements
                  title="Conference experience (all delegates)"
                  rows={report.experience.ratings.all}
                />
                <Statements
                  title="Physical experience (in-person delegates)"
                  rows={report.experience.ratings.physical}
                />
                <Statements
                  title="Virtual experience (online delegates)"
                  rows={report.experience.ratings.virtual}
                />
              </div>
            </Panel>
          ) : null}
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">Knowledge</p>
            <dl className="mt-1 divide-y divide-corp-line text-sm">
              {(
                [
                  ['Before the event', report.experience.knowledge.before],
                  ['At the end of the event', report.experience.knowledge.after],
                ] as const
              ).map(([label, k]) => (
                <div
                  key={label}
                  className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                >
                  <dt className="text-corp-text">{label}</dt>
                  <dd className="text-corp-ink tabular-nums">
                    {!k
                      ? 'No knowledge questions'
                      : k.state === 'ok'
                        ? `${k.averagePercent}% average over ${k.questions} questions, ${k.respondents} respondents`
                        : stateText(k.state)}
                  </dd>
                </div>
              ))}
            </dl>
            {report.experience.paired?.sections.map((s) => (
              <div key={s.sectionId} className="mt-3 border-t border-corp-line pt-3">
                <p className="text-sm font-semibold text-corp-ink">
                  Paired comparison · {s.title} against {s.sourceTitle}
                </p>
                <p className="text-xs text-corp-muted">
                  Only delegates who submitted both stages and answered the question both times.
                </p>
                {s.knowledge ? (
                  <p className="mt-1 text-sm text-corp-text">
                    {s.knowledge.paired} paired delegates: {s.knowledge.averageBeforePercent ?? '—'}
                    % before, {s.knowledge.averageAfterPercent ?? '—'}% after, change{' '}
                    {s.knowledge.changePoints ?? '—'} percentage points.
                  </p>
                ) : null}
                {s.statements.length ? (
                  <TableScroll>
                    <table className="mt-2 w-full text-sm">
                      <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                        <tr>
                          <th className="px-3 py-2">Statement (self-reported)</th>
                          <th className="px-3 py-2">Paired</th>
                          <th className="px-3 py-2">Before</th>
                          <th className="px-3 py-2">After</th>
                          <th className="px-3 py-2">Change</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-corp-line">
                        {s.statements.map((st) => (
                          <tr key={st.questionId}>
                            <td className="px-3 py-1.5 text-corp-text">{st.prompt}</td>
                            <td className="px-3 py-1.5 tabular-nums">{st.paired}</td>
                            <td className="px-3 py-1.5 tabular-nums">{st.averageBefore ?? '—'}</td>
                            <td className="px-3 py-1.5 tabular-nums">{st.averageAfter ?? '—'}</td>
                            <td className="px-3 py-1.5 tabular-nums">{st.change ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                ) : null}
              </div>
            ))}
          </Panel>
          {report.experience.reflections.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">Daily Learning Reflections</p>
              <p className="text-xs text-corp-muted">
                One per event date the organisers enabled; the event’s own dates and titles, not
                fixed day numbers.
              </p>
              <div className="mt-2 space-y-3">
                {report.experience.reflections.map((r) => (
                  <div key={r.id} className="border-t border-corp-line pt-2">
                    <p className="text-sm text-corp-ink">
                      <span className="font-semibold">
                        {formatDateShort(r.date)} · {r.title}
                      </span>{' '}
                      <span className="text-corp-muted">
                        {r.submitted} of {r.registered} submitted
                        {r.rate === null ? '' : ` (${r.rate}%)`}
                        {r.state === 'ok' ? '' : ` · ${stateText(r.state)}`}
                      </span>
                    </p>
                    <div className="mt-1 space-y-1">
                      {r.questions.map((q) => (
                        <Texts key={q.key} t={q} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
          {report.experience.feedback.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">Session feedback</p>
              <div className="mt-2 space-y-3">
                {report.experience.feedback.map((f) => (
                  <div key={f.id} className="border-t border-corp-line pt-2">
                    <p className="text-sm text-corp-ink">
                      <span className="font-semibold">
                        {formatDateShort(f.date)} · {f.title}
                      </span>{' '}
                      <span className="text-corp-muted">
                        {f.submitted} responses from {f.attended} checked in that day
                      </span>
                    </p>
                    {f.ratings.map((r) => (
                      <p key={r.prompt} className="mt-1 text-xs text-corp-text">
                        {r.prompt}: {r.total} rated ·{' '}
                        {r.ratings.map((v) => `${v.rating} ${v.count} (${v.percent}%)`).join(', ')}
                      </p>
                    ))}
                    <div className="mt-1 space-y-1">
                      {f.written.map((w) => (
                        <Texts key={w.key} t={w} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
          {report.experience.written.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">
                Learning gained, unresolved needs and suggestions
              </p>
              <div className="mt-2 space-y-2">
                {report.experience.written.map((t) => (
                  <Texts key={t.key} t={t} />
                ))}
              </div>
            </Panel>
          ) : null}
        </section>
      ) : null}

      {report.expectationsEnd ? (
        <section aria-labelledby="report-expectations-end" className="space-y-3">
          <SectionHeading id="report-expectations-end" section="expectations_end" />
          <Panel>
            <dl className="divide-y divide-corp-line text-sm">
              {report.expectationsEnd.stage ? (
                <StageLine stage={report.expectationsEnd.stage} />
              ) : null}
              <FigureLine
                label="Completed the expectations evaluation"
                value={report.expectationsEnd.completed}
              />
              <FigureLine
                label="Recorded an expectation only after the event"
                value={report.expectationsEnd.recordedAfter}
              />
              <div className="flex items-center justify-between gap-2 py-1.5">
                <dt className="text-corp-text">Preferred not to answer</dt>
                <dd className="font-semibold text-corp-ink tabular-nums">
                  {report.expectationsEnd.preferNotToAnswer}
                </dd>
              </div>
            </dl>
          </Panel>
          {report.expectationsEnd.met ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">
                Pre-event expectations, as assessed at the end
              </p>
              <div className="mt-2">
                <Distribution d={report.expectationsEnd.met} />
              </div>
            </Panel>
          ) : null}
          {report.expectationsEnd.metPost ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">
                Expectations recorded after the event
              </p>
              <p className="text-xs text-corp-muted">
                Reported separately from pre-event expectations: these were first written down at
                the end of the event.
              </p>
              <div className="mt-2">
                <Distribution d={report.expectationsEnd.metPost} />
              </div>
            </Panel>
          ) : null}
          {report.expectationsEnd.explanations.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">
                What delegates gained, in their words
              </p>
              <div className="mt-2 space-y-2">
                {report.expectationsEnd.explanations.map((t) => (
                  <Texts key={t.key} t={t} />
                ))}
              </div>
            </Panel>
          ) : null}
        </section>
      ) : null}

      {report.transfer ? (
        <section aria-labelledby="report-transfer" className="space-y-3">
          <SectionHeading id="report-transfer" section="transfer" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label="Plans started"
              value={report.transfer.plans.started.count}
              hint={formatFigure(report.transfer.plans.started)}
            />
            <StatTile
              label="Plans submitted"
              value={report.transfer.plans.submitted.count}
              hint={formatFigure(report.transfer.plans.submitted)}
              tone={report.transfer.plans.submitted.count ? 'positive' : 'neutral'}
            />
            <StatTile
              label="Incomplete"
              value={report.transfer.plans.incomplete.count}
              hint={`plus ${report.transfer.plans.empty} opened but empty`}
            />
            <StatTile
              label="Applied actions"
              value={report.transfer.application.appliedActions.count}
              hint={formatFigure(report.transfer.application.appliedActions)}
            />
          </div>
          <Panel>
            <dl aria-label="Transfer plan figures" className="divide-y divide-corp-line text-sm">
              <FigureLine label="Plans started" value={report.transfer.plans.started} />
              <FigureLine label="Plans submitted" value={report.transfer.plans.submitted} />
              <FigureLine label="Plans incomplete" value={report.transfer.plans.incomplete} />
              <FigureLine label="Completion rate" value={report.transfer.plans.completionRate} />
              <FigureLine
                label="Applied actions"
                value={report.transfer.application.appliedActions}
              />
              <FigureLine
                label="Delegates reporting application"
                value={report.transfer.application.appliedDelegates}
              />
              <FigureLine
                label="Plans completed (applied, with evidence)"
                value={report.transfer.application.impact.completed}
              />
              <FigureLine
                label="Applied, no measurable improvement yet"
                value={report.transfer.application.impact.applied}
              />
              <FigureLine
                label="Impact demonstrated"
                value={report.transfer.application.impact.impactDemonstrated}
              />
              <FigureLine
                label="Sustained impact"
                value={report.transfer.application.impact.sustainedImpact}
              />
            </dl>
            <p className="mt-2 text-xs text-corp-muted">
              A started plan, a submitted plan and an acted-upon plan are three different things: a
              submitted plan does not show that its actions happened.
            </p>
            <p className="mt-1 text-xs text-corp-muted">
              Completion shows application, not impact. Impact demonstrated and sustained impact are
              what delegates reported with evidence at completion and at the later impact checks (
              {report.transfer.application.impact.checksAnswered} answered,{' '}
              {report.transfer.application.impact.checksWaiting} waiting); the platform never
              promotes a plan on its own.
            </p>
          </Panel>
          <Panel>
            <div className="grid gap-4 md:grid-cols-2">
              <Counts
                label="Actions by status"
                rows={actionProgressStatuses.map((s) => [
                  actionProgressLabels[s],
                  report.transfer!.actions.byStatus[s] ?? 0,
                ])}
              />
              <div className="space-y-4">
                <Counts
                  label="Actions needing attention"
                  rows={[
                    ['Needing support', report.transfer.actions.withSupport],
                    ['With barriers reported', report.transfer.actions.withBarriers],
                    ['With a start date', report.transfer.actions.withStart],
                    ['With a target date', report.transfer.actions.withTarget],
                    ['Target date passed, still open', report.transfer.actions.overdueTarget],
                    ['Review date passed, still open', report.transfer.actions.overdueReview],
                  ]}
                />
                <Counts
                  label="Reminder preferences"
                  rows={[
                    ...reminderFrequencies.map(
                      (f) =>
                        [
                          reminderFrequencyLabels[f],
                          report.transfer!.reminders.byFrequency[f] ?? 0,
                        ] as [string, number],
                    ),
                    ['Scheduled next', report.transfer.reminders.scheduled],
                    ['Reminders sent', report.transfer.reminders.sent],
                    ['Reminders failed', report.transfer.reminders.failed],
                  ]}
                />
              </div>
            </div>
          </Panel>
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">First-priority actions</p>
            {report.transfer.actions.priority.length === 0 ? (
              <p className="mt-1 text-sm text-corp-muted">
                {stateText(report.transfer.actions.priorityState)}.
              </p>
            ) : (
              <TableScroll>
                <table className="mt-2 w-full text-sm">
                  <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Delegate</th>
                      <th className="px-3 py-2">First priority</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Start</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-corp-line">
                    {report.transfer.actions.priority.map((a, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5">{a.delegate?.name ?? '—'}</td>
                        <td className="px-3 py-1.5 text-corp-text">{a.action || '—'}</td>
                        <td className="px-3 py-1.5">{actionProgressLabels[a.status]}</td>
                        <td className="px-3 py-1.5">
                          {a.startOn ? formatDateShort(a.startOn) : '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          {a.targetOn ? formatDateShort(a.targetOn) : '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          {a.reviewOn ? formatDateShort(a.reviewOn) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">Follow-up</p>
            {report.transfer.application.followUp ? (
              <>
                <dl className="mt-1 divide-y divide-corp-line">
                  <StageLine stage={report.transfer.application.followUp.stage} />
                </dl>
                <dl className="mt-2 divide-y divide-corp-line text-sm">
                  {(
                    [
                      [
                        'Responded and report progress',
                        report.transfer.application.followUp.respondedWithProgress,
                      ],
                      [
                        'Responded, no progress reported',
                        report.transfer.application.followUp.respondedNoProgress,
                      ],
                      ['Not yet responded', report.transfer.application.followUp.notResponded],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-1">
                      <dt className="text-corp-text">{label}</dt>
                      <dd className="font-semibold text-corp-ink tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1 text-xs text-corp-muted">
                  Delegates who have not answered are counted apart from those who answered and
                  report no progress.
                </p>
                <div className="mt-2 space-y-4">
                  {report.transfer.application.followUp.choices.map((d) => (
                    <Distribution key={d.key} d={d} />
                  ))}
                </div>
                <div className="mt-2 space-y-2">
                  {report.transfer.application.followUp.texts.map((t) => (
                    <Texts key={t.key} t={t} />
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-corp-muted">
                No follow-up assessment is configured for this event. Application below comes from
                the delegates’ own progress records on their plans.
              </p>
            )}
          </Panel>
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">
              Support needs, barriers and reported changes
            </p>
            <div className="mt-2 space-y-2">
              {[
                ...report.transfer.application.supportNeeds,
                ...report.transfer.application.barriers,
                ...report.transfer.application.changes,
              ].map((t) => (
                <Texts key={t.key} t={t} />
              ))}
            </div>
          </Panel>
          <Panel>
            <div className="grid gap-4 md:grid-cols-2">
              <Counts
                label="Actions by what their measures say"
                rows={measureSummaries.map((s) => [
                  measureSummaryLabels[s],
                  report.transfer!.application.measures[s] ?? 0,
                ])}
              />
              <Counts
                label="Evidence records"
                rows={evidenceSupports.map((s) => [
                  evidenceSupportLabels[s],
                  report.transfer!.application.evidence[s] ?? 0,
                ])}
              />
            </div>
          </Panel>
        </section>
      ) : null}

      {report.results ? (
        <section aria-labelledby="report-results" className="space-y-3">
          <SectionHeading id="report-results" section="results" />
          <Panel>
            <p className="text-sm font-semibold text-corp-ink">
              Progress against delegate expectations
            </p>
            {report.results.expectations.met || report.results.expectations.metPost ? (
              <div className="mt-2 space-y-4">
                {report.results.expectations.met ? (
                  <Distribution d={report.results.expectations.met} />
                ) : null}
                {report.results.expectations.metPost ? (
                  <Distribution d={report.results.expectations.metPost} />
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-sm text-corp-muted">
                {stateText(report.results.expectations.state)}.
              </p>
            )}
            <p className="mt-2 text-xs text-corp-muted">
              Nominating organisation expectations:{' '}
              {stateText(report.results.organisationExpectations.state)}.
            </p>
          </Panel>
          <Panel>
            <div className="grid gap-4 md:grid-cols-3">
              <Counts
                label="Actions by what their measures say"
                rows={measureSummaries.map((s) => [
                  measureSummaryLabels[s],
                  report.results!.measures.actions[s] ?? 0,
                ])}
              />
              <Counts
                label="Measures with a result"
                rows={(['improved', 'declined', 'unchanged', 'not_comparable'] as const).map(
                  (o) => [measureOutcomeLabels[o], report.results!.measures.outcomes[o]],
                )}
              />
              <Counts
                label="How results are supported"
                rows={evidenceSupports.map((s) => [
                  evidenceSupportLabels[s],
                  report.results!.measures.resultSupport[s] ?? 0,
                ])}
              />
            </div>
            <p className="mt-2 text-xs text-corp-muted">
              Each measure is read in its own unit and the delegate’s stated direction of
              improvement, so a lower error rate or a shorter turnaround counts as an improvement
              and an increase is never assumed to be positive. No business result is attributed to
              the event.
            </p>
          </Panel>
          {report.results.measures.rows.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">Reported measures</p>
              <TableScroll>
                <table className="mt-2 w-full text-sm">
                  <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Delegate</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Measure</th>
                      <th className="px-3 py-2">Direction</th>
                      <th className="px-3 py-2">Baseline</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Actual</th>
                      <th className="px-3 py-2">Support</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-corp-line">
                    {report.results.measures.rows.flatMap((row) =>
                      row.measures.map((m) => (
                        <tr key={m.id}>
                          <td className="px-3 py-1.5">{row.delegate?.name ?? '—'}</td>
                          <td className="px-3 py-1.5 text-corp-text">{row.action || '—'}</td>
                          <td className="px-3 py-1.5">{m.name || 'Unnamed'}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {improvementDirectionLabels[m.direction]}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {withUnit(m.baselineValue, m.unit)}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {withUnit(m.targetValue, m.unit)}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {withUnit(m.actualValue, m.unit)}
                          </td>
                          <td className="px-3 py-1.5 text-xs">
                            {evidenceSupportLabels[m.support]}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          ) : (
            <p className="text-sm text-corp-muted">
              Reported measures: {stateText(report.results.measures.rowsState)}.
            </p>
          )}
          <Panel>
            <Counts
              label="Evidence of application"
              rows={evidenceSupports.map((s) => [
                evidenceSupportLabels[s],
                report.results!.evidence.counts[s] ?? 0,
              ])}
            />
            {report.results.evidence.examples.length ? (
              <TableScroll>
                <table className="mt-2 w-full text-sm">
                  <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Delegate</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Support</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-corp-line">
                    {report.results.evidence.examples.map((x, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5">{x.delegate?.name ?? '—'}</td>
                        <td className="px-3 py-1.5 text-corp-text">{x.action || '—'}</td>
                        <td className="px-3 py-1.5 text-xs">{x.type}</td>
                        <td className="px-3 py-1.5 text-xs">{evidenceSupportLabels[x.support]}</td>
                        <td className="px-3 py-1.5">
                          {x.evidenceOn ? formatDateShort(x.evidenceOn) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-corp-text">{x.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : (
              <p className="mt-1 text-sm text-corp-muted">
                Examples of application: {stateText(report.results.evidence.examplesState)}.
              </p>
            )}
          </Panel>
          {report.results.influences.length ? (
            <Panel>
              <p className="text-sm font-semibold text-corp-ink">
                Other factors delegates said may have influenced results
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-corp-text">
                {report.results.influences.map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
