import { z } from 'zod';

import { withoutBlankValues } from '../lib/env.js';

/**
 * The writing assistant's configuration (2026-11-25).
 *
 *   OPENAI_API_KEY    turns the assistant on; without it the console shows no AI buttons
 *   OPENAI_MODEL      the chat model to use (default gpt-5-mini)
 *   OPENAI_BASE_URL   the API root (default https://api.openai.com/v1)
 *   OPENAI_TIMEOUT_MS how long one request may take (default 45000)
 */
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(10).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(45000),
});

export interface AiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

/** The configuration, or null when no API key is set (the assistant is off). */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const parsed = envSchema.safeParse(withoutBlankValues(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid AI configuration: ${issues}`);
  }
  const e = parsed.data;
  if (!e.OPENAI_API_KEY) return null;
  return {
    apiKey: e.OPENAI_API_KEY,
    model: e.OPENAI_MODEL,
    baseUrl: e.OPENAI_BASE_URL.replace(/\/+$/, ''),
    timeoutMs: e.OPENAI_TIMEOUT_MS,
  };
}
