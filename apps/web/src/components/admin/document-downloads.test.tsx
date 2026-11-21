import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentDownloads } from './document-downloads';

describe('DocumentDownloads', () => {
  it('offers the same records as a PDF and as a Word document', () => {
    render(<DocumentDownloads path="/events/e1/attendance/register" label="Attendance register" />);
    const group = screen.getByRole('group', { name: 'Download attendance register' });
    expect(
      within(group)
        .getAllByRole('link')
        .map((a) => [a.textContent?.trim(), a.getAttribute('href')]),
    ).toEqual([
      ['PDF', '/api/v1/events/e1/attendance/register.pdf'],
      ['Word', '/api/v1/events/e1/attendance/register.docx'],
    ]);
  });
});
