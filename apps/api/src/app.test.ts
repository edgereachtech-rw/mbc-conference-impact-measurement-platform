import { healthResponseSchema } from '@mbc/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

describe('GET /health', () => {
  it('returns status ok and an ISO timestamp', async () => {
    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
  });
});
