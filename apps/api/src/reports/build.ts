import {
  actionProgressLabels,
  actionProgressStatuses,
  appliedStatuses,
  assessmentStages,
  BUILTIN,
  compareMeasure,
  evidenceSupports,
  evidenceTypeLabels,
  figure,
  measureSummaries,
  percentOf,
  planHasContent,
  PREFER_NOT_TO_ANSWER,
  reminderFrequencies,
  reportSectionLabels,
  stageWindowState,
  summariseMeasures,
  type ActionProgressStatus,
  type AssessmentQuestionView,
  type AssessmentStage,
  type ChoiceDistribution,
  type DataState,
  type EventReport,
  type EvidenceSupport,
  type ExpectationsEndSection,
  type ExpectationsSection,
  type ExperienceSection,
  type MeasureSummary,
  type ParticipationSection,
  type ReminderFrequency,
  type ReportFilters,
  type ReportSection,
  type ResultsSection,
  type StageParticipation,
  type StatementAverage,
  type TextAnswers,
  type TransferSection,
} from '@mbc/shared';

import type { PrismaClient } from '../db.js';
import {
  activeQuestionsOf,
  answerTo,
  pairedResultsFor,
  round1,
  stageSummaryFor,
  versionIdsFor,
  type EligibleStatuses,
} from '../routes/assessments.js';
import { measureViewOf, type ActionRow } from '../routes/transfer-plans.js';

/**
 * Builds the event report (task of 2026-10-31; backlog E15, E16) from the existing records.
 * Nothing is stored: every call reads registrations, accounts, attendance, assessments,
 * reflections, session feedback, Transfer Plans with their progress, measures and evidence,
 * and reminder logs, and counts them against the delegates the filters leave in. Every figure
 * says what it counts and against what; a figure nobody could answer yet is a state, not a
 * zero. Redaction for external audiences happens afterwards in audience.ts, so this builder
 * always produces the full, internal document.
 */

export interface BuildInput {
  db: PrismaClient;
  eligible: EligibleStatuses;
  now: Date;
  eventId: string;
  filters: ReportFilters;
  sections: readonly ReportSection[];
}

export type BuiltReport = Omit<EventReport, 'kind' | 'audience' | 'approval'>;

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

type DelegateRef = {
  id: string;
  name: string;
  organisation: string | null;
  attendanceFormat: 'physical' | 'virtual';
};

interface Population {
  delegates: Array<
    DelegateRef & {
      userAccountId: string | null;
      signedUpAt: Date | null;
      nominatingOrganisation: string | null;
    }
  >;
  ids: string[];
  byId: Map<string, DelegateRef>;
  description: string;
}

interface StageRow {
  id: string;
  eventId: string;
  stage: AssessmentStage;
  enabled: boolean;
  status: 'draft' | 'scheduled' | 'open' | 'closed';
  opensAt: Date | null;
  closesAt: Date | null;
}

/** One stage's active questions, their sections, and every submitted answer in scope. */
interface StageAnswers {
  stage: StageRow;
  questions: AssessmentQuestionView[];
  sections: Map<string, { title: string; audience: 'all' | 'physical' | 'virtual' }>;
  versions: Map<string, string[]>;
  responses: Array<{
    delegateId: string;
    submittedAt: Date;
    answers: Map<string, { questionId: string; value: unknown; score: number | null }>;
  }>;
}

