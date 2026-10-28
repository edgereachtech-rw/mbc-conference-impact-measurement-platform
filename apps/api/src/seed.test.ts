import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from './db.js';
import { hasDatabase, testPrisma } from './db/test-helpers.js';
import { ITTEC_2026, PARTICIPATION_CATEGORIES, seed, TEST_DELEGATE_COUNT } from './seed.js';

describe.skipIf(!hasDatabase)('seed', () => {
  let prisma: PrismaClient;
  const adminEmail = 'Seed-Admin@Example.com';

  beforeAll(() => {
    prisma = testPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the ITTEC 2026 event, categories, admin and test delegates', async () => {
    const result = await seed(prisma, { adminEmail, seedTestDelegates: true });

    const event = await prisma.event.findUniqueOrThrow({ where: { slug: ITTEC_2026.slug } });
    expect(event.id).toBe(result.eventId);
    expect(event.name).toContain('ITTEC 2026');
    expect(event.theme).toBe('Technology, Practice, and Impact');
    expect(event.startsOn.toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(event.endsOn.toISOString()).toBe('2026-11-13T00:00:00.000Z');
    expect(event.timezone).toBe('Africa/Lagos');
    expect(event.location).toContain('Lagos Oriental Hotel');
    expect(event.format).toBe('hybrid');

    const categories = await prisma.participationCategory.findMany({
      where: { eventId: event.id },
      orderBy: { code: 'asc' },
    });
    expect(categories.map((c) => c.code)).toEqual(PARTICIPATION_CATEGORIES.map((c) => c.code));

    const admin = await prisma.userAccount.findUniqueOrThrow({
      where: { email: 'seed-admin@example.com' },
    });
    expect(admin.role).toBe('admin');
    expect(result.adminUserId).toBe(admin.id);

    const testDelegates = await prisma.delegate.count({
      where: { eventId: event.id, registrationStatus: 'test' },
    });
    expect(testDelegates).toBe(TEST_DELEGATE_COUNT);
  });

  it('can run twice without creating duplicates', async () => {
    const first = await seed(prisma, { adminEmail, seedTestDelegates: true });
    const second = await seed(prisma, { adminEmail, seedTestDelegates: true });
    expect(second.eventId).toBe(first.eventId);

    expect(await prisma.event.count({ where: { slug: ITTEC_2026.slug } })).toBe(1);
    expect(await prisma.participationCategory.count({ where: { eventId: first.eventId } })).toBe(
      PARTICIPATION_CATEGORIES.length,
    );
    expect(await prisma.userAccount.count({ where: { email: 'seed-admin@example.com' } })).toBe(1);
    expect(
      await prisma.delegate.count({
        where: { eventId: first.eventId, registrationStatus: 'test' },
      }),
    ).toBe(TEST_DELEGATE_COUNT);
  });

  it('never seeds test delegates when NODE_ENV is production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await seed(prisma, { seedTestDelegates: true });
      expect(result.testDelegates).toBe(0);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
