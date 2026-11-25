import { HttpError } from '../lib/errors.js';
import type { AiConfig } from './config.js';

/** One request to the model: instructions, the material, and whether JSON must come back. */
export interface AiRequest {
  system: string;
  user: string;
  json?: boolean;
  /** Upper bound on the reply, reasoning included. */
  maxTokens?: number;
}

/** The model behind the writing assistant; tests pass a fake. */
export interface AiClient {
  /** The model's name, recorded with what it wrote. */
  readonly model: string;
  complete(request: AiRequest): Promise<string>;
}

/**
 * OpenAI's Chat Completions API over fetch (no SDK dependency). Requests are not stored on
 * OpenAI's side for training or the dashboard (`store: false`). Errors never carry the text sent
 * or received, so nothing written by an admin reaches the logs.
 */
export class OpenAiClient implements AiClient {
  constructor(
    private readonly config: AiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async complete(request: AiRequest): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          store: false,
          max_completion_tokens: request.maxTokens ?? 4000,
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw unavailable('The writing assistant did not answer in time. Please try again.');
    }
    if (res.status === 429) {
      throw new HttpError(
        503,
        'ai_busy',
        'The writing assistant is busy or its credit has run out. Try again shortly.',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw unavailable('The writing assistant is not set up correctly (check OPENAI_API_KEY).');
    }
    if (!res.ok) throw unavailable('The writing assistant could not answer. Please try again.');
    const body = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
    } | null;
    const content = body?.choices?.[0]?.message?.content?.trim();
    if (!content) throw unavailable('The writing assistant gave no answer. Please try again.');
    return content;
  }
}

function unavailable(message: string) {
  return new HttpError(503, 'ai_unavailable', message);
}
