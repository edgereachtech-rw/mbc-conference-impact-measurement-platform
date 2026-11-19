import type { EventDetail } from '@mbc/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmationEditor } from './confirmation-editor';

afterEach(() => vi.unstubAllGlobals());

const event = {
  id: 'e1',
  name: 'ITTEC 2026',
  status: 'draft',
  assessmentStages: [
    {
      stage: 'pre_conference',
      wave: 1,
      waveLabel: '',
      confirmation: null,
      updatedAt: '2026-11-19T10:00:00.000Z',
    },
  ],
} as unknown as EventDetail;

describe('ConfirmationEditor', () => {
  it('previews the words and look as typed, and saves them for the stage', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ event }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmationEditor
        event={event}
        stage="pre_conference"
        wave={1}
        readOnly={false}
        onSaved={onSaved}
      />,
    );
    const preview = screen.getByLabelText('Preview');
    // The defaults first: the platform's wording, centred, with the icon.
    expect(within(preview).getByRole('status').textContent).toContain(
      'Thank you. Every section is submitted and your responses are recorded.',
    );
    expect(within(preview).getByRole('status').querySelector('svg')).toBeTruthy();

    const form = screen.getByRole('form', { name: 'Submission confirmation' });
    await user.type(within(form).getByLabelText('Title'), 'Baseline recorded');
    await user.type(
      within(form).getByLabelText('Message'),
      'Thank you, your starting point is saved.',
    );
    await user.selectOptions(within(form).getByLabelText('Colour'), 'accent');
    await user.selectOptions(within(form).getByLabelText('Alignment'), 'left');
    await user.click(within(form).getByLabelText('Show the check icon'));
    await user.click(within(form).getByLabelText('Highlight the message in a tinted panel'));
    const status = within(preview).getByRole('status');
    expect(status.textContent).toContain('Thank you, your starting point is saved.');
    expect(status.className).toContain('items-start');
    expect(status.className).toContain('bg-corp-accent-soft');
    expect(status.querySelector('svg')).toBeNull();
    expect(screen.getByText(/under the title “Baseline recorded”/)).toBeTruthy();

    await user.click(within(form).getByRole('button', { name: 'Save confirmation' }));
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put?.url).toBe('/api/v1/events/e1/assessments/pre_conference/confirmation?wave=1');
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      title: 'Baseline recorded',
      message: 'Thank you, your starting point is saved.',
      detail: null,
      tone: 'accent',
      align: 'left',
      showIcon: false,
      highlight: true,
    });
    expect(await within(form).findByRole('status')).toBeTruthy();
    expect(onSaved).toHaveBeenCalled();

    // Back to the defaults clears the words and the look.
    await user.click(within(form).getByRole('button', { name: 'Back to the defaults' }));
    expect((within(form).getByLabelText('Title') as HTMLInputElement).value).toBe('');
    expect(within(preview).getByRole('status').querySelector('svg')).toBeTruthy();
  });
});
