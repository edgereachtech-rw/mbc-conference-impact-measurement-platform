import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredRow } from '@/lib/imports';
import { permittedActions } from '@/lib/imports';

import { ConflictQueue } from './conflict-queue';

function stubResolve(
  responder: (body: Record<string, unknown>) => { status: number; body: unknown },
) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });
      const res = responder(body);
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const nameMismatch: StoredRow = {
  id: 'row4',
  rowNumber: 4,
  values: {
    email: 'bob@example.com',
    name: 'Robert B',
    attendanceFormat: 'virtual',
    organisation: null,
    jobTitle: null,
    country: null,
    capacity: 'individual',
    nominatingOrganisation: null,
    registrationStatus: 'active',
    externalRegistrationId: null,
  },
  outcome: 'conflict',
  reasonCode: 'name_mismatch',
  reasonDetail: null,
  possibleDuplicate: false,
  conflict: { row: {}, existing: { identityId: 'i2', name: 'Bob B' } },
  delegateId: null,
  identityId: null,
};
const externalId: StoredRow = {
  ...nameMismatch,
  id: 'row5',
  rowNumber: 5,
  reasonCode: 'external_id_mismatch',
  conflict: { row: {}, existing: { delegateId: 'd1' } },
};
const reserved: StoredRow = {
  ...nameMismatch,
  id: 'row6',
  rowNumber: 6,
  reasonCode: 'address_under_migration_review',
  conflict: { row: {}, existing: { identityId: 'i3' } },
};

afterEach(() => vi.unstubAllGlobals());

describe('permitted actions (hints; the server decides)', () => {
  it('offers link only with an existing identity, create only for unowned-address conflicts, reject and correct always', () => {
    expect(permittedActions(nameMismatch)).toEqual(['link_existing', 'reject', 'correct_source']);
    expect(permittedActions(externalId)).toEqual(['create_identity', 'reject', 'correct_source']);
    expect(permittedActions(reserved)).toEqual(['reject', 'correct_source']);
    expect(
      permittedActions({
        reasonCode: 'shared_email_in_file',
        conflict: { row: {}, existing: { rows: [3] } },
      }),
    ).toEqual(['create_identity', 'reject', 'correct_source']);
    expect(
      permittedActions({
        reasonCode: 'previous_email_of_identity',
        conflict: { row: {}, existing: { identityId: 'i9' } },
      }),
    ).toEqual(['link_existing', 'reject', 'correct_source']);
  });
});

describe('ConflictQueue', () => {
  it('links with the same-person confirmation and reports the decision', async () => {
    const calls = stubResolve(() => ({
      status: 200,
      body: {
        row: {
          id: 'row4',
          runId: 'run1',
          rowNumber: 4,
          resolution: 'link_existing',
          resolvedAt: null,
          identityId: 'i2',
          delegateId: 'd9',
        },
        alreadyResolved: false,
      },
    }));
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(<ConflictQueue conflicts={[nameMismatch]} onResolved={onResolved} />);
    expect(screen.getByText(/Existing person: Bob B/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    const form = screen.getByRole('group', { name: /Decision for row 4/ }).closest('form')!;
    expect(within(form).queryByLabelText(/Create a new person/)).toBeNull();
    const apply = screen.getByRole('button', { name: 'Apply decision' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true); // confirmation required before linking
    await user.click(screen.getByLabelText(/same person as the existing person/));
    await user.type(screen.getByLabelText(/Note/), 'checked with the organiser');
    await user.click(apply);
    expect(calls[0]?.url).toBe('/api/v1/imports/rows/row4/resolve');
    expect(calls[0]?.body).toEqual({
      action: 'link_existing',
      identityId: 'i2',
      samePerson: true,
      note: 'checked with the organiser',
    });
    expect((await screen.findByRole('status')).textContent).toMatch(/Resolved: linked/);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('shows a refusal from the server without revealing the other identity, and allows a retry', async () => {
    let attempts = 0;
    const calls = stubResolve(() => {
      attempts += 1;
      return attempts === 1
        ? {
            status: 409,
            body: {
              error: {
                code: 'resolution_refused',
                message:
                  'This address belongs to another identity; it cannot be attached or created.',
                requestId: 'req-9',
              },
            },
          }
        : {
            status: 200,
            body: {
              row: {
                id: 'row5',
                runId: 'run1',
                rowNumber: 5,
                resolution: 'reject',
                resolvedAt: null,
                identityId: null,
                delegateId: null,
              },
              alreadyResolved: false,
            },
          };
    });
    const user = userEvent.setup();
    render(<ConflictQueue conflicts={[externalId]} onResolved={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await user.click(screen.getByLabelText(/Create a new person/));
    await user.click(screen.getByLabelText(/different person from anyone/));
    await user.click(screen.getByRole('button', { name: 'Apply decision' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/belongs to another identity/);
    expect(alert.textContent).toMatch(/req-9/);
    expect(calls[0]?.body).toEqual({ action: 'create_identity', differentPerson: true });
    await user.click(screen.getByLabelText(/Reject the row/));
    await user.click(screen.getByRole('button', { name: 'Apply decision' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/Resolved: rejected/);
    expect(calls[1]?.body).toEqual({ action: 'reject' });
  });

  it('a reserved address offers only reject and correct-the-source', async () => {
    stubResolve(() => ({
      status: 200,
      body: {
        row: {
          id: 'row6',
          runId: 'run1',
          rowNumber: 6,
          resolution: 'correct_source',
          resolvedAt: null,
          identityId: null,
          delegateId: null,
        },
        alreadyResolved: true,
      },
    }));
    const user = userEvent.setup();
    render(<ConflictQueue conflicts={[reserved]} onResolved={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    await user.click(screen.getByLabelText(/Correct the source/));
    await user.click(screen.getByRole('button', { name: 'Apply decision' }));
    expect((await screen.findByRole('status')).textContent).toMatch(
      /correct the source.*already applied/,
    );
  });
});
