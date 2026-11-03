import { MailIcon } from 'lucide-react';
import Link from 'next/link';

import { platform } from '@/config/platform';

/**
 * Slim footer for the console and the delegate area: organiser, support contact, copyright.
 * The dark event footer (venue, social links) went with the marketing landing page on
 * 2026-11-02; signing in is the front door and carries its own contact line.
 */
export function SiteFooter() {
  return (
    <footer className="console-area mt-auto border-t border-corp-line bg-white font-corporate text-corp-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-gutter py-4 text-xs sm:flex-row sm:items-center sm:justify-between md:px-6">
        <p>
          {platform.company.name} · {platform.shortName}
        </p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            href={`mailto:${platform.contactEmail}`}
            className="inline-flex min-h-tap items-center gap-1.5 font-semibold text-corp-green-text hover:underline sm:min-h-0"
          >
            <MailIcon className="size-3.5" aria-hidden="true" />
            {platform.contactEmail}
          </a>
          <Link href="/privacy" className="font-semibold text-corp-green-text hover:underline">
            Privacy
          </Link>
          <span>{platform.copyright}</span>
        </p>
      </div>
    </footer>
  );
}
