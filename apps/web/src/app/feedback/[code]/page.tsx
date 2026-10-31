import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SessionFeedbackForm } from '@/components/account/session-feedback-form';
import { AdminContent, AdminPageHeader } from '@/components/admin/page-header';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Session feedback' };

/**
 * `/feedback/:code`: the page behind a session's feedback link or QR code. A delegate who is
 * not signed in goes to sign-in first and comes straight back here; the form then shows the
 * session automatically, so nobody searches for or selects a session.
 */
export default async function SessionFeedbackPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const safe = /^[A-Za-z0-9_-]{8,40}$/.test(code) ? code : '';
  const session = await getSession();
  if (!session) redirect(`/signin?next=${encodeURIComponent(`/feedback/${safe}`)}`);

  return (
    <>
      <AdminPageHeader
        breadcrumbs={[
          { label: 'My events', href: '/account/events' },
          { label: 'Session feedback' },
        ]}
        title="Session feedback"
        description="Tell the organisers how this session went. It takes about five minutes."
      />
      <AdminContent>
        {safe ? (
          <SessionFeedbackForm code={safe} />
        ) : (
          <div role="alert" className="rounded-none border border-corp-line bg-white p-5">
            <p className="font-semibold text-corp-ink">This feedback link is not valid.</p>
            <p className="mt-1 text-sm">
              Scan the session’s QR code again or ask the organisers for the link.
            </p>
          </div>
        )}
      </AdminContent>
    </>
  );
}
