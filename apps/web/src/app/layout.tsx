import type { Metadata, Viewport } from 'next';
import { Inter, Oswald, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Toaster } from '@/components/ui/sonner';
import { event } from '@/config/event';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';

import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap',
});

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-oswald',
  display: 'swap',
});

// Corporate font (M.Bryan site uses Inter); only the organiser band uses it.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: event.shortName,
    template: `%s | ${event.shortName}`,
  },
  description: `${event.fullName}. ${event.tagline}.`,
  applicationName: event.shortName,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: event.shortName,
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#002a5e',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  return (
    <html lang="en" className={cn(poppins.variable, oswald.variable, inter.variable)}>
      <body className="flex min-h-dvh flex-col">
        <SiteHeader session={session} />
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
