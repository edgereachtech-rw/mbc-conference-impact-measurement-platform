import { describe, expect, it } from 'vitest';

import { answerMatchesCondition, askedQuestionIds, describeCondition } from './assessments.js';

const yesNo = { id: 'q1', questionKey: 'k1', order: 1, type: 'yes_no' as const };
const reason = {
  id: 'q2',
  questionKey: 'k2',
  order: 2,
  type: 'long_text' as const,
  conditionalQuestionKey: 'k1',
  conditionalValues: ['true'],
};
const who = {
  id: 'q3',
  questionKey: 'k3',
  order: 3,
  type: 'multiple_choice' as const,
  conditionalQuestionKey: 'k1',
  conditionalValues: ['true'],
};
// Depends on a conditional question: hidden whenever that one is.
const detail = {
  id: 'q4',
  questionKey: 'k4',
  order: 4,
  type: 'short_text' as const,
  conditionalQuestionKey: 'k3',
  conditionalValues: ['other'],
};
const always = { id: 'q5', questionKey: 'k5', order: 5, type: 'rating' as const };
const questions = [detail, always, who, reason, yesNo];

describe('answerMatchesCondition', () => {
  it('matches yes/no, single and multiple choice answers, and never a blank', () => {
    expect(answerMatchesCondition('yes_no', true, ['true'])).toBe(true);
    expect(answerMatchesCondition('yes_no', false, ['true'])).toBe(false);
    expect(answerMatchesCondition('yes_no', 'true', ['true'])).toBe(false);
    expect(answerMatchesCondition('single_choice', 'hr', ['hr', 'ld'])).toBe(true);
    expect(answerMatchesCondition('single_choice', 'ops', ['hr', 'ld'])).toBe(false);
    expect(answerMatchesCondition('multiple_choice', { selected: ['a', 'other'] }, ['other'])).toBe(
      true,
    );
    expect(answerMatchesCondition('multiple_choice', ['other'], ['other'])).toBe(true);
    expect(answerMatchesCondition('multiple_choice', { selected: ['a'] }, ['other'])).toBe(false);
    expect(answerMatchesCondition('yes_no', undefined, ['true'])).toBe(false);
    expect(answerMatchesCondition('single_choice', '', [''])).toBe(false);
  });
});

describe('askedQuestionIds', () => {
  it('asks unconditional questions always, and conditional ones only once their answer matches', () => {
    const asked = (answers: Record<string, unknown>) =>
      [...askedQuestionIds(questions, (id) => answers[id])].sort();
    expect(asked({})).toEqual(['q1', 'q5']);
    expect(asked({ q1: false })).toEqual(['q1', 'q5']);
    expect(asked({ q1: true })).toEqual(['q1', 'q2', 'q3', 'q5']);
    // A chain: the detail follows the multiple choice, which follows the yes/no.
    expect(asked({ q1: true, q3: { selected: ['other'] } })).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
      'q5',
    ]);
    // Flipping the first answer hides the chain even though the later answers are still there.
    expect(asked({ q1: false, q3: { selected: ['other'] }, q2: 'stale' })).toEqual(['q1', 'q5']);
  });

  it('ignores a condition on a question that is not in the assessment', () => {
    const orphan = { ...reason, conditionalQuestionKey: 'missing' };
    expect([...askedQuestionIds([yesNo, orphan], () => true)]).toEqual(['q1']);
  });
});

describe('describeCondition', () => {
  it('names the controlling question and the answers by their labels', () => {
    expect(describeCondition({ prompt: 'Were you nominated?', type: 'yes_no' }, ['true'])).toBe(
      'Asked only when “Were you nominated?” is answered Yes',
    );
    expect(
      describeCondition(
        {
          prompt: 'Your role?',
          type: 'single_choice',
          options: [
            { value: 'hr', label: 'HR' },
            { value: 'ld', label: 'L&D' },
            { value: 'ops', label: 'Operations' },
          ],
        },
        ['hr', 'ld', 'ops'],
      ),
    ).toBe('Asked only when “Your role?” is answered HR, L&D or Operations');
  });
});
