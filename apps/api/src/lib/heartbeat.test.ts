import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startHeartbeat } from './heartbeat.js';

function listener(statusCode = 200) {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(req.url ?? '');
    res.statusCode = statusCode;
    res.end('ok');
  });
  return new Promise<{ url: string; hits: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/ping/worker`,
        hits,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('worker heartbeat', () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  it('pings the configured URL immediately and then on every interval', async () => {
    const target = await listener();
    const log = logger();
    const hb = startHeartbeat({ url: target.url, intervalSeconds: 1, logger: log });
    stop = hb.stop;
    // intervalSeconds is clamped to >= 1 s, so trigger extra pings directly for speed.
    await hb.pingNow();
    await hb.pingNow();
    await vi.waitFor(() => expect(target.hits.length).toBeGreaterThanOrEqual(3));
    expect(target.hits[0]).toBe('/ping/worker');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith({ intervalSeconds: 1 }, 'heartbeat started');
    await target.close();
  });

  it('logs a warning and keeps going when the ping is rejected or unreachable', async () => {
    const failing = await listener(500);
    const log = logger();
    const hb = startHeartbeat({ url: failing.url, intervalSeconds: 60, logger: log });
    stop = hb.stop;
    expect(await hb.pingNow()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith({ status: 500 }, 'heartbeat ping rejected');
    await failing.close();

    // Port now closed: connection error path.
    expect(await hb.pingNow()).toBe(false);
    expect(log.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: expect.any(String) }),
      'heartbeat ping failed',
    );
  });
});
