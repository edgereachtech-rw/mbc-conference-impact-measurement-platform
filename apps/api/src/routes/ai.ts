import { aiWordingRequestSchema } from '@mbc/shared';
import { Router } from 'express';

import type { AiClient } from '../ai/client.js';
import { suggestWording } from '../ai/prompts.js';
import { principalOf, type createAuthMiddleware } from '../auth/middleware.js';
import { EVENT_SETUP_ROLES } from '../auth/policies.js';
import { HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';

interface Deps {
  /** The model, or null when OPENAI_API_KEY is not set. */
  ai: () => AiClient | null;
  middleware: ReturnType<typeof createAuthMiddleware>;
  /** Shared with the summary routes, so one admin has one allowance. */
  limit: ReturnType<typeof aiRateLimiter>;
}

/** Requests one admin may make in a window; generous for real editing, a stop for a runaway loop. */
export const AI_REQUESTS_PER_WINDOW = 60;
const WINDOW_MS = 10 * 60 * 1000;

/** Per-admin request counter, in memory (one API process on one server). */
export function aiRateLimiter(now: () => Date = () => new Date()) {
  const seen = new Map<string, number[]>();
  return (userId: string) => {
    const at = now().getTime();
    const recent = (seen.get(userId) ?? []).filter((t) => at - t < WINDOW_MS);
    if (recent.length >= AI_REQUESTS_PER_WINDOW) {
      throw new HttpError(
        429,
        'rate_limited',
        'You have used the writing assistant a lot in the last few minutes. Please wait a moment.',
      );
    }
    recent.push(at);
    seen.set(userId, recent);
  };
}

/** The assistant itself, for callers that need it on: a clear 503 when it is not set up. */
export function requireAi(ai: () => AiClient | null): AiClient {
  const client = ai();
  if (!client) {
    throw new HttpError(
      503,
      'ai_not_configured',
      'The writing assistant is not set up on this server (OPENAI_API_KEY is empty).',
    );
  }
  return client;
}

/**
 * The admin console's writing assistant (2026-11-25): whether it is on, and reworded text for a
 * configuration field. Admins only. Nothing is stored and nothing is audited or logged: the text
 * is the admin's own wording, returned to them as a suggestion they may ignore.
 */
export function aiRouter({ ai, middleware, limit }: Deps): Router {
  const router = Router();
  const guard = middleware.requireRole(...EVENT_SETUP_ROLES);

  router.get('/ai/status', guard, (_req, res) => {
    res.json({ enabled: ai() !== null });
  });

  router.post('/ai/wording', guard, validate(aiWordingRequestSchema), async (req, res) => {
    const client = requireAi(ai);
    limit(principalOf(res).userId);
    res.json({ suggestion: await suggestWording(client, req.body) });
  });

  return router;
}
