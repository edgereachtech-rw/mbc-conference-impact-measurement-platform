'use client';

import type { DelegateListItem, DelegateListResponse, DelegateListStatus } from '@mbc/shared';
import { Loader2Icon, MailIcon, SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { NativeSelect } from '@/components/imports/native-select';
import { ParticipationBadge } from '@/components/badges/participation-badge';
import { apiFetch } from '@/lib/api';
import { describeError } from '@/lib/imports';
import type {
  DelegateMessageRecipients,
  DelegateMessageSendResult,
  PreviewSample,
} from '@/lib/messages';

import { MessageComposer } from './message-composer';
import { StatTile, StatusPill } from './page-header';

const STATUS_LABEL: Record<DelegateListStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  cancelled: 'Cancelled',
  duplicate: 'Duplicate',
  test: 'Test',
};
const STATUS_TONE: Record<DelegateListStatus, 'positive' | 'attention' | 'neutral'> = {
  active: 'positive',
  pending: 'attention',
  cancelled: 'neutral',
  duplicate: 'neutral',
  test: 'neutral',
};
/** Statuses an admin may set here (E2-4, E2-5); duplicate and test are never set this way. */
const SETTABLE: DelegateListStatus[] = ['active', 'pending', 'cancelled'];
const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'organisation', label: 'Organisation' },
  { value: 'registrationStatus', label: 'Status' },
  { value: 'createdAt', label: 'Added' },
] as const;

type Filter = '' | DelegateListStatus;

interface Composer {
  recipients: DelegateMessageRecipients;
  count: number;
  sample?: PreviewSample;
}

interface Props {
  /** The event whose registrations are listed; the page that owns the event passes it. */
  eventId: string;
  /** Shown in the message composer and used for the {{eventName}} preview. */
  eventName?: string;
  /** Called after a message to delegates was sent, so the page can refresh the history. */
  onMessageSent?: (result: DelegateMessageSendResult) => void;
}

/**
 * Delegates of one event (E2-6 subset): search, status chips, sortable paged table, inline status
 * change through the audited correction route, and selection by checkbox to email the chosen
 * delegates (E2-14). Everything is read from and written through admin-only routes; the table
 * decides nothing itself.
 */
