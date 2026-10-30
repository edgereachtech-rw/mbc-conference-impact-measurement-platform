'use client';

import {
  choiceTypes,
  groupQuestions,
  questionFieldsSchema,
  questionTypeLabels,
  questionTypes,
  sectionFieldsSchema,
  type AssessmentQuestionView,
  type AssessmentSectionView,
  type AssessmentStage,
  type QuestionType,
} from '@mbc/shared';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderPlusIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { consoleButton, StatePanel, StatusPill } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { stageAreas, stageLabels } from '@/lib/events';
import { describeError } from '@/lib/imports';

interface QuestionBuilderProps {
  eventId: string;
  stage: AssessmentStage;
  readOnly?: boolean;
  /** Called after any change so the owner can refresh the event's question counts. */
  onChanged: () => void;
}

interface Draft {
  prompt: string;
  helpText: string;
  type: QuestionType;
  required: boolean;
  area: string;
  sectionId: string;
  /** One option per line: "label" or "value | label". */
  optionsText: string;
  scaleMin: string;
  scaleMax: string;
  minLabel: string;
  maxLabel: string;
}

interface Lists {
  sections: AssessmentSectionView[];
  questions: AssessmentQuestionView[];
}

const EMPTY: Draft = {
  prompt: '',
  helpText: '',
  type: 'rating',
  required: true,
  area: '',
  sectionId: '',
  optionsText: '',
  scaleMin: '1',
  scaleMax: '5',
  minLabel: '',
  maxLabel: '',
};

/** Starting points per stage, one per measurement area of the brief; the admin edits freely. */
export const SUGGESTIONS: Record<
  AssessmentStage,
  Array<{ area: string; prompt: string; type: QuestionType }>
> = {
  pre_conference: [
    {
      area: 'Existing knowledge and understanding',
      prompt: 'How would you rate your current knowledge of training transfer?',
      type: 'rating',
    },
    {
      area: 'Current confidence level',
      prompt: 'How confident are you in applying what you learn at work?',
      type: 'rating',
    },
    {
      area: 'Expectations and learning objectives',
      prompt: 'What do you most want to learn or gain from this event?',
      type: 'long_text',
    },
    {
      area: 'Relevant professional experience',
      prompt: 'How many years have you worked in learning, HR or a related field?',
      type: 'number',
    },
    {
      area: 'Existing challenges related to the subject',
      prompt: 'What is the biggest challenge you face in turning training into results?',
      type: 'long_text',
    },
  ],
  during_conference: [
    {
      area: 'Knowledge gained',
      prompt: 'How much new knowledge have you gained so far?',
      type: 'rating',
    },
    {
      area: 'Changes in confidence',
      prompt: 'How confident do you feel now about applying what you have learned?',
      type: 'rating',
    },
    {
      area: 'Session relevance and usefulness',
      prompt: 'How relevant has the content been to your work?',
      type: 'rating',
    },
    {
      area: 'Participant engagement',
      prompt: 'Which sessions have you taken part in today?',
      type: 'short_text',
    },
    {
      area: 'Session feedback and satisfaction',
      prompt: 'What would make the next day more useful for you?',
      type: 'long_text',
    },
  ],
  follow_up: [
    {
      area: 'Knowledge retention',
      prompt: 'How much of what you learned do you still use?',
      type: 'rating',
    },
    {
      area: 'Application of learning at work',
      prompt: 'Have you applied what you learned at work?',
      type: 'yes_no',
    },
    {
      area: 'Changes in professional practice',
      prompt: 'What have you done differently since the event?',
      type: 'long_text',
    },
    { area: 'Outcomes achieved', prompt: 'What results have you seen so far?', type: 'long_text' },
    {
      area: 'Challenges encountered',
      prompt: 'What has got in the way of applying your learning?',
      type: 'long_text',
    },
    {
      area: 'Organisational benefits and impact',
      prompt: 'Has your organisation benefited from what you applied?',
      type: 'yes_no',
    },
  ],
};

