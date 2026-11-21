import {
  DEFAULT_CHECKLIST_TEMPLATE,
  type AssessmentQuestionView,
  type TransferPlanView,
} from '@mbc/shared';
import { describe, expect, it } from 'vitest';

import { blocksText, toDocx } from './docx.js';
import { toPdf } from './pdf.js';
import {
  assessmentDocument,
  feedbackDocument,
  planDocument,
  responsesDocument,
  tableDocument,
} from './submissions.js';

/**
 * Submissions as documents (2026-11-21): one block per delegate, every question as asked with
 * its answer; skipped questions say "No answer", questions never asked are left out.
 */

const AT = new Date('2026-11-21T09:00:00.000Z');
const base = {
  organiser: 'M.Bryan',
  eventName: 'ITTEC 2026',
  timezone: 'Africa/Lagos',
  generatedAt: AT,
};

const question = (id: string, extra: Partial<AssessmentQuestionView>): AssessmentQuestionView =>
  ({
    id,
    questionKey: `${id}0000000-0000-4000-8000-000000000000`.slice(0, 36),
    version: 1,
    order: 1,
    sectionId: null,
    prompt: `Q ${id}`,
    helpText: null,
    required: true,
    type: 'short_text',
    options: null,
    scale: null,
    isKnowledge: false,
    conditionalQuestionKey: null,
    ...extra,
  }) as unknown as AssessmentQuestionView;

describe('assessment document', () => {
  const manager = question('a', {
    order: 1,
    type: 'yes_no',
    prompt: 'Do you manage a team?',
    sectionId: 's1',
  });
  const size = question('b', {
    order: 2,
    prompt: 'How large is it?',
    sectionId: 's1',
    conditionalQuestionKey: manager.questionKey,
    conditionalValues: ['true'],
  } as Partial<AssessmentQuestionView>);
  const confidence = question('c', {
    order: 3,
    type: 'rating',
    prompt: 'How confident are you?',
    sectionId: 's1',
    scale: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Very' },
  });
  const quiz = question('d', {
    order: 4,
    type: 'single_choice',
    prompt: 'What comes first?',
    sectionId: 's2',
    isKnowledge: true,
    options: [
      { value: 'a', label: 'Enrol everyone' },
      { value: 'b', label: 'Examine the gap' },
    ],
  });
  const online = question('e', { order: 5, prompt: 'How was the stream?', sectionId: 's3' });
  const answers =
    (map: Record<string, { value: unknown; correct?: boolean }>) => (q: AssessmentQuestionView) =>
      map[q.id] ? { value: map[q.id]!.value, correct: map[q.id]!.correct ?? null } : undefined;

  const { blocks, meta } = assessmentDocument({
    ...base,
    title: 'Pre-conference assessment',
    sections: [
      { id: 's1', title: 'About you', audience: 'all' },
      { id: 's2', title: 'Knowledge', audience: 'all' },
      { id: 's3', title: 'Online experience', audience: 'virtual' },
    ],
    questions: [manager, size, confidence, quiz, online],
    invited: 4,
    responses: [
      {
        delegate: { name: 'Zara Last', attendanceFormat: 'virtual', organisation: 'Acme' },
        submittedAt: AT,
        answerOf: answers({
          a: { value: false },
          c: { value: 5 },
          d: { value: 'b', correct: true },
          e: { value: 'Clear' },
        }),
      },
      {
        delegate: {
          name: 'Ada First',
          attendanceFormat: 'physical',
          jobTitle: 'Head of Learning',
          organisation: 'Leadway',
          department: 'HR',
          batch: { name: 'Batch 1' },
        },
        submittedAt: AT,
        answerOf: answers({
          a: { value: true },
          c: { value: 3 },
          d: { value: 'a', correct: false },
        }),
      },
    ],
  });
  const text = blocksText(blocks);

  it('opens with a cover and the totals, then delegates in name order with who they are', () => {
    expect(blocks[0]).toMatchObject({ kind: 'cover', title: 'Pre-conference assessment' });
    expect(text).toContain('Submitted responses');
    expect(text).toContain('50%'); // two of four in scope
    const names = blocks
      .filter((b) => b.kind === 'respondent')
      .map((b) => (b as { name: string }).name);
    expect(names).toEqual(['Ada First', 'Zara Last']);
    expect(text).toContain(
      'Head of Learning, Leadway · HR · Batch 1 · In person · Submitted 21 Nov 2026, 10:00',
    );
    expect(meta.footnote).toMatch(/personal data/);
  });

  it('prints each question as asked with its answer, and marks knowledge answers', () => {
    const ada = text.slice(text.indexOf('Ada First'), text.indexOf('Zara Last'));
    expect(ada).toContain('Q1 Do you manage a team?: Yes');
    expect(ada).toContain('Q2 How large is it?: No answer'); // asked, left blank
    expect(ada).toContain('Q3 How confident are you?: 3 of 5');
    expect(ada).toContain('Knowledge · 0 of 1 (0%)');
    expect(ada).toContain('What comes first?: Enrol everyone (incorrect)');
    // The online-only section is not shown to an in-person delegate.
    expect(ada).not.toContain('How was the stream?');
  });

  it('leaves out a question never asked, and shows a rating end label', () => {
    const zara = text.slice(text.indexOf('Zara Last'));
    expect(zara).not.toContain('How large is it?'); // the condition was not met
    expect(zara).toContain('How confident are you?: 5 of 5 (Very)');
    expect(zara).toContain('What comes first?: Examine the gap (correct)');
    expect(zara).toContain('How was the stream?: Clear');
  });

  it('renders as a real PDF and a real Word file', async () => {
    expect((await toPdf(blocks, meta)).subarray(0, 4).toString()).toBe('%PDF');
    expect((await toDocx(blocks, meta)).subarray(0, 2).toString()).toBe('PK');
  });
});

