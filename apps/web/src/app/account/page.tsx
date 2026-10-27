import type { Metadata } from 'next';

import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'My account' };

export default function AccountPage() {
  return (
    <ComingSoon
      title="My account"
      description="Your profile, participation mode, reminder preferences and progress through the programme."
    />
  );
}
