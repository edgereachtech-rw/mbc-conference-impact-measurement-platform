'use client';

import {
  choiceTypes,
  groupQuestions,
  markedOptions,
  optionPresets,
  questionFieldsSchema,
  questionTypeLabels,
  questionTypes,
  sectionFieldsSchema,
  sectionMarkingLabels,
  sectionMarkings,
  type AssessmentQuestionView,
  type AssessmentSectionView,
  type AssessmentStage,
  type QuestionOption,
  type QuestionType,
  type SectionMarking,
} from '@mbc/shared';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderPlusIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/console/dialog';
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

export interface OptionDraft {
  value: string;
  label: string;
  /** Points as typed; blank means not scored (for example "Not applicable"). */
  score: string;
  correct: boolean;
  exclusive: boolean;
  other: boolean;
}

interface Draft {
  prompt: string;
  helpText: string;
  type: QuestionType;
  required: boolean;
  area: string;
  /** The admin chose "Other…" for the measurement area and types their own. */
  areaOther: boolean;
  sectionId: string;
  options: OptionDraft[];
  scaleMin: string;
  scaleMax: string;
  minLabel: string;
  maxLabel: string;
}

interface Lists {
  sections: AssessmentSectionView[];
  questions: AssessmentQuestionView[];
}

/** Select value for a measurement area typed by the admin rather than picked from the list. */
const OTHER_AREA = '__other__';

const emptyOption = (): OptionDraft => ({
  value: '',
  label: '',
  score: '',
  correct: false,
  exclusive: false,
  other: false,
});

const EMPTY: Draft = {
  prompt: '',
  helpText: '',
  type: 'single_choice',
  required: true,
  area: '',
  areaOther: false,
  sectionId: '',
  options: [emptyOption(), emptyOption()],
  scaleMin: '1',
  scaleMax: '5',
  minLabel: '',
  maxLabel: '',
};

/** Starting points per stage, one per measurement area of the brief; the admin edits freely. */
function optionDraftOf(o: QuestionOption): OptionDraft {
  return {
    value: o.value,
    label: o.label,
    score: o.score === null || o.score === undefined ? '' : String(o.score),
    correct: Boolean(o.correct),
    exclusive: Boolean(o.exclusive),
    other: Boolean(o.other),
  };
}

function draftOf(q: AssessmentQuestionView | null, sectionId = ''): Draft {
  if (!q) return { ...EMPTY, options: [emptyOption(), emptyOption()], sectionId };
  return {
    prompt: q.prompt,
    helpText: q.helpText ?? '',
    type: q.type,
    required: q.required,
    area: q.area ?? '',
    areaOther: false,
    sectionId: q.sectionId ?? '',
    options: q.options?.length ? q.options.map(optionDraftOf) : [emptyOption(), emptyOption()],
    scaleMin: String(q.scale?.min ?? 1),
    scaleMax: String(q.scale?.max ?? 5),
    minLabel: q.scale?.minLabel ?? '',
    maxLabel: q.scale?.maxLabel ?? '',
  };
}

/** "value | label" lines or plain labels into option rows; the value defaults to the label. */
export function parseOptions(text: string): OptionDraft[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, label] = line.split('|').map((s) => s.trim());
      return label
        ? { ...emptyOption(), value: value!, label }
        : { ...emptyOption(), value: line, label: line };
    });
}

/** Codes are limited to 100 characters by the API; longer labels get a short derived code. */
const MAX_CODE = 100;

/**
 * The stored code for an option: what the admin typed, or the label when the code is blank. A
 * code longer than the limit (a long label with no code of its own) becomes a short slug of the
 * label, made unique among the question's options.
 */
export function codeFor(raw: string, used: Set<string>): string {
  if (raw.length <= MAX_CODE) return raw;
  const slug =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'option';
  let code = slug;
  for (let n = 2; used.has(code); n += 1) code = `${slug}_${n}`;
  return code;
}

