import type { MetadataRoute } from 'next';

import { platform } from '@/config/platform';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: platform.company.name,
    short_name: platform.company.name,
    description: `${platform.shortName} by ${platform.company.name}`,
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
