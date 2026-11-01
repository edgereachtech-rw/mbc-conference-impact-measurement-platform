import { describe, expect, it } from 'vitest';

import {
  compareMeasure,
  evidenceFieldsSchema,
  measureFieldsSchema,
  measuresSaveSchema,
  summariseMeasures,
} from './transfer-plans.js';

const measure = (partial: Partial<Parameters<typeof compareMeasure>[0]> = {}) => ({
  status: 'identified' as const,
  kind: 'quantitative' as const,
  direction: 'unspecified' as const,
  baselineValue: '',
  baselineOn: null,
  targetValue: '',
  actualValue: '',
  actualOn: null,
  ...partial,
});

describe('measure validation', () => {
  it('accepts an empty, incomplete measure and the not-known / not-applicable statuses', () => {
    expect(measureFieldsSchema.safeParse({}).success).toBe(true);
    expect(measureFieldsSchema.safeParse({ status: 'not_yet_known' }).success).toBe(true);
    expect(
      measureFieldsSchema.safeParse({ status: 'not_applicable', name: 'Error rate' }).success,
    ).toBe(true);
  });

  it('requires numbers only for a quantitative measure, and never a unit', () => {
    const bad = measureFieldsSchema.safeParse({ kind: 'quantitative', baselineValue: '12%' });
    expect(bad.success).toBe(false);
    expect(bad.success ? [] : bad.error.issues.map((i) => i.path.join('.'))).toEqual([
      'baselineValue',
    ]);
    expect(
      measureFieldsSchema.safeParse({ kind: 'quantitative', baselineValue: '12', unit: '%' })
        .success,
    ).toBe(true);
    expect(
      measureFieldsSchema.safeParse({ kind: 'quantitative', actualValue: '-3.5' }).success,
    ).toBe(true);
    expect(
      measureFieldsSchema.safeParse({ kind: 'qualitative', baselineValue: 'Two manual steps' })
        .success,
    ).toBe(true);
  });

  it('caps a save at 20 measures and carries the plan version', () => {
    expect(measuresSaveSchema.safeParse({ version: 3, measures: [] }).success).toBe(true);
    expect(
      measuresSaveSchema.safeParse({ version: 3, measures: Array.from({ length: 21 }, () => ({})) })
        .success,
    ).toBe(false);
    expect(measuresSaveSchema.safeParse({ measures: [] }).success).toBe(false);
  });
});

describe('evidence validation', () => {
  it('needs a description and nothing else', () => {
    expect(evidenceFieldsSchema.safeParse({ description: '  ' }).success).toBe(false);
    const parsed = evidenceFieldsSchema.safeParse({ description: 'Ran the new checklist' });
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data : null).toMatchObject({
      type: 'example',
      support: 'self_reported',
      supportedBy: '',
      reference: '',
    });
  });
});

describe('summariseMeasures', () => {
  const m = (status: 'identified' | 'not_yet_known' | 'not_applicable', b = '', a = '') => ({
    status,
    baselineValue: b,
    actualValue: a,
  });
  it('distinguishes none, not yet known, not applicable, identified, baseline only and result', () => {
    expect(summariseMeasures([])).toBe('none');
    expect(summariseMeasures([m('not_applicable')])).toBe('not_applicable');
    expect(summariseMeasures([m('not_applicable'), m('not_yet_known')])).toBe('not_yet_known');
    expect(summariseMeasures([m('identified')])).toBe('identified');
    expect(summariseMeasures([m('not_yet_known'), m('identified', '4')])).toBe('baseline_only');
    expect(summariseMeasures([m('identified', '4'), m('identified', '', '2')])).toBe('with_result');
    // A value on a measure that is not identified does not count.
    expect(summariseMeasures([m('not_applicable', '4', '2')])).toBe('not_applicable');
  });
});

describe('compareMeasure', () => {
  it('reads a decrease as an improvement when lower is better', () => {
    const r = compareMeasure(
      measure({ direction: 'lower', baselineValue: '12', actualValue: '8', targetValue: '9' }),
    );
    expect(r).toEqual({ outcome: 'improved', change: -4, targetMet: true, reason: null });
    const worse = compareMeasure(
      measure({ direction: 'lower', baselineValue: '8', actualValue: '12' }),
    );
    expect(worse.outcome).toBe('declined');
    expect(worse.targetMet).toBeNull();
  });

  it('reads an increase as an improvement only when higher is better', () => {
    expect(
      compareMeasure(
        measure({ direction: 'higher', baselineValue: '40', actualValue: '55', targetValue: '60' }),
      ),
    ).toEqual({ outcome: 'improved', change: 15, targetMet: false, reason: null });
    expect(
      compareMeasure(measure({ direction: 'higher', baselineValue: '40', actualValue: '40' }))
        .outcome,
    ).toBe('unchanged');
  });

  it('compares distances when closer to the target is better', () => {
    expect(
      compareMeasure(
        measure({ direction: 'target', baselineValue: '70', actualValue: '48', targetValue: '50' }),
      ),
    ).toMatchObject({ outcome: 'improved', change: -22, targetMet: false });
    expect(
      compareMeasure(measure({ direction: 'target', baselineValue: '70', actualValue: '48' })),
    ).toMatchObject({ outcome: 'not_comparable', change: -22 });
  });

  it('never draws a conclusion without a direction, numbers, an identified measure or dates in order', () => {
    expect(compareMeasure(measure({ baselineValue: '1', actualValue: '2' }))).toMatchObject({
      outcome: 'not_comparable',
      change: 1,
      reason: 'Direction of improvement not stated.',
    });
    expect(
      compareMeasure(measure({ direction: 'higher', kind: 'qualitative', baselineValue: 'slow' })),
    ).toMatchObject({ outcome: 'not_comparable', change: null });
    expect(compareMeasure(measure({ direction: 'higher', baselineValue: '1' })).reason).toMatch(
      /numeric/,
    );
    expect(compareMeasure(measure({ status: 'not_yet_known', direction: 'higher' })).outcome).toBe(
      'not_comparable',
    );
    expect(
      compareMeasure(
        measure({
          direction: 'higher',
          baselineValue: '1',
          baselineOn: '2027-02-01',
          actualValue: '2',
          actualOn: '2027-01-01',
        }),
      ),
    ).toMatchObject({ outcome: 'not_comparable', reason: /before the baseline/ });
  });

  it('keeps floating-point noise out of the change', () => {
    expect(
      compareMeasure(measure({ direction: 'higher', baselineValue: '0.1', actualValue: '0.3' }))
        .change,
    ).toBe(0.2);
  });
});
