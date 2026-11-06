import {
  actionProgressStatuses,
  evidenceSupports,
  figure,
  measureSummaries,
  reminderFrequencies,
  reportSections,
  type ActionProgressStatus,
  type EventReport,
  type EvidenceSupport,
  type MeasureSummary,
  type ReminderFrequency,
} from '@mbc/shared';

/**
 * A report fixture for the reporting tests: the figures of a small event worked out by hand,
 * with every section present. Overrides replace whole sections. Used by the report view, the
 * workspace and the event dashboard tests; it is not part of the application bundle.
 */

const zeros = <T extends string>(keys: readonly T[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;

const delegate = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Dee Legate',
  organisation: 'Acme',
  attendanceFormat: 'physical' as const,
};

const text = (key: string, prompt: string, value: string | null) => ({
  key,
  prompt,
  sectionTitle: null,
  responses: value ? 1 : 0,
  state: (value ? 'ok' : 'no_response') as 'ok' | 'no_response',
  answers: value ? [{ delegate, value }] : [],
});

const stage = (
  s: EventReport['participation'] extends null ? never : 'pre_conference',
  over: Partial<{ submitted: number; invited: number; state: string }> = {},
) => ({
  stage: s,
  enabled: true,
  status: 'open' as const,
  questions: 5,
  invited: over.invited ?? 4,
  started: 3,
  submitted: over.submitted ?? 2,
  responseRate: 50,
  notSubmitted: 2,
  state: (over.state ?? 'ok') as 'ok',
});

export function makeReport(overrides: Partial<EventReport> = {}): EventReport {
  return {
    kind: 'dashboard',
    audience: 'internal',
    event: {
      id: 'e1',
      name: 'Summit',
      code: 'summit',
      status: 'active',
      format: 'hybrid',
      startsOn: '2026-11-12',
      endsOn: '2026-11-13',
      timezone: 'Africa/Lagos',
      dates: [
        { id: 'd1', date: '2026-11-12' },
        { id: 'd2', date: '2026-11-13' },
      ],
    },
    generatedAt: '2026-11-05T10:00:00.000Z',
    filters: { attendanceFormat: null, organisation: null, from: null, to: null },
    population: { registered: 4, description: 'Registered delegates whose registration is active' },
    sections: [...reportSections],
    approval: null,
    limitations: [
      'Figures count registered delegates whose registration is active.',
      'Confidence, application and results are self-reported unless marked supported by another source; neither label means independently verified.',
      'Missing answers are never counted as zero.',
    ],
    participation: {
      registered: figure(4, 4, 'Registered delegates in scope.'),
      accounts: figure(2, 4, 'Registered delegates with a platform account, of registered.'),
      signedIn: figure(
        2,
        4,
        'Registered delegates who have signed in at least once, of registered.',
      ),
      attended: figure(
        2,
        4,
        'Registered delegates recorded present on at least one date, of registered.',
      ),
      assessed: figure(2, 4, 'Registered delegates with a submitted assessment, of registered.'),
      byFormat: [
        { format: 'physical', registered: 2, accounts: 1, attended: 1, attendedRate: 50 },
        { format: 'virtual', registered: 2, accounts: 1, attended: 1, attendedRate: 50 },
      ],
      byDate: [
        {
          id: 'd1',
          date: '2026-11-12',
          closed: true,
          registered: 4,
          attended: 1,
          partial: 1,
          absent: 1,
          notCheckedIn: 1,
          physical: 1,
          virtual: 1,
          rate: 50,
          state: 'ok',
        },
        {
          id: 'd2',
          date: '2026-11-13',
          closed: false,
          registered: 4,
          attended: 0,
          partial: 0,
          absent: 0,
          notCheckedIn: 4,
          physical: 0,
          virtual: 0,
          rate: 0,
          state: 'not_yet_available',
        },
      ],
      stages: [
        stage('pre_conference'),
        {
          stage: 'during_conference',
          enabled: false,
          status: 'draft',
          questions: 0,
          invited: 0,
          started: 0,
          submitted: 0,
          responseRate: null,
          notSubmitted: 0,
          state: 'not_configured',
        },
        { ...stage('pre_conference'), stage: 'end_of_conference' },
        { ...stage('pre_conference'), stage: 'follow_up' },
      ],
      feedback: {
        sessionsEnabled: 1,
        sessions: [
          {
            id: 's1',
            date: '2026-11-12',
            title: 'Opening keynote',
            sessionType: 'keynote',
            attended: 2,
            submitted: 1,
            rate: 50,
            state: 'ok',
          },
        ],
      },
      definitions: [{ term: 'Registered', definition: 'An active registration for the event.' }],
    },
    expectations: {
      stage: stage('pre_conference'),
      texts: [text('q-learn', 'What would you like to gain?', 'How to measure transfer')],
      choices: [
        {
          key: 'q-tools',
          prompt: 'Which do you use?',
          sectionTitle: null,
          builtin: null,
          visibleWhen: 'always',
          multiple: true,
          responses: 2,
          state: 'ok',
          options: [
            { value: 'plan', label: 'A transfer plan', count: 2, percent: 100 },
            { value: 'baseline', label: 'Baseline data', count: 1, percent: 50 },
          ],
        },
      ],
      knowledge: {
        questions: 2,
        respondents: 2,
        averageScore: 1.5,
        averagePercent: 75,
        state: 'ok',
      },
      statements: [
        {
          key: 'q-c1',
          prompt: 'I can identify a measure',
          sectionTitle: 'Baseline confidence',
          responses: 1,
          average: 1,
          state: 'ok',
        },
      ],
      organisationExpectations: { state: 'not_collected' },
    },
    experience: {
      stage: { ...stage('pre_conference'), stage: 'end_of_conference' },
      ratings: {
        all: [],
        physical: [
          {
            key: 'q-pq',
            prompt: 'Venue and facilities.',
            sectionTitle: 'In person',
            responses: 1,
            average: 4,
            state: 'ok',
          },
        ],
        virtual: [],
      },
      ratingDistributions: [],
      written: [text('q-gained', 'What did you learn?', 'A way to baseline')],
      reflections: [
        {
          id: 'r1',
          date: '2026-11-12',
          title: 'Day one reflection',
          status: 'published',
          registered: 4,
          submitted: 1,
          rate: 25,
          state: 'ok',
          questions: [text('rq1', 'What stood out today?', 'The measurement session')],
        },
      ],
      feedback: [
        {
          id: 's1',
          date: '2026-11-12',
          title: 'Opening keynote',
          attended: 2,
          submitted: 1,
          ratings: [
            {
              prompt: 'How was the session?',
              total: 1,
              ratings: [
                { rating: 'excellent', count: 1, percent: 100 },
                { rating: 'good', count: 0, percent: 0 },
                { rating: 'fair', count: 0, percent: 0 },
                { rating: 'poor', count: 0, percent: 0 },
              ],
            },
          ],
          written: [text('sq1', 'Anything to improve?', 'More time for questions')],
        },
      ],
      knowledge: {
        before: {
          questions: 2,
          respondents: 2,
          averageScore: 1.5,
          averagePercent: 75,
          state: 'ok',
        },
        after: { questions: 2, respondents: 2, averageScore: 2, averagePercent: 100, state: 'ok' },
      },
      confidence: { before: [], after: [] },
      paired: {
        stage: 'end_of_conference',
        sections: [
          {
            sectionId: 'sec1',
            title: 'Knowledge check',
            sourceStage: 'pre_conference',
            sourceTitle: 'Baseline knowledge',
            marking: 'knowledge',
            knowledge: {
              questions: 2,
              paired: 2,
              averageBeforePercent: 75,
              averageAfterPercent: 100,
              changePoints: 25,
            },
            statements: [],
          },
        ],
      },
    },
    expectationsEnd: {
      stage: { ...stage('pre_conference'), stage: 'end_of_conference' },
      completed: figure(
        2,
        2,
        'Delegates who answered the expectations block, of submitted evaluations.',
      ),
      met: {
        key: 'q-met',
        prompt: 'To what extent did the conference provide what you hoped to gain?',
        sectionTitle: 'Your expectations',
        builtin: null,
        visibleWhen: 'reference_answered',
        multiple: false,
        responses: 1,
        state: 'ok',
        options: [
          { value: 'fully', label: 'Fully', count: 1, percent: 100 },
          { value: 'partly', label: 'Partly', count: 0, percent: 0 },
        ],
      },
      recordedAfter: figure(
        1,
        2,
        'Delegates who recorded an expectation only after the event, of submitted evaluations.',
      ),
      preferNotToAnswer: 0,
      metPost: {
        key: 'q-metpost',
        prompt: 'To what extent was this expectation met?',
        sectionTitle: 'Your expectations',
        builtin: null,
        visibleWhen: 'reference_unanswered',
        multiple: false,
        responses: 1,
        state: 'ok',
        options: [{ value: 'met', label: 'Met', count: 1, percent: 100 }],
      },
      explanations: [text('q-explain', 'Please explain your response.', 'Got the measures')],
    },
    transfer: {
      plans: {
        started: figure(2, 4, 'Delegates who opened a plan, of registered.'),
        submitted: figure(1, 4, 'Delegates whose plan is submitted, of registered.'),
        incomplete: figure(1, 4, 'Draft plans with an action written, of registered.'),
        empty: 0,
        completionRate: figure(1, 2, 'Attendees whose plan is submitted, of attendees.'),
      },
      actions: {
        total: 3,
        byStatus: {
          ...zeros(actionProgressStatuses as readonly ActionProgressStatus[]),
          applied: 1,
          not_started: 2,
        },
        withSupport: 1,
        withBarriers: 1,
        withStart: 0,
        withTarget: 1,
        overdueTarget: 0,
        overdueReview: 0,
        priority: [
          {
            delegate,
            action: 'Brief stakeholders',
            status: 'applied',
            startOn: null,
            targetOn: '2026-11-20',
            reviewOn: null,
          },
        ],
        priorityState: 'ok',
      },
      reminders: {
        byFrequency: {
          ...zeros(reminderFrequencies as readonly ReminderFrequency[]),
          weekly: 1,
          none: 1,
        },
        scheduled: 1,
        sent: 0,
        failed: 0,
      },
      application: {
        appliedActions: figure(1, 3, 'Actions applied, of all planned actions. Self-reported.'),
        appliedDelegates: figure(
          1,
          2,
          'Delegates reporting application, of delegates with a plan. Self-reported.',
        ),
        followUp: {
          stage: { ...stage('pre_conference'), stage: 'follow_up' },
          respondedWithProgress: 1,
          respondedNoProgress: 1,
          notResponded: 2,
          texts: [text('q-fu', 'What changed at work?', 'Fewer reworks')],
          choices: [],
        },
        supportNeeds: [
          text('plan.support', 'Support needed (from the plans)', 'Time from my manager'),
        ],
        barriers: [
          text('plan.barriers', 'Potential barriers (from the plans)', 'Data access'),
          {
            ...text('progress.challenges', 'Challenges reported with progress', null),
            state: 'no_progress' as const,
          },
        ],
        changes: [text('progress.notes', 'Progress reported on actions', 'Applied: Briefed them')],
        measures: {
          ...zeros(measureSummaries as readonly MeasureSummary[]),
          with_result: 1,
          none: 2,
        },
        evidence: { ...zeros(evidenceSupports as readonly EvidenceSupport[]), supported: 1 },
        impact: {
          completed: figure(1, 2, 'Delegates with a completed plan, of delegates with a plan.'),
          applied: figure(0, 1, 'Applied, no measurable improvement yet, of completed.'),
          impactDemonstrated: figure(1, 1, 'Impact demonstrated, of completed.'),
          sustainedImpact: figure(0, 1, 'Sustained impact, of completed.'),
          checksWaiting: 1,
          checksAnswered: 0,
        },
      },
    },
    results: {
      expectations: { met: null, metPost: null, state: 'not_configured' },
      organisationExpectations: { state: 'not_collected' },
      measures: {
        actions: {
          ...zeros(measureSummaries as readonly MeasureSummary[]),
          with_result: 1,
          none: 2,
        },
        outcomes: { improved: 1, declined: 0, unchanged: 0, not_comparable: 0 },
        resultSupport: { ...zeros(evidenceSupports as readonly EvidenceSupport[]), supported: 1 },
        rows: [
          {
            delegate,
            action: 'Baseline the error rate',
            measures: [
              {
                id: 'm1',
                order: 1,
                status: 'identified',
                kind: 'quantitative',
                name: 'Error rate',
                importance: '',
                unit: '%',
                direction: 'lower',
                baselineValue: '12',
                baselineOn: null,
                targetValue: '',
                targetOn: null,
                actualValue: '9',
                actualOn: '2027-01-15',
                source: '',
                influences: 'New checklist too',
                support: 'supported',
                readings: [],
                updatedAt: '2027-01-16T10:00:00.000Z',
              },
            ],
          },
        ],
        rowsState: 'ok',
      },
      evidence: {
        counts: { ...zeros(evidenceSupports as readonly EvidenceSupport[]), supported: 1 },
        examples: [
          {
            delegate,
            action: 'Brief stakeholders',
            type: 'Manager’s or stakeholder’s confirmation',
            support: 'supported',
            evidenceOn: null,
            description: 'Manager confirmed the briefing',
          },
        ],
        examplesState: 'ok',
      },
      influences: ['New checklist too'],
    },
    ...overrides,
  };
}
