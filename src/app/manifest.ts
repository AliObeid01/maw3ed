import type { MetadataRoute } from 'next';

// Web app manifest (served at /manifest.webmanifest). Colours are the palette canvas (the same value as the
// viewport themeColor in layout.tsx). The icons live in public/brand (copied from design/logo/2-app); the
// maskable one has the safe-zone padding Android needs.
const CANVAS = '#F3F5FA';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Maw3ed',
    short_name: 'Maw3ed',
    start_url: '/',
    display: 'standalone',
    theme_color: CANVAS,
    background_color: CANVAS,
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
