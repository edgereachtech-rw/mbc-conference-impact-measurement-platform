import { z } from 'zod';

import { pairedResultsSchema, questionVisibilities } from './assessments.js';
import { participationModes } from './auth.js';
import { reflectionStatuses } from './reflections.js';
import {
  assessmentStages,
  assessmentStageStatuses,
  eventFormats,
  eventStatuses,
  sessionTypes,
} from './events.js';
import { feedbackRatings } from './feedback.js';
import {
  actionProgressStatuses,
  evidenceSupports,
  measureSummaries,
  measureViewSchema,
  reminderFrequencies,
  transferPlanStatuses,
} from './transfer-plans.js';

/**
 * Event dashboards and reports (task of 2026-10-31; backlog E15, E16). One builder on the API
 * reads the existing records (registrations, accounts, attendance, assessments, reflections,
 * session feedback, Transfer Plans, measures and evidence, reminders) and produces this
 * document; the dashboard page and every report render it. Every figure carries its count,
 * its denominator and its definition; a figure nobody could answer yet is a state, never a
 * zero. Self-reported information is labelled; nothing here is called verified, and no business
 * result is attributed to the event. Nothing is ITTEC-specific: dates, sessions, stages and
 * questions are whatever the event configured.
 */

export const reportKinds = [
  'dashboard',
  'conference',
  'follow_up',
  'organisation',
  'sponsor',
] as const;
export type ReportKind = (typeof reportKinds)[number];
export const reportAudiences = ['internal', 'external'] as const;
export type ReportAudience = (typeof reportAudiences)[number];

export const reportKindMeta: Record<
  ReportKind,
  { label: string; audience: ReportAudience; description: string }
> = {
  dashboard: {
    label: 'Event dashboard',
    audience: 'internal',
    description: 'Everything, for M.Bryan admins on screen.',
  },
  conference: {
    label: 'Immediate conference report',
    audience: 'internal',
    description:
      'What happened at the event and the immediate learning and planning outcomes: participation, baseline, experience, learning, expectations at the end, Transfer Plans.',
  },
  follow_up: {
    label: 'Follow-up report',
    audience: 'internal',
    description:
      'Application of learning after the event: progress against planned actions, follow-up responses, support, barriers, measures, evidence and results reported.',
  },
  organisation: {
    label: 'Organisation report',
    audience: 'external',
    description:
      'For one nominating organisation: its nominees’ participation and learning, their Transfer Plan progress and reported application in aggregate. Approval required before sharing.',
  },
  sponsor: {
    label: 'Sponsor or partner report',
    audience: 'external',
    description:
      'Aggregate reach, experience, learning and application findings with no delegate-level information. Approval required before sharing.',
  },
};

export const reportSections = [
  'participation',
  'expectations',
  'experience',
  'expectations_end',
  'transfer',
  'results',
] as const;
export type ReportSection = (typeof reportSections)[number];
export const reportSectionLabels: Record<ReportSection, string> = {
  participation: 'Delegate participation',
  expectations: 'Expectations and baseline',
  experience: 'Conference experience and learning',
  expectations_end: 'Expectations assessed at the end',
  transfer: 'Transfer Planning and application',
  results: 'Expectations and results',
};

/** The sections each kind carries by default; an admin may leave any out (backlog E16-8). */
export const reportDefaultSections: Record<ReportKind, readonly ReportSection[]> = {
  dashboard: reportSections,
  conference: ['participation', 'expectations', 'experience', 'expectations_end', 'transfer'],
  follow_up: ['participation', 'transfer', 'results'],
  organisation: ['participation', 'experience', 'transfer', 'results'],
  sponsor: ['participation', 'experience', 'expectations_end', 'transfer', 'results'],
};

/**
 * Why a figure has no value. Missing answers are never counted as zero: a stage nobody could
 * answer yet, a question nobody answered, a plan not started and a measure "not applicable"
 * are different things and are reported as such (task §5.3).
 */
export const dataStates = [
  'ok',
  'not_configured',
  'not_yet_available',
  'no_response',
  'not_applicable',
  'not_yet_known',
  'incomplete',
  'no_progress',
  'no_evidence',
  'not_collected',
  'withheld',
] as const;
export type DataState = (typeof dataStates)[number];
export const dataStateLabels: Record<DataState, string> = {
  ok: '',
  not_configured: 'Not configured for this event',
  not_yet_available: 'Not yet available',
  no_response: 'No response',
  not_applicable: 'Not applicable',
  not_yet_known: 'Not yet known',
  incomplete: 'Incomplete',
  no_progress: 'No progress reported',
  no_evidence: 'No evidence provided',
  not_collected: 'Not collected by the platform',
  withheld: 'Not included for this audience',
};

