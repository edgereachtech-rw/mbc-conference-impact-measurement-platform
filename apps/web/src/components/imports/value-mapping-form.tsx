'use client';

import { Button } from '@/components/ui/button';
import {
  fieldLabels,
  type ImportValueMappedField,
  type ImportValueMappings,
  type PreviewResult,
} from '@/lib/imports';

import { NativeSelect } from './native-select';

const OPTIONS: Record<ImportValueMappedField, Array<{ value: string; label: string }>> = {
  attendanceFormat: [
    { value: 'physical', label: 'Physical (in person)' },
    { value: 'virtual', label: 'Virtual (online)' },
  ],
  capacity: [
    { value: 'individual', label: 'Individual' },
    { value: 'nominee', label: 'Nominee of an organisation' },
    { value: 'other', label: 'Other' },
  ],
  registrationStatus: [
    { value: 'active', label: 'Active' },
    { value: 'pending', label: 'Pending (cannot sign in yet)' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
};

const FIELDS: ImportValueMappedField[] = ['attendanceFormat', 'capacity', 'registrationStatus'];

interface ValueMappingFormProps {
  unrecognisedValues: PreviewResult['unrecognisedValues'];
  valueMappings: ImportValueMappings;
  onChange: (next: ImportValueMappings) => void;
  busy: boolean;
  onRebuild: () => void;
}

/**
 * Translations for file values the platform does not recognise (D4). Each distinct value is
 * listed with how many rows carry it; the admin assigns a platform value or leaves it rejected.
 * The platform never guesses: an untranslated value keeps rejecting its rows.
 */
export function ValueMappingForm({
  unrecognisedValues,
  valueMappings,
  onChange,
  busy,
  onRebuild,
}: ValueMappingFormProps) {
  const pending = FIELDS.filter((field) => (unrecognisedValues[field] ?? []).length > 0);
  const translated = FIELDS.filter((field) => Object.keys(valueMappings[field] ?? {}).length > 0);
  if (pending.length === 0 && translated.length === 0) return null;

  const setValue = (field: ImportValueMappedField, fileValue: string, platformValue: string) => {
    const table = { ...(valueMappings[field] ?? {}) } as Record<string, string>;
    if (platformValue === '') delete table[fileValue];
    else table[fileValue] = platformValue;
    onChange({ ...valueMappings, [field]: table } as ImportValueMappings);
  };

  return (
    <section
      aria-labelledby="value-mapping-title"
      className="space-y-4 rounded-lg border border-brand-warning/40 bg-card p-4 shadow-card"
    >
      <div className="space-y-1">
        <h3 id="value-mapping-title" className="text-h3">
          Translate values the platform does not recognise
        </h3>
        <p className="text-sm text-brand-muted">
          These file values rejected their rows. Choose what each one means on the platform, then
          rebuild the preview. A value you leave as “Reject rows” keeps rejecting them; nothing is
          guessed.
        </p>
      </div>
      {FIELDS.map((field) => {
        const pendingValues = unrecognisedValues[field] ?? [];
        const existing = Object.entries(valueMappings[field] ?? {});
        const rows = [
          ...pendingValues,
          ...existing
            .filter(([value]) => !pendingValues.some((p) => p.value === value))
            .map(([value]) => ({ value, count: 0 })),
        ];
        if (rows.length === 0) return null;
        return (
          <fieldset key={field} className="space-y-2">
            <legend className="text-sm font-medium text-brand-primary">{fieldLabels[field]}</legend>
            <ul className="divide-y divide-brand-line rounded-md border border-brand-line">
              {rows.map(({ value, count }) => {
                const id = `value-${field}-${value || 'blank'}`;
                const current =
                  (valueMappings[field] as Record<string, string> | undefined)?.[value] ?? '';
                return (
                  <li
                    key={value || '(blank)'}
                    className="grid gap-2 p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center"
                  >
                    <label htmlFor={id} className="min-w-0 text-sm">
                      <span className="block truncate font-medium text-brand-text">
                        {value === '' ? '(blank cell)' : value}
                      </span>
                      <span className="text-xs text-brand-muted">
                        {count > 0 ? `${count} ${count === 1 ? 'row' : 'rows'}` : 'translated'}
                      </span>
                    </label>
                    <span className="hidden text-brand-muted sm:inline" aria-hidden="true">
                      →
                    </span>
                    <NativeSelect
                      id={id}
                      value={current}
                      onChange={(e) => setValue(field, value, e.target.value)}
                    >
                      <option value="">Reject rows with this value</option>
                      {OPTIONS[field].map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onRebuild} disabled={busy}>
          {busy ? 'Rebuilding…' : 'Rebuild preview with these translations'}
        </Button>
      </div>
    </section>
  );
}
