import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DelegateFormDialog } from './delegate-form';

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function stub(handler: Handler) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const res = handler(url, init);
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const RECORD = {
  id: 'd1',
  eventId: 'e1',
  name: 'Mia Mid',
  email: 'mia@example.com',
  organisation: null,
  nominatingOrganisation: 'Delta Nominees',
  jobTitle: 'Analyst',
  country: 'Nigeria',
  attendanceFormat: 'virtual',
  capacity: 'nominee',
  registrationStatus: 'pending',
  signedUpAt: null,
  createdAt: '2026-10-30T10:00:00Z',
  updatedAt: '2026-10-30T10:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('DelegateFormDialog', () => {
  it('adds a delegate with the typed details and reports whether the person was already known', async () => {
    const calls = stub((_url, init) => ({
      status: 201,
      body: {
        delegate: { ...RECORD, id: 'new', name: JSON.parse(String(init?.body)).name },
        identity: 'linked',
      },
    }));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <DelegateFormDialog
        eventId="e1"
        mode={{ kind: 'create' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Add a delegate' })).toBeTruthy();
    await user.type(screen.getByLabelText('Full name'), 'Nia New');
    await user.type(screen.getByLabelText('Email address'), 'Nia@Example.com');
    await user.type(screen.getByLabelText('Nominating organisation'), 'Delta Nominees');
    await user.selectOptions(screen.getByLabelText('Attendance'), 'virtual');
    await user.selectOptions(screen.getByLabelText('Status'), 'pending');
    // Cancelled is never offered when adding.
    expect(screen.queryByRole('option', { name: 'Cancelled' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add delegate' }));

    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/v1/events/e1/delegates');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      name: 'Nia New',
      email: 'Nia@Example.com',
      organisation: null,
      nominatingOrganisation: 'Delta Nominees',
      jobTitle: null,
      country: null,
      attendanceFormat: 'virtual',
      capacity: 'individual',
      registrationStatus: 'pending',
    });
    expect(onSaved).toHaveBeenCalledWith(expect.stringMatching(/Nia New added.*already known/));
  });

  it('shows the server’s refusal instead of pretending', async () => {
    stub(() => ({
      status: 409,
      body: {
        error: { code: 'name_mismatch', message: 'This address already belongs to Kofi Known.' },
      },
    }));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <DelegateFormDialog
        eventId="e1"
        mode={{ kind: 'create' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    await user.type(screen.getByLabelText('Full name'), 'Someone Else');
    await user.type(screen.getByLabelText('Email address'), 'known@example.com');
    await user.click(screen.getByRole('button', { name: 'Add delegate' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/belongs to Kofi Known/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('loads the record to edit, keeps the email read-only and sends only what changed', async () => {
    const calls = stub((url, init) => {
      if (init?.method === 'PATCH') return { status: 200, body: { delegate: RECORD } };
      expect(url).toBe('/api/v1/delegates/d1');
      return { status: 200, body: { delegate: RECORD } };
    });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <DelegateFormDialog
        eventId="e1"
        mode={{ kind: 'edit', delegateId: 'd1' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    const name = (await screen.findByLabelText('Full name')) as HTMLInputElement;
    expect(name.value).toBe('Mia Mid');
    const email = screen.getByLabelText('Email address') as HTMLInputElement;
    expect(email.value).toBe('mia@example.com');
    expect(email.readOnly).toBe(true);
    expect(screen.getByText(/changed only through the email-change workflow/)).toBeTruthy();
    expect((screen.getByLabelText('Nominating organisation') as HTMLInputElement).value).toBe(
      'Delta Nominees',
    );

    await user.clear(screen.getByLabelText('Organisation'));
    await user.type(screen.getByLabelText('Organisation'), 'Mia Ltd');
    await user.clear(screen.getByLabelText('Nominating organisation'));
    await user.selectOptions(screen.getByLabelText('Status'), 'active');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toBe('/api/v1/delegates/d1');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      organisation: 'Mia Ltd',
      nominatingOrganisation: null,
      registrationStatus: 'active',
    });
    expect(onSaved).toHaveBeenCalledWith('Changes to Mia Mid saved.');
  });

  it('closes without a request when nothing changed, and shows a merged duplicate’s status read-only', async () => {
    const calls = stub(() => ({
      status: 200,
      body: { delegate: { ...RECORD, registrationStatus: 'duplicate' } },
    }));
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DelegateFormDialog
        eventId="e1"
        mode={{ kind: 'edit', delegateId: 'd1' }}
        onClose={onClose}
        onSaved={() => {}}
      />,
    );
    await screen.findByLabelText('Full name');
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
    expect(screen.getByText(/merged by an import/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.init?.method === 'PATCH')).toHaveLength(0);
  });
});
