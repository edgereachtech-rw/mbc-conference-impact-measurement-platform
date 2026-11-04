import type { QuestionFieldsInput } from '@mbc/shared';

import type { AssessmentTemplate } from './ittec-pre-conference.js';

/**
 * ITTEC 2026 end-of-conference evaluation content (docs/backlog.md, Appendix A6; requirement
 * section 10). Pilot data, loaded once by `db:seed` into the ITTEC event's empty
 * end-of-conference stage. The knowledge and confidence sections repeat the pre-conference
 * sections (mirrored, so answers pair per delegate); readiness is the platform's one remaining
 * built-in block. Other events write their own content in the same format.
 */

/**
 * The pre-conference question the expectations section refers to. The wording must match the
 * pre-conference content exactly: the loader resolves it to that question's key.
 */
const EXPECTATION_PROMPT = 'What would you like to learn or gain from the conference?';

const EXPERIENCE = [
  { value: 'excellent', label: 'Excellent', score: 4 },
  { value: 'good', label: 'Good', score: 3 },
  { value: 'fair', label: 'Fair', score: 2 },
  { value: 'poor', label: 'Poor', score: 1 },
  { value: 'na', label: 'Not applicable', score: null },
];

const rating = (prompt: string, area: string): QuestionFieldsInput => ({
  prompt,
  helpText: null,
  type: 'single_choice',
  required: true,
  area,
  options: EXPERIENCE,
});

const open = (prompt: string, area: string, required = true): QuestionFieldsInput => ({
  prompt,
  helpText: null,
  type: 'long_text',
  required,
  area,
});

export const ITTEC_END_OF_CONFERENCE: AssessmentTemplate = {
  id: 'ittec-2026-end-of-conference',
  label: 'ITTEC 2026 end-of-conference evaluation (pilot content)',
  stage: 'end_of_conference',
  sections: [
    {
      title: 'Your conference experience',
      description: 'For each item, select the rating that best matches your experience.',
      marking: 'scored',
      questions: [
        rating('Relevance of the conference to your work.', 'Conference experience'),
        rating('Quality of the sessions you attended.', 'Conference experience'),
        rating('Practical usefulness of the discussions and activities.', 'Conference experience'),
        rating('Opportunities to interact and exchange ideas.', 'Conference experience'),
        rating('Organisation and communication.', 'Conference experience'),
        rating('Your overall conference experience.', 'Conference experience'),
        open('What did ITTEC do well?', 'Conference experience', false),
        open('What should be improved for a future conference?', 'Conference experience', false),
      ],
    },
    {
      title: 'Your experience in person',
      description: 'For delegates who attended at the venue.',
      marking: 'scored',
      audience: 'physical',
      questions: [
        rating('Registration and check-in.', 'Conference experience'),
        rating('Venue and facilities.', 'Conference experience'),
        rating('Accessibility and comfort.', 'Conference experience'),
        rating('On-site support.', 'Conference experience'),
      ],
    },
    {
      title: 'Your experience online',
      description: 'For delegates who joined online.',
      marking: 'scored',
      audience: 'virtual',
      questions: [
        rating('Ease of joining.', 'Conference experience'),
        rating('Audio and visual quality.', 'Conference experience'),
        rating('Access to sessions.', 'Conference experience'),
        rating('Ability to participate and engage.', 'Conference experience'),
        rating('Technical support.', 'Conference experience'),
      ],
    },
    {
      title: 'Knowledge assessment',
      description:
        'The same questions you answered before the conference, so we can see what changed. If you are unsure of an answer, select “I am not sure.”',
      mirrorOf: { stage: 'pre_conference', title: 'Baseline knowledge assessment' },
      questions: [],
    },
    {
      title: 'Confidence assessment',
      description: 'The same statements as before the conference. Rate your confidence now.',
      mirrorOf: { stage: 'pre_conference', title: 'Baseline confidence assessment' },
      questions: [],
    },
    {
      title: 'Learning gained',
      description: null,
      questions: [
        open(
          'What is the most valuable knowledge, skill, tool or practice you gained from ITTEC?',
          'Knowledge gained',
        ),
        open('How is it relevant to your work or organisation?', 'Knowledge gained'),
        open(
          'What can you now do, or do differently, as a result of what you learned?',
          'Knowledge gained',
        ),
      ],
    },
    {
      title: 'Unresolved needs',
      description: null,
      questions: [
        open('What question or challenge remains unresolved for you?', 'Unresolved needs', false),
        open(
          'What additional knowledge, resource or support would help you apply what you learned?',
          'Unresolved needs',
          false,
        ),
        open(
          'Is there a topic you would like M.Bryan to address in a future programme?',
          'Unresolved needs',
          false,
        ),
      ],
    },
    { title: 'Readiness to apply', description: null, builtin: 'readiness', questions: [] },
    // Requirement 10.5, as ordinary editable questions (the built-in block was removed
    // 2026-11-04). All four refer to the pre-conference expectation; `visibleWhen` splits the
    // delegates who recorded one from those who did not, so each is asked once, and the report
    // keeps the two apart because they are different questions.
    {
      title: 'Your expectations',
      description: 'How far the conference provided what you hoped to gain.',
      questions: [
        {
          prompt: 'To what extent did ITTEC provide what you hoped to gain?',
          helpText: null,
          type: 'single_choice',
          required: true,
          area: 'Expectation status',
          options: [
            { value: 'fully', label: 'Fully' },
            { value: 'partly', label: 'Partly' },
            { value: 'not_yet_sure', label: 'Not yet sure' },
            { value: 'not_at_all', label: 'Not at all' },
            { value: 'no_longer_applicable', label: 'No longer applicable' },
          ],
          referenceOf: { stage: 'pre_conference', prompt: EXPECTATION_PROMPT },
          showReferenceAnswer: true,
          visibleWhen: 'reference_answered',
        },
        {
          prompt: 'Please explain your response. What did you gain, and what is still missing?',
          helpText: null,
          type: 'long_text',
          required: false,
          area: 'Expectation status',
          referenceOf: { stage: 'pre_conference', prompt: EXPECTATION_PROMPT },
          visibleWhen: 'reference_answered',
        },
        {
          prompt:
            'You did not record your expectations before ITTEC. Looking back, what did you hope to gain from attending the conference?',
          helpText: 'Recorded after the conference.',
          type: 'long_text',
          required: false,
          area: 'Recorded after the conference',
          referenceOf: { stage: 'pre_conference', prompt: EXPECTATION_PROMPT },
          visibleWhen: 'reference_unanswered',
          allowDecline: true,
        },
        {
          prompt: 'To what extent was this expectation met?',
          helpText: null,
          type: 'single_choice',
          required: true,
          area: 'Recorded after the conference',
          options: [
            { value: 'met', label: 'Met' },
            { value: 'partly_met', label: 'Partly met' },
            { value: 'not_yet_met', label: 'Not yet met' },
            { value: 'not_met', label: 'Not met' },
            { value: 'no_longer_applicable', label: 'No longer applicable' },
          ],
          referenceOf: { stage: 'pre_conference', prompt: EXPECTATION_PROMPT },
          visibleWhen: 'reference_unanswered',
        },
      ],
    },
    {
      title: 'Expectations and value',
      description: 'Looking back at what you hoped to gain.',
      questions: [
        open('Which expectation was met most effectively?', 'Expectations met', false),
        open('Which expectation remains partly met or unmet?', 'Expectations met', false),
        open('What made ITTEC valuable to you?', 'Expectations met', false),
        open('What would have made your experience more valuable?', 'Expectations met', false),
      ],
    },
  ],
};
