import type { QuestionFieldsInput, SupportFlag } from '@mbc/shared';

import type { AssessmentTemplate } from './ittec-pre-conference.js';

/**
 * ITTEC 2026 follow-up questions (docs/backlog.md Appendix A7, from S11.2 to S11.4).
 *
 * Pilot content, not platform behaviour: `db:seed` and the schedule endpoint load these into the
 * ITTEC event's own follow-up waves as that event's editable data. Another event enters its own.
 * The wording is the approved wording, unchanged.
 *
 * What is deliberately NOT here: the structured application question proposed under Appendix A7
 * ("Have you applied learning from ITTEC at least once in a real work situation?" Yes / No) for
 * the reported application rate. The appendix marks it "proposed: confirm with M.Bryan", so it is
 * not seeded; an admin can add it to any wave, and the report will count it once it exists. The
 * longer-term (180-day) wave has no questions either: Appendix A7 says the set is still to be
 * supplied, so that wave is created empty and cannot be opened until it has questions.
 */

const long = (
  prompt: string,
  area: string,
  required = true,
  supportFlag: SupportFlag = 'none',
): QuestionFieldsInput => ({
  prompt,
  helpText: null,
  type: 'long_text',
  required,
  area,
  supportFlag,
});

const yesNo = (prompt: string, area: string): QuestionFieldsInput => ({
  prompt,
  helpText: null,
  type: 'yes_no',
  required: true,
  area,
});

/** 30-day (S11.2): has the plan started, and what is in the way. */
export const ITTEC_FOLLOW_UP_30: AssessmentTemplate = {
  id: 'ittec-follow-up-30',
  label: '30-day follow-up',
  stage: 'follow_up',
  sections: [
    {
      title: 'Your progress so far',
      description:
        'About a month on from ITTEC. Your Transfer Plan and what you said you would do differently are shown above, so you do not need to repeat them.',
      // "Have you started the action in your Transfer Plan?" (Q-F30-1) is not seeded since
      // 2026-11-09: every follow-up first asks one status per planned action, which answers it.
      questions: [
        long('What have you done so far?', 'Progress'),
        long('What has helped you make progress?', 'Enablers'),
        long('What has delayed or prevented progress?', 'Barriers', true, 'barrier'),
        long('What is your next step, and when will you take it?', 'Next step'),
        long(
          'What support do you need from M.Bryan or another stakeholder?',
          'Support needs',
          false,
          'support_requested',
        ),
        yesNo('Would you like to change your reminder preferences?', 'Reminder preferences'),
      ],
    },
  ],
};

/** 60-day (S11.3): application, and the evidence of it. */
export const ITTEC_FOLLOW_UP_60: AssessmentTemplate = {
  id: 'ittec-follow-up-60',
  label: '60-day follow-up',
  stage: 'follow_up',
  sections: [
    {
      title: 'What you have applied',
      description:
        'About two months on. Your Transfer Plan and your pre-conference answer are shown above.',
      questions: [
        long('What have you applied from ITTEC?', 'Application'),
        long('Where and how have you applied it?', 'Application context'),
        long('How often have you applied it?', 'Application frequency'),
        long('Who has been involved or provided support?', 'Stakeholders'),
        long(
          "What has changed in your work or your organisation's practices?",
          'Change in practice',
        ),
        long('What evidence of application can you share or describe?', 'Evidence'),
        long(
          'What barriers or support needs remain?',
          'Barriers and support needs',
          false,
          'support_requested',
        ),
      ],
    },
  ],
};

/** 90-day (S11.4): results, other contributing factors, and expectations met. */
export const ITTEC_FOLLOW_UP_90: AssessmentTemplate = {
  id: 'ittec-follow-up-90',
  label: '90-day follow-up',
  stage: 'follow_up',
  sections: [
    {
      title: 'Results and expectations',
      description:
        'About three months on. Your Transfer Plan and your pre-conference answer are shown above.',
      questions: [
        long('What progress have you made against your Transfer Plan?', 'Progress'),
        long(
          'What actions have you completed, continued, changed or not started?',
          'Action outcomes',
        ),
        long('What results or improvements have you observed?', 'Results'),
        long('What evidence or relevant measures are available?', 'Evidence and measures'),
        long(
          'What other factors may also have contributed to the changes?',
          'Other contributing factors',
        ),
        long('To what extent have your expectations of ITTEC been met?', 'Expectations met'),
        long(
          'What further support or time do you need?',
          'Support needs',
          false,
          'support_requested',
        ),
      ],
    },
  ],
};

/** The seeded set for each wave; a wave with no entry is created empty. */
export const ITTEC_FOLLOW_UPS: Record<number, AssessmentTemplate> = {
  1: ITTEC_FOLLOW_UP_30,
  2: ITTEC_FOLLOW_UP_60,
  3: ITTEC_FOLLOW_UP_90,
};
