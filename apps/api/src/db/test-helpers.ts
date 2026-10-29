import { randomUUID } from 'node:crypto';

import { createPrismaClient, type PrismaClient } from '../db.js';

/** Database tests run only when DATABASE_URL points at a migrated PostgreSQL (CI service or local container). */
export const databaseUrl = process.env.DATABASE_URL;
export const hasDatabase = Boolean(databaseUrl);

export function testPrisma(): PrismaClient {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for database tests');
  return createPrismaClient(databaseUrl);
}

/** Creates a throwaway event so each test file works on its own rows. */
export async function createTestEvent(prisma: PrismaClient) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.event.create({
    data: {
      slug: `test-event-${suffix}`,
      name: `Test event ${suffix}`,
      startsOn: new Date('2026-11-12T00:00:00.000Z'),
      endsOn: new Date('2026-11-13T00:00:00.000Z'),
      status: 'draft',
    },
  });
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: string; message?: string };
  return (
    code === 'P2002' || code === '23505' || /unique constraint|duplicate key/i.test(message ?? '')
  );
}

/**
 * A registered person as an import would create them (D8 item 1): a platform identity whose
 * current address is `email`, plus a registration in the event linked to that identity.
 */
export async function createRegisteredIdentity(
  prisma: PrismaClient,
  eventId: string,
  email: string,
  options: {
    name?: string;
    registrationStatus?: 'active' | 'pending' | 'cancelled' | 'duplicate' | 'test';
    attendanceFormat?: 'physical' | 'virtual';
    userAccountId?: string | null;
  } = {},
) {
  const normalised = email.trim().toLowerCase();
  const identity = await prisma.delegateIdentity.create({
    data: {
      displayName: options.name ?? `Delegate ${normalised}`,
      userAccountId: options.userAccountId ?? null,
      emails: { create: { emailNormalised: normalised, kind: 'current', evidence: 'import' } },
    },
  });
  const delegate = await prisma.delegate.create({
    data: {
      eventId,
      identityId: identity.id,
      name: options.name ?? `Delegate ${normalised}`,
      email: normalised,
      attendanceFormat: options.attendanceFormat ?? 'physical',
      registrationStatus: options.registrationStatus ?? 'active',
      userAccountId: options.userAccountId ?? null,
    },
  });
  return { identity, delegate };
}

/** Removes an identity created by createRegisteredIdentity once its registrations are gone. */
export async function deleteIdentity(prisma: PrismaClient, identityId: string) {
  await prisma.identityEmail.deleteMany({ where: { identityId } });
  await prisma.delegate.deleteMany({ where: { identityId } });
  await prisma.delegateIdentity.delete({ where: { id: identityId } }).catch(() => undefined);
}
