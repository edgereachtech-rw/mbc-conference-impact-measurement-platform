'use client';

import {
  eventCodeFromName,
  eventFormats,
  eventProfileFieldsSchema,
  eventProfileIssues,
  eventTypes,
  formatNeedsVenue,
  type EventProfileFields,
} from '@mbc/shared';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import { consoleButton } from '@/components/console/page';
import { NativeSelect } from '@/components/imports/native-select';
import { apiFetch } from '@/lib/api';
import { eventFormatLabels, eventTypeLabels, timeZoneOptions } from '@/lib/events';

export type ProfileDraft = {
  [K in keyof EventProfileFields]: string;
};

const EMPTY: ProfileDraft = {
  name: '',
  description: '',
  eventType: 'conference',
  organiser: '',
  format: 'hybrid',
  timezone: 'Africa/Lagos',
  theme: '',
  location: '',
  website: '',
  imageUrl: '',
  additionalInfo: '',
};

export function draftFromProfile(profile?: Partial<EventProfileFields> | null): ProfileDraft {
  if (!profile) return EMPTY;
  const out = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as Array<keyof ProfileDraft>) {
    const value = profile[key];
    if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}

/** Validates a draft; returns the parsed profile or the first message per field. */
export function parseProfile(
  draft: ProfileDraft,
): { ok: true; value: EventProfileFields } | { ok: false; errors: Record<string, string> } {
  const parsed = eventProfileFieldsSchema.safeParse(draft);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      errors[key] ??= issue.message;
    }
  } else {
    for (const issue of eventProfileIssues(parsed.data)) errors.location ??= issue;
  }
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: (parsed as { data: EventProfileFields }).data };
}

interface EventProfileFormProps {
  initial?: Partial<EventProfileFields> | null;
  mode: 'create' | 'edit';
  /** The generated event code, shown read-only when editing. */
  code?: string;
  busy?: boolean;
  submitLabel: string;
  /** Server-side failure to show above the fields. */
  error?: { message: string; requestId?: string } | null;
  onSubmit: (profile: EventProfileFields) => void;
  /** Rendered between the fields and the submit button (the date picker on creation). */
  children?: ReactNode;
}

