import { describe, expect, it } from 'vitest';

import { answerIssue, countWords, questionFieldsSchema, wordLimitIssue } from './assessments.js';

describe('word limit on text questions', () => {
  it('counts runs of non-space characters', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one')).toBe(1);
    expect(countWords('  one two\n\nthree  ')).toBe(3);
    expect(countWords('well-known, ten-fold')).toBe(2);
  });

  it('refuses an answer over the limit, with the count, and nothing without a limit', () => {
    expect(wordLimitIssue(null, 'one two three')).toBeNull();
    expect(wordLimitIssue(3, 'one two three')).toBeNull();
    expect(wordLimitIssue(3, 'one two three four')).toBe('Keep your answer to 3 words (4 so far).');
    expect(wordLimitIssue(1, 'one two')).toBe('Keep your answer to 1 word (2 so far).');
    const long = { type: 'long_text' as const, options: null, scale: null, maxWords: 2 };
    expect(answerIssue(long, 'one two')).toBeNull();
    expect(answerIssue(long, 'one two three')).toBe('Keep your answer to 2 words (3 so far).');
    expect(answerIssue({ ...long, type: 'short_text' }, 'one two three')).toBe(
      'Keep your answer to 2 words (3 so far).',
    );
    // The character limits still come first.
    expect(answerIssue(long, '')).toBe('Enter an answer (up to 5,000 characters).');
  });

  it('is accepted on text questions only', () => {
    const base = { prompt: 'Why?', type: 'long_text' as const };
    expect(questionFieldsSchema.safeParse({ ...base, maxWords: 150 }).success).toBe(true);
    expect(questionFieldsSchema.safeParse({ ...base, maxWords: null }).success).toBe(true);
    expect(questionFieldsSchema.safeParse({ ...base, maxWords: 0 }).success).toBe(false);
    const rating = questionFieldsSchema.safeParse({
      prompt: 'How?',
      type: 'rating',
      scale: { min: 1, max: 5 },
      maxWords: 10,
    });
    expect(rating.success).toBe(false);
    expect(rating.error?.issues[0]?.path).toEqual(['maxWords']);
  });
});
