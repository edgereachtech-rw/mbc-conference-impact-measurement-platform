import type { MyEvent, MyEventResponse, MyEventsResponse } from '@mbc/shared';
import { cookies } from 'next/headers';

import { apiInternalUrl } from './api';

async function sessionFetch(path: string): Promise<Response | null> {
  const token = (await cookies()).get('mbc_session')?.value;
  if (!token) return null;
  try {
    return await fetch(`${apiInternalUrl()}/api/v1${path}`, {
      headers: { cookie: `mbc_session=${encodeURIComponent(token)}`, accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

/**
 * My Events as the API serves them to the request's session, loaded on the server so delegate
 * screens are complete on first paint. Null when that fails: the browser then loads them itself
 * and shows the proper error, and the API keeps authorising every request either way.
 */
export async function loadMyEvents(): Promise<MyEvent[] | null> {
  const res = await sessionFetch('/me/events');
  if (!res?.ok) return null;
  return ((await res.json()) as MyEventsResponse).events;
}

/** One of the delegate's events, or null when the API does not serve it to this session. */
export async function loadMyEvent(eventId: string): Promise<MyEvent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const res = await sessionFetch(`/me/events/${eventId}`);
  if (!res?.ok) return null;
  return ((await res.json()) as MyEventResponse).event;
}
