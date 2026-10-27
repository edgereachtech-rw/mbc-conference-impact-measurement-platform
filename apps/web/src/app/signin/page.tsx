import type { Metadata } from 'next';

import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <ComingSoon
      title="Sign in"
      description="Delegates sign in with a magic link sent to their registered email."
    />
  );
}
