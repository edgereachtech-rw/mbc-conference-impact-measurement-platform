import type { Metadata } from 'next';

import { resolveSignIn, SignInPanel } from '@/components/auth/sign-in-panel';

export const metadata: Metadata = { title: 'Sign in' };

interface SignInPageProps {
  searchParams: Promise<{ next?: string; invite?: string }>;
}

/**
 * Kept alongside `/`, which serves the same panel: invitation emails carry `/signin?invite=`
 * and every protected page redirects here with `?next=`, so this route stays.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next, invite } = await searchParams;
  const state = await resolveSignIn({ next, invite });
  return <SignInPanel {...state} invite={invite} />;
}
