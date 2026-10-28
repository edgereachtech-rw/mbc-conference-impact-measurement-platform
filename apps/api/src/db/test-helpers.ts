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
