import type { MetadataRoute } from 'next';

/**
 * Web app manifest — served at `/manifest.webmanifest`. Makes SproutUp
 * installable to a phone home screen and launches it in a standalone window.
 *
 * Icons are SVG with `sizes: "any"`, which satisfies Android/Chrome
 * installability. Raster PNG icons (192/512 + a 180px apple-touch) are a
 * follow-up for iOS home-screen fidelity — tracked in `qa/ui-foundation.md`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SproutUp',
    short_name: 'SproutUp',
    description: 'A transparent Philippine SME debt-crowdfunding platform.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f7faf7',
    theme_color: '#287a4b',
    categories: ['finance', 'business'],
    icons: [
      {
        src: '/pwa/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/pwa/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