/**
 * Option rows into the API shape: single choice carries scores and the correct answer (only
 * those the section's marking allows, when given), multiple choice carries exclusive and "Other".
 */
export function optionsPayload(
  type: QuestionType,
  options: OptionDraft[],
  marking?: SectionMarking,
): QuestionOption[] {
  const used = new Set<string>();
  const rows = options
    .filter((o) => o.label.trim() || o.value.trim())
    .map((o) => {
      const label = o.label.trim() || o.value.trim();
      const value = codeFor(o.value.trim() || label, used);
      used.add(value);
      if (type === 'single_choice') {
        return {
          value,
          label,
          ...(o.score.trim() !== '' ? { score: Number(o.score) } : {}),
          ...(o.correct ? { correct: true } : {}),
        };
      }
      return {
        value,
        label,
        ...(o.exclusive ? { exclusive: true } : {}),
        ...(o.other ? { other: true } : {}),
      };
    });
  return marking && type === 'single_choice' ? markedOptions(rows, marking) : rows;
}

export function payloadOf(draft: Draft, marking: SectionMarking = 'none') {
  const isChoice = choiceTypes.includes(draft.type);
  return {
    prompt: draft.prompt,
    helpText: draft.helpText,
    type: draft.type,
    required: draft.required,
    area: draft.area,
    ...(isChoice ? { options: optionsPayload(draft.type, draft.options, marking) } : {}),
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

function describeOption(o: QuestionOption): string {
  return `${o.label}${o.correct ? ' ✓' : ''}${
    o.score !== null && o.score !== undefined ? ` (${o.score})` : ''
  }${o.exclusive ? ' (only)' : ''}${o.other ? ' (text)' : ''}`;
}

/**
 * The questions of one assessment stage (every enabled stage needs at least one), grouped into
 * sections that delegates see one step at a time. Sections and questions can be added, edited,
 * moved and deleted; edits to an answered question become a new version on the server. A stage
 * can repeat a question of another stage by reference (same wording, paired answers) and can
 * load an example set, which becomes the event's own editable questions.
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
    marking: SectionMarking;
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
  }, [base, stage, attempt]);

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
  function setOption(index: number, patch: Partial<OptionDraft>) {
    setEditing((e) => {
      if (!e) return e;
      const options = e.draft.options.map((o, i) => {
        if (i === index) return { ...o, ...patch };
        // One correct answer at most: ticking one unticks the others.
        return patch.correct ? { ...o, correct: false } : o;
      });
      return { ...e, draft: { ...e.draft, options } };
    });
    setErrors((errs) => {
      if (!errs.options) return errs;
      const copy = { ...errs };
      delete copy.options;
      return copy;
    });
  }

  async function saveQuestion() {
    if (!editing) return;
    const payload = payloadOf(editing.draft, markingOf(editing.draft.sectionId));
    const parsed = questionFieldsSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        // Option issues name the option and the field: "Option 3, code: Too big…".
        const where =
          key === 'options' && typeof issue.path[1] === 'number'
            ? `Option ${issue.path[1] + 1}${issue.path[2] ? `, ${issue.path[2] === 'value' ? 'code' : String(issue.path[2])}` : ''}: `
            : '';
        next[key === 'scale' ? 'scaleMax' : key] ??= `${where}${issue.message}`;
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
      marking: sectionEditing.marking,
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
  const smallInput =
    'h-10 w-full min-w-0 rounded-none border border-corp-line bg-white px-2 text-base md:text-sm';
  const isChoice = editing ? choiceTypes.includes(editing.draft.type) : false;
  // "Other…" stays selected while the admin types; a stored area outside the list shows as other.
  const areaOther = editing
    ? editing.draft.areaOther ||
      (editing.draft.area !== '' && !stageAreas[stage].includes(editing.draft.area))
    : false;
  const isSingle = editing?.draft.type === 'single_choice';
  /** Marking comes from the section a question sits in; none outside a section. */
  const markingOf = (sectionId: string): SectionMarking =>
    lists?.sections.find((x) => x.id === sectionId)?.marking ?? 'none';
  const marking = editing ? markingOf(editing.draft.sectionId) : 'none';
  const copyable =
    editing && lists
      ? lists.questions.filter(
          (q) => q.type === editing.draft.type && q.options?.length && q.id !== editing.id,
        )
      : [];
  const groups = lists ? groupQuestions(lists.sections, lists.questions) : [];
  const anyBusy = busy || editing !== null || sectionEditing !== null;

  const sectionSelect = (value: string, onChange: (v: string) => void, selectId: string) => (
    <NativeSelect
      id={selectId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-none"
    >
      <option value="">No section (shown first)</option>
      {(lists?.sections ?? []).map((s) => (
        <option key={s.id} value={s.id}>
          {s.title}
        </option>
      ))}
    </NativeSelect>
  );

  return (
    <section
      aria-label={`Questions: ${stageLabels[stage]}`}
      className="space-y-4 rounded-none border border-corp-line bg-white p-4 md:p-5"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
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
                setSectionEditing({ id: null, title: '', description: '', marking: 'none' });
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
                setEditing({ id: null, draft: draftOf(null) });
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
        <Dialog
          title={sectionEditing.id ? 'Edit section' : 'New section'}
          onClose={() => setSectionEditing(null)}
          closeDisabled={busy}
          size="md"
        >
          <form
            noValidate
            aria-label={sectionEditing.id ? 'Edit section' : 'New section'}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveSection();
            }}
          >
            <h4 className="font-corporate text-sm font-semibold text-corp-ink">
              {sectionEditing.id ? 'Edit section' : 'New section'}
            </h4>
            <div className="space-y-1">
              <label
                htmlFor={`${id}-section-title`}
                className="text-sm font-semibold text-corp-ink"
              >
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
            <div className="space-y-1">
              <label
                htmlFor={`${id}-section-marking`}
                className="text-sm font-semibold text-corp-ink"
              >
                Marking
              </label>
              <NativeSelect
                id={`${id}-section-marking`}
                value={sectionEditing.marking}
                onChange={(e) =>
                  setSectionEditing((x) =>
                    x ? { ...x, marking: e.target.value as SectionMarking } : x,
                  )
                }
                className="rounded-none"
              >
                {sectionMarkings.map((m) => (
                  <option key={m} value={m}>
                    {sectionMarkingLabels[m]}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-corp-muted">
                Applies to the single-choice questions in this section. Rating scale: each option
                carries a weight (for example Always 5 to Never 1) averaged in reports, with no
                right answer. Knowledge: each question has one correct answer worth one point, shown
                to delegates at once and locked.
              </p>
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
              <button
                type="submit"
                disabled={busy}
                className={consoleButton({ variant: 'accent' })}
              >
                {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                {sectionEditing.id ? 'Save section' : 'Add section'}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {editing ? (
        <Dialog
          title={editing.id ? 'Edit question' : 'New question'}
          onClose={() => setEditing(null)}
          closeDisabled={busy}
        >
          <form
            noValidate
            aria-label={editing.id ? 'Edit question' : 'New question'}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveQuestion();
            }}
          >
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
                {sectionSelect(
                  editing.draft.sectionId,
                  (v) => set('sectionId', v),
                  `${id}-section`,
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-area`} className="text-sm font-semibold text-corp-ink">
                  Measurement area (optional)
                </label>
                <NativeSelect
                  id={`${id}-area`}
                  value={areaOther ? OTHER_AREA : editing.draft.area}
                  onChange={(e) => {
                    if (e.target.value === OTHER_AREA) {
                      set('areaOther', true);
                      set('area', '');
                    } else {
                      set('areaOther', false);
                      set('area', e.target.value);
                    }
                  }}
                  className="rounded-none"
                >
                  <option value="">Not set</option>
                  {stageAreas[stage].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                  <option value={OTHER_AREA}>Other…</option>
                </NativeSelect>
                {areaOther ? (
                  <input
                    aria-label="Other measurement area"
                    value={editing.draft.area}
                    maxLength={100}
                    placeholder="Type the measurement area"
                    onChange={(e) => set('area', e.target.value)}
                    className={inputClass}
                  />
                ) : null}
                <p className="text-xs text-corp-muted">
                  What this question measures, for your reports. Delegates never see it.
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>
            {isChoice ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-corp-ink">Options</legend>
                <p className="text-xs text-corp-muted">
                  {!isSingle
                    ? 'Tick “Only” for an option that cannot be combined with others, such as “None of the above”, and “Text” for “Other, please specify”.'
                    : marking === 'scored'
                      ? 'This section is a rating scale: give each option a weight to average in reports and leave “Not applicable” blank so it never counts as a low rating.'
                      : marking === 'knowledge'
                        ? 'This section holds knowledge questions: tick the one correct answer. The question is worth one point; delegates see at once whether they were right and cannot change their answer.'
                        : 'Delegates pick one option. To weight the options or mark a correct answer, put this question in a section whose marking says so.'}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <NativeSelect
                    aria-label="Start from a preset"
                    value=""
                    onChange={(e) => {
                      const preset = optionPresets.find((p) => p.id === e.target.value);
                      if (preset) set('options', preset.options.map(optionDraftOf));
                    }}
                    className="rounded-none sm:max-w-xs"
                  >
                    <option value="">Start from a preset…</option>
                    {optionPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect>
                  {copyable.length ? (
                    <NativeSelect
                      aria-label="Copy options from another question"
                      value=""
                      onChange={(e) => {
                        const from = copyable.find((q) => q.id === e.target.value);
                        if (from?.options) set('options', from.options.map(optionDraftOf));
                      }}
                      className="rounded-none sm:max-w-xs"
                    >
                      <option value="">Copy options from…</option>
                      {copyable.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.prompt}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                </div>
                <ol className="space-y-2" aria-label="Options">
                  {editing.draft.options.map((o, i) => (
                    <li
                      key={i}
                      className="grid gap-2 rounded-none border border-corp-line bg-white p-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-center"
                    >
                      <input
                        aria-label={`Option ${i + 1}`}
                        placeholder={`Option ${i + 1}`}
                        value={o.label}
                        maxLength={200}
                        onChange={(e) => setOption(i, { label: e.target.value })}
                        className={smallInput}
                      />
                      <input
                        aria-label={`Code for option ${i + 1}`}
                        placeholder="Code"
                        value={o.value}
                        maxLength={100}
                        onChange={(e) => setOption(i, { value: e.target.value })}
                        className={smallInput}
                      />
                      <div className="flex flex-wrap items-center gap-3 text-sm text-corp-ink">
                        {isSingle ? (
                          <>
                            {marking === 'scored' ? (
                              <label className="flex items-center gap-1">
                                Weight
                                <input
                                  type="number"
                                  aria-label={`Weight for option ${i + 1}`}
                                  min={0}
                                  max={100}
                                  value={o.score}
                                  onChange={(e) => setOption(i, { score: e.target.value })}
                                  className="h-10 w-16 rounded-none border border-corp-line bg-white px-2 text-base md:text-sm"
                                />
                              </label>
                            ) : null}
                            {marking === 'knowledge' ? (
                              <label className="flex min-h-tap items-center gap-1">
                                <input
                                  type="checkbox"
                                  aria-label={`Correct answer: option ${i + 1}`}
                                  checked={o.correct}
                                  onChange={(e) => setOption(i, { correct: e.target.checked })}
                                  className="size-5 accent-corp-green"
                                />
                                Correct
                              </label>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <label className="flex min-h-tap items-center gap-1">
                              <input
                                type="checkbox"
                                aria-label={`Only this option: option ${i + 1}`}
                                checked={o.exclusive}
                                onChange={(e) => setOption(i, { exclusive: e.target.checked })}
                                className="size-5 accent-corp-green"
                              />
                              Only
                            </label>
                            <label className="flex min-h-tap items-center gap-1">
                              <input
                                type="checkbox"
                                aria-label={`Asks for text: option ${i + 1}`}
                                checked={o.other}
                                onChange={(e) => setOption(i, { other: e.target.checked })}
                                className="size-5 accent-corp-green"
                              />
                              Text
                            </label>
                          </>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove option ${i + 1}`}
                          onClick={() =>
                            set(
                              'options',
                              editing.draft.options.filter((_, j) => j !== i),
                            )
                          }
                          className={consoleButton({ variant: 'ghost', size: 'sm' })}
                        >
                          <XIcon aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <button
                    type="button"
                    disabled={editing.draft.options.length >= 20}
                    onClick={() => set('options', [...editing.draft.options, emptyOption()])}
                    className={consoleButton({ variant: 'secondary', size: 'sm' })}
                  >
                    <PlusIcon aria-hidden="true" /> Add option
                  </button>
                  <details className="text-sm">
                    <summary className="min-h-tap cursor-pointer py-2 font-semibold text-corp-ink">
                      Paste a list
                    </summary>
                    <PasteOptions
                      onAdd={(rows) =>
                        set('options', [...editing.draft.options, ...rows].slice(0, 20))
                      }
                    />
                  </details>
                </div>
                {fieldError('options')}
              </fieldset>
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
              <button
                type="submit"
                disabled={busy}
                className={consoleButton({ variant: 'accent' })}
              >
                {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                {editing.id ? 'Save question' : 'Add question'}
              </button>
            </div>
          </form>
        </Dialog>
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
                    {group.section && group.section.marking !== 'none' ? (
                      <StatusPill tone="positive">
                        {sectionMarkingLabels[group.section.marking]}
                        {group.section.marking === 'knowledge'
                          ? ` · ${group.questions.filter((x) => x.isKnowledge).length} point${group.questions.filter((x) => x.isKnowledge).length === 1 ? '' : 's'}`
                          : ''}
                      </StatusPill>
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
                            marking: group.section!.marking,
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
                          setEditing({
                            id: null,
                            draft: draftOf(null, group.section!.id),
                          });
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
                            {q.isKnowledge ? (
                              <StatusPill tone="positive">Knowledge · 1 point</StatusPill>
                            ) : group.section?.marking === 'knowledge' &&
                              q.type === 'single_choice' ? (
                              <StatusPill tone="attention">No correct answer ticked</StatusPill>
                            ) : null}
                            {q.version > 1 ? <span>version {q.version}</span> : null}
                            {q.responseCount > 0 ? <span>{q.responseCount} answers</span> : null}
                            {q.area ? <span>{q.area}</span> : null}
                          </div>
                          {q.options ? (
                            <p className="mt-1 text-xs text-corp-muted">
                              {q.options.map(describeOption).join(' · ')}
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
                                setEditing({
                                  id: q.id,
                                  draft: draftOf(q),
                                });
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

function PasteOptions({ onAdd }: { onAdd: (rows: OptionDraft[]) => void }) {
  const [text, setText] = useState('');
  const id = useId();
  return (
    <div className="mt-1 space-y-2">
      <label htmlFor={id} className="text-xs text-corp-muted">
        One option per line. Write “code | Label” to store a code different from the label.
      </label>
      <textarea
        id={id}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Strongly agree\nAgree\nDisagree'}
        className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          onAdd(parseOptions(text));
          setText('');
        }}
        className={consoleButton({ variant: 'secondary', size: 'sm' })}
      >
        Add these options
      </button>
    </div>
  );
}
