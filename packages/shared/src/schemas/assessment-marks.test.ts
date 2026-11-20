import { describe, expect, it } from 'vitest';

import { pairedMarks, sectionMarkOf, type MyAssessment } from './assessments.js';

const knowledge = {
  id: 'k',
  type: 'single_choice' as const,
  isKnowledge: true,
  options: [
    { value: 'a', label: 'A', correct: true },
    { value: 'b', label: 'B' },
  ],
};
const rated = {
  id: 'r',
  type: 'single_choice' as const,
  isKnowledge: false,
  options: [
    { value: 'low', label: 'Low', score: 1 },
    { value: 'high', label: 'High', score: 5 },
  ],
};

describe('sectionMarkOf', () => {
  it('marks knowledge questions only, one point each', () => {
    expect(
      sectionMarkOf('knowledge', [knowledge, { ...knowledge, id: 'k2' }, rated], (id) =>
        id === 'k' ? 1 : 0,
      ),
    ).toEqual({ scored: 1, max: 2, percent: 50 });
  });

  it('never marks a rating-scale or text section for the delegate', () => {
    expect(sectionMarkOf('scored', [rated], () => 5)).toBeNull();
    expect(sectionMarkOf('none', [knowledge], () => 1)).toBeNull();
    expect(sectionMarkOf('knowledge', [rated], () => 5)).toBeNull();
  });
});

/** The least of an assessment the pairing reads: its stage, its sections and its marks. */
function assessment(
  stage: MyAssessment['stage'],
  sections: Array<{ id: string; sourceSectionId: string | null }>,
  marks: Record<string, number>,
  wave = 1,
): MyAssessment {
  return {
    stage,
    wave,
    waveLabel: '',
    sections: sections.map((sec) => ({ ...sec, title: sec.id, marking: 'knowledge' })),
    response: {
      sectionMarks: Object.fromEntries(
        Object.entries(marks).map(([id, percent]) => [id, { scored: percent, max: 100, percent }]),
      ),
    },
  } as unknown as MyAssessment;
}

describe('pairedMarks', () => {
  const pre = assessment('pre_conference', [{ id: 'p', sourceSectionId: null }], { p: 50 });
  const post = assessment('end_of_conference', [{ id: 'e', sourceSectionId: 'p' }], { e: 75 });
  const follow = assessment('follow_up', [{ id: 'f', sourceSectionId: 'p' }], {});

  it('finds the marks of the section this one repeats, and of the sections repeating it', () => {
    expect(
      pairedMarks([post, pre, follow], post, 'e').map((m) => [m.stage, m.mark.percent]),
    ).toEqual([['pre_conference', 50]]);
    // From the original's side the copy's mark pairs too; an unsubmitted copy has none.
    expect(
      pairedMarks([post, pre, follow], pre, 'p').map((m) => [m.stage, m.mark.percent]),
    ).toEqual([['end_of_conference', 75]]);
  });

  it('is empty for a section repeated nowhere, the general group and an unknown section', () => {
    const lone = assessment('during_conference', [{ id: 'd', sourceSectionId: null }], { d: 20 });
    expect(pairedMarks([pre, post, lone], lone, 'd')).toEqual([]);
    expect(pairedMarks([pre, post], post, 'general')).toEqual([]);
    expect(pairedMarks([pre, post], post, 'nope')).toEqual([]);
  });
});