export function DelegateTable({ eventId, eventName = 'this event', onMessageSent }: Props) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Filter>('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('name');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<DelegateListResponse | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  /** Key of the request whose result `data` holds; a different current key means loading. */
  const [loadedKey, setLoadedKey] = useState('');
  const [reload, setReload] = useState(0);
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; ok: boolean } | null>(
    null,
  );
  /** Ticked registration ids; kept across pages until cleared or sent. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** "Every delegate matching the current filter", beyond the page on screen. */
  const [allMatching, setAllMatching] = useState(false);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headerCheckbox = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams({
    sort,
    direction,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) params.set('q', search);
  if (status) params.set('status', status);
  const requestKey = eventId ? `${eventId}/delegates?${params.toString()}#${reload}` : '';
  const loading = requestKey !== '' && requestKey !== loadedKey;

  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    const [path] = requestKey.split('#');
    apiFetch<DelegateListResponse>(`/events/${path}`).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoadedKey(requestKey);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(describeError(e, 'We could not load the delegates.'));
        setLoadedKey(requestKey);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const rows = data?.delegates ?? [];
  const selectable = rows.filter((d) => d.registrationStatus !== 'duplicate');
  const allOnPage = selectable.length > 0 && selectable.every((d) => selected.has(d.id));
  const someOnPage = selectable.some((d) => selected.has(d.id));
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someOnPage && !allOnPage;
  }, [someOnPage, allOnPage]);

  function changeFilter(update: () => void) {
    update();
    setPage(1);
    setAllMatching(false);
  }
  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    if (!on) setAllMatching(false);
  }
  function togglePage(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of selectable) {
        if (on) next.add(d.id);
        else next.delete(d.id);
      }
      return next;
    });
    if (!on) setAllMatching(false);
  }
  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }
  function openComposer() {
    if (!data) return;
    const sample = rows.find((d) => selected.has(d.id)) ?? rows[0];
    const preview: PreviewSample | undefined = sample
      ? { name: sample.name, email: sample.email, organisation: sample.organisation }
      : undefined;
    setNotice(null);
    if (allMatching) {
      setComposer({
        recipients: {
          filter: {
            ...(status ? { status } : {}),
            ...(search ? { q: search } : {}),
          },
        },
        count: data.total,
        sample: preview,
      });
    } else {
      setComposer({
        recipients: { delegateIds: [...selected] },
        count: selected.size,
        sample: preview,
      });
    }
  }

  async function changeStatus(delegate: DelegateListItem, next: DelegateListStatus) {
    if (next === delegate.registrationStatus) return;
    setRowMessage(null);
    try {
      await apiFetch(`/delegates/${delegate.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ registrationStatus: next }),
      });
      setRowMessage({
        id: delegate.id,
        text: `Status set to ${STATUS_LABEL[next].toLowerCase()}.`,
        ok: true,
      });
      setReload((n) => n + 1);
    } catch (e) {
      const failure = describeError(e, 'The status could not be changed.');
      setRowMessage({ id: delegate.id, text: failure.message, ok: false });
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const counts = data?.counts;
  const chips: Array<{ value: Filter; label: string; count: number | null }> = [
    {
      value: '',
      label: 'All',
      count: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null,
    },
    ...(['active', 'pending', 'cancelled', 'duplicate', 'test'] as const).map((s) => ({
      value: s,
      label: STATUS_LABEL[s],
      count: counts ? counts[s] : null,
    })),
  ];
  const selectionCount = allMatching ? (data?.total ?? selected.size) : selected.size;
  const showSelectionBar = selected.size > 0 || allMatching;
  const canSelectAllMatching =
    !!data && allOnPage && !allMatching && data.total > rows.length && status !== 'duplicate';

  return (
    <div className="space-y-6">
      <div className="grid gap-3">
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            changeFilter(() => setSearch(q.trim()));
          }}
        >
          <label
            htmlFor="delegates-search"
            className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase"
          >
            Search
          </label>
          <div className="flex gap-2">
            <input
              id="delegates-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, email, organisation or registration id"
              className="h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
            />
            <button
              type="submit"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-none bg-corp-green px-4 text-sm font-semibold text-white hover:bg-corp-ink"
            >
              <SearchIcon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Search</span>
            </button>
          </div>
        </form>
      </div>

      {counts ? (
        <section
          aria-label="Registrations by status"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          <StatTile label="Active" value={counts.active} tone="positive" />
          <StatTile
            label="Pending"
            value={counts.pending}
            tone={counts.pending > 0 ? 'attention' : 'neutral'}
          />
          <StatTile label="Cancelled" value={counts.cancelled} />
          <StatTile label="Duplicate" value={counts.duplicate} />
          <StatTile label="Test" value={counts.test} />
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {chips.map((chip) => (
          <button
            key={chip.value || 'all'}
            type="button"
            aria-pressed={status === chip.value}
            onClick={() => changeFilter(() => setStatus(chip.value))}
            className={
              status === chip.value
                ? 'min-h-tap rounded-none border border-corp-ink bg-corp-ink px-3 text-sm font-medium text-white'
                : 'min-h-tap rounded-none border border-corp-line bg-white px-3 text-sm font-medium text-corp-text hover:bg-corp-surface'
            }
          >
            {chip.label}
            {chip.count !== null ? ` (${chip.count})` : ''}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label htmlFor="delegates-sort" className="text-corp-muted">
            Sort
          </label>
          <NativeSelect
            id="delegates-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-10 w-auto rounded-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <button
            type="button"
            onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
            className="min-h-10 rounded-none border border-corp-line bg-white px-3 text-sm"
            aria-label={
              direction === 'asc'
                ? 'Sorted ascending; switch to descending'
                : 'Sorted descending; switch to ascending'
            }
          >
            {direction === 'asc' ? 'A→Z' : 'Z→A'}
          </button>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className="border border-corp-green-line bg-corp-green-soft px-4 py-3 text-sm text-corp-green-text"
        >
          {notice}
        </p>
      ) : null}

      {showSelectionBar ? (
        <div
          role="region"
          aria-label="Selection"
          className="flex flex-col gap-2 border border-corp-ink bg-corp-ink px-4 py-3 text-sm text-white sm:flex-row sm:items-center"
        >
          <p className="font-semibold">
            {allMatching
              ? `All ${selectionCount} delegates matching the current filter selected`
              : `${selectionCount} selected`}
          </p>
          {canSelectAllMatching ? (
            <button
              type="button"
              onClick={() => setAllMatching(true)}
              className="text-left underline underline-offset-2 hover:text-corp-green-line"
            >
              Select all {data.total} matching
            </button>
          ) : null}
          <div className="flex gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex min-h-10 items-center rounded-none border border-white/40 px-3 font-medium hover:bg-white/10"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={openComposer}
              className="inline-flex min-h-10 items-center gap-2 rounded-none bg-corp-green px-4 font-semibold text-white hover:bg-corp-green-bright"
            >
              <MailIcon className="size-4" aria-hidden="true" /> Send email
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
          <p className="font-semibold text-corp-ink">Delegates unavailable</p>
          <p className="mt-1 text-sm text-corp-text">{error.message}</p>
          {error.requestId ? (
            <p className="mt-1 text-xs text-corp-muted">Request id {error.requestId}</p>
          ) : null}
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="mt-4 inline-flex min-h-tap items-center rounded-none border border-corp-green px-5 text-sm font-semibold text-corp-green-text hover:bg-corp-green-soft"
          >
            Try again
          </button>
        </div>
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-corp-muted" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading delegates…
        </p>
      ) : data.delegates.length === 0 ? (
        <p className="rounded-none border border-dashed border-corp-line bg-white p-5 text-sm text-corp-text">
          {search || status
            ? 'No delegates match this search or filter.'
            : 'No delegates have been imported for this event yet.'}
        </p>
      ) : (
        <div className="overflow-hidden border border-corp-line bg-white" aria-busy={loading}>
          <table className="w-full text-sm" aria-label="Delegates">
            <thead className="bg-corp-surface text-left text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    disabled={selectable.length === 0}
                    onChange={(e) => togglePage(e.target.checked)}
                    className="size-5 accent-corp-green"
                  />
                </th>
                <th scope="col" className="px-4 py-2">
                  Delegate
                </th>
                <th scope="col" className="hidden px-4 py-2 md:table-cell">
                  Organisation
                </th>
                <th scope="col" className="hidden px-4 py-2 lg:table-cell">
                  Country
                </th>
                <th scope="col" className="px-4 py-2">
                  Format
                </th>
                <th scope="col" className="px-4 py-2">
                  Status
                </th>
                <th scope="col" className="hidden px-4 py-2 lg:table-cell">
                  Signed in
                </th>
                <th scope="col" className="hidden px-4 py-2 xl:table-cell">
                  Source id
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-corp-line">
              {data.delegates.map((d) => (
                <tr
                  key={d.id}
                  className={selected.has(d.id) ? 'bg-corp-green-soft align-top' : 'align-top'}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${d.name}`}
                      checked={selected.has(d.id)}
                      disabled={d.registrationStatus === 'duplicate'}
                      title={
                        d.registrationStatus === 'duplicate'
                          ? 'Merged duplicates cannot be messaged'
                          : undefined
                      }
                      onChange={(e) => toggle(d.id, e.target.checked)}
                      className="size-5 accent-corp-green"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-corp-ink">{d.name}</p>
                    <p className="truncate text-xs text-corp-muted">{d.email}</p>
                    <p className="text-xs text-corp-muted md:hidden">{d.organisation ?? ''}</p>
                    {rowMessage?.id === d.id ? (
                      <p
                        role="status"
                        className={
                          rowMessage.ok
                            ? 'mt-1 text-xs text-corp-green-text'
                            : 'mt-1 text-xs text-brand-danger'
                        }
                      >
                        {rowMessage.text}
                      </p>
                    ) : null}
                  </td>
                  <td className="hidden px-4 py-3 text-corp-text md:table-cell">
                    <p>{d.organisation ?? '–'}</p>
                    {d.jobTitle ? <p className="text-xs text-corp-muted">{d.jobTitle}</p> : null}
                  </td>
                  <td className="hidden px-4 py-3 text-corp-text lg:table-cell">
                    {d.country ?? '–'}
                  </td>
                  <td className="px-4 py-3">
                    <ParticipationBadge mode={d.attendanceFormat} />
                  </td>
                  <td className="px-4 py-3">
                    {SETTABLE.includes(d.registrationStatus) ? (
                      <NativeSelect
                        aria-label={`Status of ${d.name}`}
                        value={d.registrationStatus}
                        onChange={(e) => void changeStatus(d, e.target.value as DelegateListStatus)}
                        className="h-10 w-auto rounded-none text-sm"
                      >
                        {SETTABLE.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <StatusPill tone={STATUS_TONE[d.registrationStatus]}>
                        {STATUS_LABEL[d.registrationStatus]}
                      </StatusPill>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-corp-text lg:table-cell">
                    {d.signedUpAt ? (
                      new Date(d.signedUpAt).toLocaleDateString()
                    ) : (
                      <span className="text-corp-muted">Not yet</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-corp-muted xl:table-cell">
                    {d.externalRegistrationId
                      ? `${d.registrationSource ?? ''} ${d.externalRegistrationId}`.trim()
                      : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-2 border-t border-corp-line px-4 py-3 text-sm text-corp-muted sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing {(data.page - 1) * data.pageSize + 1}–
              {Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="min-h-10 rounded-none border border-corp-line bg-white px-3 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="self-center">
                Page {data.page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-10 rounded-none border border-corp-line bg-white px-3 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {composer ? (
        <MessageComposer
          eventId={eventId}
          eventName={eventName}
          recipients={composer.recipients}
          recipientCount={composer.count}
          sample={composer.sample}
          onClose={() => setComposer(null)}
          onSent={(result) => {
            clearSelection();
            setNotice(
              result.failed === 0
                ? `Message sent to ${result.sent} delegate${result.sent === 1 ? '' : 's'}.`
                : `Message sent to ${result.sent} of ${result.total} delegates; ${result.failed} failed. See Messages below.`,
            );
            onMessageSent?.(result);
          }}
        />
      ) : null}
    </div>
  );
}
