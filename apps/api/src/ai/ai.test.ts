import type { StageSummary } from '@mbc/shared';
import { describe, expect, it } from 'vitest';

import { OpenAiClient, type AiClient, type AiRequest } from './client.js';
import { aiConfigFromEnv } from './config.js';
import { figuresForSummary, redact, suggestWording, writeSummary } from './prompts.js';

/** A model that answers with a fixed reply and keeps what it was sent. */
function fakeAi(reply: string) {
  const sent: AiRequest[] = [];
  const client: AiClient = {
    model: 'fake-model',
    complete: async (request) => {
      sent.push(request);
      return reply;
    },
  };
  return { client, sent };
}

describe('aiConfigFromEnv', () => {
  it('is off without a key, and reads the model and address when one is set', () => {
    expect(aiConfigFromEnv({})).toBeNull();
    expect(aiConfigFromEnv({ OPENAI_API_KEY: '' })).toBeNull();
    expect(
      aiConfigFromEnv({
        OPENAI_API_KEY: 'sk-test-1234567890',
        OPENAI_MODEL: 'gpt-test',
        OPENAI_BASE_URL: 'https://example.test/v1/',
      }),
    ).toEqual({
      apiKey: 'sk-test-1234567890',
      model: 'gpt-test',
      baseUrl: 'https://example.test/v1',
      timeoutMs: 45000,
    });
  });
});

describe('redact', () => {
  it('takes emails and phone numbers out and puts them back', () => {
    const { text, restore } = redact(
      'Write to support@example.com or call +234 803 123 4567 before 2026-2027.',
    );
    expect(text).not.toContain('support@example.com');
    expect(text).not.toContain('803');
    expect(text).toContain('2026-2027');
    expect(restore(text)).toBe(
      'Write to support@example.com or call +234 803 123 4567 before 2026-2027.',
    );
  });

  it('leaves short numbers and dates alone', () => {
    expect(redact('Rate it from 1 to 5 on 12 November 2026.').text).toBe(
      'Rate it from 1 to 5 on 12 November 2026.',
    );
  });
});

describe('suggestWording', () => {
  it('sends the redacted text with the task and field, and returns the reply restored', async () => {
    const { client, sent } = fakeAi('"Please email [[KEEP1]] if you have a question."');
    const out = await suggestWording(client, {
      text: 'pls email help@example.com if u have question',
      mode: 'improve',
      field: 'Email introduction',
      singleLine: false,
    });
    expect(out).toBe('Please email help@example.com if you have a question.');
    expect(sent[0]!.user).toContain('Email introduction');
    expect(sent[0]!.user).not.toContain('help@example.com');
  });

  it('keeps a single-line field on one line', async () => {
    const { client } = fakeAi('Your welcome pack\nfor ITTEC');
    expect(
      await suggestWording(client, { text: 'ur welcome pak', mode: 'improve', singleLine: true }),
    ).toBe('Your welcome pack for ITTEC');
  });
});

const SUMMARY: StageSummary = {
  stage: 'pre_conference',
  invited: 20,
  started: 12,
  submitted: 10,
  responseRate: 50,
  knowledge: { questions: 2, respondents: 10, averageScore: 1.5, averagePercent: 75 },
  statements: [
    {
      questionId: '00000000-0000-4000-8000-000000000001',
      questionKey: '00000000-0000-4000-8000-000000000002',
      prompt: 'I can apply what I learn',
      responses: 10,
      average: 4.2,
    },
  ],
  distributions: [
    {
      questionId: '00000000-0000-4000-8000-000000000003',
      questionKey: '00000000-0000-4000-8000-000000000004',
      prompt: 'How did you hear about us?',
      sectionTitle: null,
      builtin: null,
      visibleWhen: 'always',
      responses: 10,
      options: [{ value: 'web', label: 'Website', count: 7, percent: 70 }],
    },
  ],
};

describe('summaries', () => {
  it('are written from figures only, without identifiers', () => {
    const figures = figuresForSummary('Pre-conference assessment', SUMMARY, null);
    const text = JSON.stringify(figures);
    expect(text).not.toMatch(/0000-4000/);
    expect(figures).toMatchObject({ submitted: 10, responseRatePercent: 50 });
    expect(figures.choiceQuestions[0]).toMatchObject({
      question: 'How did you hear about us?',
      askedOf: 'everyone',
      options: [{ option: 'Website', count: 7, percent: 70 }],
    });
  });

  it('read the model JSON reply, and refuse one that is not', async () => {
    const good = fakeAi(
      JSON.stringify({ overview: 'Half replied.', findings: ['Most: website.'] }),
    );
    const figures = figuresForSummary('T', SUMMARY, null);
    expect(await writeSummary(good.client, figures)).toEqual({
      overview: 'Half replied.',
      findings: ['Most: website.'],
    });
    expect(good.sent[0]!.json).toBe(true);
    await expect(writeSummary(fakeAi('not json').client, figures)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('OpenAiClient', () => {
  const config = {
    apiKey: 'sk-test-1234567890',
    model: 'gpt-test',
    baseUrl: 'https://example.test/v1',
    timeoutMs: 5000,
  };

  it('posts a chat completion that is not stored, and returns the reply', async () => {
    let seen: { url: string; body: Record<string, unknown>; auth: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get('authorization') ?? '',
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: ' Hello ' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const client = new OpenAiClient(config, fetchImpl);
    expect(client.model).toBe('gpt-test');
    expect(await client.complete({ system: 's', user: 'u', json: true })).toBe('Hello');
    expect(seen!.url).toBe('https://example.test/v1/chat/completions');
    expect(seen!.auth).toBe('Bearer sk-test-1234567890');
    expect(seen!.body).toMatchObject({
      model: 'gpt-test',
      store: false,
      response_format: { type: 'json_object' },
    });
  });

  it('turns failures into clear errors that never carry the text', async () => {
    const answer = (status: number) =>
      (async () => new Response('{}', { status })) as unknown as typeof fetch;
    await expect(
      new OpenAiClient(config, answer(429)).complete({ system: 's', user: 'secret' }),
    ).rejects.toMatchObject({ status: 503, code: 'ai_busy' });
    const failed = new OpenAiClient(config, answer(401)).complete({ system: 's', user: 'secret' });
    await expect(failed).rejects.toMatchObject({ code: 'ai_unavailable' });
    await expect(failed).rejects.not.toThrow(/secret/);
    const thrown = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    await expect(
      new OpenAiClient(config, thrown).complete({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
