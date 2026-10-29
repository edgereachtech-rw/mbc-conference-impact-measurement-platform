'use client';

import { LogOutIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SignOutButtonProps {
  variant: 'icon' | 'text';
  className?: string;
}

/** Revokes the server session, clears the cookie and returns to the home page. */
export function SignOutButton({ variant, className }: SignOutButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await apiFetch<void>('/auth/sign-out', { method: 'POST' });
    } finally {
      setBusy(false);
      router.replace('/');
      router.refresh();
    }
  }

  if (variant === 'icon') {
    return (
      <Button variant="ghost" size="icon" className={className} onClick={signOut} disabled={busy}>
        <LogOutIcon aria-hidden="true" />
        <span className="sr-only">Sign out</span>
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" className={cn(className)} onClick={signOut} disabled={busy}>
      <LogOutIcon aria-hidden="true" data-icon="inline-start" />
      Sign out
    </Button>
  );
}
