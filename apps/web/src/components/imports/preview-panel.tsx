'use client';

import type { ImportCounts, ImportRowOutcome } from '@mbc/shared';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatDateTime,
  type ImportValueMappings,
  isPreviewExpired,
  outcomeLabels,
  reasonLabel,
  resolutionLabels,
  type PreviewResult,
  type PreviewRow,
  type StoredRow,
} from '@/lib/imports';

import { ValueMappingForm } from './value-mapping-form';
import { cn } from '@/lib/utils';

type Filter = 'all' | ImportRowOutcome;

const FILTERS: Array<{ value: Filter; label: string; count: (c: ImportCounts) => number }> = [
  { value: 'all', label: 'All', count: (c) => c.total },
  { value: 'accepted', label: 'New', count: (c) => c.accepted },
  { value: 'updated', label: 'Updates', count: (c) => c.updated },
  { value: 'unchanged', label: 'No change', count: (c) => c.unchanged },
  { value: 'linked', label: 'Linked', count: (c) => c.linked },
  { value: 'duplicate_in_file', label: 'Duplicates', count: (c) => c.duplicateInFile },
  { value: 'rejected', label: 'Rejected', count: (c) => c.rejected },
  { value: 'conflict', label: 'Conflicts', count: (c) => c.conflict },
];

const badgeVariant: Record<
  ImportRowOutcome,
  'success' | 'secondary' | 'accent' | 'warning' | 'destructive' | 'outline'
> = {
  accepted: 'success',
  updated: 'accent',
  unchanged: 'outline',
  linked: 'accent',
  duplicate_in_file: 'secondary',
  rejected: 'destructive',
  conflict: 'warning',
};

export function CountSummary({ counts }: { counts: ImportCounts }) {
  const items: Array<[string, number]> = [
    ['New registrations', counts.accepted],
    ['Updates', counts.updated],
    ['No change', counts.unchanged],
    ['Linked to existing people', counts.linked],
    ['Duplicates in file', counts.duplicateInFile],
    ['Rejected', counts.rejected],
    ['Conflicts (quarantined)', counts.conflict],
    ['Possible duplicates flagged', counts.possibleDuplicate],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Import counts">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-brand-line bg-card px-3 py-2">
          <dt className="text-xs text-brand-muted">{label}</dt>
          <dd className="text-lg font-semibold text-brand-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OutcomeBadge({ outcome }: { outcome: ImportRowOutcome | null }) {
  if (!outcome) return <Badge variant="outline">Not previewed</Badge>;
  return <Badge variant={badgeVariant[outcome]}>{outcomeLabels[outcome]}</Badge>;
}

export function RowTable({
  rows,
  caption,
}: {
  rows: Array<PreviewRow | StoredRow>;
  caption: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-brand-muted">No rows in this group.</p>;
  }
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">Row</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.rowNumber} data-outcome={row.outcome ?? ''}>
            <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1">
                <OutcomeBadge outcome={row.outcome} />
                {row.possibleDuplicate ? <Badge variant="outline">Possible duplicate</Badge> : null}
                {'resolution' in row && row.resolution ? (
                  <Badge variant="success">{resolutionLabels[row.resolution]}</Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="max-w-[14rem] truncate">{row.values?.email ?? ''}</TableCell>
            <TableCell className="max-w-[12rem] truncate">{row.values?.name ?? ''}</TableCell>
            <TableCell className="max-w-[22rem] text-brand-muted">
              {row.outcome
                ? reasonLabel({
                    outcome: row.outcome,
                    reasonCode: row.reasonCode,
                    reasonDetail: row.reasonDetail,
                  })
                : ''}
              {row.conflict?.existing && typeof row.conflict.existing.name === 'string' ? (
                <span className="block text-xs">
                  Existing: {String(row.conflict.existing.name)}
                </span>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface PreviewPanelProps {
  counts: ImportCounts;
  rows: PreviewRow[];
  ignoredColumns: string[];
  unrecognisedValues?: PreviewResult['unrecognisedValues'];
  valueMappings?: ImportValueMappings;
  onValueMappingsChange?: (next: ImportValueMappings) => void;
  previewExpiresAt: string;
  /** Set after the server refused the confirmation; the preview must be rebuilt. */
  staleMessage: string | null;
  busy: boolean;
  onConfirm: () => void;
  onRefreshPreview: () => void;
  onBack: () => void;
  onDiscard: () => void;
}

/** Preview (D3 step 4) with the confirm step (D3 step 5). Confirm is enabled only while the preview is fresh. */
export function PreviewPanel({
  counts,
  rows,
  ignoredColumns,
  unrecognisedValues,
  valueMappings,
  onValueMappingsChange,
  previewExpiresAt,
  staleMessage,
  busy,
  onConfirm,
  onRefreshPreview,
  onBack,
  onDiscard,
}: PreviewPanelProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const expired = isPreviewExpired(previewExpiresAt, now);
  const stale =
    staleMessage ??
    (expired ? 'This preview has expired. Build a fresh preview before confirming.' : null);
  const visible = filter === 'all' ? rows : rows.filter((r) => r.outcome === filter);
  const applies = counts.accepted + counts.updated + counts.linked;

  return (
    <div className="space-y-6">
      <CountSummary counts={counts} />
      {unrecognisedValues && valueMappings && onValueMappingsChange ? (
        <ValueMappingForm
          unrecognisedValues={unrecognisedValues}
          valueMappings={valueMappings}
          onChange={onValueMappingsChange}
          busy={busy}
          onRebuild={onRefreshPreview}
        />
      ) : null}
      {ignoredColumns.length > 0 ? (
        <p className="text-sm text-brand-muted">Ignored columns: {ignoredColumns.join(', ')}.</p>
      ) : null}
      {counts.conflict > 0 ? (
        <p className="text-sm text-brand-muted">
          Conflicts are quarantined: confirming imports the other rows and changes nothing for the
          conflicting ones until an admin resolves them.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter rows by outcome">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'min-h-11 rounded-md border px-3 text-sm',
              filter === f.value
                ? 'border-brand-primary bg-brand-primary text-white'
                : 'border-brand-line bg-card text-brand-primary',
            )}
          >
            {f.label} ({f.count(counts)})
          </button>
        ))}
      </div>

      <RowTable rows={visible} caption="Preview rows" />

      <div className="space-y-3 rounded-lg border border-brand-line bg-card p-4 shadow-card">
        {stale ? (
          <p role="alert" className="text-sm font-medium text-warning-text">
            {stale}
          </p>
        ) : (
          <p className="text-sm text-brand-muted" aria-live="polite">
            Preview valid until {formatDateTime(previewExpiresAt)}. Confirming will apply {applies}{' '}
            {applies === 1 ? 'row' : 'rows'}; nothing has been written yet.
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={busy}>
            Discard upload
          </Button>
          <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
            Change mapping
          </Button>
          {stale ? (
            <Button type="button" onClick={onRefreshPreview} disabled={busy}>
              Build a fresh preview
            </Button>
          ) : (
            <Button
              type="button"
              variant="cta"
              onClick={onConfirm}
              disabled={busy || (applies === 0 && counts.conflict === 0)}
            >
              {busy ? 'Confirming…' : 'Confirm import'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
