import { safeReturnPath, type ConsentNotice, type ConsentState } from '@mbc/shared';
import { cookies } from 'next/headers';

import { apiInternalUrl } from './api';

/**
 * The privacy notice and the signed-in delegate's acceptance, read on the server (backlog E3-7).
 *
 * Used twice: to gate the delegate area until the current notice is accepted, and to render the
 * notice page itself. A failure to reach the API yields null, which never blocks anyone — the
 * platform does not lock a delegate out of their records because a notice could not be loaded.
 */

const COOKIE_NAME = 'mbc_session';

async function get<T>(path: string, withCookie: boolean): Promise<T | null> {
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (withCookie) {
      const token = (await cookies()).get(COOKIE_NAME)?.value;
      if (!token) return null;
      headers.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}`;
    }
    const res = await fetch(`${apiInternalUrl()}/api/v1${path}`, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The notice in force, for anyone, signed in or not. */
export async function loadPrivacyNotice(): Promise<ConsentNotice | null> {
  const body = await get<{ notice: ConsentNotice }>('/consent/privacy', false);
  return body?.notice ?? null;
}

/** The signed-in person's consent state; null when not signed in or the API could not be reached. */
export async function loadConsentState(): Promise<ConsentState | null> {
  return get<ConsentState>('/me/consent', true);
}

/**
 * Where to send a delegate who still owes acceptance, or null to let them through. Called by the
 * delegate layout and the feedback page, which are the two ways into a delegate's own records.
 */
export async function consentGate(returnTo: string): Promise<string | null> {
  const state = await loadConsentState();
  if (!state?.outstanding) return null;
  const next = safeReturnPath(returnTo);
  return `/privacy${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}
