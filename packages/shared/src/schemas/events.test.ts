import { describe, expect, it } from 'vitest';

import { stageWindowState } from './events.js';

describe('stageWindowState', () => {
  const window = {
    opensAt: '2026-11-06T08:00:00.000Z',
    closesAt: '2026-11-12T08:00:00.000Z',
  };
  const before = new Date('2026-11-05T12:00:00.000Z');
  const during = new Date('2026-11-08T12:00:00.000Z');
  const after = new Date('2026-11-13T12:00:00.000Z');

  it('hides draft and disabled stages and keeps closed stages closed whatever the dates', () => {
    expect(stageWindowState({ status: 'draft', ...window }, during)).toBe('hidden');
    expect(stageWindowState({ enabled: false, status: 'open', ...window }, during)).toBe('hidden');
    expect(stageWindowState({ status: 'closed', ...window }, during)).toBe('closed');
  });

  it('opens a scheduled stage by itself at its opening time and closes it at the deadline', () => {
    expect(stageWindowState({ status: 'scheduled', ...window }, before)).toBe('upcoming');
    expect(stageWindowState({ status: 'scheduled', ...window }, during)).toBe('open');
    expect(stageWindowState({ status: 'scheduled', ...window }, after)).toBe('closed');
  });

  it('treats an open stage the same way and accepts Date values and missing bounds', () => {
    expect(stageWindowState({ status: 'open', ...window }, before)).toBe('upcoming');
    expect(
      stageWindowState(
        { status: 'open', opensAt: new Date(window.opensAt), closesAt: new Date(window.closesAt) },
        during,
      ),
    ).toBe('open');
    expect(stageWindowState({ status: 'open', ...window }, after)).toBe('closed');
    expect(stageWindowState({ status: 'open', opensAt: null, closesAt: null }, after)).toBe('open');
  });
});
