'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker after load, in production builds only. Dev runs
 * skip it so hot-reload is never served a stale shell. Failures are swallowed —
 * the app is fully functional without the SW; it only adds offline resilience
 * and installability.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* offline support unavailable — non-fatal */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
