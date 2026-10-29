import { describe, expect, it } from 'vitest';

import {
  canManageStaff,
  canReadDelegate,
  canViewSessionFeedback,
  canWriteDelegate,
  mustAnonymiseFeedback,
  type Principal,
} from './policies.js';

const p = (role: Principal['role'], delegateId: string | null = null): Principal => ({
  userId: `user-${role}`,
  role,
  delegateId,
});

describe('authorization policies (backlog section 2, E3-6, E8-10)', () => {
  it('delegates read only their own record; staff read roles read any; speakers none', () => {
    expect(canReadDelegate(p('delegate', 'd1'), 'd1')).toBe(true);
    expect(canReadDelegate(p('delegate', 'd1'), 'd2')).toBe(false);
    expect(canReadDelegate(p('admin'), 'd2')).toBe(true);
    expect(canReadDelegate(p('analyst'), 'd2')).toBe(true);
    expect(canReadDelegate(p('support'), 'd2')).toBe(true);
    expect(canReadDelegate(p('speaker'), 'd2')).toBe(false);
  });

  it('only admin and support may correct delegate records; analysts are read-only', () => {
    expect(canWriteDelegate(p('admin'))).toBe(true);
    expect(canWriteDelegate(p('support'))).toBe(true);
    expect(canWriteDelegate(p('analyst'))).toBe(false);
    expect(canWriteDelegate(p('speaker'))).toBe(false);
    expect(canWriteDelegate(p('delegate', 'd1'))).toBe(false);
  });

  it('only admins manage staff accounts', () => {
    expect(canManageStaff(p('admin'))).toBe(true);
    for (const role of ['analyst', 'support', 'speaker', 'delegate'] as const) {
      expect(canManageStaff(p(role)), role).toBe(false);
    }
  });

  it('speakers see feedback for their own sessions only, anonymised', () => {
    const scope = { facilitatorUserIds: ['user-speaker'] };
    const other = { facilitatorUserIds: ['someone-else'] };
    expect(canViewSessionFeedback(p('speaker'), scope)).toBe(true);
    expect(canViewSessionFeedback(p('speaker'), other)).toBe(false);
    expect(mustAnonymiseFeedback(p('speaker'))).toBe(true);
    expect(canViewSessionFeedback(p('admin'), other)).toBe(true);
    expect(canViewSessionFeedback(p('analyst'), other)).toBe(true);
    expect(mustAnonymiseFeedback(p('admin'))).toBe(false);
    expect(canViewSessionFeedback(p('support'), scope)).toBe(false);
    expect(canViewSessionFeedback(p('delegate', 'd1'), scope)).toBe(false);
  });
});
