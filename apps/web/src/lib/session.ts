import { cookies } from 'next/headers';

import type { SessionUser } from '@mbc/shared';

import type { ParticipationMode } from '@/config/event';

import { apiInternalUrl } from './api';

/** What the app shell needs to know about the signed-in person. */
export interface ShellSession {
  displayName: string;
  role: SessionUser['role'];
  /** Only delegates have a participation mode. */
  participationMode?: ParticipationMode;
  user: SessionUser;
}

const COOKIE_NAME = 'mbc_session';

/**
 * Resolves the session for a server component by asking the API with the request's cookie.
 * Any failure (no cookie, expired, API down) yields null: the shell renders signed out and the
 * API itself keeps enforcing authorization on every data request.
 */
export async function getSession(): Promise<ShellSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const res = await fetch(`${apiInternalUrl()}/api/v1/auth/me`, {
      headers: {
        cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const { user } = (await res.json()) as { user: SessionUser };
    return {
      displayName: user.displayName,
      role: user.role,
      participationMode: user.delegate?.attendanceFormat,
      user,
    };
  } catch {
    return null;
  }
}