describe('session feedback document', () => {
  const doc = feedbackDocument({
    ...base,
    questions: [
      { questionKey: 'k1', prompt: 'How useful was this session?', type: 'rating' },
      { questionKey: 'k2', prompt: 'What would you change?', type: 'long_text' },
    ],
    sessions: [
      {
        title: 'Measuring transfer',
        date: '2026-11-12',
        startTime: '09:00',
        endTime: '10:00',
        speaker: 'Dr A. Speaker',
        attended: 30,
        responses: [
          {
            delegate: { name: 'Vee Virtual', attendanceFormat: 'virtual' },
            submittedAt: AT,
            answers: [
              {
                questionKey: 'k1',
                prompt: 'How useful was this session?',
                type: 'rating',
                value: 'excellent',
              },
              {
                questionKey: 'old',
                prompt: 'A retired question',
                type: 'long_text',
                value: 'Kept',
              },
            ],
          },
        ],
      },
      {
        title: 'Panel',
        date: '2026-11-12',
        startTime: '11:00',
        endTime: '12:00',
        speaker: null,
        attended: 30,
        responses: [],
      },
    ],
  });
  const text = blocksText(doc.blocks);
  it('goes session by session, each response with every question and its answer', () => {
    expect(text).toContain('12 Nov 2026 · Measuring transfer');
    expect(text).toContain('Vee Virtual');
    expect(text).toContain('Q1 How useful was this session?: Excellent');
    expect(text).toContain('Q2 What would you change?: No answer');
    expect(text).toContain('Q3 A retired question: Kept');
    expect(text).toContain('No feedback has been submitted for this session yet.');
  });
});

describe('Transfer Plans document', () => {
  const action = {
    id: 'a1',
    order: 1,
    isPriority: true,
    title: 'Faster handovers',
    priorityLearning: 'Briefing before training',
    action: 'Brief stakeholders',
    opportunity: '',
    firstStep: 'Book the meeting',
    startOn: '2026-11-20',
    targetOn: '2026-12-15',
    stakeholders: '',
    support: '',
    barriers: '',
    evidence: 'Minutes',
    expectedResult: '',
    measure: '',
    baseline: '',
    reviewOn: null,
    progressStatus: 'applied',
    progress: [
      {
        id: 'p1',
        status: 'applied',
        wave: 1,
        waveLabel: '30-day follow-up',
        occurredOn: '2026-12-10',
        note: 'Briefed all three',
        evidence: null,
        results: null,
        challenges: null,
        newTargetOn: null,
        recordedAt: '2026-12-15T09:00:00.000Z',
      },
    ],
    measureStatus: 'not_yet_known',
    measures: [],
    evidenceRecords: [],
    reminder: {
      frequency: 'weekly',
      startOn: '2026-11-20',
      endOn: null,
      time: '09:00',
      days: [],
      nextReminderAt: null,
    },
  };
  const plan = {
    id: 'p',
    eventId: 'e',
    sequence: 1,
    title: '',
    trainingName: 'Coaching skills',
    checklist: { ticked: ['explain_why', 'protect_time'], commitmentKey: 'protect_time' },
    status: 'submitted',
    version: 3,
    submittedAt: '2026-11-13T12:00:00.000Z',
    completedAt: null,
    outcome: 'pending',
    outcomeNote: '',
    impactChecks: [],
    updatedAt: '2026-11-13T12:00:00.000Z',
    actions: [action],
  } as unknown as TransferPlanView;
  const delegate = { name: 'Dee Manager', attendanceFormat: 'physical' as const };

  it('prints every plan question of each action, its reminder and each follow-up', () => {
    const text = blocksText(
      planDocument({
        ...base,
        mode: 'full',
        template: DEFAULT_CHECKLIST_TEMPLATE,
        includesDrafts: false,
        plans: [{ delegate, plan }],
      }).blocks,
    );
    expect(text).toContain('Action 1: Faster handovers (first priority)');
    expect(text).toContain('1.2 Priority learning: Briefing before training');
    expect(text).toContain(
      '1.4 Where or in which workplace opportunity will you apply this?: No answer',
    );
    expect(text).toContain('When do you expect to achieve this?: 15 Dec 2026');
    expect(text).toContain('Can you identify a business measure for this action?: Not yet known');
    expect(text).toContain('Reminder: Every week, at 09:00, from 20 Nov 2026');
    expect(text).toContain(
      '30-day follow-up: where the action stands: Applied, on 10 Dec 2026\nBriefed all three',
    );
  });

  it('prints the checklist and commitment in the form’s own words', () => {
    const text = blocksText(
      planDocument({
        ...base,
        mode: 'commitment',
        template: DEFAULT_CHECKLIST_TEMPLATE,
        includesDrafts: false,
        plans: [{ delegate, plan }],
      }).blocks,
    );
    expect(text).toContain('What is the name of the training?: Coaching skills');
    expect(text).toContain(
      '• Explain why the trainee is attending.\n• Protect the trainee’s time to participate.',
    );
    expect(text).toContain(
      'Which action will you commit to?: Protect the trainee’s time to participate.',
    );
    expect(text).toContain('By what date?: 15 Dec 2026');
    expect(text).toContain('Would you like a reminder?: Yes, on 20 Nov 2026');
    expect(text).toContain(
      '30-day follow-up: Where are you with this action?: I have done it, on 10 Dec 2026',
    );
  });
});

