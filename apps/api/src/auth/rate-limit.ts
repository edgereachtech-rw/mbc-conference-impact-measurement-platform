import type { PrismaClient } from '../db.js';

/** Link requests per email are counted over 15 minutes; per-address counters over one hour. */
export const EMAIL_WINDOW_MS = 15 * 60_000;
export const IP_WINDOW_MS = 60 * 60_000;

/** Rows older than the longest window are useless; they are purged opportunistically. */
const RETENTION_MS = IP_WINDOW_MS;
const TOKEN_RETENTION_MS = 24 * 60 * 60_000;
const PURGE_INTERVAL_MS = 10 * 60_000;

export interface LedgerLimits {
  rateLimitPerEmail: number;
  rateLimitPerIp: number;
  verifyLimitPerIp: number;
}

export interface LedgerKeys {
  /** Keyed hash of the normalised email, or null when no address is involved. */
  emailHash: string | null;
  /** Keyed hash of the client address, or null when the address is unknown. */
  ipHash: string | null;
}

export interface LinkRequestOutcome {
  allowed: boolean;
  byEmail: number;
  byIp: number;
}

export interface VerifyBudget {
  blocked: boolean;
  failures: number;
  retryAfterSeconds: number;
}

/**
 * Sign-in attempt ledger in PostgreSQL (table auth_attempt), shared by every API instance.
 *
 * Atomicity: each link request is recorded and counted inside one transaction that first takes a
 * transaction-scoped advisory lock per key (email, address). Concurrent requests for the same key
 * therefore run one after another and each sees every earlier insert, so a burst at the threshold
 * cannot slip past the limit.
 *
 * Failure policy: the ledger never swallows errors. If the database is unavailable the request
 * fails (the caller returns a generic 5xx) and nothing is sent, so an outage cannot switch the
 * protection off.
 */
export class AttemptLedger {
  private lastPurgeAt = 0;

  constructor(
    private readonly prisma: () => PrismaClient,
    private readonly limits: LedgerLimits,
  ) {}

  /** Records a link request and reports whether it is within both limits. */
  async recordLinkRequest(keys: LedgerKeys, now: Date): Promise<LinkRequestOutcome> {
    const { limits } = this;
    const outcome = await this.prisma().$transaction(async (tx) => {
      for (const key of lockKeys(keys)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      }
      await tx.authAttempt.create({
        data: {
          kind: 'request_link',
          emailHash: keys.emailHash,
          ipHash: keys.ipHash,
          attemptedAt: now,
        },
      });
      const byEmail = keys.emailHash
        ? await tx.authAttempt.count({
            where: {
              kind: 'request_link',
              emailHash: keys.emailHash,
              attemptedAt: { gte: since(now, EMAIL_WINDOW_MS) },
            },
          })
        : 0;
      const byIp = keys.ipHash
        ? await tx.authAttempt.count({
            where: {
              kind: 'request_link',
              ipHash: keys.ipHash,
              attemptedAt: { gte: since(now, IP_WINDOW_MS) },
            },
          })
        : 0;
      return {
        byEmail,
        byIp,
        allowed: byEmail <= limits.rateLimitPerEmail && byIp <= limits.rateLimitPerIp,
      };
    });
    await this.purgeIfDue(now);
    return outcome;
  }

  /** Whether the client address may attempt another verification, and when it may retry if not. */
  async verifyBudget(ipHash: string | null, now: Date): Promise<VerifyBudget> {
    if (!ipHash) return { blocked: false, failures: 0, retryAfterSeconds: 0 };
    const where = {
      kind: 'verify' as const,
      ipHash,
      attemptedAt: { gte: since(now, IP_WINDOW_MS) },
    };
    const failures = await this.prisma().authAttempt.count({ where });
    if (failures < this.limits.verifyLimitPerIp) {
      return { blocked: false, failures, retryAfterSeconds: 0 };
    }
    const oldest = await this.prisma().authAttempt.findFirst({
      where,
      orderBy: { attemptedAt: 'asc' },
      select: { attemptedAt: true },
    });
    const resetAt = (oldest?.attemptedAt.getTime() ?? now.getTime()) + IP_WINDOW_MS;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000));
    return { blocked: true, failures, retryAfterSeconds };
  }

  /** Records a failed verification (unknown, expired, replayed or wrong code/token). */
  async recordVerifyFailure(keys: LedgerKeys, now: Date): Promise<void> {
    await this.prisma().authAttempt.create({
      data: { kind: 'verify', emailHash: keys.emailHash, ipHash: keys.ipHash, attemptedAt: now },
    });
    await this.purgeIfDue(now);
  }

  /** Deletes ledger rows and sign-in tokens that no window or lookup can still use. */
  async purgeExpired(now: Date): Promise<{ attempts: number; tokens: number }> {
    const attempts = await this.prisma().authAttempt.deleteMany({
      where: { attemptedAt: { lt: since(now, RETENTION_MS) } },
    });
    const tokens = await this.prisma().signInToken.deleteMany({
      where: { expiresAt: { lt: since(now, TOKEN_RETENTION_MS) } },
    });
    return { attempts: attempts.count, tokens: tokens.count };
  }

  private async purgeIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now.getTime();
    await this.purgeExpired(now);
  }
}

function since(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs);
}

/** Deterministic order so two requests holding both keys cannot deadlock. */
function lockKeys(keys: LedgerKeys): string[] {
  const out: string[] = [];
  if (keys.emailHash) out.push(`auth:email:${keys.emailHash}`);
  if (keys.ipHash) out.push(`auth:ip:${keys.ipHash}`);
  return out.sort();
}
