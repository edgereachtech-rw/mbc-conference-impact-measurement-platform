import type { UserRole } from '@mbc/shared';

/**
 * Pure authorization rules (backlog section 2 and E3-6). Routers call these through the
 * middleware in ./middleware.ts; keeping them pure makes the matrix unit-testable.
 */

export interface Principal {
  userId: string;
  role: UserRole;
  /** The platform identity linked to this account, when the user is a delegate (D8 item 3). */
  identityId: string | null;
  /** Every eligible event record owned by that identity; authorisation checks use this set. */
  delegateIds: readonly string[];
  /** The most recent eligible record, for screens that show "the" registration. */
  delegateId: string | null;
}

/**
 * Roles that are not part of the approved requirements (analyst and support, decisions of
 * 2026-10-29; speaker, decision of 2026-11-02; D8 item 7). An account still carrying one cannot
 * authenticate and is granted nothing; the enum values remain until no account carries them.
 */
export const RETIRED_ROLES: readonly UserRole[] = ['analyst', 'support', 'speaker'];

export function isRetiredRole(role: UserRole): boolean {
  return RETIRED_ROLES.includes(role);
}

/** Roles that may read any delegate record of the event (admins only since the role retirements). */
export const DELEGATE_READ_ROLES: readonly UserRole[] = ['admin'];
/** Roles that may correct delegate records (E2-4). */
export const DELEGATE_WRITE_ROLES: readonly UserRole[] = ['admin'];
/** Roles that may manage staff accounts (E3-9). */
export const STAFF_ADMIN_ROLES: readonly UserRole[] = ['admin'];
/** Roles that may run registration imports, read import history and resolve conflicts (D9). */
export const IMPORT_ROLES: readonly UserRole[] = ['admin'];
/** Roles that may read reports and exports (E16). */
export const REPORT_ROLES: readonly UserRole[] = ['admin'];

/** Who may email selected delegates of an event (E2-14): M.Bryan admins only. */
export const MESSAGE_ROLES: readonly UserRole[] = ['admin'];

/** Who may create and configure events (E1 brief, section 2): M.Bryan admins only. */
export const EVENT_SETUP_ROLES: readonly UserRole[] = ['admin'];

export function hasRole(principal: Principal, roles: readonly UserRole[]): boolean {
  if (isRetiredRole(principal.role)) return false;
  return roles.includes(principal.role);
}

/** A delegate may read only the records of their own identity; staff with a read role may read any. */
export function canReadDelegate(principal: Principal, delegateId: string): boolean {
  if (principal.role === 'delegate') return principal.delegateIds.includes(delegateId);
  return hasRole(principal, DELEGATE_READ_ROLES);
}

/** Corrections are a staff action; delegates request them (E17-8) rather than apply them. */
export function canWriteDelegate(principal: Principal): boolean {
  return hasRole(principal, DELEGATE_WRITE_ROLES);
}

export function canConfigureEvents(principal: Principal): boolean {
  return hasRole(principal, EVENT_SETUP_ROLES);
}

export function canMessageDelegates(principal: Principal): boolean {
  return hasRole(principal, MESSAGE_ROLES);
}

export function canManageStaff(principal: Principal): boolean {
  return hasRole(principal, STAFF_ADMIN_ROLES);
}

/** Imports are M.Bryan-admin-only: no other role sees uploads, previews, history or conflicts. */
export function canRunImports(principal: Principal): boolean {
  return hasRole(principal, IMPORT_ROLES);
}

/**
 * Session feedback (E8-8) is an admin screen. There is no speaker-facing view and no speaker
 * account: the role was removed on 2026-11-02, and an admin shares results by exporting the
 * anonymised dashboard (identities withheld) instead.
 */
export function canViewSessionFeedback(principal: Principal): boolean {
  return hasRole(principal, REPORT_ROLES);
}