/** A count with the group it is counted against. percent is null when the group is empty. */
export const figureSchema = z.object({
  count: z.number().int(),
  of: z.number().int(),
  percent: z.number().nullable(),
  /** What the count is and what it is counted against, in words. */
  definition: z.string(),
  state: z.enum(dataStates).default('ok'),
});
export type Figure = z.infer<typeof figureSchema>;

const delegateRef = z.object({
  id: z.uuid(),
  name: z.string(),
  organisation: z.string().nullable(),
  attendanceFormat: z.enum(participationModes),
});

/** Free-text answers to one question; the texts travel only to internal audiences. */
export const textAnswersSchema = z.object({
  key: z.string(),
  prompt: z.string(),
  sectionTitle: z.string().nullable(),
  responses: z.number().int(),
  state: z.enum(dataStates),
  answers: z.array(z.object({ delegate: delegateRef.nullable(), value: z.string() })),
});
export type TextAnswers = z.infer<typeof textAnswersSchema>;

/** How often each option of a choice question was chosen, among those who answered it. */
export const choiceDistributionSchema = z.object({
  key: z.string(),
  prompt: z.string(),
  sectionTitle: z.string().nullable(),
  builtin: z.string().nullable(),
  /** Which delegates were asked: a branch question's share is of its cohort, not the stage. */
  visibleWhen: z.enum(questionVisibilities).default('always'),
  multiple: z.boolean(),
  responses: z.number().int(),
  state: z.enum(dataStates),
  options: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      count: z.number().int(),
      percent: z.number().nullable(),
    }),
  ),
});
export type ChoiceDistribution = z.infer<typeof choiceDistributionSchema>;

/** Average score of a scored statement; "Not applicable" and blanks excluded; self-reported. */
export const statementAverageSchema = z.object({
  key: z.string(),
  prompt: z.string(),
  sectionTitle: z.string().nullable(),
  responses: z.number().int(),
  average: z.number().nullable(),
  state: z.enum(dataStates),
});
export type StatementAverage = z.infer<typeof statementAverageSchema>;

export const knowledgeFigureSchema = z.object({
  questions: z.number().int(),
  respondents: z.number().int(),
  averageScore: z.number().nullable(),
  averagePercent: z.number().nullable(),
  state: z.enum(dataStates),
});

export const stageParticipationSchema = z.object({
  stage: z.enum(assessmentStages),
  enabled: z.boolean(),
  status: z.enum(assessmentStageStatuses),
  questions: z.number().int(),
  /** Delegates the stage is counted against (the scoped registrations). */
  invited: z.number().int(),
  started: z.number().int(),
  submitted: z.number().int(),
  /** submitted ÷ invited × 100; null when nobody is invited or the stage is not configured. */
  responseRate: z.number().nullable(),
  notSubmitted: z.number().int(),
  state: z.enum(dataStates),
});
export type StageParticipation = z.infer<typeof stageParticipationSchema>;

// ------------------------------------------------------------------ 2.1 participation

export const participationSectionSchema = z.object({
  registered: figureSchema,
  /** Registered delegates whose registration is linked to a platform account. */
  accounts: figureSchema,
  /** Registered delegates who have signed in at least once (backlog E15-1). */
  signedIn: figureSchema,
  /** Registered delegates recorded present on at least one date (backlog E15-2). */
  attended: figureSchema,
  /** Registered delegates with at least one submitted assessment response. */
  assessed: figureSchema,
  byFormat: z.array(
    z.object({
      format: z.enum(participationModes),
      registered: z.number().int(),
      accounts: z.number().int(),
      attended: z.number().int(),
      attendedRate: z.number().nullable(),
    }),
  ),
  byDate: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      closed: z.boolean(),
      registered: z.number().int(),
      attended: z.number().int(),
      partial: z.number().int(),
      absent: z.number().int(),
      notCheckedIn: z.number().int(),
      physical: z.number().int(),
      virtual: z.number().int(),
      rate: z.number().nullable(),
      state: z.enum(dataStates),
    }),
  ),
  stages: z.array(stageParticipationSchema),
  feedback: z.object({
    sessionsEnabled: z.number().int(),
    sessions: z.array(
      z.object({
        id: z.uuid(),
        date: z.string(),
        title: z.string(),
        sessionType: z.enum(sessionTypes),
        attended: z.number().int(),
        submitted: z.number().int(),
        /** submitted ÷ attended × 100; null when nobody is recorded as attending. */
        rate: z.number().nullable(),
        state: z.enum(dataStates),
      }),
    ),
  }),
  definitions: z.array(z.object({ term: z.string(), definition: z.string() })),
});
export type ParticipationSection = z.infer<typeof participationSectionSchema>;

