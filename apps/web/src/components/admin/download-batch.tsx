'use client';

import type { EventBatchView } from '@mbc/shared';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';

import { NativeSelect } from '@/components/imports/native-select';

import { batchLabel, useEventBatches } from './use-batches';

/**
 * Which batch the downloads of an event page cover (2026-11-22): every report and export can be
 * narrowed to one batch's delegates on an event in batches. One choice per page, shared by every
 * download link on it; "All batches" by default. An event without batches never shows the
 * picker and its links never carry a batch.
 */
interface DownloadBatch {
  batch: string;
  setBatch: (id: string) => void;
  batches: EventBatchView[];
}

const Context = createContext<DownloadBatch>({ batch: '', setBatch: () => {}, batches: [] });

export function DownloadBatchProvider({
  eventId,
  children,
}: {
  eventId: string;
  children: ReactNode;
}) {
  const batches = useEventBatches(eventId);
  const [batch, setBatch] = useState('');
  // A batch that no longer exists reads as "All batches".
  const current = batches.some((b) => b.id === batch) ? batch : '';
  return (
    <Context.Provider value={{ batch: current, setBatch, batches }}>{children}</Context.Provider>
  );
}

/** The chosen batch's id, or '' for every delegate. */
export const useDownloadBatch = () => useContext(Context).batch;

/** A download address narrowed to the chosen batch. */
export function withBatch(url: string, batch: string): string {
  if (!batch) return url;
  return `${url}${url.includes('?') ? '&' : '?'}batch=${encodeURIComponent(batch)}`;
}

/** The "Downloads for" choice, shown only on an event in batches. */
export function DownloadBatchPicker() {
  const { batch, setBatch, batches } = useContext(Context);
  const id = useId();
  if (batches.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border border-corp-line bg-corp-surface px-3 py-2">
      <label htmlFor={id} className="text-sm font-semibold text-corp-ink">
        Downloads and lists for
      </label>
      <NativeSelect
        id={id}
        value={batch}
        onChange={(e) => setBatch(e.target.value)}
        className="w-auto rounded-none border-corp-line"
      >
        <option value="">All batches</option>
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {batchLabel(b)}
          </option>
        ))}
      </NativeSelect>
      <span className="text-xs text-corp-muted">
        Every PDF, Word and Excel download on this page covers the batch chosen here.
      </span>
    </div>
  );
}
