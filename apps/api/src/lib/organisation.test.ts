import { describe, expect, it } from 'vitest';

import { delegateSearchFilter, displayOrganisation } from './organisation.js';

describe('displayOrganisation', () => {
  it('prefers the registration organisation and falls back to the nominating one', () => {
    expect(displayOrganisation({ organisation: 'Acme', nominatingOrganisation: 'Beta' })).toBe(
      'Acme',
    );
    expect(displayOrganisation({ organisation: null, nominatingOrganisation: 'Beta' })).toBe(
      'Beta',
    );
    expect(displayOrganisation({ organisation: '  ', nominatingOrganisation: ' Beta ' })).toBe(
      'Beta',
    );
    expect(displayOrganisation({ organisation: null, nominatingOrganisation: null })).toBeNull();
    expect(displayOrganisation({ organisation: '', nominatingOrganisation: '' })).toBeNull();
  });
});

describe('delegateSearchFilter', () => {
  it('matches the nominating organisation only where the organisation is empty', () => {
    const filter = delegateSearchFilter('acme');
    expect(filter.OR).toHaveLength(5);
    expect(filter.OR?.[4]).toEqual({
      AND: [
        { OR: [{ organisation: null }, { organisation: '' }] },
        { nominatingOrganisation: { contains: 'acme', mode: 'insensitive' } },
      ],
    });
  });
});
