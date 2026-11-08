import type { EventDetail } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssessmentConfig } from './assessment-config';

const stage = (s: EventDetail['assessmentStages'][number]['stage'], wave = 1, waveLabel = '') => ({
  stage: s,
  wave,
  waveLabel,
  dueAfterDays: null,
  reminderAfterDays: null,
  reminderLimit: 0,
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
  countTestDelegates: false,
  transferPlanVisibility: 'shown',
  transferPlanShownFrom: null,
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
    expect(calls[0]?.url).toBe('/api/v1/events/e1/assessments/pre_conference?wave=1');
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
        if (url.split('?')[0]!.endsWith('/summary')) {
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
    ).toBe('/admin/events/e1/assessments/pre_conference?wave=1');
  });

  it('offers the schedule while the waves are missing, and keeps the old round as it is', async () => {
    // An event from before the schedule existed: one follow-up round, no interval.
    const legacy: EventDetail = {
      ...event,
      assessmentStages: [stage('pre_conference'), stage('follow_up')],
    };
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const waved: EventDetail = {
      ...legacy,
      assessmentStages: [
        stage('pre_conference'),
        stage('follow_up'),
        { ...stage('follow_up', 2, '30-day follow-up'), dueAfterDays: 30 },
        { ...stage('follow_up', 3, '60-day follow-up'), dueAfterDays: 60 },
        { ...stage('follow_up', 4, '90-day follow-up'), dueAfterDays: 90 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method,
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
        });
        return new Response(JSON.stringify({ event: waved, waves: [], eligible: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const onSaved = vi.fn();
    render(<AssessmentConfig event={legacy} onSaved={onSaved} />);

    // The existing round keeps its plain name: it is not the 30-day wave.
    expect(screen.getByRole('form', { name: 'Follow-up assessment' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: '30-day follow-up' })).toBeNull();
    expect(screen.getByText(/one follow-up round from before the schedule/)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Create the 30, 60 and 90-day waves/ }));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/v1/events/e1/assessments/follow-ups');
    expect(post.body).toEqual({ waves: [1, 2, 3] });
    // The event is read again so the cards appear without a reload.
    expect(onSaved).toHaveBeenCalledWith(waved);
  });

  it('stops offering the schedule once the waves exist', () => {
    const scheduled: EventDetail = {
      ...event,
      assessmentStages: [
        { ...stage('follow_up', 1, '30-day follow-up'), dueAfterDays: 30 },
        { ...stage('follow_up', 2, '60-day follow-up'), dueAfterDays: 60 },
        { ...stage('follow_up', 3, '90-day follow-up'), dueAfterDays: 90 },
      ],
    };
    vi.stubGlobal('fetch', vi.fn());
    render(<AssessmentConfig event={scheduled} onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Create the 30, 60 and 90-day waves/ })).toBeNull();
  });

  it('shows each follow-up wave by its own name and acts on that wave alone', async () => {
    // Three waves of one stage, as the schedule creates them (E12-1).
    const waved: EventDetail = {
      ...event,
      assessmentStages: [
        stage('pre_conference'),
        { ...stage('follow_up', 1, '30-day follow-up'), dueAfterDays: 30 },
        { ...stage('follow_up', 2, '60-day follow-up'), dueAfterDays: 60 },
        { ...stage('follow_up', 3, '90-day follow-up'), dueAfterDays: 90 },
      ],
    };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({ event: waved }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    render(<AssessmentConfig event={waved} onSaved={vi.fn()} />);

    // Three cards, three names: not "Follow-up assessment" three times over.
    for (const label of ['30-day follow-up', '60-day follow-up', '90-day follow-up']) {
      expect(screen.getByRole('form', { name: label })).toBeTruthy();
    }
    // Each card's question editor opens its own wave.
    const sixty = screen.getByRole('form', { name: '60-day follow-up' });
    expect(
      within(sixty).getByRole('link', { name: 'Questions and submissions' }).getAttribute('href'),
    ).toBe('/admin/events/e1/assessments/follow_up?wave=2');
    const ninety = screen.getByRole('form', { name: '90-day follow-up' });
    expect(
      within(ninety).getByRole('link', { name: 'Questions and submissions' }).getAttribute('href'),
    ).toBe('/admin/events/e1/assessments/follow_up?wave=3');

    // Saving the 60-day card addresses wave 2, so enabling one wave never enables another.
    const user = userEvent.setup();
    await user.click(within(sixty).getByRole('button', { name: 'Save stage' }));
    expect(calls.some((u) => u.endsWith('/assessments/follow_up?wave=2'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/assessments/follow_up?wave=1'))).toBe(false);
  });
});
