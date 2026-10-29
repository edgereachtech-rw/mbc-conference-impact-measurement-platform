import type { ShellSession } from './session';

export type ImportsAccess = 'signed-out' | 'forbidden' | 'allowed';

/**
 * Whether the import screen should render for this session. This only decides what the page
 * shows; the API authorises every import request on its own (backlog D9), so a forged or stale
 * session gains nothing from the screen.
 */
export function importsAccess(session: ShellSession | null): ImportsAccess {
  if (!session) return 'signed-out';
  return session.role === 'admin' ? 'allowed' : 'forbidden';
}
