import { describe, expect, it } from 'vitest';

import { assessmentTarget, deepLinkDestination, deepLinkPath, deepLinkTab } from './deep-links';

describe('deep links', () => {
  it('accepts the sections a QR code can name and nothing else', () => {
    expect(deepLinkTab('reflections')).toBe('reflections');
    expect(deepLinkTab('transfer-plan')).toBe('transfer-plan');
    expect(deepLinkTab('assessment-end_of_conference-1')).toBe('assessment-end_of_conference-1');
    expect(deepLinkTab('assessment-follow_up-3')).toBe('assessment-follow_up-3');
    expect(deepLinkTab('assessment-follow_up-0')).toBeNull();
    expect(deepLinkTab('assessment-nonsense-1')).toBeNull();
    expect(deepLinkTab('overview')).toBeNull();
    expect(deepLinkTab('../admin')).toBeNull();
    expect(deepLinkTab('')).toBeNull();
  });

  it('builds the path the code carries and the page it lands on', () => {
    expect(assessmentTarget('end_of_conference', 1)).toBe('assessment-end_of_conference-1');
    expect(deepLinkPath('e1', 'reflections')).toBe('/go/e1/reflections');
    expect(deepLinkDestination('e1', 'transfer-plan')).toBe('/account/events/e1#transfer-plan');
  });
});
