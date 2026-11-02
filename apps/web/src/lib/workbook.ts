import type { WorkbookRequest } from '@mbc/shared';

import { apiBase, ApiError } from './api';

/**
 * Saves a table the screen is already showing as an Excel file (task of 2026-11-02).
 *
 * The rows are posted to `/exports/workbook`, which formats them and sends the .xlsx back; the
 * server never looks anything up, so nothing is disclosed that this screen was not already
 * served. Used by the transfer-plan list and the measures-and-evidence report, which build their
 * own rows in the browser. Everything built from the database on the server is a plain download
 * link instead.
 */
export async function downloadWorkbook(request: WorkbookRequest): Promise<void> {
  const base = apiBase();
  const res = await fetch(`${base}/api/v1/exports/workbook`, {
    method: 'POST',
    credentials: base ? 'include' : 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    let code = 'request_failed';
    let message = 'The spreadsheet could not be created.';
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // A non-JSON failure: keep the generic message.
    }
    throw new ApiError(res.status, code, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${request.filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * What to show the admin when a download fails. The server's own words are used where it gave
 * them: `describeError` answers a 403 with wording about registration imports, which is right
 * where it is used and wrong here.
 */
export const workbookProblem = (
  error: unknown,
  fallback = 'The spreadsheet could not be created.',
) => (error instanceof ApiError ? error.message : fallback);