function draftOf(q: AssessmentQuestionView | null, sectionId = ''): Draft {
  if (!q) return { ...EMPTY, sectionId };
  return {
    prompt: q.prompt,
    helpText: q.helpText ?? '',
    type: q.type,
    required: q.required,
    area: q.area ?? '',
    sectionId: q.sectionId ?? '',
    optionsText: (q.options ?? [])
      .map((o) => (o.value === o.label ? o.label : `${o.value} | ${o.label}`))
      .join('\n'),
    scaleMin: String(q.scale?.min ?? 1),
    scaleMax: String(q.scale?.max ?? 5),
    minLabel: q.scale?.minLabel ?? '',
    maxLabel: q.scale?.maxLabel ?? '',
  };
}

/** "value | label" lines or plain labels into options; the value defaults to the label. */
export function parseOptions(text: string): Array<{ value: string; label: string }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, label] = line.split('|').map((s) => s.trim());
      return label ? { value: value!, label } : { value: line, label: line };
    });
}

export function payloadOf(draft: Draft) {
  const isChoice = choiceTypes.includes(draft.type);
  return {
    prompt: draft.prompt,
    helpText: draft.helpText,
    type: draft.type,
    required: draft.required,
    area: draft.area,
    ...(isChoice ? { options: parseOptions(draft.optionsText) } : {}),
    ...(draft.type === 'rating'
      ? {
          scale: {
            min: Number(draft.scaleMin),
            max: Number(draft.scaleMax),
            minLabel: draft.minLabel,
            maxLabel: draft.maxLabel,
          },
        }
      : {}),
  };
}

/**
 * The questions of one assessment stage (every enabled stage needs at least one), grouped into
 * sections that delegates see one step at a time. Sections and questions can be added, edited,
 * moved and deleted; edits to an answered question become a new version on the server.
 */
