import type { SessionUser, UserRole } from '@mbc/shared';

import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { normaliseEmail } from '../lib/email.js';
import { HttpError, RateLimitError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { genericBranding, loadEventBranding } from '../mail/branding.js';
import type { MailConfig } from '../mail/config.js';
import type { Mailer } from '../mail/mailer.js';
import { renderMagicLink } from '../mail/templates/index.js';
import type { AuthConfig } from './config.js';
import type { Principal } from './policies.js';
import { AttemptLedger } from './rate-limit.js';
import {
  generateCode,
  generateToken,
  hashCode,
  hashesEqual,
  hashIdentity,
  hashToken,
} from './tokens.js';

const MAX_CODE_ATTEMPTS = 5;
const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

/** Registration statuses that may sign in (E3-2): valid delegates, plus test delegates on staging. */
const SIGN_IN_ELIGIBLE = ['valid', 'test'] as const;

export interface AuthDeps {
  prisma: () => PrismaClient;
  mailer: () => Mailer;
  config: AuthConfig;
  mailConfig: MailConfig;
  logger: Logger;
  now?: () => Date;
}

export interface ClientContext {
  ipHash: string | null;
  userAgent: string | null;
}

export interface ResolvedSession {
  sessionId: string;
  principal: Principal;
  user: SessionUser;
}

export interface VerifiedSignIn {
  user: SessionUser;
  next: string;
  sessionToken: string;
  sessionMaxAgeSeconds: number;
}

type VerifyInput = { token: string } | { email: string; code: string };

/**
 * Passwordless authentication (E3-2..6). Every method is safe to expose: request-link never
 * reveals whether an address is known, verify fails closed, and nothing here logs or stores a
 * raw token.
 */
export class AuthService {
  private readonly ledger: AttemptLedger;

  constructor(private readonly deps: AuthDeps) {
    this.ledger = new AttemptLedger(deps.prisma, deps.config);
  }

  /** Removes ledger rows and tokens no window can still use (also runs opportunistically). */
  purgeExpired(now = this.now()) {
    return this.ledger.purgeExpired(now);
  }

  private get prisma() {
    return this.deps.prisma();
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  // ---------------------------------------------------------------- request a link / code

  async requestMagicLink(
    input: { email: string; next?: string },
    client: ClientContext,
  ): Promise<void> {
    const email = normaliseEmail(input.email);
    const { config } = this.deps;
    const now = this.now();

    // Recorded and counted atomically; a ledger failure fails the request (never sends).
    const { allowed, byEmail, byIp } = await this.ledger.recordLinkRequest(
      { emailHash: hashIdentity(email, config.hashSecret), ipHash: client.ipHash },
      now,
    );
    if (!allowed) {
      this.deps.logger.warn({ byEmail, byIp }, 'sign-in link request rate limited');
      await audit(this.prisma, {
        action: 'signin.rate_limited',
        entityType: 'auth',
        ip: client.ipHash,
        userAgent: client.userAgent,
        newValue: { byEmail, byIp },
      });
      return;
    }

    const account = await this.prisma.userAccount.findUnique({ where: { email } });
    if (account && account.status !== 'active') {
      await audit(this.prisma, {
        action: 'signin.inactive_account',
        entityType: 'user_account',
        entityId: account.id,
        ip: client.ipHash,
        userAgent: client.userAgent,
      });
      return;
    }

    const delegate = account
      ? null
      : await this.prisma.delegate.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            registrationStatus: { in: [...SIGN_IN_ELIGIBLE] },
            event: { status: { not: 'archived' } },
          },
          orderBy: { createdAt: 'desc' },
        });
    if (!account && !delegate) {
      // Unknown address: same outward behaviour, nothing sent (E3-2 refuses unregistered emails).
      this.deps.logger.info('sign-in link requested for an unknown address');
      return;
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const code = generateCode();
    await this.prisma.signInToken.create({
      data: {
        email,
        userAccountId: account?.id ?? null,
        purpose: account ? 'signin' : 'invite_accept',
        tokenHash,
        codeHash: hashCode(code, tokenHash),
        expiresAt: new Date(now.getTime() + config.magicLinkTtlMs),
        targetPath: input.next ?? null,
      },
    });

    const branding =
      (await loadEventBranding(this.prisma, this.deps.mailConfig)) ??
      genericBranding(this.deps.mailConfig);
    const linkedDelegate =
      delegate ??
      (account
        ? await this.prisma.delegate.findFirst({ where: { userAccountId: account.id } })
        : null);
    const rendered = renderMagicLink(branding, {
      recipientName: linkedDelegate?.name,
      signInUrl: `${config.appUrl}/signin/verify?token=${encodeURIComponent(rawToken)}`,
      expiresInMinutes: Math.round(config.magicLinkTtlMs / 60_000),
      code,
    });

    try {
      await this.deps.mailer().send({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (error) {
      // The caller still gets the generic 202; the failure is visible in logs and error tracking.
      this.deps.logger.error({ err: error }, 'sign-in email could not be sent');
      return;
    }

    await audit(this.prisma, {
      action: 'signin.link_requested',
      entityType: account ? 'user_account' : 'delegate',
      entityId: account?.id ?? delegate?.id ?? null,
      eventId: delegate?.eventId ?? linkedDelegate?.eventId ?? null,
      ip: client.ipHash,
      userAgent: client.userAgent,
    });
  }

  // ---------------------------------------------------------------- verify and create a session

  async verify(input: VerifyInput, client: ClientContext): Promise<VerifiedSignIn> {
    const { config } = this.deps;
    const now = this.now();

    const budget = await this.ledger.verifyBudget(client.ipHash, now);
    if (budget.blocked) throw new RateLimitError(budget.retryAfterSeconds);

    const token =
      'token' in input
        ? await this.prisma.signInToken.findUnique({ where: { tokenHash: hashToken(input.token) } })
        : await this.prisma.signInToken.findFirst({
            where: { email: normaliseEmail(input.email), usedAt: null, expiresAt: { gt: now } },
            orderBy: { createdAt: 'desc' },
          });

    const fail = async (reason: string): Promise<never> => {
      await this.ledger.recordVerifyFailure(
        {
          emailHash: token ? hashIdentity(token.email, config.hashSecret) : null,
          ipHash: client.ipHash,
        },
        now,
      );
      await audit(this.prisma, {
        action: 'signin.failed',
        entityType: 'auth',
        entityId: token?.id ?? null,
        ip: client.ipHash,
        userAgent: client.userAgent,
        newValue: { reason },
      });
      throw new HttpError(
        401,
        'invalid_token',
        'This sign-in link or code is invalid or has expired.',
      );
    };

    if (!token) return fail('unknown');
    if (token.usedAt) return fail('replayed');
    if (token.expiresAt <= now) return fail('expired');
    if ('code' in input) {
      if (!token.codeHash || token.attempts >= MAX_CODE_ATTEMPTS) return fail('code_locked');
      if (!hashesEqual(hashCode(input.code, token.tokenHash), token.codeHash)) {
        await this.prisma.signInToken.update({
          where: { id: token.id },
          data: { attempts: { increment: 1 } },
        });
        return fail('wrong_code');
      }
    }

    const sessionToken = generateToken();
    const sessionExpiresAt = new Date(now.getTime() + config.sessionTtlMs);

    const result = await this.prisma.$transaction(async (tx) => {
      // Single use: the claim fails if another request used the token meanwhile.
      const claimed = await tx.signInToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1)
        throw new HttpError(401, 'invalid_token', 'This sign-in link has already been used.');

      let account = token.userAccountId
        ? await tx.userAccount.findUnique({ where: { id: token.userAccountId } })
        : await tx.userAccount.findUnique({ where: { email: token.email } });

      if (!account) {
        const eligible = await tx.delegate.findFirst({
          where: {
            email: { equals: token.email, mode: 'insensitive' },
            registrationStatus: { in: [...SIGN_IN_ELIGIBLE] },
            event: { status: { not: 'archived' } },
          },
        });
        if (!eligible) throw new HttpError(401, 'invalid_token', 'This email is not registered.');
        account = await tx.userAccount.create({ data: { email: token.email, role: 'delegate' } });
      }
      if (account.status !== 'active') {
        throw new HttpError(401, 'invalid_token', 'This account is not active.');
      }

      if (account.role === 'delegate') {
        // Link every eligible registration with this email to the account (E3-2).
        await tx.delegate.updateMany({
          where: {
            email: { equals: token.email, mode: 'insensitive' },
            userAccountId: null,
            registrationStatus: { in: [...SIGN_IN_ELIGIBLE] },
          },
          data: { userAccountId: account.id, signedUpAt: now },
        });
      }

      const session = await tx.authSession.create({
        data: {
          userAccountId: account.id,
          tokenHash: hashToken(sessionToken),
          expiresAt: sessionExpiresAt,
          lastSeenAt: now,
          ipHash: client.ipHash,
          userAgent: client.userAgent?.slice(0, 200) ?? null,
        },
      });
      await tx.userAccount.update({ where: { id: account.id }, data: { lastSignInAt: now } });

      const delegate =
        account.role === 'delegate'
          ? await tx.delegate.findFirst({
              where: { userAccountId: account.id },
              orderBy: { createdAt: 'desc' },
            })
          : null;

      await audit(tx, {
        action: 'signin.succeeded',
        entityType: 'user_account',
        entityId: account.id,
        eventId: delegate?.eventId ?? null,
        actorUserId: account.id,
        ip: client.ipHash,
        userAgent: client.userAgent,
        newValue: { method: 'token' in input ? 'link' : 'code', sessionId: session.id },
      });

      return { account, delegate };
    });

    return {
      user: toSessionUser(result.account, result.delegate),
      next: token.targetPath ?? '/account',
      sessionToken,
      sessionMaxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
    };
  }

  // ---------------------------------------------------------------- sessions

  /** Fails closed: unknown, revoked, expired, idle-expired or inactive-user sessions resolve to null. */
  async resolveSession(rawToken: string): Promise<ResolvedSession | null> {
    const now = this.now();
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { userAccount: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    if (session.lastSeenAt.getTime() + this.deps.config.sessionIdleMs <= now.getTime()) return null;
    if (session.userAccount.status !== 'active') return null;

    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
    }
    const delegate =
      session.userAccount.role === 'delegate'
        ? await this.prisma.delegate.findFirst({
            where: { userAccountId: session.userAccountId },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    return {
      sessionId: session.id,
      principal: {
        userId: session.userAccountId,
        role: session.userAccount.role,
        delegateId: delegate?.id ?? null,
      },
      user: toSessionUser(session.userAccount, delegate),
    };
  }

  async signOut(rawToken: string, client: ClientContext): Promise<void> {
    const now = this.now();
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!session || session.revokedAt) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
      await audit(tx, {
        action: 'signout',
        entityType: 'user_account',
        entityId: session.userAccountId,
        actorUserId: session.userAccountId,
        ip: client.ipHash,
        userAgent: client.userAgent,
      });
    });
  }

  /** Used when an account is deactivated or its email changes: every device is signed out. */
  async revokeAllSessions(userAccountId: string): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      where: { userAccountId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
    return result.count;
  }
}

interface AccountLike {
  id: string;
  email: string;
  role: UserRole;
}

interface DelegateLike {
  id: string;
  eventId: string;
  name: string;
  attendanceFormat: 'physical' | 'virtual';
}

export function toSessionUser(account: AccountLike, delegate: DelegateLike | null): SessionUser {
  return {
    id: account.id,
    email: account.email,
    role: account.role,
    displayName: delegate?.name ?? account.email.split('@')[0] ?? account.email,
    delegate: delegate
      ? {
          id: delegate.id,
          eventId: delegate.eventId,
          name: delegate.name,
          attendanceFormat: delegate.attendanceFormat,
        }
      : null,
  };
}
