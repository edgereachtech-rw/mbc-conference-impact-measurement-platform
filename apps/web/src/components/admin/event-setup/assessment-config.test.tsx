import type { EventDetail } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssessmentConfig } from './assessment-config';

const stage = (s: EventDetail['assessmentStages'][number]['stage']) => ({
  stage: s,
  enabled: false,
  opensAt: null,
  closesAt: null,
  target: 'all_delegates' as const,
  targetGroup: null,
  status: 'draft' as const,
  questionCount: 1,
  updatedAt: '2026-10-30T00:00:00Z',
});
const event: EventDetail = {
  id: 'e1',
  code: 'summit',
  slug: 'summit',
  name: 'Summit',
  description: 'd',
  eventType: 'summit',
  organiser: 'M.Bryan',
  format: 'virtual',
  timezone: 'Africa/Lagos',
  theme: null,
  location: null,
  website: null,
  imageUrl: null,
  additionalInfo: null,
  status: 'draft',
  startsOn: '2026-11-12',
  endsOn: '2026-11-12',
  dates: [{ id: 'd1', date: '2026-11-12' }],
  sessions: [],
  assessmentStages: [stage('pre_conference'), stage('during_conference'), stage('follow_up')],
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('AssessmentConfig', () => {
  it('shows three independent stages and saves one with its window converted from the event time zone', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ event }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const user = userEvent.setup();
    render(<AssessmentConfig event={event} onSaved={vi.fn()} />);
    expect(screen.getAllByRole('form')).toHaveLength(3);
    const pre = screen.getByRole('form', { name: 'Pre-conference assessment' });
    expect(within(pre).getByLabelText('Available from')).toHaveProperty('disabled', true);
    await user.click(within(pre).getByLabelText('Enabled for this event'));
    await user.type(within(pre).getByLabelText('Available from'), '2026-11-05T09:00');
    await user.type(within(pre).getByLabelText('Deadline'), '2026-11-01T09:00');
    await user.click(within(pre).getByRole('button', { name: 'Save stage' }));
    expect(within(pre).getByRole('alert').textContent).toMatch(/deadline must be later/);
    expect(calls).toHaveLength(0);

    await user.clear(within(pre).getByLabelText('Deadline'));
    await user.type(within(pre).getByLabelText('Deadline'), '2026-11-11T23:30');
    await user.selectOptions(within(pre).getByLabelText('Status'), 'scheduled');
    await user.click(within(pre).getByRole('button', { name: 'Save stage' }));
    expect(calls[0]?.url).toBe('/api/v1/events/e1/assessments/pre_conference');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      enabled: true,
      opensAt: '2026-11-05T08:00:00.000Z',
      closesAt: '2026-11-11T22:30:00.000Z',
      target: 'all_delegates',
      targetGroup: null,
      status: 'scheduled',
    });
    expect((await within(pre).findByRole('status')).textContent).toBe('Saved.');
    // The other stages were not touched.
    const follow = screen.getByRole('form', { name: 'Follow-up assessment' });
    expect(within(follow).getByLabelText('Enabled for this event')).toHaveProperty(
      'checked',
      false,
    );
  });

  it('shows what delegates see, the response counts and the link to the stage page', async () => {
    // Scheduled with an opening time in the past: open to delegates although nobody flipped it.
    const live: EventDetail = {
      ...event,
      status: 'active',
      assessmentStages: [
        {
          ...stage('pre_conference'),
          enabled: true,
          status: 'scheduled',
          opensAt: '2020-01-01T08:00:00.000Z',
          closesAt: '2099-01-01T00:00:00.000Z',
          questionCount: 4,
        },
        stage('during_conference'),
        stage('follow_up'),
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        if (url.endsWith('/summary')) {
          return json({
            summary: {
              stage: 'pre_conference',
              invited: 3,
              started: 2,
              submitted: 1,
              responseRate: 33.3,
              knowledge: null,
              statements: [],
            },
          });
        }
        return json({ event: live });
      }),
    );
    render(<AssessmentConfig event={live} onSaved={vi.fn()} />);
    const pre = screen.getByRole('form', { name: 'Pre-conference assessment' });
    await within(pre).findByText(/Open to delegates until 1 Jan 2099/);
    const responses = await within(pre).findByLabelText('Responses');
    expect(responses.textContent).toMatch(/Invited3Started2Submitted1 \(33\.3%\)/);
    expect(
      within(pre).getByRole('link', { name: 'Questions and submissions' }).getAttribute('href'),
    ).toBe('/admin/events/e1/assessments/pre_conference');
  });
});
