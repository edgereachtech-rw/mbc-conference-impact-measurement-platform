import {
  DEFAULT_CONFIRMATION,
  type AssessmentConfirmation,
  type ConfirmationTone,
  type SectionMark,
} from '@mbc/shared';
import { CheckCircle2Icon } from 'lucide-react';

/** The colour family of the icon and, when highlighted, the panel. Full class names for Tailwind. */
const TONE: Record<ConfirmationTone, { icon: string; border: string; bg: string }> = {
  green: { icon: 'text-corp-green-text', border: 'border-corp-green', bg: 'bg-corp-green-soft' },
  accent: { icon: 'text-corp-accent', border: 'border-corp-accent', bg: 'bg-corp-accent-soft' },
  ink: { icon: 'text-corp-ink', border: 'border-corp-ink', bg: 'bg-corp-surface' },
};

export const DEFAULT_ALL_TITLE = 'All sections submitted';
export const DEFAULT_ALL_MESSAGE =
  'Thank you. Every section is submitted and your responses are recorded.';
export const DEFAULT_ALL_DETAIL =
  'Nothing more to do here. We will email you when the next step opens.';

/** The settings with every blank filled from the defaults. */
export function resolveConfirmation(
  confirmation: Partial<AssessmentConfirmation> | null | undefined,
): AssessmentConfirmation {
  return { ...DEFAULT_CONFIRMATION, ...(confirmation ?? {}) };
}

/** The popup's title: the organisers' own once everything is in, else the fixed section one. */
export function confirmationTitle(
  confirmation: Partial<AssessmentConfirmation> | null | undefined,
  scope: 'all' | 'section',
): string {
  if (scope === 'section') return 'Section submitted';
  return resolveConfirmation(confirmation).title ?? DEFAULT_ALL_TITLE;
}

interface Props {
  confirmation: Partial<AssessmentConfirmation> | null | undefined;
  /** Whether every section is now in, or one section of several. */
  scope: 'all' | 'section';
  /** The section just submitted, for the section-scope wording. */
  sectionTitle?: string | null;
  /** The mark of a marked section, shown at once (2026-11-07). */
  mark?: SectionMark | null;
  /** What comes next after one section; the all-scope detail comes from the settings. */
  nextText?: string;
}

/**
 * What a delegate sees once a submission went through (2026-11-06): a check, what was recorded,
 * and what comes next, so nobody wonders whether it went through or where to go. The organisers
 * set the final confirmation's words and look per assessment (decision 2026-11-19); the
 * section-by-section one keeps its wording and takes the styling.
 */
export function SubmissionConfirmation({
  confirmation,
  scope,
  sectionTitle,
  mark,
  nextText,
}: Props) {
  const c = resolveConfirmation(confirmation);
  const tone = TONE[c.tone];
  const message =
    scope === 'all'
      ? (c.message ?? DEFAULT_ALL_MESSAGE)
      : `Thank you. “${sectionTitle ?? 'Your responses'}” is recorded.`;
  const detail =
    scope === 'all' ? (c.detail ?? DEFAULT_ALL_DETAIL) : (nextText ?? 'Nothing more to do here.');
  return (
    <div
      role="status"
      className={[
        'flex flex-col gap-3 py-2',
        c.align === 'center' ? 'items-center text-center' : 'items-start text-left',
        c.highlight ? `border-l-4 px-4 ${tone.border} ${tone.bg}` : '',
      ].join(' ')}
    >
      {c.showIcon ? (
        <CheckCircle2Icon className={`size-14 ${tone.icon}`} aria-hidden="true" />
      ) : null}
      <p className="text-base font-semibold text-corp-ink">{message}</p>
      {mark ? (
        <p
          aria-label="Your mark"
          className={`rounded-none border-2 px-4 py-2 font-corporate text-2xl font-bold text-corp-ink ${tone.border}`}
        >
          {mark.percent}%
          <span className="ml-2 text-sm font-normal text-corp-muted">
            {mark.scored} of {mark.max} points
          </span>
        </p>
      ) : null}
      <p className="max-w-prose text-sm text-corp-text">{detail}</p>
    </div>
  );
}
