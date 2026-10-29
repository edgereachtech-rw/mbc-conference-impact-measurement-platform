import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../db.js';
import { audit } from '../lib/audit.js';
import { createTestEvent, hasDatabase, testPrisma } from './test-helpers.js';

const appendOnly = /append-only/i;

describe.skipIf(!hasDatabase)('audit_log is append-only', () => {
  let prisma: PrismaClient;
  let eventId: string;

  beforeAll(async () => {
    prisma = testPrisma();
    eventId = (await createTestEvent(prisma)).id;
  });

  afterAll(async () => {
    // The event row goes; its audit rows stay (event_id becomes null) because they cannot be deleted.
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.$disconnect();
  });

  it('audit() writes a row with old and new values', async () => {
    const row = await audit(prisma, {
      action: 'delegate.status_changed',
      entityType: 'delegate',
      entityId: 'test-entity',
      eventId,
      oldValue: { registrationStatus: 'active' },
      newValue: { registrationStatus: 'cancelled' },
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(row.id).toBeTruthy();
    expect(row.occurredAt).toBeInstanceOf(Date);
    expect(row.oldValue).toEqual({ registrationStatus: 'active' });
    expect(row.actorUserId).toBeNull();
  });

  it('works inside a transaction with the change it describes', async () => {
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.event.update({ where: { id: eventId }, data: { theme: 'changed' } });
      const row = await audit(tx, {
        action: 'event.updated',
        entityType: 'event',
        entityId: event.id,
        eventId: event.id,
        newValue: { theme: 'changed' },
      });
      return { event, row };
    });
    expect(result.row.entityId).toBe(result.event.id);
  });

  it('rejects UPDATE through the client', async () => {
    const row = await audit(prisma, { action: 'test.update', entityType: 'test', eventId });

    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(appendOnly);
  });

  it('rejects DELETE through the client', async () => {
    const row = await audit(prisma, { action: 'test.delete', entityType: 'test', eventId });

    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(appendOnly);
  });

  it('rejects raw UPDATE, DELETE and TRUNCATE', async () => {
    const row = await audit(prisma, { action: 'test.raw', entityType: 'test', eventId });

    await expect(
      prisma.$executeRaw`UPDATE audit_log SET action = 'tampered' WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(appendOnly);
    await expect(
      prisma.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(appendOnly);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_log')).rejects.toThrow(appendOnly);
  });
});