// ------------------------------------------------------------------ 2.2 expectations and baseline

export const expectationsSectionSchema = z.object({
  stage: stageParticipationSchema.nullable(),
  /** The event's reference questions first (expectations, priority challenges), then every other open question. */
  texts: z.array(textAnswersSchema),
  choices: z.array(choiceDistributionSchema),
  knowledge: knowledgeFigureSchema.nullable(),
  /** Self-reported confidence and practice statements, one average each. */
  statements: z.array(statementAverageSchema),
  organisationExpectations: z.object({ state: z.enum(dataStates) }),
});
export type ExpectationsSection = z.infer<typeof expectationsSectionSchema>;

// ------------------------------------------------------------------ 2.3 experience and learning

export const experienceSectionSchema = z.object({
  stage: stageParticipationSchema.nullable(),
  /** Scored statements of the end-of-conference stage by the audience their section addresses. */
  ratings: z.object({
    all: z.array(statementAverageSchema),
    physical: z.array(statementAverageSchema),
    virtual: z.array(statementAverageSchema),
  }),
  ratingDistributions: z.array(choiceDistributionSchema),
  written: z.array(textAnswersSchema),
  reflections: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      title: z.string(),
      status: z.enum(reflectionStatuses),
      registered: z.number().int(),
      submitted: z.number().int(),
      rate: z.number().nullable(),
      state: z.enum(dataStates),
      questions: z.array(textAnswersSchema),
    }),
  ),
  feedback: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      title: z.string(),
      attended: z.number().int(),
      submitted: z.number().int(),
      ratings: z.array(
        z.object({
          prompt: z.string(),
          total: z.number().int(),
          ratings: z.array(
            z.object({
              rating: z.enum(feedbackRatings),
              count: z.number().int(),
              percent: z.number(),
            }),
          ),
        }),
      ),
      written: z.array(textAnswersSchema),
    }),
  ),
  knowledge: z.object({
    before: knowledgeFigureSchema.nullable(),
    after: knowledgeFigureSchema.nullable(),
  }),
  confidence: z.object({
    before: z.array(statementAverageSchema),
    after: z.array(statementAverageSchema),
  }),
  /** Paired comparisons of every mirrored section: the same delegates before and after. */
  paired: pairedResultsSchema.nullable(),
});
export type ExperienceSection = z.infer<typeof experienceSectionSchema>;

// ------------------------------------------------------------------ 2.4 expectations at the end

export const expectationsEndSectionSchema = z.object({
  stage: stageParticipationSchema.nullable(),
  /** Delegates who answered the expectations block. */
  completed: figureSchema,
  /** Pre-event expectations: how far they were met, among those assessed. */
  met: choiceDistributionSchema.nullable(),
  /** Delegates who recorded an expectation only after the event (not "prefer not to answer"). */
  recordedAfter: figureSchema,
  preferNotToAnswer: z.number().int(),
  /** Those after-the-event expectations: how far they were met. Reported separately. */
  metPost: choiceDistributionSchema.nullable(),
  explanations: z.array(textAnswersSchema),
});
export type ExpectationsEndSection = z.infer<typeof expectationsEndSectionSchema>;

// ------------------------------------------------------------------ 2.5 transfer and application

