import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseOptions, QuestionBuilder } from './question-builder';

const q = (id: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  id,
  questionKey: `${id}-key`,
  version: 1,
  order: 1,
  sectionId: null,
  prompt,
  helpText: null,
  type: 'rating',
  required: true,
  area: null,
  options: null,
  scale: { min: 1, max: 5, minLabel: null, maxLabel: null },
  responseCount: 0,
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe('QuestionBuilder', () => {
  it('parses option lines', () => {
    expect(parseOptions('Agree\nhr | Human resources\n\n')).toEqual([
      { value: 'Agree', label: 'Agree' },
      { value: 'hr', label: 'Human resources' },
    ]);
  });

  it('lists questions by section, adds a section, adds a question into it, and reorders within a section', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let sections = [{ id: 's1', title: 'About you', description: null, order: 1 }];
    let questions = [
      q('q1', 'First question'),
      q('q2', 'Second question', { version: 2, responseCount: 3, sectionId: 's1' }),
      q('q3', 'Third question', { sectionId: 's1' }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === 'POST' && url.endsWith('/sections')) {
          const body = JSON.parse(String(init.body));
          sections = [
            ...sections,
            { id: 's2', title: body.title, description: body.description ?? null, order: 2 },
          ];
          return new Response(JSON.stringify({ section: sections[1], sections, questions }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          questions = [...questions, q('q4', body.prompt, { sectionId: body.sectionId })];
        }
        if (init?.method === 'PUT' && url.endsWith('/questions/order')) {
          const ids = JSON.parse(String(init.body)).questionIds as string[];
          questions = ids.map((id) => questions.find((x) => x.id === id)!);
        }
        return new Response(JSON.stringify({ sections, questions }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<QuestionBuilder eventId="e1" stage="pre_conference" onChanged={onChanged} />);
    const general = await screen.findByRole('region', { name: 'Questions without a section' });
    expect(within(general).getAllByRole('listitem')).toHaveLength(1);
    const aboutYou = screen.getByRole('region', { name: 'Section: About you' });
    expect(
      within(aboutYou)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('Second question'),
      expect.stringContaining('Third question'),
    ]);

    // A new section.
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    const sectionForm = screen.getByRole('form', { name: 'New section' });
    await user.click(within(sectionForm).getByRole('button', { name: 'Add section' }));
    expect(within(sectionForm).getByRole('alert').textContent).toMatch(/title/i);
    await user.type(within(sectionForm).getByLabelText('Section title'), 'About the day');
    await user.click(within(sectionForm).getByRole('button', { name: 'Add section' }));
    const post = calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/sections'));
    expect(post?.url).toBe('/api/v1/events/e1/assessments/pre_conference/sections');
    expect(await screen.findByRole('region', { name: 'Section: About the day' })).toBeTruthy();

    // A question added from a section header goes into that section.
    await user.click(
      screen.getByRole('button', { name: 'Add question to section: About the day' }),
    );
    const form = screen.getByRole('form', { name: 'New question' });
    expect((within(form).getByLabelText('Section') as HTMLSelectElement).value).toBe('s2');
    await user.type(within(form).getByLabelText('Question'), 'How was the day?');
    await user.click(within(form).getByRole('button', { name: 'Add question' }));
    const postQ = calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/questions'));
    expect(JSON.parse(String(postQ?.init?.body))).toMatchObject({
      prompt: 'How was the day?',
      sectionId: 's2',
    });
    expect(onChanged).toHaveBeenCalled();

    // Moving within a section swaps only those two in the global order.
    await user.click(screen.getByRole('button', { name: 'Move up: Third question' }));
    const put = calls.find((c) => c.init?.method === 'PUT' && c.url.endsWith('/questions/order'));
    expect(JSON.parse(String(put?.init?.body))).toEqual({ questionIds: ['q1', 'q3', 'q2', 'q4'] });
  });
});
