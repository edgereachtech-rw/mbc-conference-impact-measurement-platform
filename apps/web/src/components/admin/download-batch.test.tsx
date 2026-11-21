import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentDownloads } from './document-downloads';
import { DownloadBatchPicker, DownloadBatchProvider, withBatch } from './download-batch';

afterEach(() => vi.unstubAllGlobals());

const B1 = '11111111-1111-4111-8111-111111111111';

describe('download batch', () => {
  it('adds the batch to an address, with or without a query', () => {
    expect(withBatch('/a.pdf', '')).toBe('/a.pdf');
    expect(withBatch('/a.pdf', B1)).toBe(`/a.pdf?batch=${B1}`);
    expect(withBatch('/a.pdf?wave=2', B1)).toBe(`/a.pdf?wave=2&batch=${B1}`);
  });

  it('narrows every download on the page to the batch chosen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              batches: [
                {
                  id: B1,
                  name: 'Batch 1',
                  date: '2026-11-23',
                  eventDateId: 'd',
                  order: 1,
                  delegates: 3,
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const user = userEvent.setup();
    render(
      <DownloadBatchProvider eventId="e1">
        <DownloadBatchPicker />
        <DocumentDownloads path="/events/e1/attendance/register" label="Attendance register" />
      </DownloadBatchProvider>,
    );
    const picker = await screen.findByLabelText('Downloads and lists for');
    expect(screen.getByRole('link', { name: /PDF/ }).getAttribute('href')).toBe(
      '/api/v1/events/e1/attendance/register.pdf',
    );
    await user.selectOptions(picker, B1);
    expect(screen.getByRole('link', { name: /PDF/ }).getAttribute('href')).toBe(
      `/api/v1/events/e1/attendance/register.pdf?batch=${B1}`,
    );
  });

  it('shows no picker on an event without batches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ batches: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    render(
      <DownloadBatchProvider eventId="e1">
        <DownloadBatchPicker />
      </DownloadBatchProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText('Downloads and lists for')).toBeNull();
  });
});
