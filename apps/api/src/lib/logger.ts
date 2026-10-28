import { scrubValue } from '@mbc/shared';
import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * JSON logger (pino) that never writes personal data: every argument of every log call is passed
 * through the shared scrubber, so emails, names, cookies, tokens and query strings are removed
 * even when a caller forgets. LOG_LEVEL controls verbosity (default info).
 */
export function createLogger(destination?: DestinationStream, level?: string): Logger {
  const options = {
    level: level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service: process.env.SERVICE_NAME ?? 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    hooks: {
      logMethod(this: Logger, args: unknown[], method: (...a: unknown[]) => void) {
        method.apply(
          this,
          args.map((arg) =>
            typeof arg === 'object' || typeof arg === 'string' ? scrubValue(arg) : arg,
          ),
        );
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

let shared: Logger | undefined;

export function getLogger(): Logger {
  if (!shared) shared = createLogger();
  return shared;
}

export type { Logger };