export const transferSectionSchema = z.object({
  plans: z.object({
    /** Delegates who opened a plan. */
    started: figureSchema,
    submitted: figureSchema,
    /** Draft plans with at least one action written. */
    incomplete: figureSchema,
    /** Opened but nothing written yet. */
    empty: z.number().int(),
    /** Submitted plans among delegates recorded as attending (backlog E15-5). */
    completionRate: figureSchema,
  }),
  actions: z.object({
    total: z.number().int(),
    byStatus: z.record(z.enum(actionProgressStatuses), z.number().int()),
    withSupport: z.number().int(),
    withBarriers: z.number().int(),
    withStart: z.number().int(),
    withTarget: z.number().int(),
    overdueTarget: z.number().int(),
    overdueReview: z.number().int(),
    priority: z.array(
      z.object({
        delegate: delegateRef.nullable(),
        action: z.string(),
        status: z.enum(actionProgressStatuses),
        startOn: z.string().nullable(),
        targetOn: z.string().nullable(),
        reviewOn: z.string().nullable(),
      }),
    ),
    priorityState: z.enum(dataStates),
  }),
  reminders: z.object({
    byFrequency: z.record(z.enum(reminderFrequencies), z.number().int()),
    scheduled: z.number().int(),
    sent: z.number().int(),
    failed: z.number().int(),
  }),
  application: z.object({
    /** Actions whose latest status is applied or applied consistently (never started/in progress/completed). */
    appliedActions: figureSchema,
    /** Delegates with at least one applied action, among delegates with a plan. */
    appliedDelegates: figureSchema,
    followUp: z
      .object({
        stage: stageParticipationSchema,
        /** Submitted the follow-up and have an applied action or a progress record since the event. */
        respondedWithProgress: z.number().int(),
        /** Submitted the follow-up but report no progress on any action. */
        respondedNoProgress: z.number().int(),
        notResponded: z.number().int(),
        texts: z.array(textAnswersSchema),
        choices: z.array(choiceDistributionSchema),
      })
      .nullable(),
    supportNeeds: z.array(textAnswersSchema),
    barriers: z.array(textAnswersSchema),
    changes: z.array(textAnswersSchema),
    measures: z.record(z.enum(measureSummaries), z.number().int()),
    evidence: z.record(z.enum(evidenceSupports), z.number().int()),
    /**
     * Impact after completion (2026-11-06), per delegate, each counted once at the furthest
     * point any of their plans reached: completed with evidence; applied with no measurable
     * improvement yet; an improvement demonstrated with evidence; that improvement sustained at
     * a later check. Reported by delegates and never inferred from completion.
     */
    impact: z.object({
      completed: figureSchema,
      applied: figureSchema,
      impactDemonstrated: figureSchema,
      sustainedImpact: figureSchema,
      /** Impact checks that have fallen due and are still unanswered. */
      checksWaiting: z.number().int(),
      checksAnswered: z.number().int(),
    }),
  }),
});
export type TransferSection = z.infer<typeof transferSectionSchema>;

// ------------------------------------------------------------------ 2.6 expectations and results

export const resultsSectionSchema = z.object({
  /** Expectations assessed after the event (the follow-up stage's expectations block, when present). */
  expectations: z.object({
    met: choiceDistributionSchema.nullable(),
    metPost: choiceDistributionSchema.nullable(),
    state: z.enum(dataStates),
  }),
  organisationExpectations: z.object({ state: z.enum(dataStates) }),
  measures: z.object({
    actions: z.record(z.enum(measureSummaries), z.number().int()),
    /** Identified quantitative measures with a result, read in their own direction. */
    outcomes: z.record(
      z.enum(['improved', 'declined', 'unchanged', 'not_comparable']),
      z.number().int(),
    ),
    resultSupport: z.record(z.enum(evidenceSupports), z.number().int()),
    rows: z.array(
      z.object({
        delegate: delegateRef.nullable(),
        action: z.string(),
        measures: z.array(measureViewSchema),
      }),
    ),
    rowsState: z.enum(dataStates),
  }),
  evidence: z.object({
    counts: z.record(z.enum(evidenceSupports), z.number().int()),
    examples: z.array(
      z.object({
        delegate: delegateRef.nullable(),
        action: z.string(),
        type: z.string(),
        support: z.enum(evidenceSupports),
        evidenceOn: z.string().nullable(),
        description: z.string(),
      }),
    ),
    examplesState: z.enum(dataStates),
  }),
  influences: z.array(z.string()),
});
export type ResultsSection = z.infer<typeof resultsSectionSchema>;

// ------------------------------------------------------------------ the report

