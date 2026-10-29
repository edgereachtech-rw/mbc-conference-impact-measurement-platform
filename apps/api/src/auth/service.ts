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
import { isRetiredRole, type Principal } from './policies.js';
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

type RegistrationStatus = 'active' | 'test';

/** Eligible event record of an identity: an identity-owned registration the session may act on. */
interface EligibleDelegate {
  id: string;
  eventId: string;
  name: string;
  attendanceFormat: 'physical' | 'virtual';
  userAccountId: string | null;
  signedUpAt: Date | null;
}

interface EligibleIdentity {
  id: string;
  userAccountId: string | null;
  /** Eligible records, most recent first. */
  delegates: EligibleDelegate[];
}

type IdentityReader = Pick<PrismaClient, 'identityEmail' | 'delegateIdentity'>;

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
    if (account && isRetiredRole(account.role)) {
      // Retired roles (D8 item 7) get the generic response and nothing else.
      this.deps.logger.info('sign-in link requested for a retired-role account');
      return;
    }
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

    // Eligibility (D8 item 1): the address must be an identity's current address and that identity
    // must hold a valid registration in a non-archived event. Historical and provisional addresses
    // never qualify. Staff accounts (admin, speaker) need no registration.
    const identity =
      !account || account.role === 'delegate'
        ? await this.eligibleIdentity(this.prisma, email)
        : null;
    if (account?.role === 'delegate' && (!identity || !sameOwner(identity, account.id))) {
      this.deps.logger.info(
        'sign-in link requested for a delegate account without an eligible identity',
      );
      return;
    }
    const delegate = identity?.delegates[0] ?? null;
    if (!account && !identity) {
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

      // Eligibility is re-checked at verification (D8 item 1): the identity's current address
      // must be the token's address, with a valid registration in a non-archived event.
      const identity =
        !account || account.role === 'delegate'
          ? await this.eligibleIdentity(tx, token.email)
          : null;
      if (!account) {
        if (!identity) throw new HttpError(401, 'invalid_token', 'This email is not registered.');
        account = await tx.userAccount.create({ data: { email: token.email, role: 'delegate' } });
      }
      if (isRetiredRole(account.role)) {
        throw new HttpError(401, 'invalid_token', 'This account is not active.');
      }
      if (account.status !== 'active') {
        throw new HttpError(401, 'invalid_token', 'This account is not active.');
      }

      if (account.role === 'delegate') {
        if (!identity) throw new HttpError(401, 'invalid_token', 'This email is not registered.');
        if (!sameOwner(identity, account.id)) {
          // The identity already belongs to another account: never re-link (fail closed).
          throw new HttpError(401, 'invalid_token', 'This email is not registered.');
        }
        if (!identity.userAccountId) {
          // First verification links the account to the identity once (D8 item 2).
          await tx.delegateIdentity.update({
            where: { id: identity.id },
            data: { userAccountId: account.id },
          });
        }
        // Invitations (E3-1): accepted means first sign-in of the invited registration.
        await tx.invitation.updateMany({
          where: {
            delegateId: { in: identity.delegates.map((d) => d.id) },
            status: { in: ['pending', 'sent'] },
          },
          data: { status: 'accepted', acceptedAt: now },
        });
        // signed_up_at is kept per event record: first sign-in while that record exists (D8 item 4).
        const accountId = account.id;
        for (const record of identity.delegates) {
          if (record.signedUpAt && record.userAccountId === accountId) continue;
          await tx.delegate.update({
            where: { id: record.id },
            data: {
              userAccountId: accountId,
              ...(record.signedUpAt ? {} : { signedUpAt: now }),
            },
          });
        }
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

      const delegate = account.role === 'delegate' ? (identity?.delegates[0] ?? null) : null;

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
    if (isRetiredRole(session.userAccount.role)) return null;

    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
    }
    // The principal carries the identity and every eligible event record it owns (D8 item 3).
    const identity =
      session.userAccount.role === 'delegate'
        ? await this.identityOfAccount(session.userAccountId)
        : null;
    const delegate = identity?.delegates[0] ?? null;

    return {
      sessionId: session.id,
      principal: {
        userId: session.userAccountId,
        role: session.userAccount.role,
        identityId: identity?.id ?? null,
        delegateIds: identity?.delegates.map((d) => d.id) ?? [],
        delegateId: delegate?.id ?? null,
      },
      user: toSessionUser(session.userAccount, delegate),
    };
  }

  // ---------------------------------------------------------------- eligibility (D8 item 1)

  private eligibleStatuses(): RegistrationStatus[] {
    // Pending and cancelled registrations never sign in (E2-5).
    return this.deps.config.allowTestRegistrations ? ['active', 'test'] : ['active'];
  }

  /**
   * The identity whose *current* address this is, with its eligible registrations, or null. A
   * historical or provisional address, or an identity without an eligible registration, is null.
   */
  private async eligibleIdentity(
    db: IdentityReader,
    email: string,
  ): Promise<EligibleIdentity | null> {
    const address = await db.identityEmail.findUnique({
      where: { emailNormalised: normaliseEmail(email) },
      select: {
        kind: true,
        identity: {
          select: {
            id: true,
            userAccountId: true,
            delegates: {
              where: {
                registrationStatus: { in: this.eligibleStatuses() },
                event: { status: { not: 'archived' } },
              },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                eventId: true,
                name: true,
                attendanceFormat: true,
                userAccountId: true,
                signedUpAt: true,
              },
            },
          },
        },
      },
    });
    if (!address || address.kind !== 'current') return null;
    if (address.identity.delegates.length === 0) return null;
    return address.identity;
  }

  /** The identity linked to an account with its eligible registrations (sessions never use addresses). */
  private async identityOfAccount(userAccountId: string): Promise<EligibleIdentity | null> {
    const identity = await this.prisma.delegateIdentity.findUnique({
      where: { userAccountId },
      select: {
        id: true,
        userAccountId: true,
        delegates: {
          where: {
            registrationStatus: { in: this.eligibleStatuses() },
            event: { status: { not: 'archived' } },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            eventId: true,
            name: true,
            attendanceFormat: true,
            userAccountId: true,
            signedUpAt: true,
          },
        },
      },
    });
    return identity;
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

/** True when the identity is unlinked or linked to this very account. */
function sameOwner(identity: EligibleIdentity, accountId: string): boolean {
  return identity.userAccountId === null || identity.userAccountId === accountId;
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
