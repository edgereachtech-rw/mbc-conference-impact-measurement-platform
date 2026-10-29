'use client';

import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { describeError, formatDateTime } from '@/lib/imports';
import {
  messageStatusLabels,
  recipientStatusLabels,
  type DelegateMessageDetail,
  type DelegateMessageSummary,
} from '@/lib/messages';

import { pageSlice, StatusPill, TablePagination } from '@/components/console/page';

interface Props {
  eventId: string;
  /** Bump to reload after a message is sent. */
  refreshKey?: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; messages: DelegateMessageSummary[] }
  | { kind: 'error'; message: string };

const TONE: Record<DelegateMessageSummary['status'], 'positive' | 'attention' | 'neutral'> = {
  sending: 'neutral',
  sent: 'positive',
  partially_failed: 'attention',
  failed: 'attention',
};

/** Messages sent to this event's delegates, newest first, each expandable to the per-recipient outcome. */
export function MessagesHistory({ eventId, refreshKey = 0 }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<DelegateMessageDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ messages: DelegateMessageSummary[] }>(`/events/${eventId}/messages`).then(
      ({ messages }) => {
        if (!cancelled) setState({ kind: 'ready', messages });
      },
      (e: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: describeError(e).message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, refreshKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<{ message: DelegateMessageDetail }>(`/events/${eventId}/messages/${open}`).then(
      ({ message }) => {
        if (!cancelled) {
          setDetail(message);
          setDetailError(null);
        }
      },
      (e: unknown) => {
        if (!cancelled) setDetailError(describeError(e).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, open]);

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading messages…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
        <p className="font-semibold text-corp-ink">Messages unavailable</p>
        <p className="mt-1 text-sm text-corp-text">{state.message}</p>
      </div>
    );
  }
  if (state.messages.length === 0) {
    return (
      <p className="rounded-none border border-dashed border-corp-line bg-white p-5 text-sm text-corp-text">
        No messages have been sent to this event&apos;s delegates yet. Tick delegates in the table
        above and choose Send email.
      </p>
    );
  }

  const visible = pageSlice(state.messages, page, pageSize);
  return (
    <div className="overflow-hidden border border-corp-line bg-white">
      <table className="w-full text-sm" aria-label="Messages">
        <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2">
              Subject
            </th>
            <th scope="col" className="hidden px-4 py-2 sm:table-cell">
              Sent
            </th>
            <th scope="col" className="px-4 py-2">
              Recipients
            </th>
            <th scope="col" className="hidden px-4 py-2 md:table-cell">
              By
            </th>
            <th scope="col" className="px-4 py-2">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-corp-line">
          {visible.map((m) => (
            <tr key={m.id} className="align-top">
              <td className="px-4 py-3">
                <button
                  type="button"
                  aria-expanded={open === m.id}
                  onClick={() => {
                    setDetail(null);
                    setOpen(open === m.id ? null : m.id);
                  }}
                  className="text-left font-semibold text-corp-ink hover:underline"
                >
                  {m.subject}
                </button>
                <p className="text-xs text-corp-muted sm:hidden">{formatDateTime(m.createdAt)}</p>
                {open === m.id ? (
                  <div className="mt-3 border border-corp-line bg-corp-surface p-3">
                    {detailError ? (
                      <p role="alert" className="text-sm text-brand-danger">
                        {detailError}
                      </p>
                    ) : !detail ? (
                      <p className="text-sm text-corp-muted" role="status">
                        Loading…
                      </p>
                    ) : (
                      <>
                        <pre className="font-sans text-sm whitespace-pre-wrap text-corp-text">
                          {detail.body}
                        </pre>
                        <ul className="mt-3 divide-y divide-corp-line border-t border-corp-line text-sm">
                          {detail.recipients.map((r) => (
                            <li
                              key={r.delegateId}
                              className="flex items-center justify-between gap-3 py-1.5"
                            >
                              <span className="min-w-0">
                                <span className="font-medium text-corp-ink">{r.name}</span>{' '}
                                <span className="text-xs text-corp-muted">{r.email}</span>
                              </span>
                              <StatusPill tone={r.status === 'sent' ? 'positive' : 'attention'}>
                                {recipientStatusLabels[r.status]}
                              </StatusPill>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ) : null}
              </td>
              <td className="hidden px-4 py-3 text-corp-text sm:table-cell">
                {formatDateTime(m.createdAt)}
              </td>
              <td className="px-4 py-3 text-corp-text">
                {m.sentCount} of {m.recipientCount}
                {m.failedCount > 0 ? (
                  <span className="block text-xs text-brand-danger">{m.failedCount} failed</span>
                ) : null}
              </td>
              <td className="hidden px-4 py-3 text-xs text-corp-muted md:table-cell">
                {m.sentBy ?? '–'}
              </td>
              <td className="px-4 py-3">
                <StatusPill tone={TONE[m.status]}>{messageStatusLabels[m.status]}</StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={state.messages.length}
        noun="messages"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
