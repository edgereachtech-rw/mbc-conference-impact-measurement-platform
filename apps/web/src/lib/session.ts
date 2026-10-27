import type { ParticipationMode } from '@/config/event';

/** What the app shell needs to know about the signed-in person. */
export interface ShellSession {
  displayName: string;
  role: 'delegate' | 'admin';
  /** Only delegates have a participation mode. */
  participationMode?: ParticipationMode;
}

/**
 * Placeholder until E3 (sign-in and access control) lands.
 * Returns null so the shell renders its signed-out state.
 */
export async function getSession(): Promise<ShellSession | null> {
  return null;
}
