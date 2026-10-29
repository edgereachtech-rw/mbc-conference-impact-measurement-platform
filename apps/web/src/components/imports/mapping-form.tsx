'use client';

import { importFields, type ImportField } from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { fieldLabels, requiredFields, type MappingDraft, type UploadResult } from '@/lib/imports';

import { NativeSelect } from './native-select';

interface MappingFormProps {
  upload: UploadResult;
  draft: MappingDraft;
  onDraftChange: (draft: MappingDraft) => void;
  attendanceFormatDefault: '' | 'physical' | 'virtual';
  onAttendanceFormatDefaultChange: (value: '' | 'physical' | 'virtual') => void;
  saveMapping: boolean;
  onSaveMappingChange: (value: boolean) => void;
  busy: boolean;
  problem: string | null;
  onSubmit: () => void;
  onBack: () => void;
}

const NONE = '';

/**
 * Column mapping (E2-8, D4). Attendance, check-in and presence columns are never offered: the
 * server refuses them too, this only keeps the admin from trying. Required fields are marked.
 */
export function MappingForm({
  upload,
  draft,
  onDraftChange,
  attendanceFormatDefault,
  onAttendanceFormatDefaultChange,
  saveMapping,
  onSaveMappingChange,
  busy,
  problem,
  onSubmit,
  onBack,
}: MappingFormProps) {
  const ids = { base: useId() };
  const ignored = new Set(upload.attendanceRecordColumns);
  const options = upload.headers.filter((h) => !ignored.has(h));
  const used = new Set<string>([
    ...Object.values(draft.columns).filter(Boolean),
    ...(draft.nameMode === 'single' ? [draft.name] : [draft.firstName, draft.lastName]),
  ]);
  const unusedHeaders = options.filter((h) => !used.has(h));

  const setColumn = (field: Exclude<ImportField, 'name'>, column: string) => {
    const columns = { ...draft.columns };
    if (column === NONE) delete columns[field];
    else columns[field] = column;
    onDraftChange({ ...draft, columns });
  };

  const columnSelect = (
    id: string,
    value: string,
    onChange: (column: string) => void,
    required: boolean,
  ) => (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      aria-required={required || undefined}
    >
      <option value={NONE}>{required ? 'Choose a column…' : 'Not mapped'}</option>
      {options.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </NativeSelect>
  );

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-1 text-sm text-brand-muted">
        <p>
          <span className="font-medium text-brand-text">{upload.run.fileName}</span>:{' '}
          {upload.run.rowCount} rows, {upload.headers.length} columns
          {upload.delimiter ? ` (CSV, “${upload.delimiter}” separated)` : ' (XLSX)'}.
        </p>
        {upload.savedMapping ? (
          <p>
            {upload.savedMapping.reusable
              ? 'The saved mapping for this source matches these columns and has been applied. Review it and continue.'
              : 'A mapping is saved for this source but the columns differ from the last file, so it was not applied. Review the suggestion below.'}
          </p>
        ) : null}
        {(upload.warnings ?? []).map((warning) => (
          <p key={warning} role="alert" className="font-medium text-brand-warning-text">
            {warning}
          </p>
        ))}
        {upload.attendanceRecordColumns.length > 0 ? (
          <p role="note">
            Ignored (attendance is recorded in the platform, never imported):{' '}
            {upload.attendanceRecordColumns.join(', ')}.
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {importFields.map((field) => {
          const required = requiredFields.includes(field);
          const id = `${ids.base}-${field}`;
          if (field === 'name') {
            return (
              <div key={field} className="space-y-2 md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor={`${id}-single`}>
                    {fieldLabels.name} <span className="text-danger">*</span>
                  </Label>
                  <label className="flex items-center gap-2 text-sm text-brand-muted">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={draft.nameMode === 'split'}
                      onChange={(e) =>
                        onDraftChange({ ...draft, nameMode: e.target.checked ? 'split' : 'single' })
                      }
                    />
                    First and last name are separate columns
                  </label>
                </div>
                {draft.nameMode === 'single' ? (
                  columnSelect(
                    `${id}-single`,
                    draft.name,
                    (name) => onDraftChange({ ...draft, name }),
                    true,
                  )
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-first`}>First name column</Label>
                      {columnSelect(
                        `${id}-first`,
                        draft.firstName,
                        (firstName) => onDraftChange({ ...draft, firstName }),
                        true,
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-last`}>Last name column</Label>
                      {columnSelect(
                        `${id}-last`,
                        draft.lastName,
                        (lastName) => onDraftChange({ ...draft, lastName }),
                        true,
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={field} className="space-y-2">
              <Label htmlFor={id}>
                {fieldLabels[field]} {required ? <span className="text-danger">*</span> : null}
              </Label>
              {columnSelect(
                id,
                draft.columns[field] ?? NONE,
                (column) => setColumn(field, column),
                required && field !== 'attendanceFormat',
              )}
              {field === 'attendanceFormat' && !draft.columns.attendanceFormat ? (
                <div className="space-y-1">
                  <Label htmlFor={`${id}-default`} className="text-sm text-brand-muted">
                    No column: use one attendance format for every row in this file
                  </Label>
                  <NativeSelect
                    id={`${id}-default`}
                    value={attendanceFormatDefault}
                    onChange={(e) =>
                      onAttendanceFormatDefaultChange(e.target.value as '' | 'physical' | 'virtual')
                    }
                  >
                    <option value="">Choose…</option>
                    <option value="physical">Physical (in person)</option>
                    <option value="virtual">Virtual (online)</option>
                  </NativeSelect>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {unusedHeaders.length > 0 ? (
        <p className="text-sm text-brand-muted">
          Not mapped and ignored: {unusedHeaders.join(', ')}.
        </p>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={saveMapping}
          onChange={(e) => onSaveMappingChange(e.target.checked)}
        />
        Save this mapping for “{upload.run.source}” and reuse it when a file has the same columns
      </label>

      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Building preview…' : 'Preview import'}
        </Button>
      </div>
    </form>
  );
}
