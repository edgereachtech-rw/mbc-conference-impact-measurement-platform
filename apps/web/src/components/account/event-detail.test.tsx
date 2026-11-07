import type { MyEvent } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventDetail } from './event-detail';

const lagos: MyEvent = {
  id: 'e1',
  slug: 'ittec-2026',
  name: 'ITTEC 2026',
  theme: null,
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  timezone: 'Africa/Lagos',
  location: 'Lagos Oriental Hotel',
  format: 'hybrid',
  period: 'upcoming',
  registration: {
    id: 'd1',
    status: 'active',
    attendanceFormat: 'virtual',
    capacity: 'nominee',
    organisation: 'Acme',
    jobTitle: null,
    country: 'Nigeria',
    signedUpAt: '2026-10-29T15:34:07.015Z',
  },
  attendance: { status: 'pending' },
};

/** One assessment as the API lists it, with just enough for the tab and its card to render. */
const form = (stage: string, wave: number, waveLabel: string, status: string) => ({
  stage,
  wave,
  waveLabel,
  status,
  opensAt: null,
  closesAt: null,
  sections: [],
  questions: [],
  response: null,
  feedback: {},
  canAnswer: status === 'open',
  context: { references: [], referenceAnswers: {}, planStatus: null, plan: null },
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('EventDetail', () => {
  it('shows the event facts, the registration, attendance only as not recorded, and the journey for an upcoming event', () => {
    render(<EventDetail event={lagos} contactEmail="conference@example.com" />);
    const facts = screen.getByRole('region', { name: 'Event' });
    expect(within(facts).getByText('12-13 November 2026')).toBeTruthy();
    expect(within(facts).getByText('Africa/Lagos')).toBeTruthy();
    expect(within(facts).getByText('Lagos Oriental Hotel')).toBeTruthy();
    expect(within(facts).getByText('Hybrid')).toBeTruthy();
    const reg = screen.getByRole('region', { name: 'Your registration' });
    expect(within(reg).getByText('Registered')).toBeTruthy();
    expect(within(reg).getByText('Online')).toBeTruthy();
    expect(within(reg).getByText('Acme')).toBeTruthy();
    expect(within(reg).getByText('Not provided')).toBeTruthy(); // job title
    expect(within(reg).getByText('Nominated by an organisation')).toBeTruthy();
    expect(within(reg).getByText('29 October 2026')).toBeTruthy();
    expect(within(reg).getByText('Pending')).toBeTruthy();
    expect(within(reg).getByRole('link', { name: 'conference@example.com' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Your journey' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByText(/attended/i)).toBeNull();
  });

  it('arranges the records in tabs, opens the tab named in the address and keeps the choice in it', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const reminder = {
          frequency: 'none',
          startOn: null,
          endOn: null,
          time: '09:00',
          days: [],
          nextReminderAt: null,
        };
        const body = url.endsWith('/transfer-plans')
          ? {
              plans: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  sequence: 1,
                  date: '2026-11-12',
                  day: 1,
                  session: null,
                  isPriority: false,
                  title: '',
                  status: 'draft',
                  actions: 0,
                  priorityAction: null,
                  submittedAt: null,
                  completedAt: null,
                  outcome: 'pending',
                  checkDue: false,
                  updatedAt: '2026-11-12T10:00:00.000Z',
                  reminder,
                },
                {
                  id: '11111111-1111-4111-8111-222222222222',
                  sequence: 2,
                  date: '2026-11-13',
                  day: 2,
                  session: null,
                  isPriority: false,
                  title: 'Coaching rollout',
                  status: 'draft',
                  actions: 1,
                  priorityAction: 'Coach two team leads',
                  submittedAt: null,
                  completedAt: null,
                  outcome: 'pending',
                  checkDue: false,
                  updatedAt: '2026-11-12T10:00:00.000Z',
                  reminder,
                },
              ],
              today: '2026-11-13',
              days: [
                {
                  date: '2026-11-12',
                  day: 1,
                  session: null,
                  planId: '11111111-1111-4111-8111-111111111111',
                },
                {
                  date: '2026-11-13',
                  day: 2,
                  session: null,
                  planId: '11111111-1111-4111-8111-222222222222',
                },
              ],
              create: { reason: 'all_created', days: [] },
              finalDay: { date: '2026-11-13', reached: true },
              canSubmitAll: true,
            }
          : url.includes('/transfer-plans/')
            ? {
                plan: {
                  id: '11111111-1111-4111-8111-111111111111',
                  eventId: '22222222-2222-4222-8222-222222222222',
                  sequence: 1,
                  title: '',
                  status: 'draft',
                  version: 1,
                  submittedAt: null,
                  completedAt: null,
                  updatedAt: '2026-11-12T10:00:00.000Z',
                  reminder,
                  actions: [],
                },
                sessions: [],
                canSubmit: false,
                references: [],
                reminders: [],
              }
            : url.endsWith('/assessments')
              ? {
                  // Three stages, served out of journey order: the tabs put them in it.
                  assessments: [
                    form('follow_up', 1, '30-day follow-up', 'not_yet_open'),
                    form('end_of_conference', 1, '', 'not_yet_open'),
                    form('pre_conference', 1, '', 'open'),
                  ],
                }
              : url.endsWith('/reflections')
                ? {
                    reflections: [
                      {
                        id: '44444444-4444-4444-8444-444444444444',
                        date: '2026-11-12',
                        title: 'Day 1 reflection',
                        status: 'open',
                        opensAt: null,
                        closesAt: null,
                        questions: [],
                        submission: null,
                        canSubmit: true,
                      },
                    ],
                  }
                : { sessions: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    window.location.hash = '#transfer-plan';
    const user = userEvent.setup();
    render(<EventDetail event={lagos} contactEmail="c@x" />);
    const tabs = screen.getByRole('tablist', { name: 'Your records for this event' });
    // Each assessment is a tab of its own, in the order the delegate meets it (2026-11-06).
    await vi.waitFor(() =>
      expect(
        within(tabs)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual([
        'Overview',
        'Pre-conference assessment',
        'Attendance',
        'Day 1 reflection',
        'Session feedback',
        'Transfer plans',
        'End-of-conference evaluation',
        '30-day follow-up',
      ]),
    );
    expect(
      within(tabs).getByRole('tab', { name: 'Transfer plans' }).getAttribute('aria-selected'),
    ).toBe('true');
    // The plans are tabs inside the tab (2026-11-07): one per day, the latest open one (today's)
    // is on, the other a tap away.
    const planTabs = await screen.findByRole('tablist', { name: 'Your plans' });
    expect(
      within(planTabs)
        .getAllByRole('tab')
        .map((t) => t.getAttribute('aria-selected')),
    ).toEqual(['false', 'true']);
    expect(within(planTabs).getByRole('tab', { name: /Coaching rollout/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Event' })).toBeNull();
    expect(calls).toContain('/api/v1/me/events/e1/transfer-plans');
    expect(calls).toContain('/api/v1/me/events/e1/assessments');

    await user.click(within(tabs).getByRole('tab', { name: '30-day follow-up' }));
    expect(window.location.hash).toBe('#assessment-follow_up-1');
    expect(screen.getByRole('tabpanel', { name: '30-day follow-up' })).toBeTruthy();
    expect(screen.getByRole('article', { name: '30-day follow-up' }).textContent).toMatch(
      /Opens later/,
    );

    await user.click(within(tabs).getByRole('tab', { name: 'Pre-conference assessment' }));
    expect(window.location.hash).toBe('#assessment-pre_conference-1');
    expect(screen.getByRole('article', { name: 'Pre-conference assessment' }).textContent).toMatch(
      /Open/,
    );

    await user.click(within(tabs).getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('region', { name: 'Event' })).toBeTruthy();
    expect(window.location.hash).toBe('');
  });

  it('lands an old #assessments link on the assessment to act on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/assessments')
          ? {
              assessments: [
                form('pre_conference', 1, '', 'submitted'),
                form('end_of_conference', 1, '', 'open'),
              ],
            }
          : url.endsWith('/transfer-plans')
            ? {
                plans: [],
                today: '2026-11-05',
                days: [
                  { date: '2026-11-12', day: 1, session: null, planId: null },
                  { date: '2026-11-13', day: 2, session: null, planId: null },
                ],
                create: { reason: 'before_event', days: [] },
                finalDay: { date: '2026-11-13', reached: false },
                canSubmitAll: false,
              }
            : { reflections: [], sessions: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    window.location.hash = '#assessments';
    render(<EventDetail event={lagos} contactEmail="c@x" />);
    const tabs = screen.getByRole('tablist', { name: 'Your records for this event' });
    // The open one, not the first: the submitted pre-conference stage is done with.
    await vi.waitFor(() =>
      expect(
        within(tabs)
          .getByRole('tab', { name: 'End-of-conference evaluation' })
          .getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(screen.getByRole('tabpanel', { name: 'End-of-conference evaluation' })).toBeTruthy();
  });

  it('omits the journey for a past event', () => {
    render(<EventDetail event={{ ...lagos, period: 'past' }} contactEmail="c@x" />);
    expect(screen.queryByRole('region', { name: 'Your journey' })).toBeNull();
    expect(screen.getByText('Past')).toBeTruthy();
  });
});
