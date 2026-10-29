import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import {
  describeError,
  draftFromMapping,
  isPreviewExpired,
  isStalePreviewError,
  mappingFromDraft,
  reasonLabel,
} from './imports';
import { importsAccess } from './imports-access';
import type { ShellSession } from './session';

const session = (role: ShellSession['role']): ShellSession =>
  ({
    displayName: 'X',
    role,
    user: { id: 'u', email: 'x@example.com', role, displayName: 'X', delegate: null },
  }) as ShellSession;

describe('import screen helpers', () => {
  it('renders the screen only for admins; the API still authorises every request', () => {
    expect(importsAccess(null)).toBe('signed-out');
    expect(importsAccess(session('delegate'))).toBe('forbidden');
    expect(importsAccess(session('speaker'))).toBe('forbidden');
    expect(importsAccess(session('admin'))).toBe('allowed');
  });

  it('round-trips a mapping through the draft and reports the first problem', () => {
    const draft = draftFromMapping({
      email: 'E',
      name: { first: 'F', last: 'L' },
      organisation: 'O',
    });
    expect(draft.nameMode).toBe('split');
    expect(mappingFromDraft(draft, 'virtual')).toEqual({
      mapping: { email: 'E', name: { first: 'F', last: 'L' }, organisation: 'O' },
    });
    expect(mappingFromDraft(draftFromMapping(null), '')).toEqual({
      problem: expect.stringMatching(/email/),
    });
    expect(mappingFromDraft({ ...draft, firstName: '' }, 'virtual')).toEqual({
      problem: expect.stringMatching(/first-name/),
    });
    expect(mappingFromDraft(draft, '')).toEqual({ problem: expect.stringMatching(/attendance/) });
    expect(
      mappingFromDraft(draftFromMapping({ email: 'E', name: 'N', attendanceFormat: 'A' }), ''),
    ).toEqual({
      mapping: { email: 'E', name: 'N', attendanceFormat: 'A' },
    });
  });

  it('classifies stale-preview refusals and expiry', () => {
    expect(isStalePreviewError(new ApiError(409, 'preview_out_of_date', 'x'))).toBe(true);
    expect(isStalePreviewError(new ApiError(409, 'preview_expired', 'x'))).toBe(true);
    expect(isStalePreviewError(new ApiError(409, 'run_closed', 'x'))).toBe(false);
    expect(isStalePreviewError(new Error('x'))).toBe(false);
    const now = new Date('2026-10-30T10:00:00Z');
    expect(isPreviewExpired('2026-10-30T10:30:00Z', now)).toBe(false);
    expect(isPreviewExpired('2026-10-30T09:59:59Z', now)).toBe(true);
    expect(isPreviewExpired(null, now)).toBe(true);
    expect(isPreviewExpired('garbage', now)).toBe(true);
  });

  it('describes errors without leaking internals', () => {
    expect(describeError(new ApiError(401, 'unauthenticated', 'Sign in', 'r1')).message).toMatch(
      /session has ended/,
    );
    expect(describeError(new ApiError(403, 'forbidden', 'no', 'r2')).message).toMatch(
      /Only M.Bryan admins/,
    );
    const internal = describeError(
      new ApiError(500, 'internal_error', 'TypeError at /srv/x.js', 'r3'),
    );
    expect(internal.message).not.toMatch(/TypeError|srv/);
    expect(internal.requestId).toBe('r3');
    expect(
      describeError(new ApiError(413, 'file_too_large', 'Too big. Split the export.', 'r4'))
        .message,
    ).toBe('Too big. Split the export.');
    expect(describeError(new TypeError('network'), 'fallback').message).toBe('fallback');
  });

  it('labels reasons for admins', () => {
    expect(
      reasonLabel({ outcome: 'conflict', reasonCode: 'shared_email_in_file', reasonDetail: null }),
    ).toMatch(/share this email/);
    expect(
      reasonLabel({ outcome: 'rejected', reasonCode: 'name_missing', reasonDetail: null }),
    ).toBe('Name is missing');
    expect(
      reasonLabel({
        outcome: 'duplicate_in_file',
        reasonCode: 'duplicate_in_file',
        reasonDetail: 'identical to row 3',
      }),
    ).toBe('Identical repeat (identical to row 3)');
    expect(
      reasonLabel({ outcome: 'unchanged', reasonCode: null, reasonDetail: 'updated (no change)' }),
    ).toBe('updated (no change)');
  });
});
