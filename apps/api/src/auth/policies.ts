import type { UserRole } from '@mbc/shared';

/**
 * Pure authorization rules (backlog section 2 and E3-6). Routers call these through the
 * middleware in ./middleware.ts; keeping them pure makes the matrix unit-testable.
 */

export interface Principal {
  userId: string;
  role: UserRole;
  /** The delegate record linked to this user, when the user is a delegate. */
  delegateId: string | null;
}

/** Roles that may read any delegate record of the event. */
export const DELEGATE_READ_ROLES: readonly UserRole[] = ['admin', 'analyst', 'support'];
/** Roles that may correct delegate records (E2-4); analysts are read-only (section 2). */
export const DELEGATE_WRITE_ROLES: readonly UserRole[] = ['admin', 'support'];
/** Roles that may manage staff accounts (E3-9). */
export const STAFF_ADMIN_ROLES: readonly UserRole[] = ['admin'];
/** Roles that may read reports and exports (E16); support and speakers may not. */
export const REPORT_ROLES: readonly UserRole[] = ['admin', 'analyst'];

export function hasRole(principal: Principal, roles: readonly UserRole[]): boolean {
  return roles.includes(principal.role);
}

/** A delegate may read only their own record; staff with a read role may read any. */
export function canReadDelegate(principal: Principal, delegateId: string): boolean {
  if (principal.role === 'delegate') return principal.delegateId === delegateId;
  return hasRole(principal, DELEGATE_READ_ROLES);
}

/** Corrections are a staff action; delegates request them (E17-8) rather than apply them. */
export function canWriteDelegate(principal: Principal): boolean {
  return hasRole(principal, DELEGATE_WRITE_ROLES);
}

export function canManageStaff(principal: Principal): boolean {
  return hasRole(principal, STAFF_ADMIN_ROLES);
}

export interface SessionFeedbackScope {
  /** User ids of the speakers/facilitators of the session. */
  facilitatorUserIds: readonly string[];
}

/**
 * Session feedback (E8-8, E8-10): admin and analyst see every session; a speaker sees only
 * sessions they facilitate. Delegates and support do not see aggregated feedback.
 */
export function canViewSessionFeedback(principal: Principal, scope: SessionFeedbackScope): boolean {
  if (hasRole(principal, REPORT_ROLES)) return true;
  if (principal.role === 'speaker') return scope.facilitatorUserIds.includes(principal.userId);
  return false;
}

/**
 * Speakers never see who wrote a comment unless the delegate recorded permission (E8-10);
 * admins and analysts see identities subject to the reporting rules.
 */
export function mustAnonymiseFeedback(principal: Principal): boolean {
  return principal.role === 'speaker';
}
