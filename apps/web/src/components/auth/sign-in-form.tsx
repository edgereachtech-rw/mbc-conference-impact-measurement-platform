'use client';

import { magicLinkRequestSchema, verifyCodeSchema } from '@mbc/shared';
import { Loader2Icon, MailCheckIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiFetch } from '@/lib/api';

interface SignInFormProps {
  /** Where to go after a successful code sign-in (links carry their own `next`). */
  next?: string;
  supportEmail: string;
}

type Stage = 'email' | 'sent';

/**
 * Passwordless sign-in (E3-3, E3-4): request a link, then either click it or type the code.
 * The confirmation never reveals whether the address is registered.
 */
export function SignInForm({ next, supportEmail }: SignInFormProps) {
  const router = useRouter();
  const ids = { email: useId(), code: useId() };
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = magicLinkRequestSchema.safeParse({ email, next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/auth/magic-link', { method: 'POST', body: JSON.stringify(parsed.data) });
      setEmail(parsed.data.email);
      setStage('sent');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'We could not send the link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = verifyCodeSchema.safeParse({ email, code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code');
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{ next: string }>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      router.replace(next ?? result.next);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? 'That code is not valid or has expired. Request a new link to get a fresh code.'
          : e instanceof ApiError
            ? e.message
            : 'We could not check the code. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'sent') {
    return (
      <div className="space-y-6" aria-live="polite">
        <div className="flex items-start gap-3 rounded-lg border border-brand-line bg-card p-4 shadow-card">
          <MailCheckIcon className="mt-0.5 size-6 shrink-0 text-success" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium text-brand-primary">Check your email</p>
            <p className="text-sm text-brand-muted">
              If <span className="font-medium text-brand-text">{email}</span> is registered for the
              conference, a sign-in link and a 6-digit code are on their way. The link works once
              and expires in a few minutes; check your spam folder if nothing arrives.
            </p>
          </div>
        </div>

        <form onSubmit={submitCode} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={ids.code}>Or enter the 6-digit code from the email</Label>
            <Input
              id={ids.code}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${ids.code}-error` : undefined}
            />
          </div>
          {error ? (
            <p id={`${ids.code}-error`} role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Checking…' : 'Sign in with the code'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStage('email');
              setCode('');
              setError(null);
            }}
          >
            Use a different email
          </Button>
        </form>

        <SupportNote supportEmail={supportEmail} />
      </div>
    );
  }

  return (
    <form onSubmit={requestLink} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor={ids.email}>Email address you registered with</Label>
        <Input
          id={ids.email}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids.email}-error` : `${ids.email}-hint`}
        />
        <p id={`${ids.email}-hint`} className="text-sm text-brand-muted">
          No password needed. We email you a secure link and a one-time code.
        </p>
      </div>
      {error ? (
        <p id={`${ids.email}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="cta" className="w-full" disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
        {busy ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
      <SupportNote supportEmail={supportEmail} />
    </form>
  );
}

function SupportNote({ supportEmail }: { supportEmail: string }) {
  return (
    <p className="text-sm text-brand-muted">
      Lost access or changed your email? Write to{' '}
      <a href={`mailto:${supportEmail}`} className="font-medium text-brand-primary underline">
        {supportEmail}
      </a>{' '}
      and we will update your registration.
    </p>
  );
}
