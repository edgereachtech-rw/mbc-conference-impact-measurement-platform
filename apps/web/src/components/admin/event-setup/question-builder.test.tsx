import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { optionsPayload, parseOptions, QuestionBuilder } from './question-builder';

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
  isKnowledge: false,
  responseCount: 0,
  ...extra,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('QuestionBuilder', () => {
  it('parses option lines and builds the option payload per question type', () => {
    expect(parseOptions('Agree\nhr | Human resources\n\n')).toEqual([
      expect.objectContaining({ value: 'Agree', label: 'Agree' }),
      expect.objectContaining({ value: 'hr', label: 'Human resources' }),
    ]);
    const rows = [
      { value: '', label: 'Always', score: '5', correct: false, exclusive: true, other: false },
      {
        value: 'na',
        label: 'Not applicable',
        score: '',
        correct: true,
        exclusive: false,
        other: true,
      },
      { value: '', label: '', score: '', correct: false, exclusive: false, other: false },
    ];
    expect(optionsPayload('single_choice', rows)).toEqual([
      { value: 'Always', label: 'Always', score: 5 },
      { value: 'na', label: 'Not applicable', correct: true },
    ]);
    expect(optionsPayload('multiple_choice', rows)).toEqual([
      { value: 'Always', label: 'Always', exclusive: true },
      { value: 'na', label: 'Not applicable', other: true },
    ]);
    // A long label with no code of its own gets a short unique code instead of failing the
    // 100-character limit on codes.
    const long = `A process for identifying the cause of a performance gap before any training is chosen, ${'x'.repeat(40)}`;
    const [first, second] = optionsPayload('multiple_choice', [
      { ...rows[0]!, value: '', label: long, exclusive: false },
      { ...rows[0]!, value: '', label: `${long} (again)`, exclusive: false },
    ]);
    expect(first!.value.length).toBeLessThanOrEqual(60);
    expect(first!.value).toMatch(/^a_process_for_identifying/);
    expect(second!.value).toBe(`${first!.value}_2`);
    expect(first!.label).toBe(long);
  });

  it('lists questions by section, adds a section, adds a question into it, and reorders within a section', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let sections = [
      { id: 's1', title: 'About you', description: null, order: 1, marking: 'none' as const },
    ];
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
            {
              id: 's2',
              title: body.title,
              description: body.description ?? null,
              order: 2,
              marking: body.marking,
            },
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
    await user.selectOptions(within(sectionForm).getByLabelText('Marking'), 'scored');
    await user.click(within(sectionForm).getByRole('button', { name: 'Add section' }));
    const post = calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/sections'));
    expect(post?.url).toBe('/api/v1/events/e1/assessments/pre_conference/sections');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      title: 'About the day',
      marking: 'scored',
    });
    expect(screen.getByText('Rating scale (averaged in reports)')).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Section: About the day' })).toBeTruthy();

    // A question added from a section header goes into that section.
    await user.click(
      screen.getByRole('button', { name: 'Add question to section: About the day' }),
    );
    const form = screen.getByRole('form', { name: 'New question' });
    expect((within(form).getByLabelText('Section') as HTMLSelectElement).value).toBe('s2');
    await user.selectOptions(within(form).getByLabelText('Response type'), 'long_text');
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

  it('builds a knowledge question from a preset with one correct answer, marked by its section', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const sections = [
      { id: 'k', title: 'Knowledge', description: null, order: 1, marking: 'knowledge' as const },
      { id: 'p', title: 'Practices', description: null, order: 2, marking: 'scored' as const },
    ];
    let questions = [q('q1', 'First question')];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          questions = [
            ...questions,
            q('q2', body.prompt, {
              type: body.type,
              sectionId: body.sectionId,
              options: body.options,
              isKnowledge: body.options.some((o: { correct?: boolean }) => o.correct),
            }),
          ];
          return json({ question: questions.at(-1), sections, questions }, 201);
        }
        return json({ sections, questions });
      }),
    );
    const user = userEvent.setup();
    render(<QuestionBuilder eventId="e1" stage="during_conference" onChanged={vi.fn()} />);
    await screen.findByRole('region', { name: 'Questions without a section' });

    // A single-choice question from a preset, then one option ticked as correct.
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    const form = screen.getByRole('form', { name: 'New question' });
    await user.type(within(form).getByLabelText('Question'), 'How often do you follow up?');
    // Outside a section a choice is plain: neither scores nor correct ticks.
    expect(within(form).queryByLabelText('Weight for option 1')).toBeNull();
    expect(within(form).queryByLabelText('Correct answer: option 1')).toBeNull();
    await user.selectOptions(within(form).getByLabelText('Start from a preset'), 'frequency');
    expect((within(form).getByLabelText('Option 1') as HTMLInputElement).value).toBe('Always');
    expect(within(form).queryByLabelText('Weight for option 1')).toBeNull();
    // In a rating-scale section the weights show; "Not applicable" stays blank.
    await user.selectOptions(within(form).getByLabelText('Section'), 'p');
    expect((within(form).getByLabelText('Weight for option 6') as HTMLInputElement).value).toBe('');
    expect(within(form).queryByLabelText('Correct answer: option 1')).toBeNull();
    // In a knowledge section the correct ticks show instead.
    await user.selectOptions(within(form).getByLabelText('Section'), 'k');
    expect(within(form).queryByLabelText('Weight for option 1')).toBeNull();
    await user.click(within(form).getByLabelText('Correct answer: option 2'));
    await user.click(within(form).getByLabelText('Correct answer: option 3'));
    expect(within(form).getByLabelText('Correct answer: option 2')).toHaveProperty(
      'checked',
      false,
    );
    await user.click(within(form).getByLabelText('Remove option 6'));
    // Measurement area: a list of the stage's areas, with "Other…" revealing a text box.
    const area = within(form).getByLabelText('Measurement area (optional)');
    expect(within(form).queryByLabelText('Other measurement area')).toBeNull();
    await user.selectOptions(area, '__other__');
    await user.type(within(form).getByLabelText('Other measurement area'), 'Follow-up habits');
    expect((area as HTMLSelectElement).value).toBe('__other__');
    await user.selectOptions(area, 'Knowledge gained');
    expect(within(form).queryByLabelText('Other measurement area')).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Add question' }));
    const post = calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/questions'));
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      type: 'single_choice',
      area: 'Knowledge gained',
      sectionId: 'k',
      options: [
        { value: 'always', label: 'Always' },
        { value: 'often', label: 'Often' },
        { value: 'sometimes', label: 'Sometimes', correct: true },
        { value: 'rarely', label: 'Rarely' },
        { value: 'never', label: 'Never' },
      ],
    });

    expect(screen.getByText('Knowledge · 1 point')).toBeTruthy();
  });
});
