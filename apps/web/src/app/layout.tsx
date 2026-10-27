import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { APP_NAME } from '@mbc/shared';

import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Follows each delegate from pre-conference baseline through follow-ups.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
