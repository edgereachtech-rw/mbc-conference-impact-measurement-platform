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
  reportKindMeta,
  reportSectionLabels,
  type ChoiceDistribution,
  type EventReport,
  type Figure,
  type StageParticipation,
  type StatementAverage,
  type TextAnswers,
} from '@mbc/shared';

/**
 * Renders a report as Markdown (the document an admin reads or shares) and as CSV (every
 * figure as one row, for spreadsheets). Both carry the event, the reporting date, the period,
 * the population, response numbers and denominators, the limitations, and the self-reported
 * labels; an external report that is not approved is headed DRAFT.
 */

const stageNames: Record<string, string> = {
  pre_conference: 'Pre-conference assessment',
  during_conference: 'During-conference assessment',
  end_of_conference: 'End-of-conference evaluation',
  follow_up: 'Follow-up assessment',
};

const cell = (v: string | number | null | undefined) =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
const table = (header: string[], rows: Array<Array<string | number | null | undefined>>) =>
  [
    `| ${header.map(cell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
const fig = (label: string, f: Figure) => `- **${label}:** ${formatFigure(f)}. _${f.definition}_`;
/** A measure value with its unit; a blank value reads as a dash, never as a bare unit. */
const withUnit = (value: string, unit: string) =>
  value.trim() ? (unit.trim() ? `${value.trim()} ${unit.trim()}` : value.trim()) : '—';
const stateText = (s: string) => dataStateLabels[s as keyof typeof dataStateLabels] || s;

function stageLine(s: StageParticipation) {
  if (s.state === 'not_configured') return `${stageNames[s.stage]}: ${stateText(s.state)}.`;
  return `${stageNames[s.stage]}: ${s.submitted} submitted of ${s.invited} invited${s.responseRate === null ? '' : ` (${s.responseRate}%)`}, ${s.started - s.submitted} started but not submitted, ${s.notSubmitted} without a submission${s.state === 'not_yet_available' ? ' (not yet open)' : ''}.`;
}

function distribution(d: ChoiceDistribution) {
  const head = `**${d.prompt}**${d.sectionTitle ? ` (${d.sectionTitle})` : ''}: ${d.responses} answered${d.multiple ? ', several options allowed' : ''}.`;
  if (d.state !== 'ok') return `${head} ${stateText(d.state)}.`;
  return `${head}\n\n${table(
    ['Option', 'Count', '% of answers'],
    d.options.map((o) => [o.label, o.count, o.percent === null ? '' : `${o.percent}%`]),
  )}`;
}

function statements(title: string, rows: StatementAverage[]) {
  if (!rows.length) return `_${title}: none configured._`;
  return `${title} (self-reported; average of the option scores, "Not applicable" excluded):\n\n${table(
    ['Statement', 'Respondents', 'Average'],
    rows.map((r) => [r.prompt, r.responses, r.average ?? stateText(r.state)]),
  )}`;
}

function texts(t: TextAnswers) {
  const head = `**${t.prompt}**${t.sectionTitle ? ` (${t.sectionTitle})` : ''}: ${t.responses} answer${t.responses === 1 ? '' : 's'}.`;
  if (t.state === 'withheld') return `${head} _${stateText('withheld')}._`;
  if (!t.answers.length) return `${head} _${stateText(t.state)}._`;
  return `${head}\n\n${t.answers.map((a) => `- ${a.delegate ? `${a.delegate.name}${a.delegate.organisation ? ` (${a.delegate.organisation})` : ''}: ` : ''}${cell(a.value)}`).join('\n')}`;
}

export function renderMarkdown(report: EventReport): string {
  const meta = reportKindMeta[report.kind];
  const approved = report.approval?.covers ?? true;
  const lines: string[] = [];
  lines.push(`# ${report.event.name}: ${meta.label}`);
  if (report.audience === 'external' && !approved) {
    lines.push(
      '',
      '> **DRAFT: not approved for sharing.** M.Bryan reviews and approves every external report before it leaves the platform.',
    );
  }
  lines.push(
    '',
    `- **Event:** ${report.event.name} (${report.event.code}), ${report.event.startsOn} to ${report.event.endsOn}, ${report.event.timezone}`,
    `- **Reporting date:** ${report.generatedAt}`,
    `- **Reporting period:** ${report.filters.from || report.filters.to ? `${report.filters.from ?? 'event start'} to ${report.filters.to ?? 'reporting date'}` : 'everything recorded to the reporting date'}`,
    `- **Population:** ${report.population.registered} delegates. ${report.population.description}.`,
    ...(report.filters.attendanceFormat
      ? [`- **Attendance format:** ${report.filters.attendanceFormat}`]
      : []),
    ...(report.filters.organisation
      ? [`- **Nominating organisation:** ${report.filters.organisation}`]
      : []),
    `- **Sections:** ${report.sections.map((s) => reportSectionLabels[s]).join('; ')}`,
    ...(report.approval?.current
      ? [
          `- **Approved for sharing:** ${report.approval.current.approvedAt}${report.approval.current.approvedBy ? ` by ${report.approval.current.approvedBy}` : ''}${report.approval.covers ? '' : ' (does not cover every section shown)'}`,
        ]
      : []),
    '',
    '## How to read this report',
    '',
    ...report.limitations.map((l) => `- ${l}`),
  );

  const p = report.participation;
  if (p) {
    lines.push('', `## ${reportSectionLabels.participation}`, '');
    lines.push(
      fig('Registered', p.registered),
      fig('Platform accounts', p.accounts),
      fig('Signed in at least once', p.signedIn),
      fig('Attended at least one date', p.attended),
      fig('Submitted at least one assessment', p.assessed),
    );
    lines.push(
      '',
      table(
        ['Format', 'Registered', 'Accounts', 'Attended', 'Attended %'],
        p.byFormat.map((f) => [
          f.format,
          f.registered,
          f.accounts,
          f.attended,
          f.attendedRate === null ? '' : `${f.attendedRate}%`,
        ]),
      ),
    );
    if (p.byDate.length) {
      lines.push(
        '',
        table(
          [
            'Date',
            'Registered',
            'Attended',
            'Partial',
            'Absent',
            'Not checked in',
            'In person',
            'Online',
            'Rate',
            'State',
          ],
          p.byDate.map((d) => [
            d.date + (d.closed ? ' (closed)' : ''),
            d.registered,
            d.attended,
            d.partial,
            d.absent,
            d.notCheckedIn,
            d.physical,
            d.virtual,
            d.rate === null ? '' : `${d.rate}%`,
            d.state === 'ok' ? '' : stateText(d.state),
          ]),
        ),
      );
    }
    lines.push('', '### Assessment stages', '', ...p.stages.map((s) => `- ${stageLine(s)}`));
    if (p.feedback.sessionsEnabled) {
      lines.push(
        '',
        '### Session feedback',
        '',
        table(
          ['Date', 'Session', 'Attended', 'Responses', 'Rate'],
          p.feedback.sessions.map((s) => [
            s.date,
            s.title,
            s.attended,
            s.submitted,
            s.rate === null ? stateText(s.state) : `${s.rate}%`,
          ]),
        ),
      );
    }
    lines.push(
      '',
      '### Definitions',
      '',
      ...p.definitions.map((d) => `- **${d.term}:** ${d.definition}`),
    );
  }

  const e = report.expectations;
  if (e) {
    lines.push('', `## ${reportSectionLabels.expectations}`, '');
    if (e.stage) lines.push(`- ${stageLine(e.stage)}`);
    for (const t of e.texts) lines.push('', texts(t));
    for (const d of e.choices) lines.push('', distribution(d));
    lines.push(
      '',
      e.knowledge
        ? `**Baseline knowledge:** ${e.knowledge.state === 'ok' ? `average ${e.knowledge.averageScore} of ${e.knowledge.questions} (${e.knowledge.averagePercent}%) from ${e.knowledge.respondents} delegates who answered every knowledge question` : stateText(e.knowledge.state)}.`
        : '_No knowledge questions in the pre-conference assessment._',
    );
    lines.push('', statements('Baseline confidence and practice statements', e.statements));
    lines.push(
      '',
      `**Nominating organisation expectations:** ${stateText(e.organisationExpectations.state)}.`,
    );
  }

  const x = report.experience;
  if (x) {
    lines.push('', `## ${reportSectionLabels.experience}`, '');
    if (x.stage) lines.push(`- ${stageLine(x.stage)}`);
    lines.push('', statements('Conference experience (all delegates)', x.ratings.all));
    lines.push('', statements('Physical experience', x.ratings.physical));
    lines.push('', statements('Virtual experience', x.ratings.virtual));
    for (const t of x.written) lines.push('', texts(t));
    if (x.reflections.length) {
      lines.push('', '### Daily Learning Reflections');
      for (const r of x.reflections) {
        lines.push(
          '',
          `**${r.date}: ${r.title}** (${r.status}): ${r.submitted} of ${r.registered} submitted${r.rate === null ? '' : ` (${r.rate}%)`}${r.state === 'ok' ? '' : `; ${stateText(r.state)}`}.`,
        );
        for (const q of r.questions) lines.push('', texts(q));
      }
    }
    if (x.feedback.length) {
      lines.push('', '### Session feedback');
      for (const f of x.feedback) {
        lines.push(
          '',
          `**${f.date}: ${f.title}**: ${f.submitted} responses from ${f.attended} recorded as attending.`,
        );
        for (const r of f.ratings)
          lines.push(
            '',
            `${r.prompt}: ${r.total} rated. ${r.ratings.map((v) => `${v.rating} ${v.count} (${v.percent}%)`).join(', ')}.`,
          );
        for (const w of f.written) lines.push('', texts(w));
      }
    }
    lines.push('', '### Knowledge', '');
    const k = (label: string, v: typeof x.knowledge.before) =>
      `- **${label}:** ${!v ? 'no knowledge questions' : v.state === 'ok' ? `average ${v.averagePercent}% over ${v.questions} questions from ${v.respondents} delegates` : stateText(v.state)}.`;
    lines.push(k('Before', x.knowledge.before), k('After', x.knowledge.after));
    if (x.paired) {
      for (const s of x.paired.sections) {
        if (s.knowledge)
          lines.push(
            `- **Paired knowledge (${s.title}):** ${s.knowledge.paired} delegates answered every question both times: ${s.knowledge.averageBeforePercent ?? '–'}% before, ${s.knowledge.averageAfterPercent ?? '–'}% after, change ${s.knowledge.changePoints ?? '–'} percentage points.`,
          );
        if (s.statements.length)
          lines.push(
            '',
            `Paired self-reported confidence (${s.title}):`,
            '',
            table(
              ['Statement', 'Paired', 'Before', 'After', 'Change'],
              s.statements.map((st) => [
                st.prompt,
                st.paired,
                st.averageBefore ?? '',
                st.averageAfter ?? '',
                st.change ?? '',
              ]),
            ),
          );
      }
    }
    lines.push(
      '',
      statements('Self-reported confidence before', x.confidence.before),
      '',
      statements('Self-reported confidence after', x.confidence.after),
    );
  }

  const xe = report.expectationsEnd;
  if (xe) {
    lines.push('', `## ${reportSectionLabels.expectations_end}`, '');
    if (xe.stage) lines.push(`- ${stageLine(xe.stage)}`);
    lines.push(fig('Completed the expectations evaluation', xe.completed));
    if (xe.met)
      lines.push('', 'Pre-event expectations, as assessed at the end:', '', distribution(xe.met));
    lines.push(
      '',
      fig('Expectation recorded only after the event', xe.recordedAfter),
      `- **Preferred not to answer:** ${xe.preferNotToAnswer}`,
    );
    if (xe.metPost)
      lines.push(
        '',
        'Expectations recorded after the event (reported separately):',
        '',
        distribution(xe.metPost),
      );
    for (const t of xe.explanations) lines.push('', texts(t));
  }

  const t = report.transfer;
  if (t) {
    lines.push('', `## ${reportSectionLabels.transfer}`, '');
    lines.push(
      fig('Plans started', t.plans.started),
      fig('Plans submitted', t.plans.submitted),
      fig('Plans incomplete', t.plans.incomplete),
      `- **Opened but empty:** ${t.plans.empty}`,
      fig('Completion rate', t.plans.completionRate),
    );
    lines.push(
      '',
      '### Planned actions',
      '',
      `- **Actions:** ${t.actions.total}; with a start date ${t.actions.withStart}, with a target date ${t.actions.withTarget}, needing support ${t.actions.withSupport}, with barriers ${t.actions.withBarriers}, target date passed ${t.actions.overdueTarget}, review date passed ${t.actions.overdueReview}.`,
    );
    lines.push(
      '',
      table(
        ['Status', 'Actions'],
        actionProgressStatuses.map((s) => [actionProgressLabels[s], t.actions.byStatus[s] ?? 0]),
      ),
    );
    if (t.actions.priority.length)
      lines.push(
        '',
        table(
          ['Delegate', 'First priority', 'Status', 'Start', 'Target', 'Review'],
          t.actions.priority.map((a) => [
            a.delegate?.name ?? '',
            a.action,
            actionProgressLabels[a.status],
            a.startOn,
            a.targetOn,
            a.reviewOn,
          ]),
        ),
      );
    else lines.push('', `_First-priority actions: ${stateText(t.actions.priorityState)}._`);
    lines.push(
      '',
      '### Reminders',
      '',
      table(
        ['Preference', 'Delegates'],
        reminderFrequencies.map((f) => [
          reminderFrequencyLabels[f],
          t.reminders.byFrequency[f] ?? 0,
        ]),
      ),
      '',
      `- **Scheduled:** ${t.reminders.scheduled}; **sent:** ${t.reminders.sent}; **failed:** ${t.reminders.failed}.`,
    );
    lines.push(
      '',
      '### Application and follow-up',
      '',
      fig('Applied actions', t.application.appliedActions),
      fig('Delegates reporting application', t.application.appliedDelegates),
    );
    if (t.application.followUp) {
      const f = t.application.followUp;
      lines.push(
        `- ${stageLine(f.stage)}`,
        `- **Responded and report progress:** ${f.respondedWithProgress}; **responded, no progress reported:** ${f.respondedNoProgress}; **not yet responded:** ${f.notResponded}.`,
      );
      for (const d of f.choices) lines.push('', distribution(d));
      for (const tx of f.texts) lines.push('', texts(tx));
    } else lines.push('- **Follow-up assessment:** not configured.');
    for (const tx of t.application.supportNeeds) lines.push('', texts(tx));
    for (const tx of t.application.barriers) lines.push('', texts(tx));
    for (const tx of t.application.changes) lines.push('', texts(tx));
    lines.push(
      '',
      table(
        ['Actions by measure', 'Count'],
        measureSummaries.map((s) => [measureSummaryLabels[s], t.application.measures[s] ?? 0]),
      ),
      '',
      table(
        ['Evidence', 'Records'],
        evidenceSupports.map((s) => [evidenceSupportLabels[s], t.application.evidence[s] ?? 0]),
      ),
    );
  }

  const r = report.results;
  if (r) {
    lines.push('', `## ${reportSectionLabels.results}`, '');
    lines.push(
      `- **Progress against delegate expectations (follow-up):** ${r.expectations.state === 'ok' ? 'see below' : stateText(r.expectations.state)}.`,
    );
    if (r.expectations.met) lines.push('', distribution(r.expectations.met));
    if (r.expectations.metPost) lines.push('', distribution(r.expectations.metPost));
    lines.push(
      `- **Nominating organisation expectations:** ${stateText(r.organisationExpectations.state)}.`,
    );
    lines.push(
      '',
      table(
        ['Actions by measure', 'Count'],
        measureSummaries.map((s) => [measureSummaryLabels[s], r.measures.actions[s] ?? 0]),
      ),
    );
    lines.push(
      '',
      `Results read in each measure's own unit and direction of improvement (an increase is not assumed to be positive): ${(['improved', 'declined', 'unchanged', 'not_comparable'] as const).map((o) => `${measureOutcomeLabels[o].toLowerCase()} ${r.measures.outcomes[o]}`).join(', ')}. Results ${evidenceSupports.map((s) => `${evidenceSupportLabels[s].toLowerCase()} ${r.measures.resultSupport[s] ?? 0}`).join(', ')}.`,
    );
    if (r.measures.rows.length) {
      lines.push(
        '',
        table(
          [
            'Delegate',
            'Action',
            'Measure',
            'Direction',
            'Baseline',
            'Target',
            'Actual',
            'Support',
            'Source',
          ],
          r.measures.rows.flatMap((row) =>
            row.measures.map((m) => [
              row.delegate?.name ?? '',
              row.action,
              m.status === 'identified' ? m.name : `${m.name} (${m.status.replace('_', ' ')})`,
              improvementDirectionLabels[m.direction],
              withUnit(m.baselineValue, m.unit),
              withUnit(m.targetValue, m.unit),
              withUnit(m.actualValue, m.unit),
              evidenceSupportLabels[m.support],
              m.source,
            ]),
          ),
        ),
      );
    } else lines.push('', `_Measure rows: ${stateText(r.measures.rowsState)}._`);
    lines.push(
      '',
      table(
        ['Evidence', 'Records'],
        evidenceSupports.map((s) => [evidenceSupportLabels[s], r.evidence.counts[s] ?? 0]),
      ),
    );
    if (r.evidence.examples.length)
      lines.push(
        '',
        table(
          ['Delegate', 'Action', 'Type', 'Support', 'Date', 'Description'],
          r.evidence.examples.map((x) => [
            x.delegate?.name ?? '',
            x.action,
            x.type,
            evidenceSupportLabels[x.support],
            x.evidenceOn,
            x.description,
          ]),
        ),
      );
    else lines.push('', `_Examples of application: ${stateText(r.evidence.examplesState)}._`);
    if (r.influences.length)
      lines.push(
        '',
        'Other factors delegates said may have influenced results:',
        '',
        ...r.influences.map((i) => `- ${cell(i)}`),
      );
  }

  lines.push(
    '',
    '---',
    '',
    `${meta.label}, generated from the platform's records on ${report.generatedAt}. Self-reported unless an item is marked as supported by another source; nothing here is independently verified; no business result is attributed to the event.`,
  );
  return `${lines.join('\n')}\n`;
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every figure as one row: section, metric, count, denominator, percent, state, definition. */
export function renderCsv(report: EventReport): string {
  const rows: Array<Array<string | number | null>> = [];
  const add = (
    section: string,
    metric: string,
    f: Figure | null,
    extra?: {
      count?: number;
      of?: number | null;
      percent?: number | null;
      state?: string;
      definition?: string;
    },
  ) => {
    rows.push([
      section,
      metric,
      f ? f.count : (extra?.count ?? null),
      f ? f.of : (extra?.of ?? null),
      f ? f.percent : (extra?.percent ?? null),
      f ? (f.state === 'ok' ? '' : stateText(f.state)) : (extra?.state ?? ''),
      f ? f.definition : (extra?.definition ?? ''),
    ]);
  };
  const p = report.participation;
  if (p) {
    const s = reportSectionLabels.participation;
    add(s, 'Registered', p.registered);
    add(s, 'Platform accounts', p.accounts);
    add(s, 'Signed in at least once', p.signedIn);
    add(s, 'Attended at least one date', p.attended);
    add(s, 'Submitted at least one assessment', p.assessed);
    for (const f of p.byFormat)
      add(s, `Attended, ${f.format}`, null, {
        count: f.attended,
        of: f.registered,
        percent: f.attendedRate,
      });
    for (const d of p.byDate)
      add(s, `Attended on ${d.date}`, null, {
        count: d.attended + d.partial,
        of: d.registered,
        percent: d.rate,
        state: d.state === 'ok' ? '' : stateText(d.state),
      });
    for (const st of p.stages)
      add(s, `${stageNames[st.stage]} submitted`, null, {
        count: st.submitted,
        of: st.invited,
        percent: st.responseRate,
        state: st.state === 'ok' ? '' : stateText(st.state),
      });
    for (const f of p.feedback.sessions)
      add(s, `Session feedback: ${f.date} ${f.title}`, null, {
        count: f.submitted,
        of: f.attended,
        percent: f.rate,
        state: f.state === 'ok' ? '' : stateText(f.state),
      });
  }
  const e = report.expectations;
  if (e) {
    const s = reportSectionLabels.expectations;
    for (const t of e.texts)
      add(s, `Answers: ${t.prompt}`, null, {
        count: t.responses,
        state: t.state === 'ok' ? '' : stateText(t.state),
      });
    for (const d of e.choices)
      for (const o of d.options)
        add(s, `${d.prompt}: ${o.label}`, null, {
          count: o.count,
          of: d.responses,
          percent: o.percent,
        });
    if (e.knowledge)
      add(s, 'Baseline knowledge average %', null, {
        count: e.knowledge.respondents,
        percent: e.knowledge.averagePercent,
        state: e.knowledge.state === 'ok' ? '' : stateText(e.knowledge.state),
        definition:
          'count = respondents who answered every knowledge question; percent = average score',
      });
    for (const st of e.statements)
      add(s, `Baseline (self-reported): ${st.prompt}`, null, {
        count: st.responses,
        percent: st.average,
        definition: 'percent column holds the average score',
      });
  }
  const x = report.experience;
  if (x) {
    const s = reportSectionLabels.experience;
    for (const [group, list] of Object.entries(x.ratings))
      for (const st of list)
        add(s, `Experience (${group}, self-reported): ${st.prompt}`, null, {
          count: st.responses,
          percent: st.average,
          definition: 'percent column holds the average score',
        });
    for (const r of x.reflections)
      add(s, `Reflection ${r.date}: ${r.title}`, null, {
        count: r.submitted,
        of: r.registered,
        percent: r.rate,
        state: r.state === 'ok' ? '' : stateText(r.state),
      });
    for (const f of x.feedback)
      for (const r of f.ratings)
        for (const v of r.ratings)
          add(s, `Feedback ${f.date} ${f.title}: ${r.prompt}: ${v.rating}`, null, {
            count: v.count,
            of: r.total,
            percent: v.percent,
          });
    if (x.knowledge.before)
      add(s, 'Knowledge before, average %', null, {
        count: x.knowledge.before.respondents,
        percent: x.knowledge.before.averagePercent,
      });
    if (x.knowledge.after)
      add(s, 'Knowledge after, average %', null, {
        count: x.knowledge.after.respondents,
        percent: x.knowledge.after.averagePercent,
      });
    for (const sec of x.paired?.sections ?? []) {
      if (sec.knowledge)
        add(s, `Paired knowledge change (${sec.title}), percentage points`, null, {
          count: sec.knowledge.paired,
          percent: sec.knowledge.changePoints,
          definition: 'count = paired delegates',
        });
      for (const st of sec.statements)
        add(s, `Paired confidence change (self-reported): ${st.prompt}`, null, {
          count: st.paired,
          percent: st.change,
          definition: 'count = paired delegates; percent column holds the change in score',
        });
    }
  }
  const xe = report.expectationsEnd;
  if (xe) {
    const s = reportSectionLabels.expectations_end;
    add(s, 'Completed the expectations evaluation', xe.completed);
    for (const o of xe.met?.options ?? [])
      add(s, `Pre-event expectation: ${o.label}`, null, {
        count: o.count,
        of: xe.met!.responses,
        percent: o.percent,
      });
    add(s, 'Expectation recorded only after the event', xe.recordedAfter);
    for (const o of xe.metPost?.options ?? [])
      add(s, `Post-event expectation: ${o.label}`, null, {
        count: o.count,
        of: xe.metPost!.responses,
        percent: o.percent,
      });
  }
  const t = report.transfer;
  if (t) {
    const s = reportSectionLabels.transfer;
    add(s, 'Plans started', t.plans.started);
    add(s, 'Plans submitted', t.plans.submitted);
    add(s, 'Plans incomplete', t.plans.incomplete);
    add(s, 'Completion rate', t.plans.completionRate);
    for (const st of actionProgressStatuses)
      add(s, `Actions ${actionProgressLabels[st].toLowerCase()}`, null, {
        count: t.actions.byStatus[st] ?? 0,
        of: t.actions.total,
      });
    add(s, 'Applied actions (self-reported)', t.application.appliedActions);
    add(s, 'Delegates reporting application (self-reported)', t.application.appliedDelegates);
    if (t.application.followUp) {
      add(s, 'Follow-up: responded with progress', null, {
        count: t.application.followUp.respondedWithProgress,
        of: t.application.followUp.stage.invited,
      });
      add(s, 'Follow-up: responded, no progress reported', null, {
        count: t.application.followUp.respondedNoProgress,
        of: t.application.followUp.stage.invited,
      });
      add(s, 'Follow-up: not yet responded', null, {
        count: t.application.followUp.notResponded,
        of: t.application.followUp.stage.invited,
      });
    }
    for (const m of measureSummaries)
      add(s, `Actions: ${measureSummaryLabels[m].toLowerCase()}`, null, {
        count: t.application.measures[m] ?? 0,
        of: t.actions.total,
      });
    for (const v of evidenceSupports)
      add(s, `Evidence ${evidenceSupportLabels[v].toLowerCase()}`, null, {
        count: t.application.evidence[v] ?? 0,
      });
  }
  const r = report.results;
  if (r) {
    const s = reportSectionLabels.results;
    for (const o of ['improved', 'declined', 'unchanged', 'not_comparable'] as const)
      add(s, `Measures ${measureOutcomeLabels[o].toLowerCase()}`, null, {
        count: r.measures.outcomes[o],
      });
    for (const v of evidenceSupports)
      add(s, `Results ${evidenceSupportLabels[v].toLowerCase()}`, null, {
        count: r.measures.resultSupport[v] ?? 0,
      });
    for (const v of evidenceSupports)
      add(s, `Evidence ${evidenceSupportLabels[v].toLowerCase()}`, null, {
        count: r.evidence.counts[v] ?? 0,
      });
  }
  const header = ['Section', 'Metric', 'Count', 'Of', 'Percent', 'State', 'Definition'];
  const meta = [
    ['Event', report.event.name],
    ['Report', reportKindMeta[report.kind].label],
    ['Reporting date', report.generatedAt],
    ['Period', `${report.filters.from ?? ''} to ${report.filters.to ?? ''}`],
    ['Population', `${report.population.registered}: ${report.population.description}`],
    [
      'Approved for sharing',
      report.approval
        ? report.approval.covers
          ? (report.approval.current?.approvedAt ?? '')
          : 'NO: DRAFT'
        : 'not required (internal)',
    ],
    ...report.limitations.map((l) => ['Limitation', l]),
  ];
  return (
    [
      ...meta.map((m) => m.map(csvCell).join(',')),
      '',
      header.map(csvCell).join(','),
      ...rows.map((r) => r.map(csvCell).join(',')),
    ].join('\n') + '\n'
  );
}
