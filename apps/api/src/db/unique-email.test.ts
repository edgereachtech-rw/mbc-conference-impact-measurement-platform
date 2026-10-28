import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../db.js';
import { createTestEvent, hasDatabase, isUniqueViolation, testPrisma } from './test-helpers.js';

describe.skipIf(!hasDatabase)('delegate unique email per event', () => {
  let prisma: PrismaClient;
  let eventId: string;

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
  });

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } }); // cascades to delegates
    await prisma.$disconnect();
  });

  const delegate = (email: string, overrides: Record<string, unknown> = {}) => ({
    eventId,
    name: 'Ada Lovelace',
    email,
    attendanceFormat: 'physical' as const,
    ...overrides,
  });

  it('rejects a second delegate with the same email in a different case', async () => {
    await prisma.delegate.create({ data: delegate('Ada@Example.com') });

    await expect(prisma.delegate.create({ data: delegate('ada@example.com') })).rejects.toSatisfy(
      isUniqueViolation,
    );
  });

  it('allows the same email again once the earlier record is marked duplicate', async () => {
    const first = await prisma.delegate.create({ data: delegate('grace@example.com') });
    await prisma.delegate.update({
      where: { id: first.id },
      data: { registrationStatus: 'duplicate' },
    });

    const second = await prisma.delegate.create({
      data: delegate('GRACE@example.com', { duplicateOfId: null }),
    });
    expect(second.id).not.toBe(first.id);
  });

  it('allows the same email in another event', async () => {
    const otherEvent = await createTestEvent(prisma);
    try {
      await prisma.delegate.create({ data: delegate('shared@example.com') });
      const other = await prisma.delegate.create({
        data: delegate('shared@example.com', { eventId: otherEvent.id }),
      });
      expect(other.eventId).toBe(otherEvent.id);
    } finally {
      await prisma.event.delete({ where: { id: otherEvent.id } });
    }
  });

  it('rejects two user accounts whose emails differ only by case', async () => {
    const email = `case-${Date.now()}@example.com`;
    const created = await prisma.userAccount.create({ data: { email, role: 'support' } });
    try {
      await expect(
        prisma.userAccount.create({ data: { email: email.toUpperCase(), role: 'support' } }),
      ).rejects.toSatisfy(isUniqueViolation);
    } finally {
      await prisma.userAccount.delete({ where: { id: created.id } });
    }
  });
});
