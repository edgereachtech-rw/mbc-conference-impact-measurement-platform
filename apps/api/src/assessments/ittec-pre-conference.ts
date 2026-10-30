import type { QuestionFields, SectionMarking } from '@mbc/shared';

/**
 * ITTEC 2026 pre-conference assessment content (docs/full_platform_requirement.md, section 7).
 * This is the pilot event's data, not platform behaviour: `db:seed` loads it once into the
 * ITTEC event's empty pre-conference stage. The platform's format (sections, question types,
 * scoring) is what every event shares; other events enter their own questions.
 */

export interface TemplateSection {
  title: string;
  description: string | null;
  /** Marking of the section's single-choice questions; "none" when omitted. */
  marking?: SectionMarking;
  questions: QuestionFields[];
}

export interface AssessmentTemplate {
  id: string;
  label: string;
  stage: 'pre_conference' | 'during_conference' | 'follow_up';
  sections: TemplateSection[];
}

const FREQUENCY = [
  { value: 'always', label: 'Always', score: 5 },
  { value: 'often', label: 'Often', score: 4 },
  { value: 'sometimes', label: 'Sometimes', score: 3 },
  { value: 'rarely', label: 'Rarely', score: 2 },
  { value: 'never', label: 'Never', score: 1 },
  { value: 'na', label: 'Not applicable to my role', score: null },
];

const CONFIDENCE = [
  { value: '1', label: '1 – Not at all confident', score: 1 },
  { value: '2', label: '2 – Slightly confident', score: 2 },
  { value: '3', label: '3 – Moderately confident', score: 3 },
  { value: '4', label: '4 – Very confident', score: 4 },
  { value: '5', label: '5 – Extremely confident', score: 5 },
  { value: 'na', label: 'Not applicable to my role', score: null },
];

const NOT_SURE = { value: 'e', label: 'I am not sure' };

const statement = (prompt: string, options: typeof FREQUENCY, area: string): QuestionFields => ({
  prompt,
  helpText: null,
  type: 'single_choice',
  required: true,
  area,
  options,
});

const knowledge = (
  prompt: string,
  answers: Array<[string, string]>,
  correct: string,
): QuestionFields => ({
  prompt,
  helpText: null,
  type: 'single_choice',
  required: true,
  area: 'Baseline knowledge',
  options: [
    ...answers.map(([value, label]) => ({ value, label, correct: value === correct })),
    NOT_SURE,
  ],
});

const open = (
  prompt: string,
  required = true,
  area = 'Expectations and learning objectives',
): QuestionFields => ({
  prompt,
  helpText: null,
  type: 'long_text',
  required,
  area,
});