export function QuestionBuilder({
  eventId,
  stage,
  readOnly = false,
  onChanged,
}: QuestionBuilderProps) {
  const base = `/events/${eventId}/assessments/${stage}`;
  const [lists, setLists] = useState<Lists | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<null | { id: string | null; draft: Draft }>(null);
  const [sectionEditing, setSectionEditing] = useState<null | {
    id: string | null;
    title: string;
    description: string;
  }>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    apiFetch<Lists>(`${base}/questions`).then(
      (result) => {
        if (!cancelled) {
          setLists({ sections: result.sections, questions: result.questions });
          setLoadError(null);
        }
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(describeError(e, 'The questions could not be loaded.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base, attempt]);

  function apply(result: Partial<Lists>) {
    setLists((current) => ({
      sections: result.sections ?? current?.sections ?? [],
      questions: result.questions ?? current?.questions ?? [],
    }));
    onChanged();
  }
  async function run(work: () => Promise<Partial<Lists>>, fallback: string) {
    setBusy(true);
    setFailure(null);
    try {
      apply(await work());
      return true;
    } catch (e) {
      setFailure(describeError(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [key]: value } } : e));
    setErrors((errs) => {
      if (!errs[key]) return errs;
      const copy = { ...errs };
      delete copy[key];
      return copy;
    });
  }

  async function saveQuestion() {
    if (!editing) return;
    const payload = payloadOf(editing.draft);
    const parsed = questionFieldsSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key === 'options' ? 'optionsText' : key === 'scale' ? 'scaleMax' : key] ??=
          issue.message;
      }
      setErrors(next);
      return;
    }
    const body = { ...parsed.data, sectionId: editing.draft.sectionId || null };
    const ok = await run(
      () =>
        apiFetch<Lists>(editing.id ? `${base}/questions/${editing.id}` : `${base}/questions`, {
          method: editing.id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        }),
      'The question could not be saved.',
    );
    if (ok) setEditing(null);
  }
  async function removeQuestion(questionId: string) {
    const ok = await run(
      () => apiFetch<Lists>(`${base}/questions/${questionId}`, { method: 'DELETE' }),
      'The question could not be deleted.',
    );
    if (ok) setConfirmDelete(null);
  }
  async function moveQuestion(
    groupQuestions: AssessmentQuestionView[],
    index: number,
    delta: number,
  ) {
    if (!lists) return;
    const target = index + delta;
    if (target < 0 || target >= groupQuestions.length) return;
    // Swap the two within their group; the global order list keeps every other question in place.
    const ids = lists.questions.map((q) => q.id);
    const a = ids.indexOf(groupQuestions[index]!.id);
    const b = ids.indexOf(groupQuestions[target]!.id);
    [ids[a], ids[b]] = [ids[b]!, ids[a]!];
    await run(
      () =>
        apiFetch<Lists>(`${base}/questions/order`, {
          method: 'PUT',
          body: JSON.stringify({ questionIds: ids }),
        }),
      'The order could not be saved.',
    );
  }

  async function saveSection() {
    if (!sectionEditing) return;
    const parsed = sectionFieldsSchema.safeParse({
      title: sectionEditing.title,
      description: sectionEditing.description,
    });
    if (!parsed.success) {
      setErrors({ sectionTitle: parsed.error.issues[0]?.message ?? 'Give the section a title' });
      return;
    }
    const ok = await run(
      () =>
        apiFetch<Lists>(
          sectionEditing.id ? `${base}/sections/${sectionEditing.id}` : `${base}/sections`,
          { method: sectionEditing.id ? 'PATCH' : 'POST', body: JSON.stringify(parsed.data) },
        ),
      'The section could not be saved.',
    );
    if (ok) setSectionEditing(null);
  }
  async function removeSection(sectionId: string) {
    const ok = await run(
      () => apiFetch<Lists>(`${base}/sections/${sectionId}`, { method: 'DELETE' }),
      'The section could not be deleted.',
    );
    if (ok) setConfirmDelete(null);
  }
  async function moveSection(index: number, delta: number) {
    if (!lists) return;
    const ids = lists.sections.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await run(
      () =>
        apiFetch<Lists>(`${base}/sections/order`, {
          method: 'PUT',
          body: JSON.stringify({ sectionIds: ids }),
        }),
      'The section order could not be saved.',
    );
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p role="alert" className="text-xs text-brand-danger">
        {errors[key]}
      </p>
    ) : null;
  const inputClass =
    'h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base md:text-sm';
  const isChoice = editing ? choiceTypes.includes(editing.draft.type) : false;
  const groups = lists ? groupQuestions(lists.sections, lists.questions) : [];
  const anyBusy = busy || editing !== null || sectionEditing !== null;

  return (
    <section
      aria-label={`Questions: ${stageLabels[stage]}`}
      className="space-y-4 rounded-none border border-corp-line bg-white p-4 md:p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-corporate text-base font-semibold text-corp-ink">
            Questions · {stageLabels[stage]}
          </h3>
          <p className="text-sm text-corp-text">
            Group questions into sections: delegates see one section per step. Questions without a
            section come first. An answered question keeps its wording; your edit becomes its next
            version.
          </p>
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={anyBusy}
              onClick={() => {
                setErrors({});
                setFailure(null);
                setSectionEditing({ id: null, title: '', description: '' });
              }}
              className={consoleButton({ variant: 'secondary' })}
            >
              <FolderPlusIcon aria-hidden="true" /> Add section
            </button>
            <button
              type="button"
              disabled={anyBusy}
              onClick={() => {
                setErrors({});
                setFailure(null);
                setEditing({ id: null, draft: EMPTY });
              }}
              className={consoleButton({ variant: 'accent' })}
            >
              <PlusIcon aria-hidden="true" /> Add question
            </button>
          </div>
        ) : null}
      </div>

      {failure ? (
        <div
          role="alert"
          className="rounded-none border border-brand-danger/40 bg-white p-3 text-sm"
        >
          <p className="font-semibold text-brand-danger">{failure.message}</p>
          {failure.requestId ? (
            <p className="mt-1 text-xs text-corp-muted">Request id {failure.requestId}</p>
          ) : null}
        </div>
      ) : null}

      {sectionEditing ? (
        <form
          noValidate
          aria-label={sectionEditing.id ? 'Edit section' : 'New section'}
          className="space-y-3 rounded-none border border-corp-green bg-corp-surface/40 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveSection();
          }}
        >
          <h4 className="font-corporate text-sm font-semibold text-corp-ink">
            {sectionEditing.id ? 'Edit section' : 'New section'}
          </h4>
          <div className="space-y-1">
            <label htmlFor={`${id}-section-title`} className="text-sm font-semibold text-corp-ink">
              Section title
            </label>
            <input
              id={`${id}-section-title`}
              value={sectionEditing.title}
              maxLength={200}
              onChange={(e) => {
                setSectionEditing((s) => (s ? { ...s, title: e.target.value } : s));
                setErrors({});
              }}
              className={inputClass}
            />
            {fieldError('sectionTitle')}
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`${id}-section-description`}
              className="text-sm font-semibold text-corp-ink"
            >
              Introduction (optional)
            </label>
            <textarea
              id={`${id}-section-description`}
              rows={2}
              maxLength={1000}
              value={sectionEditing.description}
              onChange={(e) =>
                setSectionEditing((s) => (s ? { ...s, description: e.target.value } : s))
              }
              className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => setSectionEditing(null)}
              className={consoleButton({ variant: 'ghost' })}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy} className={consoleButton({ variant: 'accent' })}>
              {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {sectionEditing.id ? 'Save section' : 'Add section'}
            </button>
          </div>
        </form>
      ) : null}

      {editing ? (
        <form
          noValidate
          aria-label={editing.id ? 'Edit question' : 'New question'}
          className="space-y-4 rounded-none border border-corp-green bg-corp-surface/40 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveQuestion();
          }}
        >
          {!editing.id ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-suggest`} className="text-sm font-semibold text-corp-ink">
                Start from a suggested question (optional)
              </label>
              <NativeSelect
                id={`${id}-suggest`}
                value=""
                onChange={(e) => {
                  const s = SUGGESTIONS[stage][Number(e.target.value)];
                  if (s) {
                    setEditing((cur) => ({
                      id: null,
                      draft: {
                        ...EMPTY,
                        sectionId: cur?.draft.sectionId ?? '',
                        prompt: s.prompt,
                        type: s.type,
                        area: s.area,
                      },
                    }));
                  }
                }}
                className="rounded-none"
              >
                <option value="">Choose a measurement area…</option>
                {SUGGESTIONS[stage].map((s, i) => (
                  <option key={s.prompt} value={i}>
                    {s.area}: {s.prompt}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor={`${id}-prompt`} className="text-sm font-semibold text-corp-ink">
              Question
            </label>
            <textarea
              id={`${id}-prompt`}
              rows={2}
              maxLength={500}
              value={editing.draft.prompt}
              onChange={(e) => set('prompt', e.target.value)}
              className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
            />
            {fieldError('prompt')}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor={`${id}-type`} className="text-sm font-semibold text-corp-ink">
                Response type
              </label>
              <NativeSelect
                id={`${id}-type`}
                value={editing.draft.type}
                onChange={(e) => set('type', e.target.value as QuestionType)}
                className="rounded-none"
              >
                {questionTypes.map((t) => (
                  <option key={t} value={t}>
                    {questionTypeLabels[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-section`} className="text-sm font-semibold text-corp-ink">
                Section
              </label>
              <NativeSelect
                id={`${id}-section`}
                value={editing.draft.sectionId}
                onChange={(e) => set('sectionId', e.target.value)}
                className="rounded-none"
              >
                <option value="">No section (shown first)</option>
                {(lists?.sections ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-area`} className="text-sm font-semibold text-corp-ink">
                Measurement area (optional)
              </label>
              <input
                id={`${id}-area`}
                list={`${id}-areas`}
                value={editing.draft.area}
                maxLength={100}
                onChange={(e) => set('area', e.target.value)}
                className={inputClass}
              />
              <datalist id={`${id}-areas`}>
                {stageAreas[stage].map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-help`} className="text-sm font-semibold text-corp-ink">
              Help text (optional)
            </label>
            <input
              id={`${id}-help`}
              value={editing.draft.helpText}
              maxLength={500}
              onChange={(e) => set('helpText', e.target.value)}
              className={inputClass}
            />
          </div>
          {isChoice ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-options`} className="text-sm font-semibold text-corp-ink">
                Options, one per line
              </label>
              <textarea
                id={`${id}-options`}
                rows={4}
                value={editing.draft.optionsText}
                onChange={(e) => set('optionsText', e.target.value)}
                placeholder={'Strongly agree\nAgree\nDisagree'}
                className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
              />
              <p className="text-xs text-corp-muted">
                Write “code | Label” to store a code different from the label.
              </p>
              {fieldError('optionsText')}
            </div>
          ) : null}
          {editing.draft.type === 'rating' ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <label htmlFor={`${id}-min`} className="text-sm font-semibold text-corp-ink">
                  From
                </label>
                <NativeSelect
                  id={`${id}-min`}
                  value={editing.draft.scaleMin}
                  onChange={(e) => set('scaleMin', e.target.value)}
                  className="rounded-none"
                >
                  <option value="0">0</option>
                  <option value="1">1</option>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-max`} className="text-sm font-semibold text-corp-ink">
                  To
                </label>
                <NativeSelect
                  id={`${id}-max`}
                  value={editing.draft.scaleMax}
                  onChange={(e) => set('scaleMax', e.target.value)}
                  className="rounded-none"
                >
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
                {fieldError('scaleMax')}
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-minlabel`} className="text-sm font-semibold text-corp-ink">
                  Low label
                </label>
                <input
                  id={`${id}-minlabel`}
                  value={editing.draft.minLabel}
                  maxLength={60}
                  onChange={(e) => set('minLabel', e.target.value)}
                  className={inputClass}
                  placeholder="Not at all"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-maxlabel`} className="text-sm font-semibold text-corp-ink">
                  High label
                </label>
                <input
                  id={`${id}-maxlabel`}
                  value={editing.draft.maxLabel}
                  maxLength={60}
                  onChange={(e) => set('maxLabel', e.target.value)}
                  className={inputClass}
                  placeholder="Very"
                />
              </div>
            </div>
          ) : null}
          <label className="flex min-h-tap items-center gap-2 text-sm text-corp-ink">
            <input
              type="checkbox"
              checked={editing.draft.required}
              onChange={(e) => set('required', e.target.checked)}
              className="size-5 accent-corp-green"
            />
            Required: delegates must answer before submitting
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
              className={consoleButton({ variant: 'ghost' })}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy} className={consoleButton({ variant: 'accent' })}>
              {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {editing.id ? 'Save question' : 'Add question'}
            </button>
          </div>
        </form>
      ) : null}

      {loadError ? (
        <StatePanel
          kind="error"
          title="Questions unavailable"
          description={loadError.message}
          requestId={loadError.requestId}
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
      ) : lists === null ? (
        <StatePanel kind="loading" title="Loading questions…" />
      ) : lists.questions.length === 0 && lists.sections.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No questions yet"
          description="An enabled stage needs at least one question before it can be scheduled, opened or published. Add sections first if you want the questions shown in steps."
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group, groupIndex) => {
            const sectionIndex = group.section
              ? lists.sections.findIndex((s) => s.id === group.section!.id)
              : -1;
            return (
              <section
                key={group.section?.id ?? 'general'}
                aria-label={
                  group.section ? `Section: ${group.section.title}` : 'Questions without a section'
                }
                className="rounded-none border border-corp-line"
              >
                <div className="flex flex-col gap-2 border-b border-corp-line bg-corp-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-corp-ink">
                      {group.section
                        ? `Section ${groupIndex + (groups[0]?.section ? 1 : 0)}: ${group.section.title}`
                        : 'Shown first (no section)'}
                    </p>
                    {group.section?.description ? (
                      <p className="text-xs text-corp-muted">{group.section.description}</p>
                    ) : null}
                  </div>
                  {group.section && !readOnly ? (
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        aria-label={`Move section up: ${group.section.title}`}
                        disabled={busy || sectionIndex <= 0}
                        onClick={() => void moveSection(sectionIndex, -1)}
                        className={consoleButton({ variant: 'ghost', size: 'sm' })}
                      >
                        <ArrowUpIcon aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move section down: ${group.section.title}`}
                        disabled={busy || sectionIndex >= lists.sections.length - 1}
                        onClick={() => void moveSection(sectionIndex, 1)}
                        className={consoleButton({ variant: 'ghost', size: 'sm' })}
                      >
                        <ArrowDownIcon aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit section: ${group.section.title}`}
                        disabled={anyBusy}
                        onClick={() => {
                          setErrors({});
                          setSectionEditing({
                            id: group.section!.id,
                            title: group.section!.title,
                            description: group.section!.description ?? '',
                          });
                        }}
                        className={consoleButton({ variant: 'ghost', size: 'sm' })}
                      >
                        <PencilIcon aria-hidden="true" /> Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Add question to section: ${group.section.title}`}
                        disabled={anyBusy}
                        onClick={() => {
                          setErrors({});
                          setEditing({ id: null, draft: draftOf(null, group.section!.id) });
                        }}
                        className={consoleButton({ variant: 'ghost', size: 'sm' })}
                      >
                        <PlusIcon aria-hidden="true" /> Question
                      </button>
                      {confirmDelete === `section:${group.section.id}` ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeSection(group.section!.id)}
                            className={consoleButton({ variant: 'danger', size: 'sm' })}
                          >
                            Confirm delete section
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className={consoleButton({ variant: 'ghost', size: 'sm' })}
                          >
                            Keep
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete section: ${group.section.title}`}
                          disabled={anyBusy}
                          onClick={() => setConfirmDelete(`section:${group.section!.id}`)}
                          className={consoleButton({ variant: 'ghost', size: 'sm' })}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
                {group.questions.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-corp-muted">
                    No questions in this section yet. Deleting the section keeps nothing to lose;
                    deleting a section with questions moves them to the top group.
                  </p>
                ) : (
                  <ol className="divide-y divide-corp-line" aria-label="Questions">
                    {group.questions.map((q, index) => (
                      <li key={q.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                        <span className="w-8 shrink-0 text-sm font-semibold text-corp-muted tabular-nums">
                          {index + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-corp-ink">{q.prompt}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-corp-muted">
                            <StatusPill tone="neutral">{questionTypeLabels[q.type]}</StatusPill>
                            {q.required ? (
                              <StatusPill tone="positive">Required</StatusPill>
                            ) : (
                              <StatusPill tone="neutral">Optional</StatusPill>
                            )}
                            {q.version > 1 ? <span>version {q.version}</span> : null}
                            {q.responseCount > 0 ? <span>{q.responseCount} answers</span> : null}
                            {q.area ? <span>{q.area}</span> : null}
                          </div>
                          {q.options ? (
                            <p className="mt-1 text-xs text-corp-muted">
                              {q.options.map((o) => o.label).join(' · ')}
                            </p>
                          ) : null}
                          {q.scale ? (
                            <p className="mt-1 text-xs text-corp-muted">
                              {q.scale.min} ({q.scale.minLabel ?? 'low'}) to {q.scale.max} (
                              {q.scale.maxLabel ?? 'high'})
                            </p>
                          ) : null}
                        </div>
                        {!readOnly ? (
                          <div className="flex shrink-0 flex-wrap gap-1">
                            <button
                              type="button"
                              aria-label={`Move up: ${q.prompt}`}
                              disabled={busy || index === 0}
                              onClick={() => void moveQuestion(group.questions, index, -1)}
                              className={consoleButton({ variant: 'ghost', size: 'sm' })}
                            >
                              <ArrowUpIcon aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Move down: ${q.prompt}`}
                              disabled={busy || index === group.questions.length - 1}
                              onClick={() => void moveQuestion(group.questions, index, 1)}
                              className={consoleButton({ variant: 'ghost', size: 'sm' })}
                            >
                              <ArrowDownIcon aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Edit: ${q.prompt}`}
                              disabled={anyBusy}
                              onClick={() => {
                                setErrors({});
                                setFailure(null);
                                setEditing({ id: q.id, draft: draftOf(q) });
                              }}
                              className={consoleButton({ variant: 'ghost', size: 'sm' })}
                            >
                              <PencilIcon aria-hidden="true" /> Edit
                            </button>
                            {confirmDelete === q.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void removeQuestion(q.id)}
                                  className={consoleButton({ variant: 'danger', size: 'sm' })}
                                >
                                  {q.responseCount > 0 ? 'Confirm retire' : 'Confirm delete'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDelete(null)}
                                  className={consoleButton({ variant: 'ghost', size: 'sm' })}
                                >
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Delete: ${q.prompt}`}
                                disabled={anyBusy}
                                onClick={() => setConfirmDelete(q.id)}
                                className={consoleButton({ variant: 'ghost', size: 'sm' })}
                              >
                                <Trash2Icon aria-hidden="true" /> Delete
                              </button>
                            )}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
