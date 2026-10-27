import type { Metadata } from 'next';

import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Admin' };

export default function AdminPage() {
  return (
    <ComingSoon
      title="Admin"
      description="Conference setup, delegate records, dashboards and exports for the M.Bryan team."
    />
  );
}