describe('reflections and support, attendance and delegate list documents', () => {
  it('lays out answers delegate by delegate with who has not submitted', () => {
    const doc = responsesDocument({
      ...base,
      eyebrow: 'Daily Learning Reflections',
      title: 'Daily Learning Reflections',
      lead: 'Every reflection.',
      figures: [{ value: '1', label: 'Reflections submitted' }],
      groups: [
        {
          heading: '23 Nov 2026 · Day 1 reflection',
          summary: '1 of 2 delegates submitted (50%).',
          respondents: [
            {
              delegate: { name: 'Dee Manager', attendanceFormat: 'physical' },
              extra: ['Submitted 23 Nov 2026, 16:00'],
              rows: [
                { question: 'What stood out today?', answer: 'The transfer plan.' },
                { question: 'What will you try?', answer: '' },
              ],
            },
          ],
          after: 'Not submitted (1): Ada Lead.',
        },
      ],
    });
    const text = blocksText(doc.blocks);
    expect(text).toContain('23 Nov 2026 · Day 1 reflection');
    expect(text).toContain('Dee Manager\nIn person · Submitted 23 Nov 2026, 16:00');
    expect(text).toContain('Q1 What stood out today?: The transfer plan.');
    expect(text).toContain('Q2 What will you try?: No answer');
    expect(text).toContain('Not submitted (1): Ada Lead.');
    expect(doc.meta.footnote).toMatch(/personal data/);
  });

  it('lays out a register as a table per section, or says it is empty', () => {
    const doc = tableDocument({
      ...base,
      eyebrow: 'Attendance register',
      title: 'Attendance',
      lead: 'Who attended.',
      figures: [{ value: '2', label: 'Registered delegates' }],
      sections: [
        {
          heading: '23 Nov 2026',
          header: ['Delegate', 'Status'],
          rows: [['Dee Manager', 'Attended']],
        },
        { heading: '24 Nov 2026', header: ['Delegate', 'Status'], rows: [], empty: 'Nobody.' },
      ],
    });
    const text = blocksText(doc.blocks);
    expect(text).toContain('Delegate | Status\nDee Manager | Attended');
    expect(text).toContain('Nobody.');
    expect(doc.blocks.filter((b) => b.kind === 'pagebreak')).toHaveLength(1);
  });
});

describe('a document of every batch', () => {
  it('reads batch by batch, each opening with its name and count, then by name', () => {
    const answerOf = () => ({ value: 'Yes', correct: null });
    const person = (name: string, batch?: string) => ({
      delegate: {
        name,
        attendanceFormat: 'physical' as const,
        ...(batch ? { batch: { name: batch } } : {}),
      },
      submittedAt: AT,
      answerOf,
    });
    const doc = assessmentDocument({
      ...base,
      title: 'Programme Evaluation',
      sections: [],
      questions: [question('a', { prompt: 'Useful?' })],
      invited: null,
      batchOrder: ['Batch 1', 'Batch 2'],
      responses: [
        person('Zed', 'Batch 2'),
        person('Ann', 'Batch 2'),
        person('Bo', 'Batch 1'),
        person('Cy'),
      ],
    });
    const order = doc.blocks
      .filter((b) => b.kind === 'heading' || b.kind === 'respondent')
      .map((b) => (b.kind === 'respondent' ? b.name : blocksText([b])));
    expect(order).toEqual(['Batch 1', 'Bo', 'Batch 2', 'Ann', 'Zed', 'Every day (no batch)', 'Cy']);
    expect(blocksText(doc.blocks)).toContain('2 submissions.');
    expect(doc.blocks.filter((b) => b.kind === 'pagebreak')).toHaveLength(2);
  });
});
