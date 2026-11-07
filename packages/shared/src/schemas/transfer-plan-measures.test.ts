import { describe, expect, it } from 'vitest';

import {
  compareMeasure,
  evidenceFieldsSchema,
  measureFieldsSchema,
  measureResultFieldsSchema,
  measuresSaveSchema,
  resultStateOf,
  summariseMeasures,
} from './transfer-plans.js';

const measure = (partial: Partial<Parameters<typeof compareMeasure>[0]> = {}) => ({
  kind: 'quantitative' as const,
  direction: 'unspecified' as const,
  baselineValue: '',
  baselineOn: null,
  targetValue: '',
  actualValue: '',
  actualOn: null,
  ...partial,
});

const defined = {
  name: 'Average response time',
  importance: 'Customers wait for answers',
  method: 'Average from the support records',
  unit: 'hours',
};
const paths = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.path.join('.'));

describe('measure validation (spec 2026-11-08)', () => {
  it('needs the name, why it matters, the method, and a unit for a quantitative measure', () => {
    expect(paths(measureFieldsSchema.safeParse({}))).toEqual(['name', 'importance', 'method']);
    expect(paths(measureFieldsSchema.safeParse({ ...defined, unit: '' }))).toEqual(['unit']);
    expect(
      measureFieldsSchema.safeParse({ ...defined, unit: '', kind: 'qualitative' }).success,
    ).toBe(true);
    const parsed = measureFieldsSchema.safeParse(defined);
    expect(parsed.success ? parsed.data : null).toMatchObject({
      baselineState: 'not_yet_known',
      targetState: 'not_yet_known',
      direction: 'unspecified',
    });
  });

  it('requires numbers only for a quantitative measure, and a value when the baseline or target is said to be known', () => {
    expect(paths(measureFieldsSchema.safeParse({ ...defined, baselineValue: '12%' }))).toEqual([
      'baselineValue',
    ]);
    expect(
      measureFieldsSchema.safeParse({ ...defined, baselineState: 'known', baselineValue: '48' })
        .success,
    ).toBe(true);
    expect(paths(measureFieldsSchema.safeParse({ ...defined, baselineState: 'known' }))).toEqual([
      'baselineValue',
    ]);
    expect(paths(measureFieldsSchema.safeParse({ ...defined, targetState: 'set' }))).toEqual([
      'targetValue',
    ]);
    expect(
      measureFieldsSchema.safeParse({
        ...defined,
        kind: 'qualitative',
        baselineState: 'known',
        baselineValue: 'Two manual steps',
      }).success,
    ).toBe(true);
  });

  it('saves with the action choice: identified needs at least one measure', () => {
    expect(
      measuresSaveSchema.safeParse({ version: 3, measureStatus: 'identified', measures: [] })
        .success,
    ).toBe(false);
    expect(
      measuresSaveSchema.safeParse({ version: 3, measureStatus: 'not_yet_known', measures: [] })
        .success,
    ).toBe(true);
    expect(
      measuresSaveSchema.safeParse({ version: 3, measureStatus: 'identified', measures: [defined] })
        .success,
    ).toBe(true);
    expect(
      measuresSaveSchema.safeParse({
        version: 3,
        measureStatus: 'identified',
        measures: Array.from({ length: 21 }, () => defined),
      }).success,
    ).toBe(false);
    expect(measuresSaveSchema.safeParse({ measures: [] }).success).toBe(false);
  });
});

describe('result validation', () => {
  const result = {
    value: '30',
    resultOn: '2027-04-30',
    method: 'Average response time calculated from customer-support records',
    sourceType: 'workplace_records',
  };
  it('needs the value, its date, how it was obtained and the source type', () => {
    expect(paths(measureResultFieldsSchema.safeParse({}))).toEqual([
      'value',
      'resultOn',
      'method',
      'sourceType',
    ]);
    const parsed = measureResultFieldsSchema.safeParse(result);
    expect(parsed.success ? parsed.data : null).toMatchObject({
      isFinal: false,
      hasInfluences: false,
      support: 'self_reported',
      meaning: '',
    });
  });

  it('asks for the source when it is "other" and for the factors when there are any', () => {
    expect(paths(measureResultFieldsSchema.safeParse({ ...result, sourceType: 'other' }))).toEqual([
      'source',
    ]);
    expect(paths(measureResultFieldsSchema.safeParse({ ...result, hasInfluences: true }))).toEqual([
      'influences',
    ]);
    expect(
      measureResultFieldsSchema.safeParse({
        ...result,
        sourceType: 'other',
        source: 'Quarterly client survey',
        hasInfluences: true,
        influences: 'A new colleague joined the team',
      }).success,
    ).toBe(true);
  });

  it('counts how far the results have come', () => {
    expect(resultStateOf({ results: [] })).toBe('no_result');
    expect(resultStateOf({ results: [1] })).toBe('with_result');
    expect(resultStateOf({ results: [1, 2] })).toBe('updated');
  });
});

describe('evidence validation', () => {
  it('needs a description and nothing else, and may point at a measure', () => {
    expect(evidenceFieldsSchema.safeParse({ description: '  ' }).success).toBe(false);
    const parsed = evidenceFieldsSchema.safeParse({ description: 'Ran the new checklist' });
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data : null).toMatchObject({
      type: 'example',
      support: 'self_reported',
      supportedBy: '',
      reference: '',
      measureId: null,
    });
    expect(
      evidenceFieldsSchema.safeParse({ description: 'Report', measureId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('summariseMeasures', () => {
  const m = (b = '', a = '') => ({ baselineValue: b, actualValue: a });
  it('reads the action choice first, then the measures', () => {
    expect(summariseMeasures(null, [])).toBe('none');
    expect(summariseMeasures('not_applicable', [])).toBe('not_applicable');
    expect(summariseMeasures('not_yet_known', [])).toBe('not_yet_known');
    expect(summariseMeasures('identified', [])).toBe('identified');
    expect(summariseMeasures('identified', [m()])).toBe('identified');
    expect(summariseMeasures('identified', [m(), m('4')])).toBe('baseline_only');
    expect(summariseMeasures('identified', [m('4'), m('', '2')])).toBe('with_result');
    // A measure left from before a choice still counts as identified.
    expect(summariseMeasures(null, [m()])).toBe('identified');
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

  it('never draws a conclusion without a direction, numbers or dates in order', () => {
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
