import {
  actionProgressLabels,
  askedQuestionIds,
  commitmentStatuses,
  describeAnswer,
  feedbackRatingLabels,
  measureStatusLabels,
  planActionFieldLabels,
  reminderFrequencyLabels,
  templateActions,
  transferPlanStatusLabels,
  type AssessmentQuestionView,
  type ChecklistTemplate,
  type CommitmentStatus,
  type PlanChecklist,
  type TransferPlanView,
} from '@mbc/shared';
import type { Response } from 'express';

import type { Block, DocumentMeta, Fact } from './blocks.js';
import { toDocx } from './docx.js';
import { toPdf } from './pdf.js';

/**
 * Submissions as documents (task of 2026-11-21): every assessment, the session feedback and the
 * Transfer Plans can be downloaded as a designed PDF or Word document that a host reads from
 * front to back. A cover says what it is and for which event; a row of figures gives the
 * totals; then one block per delegate, in name order: their name and who they are, then every
 * question exactly as it was asked with their answer under it. A question they skipped says
 * "No answer"; one they were never asked (another format's section, a follow-up question whose
 * condition was not met) is left out. The builders here are pure: the routes load the records
 * and choose who may download; these only lay them out, once for both formats.
 */

export const documentFormats = ['pdf', 'docx'] as const;
export type DocumentFormat = (typeof documentFormats)[number];
export const isDocumentFormat = (value: string): value is DocumentFormat =>
  (documentFormats as readonly string[]).includes(value);

const MEDIA: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Every page of these documents names delegates. */
export const PERSONAL_DATA = 'Confidential: contains personal data';

