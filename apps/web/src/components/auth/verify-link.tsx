'use client';

import { CircleCheckIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/api';

interface VerifyLinkProps {
  token: string | null;
  supportEmail: string;
}

type State =
  { kind: 'verifying' } | { kind: 'done'; next: string } | { kind: 'failed'; message: string };

/**
 * Landing page of the emailed link. The token is exchanged with a POST from here (never a GET on
 * the API), so link-prefetching mail scanners cannot consume the single-use token.
 */
export function VerifyLink({ token, supportEmail }: VerifyLinkProps) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<State>(
    token ? { kind: 'verifying' } : { kind: 'failed', message: 'This link is incomplete.' },
  );

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    apiFetch<{ next: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) })
      .then((result) => {
        setState({ kind: 'done', next: result.next });
        router.replace(result.next);
        router.refresh();
      })
      .catch((e: unknown) => {
        setState({
          kind: 'failed',
          message:
            e instanceof ApiError && e.status === 401
              ? 'This link is invalid, has expired, or was already used.'
              : e instanceof ApiError && e.status === 429
                ? 'Too many attempts. Please wait a few minutes and try again.'
                : 'We could not sign you in right now. Please try again.',
        });
      });
  }, [token, router]);

  if (state.kind === 'verifying') {
    return (
      <p className="flex items-center gap-2 text-base" role="status" aria-live="polite">
        <Loader2Icon className="size-5 animate-spin text-brand-primary" aria-hidden="true" />
        Signing you in…
      </p>
    );
  }
  if (state.kind === 'done') {
    return (
      <p className="flex items-center gap-2 text-base" role="status" aria-live="polite">
        <CircleCheckIcon className="size-5 text-success" aria-hidden="true" />
        Signed in. Taking you to your account…
      </p>
    );
  }
  return (
    <div className="space-y-4" role="alert">
      <p className="flex items-start gap-2 text-base">
        <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
        {state.message}
      </p>
      <Link href="/signin" className={buttonVariants({ variant: 'cta' })}>
        Request a new link
      </Link>
      <p className="text-sm text-brand-muted">
        Need help? Write to{' '}
        <a href={`mailto:${supportEmail}`} className="font-medium text-brand-primary underline">
          {supportEmail}
        </a>
        .
      </p>
    </div>
  );
}
