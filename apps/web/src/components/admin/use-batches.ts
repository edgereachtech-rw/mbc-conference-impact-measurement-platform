'use client';

import type { EventBatchView } from '@mbc/shared';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';

/**
 * The batches of an event (decision 2026-11-19), for the screens that assign delegates or
 * filter by batch. An event with no batches gives an empty list, and the screens then show no
 * batch controls at all. A failed load reads as no batches: nothing on these screens depends on
 * it beyond the control.
 */
export function useEventBatches(eventId: string | null | undefined): EventBatchView[] {
  const [loaded, setLoaded] = useState<{ for: string; list: EventBatchView[] } | null>(null);
  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;
    apiFetch<{ batches: EventBatchView[] }>(`/events/${eventId}/batches`).then(
      (r) => {
        if (!cancelled)
          setLoaded({ for: eventId, list: Array.isArray(r?.batches) ? r.batches : [] });
      },
      () => {
        if (!cancelled) setLoaded({ for: eventId, list: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId]);
  return loaded && loaded.for === eventId ? loaded.list : [];
}

/** "Batch 1 · 23 Nov 2026" for a select option. */
export function batchLabel(batch: Pick<EventBatchView, 'name' | 'date'>): string {
  const [y, m, d] = batch.date.split('-').map(Number);
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const text = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(day);
  return `${batch.name} · ${text}`;
}
