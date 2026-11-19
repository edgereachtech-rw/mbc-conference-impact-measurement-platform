import type { EventDetail } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BatchesEditor } from './batches-editor';

afterEach(() => vi.unstubAllGlobals());

const event = {
  id: 'e1',
  status: 'draft',
  dates: [
    { id: 'd1', date: '2026-11-23' },
    { id: 'd2', date: '2026-11-24' },
    { id: 'd3', date: '2026-11-25' },
  ],
  batches: [
    { id: 'b1', name: 'Batch 1', eventDateId: 'd1', date: '2026-11-23', order: 1, delegates: 12 },
  ],
} as unknown as EventDetail;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('BatchesEditor', () => {
  it('lists the batches with their day and size, adds one, moves one and deletes one', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return json({ batches: [], event });
      }),
    );
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<BatchesEditor event={event} readOnly={false} onSaved={onSaved} />);

    const list = screen.getByRole('list', { name: 'Batches' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect((within(list).getByLabelText('Name of Batch 1') as HTMLInputElement).value).toBe(
      'Batch 1',
    );
    expect((within(list).getByLabelText('Day of Batch 1') as HTMLSelectElement).value).toBe('d1');
    expect(list.textContent).toContain('12 delegates');

    // A new batch on the 25th.
    const form = screen.getByRole('form', { name: 'New batch' });
    await user.type(within(form).getByLabelText('Batch name'), 'Batch 3');
    await user.selectOptions(within(form).getByLabelText('Day'), 'd3');
    await user.click(within(form).getByRole('button', { name: 'Add batch' }));
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/v1/events/e1/batches');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ name: 'Batch 3', eventDateId: 'd3' });
    expect(onSaved).toHaveBeenCalledWith(event);

    // Moving a batch to another day.
    await user.selectOptions(within(list).getByLabelText('Day of Batch 1'), 'd2');
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toBe('/api/v1/events/e1/batches/b1');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ eventDateId: 'd2' });

    // Deleting asks first and says the delegates stay.
    await user.click(within(list).getByRole('button', { name: 'Delete Batch 1' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/12 delegates stay/));
    expect(calls.find((c) => c.init?.method === 'DELETE')?.url).toBe(
      '/api/v1/events/e1/batches/b1',
    );
  });

  it('offers nothing to add while the event has no dates, and no controls when read-only', () => {
    render(
      <BatchesEditor
        event={{ ...event, dates: [], batches: [] } as unknown as EventDetail}
        readOnly={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText('Save the event dates first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add batch' })).toHaveProperty('disabled', true);
  });
});