export const reportFiltersSchema = z.object({
  attendanceFormat: z.enum(participationModes).nullable(),
  organisation: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const reportApprovalSchema = z.object({
  id: z.uuid(),
  sections: z.array(z.enum(reportSections)),
  note: z.string(),
  approvedAt: z.string(),
  approvedBy: z.string().nullable(),
});

export const eventReportSchema = z.object({
  kind: z.enum(reportKinds),
  audience: z.enum(reportAudiences),
  event: z.object({
    id: z.uuid(),
    name: z.string(),
    code: z.string(),
    status: z.enum(eventStatuses),
    format: z.enum(eventFormats),
    startsOn: z.string(),
    endsOn: z.string(),
    timezone: z.string(),
    dates: z.array(z.object({ id: z.uuid(), date: z.string() })),
  }),
  generatedAt: z.string(),
  filters: reportFiltersSchema,
  /** The delegates every figure is counted against, after the filters. */
  population: z.object({ registered: z.number().int(), description: z.string() }),
  sections: z.array(z.enum(reportSections)),
  /** External kinds only: whether the shown sections are approved for sharing. */
  approval: z
    .object({
      required: z.boolean(),
      current: reportApprovalSchema.nullable(),
      /** True when `current` covers every section shown. */
      covers: z.boolean(),
    })
    .nullable(),
  limitations: z.array(z.string()),
  participation: participationSectionSchema.nullable(),
  expectations: expectationsSectionSchema.nullable(),
  experience: experienceSectionSchema.nullable(),
  expectationsEnd: expectationsEndSectionSchema.nullable(),
  transfer: transferSectionSchema.nullable(),
  results: resultsSectionSchema.nullable(),
});
export type EventReport = z.infer<typeof eventReportSchema>;

export const reportQuerySchema = z.object({
  sections: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((x) => x.trim())
            .filter((x): x is ReportSection => (reportSections as readonly string[]).includes(x))
        : undefined,
    ),
  format: z.enum(participationModes).optional(),
  organisation: z.string().trim().max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const reportApproveSchema = z.object({
  organisation: z.string().trim().max(200).optional(),
  sections: z.array(z.enum(reportSections)).min(1),
  note: z.string().trim().max(2_000).default(''),
});
export type ReportApprove = z.infer<typeof reportApproveSchema>;

/** Organisations a report can be scoped to: nominating organisations of the event's delegates. */
export const reportOrganisationsSchema = z.object({
  organisations: z.array(z.object({ name: z.string(), nominees: z.number().int() })),
});

// ------------------------------------------------------------------ delegate journey (3)

export const journeySchema = z.object({
  event: z.object({ id: z.uuid(), name: z.string(), timezone: z.string() }),
  attendance: z.object({
    status: z.enum(['pending', 'attended', 'partial', 'absent']),
    dates: z.array(
      z.object({
        date: z.string(),
        status: z.enum(['not_checked_in', 'attended', 'partial', 'absent']),
        closed: z.boolean(),
      }),
    ),
  }),
  assessments: z.array(
    z.object({
      stage: z.enum(assessmentStages),
      /** Which round of the stage: always 1 except the follow-up waves (E12-1). */
      wave: z.number().int(),
      /** What this wave is called where a stage has several ("30-day follow-up"); else empty. */
      waveLabel: z.string(),
      state: z.enum(['not_configured', 'not_yet_open', 'open', 'draft', 'submitted', 'closed']),
      submittedAt: z.string().nullable(),
    }),
  ),
  reflections: z.object({ available: z.number().int(), submitted: z.number().int() }),
  feedback: z.object({ sessions: z.number().int(), submitted: z.number().int() }),
  /** Transfer Planning is hidden from the delegate right now (2026-11-08): no plan step. */
  transferPlanHidden: z.boolean().default(false),
  plan: z
    .object({
      status: z.enum(transferPlanStatuses),
      actions: z.number().int(),
      priority: z.string().nullable(),
      applied: z.number().int(),
      measures: z.number().int(),
      withResult: z.number().int(),
      evidence: z.number().int(),
      reminder: z.enum(reminderFrequencies),
      nextReminderAt: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  supportRequests: z.object({ state: z.enum(dataStates) }),
});
export type Journey = z.infer<typeof journeySchema>;

// ------------------------------------------------------------------ helpers

export const percentOf = (count: number, of: number): number | null =>
  of > 0 ? Math.round((count / of) * 1000) / 10 : null;

export function figure(
  count: number,
  of: number,
  definition: string,
  state: DataState = 'ok',
): Figure {
  return { count, of, percent: percentOf(count, of), definition, state };
}

/** "24 of 40 (60%)", or the state when there is nothing to count. */
export function formatFigure(f: Figure): string {
  if (f.state !== 'ok' && f.state !== 'withheld' && f.count === 0) return dataStateLabels[f.state];
  if (f.state === 'withheld') return dataStateLabels.withheld;
  return f.percent === null ? `${f.count} of ${f.of}` : `${f.count} of ${f.of} (${f.percent}%)`;
}
