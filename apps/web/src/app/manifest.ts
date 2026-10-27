import type { MetadataRoute } from 'next';

import { event } from '@/config/event';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: event.shortName,
    short_name: event.shortName,
    description: `${event.fullName}: delegate impact measurement`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#002a5e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
