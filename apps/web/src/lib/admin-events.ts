import type { EventDetail } from '@mbc/shared';
import { cookies } from 'next/headers';

import { apiInternalUrl } from '@/lib/api';

/**
 * Server-side load of one event as the API serves it to the signed-in admin session, or null
 * when it does not exist or the session may not see it. Shared by the event page and the
 * assessment stage page so both resolve access the same way.
 */
export async function loadAdminEvent(eventId: string): Promise<EventDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const store = await cookies();
  const token = store.get('mbc_session')?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${apiInternalUrl()}/api/v1/events/${eventId}`, {
      headers: { cookie: `mbc_session=${encodeURIComponent(token)}`, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return ((await res.json()) as { event: EventDetail }).event;
  } catch {
    return null;
  }
}
