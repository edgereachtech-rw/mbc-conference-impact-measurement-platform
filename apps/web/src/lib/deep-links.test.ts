import { describe, expect, it } from 'vitest';

import {
  assessmentTarget,
  deepLinkDestination,
  deepLinkPath,
  deepLinkTab,
  reflectionTarget,
} from './deep-links';

describe('deep links', () => {
  it('accepts the sections a QR code can name and nothing else', () => {
    expect(deepLinkTab('reflections')).toBe('reflections');
    expect(deepLinkTab('transfer-plan')).toBe('transfer-plan');
    expect(deepLinkTab('assessment-end_of_conference-1')).toBe('assessment-end_of_conference-1');
    expect(deepLinkTab('assessment-follow_up-3')).toBe('assessment-follow_up-3');
    expect(deepLinkTab('assessment-follow_up-0')).toBeNull();
    expect(deepLinkTab('assessment-nonsense-1')).toBeNull();
    expect(deepLinkTab('reflection-44444444-4444-4444-8444-444444444444')).toBe(
      'reflection-44444444-4444-4444-8444-444444444444',
    );
    expect(deepLinkTab('reflection-not-an-id')).toBeNull();
    expect(deepLinkTab('overview')).toBeNull();
    expect(deepLinkTab('../admin')).toBeNull();
    expect(deepLinkTab('')).toBeNull();
  });

  it('builds the path the code carries and the page it lands on', () => {
    expect(assessmentTarget('end_of_conference', 1)).toBe('assessment-end_of_conference-1');
    expect(deepLinkPath('e1', 'reflections')).toBe('/go/e1/reflections');
    expect(reflectionTarget('a1')).toBe('reflection-a1');
    expect(deepLinkDestination('e1', 'transfer-plan')).toBe('/account/events/e1#transfer-plan');
  });
});