/** Structured event profile (brief section 3): required facts first, optional ones after. */
export function EventProfileForm({
  initial,
  mode,
  code,
  busy = false,
  submitLabel,
  error,
  onSubmit,
  children,
}: EventProfileFormProps) {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** What the server would assign for the current name; null until it has answered. */
  const [preview, setPreview] = useState<{
    base: string;
    code: string;
    available: boolean;
  } | null>(null);
  const id = useId();
  const zones = useMemo(timeZoneOptions, []);
  const venueRequired = formatNeedsVenue(draft.format as EventProfileFields['format']);
  const name = draft.name.trim();

  // Creation only: ask the API which code this name gets right now, a moment after typing stops.
  useEffect(() => {
    if (mode !== 'create' || !name) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<{ base: string | null; code: string | null; available: boolean }>(
        `/events/code-preview?name=${encodeURIComponent(name)}`,
      ).then(
        (result) => {
          if (!cancelled && result.base && result.code) {
            setPreview({ base: result.base, code: result.code, available: result.available });
          }
        },
        () => {
          // Offline or refused: the local suggestion stays on screen; the server decides on save.
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, name]);
  const localCode = name ? eventCodeFromName(name) : '';
  const shownCode =
    mode === 'edit' && code
      ? code
      : preview && preview.base === localCode
        ? preview.code
        : localCode;
  const takenNote =
    mode === 'create' && preview && preview.base === localCode && !preview.available
      ? `Another event already uses ${preview.base}; this one will be saved as ${preview.code}.`
      : null;

  function set<K extends keyof ProfileDraft>(key: K, value: string) {
    setDraft((d) => {
      return { ...d, [key]: value };
    });
    setErrors((e) => {
      if (!e[key]) return e;
      const copy = { ...e };
      delete copy[key];
      return copy;
    });
  }

  const field = (key: keyof ProfileDraft, label: string, control: ReactNode, hint?: string) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className="text-sm font-semibold text-corp-ink">
        {label}
      </label>
      {control}
      {errors[key] ? (
        <p id={`${id}-${key}-error`} role="alert" className="text-xs text-brand-danger">
          {errors[key]}
        </p>
      ) : hint ? (
        <p className="text-xs text-corp-muted">{hint}</p>
      ) : null}
    </div>
  );
  const input = (key: keyof ProfileDraft, props: Record<string, unknown> = {}) => (
    <input
      id={`${id}-${key}`}
      value={draft[key]}
      disabled={busy}
      aria-invalid={errors[key] ? true : undefined}
      aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
      onChange={(e) => set(key, e.target.value)}
      className="h-11 w-full min-w-0 rounded-none border border-corp-line bg-white px-3 text-base md:text-sm"
      {...props}
    />
  );
  const textarea = (key: keyof ProfileDraft, rows: number) => (
    <textarea
      id={`${id}-${key}`}
      value={draft[key]}
      rows={rows}
      disabled={busy}
      aria-invalid={errors[key] ? true : undefined}
      onChange={(e) => set(key, e.target.value)}
      className="w-full rounded-none border border-corp-line bg-white px-3 py-2 text-base md:text-sm"
    />
  );

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const result = parseProfile(draft);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        onSubmit(result.value);
      }}
    >
      {error ? (
        <div
          role="alert"
          className="rounded-none border border-brand-danger/40 bg-white p-3 text-sm"
        >
          <p className="font-semibold text-brand-danger">{error.message}</p>
          {error.requestId ? (
            <p className="mt-1 text-xs text-corp-muted">Request id {error.requestId}</p>
          ) : null}
        </div>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          Required
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          {field(
            'name',
            'Event name',
            input('name', { maxLength: 200, autoFocus: mode === 'create' }),
          )}
          <div className="space-y-1">
            <p className="text-sm font-semibold text-corp-ink">Event code</p>
            <p
              aria-live="polite"
              data-testid="event-code"
              className="flex h-11 items-center rounded-none border border-corp-line bg-corp-surface px-3 font-mono text-sm text-corp-ink"
            >
              {shownCode || '…'}
            </p>
            {takenNote ? (
              <p role="status" className="text-xs font-semibold text-corp-accent-text">
                {takenNote}
              </p>
            ) : (
              <p className="text-xs text-corp-muted">
                {mode === 'edit'
                  ? 'Unique, lowercase, used in links and exports. It does not change.'
                  : 'Generated from the name. It does not change afterwards.'}
              </p>
            )}
          </div>
        </div>
        {field('description', 'Description', textarea('description', 4))}
        <div className="grid gap-4 md:grid-cols-2">
          {field(
            'eventType',
            'Event type',
            <NativeSelect
              id={`${id}-eventType`}
              value={draft.eventType}
              disabled={busy}
              onChange={(e) => set('eventType', e.target.value)}
              className="rounded-none"
            >
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {eventTypeLabels[t]}
                </option>
              ))}
            </NativeSelect>,
          )}
          {field('organiser', 'Organiser', input('organiser', { maxLength: 200 }))}
          {field(
            'format',
            'Event format',
            <NativeSelect
              id={`${id}-format`}
              value={draft.format}
              disabled={busy}
              onChange={(e) => set('format', e.target.value)}
              className="rounded-none"
            >
              {eventFormats.map((f) => (
                <option key={f} value={f}>
                  {eventFormatLabels[f]}
                </option>
              ))}
            </NativeSelect>,
          )}
          {field(
            'timezone',
            'Time zone',
            <NativeSelect
              id={`${id}-timezone`}
              value={draft.timezone}
              disabled={busy}
              onChange={(e) => set('timezone', e.target.value)}
              className="rounded-none"
            >
              {zones.includes(draft.timezone) ? null : (
                <option value={draft.timezone}>{draft.timezone}</option>
              )}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </NativeSelect>,
            'Session times and assessment windows are entered in this zone.',
          )}
        </div>
        {field(
          'location',
          venueRequired ? 'Venue or location' : 'Venue or location (optional)',
          input('location', { maxLength: 300, placeholder: 'Venue, area, city' }),
          venueRequired
            ? 'Required for in-person and hybrid events.'
            : 'Online events need no venue; add a platform or meeting note here if useful.',
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold tracking-[0.08em] text-corp-muted uppercase">
          Optional
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          {field('theme', 'Theme', input('theme', { maxLength: 200 }))}
          {field(
            'website',
            'Event website',
            input('website', { type: 'url', placeholder: 'https://' }),
          )}
          {field(
            'imageUrl',
            'Logo or image (URL)',
            input('imageUrl', { type: 'url', placeholder: 'https://' }),
            'A link to the hosted image; uploads arrive with a later increment.',
          )}
        </div>
        {field('additionalInfo', 'Additional information', textarea('additionalInfo', 3))}
      </fieldset>

      {children}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="submit" disabled={busy} className={consoleButton({ variant: 'accent' })}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
