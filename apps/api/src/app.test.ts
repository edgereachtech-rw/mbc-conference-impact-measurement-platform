import { healthResponseSchema } from '@mbc/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

describe('health endpoints', () => {
  it.each(['/health', '/api/health'])(
    'GET %s returns status ok and an ISO timestamp',
    async (path) => {
      const response = await request(createApp()).get(path);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
    },
  );
});