export const ITTEC_PRE_CONFERENCE: AssessmentTemplate = {
  id: 'ittec-2026-pre-conference',
  label: 'ITTEC 2026 pre-conference assessment (pilot content)',
  stage: 'pre_conference',
  sections: [
    {
      title: 'Expectations and challenges',
      description:
        'Tell us what you expect from the conference and the challenges you would like it to help with.',
      questions: [
        open('What are your main reasons for attending ITTEC 2026?'),
        open('What would you like to learn or gain from the conference?'),
        open(
          'What challenge relating to training application, measurement or business results would you like ITTEC to help you address?',
          true,
          'Existing challenges related to the subject',
        ),
        open('What would make attending ITTEC valuable to you?', false),
        open('What would you like to do differently after the conference?'),
      ],
    },
    {
      title: 'Current practices',
      marking: 'scored',
      description: 'For each statement, select how often it applies. Before training is selected…',
      questions: [
        'I or my organisation identify the performance or business need.',
        'I or my organisation establish what stakeholders expect training to achieve.',
        'I or my organisation identify relevant measures before training begins.',
        'I or my organisation plan how participants will apply learning in the workplace.',
        'I or my organisation involve line managers or other relevant stakeholders in supporting application.',
        'I or my organisation follow up to find out whether participants applied their learning.',
        'I or my organisation assess whether training contributed to workplace or business results.',
      ].map((prompt) => statement(prompt, FREQUENCY, 'Current practices')),
    },
    {
      title: 'Baseline knowledge assessment',
      marking: 'knowledge',
      description:
        'The following questions assess selected concepts relevant to ITTEC. They do not cover everything you may learn during the conference. Please answer based on your current knowledge. If you are unsure of an answer, select “I am not sure.”',
      questions: [
        knowledge(
          'A team is missing a performance target. What should be done before deciding that training is the solution?',
          [
            ['a', 'Immediately enrol the entire team in a training programme.'],
            ['b', 'Examine the performance gap and its possible causes.'],
            [
              'c',
              'Ask a trainer to deliver the most popular course to address the performance target that they keep missing.',
            ],
            ['d', 'Measure participant satisfaction with previous training.'],
          ],
          'b',
        ),
        knowledge(
          'Which action best supports the application of learning after training?',
          [
            ['a', 'Expecting participants to apply learning without discussing it at work.'],
            ['b', 'Providing a certificate at the end of training.'],
            [
              'c',
              'Agreeing on opportunities to apply learning and securing relevant workplace support.',
            ],
            ['d', 'Measuring attendance only.'],
          ],
          'c',
        ),
        knowledge(
          'Which of the following is the clearest example of a training application measure?',
          [
            ['a', 'The number of people registered for a course.'],
            ['b', 'Participants’ ratings of the venue.'],
            ['c', 'The number of training hours delivered.'],
            ['d', 'The percentage of participants using the agreed skill on the job.'],
          ],
          'd',
        ),
        knowledge(
          'Why should relevant performance or business measures be identified before a training initiative?',
          [
            ['a', 'To establish a starting point and track relevant changes over time.'],
            ['b', 'To guarantee that all later improvements were caused by training.'],
            ['c', 'To replace the need for application support.'],
            ['d', 'To measure only how much participants enjoyed training.'],
          ],
          'a',
        ),
        knowledge(
          'What does Return on Expectations assess?',
          [
            ['a', 'Whether every participant received a certificate.'],
            ['b', 'The number of training sessions delivered.'],
            ['c', 'The extent to which agreed stakeholder expectations were met.'],
            ['d', 'The cost of the training venue alone.'],
          ],
          'c',
        ),
      ],
    },
    {
      title: 'Baseline confidence assessment',
      marking: 'scored',
      description: 'How confident are you in your ability to:',
      questions: [
        'Identify questions to ask before deciding whether training is the right response to a performance need?',
        'Discuss stakeholder expectations before a training initiative?',
        'Identify a relevant measure and establish a baseline?',
        'Plan how learning will be applied in the workplace?',
        'Identify the support needed from line managers or other stakeholders?',
        'Track whether participants have applied what they learned?',
        'Identify evidence that may show a contribution to workplace or business results?',
      ].map((prompt) => statement(prompt, CONFIDENCE, 'Current confidence level')),
    },
    {
      title: 'Current use of tools and practices',
      description: null,
      questions: [
        {
          prompt:
            'Which of the following do you currently use in your work? Select all that apply.',
          helpText: null,
          type: 'multiple_choice',
          required: true,
          area: 'Current practices',
          options: [
            {
              value: 'gap_process',
              label: 'A process for identifying the cause of a performance gap.',
            },
            {
              value: 'expectations_record',
              label: 'A document or process for recording stakeholder expectations.',
            },
            {
              value: 'baseline_data',
              label: 'Baseline data or performance measures before training.',
            },
            { value: 'transfer_plan', label: 'A participant action or transfer plan.' },
            {
              value: 'line_manager_process',
              label: 'A process for involving line managers in supporting application.',
            },
            {
              value: 'follow_up_process',
              label: 'A follow-up process for checking workplace application.',
            },
            {
              value: 'evidence_method',
              label: 'A method for gathering evidence of workplace or business results.',
            },
            { value: 'none', label: 'None of the above.', exclusive: true },
            { value: 'na', label: 'Not applicable to my role.', exclusive: true },
            { value: 'other', label: 'Other: please specify.', other: true },
          ],
        },
      ],
    },
  ],
};
