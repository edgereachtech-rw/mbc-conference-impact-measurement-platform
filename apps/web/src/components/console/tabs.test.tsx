import { act, render, screen } from '@testing-library/react';
import { useInsertionEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { TabStrip, useTabState } from './tabs';

type Id = 'overview' | 'attendance' | 'feedback';
const TABS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'attendance' as const, label: 'Attendance' },
  { id: 'feedback' as const, label: 'Feedback' },
];

function Screen({ ids = TABS.map((t) => t.id) }: { ids?: Id[] }) {
  const [current, choose] = useTabState<Id>(ids, 'overview');
  return (
    <>
      <TabStrip label="Records" tabs={TABS} current={current} onChoose={choose} />
      <p data-testid="current">{current}</p>
    </>
  );
}

/**
 * Next.js writes the address of the page it navigated to in an insertion effect, after the first
 * render and without a hashchange event. This wrapper does the same.
 */
function NavigatedTo({ hash, children }: { hash: string; children: React.ReactNode }) {
  useInsertionEffect(() => {
    window.history.replaceState(null, '', `/account/events/e1#${hash}`);
  }, [hash]);
  return <>{children}</>;
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('useTabState', () => {
  it('lands on the tab named in the address, even when it is written after the first render', () => {
    window.history.replaceState(null, '', '/account');
    render(
      <NavigatedTo hash="feedback">
        <Screen />
      </NavigatedTo>,
    );
    expect(screen.getByTestId('current').textContent).toBe('feedback');
    expect(screen.getByRole('tab', { name: 'Feedback' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('waits for a tab that is not known yet, then shows it once it is', () => {
    window.history.replaceState(null, '', '/account/events/e1#feedback');
    const { rerender } = render(<Screen ids={['overview', 'attendance']} />);
    expect(screen.getByTestId('current').textContent).toBe('overview');
    rerender(<Screen />);
    expect(screen.getByTestId('current').textContent).toBe('feedback');
  });

  it('keeps a chosen tab in the address, and the fallback as a bare address', () => {
    window.history.replaceState(null, '', '/account/events/e1');
    render(<Screen />);
    act(() => screen.getByRole('tab', { name: 'Attendance' }).click());
    expect(window.location.hash).toBe('#attendance');
    expect(screen.getByTestId('current').textContent).toBe('attendance');
    act(() => screen.getByRole('tab', { name: 'Overview' }).click());
    expect(window.location.hash).toBe('');
  });
});
