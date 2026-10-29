import { describe, expect, it } from 'vitest';

import {
  canManageStaff,
  canReadDelegate,
  canRunImports,
  canViewSessionFeedback,
  canWriteDelegate,
  hasRole,
  isRetiredRole,
  mustAnonymiseFeedback,
  type Principal,
} from './policies.js';

const p = (role: Principal['role'], ...delegateIds: string[]): Principal => ({
  userId: `user-${role}`,
  role,
  identityId: delegateIds.length > 0 ? `identity-${role}` : null,
  delegateIds,
  delegateId: delegateIds[0] ?? null,
});

describe('authorization policies (backlog section 2, E3-6, E8-10)', () => {
  it('delegates read every record of their own identity and nothing else; admins read any; speakers none', () => {
    expect(canReadDelegate(p('delegate', 'd1', 'd3'), 'd1')).toBe(true);
    expect(canReadDelegate(p('delegate', 'd1', 'd3'), 'd3')).toBe(true);
    expect(canReadDelegate(p('delegate', 'd1'), 'd2')).toBe(false);
    expect(canReadDelegate(p('delegate'), 'd1')).toBe(false);
    expect(canReadDelegate(p('admin'), 'd2')).toBe(true);
    expect(canReadDelegate(p('speaker'), 'd2')).toBe(false);
  });

  it('retired roles (analyst, support) are granted nothing (D8 item 7)', () => {
    for (const role of ['analyst', 'support'] as const) {
      expect(isRetiredRole(role)).toBe(true);
      expect(canReadDelegate(p(role), 'd2'), role).toBe(false);
      expect(canWriteDelegate(p(role)), role).toBe(false);
      expect(canManageStaff(p(role)), role).toBe(false);
      expect(canRunImports(p(role)), role).toBe(false);
      expect(hasRole(p(role), [role]), role).toBe(false);
    }
    expect(isRetiredRole('admin')).toBe(false);
  });

  it('only admins may correct delegate records', () => {
    expect(canWriteDelegate(p('admin'))).toBe(true);
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
    expect(mustAnonymiseFeedback(p('admin'))).toBe(false);
    expect(canViewSessionFeedback(p('delegate', 'd1'), scope)).toBe(false);
  });
});
