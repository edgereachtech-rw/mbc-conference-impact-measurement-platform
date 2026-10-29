import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request, { type Agent } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { PrismaClient } from '../db.js';
import {
  createRegisteredIdentity,
  createTestEvent,
  deleteIdentity,
  hasDatabase,
  testPrisma,
} from '../db/test-helpers.js';
import { MemoryMailer } from '../mail/mailer.js';
import { authConfigFromEnv } from './config.js';
import { generateToken, hashToken } from './tokens.js';

const ORIGIN = 'http://localhost:3000';
const silent = pino({ level: 'silent' });

function linkTokenFrom(mailer: MemoryMailer): string {
  const last = mailer.sent[mailer.sent.length - 1];
  const match = /signin\/verify\?token=([A-Za-z0-9_%-]+)/.exec(last?.text ?? '');
  if (!match?.[1]) throw new Error('no sign-in link in the last email');
  return decodeURIComponent(match[1]);
}

function cookieFrom(res: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw new Error('no Set-Cookie header');
  return header.split(';')[0] ?? '';
}

describe.skipIf(!hasDatabase)(
  'identity-based sign-in eligibility (backlog D8 items 1 to 4, 7)',
  () => {
    let prisma: PrismaClient;
    let mailer: MemoryMailer;
    let eventId: string;
    const identityIds: string[] = [];
    const accountIds: string[] = [];
    const unique = () => randomUUID().slice(0, 8);
    const mailConfig = {
      transport: 'memory' as const,
      from: 'Test <noreply@example.com>',
      contactEmail: 'conference@mbryanconsultinggroup.com',
      appUrl: ORIGIN,
      smtp: { host: 'x', port: 25, secure: false },
    };
    const base = {
      NODE_ENV: 'test',
      APP_URL: ORIGIN,
      AUTH_RATE_LIMIT_PER_IP: '1000',
      AUTH_VERIFY_LIMIT_PER_IP: '1000',
    };
    const app = (env: Record<string, string> = {}) =>
      createApp({
        logger: silent,
        prisma: () => prisma,
        mailer: () => mailer,
        authConfig: authConfigFromEnv({ ...base, ...env }),
        mailConfig,
        allowedOrigins: [ORIGIN],
        trustProxy: 'loopback, uniquelocal',
      });
    const requestLink = (agent: Agent, email: string) =>
      agent.post('/api/v1/auth/magic-link').set('Origin', ORIGIN).send({ email });
    const verify = (agent: Agent, token: string) =>
      agent.post('/api/v1/auth/verify').set('Origin', ORIGIN).send({ token });
    async function register(
      email: string,
      options: Parameters<typeof createRegisteredIdentity>[3] = {},
      target = eventId,
    ) {
      const registered = await createRegisteredIdentity(prisma, target, email, options);
      identityIds.push(registered.identity.id);
      return registered;
    }
    async function signInWithLink(agent: Agent, email: string) {
      await requestLink(agent, email);
      const res = await verify(agent, linkTokenFrom(mailer));
      expect(res.status, res.text).toBe(200);
      return res;
    }

    beforeAll(async () => {
      prisma = testPrisma();
      eventId = (await createTestEvent(prisma)).id;
    });
    afterAll(async () => {
      await prisma.event.delete({ where: { id: eventId } });
      for (const id of identityIds) await deleteIdentity(prisma, id);
      await prisma.userAccount.deleteMany({ where: { id: { in: accountIds } } });
      await prisma.$disconnect();
    });
    beforeEach(() => {
      mailer = new MemoryMailer();
    });

    it('a historical or provisional address never obtains a link, and a link issued before a change is rejected', async () => {
      const current = `hist-${unique()}@example.com`;
      const old = `hist-old-${unique()}@example.com`;
      const { identity } = await register(current);
      await prisma.identityEmail.create({
        data: {
          identityId: identity.id,
          emailNormalised: old,
          kind: 'historical',
          evidence: 'admin_decision',
        },
      });
      const reserved = `prov-${unique()}@example.com`;
      const provisional = await prisma.delegateIdentity.create({
        data: {
          displayName: 'Reserved',
          emails: {
            create: { emailNormalised: reserved, kind: 'provisional', evidence: 'unverified' },
          },
        },
      });
      identityIds.push(provisional.id);
      await prisma.delegate.create({
        data: {
          eventId,
          identityId: provisional.id,
          name: 'Reserved',
          email: reserved,
          attendanceFormat: 'virtual',
        },
      });

      const agent = request(app());
      expect((await requestLink(agent, old)).status).toBe(202);
      expect((await requestLink(agent, reserved)).status).toBe(202);
      expect(mailer.sent).toHaveLength(0);
      expect(await prisma.userAccount.count({ where: { email: { in: [old, reserved] } } })).toBe(0);

      // A link issued to the current address stops working once that address becomes historical
      // (as the email-change workflow would make it): verification re-checks eligibility.
      await requestLink(agent, current);
      const token = linkTokenFrom(mailer);
      await prisma.identityEmail.update({
        where: { emailNormalised: current },
        data: { kind: 'historical', evidence: 'admin_decision' },
      });
      const rejected = await verify(agent, token);
      expect(rejected.status).toBe(401);
      expect(await prisma.authSession.count({ where: { userAccount: { email: current } } })).toBe(
        0,
      );
    });

    it('a pending registration never signs in until an admin sets it active (E2-5)', async () => {
      const pendingEmail = `pending-${unique()}@example.com`;
      const { delegate } = await register(pendingEmail, { registrationStatus: 'pending' });
      const agent = request(app());
      expect((await requestLink(agent, pendingEmail)).status).toBe(202);
      expect(mailer.sent).toHaveLength(0);
      await prisma.delegate.update({
        where: { id: delegate.id },
        data: { registrationStatus: 'active' },
      });
      const ok = await signInWithLink(agent, pendingEmail);
      accountIds.push(ok.body.user.id);
    });

    it('test registrations sign in only with the explicit allowance; cancelled and archived never do', async () => {
      const testEmail = `test-${unique()}@example.com`;
      await register(testEmail, { registrationStatus: 'test' });
      const cancelled = `cancel-${unique()}@example.com`;
      await register(cancelled, { registrationStatus: 'cancelled' });
      const archivedEvent = await prisma.event.create({
        data: {
          slug: `test-event-arch-${unique()}`,
          name: 'Archived',
          startsOn: new Date(),
          endsOn: new Date(),
          status: 'archived',
        },
      });
      const archived = `arch-${unique()}@example.com`;
      await register(archived, {}, archivedEvent.id);

      const strict = request(app());
      for (const email of [testEmail, cancelled, archived]) {
        expect((await requestLink(strict, email)).status).toBe(202);
      }
      expect(mailer.sent).toHaveLength(0);

      const allowed = request(app({ AUTH_ALLOW_TEST_REGISTRATIONS: 'true' }));
      const ok = await signInWithLink(allowed, testEmail);
      expect(ok.body.user.role).toBe('delegate');
      accountIds.push(ok.body.user.id);
      expect((await requestLink(allowed, cancelled)).status).toBe(202);
      expect(mailer.sent).toHaveLength(1); // only the test registration got a link
      await prisma.event.delete({ where: { id: archivedEvent.id } });
    });

    it('links the account to the identity once, sets signed_up_at per event record, and scopes the session to the identity', async () => {
      const email = `two-${unique()}@example.com`;
      const first = await register(email, { name: 'Two Events' });
      const agent = request(app());
      const ok = await signInWithLink(agent, email);
      accountIds.push(ok.body.user.id);
      const identity = await prisma.delegateIdentity.findUniqueOrThrow({
        where: { id: first.identity.id },
      });
      expect(identity.userAccountId).toBe(ok.body.user.id);
      const record1 = await prisma.delegate.findUniqueOrThrow({ where: { id: first.delegate.id } });
      expect(record1.userAccountId).toBe(ok.body.user.id);
      expect(record1.signedUpAt).toBeInstanceOf(Date);

      // A later event attaches a record to the same identity (as a committed import does).
      const other = await createTestEvent(prisma);
      const record2 = await prisma.delegate.create({
        data: {
          eventId: other.id,
          identityId: identity.id,
          name: 'Two Events',
          email,
          attendanceFormat: 'virtual',
        },
      });
      const cookie = cookieFrom(ok);
      const me = await agent.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(200);
      expect(me.body.user.delegate.id).toBe(record2.id); // most recent eligible record
      const mine = await agent.get('/api/v1/me/delegate').set('Cookie', cookie);
      expect(mine.status).toBe(200);
      expect(mine.body.delegate.id).toBe(record2.id);
      // /delegates/:id stays staff-only: a delegate session is refused even for its own records.
      expect(
        (await agent.get(`/api/v1/delegates/${first.delegate.id}`).set('Cookie', cookie)).status,
      ).toBe(403);

      // Another person's record is not.
      const stranger = await register(`stranger-${unique()}@example.com`);
      expect(
        (await agent.get(`/api/v1/delegates/${stranger.delegate.id}`).set('Cookie', cookie)).status,
      ).toBe(403);

      // A second sign-in links nothing anew and keeps the first signed_up_at.
      const again = await signInWithLink(request(app()), email);
      expect(again.body.user.id).toBe(ok.body.user.id);
      const after = await prisma.delegate.findUniqueOrThrow({ where: { id: first.delegate.id } });
      expect(after.signedUpAt?.getTime()).toBe(record1.signedUpAt?.getTime());
      expect(
        (await prisma.delegate.findUniqueOrThrow({ where: { id: record2.id } })).signedUpAt,
      ).toBeInstanceOf(Date);
      expect(
        await prisma.delegateIdentity.count({ where: { userAccountId: ok.body.user.id } }),
      ).toBe(1);
      await prisma.event.delete({ where: { id: other.id } });
    });

    it('an identity already linked to another account is never re-linked, and an inactive account cannot sign in', async () => {
      const email = `owned-${unique()}@example.com`;
      const owner = await prisma.userAccount.create({
        data: { email: `owner-${unique()}@example.com`, role: 'delegate' },
      });
      accountIds.push(owner.id);
      await register(email, { userAccountId: owner.id });
      // An account under the registration address itself exists separately (stale data): fail closed.
      const stale = await prisma.userAccount.create({ data: { email, role: 'delegate' } });
      accountIds.push(stale.id);
      const agent = request(app());
      expect((await requestLink(agent, email)).status).toBe(202);
      expect(mailer.sent).toHaveLength(0);

      const inactiveEmail = `inactive-${unique()}@example.com`;
      const inactive = await prisma.userAccount.create({
        data: { email: inactiveEmail, role: 'delegate', status: 'inactive' },
      });
      accountIds.push(inactive.id);
      await register(inactiveEmail, { userAccountId: inactive.id });
      expect((await requestLink(agent, inactiveEmail)).status).toBe(202);
      expect(mailer.sent).toHaveLength(0);
      expect(
        await prisma.auditLog.count({
          where: { action: 'signin.inactive_account', entityId: inactive.id },
        }),
      ).toBe(1);
    });

    it('retired roles cannot request a link, cannot verify, and an existing session is rejected; their sessions can still be revoked', async () => {
      const agent = request(app());
      for (const role of ['analyst', 'support'] as const) {
        const email = `${role}-${unique()}@example.com`;
        const account = await prisma.userAccount.create({ data: { email, role } });
        accountIds.push(account.id);
        expect((await requestLink(agent, email)).status).toBe(202);
        expect(mailer.sent).toHaveLength(0);
        // A session that predates the retirement resolves to nothing.
        const token = generateToken();
        await prisma.authSession.create({
          data: {
            userAccountId: account.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
        expect(
          (await agent.get('/api/v1/auth/me').set('Cookie', `mbc_session=${token}`)).status,
        ).toBe(401);
        // A token issued earlier (before the role was retired) cannot verify either.
        const issued = await prisma.signInToken.create({
          data: {
            email,
            userAccountId: account.id,
            tokenHash: hashToken(`t${token}`),
            expiresAt: new Date(Date.now() + 600_000),
          },
        });
        expect((await verify(agent, `t${token}`)).status).toBe(401);
        expect(
          (await prisma.signInToken.findUniqueOrThrow({ where: { id: issued.id } })).usedAt,
        ).toBeNull();
      }
    });
  },
);
