import { DownloadIcon } from 'lucide-react';

import { consoleButton } from '@/components/console/page';
import { apiUrl } from '@/lib/api';

/**
 * The tab's records as a designed document (2026-11-21): one PDF and one Word download of the
 * same content. `path` is the API address without its extension, e.g.
 * `/events/e1/attendance/register`.
 */
export function DocumentDownloads({ path, label }: { path: string; label: string }) {
  return (
    <div
      role="group"
      aria-label={`Download ${label.toLowerCase()}`}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-sm font-semibold text-corp-ink">{label}:</span>
      {(['pdf', 'docx'] as const).map((format) => (
        <a
          key={format}
          href={apiUrl(`${path}.${format}`)}
          download
          className={consoleButton({ variant: 'secondary', size: 'sm' })}
        >
          <DownloadIcon aria-hidden="true" /> {format === 'pdf' ? 'PDF' : 'Word'}
        </a>
      ))}
    </div>
  );
}