/** Writes the blocks in the asked format and sends them as a download. */
export async function sendDocument(
  res: Response,
  format: DocumentFormat,
  blocks: readonly Block[],
  meta: DocumentMeta,
  name: string,
) {
  const body = format === 'pdf' ? await toPdf(blocks, meta) : await toDocx(blocks, meta);
  res.setHeader('Content-Type', MEDIA[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${fileNameOf(name)}.${format}"`);
  res.send(body);
}

/** A file name from words: lower case, hyphens, nothing a browser or a disk would refuse. */
export const fileNameOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'submissions';

/** "10 Nov 2026, 14:32" in the event's time zone. */
export function whenIn(at: Date | string | null | undefined, timezone: string): string {
  if (!at) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(at));
}

/** "10 Nov 2026" for a calendar day (YYYY-MM-DD or a date at UTC midnight). */
export function dayOf(value: Date | string | null | undefined): string {
  if (!value) return '';
  const iso = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00.000Z`));
}

export interface RespondentDelegate {
  name: string;
  jobTitle?: string | null;
  organisation?: string | null;
  department?: string | null;
  batch?: { name: string } | null;
  attendanceFormat: 'physical' | 'virtual';
}

/** Who the delegate is, in one line: role and organisation, department, batch, format. */
export function detailsOf(d: RespondentDelegate, ...extra: string[]): string {
  const role = [d.jobTitle?.trim(), d.organisation?.trim()].filter(Boolean).join(', ');
  return [
    role,
    d.department?.trim(),
    d.batch?.name,
    d.attendanceFormat === 'virtual' ? 'Online' : 'In person',
    ...extra,
  ]
    .filter(Boolean)
    .join(' · ');
}

const byName = <T extends { delegate: { name: string } }>(a: T, b: T) =>
  a.delegate.name.localeCompare(b.delegate.name, 'en', { sensitivity: 'base' });

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';

interface CoverInput {
  /** The one batch the document covers (2026-11-22); absent for every delegate. */
  batch?: string | null;
  eyebrow: string;
  title: string;
  lead: string;
  eventName: string;
  timezone: string;
  generatedAt: Date;
  facts?: Fact[];
}

function coverOf(c: CoverInput): Block {
  return {
    kind: 'cover',
    eyebrow: c.eyebrow,
    title: c.title,
    lead: c.lead,
    facts: [
      { label: 'Event', value: c.eventName },
      { label: 'Generated', value: `${whenIn(c.generatedAt, c.timezone)} (${c.timezone})` },
      ...(c.batch ? [{ label: 'Batch', value: c.batch }] : []),
      ...(c.facts ?? []),
    ],
  };
}

const READING_NOTE =
  'Delegates appear in alphabetical order. Each question is printed exactly as it was asked, with the answer beside it. "No answer" means the delegate was asked and left it blank; a question they were never asked is left out.';

// ------------------------------------------------------------------ assessments

export interface AssessmentDocumentInput {
  organiser: string;
  /** The one batch it covers (2026-11-22). */
  batch?: string | null;
  eventName: string;
  timezone: string;
  generatedAt: Date;
  /** The assessment's name as delegates saw it. */
  title: string;
  sections: ReadonlyArray<{
    id: string;
    title: string;
    audience: 'all' | 'physical' | 'virtual';
  }>;
  /** The active questions in the delegate's order. */
  questions: readonly AssessmentQuestionView[];
  /** Delegates registered and in scope, for the response rate; null when unknown. */
  invited: number | null;
  responses: ReadonlyArray<{
    delegate: RespondentDelegate;
    submittedAt: Date | null;
    answerOf: (
      question: AssessmentQuestionView,
    ) => { value: unknown; correct: boolean | null } | undefined;
  }>;
}

/** The answer as words, with a rating's end labels where the scale names them. */
function assessmentAnswer(q: AssessmentQuestionView, value: unknown): string {
  const text = describeAnswer(q, value);
  if (q.type === 'rating' && q.scale && text !== '') {
    const n = Number(value);
    const label =
      n === q.scale.min ? q.scale.minLabel : n === q.scale.max ? q.scale.maxLabel : null;
    return `${text} of ${q.scale.max}${label ? ` (${label})` : ''}`;
  }
  return text;
}

export function assessmentDocument(input: AssessmentDocumentInput): {
  blocks: Block[];
  meta: DocumentMeta;
} {
  const responses = [...input.responses].sort(byName);
  const knowledge = input.questions.filter((q) => q.isKnowledge);
  const groups = [
    { section: null, questions: input.questions.filter((q) => !q.sectionId) },
    ...input.sections.map((section) => ({
      section,
      questions: input.questions.filter((q) => q.sectionId === section.id),
    })),
  ].filter((g) => g.questions.length > 0);
  const labelled = groups.length > 1 || groups[0]?.section !== null;

  const marks = responses
    .map((r) => {
      const answered = knowledge.filter((q) => r.answerOf(q) !== undefined);
      if (answered.length === 0) return null;
      return knowledge.filter((q) => r.answerOf(q)?.correct).length / knowledge.length;
    })
    .filter((m): m is number => m !== null);

  const blocks: Block[] = [
    coverOf({
      batch: input.batch,
      eyebrow: 'Assessment submissions',
      title: input.title,
      lead: 'Every submitted response, delegate by delegate, with each question and its answer.',
      eventName: input.eventName,
      timezone: input.timezone,
      generatedAt: input.generatedAt,
      facts: [
        { label: 'Questions', value: String(input.questions.length) },
        { label: 'Submissions', value: String(responses.length) },
      ],
    }),
    {
      kind: 'figures',
      items: [
        { value: String(responses.length), label: 'Submitted responses' },
        ...(input.invited !== null
          ? [
              {
                value: percent(responses.length, input.invited),
                label: `Response rate, of ${input.invited} delegates in scope`,
              },
            ]
          : []),
        ...(knowledge.length && marks.length
          ? [
              {
                value: `${Math.round((marks.reduce((a, b) => a + b, 0) / marks.length) * 100)}%`,
                label: `Average knowledge mark over ${knowledge.length} question${knowledge.length === 1 ? '' : 's'}`,
              },
            ]
          : [{ value: String(input.questions.length), label: 'Questions asked' }]),
      ],
    },
    { kind: 'paragraph', spans: [{ text: READING_NOTE, italic: true }] },
  ];
  if (responses.length === 0) {
    blocks.push({ kind: 'paragraph', spans: [{ text: 'No response has been submitted yet.' }] });
  }

  for (const r of responses) {
    blocks.push({
      kind: 'respondent',
      name: r.delegate.name,
      details: detailsOf(r.delegate, `Submitted ${whenIn(r.submittedAt, input.timezone)}`),
    });
    const asked = askedQuestionIds(input.questions, (id) => {
      const q = input.questions.find((x) => x.id === id);
      return q ? r.answerOf(q)?.value : undefined;
    });
    let number = 0;
    for (const group of groups) {
      const shown = group.section?.audience;
      if (shown && shown !== 'all' && shown !== r.delegate.attendanceFormat) continue;
      const questions = group.questions.filter((q) => asked.has(q.id));
      if (questions.length === 0) continue;
      if (labelled) {
        const inGroup = questions.filter((q) => q.isKnowledge);
        const correct = inGroup.filter((q) => r.answerOf(q)?.correct).length;
        const mark = inGroup.length
          ? ` · ${correct} of ${inGroup.length} (${percent(correct, inGroup.length)})`
          : '';
        blocks.push({ kind: 'label', text: `${group.section?.title ?? 'General'}${mark}` });
      }
      for (const q of questions) {
        number += 1;
        const answer = r.answerOf(q);
        const text = answer ? assessmentAnswer(q, answer.value) : '';
        blocks.push({
          kind: 'qa',
          number: `Q${number}`,
          question: q.prompt,
          answer: text,
          empty: text.trim() === '',
          ...(q.isKnowledge && answer && text !== ''
            ? { mark: answer.correct ? ('correct' as const) : ('incorrect' as const) }
            : {}),
        });
      }
    }
  }
  return {
    blocks,
    meta: {
      title: `${input.title}: submissions`,
      organiser: input.organiser,
      subtitle: input.eventName,
      footnote: PERSONAL_DATA,
    },
  };
}

// ------------------------------------------------------------------ session feedback

export interface FeedbackDocumentInput {
  organiser: string;
  /** The one batch it covers (2026-11-22). */
  batch?: string | null;
  eventName: string;
  timezone: string;
  generatedAt: Date;
  /** The event's questions in order; an answer to a retired question still prints after them. */
  questions: ReadonlyArray<{ questionKey: string; prompt: string; type: 'rating' | 'long_text' }>;
  sessions: ReadonlyArray<{
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    speaker: string | null;
    attended: number;
    responses: ReadonlyArray<{
      delegate: RespondentDelegate;
      submittedAt: Date;
      answers: ReadonlyArray<{
        questionKey: string;
        prompt: string;
        type: 'rating' | 'long_text';
        value: string;
      }>;
    }>;
  }>;
}

const feedbackAnswer = (type: 'rating' | 'long_text', value: string) =>
  type === 'rating'
    ? (feedbackRatingLabels[value as keyof typeof feedbackRatingLabels] ?? value)
    : value;

export function feedbackDocument(input: FeedbackDocumentInput): {
  blocks: Block[];
  meta: DocumentMeta;
} {
  const total = input.sessions.reduce((n, s) => n + s.responses.length, 0);
  const one = input.sessions.length === 1 ? input.sessions[0] : null;
  const blocks: Block[] = [
    coverOf({
      batch: input.batch,
      eyebrow: 'Session feedback',
      title: one ? one.title : 'Session feedback by session',
      lead: 'Every feedback response, session by session and delegate by delegate, with each question and its answer.',
      eventName: input.eventName,
      timezone: input.timezone,
      generatedAt: input.generatedAt,
      facts: one
        ? [
            { label: 'Session', value: `${dayOf(one.date)}, ${one.startTime} to ${one.endTime}` },
            ...(one.speaker ? [{ label: 'Speaker or facilitator', value: one.speaker }] : []),
          ]
        : [{ label: 'Sessions', value: String(input.sessions.length) }],
    }),
    {
      kind: 'figures',
      items: [
        { value: String(total), label: 'Feedback responses' },
        { value: String(input.sessions.length), label: 'Sessions in this document' },
        { value: String(input.questions.length), label: 'Questions on the form' },
      ],
    },
    { kind: 'paragraph', spans: [{ text: READING_NOTE, italic: true }] },
  ];

  input.sessions.forEach((session, index) => {
    if (!one) {
      if (index > 0) blocks.push({ kind: 'pagebreak' });
      blocks.push({
        kind: 'heading',
        level: 2,
        spans: [{ text: `${dayOf(session.date)} · ${session.title}` }],
      });
      blocks.push({
        kind: 'paragraph',
        spans: [
          {
            text: `${session.startTime} to ${session.endTime}${session.speaker ? ` · ${session.speaker}` : ''} · ${session.responses.length} response${session.responses.length === 1 ? '' : 's'} from ${session.attended} delegates recorded that day.`,
          },
        ],
      });
    }
    if (session.responses.length === 0) {
      blocks.push({
        kind: 'paragraph',
        spans: [{ text: 'No feedback has been submitted for this session yet.', italic: true }],
      });
      return;
    }
    for (const r of [...session.responses].sort(byName)) {
      blocks.push({
        kind: 'respondent',
        name: r.delegate.name,
        details: detailsOf(r.delegate, `Submitted ${whenIn(r.submittedAt, input.timezone)}`),
      });
      const byKey = new Map(r.answers.map((a) => [a.questionKey, a]));
      const rows = [
        ...input.questions.map((q) => ({
          prompt: q.prompt,
          type: q.type,
          answer: byKey.get(q.questionKey),
        })),
        ...r.answers
          .filter((a) => !input.questions.some((q) => q.questionKey === a.questionKey))
          .map((a) => ({ prompt: a.prompt, type: a.type, answer: a })),
      ];
      rows.forEach((row, i) => {
        const text = row.answer ? feedbackAnswer(row.type, row.answer.value) : '';
        blocks.push({
          kind: 'qa',
          number: `Q${i + 1}`,
          question: row.prompt,
          answer: text,
          empty: text.trim() === '',
        });
      });
    }
  });
  return {
    blocks,
    meta: {
      title: one ? `${one.title}: feedback` : 'Session feedback',
      organiser: input.organiser,
      subtitle: input.eventName,
      footnote: PERSONAL_DATA,
    },
  };
}

// ------------------------------------------------------------------ Transfer Plans

export interface PlanDocumentInput {
  organiser: string;
  /** The one batch it covers (2026-11-22). */
  batch?: string | null;
  eventName: string;
  timezone: string;
  generatedAt: Date;
  mode: 'full' | 'commitment';
  template: ChecklistTemplate;
  /** Drafts included too. */
  includesDrafts: boolean;
  plans: ReadonlyArray<{ delegate: RespondentDelegate; plan: TransferPlanView }>;
}

const FIELD_ORDER = [
  'title',
  'priorityLearning',
  'action',
  'opportunity',
  'firstStep',
  'startOn',
  'targetOn',
  'stakeholders',
  'support',
  'barriers',
  'evidence',
  'expectedResult',
  'measure',
  'baseline',
  'reviewOn',
  'measureStatus',
] as const;
const DATE_FIELDS = new Set(['startOn', 'targetOn', 'reviewOn']);

type Action = TransferPlanView['actions'][number];

function reminderText(a: Action): string {
  const r = a.reminder;
  if (r.frequency === 'none') return 'No reminders';
  if (r.frequency === 'once') return `Once, on ${dayOf(r.startOn)} at ${r.time}`;
  const window = [
    r.startOn ? `from ${dayOf(r.startOn)}` : '',
    r.endOn ? `until ${dayOf(r.endOn)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${reminderFrequencyLabels[r.frequency]}, at ${r.time}${window ? `, ${window}` : ''}`;
}

function progressText(
  p: Action['progress'][number],
  statusLabel: (status: string) => string,
): string {
  return [
    `${statusLabel(p.status)}${p.occurredOn ? `, on ${dayOf(p.occurredOn)}` : ''}`,
    p.note?.trim() ?? '',
    p.evidence?.trim() ? `Evidence: ${p.evidence.trim()}` : '',
    p.results?.trim() ? `Results: ${p.results.trim()}` : '',
    p.challenges?.trim() ? `Challenges: ${p.challenges.trim()}` : '',
    p.newTargetOn ? `New target date: ${dayOf(p.newTargetOn)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function planDocument(input: PlanDocumentInput): { blocks: Block[]; meta: DocumentMeta } {
  const commitment = input.mode === 'commitment';
  const name = commitment ? input.template.title : 'Transfer Plans';
  const plans = [...input.plans].sort(byName);
  const actions = plans.flatMap((p) => p.plan.actions);
  const applied = actions.filter((a) =>
    ['applied', 'applied_consistently', 'completed'].includes(a.progressStatus),
  ).length;
  const statusLabel = (status: string) =>
    commitment && (commitmentStatuses as readonly string[]).includes(status)
      ? input.template.followUp.statusLabels[status as CommitmentStatus]
      : (actionProgressLabels[status as keyof typeof actionProgressLabels] ?? status);

  const blocks: Block[] = [
    coverOf({
      batch: input.batch,
      eyebrow: commitment ? 'Checklists and commitments' : 'Transfer Plan submissions',
      title: name,
      lead: commitment
        ? 'Every saved checklist and commitment, delegate by delegate: the training named, the actions ticked, the commitment and each follow-up update.'
        : 'Every submitted Transfer Plan, delegate by delegate: each planned action with all its answers, its reminder and what each follow-up recorded.',
      eventName: input.eventName,
      timezone: input.timezone,
      generatedAt: input.generatedAt,
      facts: [
        {
          label: 'Plans included',
          value: input.includesDrafts
            ? 'Submitted, completed and drafts'
            : 'Submitted and completed',
        },
      ],
    }),
    {
      kind: 'figures',
      items: [
        { value: String(plans.length), label: commitment ? 'Commitments saved' : 'Plans' },
        ...(commitment ? [] : [{ value: String(actions.length), label: 'Planned actions' }]),
        {
          value: String(applied),
          label: commitment ? 'Reported done' : 'Actions applied or completed',
        },
      ],
    },
    { kind: 'paragraph', spans: [{ text: READING_NOTE, italic: true }] },
  ];
  if (plans.length === 0) {
    blocks.push({ kind: 'paragraph', spans: [{ text: 'No plan has been submitted yet.' }] });
  }

  for (const { delegate, plan } of plans) {
    blocks.push({
      kind: 'respondent',
      name: delegate.name,
      details: detailsOf(
        delegate,
        // "Submitted 13 Nov 2026" says the status itself; another status is named first.
        ...(plan.status === 'submitted' ? [] : [transferPlanStatusLabels[plan.status]]),
        plan.submittedAt
          ? `Submitted ${whenIn(plan.submittedAt, input.timezone)}`
          : 'Not submitted',
      ),
    });

    if (commitment) {
      const t = input.template;
      const checklist = (plan.checklist ?? null) as PlanChecklist | null;
      const all = templateActions(t);
      const ticked = all.filter((a) => checklist?.ticked.includes(a.key));
      const committed = all.find((a) => a.key === checklist?.commitmentKey);
      const action = plan.actions[0];
      const rows: Array<{ question: string; answer: string }> = [
        { question: t.trainingNameLabel, answer: plan.trainingName ?? '' },
        { question: t.tickHeading, answer: ticked.map((a) => `• ${a.text}`).join('\n') },
        { question: t.commitment.chooseLabel, answer: committed?.text ?? '' },
        { question: t.commitment.whatLabel, answer: action?.action ?? '' },
        { question: t.commitment.whenLabel, answer: dayOf(action?.targetOn) },
        { question: t.commitment.evidenceLabel, answer: action?.evidence ?? '' },
        {
          question: t.commitment.reminderPrompt,
          answer: action
            ? action.reminder.frequency === 'none'
              ? 'No'
              : `Yes, on ${dayOf(action.reminder.startOn)}`
            : '',
        },
      ];
      blocks.push({ kind: 'label', text: 'Checklist and commitment' });
      rows.forEach((row, i) =>
        blocks.push({
          kind: 'qa',
          number: `Q${i + 1}`,
          question: row.question,
          answer: row.answer,
          empty: row.answer.trim() === '',
        }),
      );
      const updates = (action?.progress ?? []).filter((p) => p.wave !== null);
      if (updates.length) {
        blocks.push({ kind: 'label', text: 'Follow-up updates' });
        [...updates].reverse().forEach((p, i) =>
          blocks.push({
            kind: 'qa',
            number: `F${i + 1}`,
            question: `${p.waveLabel || 'Follow-up'}: ${t.followUp.statusPrompt}`,
            answer: progressText(p, statusLabel),
          }),
        );
      }
      continue;
    }

    if (plan.actions.length === 0) {
      blocks.push({ kind: 'paragraph', spans: [{ text: 'No action written yet.', italic: true }] });
      continue;
    }
    plan.actions.forEach((a, index) => {
      const n = index + 1;
      blocks.push({
        kind: 'label',
        text: `Action ${n}: ${a.title.trim() || a.action.trim() || 'Untitled'}${a.isPriority ? ' (first priority)' : ''}`,
      });
      let q = 0;
      for (const field of FIELD_ORDER) {
        q += 1;
        const raw = a[field];
        const answer =
          field === 'measureStatus'
            ? raw
              ? measureStatusLabels[raw as keyof typeof measureStatusLabels]
              : ''
            : DATE_FIELDS.has(field)
              ? dayOf(raw as string | null)
              : String(raw ?? '');
        blocks.push({
          kind: 'qa',
          number: `${n}.${q}`,
          question: planActionFieldLabels[field].label,
          answer,
          empty: answer.trim() === '',
        });
      }
      blocks.push({
        kind: 'qa',
        number: `${n}.${(q += 1)}`,
        question: 'Reminder',
        answer: reminderText(a),
      });
      if (a.measures.length) {
        blocks.push({
          kind: 'qa',
          number: `${n}.${(q += 1)}`,
          question: 'Business measures',
          answer: a.measures
            .map((m) => {
              const unit = m.unit ? ` ${m.unit}` : '';
              const parts = [
                m.baselineValue ? `baseline ${m.baselineValue}${unit}` : '',
                m.targetValue ? `target ${m.targetValue}${unit}` : '',
                m.actualValue ? `actual ${m.actualValue}${unit}` : '',
              ].filter(Boolean);
              return `• ${m.name}${parts.length ? `: ${parts.join(', ')}` : ''}`;
            })
            .join('\n'),
        });
      }
      if (a.evidenceRecords.length) {
        blocks.push({
          kind: 'qa',
          number: `${n}.${(q += 1)}`,
          question: 'Evidence of application',
          answer: a.evidenceRecords.map((e) => `• ${e.description}`).join('\n'),
        });
      }
      const updates = a.progress.filter((p) => p.wave !== null);
      [...updates].reverse().forEach((p) =>
        blocks.push({
          kind: 'qa',
          number: `${n}.${(q += 1)}`,
          question: `${p.waveLabel || 'Follow-up'}: where the action stands`,
          answer: progressText(p, statusLabel),
        }),
      );
    });
  }
  return {
    blocks,
    meta: {
      title: `${name}: submissions`,
      organiser: input.organiser,
      subtitle: input.eventName,
      footnote: PERSONAL_DATA,
    },
  };
}

// ------------------------------------------------------------------ generic layouts

interface DocumentHead {
  organiser: string;
  /** The one batch it covers (2026-11-22). */
  batch?: string | null;
  eventName: string;
  timezone: string;
  generatedAt: Date;
  /** What kind of record it is, above the title on the cover. */
  eyebrow: string;
  title: string;
  lead: string;
  facts?: Fact[];
  figures: Array<{ value: string; label: string }>;
}

export interface ResponsesDocumentInput extends DocumentHead {
  /** One group per day, status or other split; each opens a new page after the first. */
  groups: ReadonlyArray<{
    heading?: string;
    summary?: string;
    /** Said when the group has no respondent. */
    empty?: string;
    respondents: ReadonlyArray<{
      delegate: RespondentDelegate;
      /** What follows "who they are" in the band: a date, a kind, a status. */
      extra: string[];
      rows: ReadonlyArray<{ question: string; answer: string }>;
    }>;
    /** A closing line, e.g. who has not submitted. */
    after?: string;
  }>;
}

/**
 * Answers delegate by delegate (2026-11-21): the layout of the reflections and the support
 * requests, the same cover, figures, delegate band and question-answer rows as the others.
 */
export function responsesDocument(input: ResponsesDocumentInput): {
  blocks: Block[];
  meta: DocumentMeta;
} {
  const blocks: Block[] = [
    coverOf(input),
    { kind: 'figures', items: input.figures },
    { kind: 'paragraph', spans: [{ text: READING_NOTE, italic: true }] },
  ];
  input.groups.forEach((group, index) => {
    if (group.heading) {
      if (index > 0) blocks.push({ kind: 'pagebreak' });
      blocks.push({ kind: 'heading', level: 2, spans: [{ text: group.heading }] });
    }
    if (group.summary) blocks.push({ kind: 'paragraph', spans: [{ text: group.summary }] });
    if (group.respondents.length === 0 && group.empty) {
      blocks.push({ kind: 'paragraph', spans: [{ text: group.empty, italic: true }] });
    }
    for (const r of [...group.respondents].sort(byName)) {
      blocks.push({
        kind: 'respondent',
        name: r.delegate.name,
        details: detailsOf(r.delegate, ...r.extra),
      });
      r.rows.forEach((row, i) =>
        blocks.push({
          kind: 'qa',
          number: `Q${i + 1}`,
          question: row.question,
          answer: row.answer,
          empty: row.answer.trim() === '',
        }),
      );
    }
    if (group.after)
      blocks.push({ kind: 'paragraph', spans: [{ text: group.after, italic: true }] });
  });
  return {
    blocks,
    meta: {
      title: input.title,
      organiser: input.organiser,
      subtitle: input.eventName,
      footnote: PERSONAL_DATA,
    },
  };
}

export interface TableDocumentInput extends DocumentHead {
  sections: ReadonlyArray<{
    heading?: string;
    summary?: string;
    header: string[];
    rows: string[][];
    empty?: string;
  }>;
}

/** A register as tables (2026-11-21): the attendance by date and the delegate list. */
export function tableDocument(input: TableDocumentInput): { blocks: Block[]; meta: DocumentMeta } {
  const blocks: Block[] = [coverOf(input), { kind: 'figures', items: input.figures }];
  input.sections.forEach((section, index) => {
    if (section.heading) {
      if (index > 0) blocks.push({ kind: 'pagebreak' });
      blocks.push({ kind: 'heading', level: 2, spans: [{ text: section.heading }] });
    }
    if (section.summary) blocks.push({ kind: 'paragraph', spans: [{ text: section.summary }] });
    if (section.rows.length) {
      blocks.push({ kind: 'table', header: section.header, rows: section.rows });
    } else if (section.empty) {
      blocks.push({ kind: 'paragraph', spans: [{ text: section.empty, italic: true }] });
    }
  });
  return {
    blocks,
    meta: {
      title: input.title,
      organiser: input.organiser,
      subtitle: input.eventName,
      footnote: PERSONAL_DATA,
    },
  };
}
