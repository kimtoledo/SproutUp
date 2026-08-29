import { describe, expect, it } from 'vitest';
import { PRECACHE_URLS, OFFLINE_URL, swStrategy } from './pwa';

describe('PRECACHE_URLS', () => {
  it('includes the app shell entry points and the offline fallback', () => {
    for (const url of ['/', '/login', '/register', OFFLINE_URL, '/manifest.webmanifest']) {
      expect(PRECACHE_URLS).toContain(url);
    }
  });
});

describe('swStrategy', () => {
  const doc = { method: 'GET', sameOrigin: true, destination: 'document', pathname: '/portal' };

  it('never touches cross-origin requests (the API lives on another origin)', () => {
    expect(swStrategy({ ...doc, sameOrigin: false })).toBe('passthrough');
  });

  it('never touches non-GET requests', () => {
    expect(swStrategy({ ...doc, method: 'POST' })).toBe('passthrough');
  });

  it('serves HTML navigations network-first', () => {
    expect(swStrategy(doc)).toBe('network-first');
    expect(swStrategy({ ...doc, destination: '', pathname: '/admin/onboarding' })).toBe(
      'network-first',
    );
  });

  it('serves immutable build assets and /pwa/ icons cache-first', () => {
    expect(
      swStrategy({
        method: 'GET',
        sameOrigin: true,
        destination: 'script',
        pathname: '/_next/static/chunks/main.js',
      }),
    ).toBe('cache-first');
    expect(
      swStrategy({
        method: 'GET',
        sameOrigin: true,
        destination: 'image',
        pathname: '/pwa/icon.svg',
      }),
    ).toBe('cache-first');
  });

  it('passes through anything unrecognised', () => {
    expect(
      swStrategy({ method: 'GET', sameOrigin: true, destination: 'manifest', pathname: '/x.json' }),
    ).toBe('passthrough');
  });
});
