import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImportWizard } from './import-wizard';

type Handler = (init?: RequestInit) => { status: number; body?: unknown };

/** Routes `METHOD /api/v1/path` to a handler; unknown routes answer 404 so tests fail loudly. */
function stubApi(handlers: Record<string, Handler>) {
  const calls: Array<{ key: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${(init?.method ?? 'GET').toUpperCase()} ${url.replace(/^\/api\/v1/, '')}`;
      calls.push({ key, init });
      const handler = handlers[key];
      const res = handler
        ? handler(init)
        : {
            status: 404,
            body: { error: { code: 'not_found', message: `no stub for ${key}`, requestId: 'r' } },
          };
      return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? {}), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const EVENT = {
  id: 'e1',
  slug: 'ittec-2026',
  name: 'ITTEC 2026',
  startsOn: '2026-11-12',
  endsOn: '2026-11-13',
  timezone: 'Africa/Lagos',
  format: 'hybrid',
  status: 'active',
};
const RUN = {
  id: 'run1',
  eventId: 'e1',
  actorUserId: 'u1',
  source: 'Eventbrite',
  fileName: 'reg.csv',
  fileSizeBytes: 120,
  rowCount: 3,
  status: 'uploaded',
  counts: null,
  previewExpiresAt: null,
  committedAt: null,
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
};
const UPLOAD = {
  run: RUN,
  headers: ['Email', 'Full Name', 'Format', 'Checked In'],
  delimiter: ',',
  suggestedMapping: { email: 'Email', name: 'Full Name', attendanceFormat: 'Format' },
  unmappedColumns: ['Checked In'],
  attendanceRecordColumns: ['Checked In'],
  savedMapping: null,
};
const COUNTS = {
  total: 3,
  accepted: 1,
  updated: 0,
  unchanged: 0,
  linked: 0,
  duplicateInFile: 0,
  rejected: 1,
  conflict: 1,
  possibleDuplicate: 0,
};
const future = () => new Date(Date.now() + 25 * 60_000).toISOString();
const PREVIEW = () => ({
  run: { ...RUN, status: 'previewed', previewExpiresAt: future() },
  counts: COUNTS,
  ignoredColumns: ['Checked In'],
  previewExpiresAt: future(),
  rows: [
    {
      rowNumber: 2,
      outcome: 'accepted',
      reasonCode: null,
      reasonDetail: null,
      possibleDuplicate: false,
      values: { email: 'ann@example.com', name: 'Ann A', attendanceFormat: 'physical' },
      conflict: null,
      delegateId: null,
      identityId: null,
      changes: [],
    },
    {
      rowNumber: 3,
      outcome: 'rejected',
      reasonCode: 'email_invalid',
      reasonDetail: 'email: email_invalid',
      possibleDuplicate: false,
      values: null,
      conflict: null,
      delegateId: null,
      identityId: null,
      changes: [],
    },
    {
      rowNumber: 4,
      outcome: 'conflict',
      reasonCode: 'name_mismatch',
      reasonDetail: 'x',
      possibleDuplicate: false,
      values: { email: 'bob@example.com', name: 'Robert B', attendanceFormat: 'virtual' },
      conflict: { row: {}, existing: { identityId: 'i2', name: 'Bob B' } },
      delegateId: null,
      identityId: null,
      changes: [],
    },
  ],
});
const STATUS_OK = {
  uploadsEnabled: true,
  productionGateRequired: false,
  migrationGatePassed: false,
  blockers: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

async function uploadAndMap(calls: ReturnType<typeof stubApi>) {
  const user = userEvent.setup();
  render(<ImportWizard />);
  await user.selectOptions(await screen.findByLabelText('Event'), 'e1');
  await user.type(screen.getByLabelText('Registration source'), 'Eventbrite');
  const file = new File(['Email,Full Name\na@x.io,A'], 'reg.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText(/Registration file/), file);
  await user.click(screen.getByRole('button', { name: 'Upload and continue' }));
  expect(await screen.findByText(/Map columns/)).toBeTruthy();
  const uploadCall = calls.find((c) => c.key === 'POST /events/e1/imports');
  expect(uploadCall).toBeTruthy();
  const body = uploadCall?.init?.body as FormData;
  expect(body.get('source')).toBe('Eventbrite');
  expect((body.get('file') as File).name).toBe('reg.csv');
  return user;
}

describe('ImportWizard', () => {
  it('uploads, maps columns without attendance fields, previews with reasons and confirms', async () => {
    const calls = stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'POST /events/e1/imports': () => ({ status: 201, body: UPLOAD }),
      'POST /imports/run1/preview': () => ({ status: 200, body: PREVIEW() }),
      'POST /imports/run1/confirm': () => ({
        status: 200,
        body: { run: { ...RUN, status: 'committed' }, counts: COUNTS, alreadyCommitted: false },
      }),
    });
    const user = await uploadAndMap(calls);

    // Suggested mapping applied; the check-in column is never offered as a target.
    const emailSelect = screen.getByLabelText(/^Email/) as HTMLSelectElement;
    expect(emailSelect.value).toBe('Email');
    const options = Array.from(emailSelect.options).map((o) => o.value);
    expect(options).toContain('Format');
    expect(options).not.toContain('Checked In');
    expect(screen.getByRole('note').textContent).toMatch(/Ignored.*Checked In/);

    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    const previewCall = calls.find((c) => c.key === 'POST /imports/run1/preview');
    expect(JSON.parse(String(previewCall?.init?.body))).toEqual({
      mapping: { email: 'Email', name: 'Full Name', attendanceFormat: 'Format' },
    });
    expect(await screen.findByText(/Review preview/)).toBeTruthy();
    const counts = screen.getByRole('group', { name: 'Filter rows by outcome' });
    expect(within(counts).getByRole('button', { name: 'Conflicts (1)' })).toBeTruthy();
    expect(screen.getByText('Email is not a valid address')).toBeTruthy();
    expect(screen.getByText('Name differs from the person who holds this email')).toBeTruthy();
    expect(screen.getByText(/Existing: Bob B/)).toBeTruthy();

    await user.click(within(counts).getByRole('button', { name: 'Rejected (1)' }));
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + one row

    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByText('Import committed')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Download row report/ }).getAttribute('href')).toBe(
      '/api/v1/imports/run1/report.csv',
    );
    expect(calls.filter((c) => c.key === 'POST /imports/run1/confirm')).toHaveLength(1);
  });

  it('a stale preview blocks confirmation until a fresh preview is built, then commits', async () => {
    let confirms = 0;
    const calls = stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'POST /events/e1/imports': () => ({ status: 201, body: UPLOAD }),
      'POST /imports/run1/preview': () => ({ status: 200, body: PREVIEW() }),
      'POST /imports/run1/confirm': () => {
        confirms += 1;
        return confirms === 1
          ? {
              status: 409,
              body: {
                error: {
                  code: 'preview_out_of_date',
                  message: 'Records changed since the preview.',
                  requestId: 'req-1',
                },
              },
            }
          : {
              status: 200,
              body: {
                run: { ...RUN, status: 'committed' },
                counts: COUNTS,
                alreadyCommitted: false,
              },
            };
      },
    });
    const user = await uploadAndMap(calls);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm import' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Records changed since this preview was built, so nothing was imported/,
    );
    expect(screen.queryByRole('button', { name: 'Confirm import' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Build a fresh preview' }));
    expect(calls.filter((c) => c.key === 'POST /imports/run1/preview')).toHaveLength(2);
    await user.click(await screen.findByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByText('Import committed')).toBeTruthy();
    expect(confirms).toBe(2);
  });

  it('an expired preview, reported by the server or by the clock, cannot be confirmed', async () => {
    const calls = stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'POST /events/e1/imports': () => ({ status: 201, body: UPLOAD }),
      'POST /imports/run1/preview': () => ({ status: 200, body: PREVIEW() }),
      'POST /imports/run1/confirm': () => ({
        status: 409,
        body: { error: { code: 'preview_expired', message: 'expired', requestId: 'req-2' } },
      }),
    });
    const user = await uploadAndMap(calls);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm import' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/This preview has expired/);
    expect(screen.getByRole('button', { name: 'Build a fresh preview' })).toBeTruthy();
  });

  it('a preview that is already past its expiry offers only a fresh preview', async () => {
    const calls = stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'POST /events/e1/imports': () => ({ status: 201, body: UPLOAD }),
      'POST /imports/run1/preview': () => ({
        status: 200,
        body: { ...PREVIEW(), previewExpiresAt: new Date(Date.now() - 1000).toISOString() },
      }),
    });
    const user = await uploadAndMap(calls);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
    expect(screen.queryByRole('button', { name: 'Confirm import' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Build a fresh preview' })).toBeTruthy();
  });

  it('blocks the preview when a required field is unmapped and no run-wide format is chosen', async () => {
    const calls = stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'POST /events/e1/imports': () => ({
        status: 201,
        body: { ...UPLOAD, suggestedMapping: { email: 'Email', name: 'Full Name' } },
      }),
    });
    const user = await uploadAndMap(calls);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(screen.getByRole('alert').textContent).toMatch(
      /Map the attendance-format column, or choose one attendance format/,
    );
    expect(calls.some((c) => c.key === 'POST /imports/run1/preview')).toBe(false);
  });

  it('shows the disabled state when uploads are off, and the server reason', async () => {
    stubApi({
      'GET /imports/status': () => ({
        status: 200,
        body: {
          ...STATUS_OK,
          uploadsEnabled: false,
          blockers: ['source-file retention policy not approved or configured (OQ-22)'],
        },
      }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
    });
    render(<ImportWizard />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/disabled in this environment/);
    expect(screen.getByText(/OQ-22/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Upload and continue' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('non-admin, upload refusal and server failure show actionable messages without internals', async () => {
    stubApi({
      'GET /imports/status': () => ({
        status: 403,
        body: {
          error: {
            code: 'forbidden',
            message: 'You do not have access to this.',
            requestId: 'req-3',
          },
        },
      }),
      'GET /events': () => ({
        status: 403,
        body: { error: { code: 'forbidden', message: 'nope', requestId: 'req-3' } },
      }),
    });
    const first = render(<ImportWizard />);
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Only M.Bryan admins can run registration imports/,
    );
    first.unmount();
    vi.unstubAllGlobals();

    const calls = stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'POST /events/e1/imports': () => ({
        status: 413,
        body: {
          error: {
            code: 'file_too_large',
            message:
              'The file is larger than 10 MB. Split the export into smaller files and import each one.',
            requestId: 'req-4',
          },
        },
      }),
    });
    const user = userEvent.setup();
    const { unmount } = render(<ImportWizard />);
    await user.selectOptions(await screen.findByLabelText('Event'), 'e1');
    await user.type(screen.getByLabelText('Registration source'), 'Eventbrite');
    await user.upload(screen.getByLabelText(/Registration file/), new File(['x'], 'reg.csv'));
    await user.click(screen.getByRole('button', { name: 'Upload and continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Split the export/);
    expect(screen.getByText(/Request id req-4/)).toBeTruthy();
    expect(calls.filter((c) => c.key === 'POST /events/e1/imports')).toHaveLength(1);
    unmount();
    vi.unstubAllGlobals();

    stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'POST /events/e1/imports': () => ({
        status: 500,
        body: {
          error: {
            code: 'internal_error',
            message: 'TypeError: secret stack at /srv/app.js:12',
            requestId: 'req-5',
          },
        },
      }),
    });
    render(<ImportWizard />);
    await user.selectOptions(await screen.findByLabelText('Event'), 'e1');
    await user.type(screen.getByLabelText('Registration source'), 'Eventbrite');
    await user.upload(screen.getByLabelText(/Registration file/), new File(['x'], 'reg.csv'));
    await user.click(screen.getByRole('button', { name: 'Upload and continue' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/The server could not complete this/);
    expect(alert.textContent).not.toMatch(/TypeError|srv/);
    expect(alert.textContent).toMatch(/req-5/);
  });

  it('refuses .xls and oversize files before calling the API', async () => {
    const calls = stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
    });
    const user = userEvent.setup({ applyAccept: false });
    render(<ImportWizard />);
    await user.selectOptions(await screen.findByLabelText('Event'), 'e1');
    await user.type(screen.getByLabelText('Registration source'), 'Eventbrite');
    const fileInput = screen.getByLabelText(/Registration file/);
    await user.upload(fileInput, new File(['x'], 'old.xls'));
    await user.click(screen.getByRole('button', { name: 'Upload and continue' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Only .csv and .xlsx/);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.csv', { type: 'text/csv' });
    await user.upload(fileInput, big);
    await user.click(screen.getByRole('button', { name: 'Upload and continue' }));
    expect(screen.getByRole('alert').textContent).toMatch(/larger than 10 MB/);
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('history lists runs with their outcome and the open conflicts', async () => {
    stubApi({
      'GET /imports/status': () => ({ status: 200, body: STATUS_OK }),
      'GET /events': () => ({ status: 200, body: { events: [EVENT] } }),
      'GET /events/e1/imports': () => ({
        status: 200,
        body: {
          runs: [
            {
              ...RUN,
              status: 'committed',
              counts: COUNTS,
              committedAt: '2026-10-30T11:00:00.000Z',
            },
          ],
        },
      }),
      'GET /events/e1/imports/conflicts': () => ({
        status: 200,
        body: {
          conflicts: [
            {
              id: 'row4',
              rowNumber: 4,
              values: { email: 'bob@example.com', name: 'Robert B' },
              outcome: 'conflict',
              reasonCode: 'name_mismatch',
              reasonDetail: null,
              possibleDuplicate: false,
              conflict: { row: {}, existing: { name: 'Bob B' } },
              delegateId: null,
              identityId: null,
            },
          ],
        },
      }),
    });
    const user = userEvent.setup();
    render(<ImportWizard />);
    await user.click(await screen.findByRole('tab', { name: 'History and conflicts' }));
    await user.selectOptions(screen.getByLabelText('Event'), 'e1');
    const list = await screen.findByRole('list', { name: 'Import runs' });
    expect(within(list).getByText('reg.csv')).toBeTruthy();
    expect(within(list).getByText('Committed')).toBeTruthy();
    expect(within(list).getByRole('link', { name: 'Report (CSV)' }).getAttribute('href')).toBe(
      '/api/v1/imports/run1/report.csv',
    );
    const conflicts = screen.getByRole('region', { name: 'Open conflicts' });
    expect(within(conflicts).getByText('bob@example.com')).toBeTruthy();
    expect(within(conflicts).getByRole('button', { name: 'Resolve' })).toBeTruthy();
  });
});
