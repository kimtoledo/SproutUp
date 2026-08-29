/**
 * Shared spec for the service worker's caching rules. `public/sw.js` implements
 * the same logic by hand (a file in `public/` cannot import from here); these
 * helpers exist so the rules are unit-tested and documented in one place. Keep
 * the two in sync.
 *
 * Safety rules for a financial app:
 * - Only same-origin GET requests are ever cached. The API is a different origin
 *   (`NEXT_PUBLIC_API_URL`), so authenticated data never reaches the SW.
 * - HTML navigations are network-first (fresh shell when online, cached shell or
 *   the offline page when not).
 * - Immutable build assets (`/_next/static/…`) are cache-first.
 */

export const CACHE_VERSION = 'sproutup-v1';
export const OFFLINE_URL = '/offline';

export const PRECACHE_URLS: readonly string[] = [
  '/',
  '/login',
  '/register',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icon.svg',
];

export type SwStrategy = 'network-first' | 'cache-first' | 'passthrough';

export function swStrategy(input: {
  method: string;
  sameOrigin: boolean;
  destination: string;
  pathname: string;
}): SwStrategy {
  const { method, sameOrigin, destination, pathname } = input;
  if (method !== 'GET' || !sameOrigin) return 'passthrough';
  if (destination === 'document' || pathname === '/' || !pathname.includes('.')) {
    return 'network-first';
  }
  if (pathname.startsWith('/_next/static/') || pathname.startsWith('/pwa/')) {
    return 'cache-first';
  }
  if (['style', 'script', 'font', 'image'].includes(destination)) return 'cache-first';
  return 'passthrough';
}
