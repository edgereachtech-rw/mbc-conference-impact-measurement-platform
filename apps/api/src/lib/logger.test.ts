import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    lines,
    last: () => JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>,
  };
}

describe('logger redaction', () => {
  it('removes email, name, authorization, cookie, token and query strings from objects', () => {
    const { stream, last } = capture();
    const logger = createLogger(stream, 'info');

    logger.info(
      {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        headers: { authorization: 'Bearer secret-token', cookie: 'session=abc', 'x-name': 'Ada' },
        token: 'tok_123',
        url: '/api/signin?token=abc&email=ada@example.com',
        requestId: 'req-1',
      },
      'signed in',
    );

    const line = last();
    const text = JSON.stringify(line);
    expect(line.requestId).toBe('req-1');
    expect(line.url).toBe('/api/signin');
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('Ada');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('session=abc');
    expect(text).not.toContain('tok_123');
    expect(text).toContain('[redacted]');
  });

  it('scrubs personal data inside the message string and inside errors', () => {
    const { stream, lines, last } = capture();
    const logger = createLogger(stream, 'info');

    logger.warn('failed to email grace@example.com with Bearer abc.def');
    expect(last().msg).toBe('failed to email [email] with Bearer [redacted]');

    logger.error({ err: new Error('lookup for grace@example.com failed') }, 'boom');
    const text = lines[lines.length - 1] ?? '';
    expect(text).not.toContain('grace@example.com');
    expect(text).toContain('lookup for [email] failed');
  });

  it('keeps non-personal fields intact', () => {
    const { stream, last } = capture();
    const logger = createLogger(stream, 'info');
    logger.info({ status: 200, method: 'GET', path: '/api/health', hostname: 'api' }, 'ok');
    const line = last();
    expect(line.status).toBe(200);
    expect(line.method).toBe('GET');
    expect(line.path).toBe('/api/health');
    expect(line.hostname).toBe('api');
  });
});
