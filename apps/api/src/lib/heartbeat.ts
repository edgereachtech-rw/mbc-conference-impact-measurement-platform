export interface HeartbeatLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export interface HeartbeatOptions {
  /** Healthchecks.io ping URL (or any URL that returns 2xx). */
  url: string;
  intervalSeconds: number;
  logger: HeartbeatLogger;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface Heartbeat {
  /** Sends one ping now; resolves true on 2xx. Never throws. */
  pingNow(): Promise<boolean>;
  stop(): void;
}

/**
 * Worker heartbeat (backlog E0-9): pings `url` immediately and then every `intervalSeconds`.
 * A failed ping logs a warning (no URL or body content, just status) and never throws, so a
 * monitoring outage can never take the worker down.
 */
export function startHeartbeat(options: HeartbeatOptions): Heartbeat {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = Math.max(1, options.intervalSeconds) * 1000;

  const pingNow = async (): Promise<boolean> => {
    try {
      const res = await fetchImpl(options.url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'mbc-impact-worker-heartbeat' },
      });
      if (!res.ok) {
        options.logger.warn({ status: res.status }, 'heartbeat ping rejected');
        return false;
      }
      return true;
    } catch (error) {
      options.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'heartbeat ping failed',
      );
      return false;
    }
  };

  void pingNow();
  const timer = setInterval(() => void pingNow(), intervalMs);
  options.logger.info({ intervalSeconds: options.intervalSeconds }, 'heartbeat started');

  return {
    pingNow,
    stop() {
      clearInterval(timer);
    },
  };
}
