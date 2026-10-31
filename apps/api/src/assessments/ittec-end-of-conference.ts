import type { QuestionFields } from '@mbc/shared';

import type { AssessmentTemplate } from './ittec-pre-conference.js';

/**
 * ITTEC 2026 end-of-conference evaluation content (docs/backlog.md, Appendix A6; requirement
 * section 10). Pilot data, loaded once by `db:seed` into the ITTEC event's empty
 * end-of-conference stage. The knowledge and confidence sections repeat the pre-conference
 * sections (mirrored, so answers pair per delegate); the expectations and readiness blocks are
 * the platform's built-in blocks. Other events write their own content in the same format.
 */

const EXPERIENCE = [
  { value: 'excellent', label: 'Excellent', score: 4 },
  { value: 'good', label: 'Good', score: 3 },
  { value: 'fair', label: 'Fair', score: 2 },
  { value: 'poor', label: 'Poor', score: 1 },
  { value: 'na', label: 'Not applicable', score: null },
];

const rating = (prompt: string, area: string): QuestionFields => ({
  prompt,
  helpText: null,
  type: 'single_choice',
  required: true,
  area,
  options: EXPERIENCE,
});

const open = (prompt: string, area: string, required = true): QuestionFields => ({
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
    { title: 'Your expectations', description: null, builtin: 'expectations', questions: [] },
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
