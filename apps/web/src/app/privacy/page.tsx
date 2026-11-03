import { safeReturnPath } from '@mbc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PrivacyNotice } from '@/components/account/privacy-notice';
import { consoleButton, PageContent, PageHeader, StatePanel } from '@/components/console/page';
import { platform } from '@/config/platform';
import { loadConsentState, loadPrivacyNotice } from '@/lib/consent-server';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Privacy' };

/**
 * `/privacy`: the notice delegates must read before using the platform (backlog E3-7, brief
 * section 6.4), and the page that records their acceptance. Readable by anyone, signed in or not,
 * because it is the one thing a delegate needs before deciding to hand anything over.
 */
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const [session, notice, state] = await Promise.all([
    getSession(),
    loadPrivacyNotice(),
    loadConsentState(),
  ]);
  const target = safeReturnPath(next) ?? '/account';

  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title={notice?.title ?? 'Privacy information'}
        description="How M.Bryan uses what you record on this platform, and who can see it."
      />
      <PageContent>
        {notice ? (
          <PrivacyNotice
            notice={notice}
            state={session ? state : null}
            next={target}
            timezone={platform.timezone}
          />
        ) : (
          <StatePanel
            kind="error"
            title="The privacy notice could not be loaded"
            description={`Please try again. If it keeps failing, write to ${platform.contactEmail} and we will send it to you.`}
            action={
              <Link href="/privacy" className={consoleButton({ variant: 'secondary' })}>
                Try again
              </Link>
            }
          />
        )}
        {!state?.outstanding ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link href={session ? target : '/signin'} className={consoleButton()}>
              {session ? 'Continue' : 'Go to sign-in'}
            </Link>
            <a
              href={`mailto:${platform.contactEmail}`}
              className={consoleButton({ variant: 'secondary' })}
            >
              Ask about your information
            </a>
          </div>
        ) : null}
      </PageContent>
    </>
  );
}