export async function buildReport(input: BuildInput): Promise<BuiltReport> {
  const { db, eligible, now, eventId, filters } = input;
  const sections = new Set(input.sections);
  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      format: true,
      startsOn: true,
      endsOn: true,
      timezone: true,
      dates: {
        orderBy: { date: 'asc' },
        select: { id: true, date: true, attendanceClosedAt: true },
      },
      assessmentStages: {
        select: {
          id: true,
          eventId: true,
          stage: true,
          enabled: true,
          status: true,
          opensAt: true,
          closesAt: true,
          _count: { select: { questions: { where: { retiredAt: null } } } },
        },
      },
    },
  });

  // ---------------------------------------------------------------- population
  const delegates = await db.delegate.findMany({
    where: {
      eventId,
      registrationStatus: { in: [...eligible] },
      ...(filters.attendanceFormat ? { attendanceFormat: filters.attendanceFormat } : {}),
      ...(filters.organisation
        ? { nominatingOrganisation: { equals: filters.organisation, mode: 'insensitive' } }
        : {}),
    },
    select: {
      id: true,
      name: true,
      organisation: true,
      nominatingOrganisation: true,
      attendanceFormat: true,
      userAccountId: true,
      signedUpAt: true,
    },
    orderBy: { name: 'asc' },
  });
  const population: Population = {
    delegates,
    ids: delegates.map((d) => d.id),
    byId: new Map(
      delegates.map((d) => [
        d.id,
        {
          id: d.id,
          name: d.name,
          organisation: d.organisation,
          attendanceFormat: d.attendanceFormat,
        },
      ]),
    ),
    description: [
      'Registered delegates whose registration is active' +
        (eligible.includes('test') ? ' (test registrations included)' : ''),
      filters.attendanceFormat
        ? `attending ${filters.attendanceFormat === 'physical' ? 'in person' : 'online'}`
        : null,
      filters.organisation ? `nominated by ${filters.organisation}` : null,
    ]
      .filter(Boolean)
      .join(', '),
  };
  const scope = { delegateIds: population.ids };
  const inScope = population.ids.length
    ? { delegateId: { in: population.ids } }
    : { delegateId: { in: [] as string[] } };

  // Attendance is needed by participation and by the Transfer Plan completion rate.
  const attendanceRecords = await db.attendanceRecord.findMany({
    where: { eventId, ...inScope },
    select: { delegateId: true, eventDateId: true, status: true, mode: true },
  });
  const attendees = new Set(
    attendanceRecords.filter((r) => r.status !== 'absent').map((r) => r.delegateId),
  );

  const stageRows = new Map<AssessmentStage, StageRow & { questions: number }>();
  for (const s of event.assessmentStages) {
    stageRows.set(s.stage, { ...s, questions: s._count.questions });
  }
  const configured = (stage: AssessmentStage) => {
    const s = stageRows.get(stage);
    return s && s.enabled && s.questions > 0 ? s : null;
  };

  const stageParticipation = async (stage: AssessmentStage): Promise<StageParticipation> => {
    const row = stageRows.get(stage);
    const s = configured(stage);
    if (!s) {
      return {
        stage,
        enabled: row?.enabled ?? false,
        status: row?.status ?? 'draft',
        questions: row?.questions ?? 0,
        invited: 0,
        started: 0,
        submitted: 0,
        responseRate: null,
        notSubmitted: 0,
        state: 'not_configured',
      };
    }
    const summary = await stageSummaryFor(db, s, eligible, scope);
    const window = stageWindowState(s, now);
    return {
      stage,
      enabled: true,
      status: s.status,
      questions: s.questions,
      invited: summary.invited,
      started: summary.started,
      submitted: summary.submitted,
      responseRate: summary.responseRate,
      notSubmitted: Math.max(0, summary.invited - summary.submitted),
      state:
        window === 'upcoming' || window === 'hidden'
          ? 'not_yet_available'
          : summary.submitted === 0
            ? 'no_response'
            : 'ok',
    };
  };

  const answersCache = new Map<AssessmentStage, StageAnswers | null>();
  async function stageAnswers(stage: AssessmentStage): Promise<StageAnswers | null> {
    if (answersCache.has(stage)) return answersCache.get(stage)!;
    const s = configured(stage);
    if (!s) {
      answersCache.set(stage, null);
      return null;
    }
    const [questions, sectionRows, responses] = await Promise.all([
      activeQuestionsOf(db, s.id),
      db.assessmentSection.findMany({
        where: { stageConfigId: s.id },
        select: { id: true, title: true, audience: true },
      }),
      db.assessmentResponse.findMany({
        where: { stageConfigId: s.id, submittedAt: { not: null }, ...inScope },
        select: {
          delegateId: true,
          submittedAt: true,
          answers: { select: { questionId: true, value: true, score: true } },
        },
      }),
    ]);
    const versions = await versionIdsFor(db, s.id, questions);
    const out: StageAnswers = {
      stage: s,
      questions,
      sections: new Map(sectionRows.map((r) => [r.id, { title: r.title, audience: r.audience }])),
      versions,
      responses: responses.map((r) => ({
        delegateId: r.delegateId,
        submittedAt: r.submittedAt!,
        answers: new Map(r.answers.map((a) => [a.questionId, a])),
      })),
    };
    answersCache.set(stage, out);
    return out;
  }

  const sectionTitleOf = (sa: StageAnswers, q: AssessmentQuestionView) =>
    q.sectionId ? (sa.sections.get(q.sectionId)?.title ?? null) : null;
  const audienceOf = (sa: StageAnswers, q: AssessmentQuestionView) =>
    q.sectionId ? (sa.sections.get(q.sectionId)?.audience ?? 'all') : 'all';

  const textOf = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

  function textsOf(sa: StageAnswers, q: AssessmentQuestionView): TextAnswers {
    const answers = sa.responses
      .map((r) => ({
        delegate: population.byId.get(r.delegateId) ?? null,
        value: textOf(answerTo(r.answers, sa.versions.get(q.id), q.id)?.value),
      }))
      .filter((a) => a.value !== '');
    return {
      key: q.questionKey,
      prompt: q.prompt,
      sectionTitle: sectionTitleOf(sa, q),
      responses: answers.length,
      state: answers.length ? 'ok' : 'no_response',
      answers,
    };
  }

  function distributionOf(sa: StageAnswers, q: AssessmentQuestionView): ChoiceDistribution {
    const multiple = q.type === 'multiple_choice';
    const chosen: string[][] = [];
    for (const r of sa.responses) {
      const value = answerTo(r.answers, sa.versions.get(q.id), q.id)?.value;
      if (multiple && Array.isArray(value)) {
        const values = value.filter((v): v is string => typeof v === 'string');
        if (values.length) chosen.push(values);
      } else if (typeof value === 'string' && value !== '') chosen.push([value]);
    }
    return {
      key: q.questionKey,
      prompt: q.prompt,
      sectionTitle: sectionTitleOf(sa, q),
      builtin: q.builtin,
      multiple,
      responses: chosen.length,
      state: chosen.length ? 'ok' : 'no_response',
      options: (q.options ?? []).map((o) => {
        const count = chosen.filter((v) => v.includes(o.value)).length;
        return { value: o.value, label: o.label, count, percent: percentOf(count, chosen.length) };
      }),
    };
  }

  function statementOf(sa: StageAnswers, q: AssessmentQuestionView): StatementAverage {
    const scores = sa.responses
      .map((r) => answerTo(r.answers, sa.versions.get(q.id), q.id)?.score)
      .filter((s): s is number => typeof s === 'number');
    return {
      key: q.questionKey,
      prompt: q.prompt,
      sectionTitle: sectionTitleOf(sa, q),
      responses: scores.length,
      average: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      state: scores.length ? 'ok' : 'no_response',
    };
  }

  const isText = (q: AssessmentQuestionView) => q.type === 'long_text' || q.type === 'short_text';
  const isChoice = (q: AssessmentQuestionView) =>
    (q.type === 'single_choice' || q.type === 'multiple_choice') && !q.isKnowledge;
  const isScored = (q: AssessmentQuestionView) =>
    q.type === 'single_choice' &&
    !q.isKnowledge &&
    (q.options ?? []).some((o) => o.score !== null && o.score !== undefined);
  const knowledgeOf = async (stage: AssessmentStage) => {
    const s = configured(stage);
    if (!s) return null;
    const summary = await stageSummaryFor(db, s, eligible, scope);
    if (!summary.knowledge) return null;
    return {
      ...summary.knowledge,
      state: (summary.knowledge.respondents ? 'ok' : 'no_response') as DataState,
    };
  };

  const limitations: string[] = [];
  const today = isoDate(now)!;

  // ---------------------------------------------------------------- 2.1 participation
  let participation: ParticipationSection | null = null;
  if (sections.has('participation')) {
    const registered = population.ids.length;
    const accounts = population.delegates.filter((d) => d.userAccountId).length;
    const signedIn = population.delegates.filter((d) => d.signedUpAt).length;
    const assessedRows = await db.assessmentResponse.findMany({
      where: { stage: { eventId }, submittedAt: { not: null }, ...inScope },
      select: { delegateId: true },
      distinct: ['delegateId'],
    });
    const byFormat = (['physical', 'virtual'] as const).map((format) => {
      const group = population.delegates.filter((d) => d.attendanceFormat === format);
      const att = group.filter((d) => attendees.has(d.id)).length;
      return {
        format,
        registered: group.length,
        accounts: group.filter((d) => d.userAccountId).length,
        attended: att,
        attendedRate: percentOf(att, group.length),
      };
    });
    const byDate = event.dates.map((d) => {
      const records = attendanceRecords.filter((r) => r.eventDateId === d.id);
      const attended = records.filter((r) => r.status === 'attended').length;
      const partial = records.filter((r) => r.status === 'partial').length;
      const absent = records.filter((r) => r.status === 'absent').length;
      const present = records.filter((r) => r.status !== 'absent');
      const closed = Boolean(d.attendanceClosedAt);
      return {
        id: d.id,
        date: isoDate(d.date)!,
        closed,
        registered,
        attended,
        partial,
        absent,
        notCheckedIn: Math.max(0, registered - records.length),
        physical: present.filter((r) => r.mode === 'physical').length,
        virtual: present.filter((r) => r.mode === 'virtual').length,
        rate: percentOf(attended + partial, registered),
        state: (registered === 0
          ? 'not_applicable'
          : records.length === 0 && !closed
            ? 'not_yet_available'
            : 'ok') as DataState,
      };
    });
    const stages: StageParticipation[] = [];
    for (const stage of assessmentStages) stages.push(await stageParticipation(stage));
    const feedbackSessions = await db.eventSession.findMany({
      where: { eventId, feedbackEnabled: true },
      select: {
        id: true,
        title: true,
        sessionType: true,
        startTime: true,
        eventDate: { select: { date: true } },
        _count: {
          select: {
            attendance: { where: inScope },
            feedbackResponses: { where: inScope },
          },
        },
      },
      orderBy: [{ eventDate: { date: 'asc' } }, { startTime: 'asc' }],
    });
    participation = {
      registered: figure(
        registered,
        registered,
        'Registered delegates in scope (the group every figure below is counted against).',
      ),
      accounts: figure(
        accounts,
        registered,
        'Registered delegates whose registration is linked to a platform account, of registered.',
      ),
      signedIn: figure(
        signedIn,
        registered,
        'Registered delegates who have signed in to the platform at least once, of registered.',
      ),
      attended: figure(
        [...attendees].filter((id) => population.byId.has(id)).length,
        registered,
        'Registered delegates recorded present (fully or partially) on at least one event date, of registered.',
        event.dates.some((d) => d.attendanceClosedAt) || attendanceRecords.length
          ? 'ok'
          : 'not_yet_available',
      ),
      assessed: figure(
        assessedRows.length,
        registered,
        'Registered delegates with at least one submitted assessment response, of registered.',
      ),
      byFormat,
      byDate,
      stages,
      feedback: {
        sessionsEnabled: feedbackSessions.length,
        sessions: feedbackSessions.map((s) => ({
          id: s.id,
          date: isoDate(s.eventDate.date)!,
          title: s.title,
          sessionType: s.sessionType,
          attended: s._count.attendance,
          submitted: s._count.feedbackResponses,
          rate: percentOf(s._count.feedbackResponses, s._count.attendance),
          state: (s._count.attendance === 0 ? 'not_yet_available' : 'ok') as DataState,
        })),
      },
      definitions: [
        {
          term: 'Registered',
          definition:
            'A registration imported or created for the event whose status is active' +
            (eligible.includes('test') ? ' or test' : '') +
            '. Cancelled, pending and duplicate registrations are excluded everywhere.',
        },
        {
          term: 'Platform account',
          definition:
            'A registration linked to a sign-in account; signed in means the delegate has used it at least once.',
        },
        {
          term: 'Attended',
          definition:
            'An attendance record of attended or partially attended on a date; recorded by check-in, QR scan or the organisers. Absent is recorded when a date is closed; before that a delegate without a record is "not checked in".',
        },
        {
          term: 'Response rate',
          definition:
            'Submitted responses ÷ delegates the stage was open to (the registered delegates in scope) × 100. Session feedback: responses ÷ delegates recorded as attending that session.',
        },
      ],
    };
  }

  // ---------------------------------------------------------------- 2.2 expectations and baseline
  let expectations: ExpectationsSection | null = null;
  if (sections.has('expectations')) {
    const sa = await stageAnswers('pre_conference');
    const refs = await db.eventReferenceQuestion.findMany({
      where: { eventId },
      orderBy: { order: 'asc' },
      select: { questionKey: true },
    });
    const refOrder = new Map(refs.map((r, i) => [r.questionKey, i]));
    const texts = sa
      ? sa.questions
          .filter(isText)
          .map((q) => textsOf(sa, q))
          .sort((a, b) => (refOrder.get(a.key) ?? 1e6) - (refOrder.get(b.key) ?? 1e6))
      : [];
    expectations = {
      stage: await stageParticipation('pre_conference'),
      texts,
      choices: sa ? sa.questions.filter(isChoice).map((q) => distributionOf(sa, q)) : [],
      knowledge: await knowledgeOf('pre_conference'),
      statements: sa ? sa.questions.filter(isScored).map((q) => statementOf(sa, q)) : [],
      organisationExpectations: { state: 'not_collected' },
    };
    if (!sa)
      limitations.push(
        'No pre-conference assessment is configured, so there is no pre-event baseline.',
      );
  }

  // ---------------------------------------------------------------- 2.3 experience and learning
  let experience: ExperienceSection | null = null;
  if (sections.has('experience')) {
    const end = await stageAnswers('end_of_conference');
    const pre = await stageAnswers('pre_conference');
    const ratings = {
      all: [] as StatementAverage[],
      physical: [] as StatementAverage[],
      virtual: [] as StatementAverage[],
    };
    if (end) {
      for (const q of end.questions.filter(isScored))
        ratings[audienceOf(end, q)].push(statementOf(end, q));
    }
    const activities = await db.reflectionActivity.findMany({
      where: { eventId, status: { not: 'draft' } },
      select: {
        id: true,
        title: true,
        status: true,
        eventDate: { select: { date: true } },
        questions: {
          where: { retiredAt: null },
          orderBy: { order: 'asc' },
          select: { id: true, questionKey: true, prompt: true },
        },
        responses: {
          where: inScope,
          select: { delegateId: true, answers: { select: { questionId: true, value: true } } },
        },
      },
      orderBy: { eventDate: { date: 'asc' } },
    });
    const reflectionQuestionKeys = await db.reflectionQuestion.findMany({
      where: { eventId },
      select: { id: true, questionKey: true },
    });
    const reflectionKeyOf = new Map(reflectionQuestionKeys.map((q) => [q.id, q.questionKey]));
    const feedbackSessions = await db.eventSession.findMany({
      where: { eventId, feedbackEnabled: true },
      select: {
        id: true,
        title: true,
        startTime: true,
        eventDate: { select: { date: true } },
        feedbackQuestions: {
          where: { retiredAt: null },
          orderBy: { order: 'asc' },
          select: { id: true, questionKey: true, prompt: true, type: true },
        },
        feedbackResponses: {
          where: inScope,
          select: { delegateId: true, answers: { select: { questionId: true, value: true } } },
        },
        _count: { select: { attendance: { where: inScope } } },
      },
      orderBy: [{ eventDate: { date: 'asc' } }, { startTime: 'asc' }],
    });
    const feedbackKeys = await db.sessionFeedbackQuestion.findMany({
      where: { eventId },
      select: { id: true, questionKey: true },
    });
    const feedbackKeyOf = new Map(feedbackKeys.map((q) => [q.id, q.questionKey]));
    const endStage = configured('end_of_conference');
    experience = {
      stage: await stageParticipation('end_of_conference'),
      ratings,
      ratingDistributions: end
        ? end.questions.filter((q) => isScored(q) && !q.builtin).map((q) => distributionOf(end, q))
        : [],
      written: end
        ? end.questions.filter((q) => isText(q) && !q.builtin).map((q) => textsOf(end, q))
        : [],
      reflections: activities.map((a) => ({
        id: a.id,
        date: isoDate(a.eventDate.date)!,
        title: a.title,
        status: a.status,
        registered: population.ids.length,
        submitted: a.responses.length,
        rate: percentOf(a.responses.length, population.ids.length),
        state: (a.responses.length
          ? 'ok'
          : a.status === 'published'
            ? 'no_response'
            : 'not_yet_available') as DataState,
        questions: a.questions.map((q) => {
          const answers = a.responses
            .map((r) => ({
              delegate: population.byId.get(r.delegateId) ?? null,
              value: (
                r.answers.find((x) => reflectionKeyOf.get(x.questionId) === q.questionKey)?.value ??
                ''
              ).trim(),
            }))
            .filter((x) => x.value !== '');
          return {
            key: q.questionKey,
            prompt: q.prompt,
            sectionTitle: a.title,
            responses: answers.length,
            state: (answers.length ? 'ok' : 'no_response') as DataState,
            answers,
          };
        }),
      })),
      feedback: feedbackSessions.map((s) => ({
        id: s.id,
        date: isoDate(s.eventDate.date)!,
        title: s.title,
        attended: s._count.attendance,
        submitted: s.feedbackResponses.length,
        ratings: s.feedbackQuestions
          .filter((q) => q.type === 'rating')
          .map((q) => {
            const values = s.feedbackResponses
              .map(
                (r) =>
                  r.answers.find((x) => feedbackKeyOf.get(x.questionId) === q.questionKey)?.value ??
                  '',
              )
              .filter((v) => v !== '');
            return {
              prompt: q.prompt,
              total: values.length,
              ratings: (['excellent', 'good', 'fair', 'poor'] as const).map((rating) => {
                const count = values.filter((v) => v === rating).length;
                return {
                  rating,
                  count,
                  percent: values.length ? round1((count / values.length) * 100) : 0,
                };
              }),
            };
          }),
        written: s.feedbackQuestions
          .filter((q) => q.type === 'long_text')
          .map((q) => {
            const answers = s.feedbackResponses
              .map((r) => ({
                delegate: population.byId.get(r.delegateId) ?? null,
                value: (
                  r.answers.find((x) => feedbackKeyOf.get(x.questionId) === q.questionKey)?.value ??
                  ''
                ).trim(),
              }))
              .filter((x) => x.value !== '');
            return {
              key: q.questionKey,
              prompt: q.prompt,
              sectionTitle: s.title,
              responses: answers.length,
              state: (answers.length ? 'ok' : 'no_response') as DataState,
              answers,
            };
          }),
      })),
      knowledge: {
        before: await knowledgeOf('pre_conference'),
        after: await knowledgeOf('end_of_conference'),
      },
      confidence: {
        before: pre ? pre.questions.filter(isScored).map((q) => statementOf(pre, q)) : [],
        after: end
          ? end.questions.filter((q) => isScored(q) && !q.builtin).map((q) => statementOf(end, q))
          : [],
      },
      paired: endStage ? await pairedResultsFor(db, endStage, eligible, scope) : null,
    };
    if (!endStage)
      limitations.push(
        'No end-of-conference evaluation is configured, so experience ratings, post-event knowledge and confidence are not available.',
      );
  }

  // ---------------------------------------------------------------- 2.4 expectations at the end
  let expectationsEnd: ExpectationsEndSection | null = null;
  if (sections.has('expectations_end')) {
    const end = await stageAnswers('end_of_conference');
    const find = (sa: StageAnswers, builtin: string) =>
      sa.questions.find((q) => q.builtin === builtin);
    const metQ = end ? find(end, BUILTIN.expectationMetPre) : undefined;
    const afterQ = end ? find(end, BUILTIN.expectationRecordedAfter) : undefined;
    const metPostQ = end ? find(end, BUILTIN.expectationMetPost) : undefined;
    const explainQ = end ? find(end, BUILTIN.expectationExplain) : undefined;
    let completed = 0;
    let recordedAfter = 0;
    let preferNot = 0;
    if (end && (metQ || afterQ)) {
      for (const r of end.responses) {
        const met = metQ
          ? textOf(answerTo(r.answers, end.versions.get(metQ.id), metQ.id)?.value)
          : '';
        const after = afterQ
          ? textOf(answerTo(r.answers, end.versions.get(afterQ.id), afterQ.id)?.value)
          : '';
        if (met || after) completed += 1;
        if (after === PREFER_NOT_TO_ANSWER) preferNot += 1;
        else if (after) recordedAfter += 1;
      }
    }
    const submitted = end?.responses.length ?? 0;
    const blockState: DataState = !end
      ? 'not_configured'
      : !metQ
        ? 'not_configured'
        : submitted === 0
          ? 'no_response'
          : 'ok';
    expectationsEnd = {
      stage: await stageParticipation('end_of_conference'),
      completed: figure(
        completed,
        submitted,
        'Delegates who answered the expectations block, of submitted end-of-conference evaluations.',
        blockState,
      ),
      met: end && metQ ? distributionOf(end, metQ) : null,
      recordedAfter: figure(
        recordedAfter,
        submitted,
        'Delegates who wrote down an expectation only after the event (no pre-event answer), of submitted evaluations. Reported separately from pre-event expectations.',
        blockState,
      ),
      preferNotToAnswer: preferNot,
      metPost: end && metPostQ ? distributionOf(end, metPostQ) : null,
      explanations: end
        ? [explainQ, afterQ]
            .filter((q): q is AssessmentQuestionView => Boolean(q))
            .map((q) => textsOf(end, q))
        : [],
    };
    if (blockState === 'not_configured')
      limitations.push(
        'The end-of-conference evaluation has no expectations block, so expectations assessed at the end are not available.',
      );
  }

  // ---------------------------------------------------------------- 2.5 transfer and application
  const needPlans = sections.has('transfer') || sections.has('results');
  const periodFrom = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : null;
  const periodTo = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : null;
  const inPeriod = (d: Date | null | undefined) =>
    !d ? false : (!periodFrom || d >= periodFrom) && (!periodTo || d <= periodTo);
  const plans = needPlans
    ? await db.transferPlan.findMany({
        where: { eventId, ...inScope },
        include: {
          actions: {
            orderBy: { order: 'asc' },
            include: {
              progress: { orderBy: { recordedAt: 'desc' } },
              measures: {
                orderBy: { order: 'asc' },
                include: { readings: { orderBy: { recordedAt: 'desc' } } },
              },
              evidenceRecords: { orderBy: { order: 'asc' } },
            },
          },
          reminders: { select: { status: true } },
        },
      })
    : [];
  const actionsOf = (p: (typeof plans)[number]) => p.actions as unknown as ActionRow[];
  const allActions = plans.flatMap((p) => actionsOf(p).map((a) => ({ plan: p, action: a })));
  const progressIn = (a: ActionRow) =>
    periodFrom || periodTo ? a.progress.filter((p) => inPeriod(p.recordedAt)) : a.progress;
  const evidenceIn = (a: ActionRow) =>
    periodFrom || periodTo
      ? a.evidenceRecords.filter((e) => inPeriod(e.evidenceOn ?? e.updatedAt))
      : a.evidenceRecords;
  const measuresIn = (a: ActionRow) =>
    periodFrom || periodTo
      ? a.measures.filter((m) => inPeriod(m.actualOn ?? m.updatedAt))
      : a.measures;
  const measureCounts = () => {
    const counts = Object.fromEntries(measureSummaries.map((s) => [s, 0])) as Record<
      MeasureSummary,
      number
    >;
    for (const { action } of allActions) counts[summariseMeasures(measuresIn(action))] += 1;
    return counts;
  };
  const evidenceCounts = () => {
    const counts = Object.fromEntries(evidenceSupports.map((s) => [s, 0])) as Record<
      EvidenceSupport,
      number
    >;
    for (const { action } of allActions) for (const e of evidenceIn(action)) counts[e.support] += 1;
    return counts;
  };
  const listOf = (
    key: string,
    prompt: string,
    items: Array<{ delegateId: string; value: string }>,
    emptyState: DataState,
  ): TextAnswers => {
    const answers = items
      .map((i) => ({ delegate: population.byId.get(i.delegateId) ?? null, value: i.value.trim() }))
      .filter((a) => a.value !== '');
    return {
      key,
      prompt,
      sectionTitle: null,
      responses: answers.length,
      state: answers.length ? 'ok' : emptyState,
      answers,
    };
  };

  let transfer: TransferSection | null = null;
  if (sections.has('transfer')) {
    const started = plans.length;
    const submitted = plans.filter((p) => p.status === 'submitted').length;
    const incomplete = plans.filter(
      (p) => p.status === 'draft' && planHasContent(p.actions),
    ).length;
    const empty = plans.filter((p) => p.status === 'draft' && !planHasContent(p.actions)).length;
    const attendeeIds = [...attendees].filter((id) => population.byId.has(id));
    const submittedAttendees = plans.filter(
      (p) => p.status === 'submitted' && attendees.has(p.delegateId),
    ).length;
    const byStatus = Object.fromEntries(actionProgressStatuses.map((s) => [s, 0])) as Record<
      ActionProgressStatus,
      number
    >;
    for (const { action } of allActions) byStatus[action.progressStatus] += 1;
    const open = (s: ActionProgressStatus) =>
      !['completed', 'applied', 'applied_consistently', 'no_longer_applicable'].includes(s);
    const byFrequency = Object.fromEntries(reminderFrequencies.map((f) => [f, 0])) as Record<
      ReminderFrequency,
      number
    >;
    for (const p of plans) byFrequency[p.reminderFrequency] += 1;
    const applied = allActions.filter(({ action }) =>
      appliedStatuses.includes(action.progressStatus),
    );
    const appliedDelegates = new Set(applied.map(({ plan }) => plan.delegateId));
    const fu = await stageAnswers('follow_up');
    const fuStage = configured('follow_up');
    let followUp: TransferSection['application']['followUp'] = null;
    if (fuStage) {
      const participationFu = await stageParticipation('follow_up');
      const responded = new Set(
        (fu?.responses ?? [])
          .filter((r) => (!periodFrom && !periodTo ? true : inPeriod(r.submittedAt)))
          .map((r) => r.delegateId),
      );
      const progressed = new Set(
        allActions
          .filter(
            ({ action }) =>
              appliedStatuses.includes(action.progressStatus) ||
              progressIn(action).some((p) => p.status !== 'not_started'),
          )
          .map(({ plan }) => plan.delegateId),
      );
      followUp = {
        stage: participationFu,
        respondedWithProgress: [...responded].filter((d) => progressed.has(d)).length,
        respondedNoProgress: [...responded].filter((d) => !progressed.has(d)).length,
        notResponded: Math.max(0, participationFu.invited - responded.size),
        texts: fu ? fu.questions.filter(isText).map((q) => textsOf(fu, q)) : [],
        choices: fu ? fu.questions.filter(isChoice).map((q) => distributionOf(fu, q)) : [],
      };
    } else {
      limitations.push(
        'No follow-up assessment is configured, so follow-up responses are not available; application below comes from the delegates’ own progress records on their plans.',
      );
    }
    const end = await stageAnswers('end_of_conference');
    const readinessQ = end?.questions.find((q) => q.builtin === BUILTIN.readinessSupport);
    const fuReadinessQ = fu?.questions.find((q) => q.builtin === BUILTIN.readinessSupport);
    transfer = {
      plans: {
        started: figure(
          started,
          population.ids.length,
          'Delegates who opened a Transfer Plan, of registered delegates in scope.',
        ),
        submitted: figure(
          submitted,
          population.ids.length,
          'Delegates whose plan is submitted, of registered delegates in scope. A submitted plan is a plan, not proof that its actions happened.',
        ),
        incomplete: figure(
          incomplete,
          population.ids.length,
          'Draft plans with at least one action written but not submitted, of registered delegates in scope.',
        ),
        empty,
        completionRate: figure(
          submittedAttendees,
          attendeeIds.length,
          'Delegates recorded as attending whose plan is submitted, of delegates recorded as attending (backlog E15-5).',
          attendeeIds.length ? 'ok' : 'not_yet_available',
        ),
      },
      actions: {
        total: allActions.length,
        byStatus,
        withSupport: allActions.filter(({ action }) => action.support.trim()).length,
        withBarriers: allActions.filter(({ action }) => action.barriers.trim()).length,
        withStart: allActions.filter(({ action }) => action.startOn).length,
        withTarget: allActions.filter(({ action }) => action.targetOn).length,
        overdueTarget: allActions.filter(
          ({ action }) =>
            action.targetOn && isoDate(action.targetOn)! < today && open(action.progressStatus),
        ).length,
        overdueReview: allActions.filter(
          ({ action }) =>
            action.reviewOn && isoDate(action.reviewOn)! < today && open(action.progressStatus),
        ).length,
        priority: allActions
          .filter(({ action }) => action.isPriority)
          .map(({ plan, action }) => ({
            delegate: population.byId.get(plan.delegateId) ?? null,
            action: action.action,
            status: action.progressStatus,
            startOn: isoDate(action.startOn),
            targetOn: isoDate(action.targetOn),
            reviewOn: isoDate(action.reviewOn),
          })),
        priorityState: allActions.some(({ action }) => action.isPriority) ? 'ok' : 'no_response',
      },
      reminders: {
        byFrequency,
        scheduled: plans.filter((p) => p.nextReminderAt).length,
        sent: plans.reduce((n, p) => n + p.reminders.filter((r) => r.status === 'sent').length, 0),
        failed: plans.reduce(
          (n, p) => n + p.reminders.filter((r) => r.status !== 'sent').length,
          0,
        ),
      },
      application: {
        appliedActions: figure(
          applied.length,
          allActions.length,
          'Planned actions whose latest status is "applied" or "applied consistently", of all planned actions. Started, in progress and completed are not application. Self-reported.',
          allActions.length ? 'ok' : 'no_response',
        ),
        appliedDelegates: figure(
          appliedDelegates.size,
          started,
          'Delegates reporting at least one applied action, of delegates with a plan. Self-reported.',
          started ? 'ok' : 'no_response',
        ),
        followUp,
        supportNeeds: [
          listOf(
            'plan.support',
            'Support, resources or approval needed (from the plans)',
            allActions.map(({ plan, action }) => ({
              delegateId: plan.delegateId,
              value: action.support,
            })),
            'no_response',
          ),
          ...(end && readinessQ ? [textsOf(end, readinessQ)] : []),
          ...(fu && fuReadinessQ ? [textsOf(fu, fuReadinessQ)] : []),
        ],
        barriers: [
          listOf(
            'plan.barriers',
            'Potential barriers (from the plans)',
            allActions.map(({ plan, action }) => ({
              delegateId: plan.delegateId,
              value: action.barriers,
            })),
            'no_response',
          ),
          listOf(
            'progress.challenges',
            'Challenges reported with progress',
            allActions.flatMap(({ plan, action }) =>
              progressIn(action).map((p) => ({
                delegateId: plan.delegateId,
                value: p.challenges ?? '',
              })),
            ),
            'no_progress',
          ),
        ],
        changes: [
          listOf(
            'progress.notes',
            'Progress reported on actions (status and note)',
            allActions.flatMap(({ plan, action }) =>
              progressIn(action).map((p) => ({
                delegateId: plan.delegateId,
                value: [actionProgressLabels[p.status], p.note, p.results]
                  .filter(Boolean)
                  .join(': '),
              })),
            ),
            'no_progress',
          ),
        ],
        measures: measureCounts(),
        evidence: evidenceCounts(),
      },
    };
  }

  // ---------------------------------------------------------------- 2.6 expectations and results
  let results: ResultsSection | null = null;
  if (sections.has('results')) {
    const fu = await stageAnswers('follow_up');
    const metQ = fu?.questions.find((q) => q.builtin === BUILTIN.expectationMetPre);
    const metPostQ = fu?.questions.find((q) => q.builtin === BUILTIN.expectationMetPost);
    const outcomes = { improved: 0, declined: 0, unchanged: 0, not_comparable: 0 };
    const resultSupport = Object.fromEntries(evidenceSupports.map((s) => [s, 0])) as Record<
      EvidenceSupport,
      number
    >;
    const rows: ResultsSection['measures']['rows'] = [];
    const examples: ResultsSection['evidence']['examples'] = [];
    const influences = new Set<string>();
    for (const { plan, action } of allActions) {
      const measures = measuresIn(action);
      for (const m of measures) {
        if (m.status === 'identified' && m.actualValue.trim()) {
          resultSupport[m.support] += 1;
          outcomes[
            compareMeasure({
              ...m,
              baselineOn: isoDate(m.baselineOn),
              actualOn: isoDate(m.actualOn),
            }).outcome
          ] += 1;
        }
        if (m.influences.trim()) influences.add(m.influences.trim());
      }
      if (measures.length) {
        rows.push({
          delegate: population.byId.get(plan.delegateId) ?? null,
          action: action.action,
          measures: measures.map(measureViewOf),
        });
      }
      for (const e of evidenceIn(action)) {
        examples.push({
          delegate: population.byId.get(plan.delegateId) ?? null,
          action: action.action,
          type: evidenceTypeLabels[e.type],
          support: e.support,
          evidenceOn: isoDate(e.evidenceOn),
          description: e.description,
        });
      }
    }
    results = {
      expectations: {
        met: fu && metQ ? distributionOf(fu, metQ) : null,
        metPost: fu && metPostQ ? distributionOf(fu, metPostQ) : null,
        state: !configured('follow_up')
          ? 'not_configured'
          : !metQ
            ? 'not_configured'
            : fu && fu.responses.length
              ? 'ok'
              : 'no_response',
      },
      organisationExpectations: { state: 'not_collected' },
      measures: {
        actions: measureCounts(),
        outcomes,
        resultSupport,
        rows,
        rowsState: rows.length ? 'ok' : 'no_response',
      },
      evidence: {
        counts: evidenceCounts(),
        examples,
        examplesState: examples.length ? 'ok' : 'no_evidence',
      },
      influences: [...influences],
    };
  }

  // ---------------------------------------------------------------- limitations, always
  limitations.unshift(
    `Figures count ${population.description.toLowerCase()}; cancelled, pending and duplicate registrations are excluded. Every percentage names its own denominator.`,
    'Confidence, application, workplace changes and results are self-reported unless an item is marked "supported by another source"; neither label means independently verified, and no business result is attributed to the event.',
    'Missing answers are never counted as zero: a stage not yet open, a question nobody answered, a measure "not yet known" or "not applicable", a plan not started and progress not yet reported are shown as such.',
  );
  if (event.dates.some((d) => !d.attendanceClosedAt)) {
    limitations.push(
      'Attendance on a date that is not yet closed is incomplete: delegates without a record are "not checked in", not absent.',
    );
  }
  if (filters.from || filters.to) {
    limitations.push(
      `The reporting period (${filters.from ?? 'start'} to ${filters.to ?? 'now'}) applies to progress records, measure results, evidence and follow-up responses; participation and event-time results are not period-filtered.`,
    );
  }
  for (const section of input.sections) {
    if (section === 'expectations' || section === 'results') {
      limitations.push(
        `${reportSectionLabels[section]}: nominating organisation expectations are not collected by the platform.`,
      );
      break;
    }
  }

  return {
    event: {
      id: event.id,
      name: event.name,
      code: event.slug,
      status: event.status,
      format: event.format,
      startsOn: isoDate(event.startsOn)!,
      endsOn: isoDate(event.endsOn)!,
      timezone: event.timezone,
      dates: event.dates.map((d) => ({ id: d.id, date: isoDate(d.date)! })),
    },
    generatedAt: iso(now)!,
    filters,
    population: { registered: population.ids.length, description: population.description },
    sections: [...input.sections],
    limitations,
    participation,
    expectations,
    experience,
    expectationsEnd,
    transfer,
    results,
  };
}

/** Nominating organisations of the event's eligible delegates, with how many each nominated. */
export async function organisationsOf(
  db: PrismaClient,
  eventId: string,
  eligible: EligibleStatuses,
) {
  const rows = await db.delegate.groupBy({
    by: ['nominatingOrganisation'],
    where: {
      eventId,
      registrationStatus: { in: [...eligible] },
      nominatingOrganisation: { not: null },
    },
    _count: { _all: true },
    orderBy: { nominatingOrganisation: 'asc' },
  });
  return rows
    .filter((r) => r.nominatingOrganisation && r.nominatingOrganisation.trim())
    .map((r) => ({ name: r.nominatingOrganisation!, nominees: r._count._all }));
}
