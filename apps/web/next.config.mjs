import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Next only auto-loads .env files from this app directory. The monorepo keeps a
// single root .env, so load NEXT_PUBLIC_* (and anything else) from there when the
// process was not started with them already exported.
try {
  const rootEnv = fs.readFileSync(path.join(dirname, '..', '..', '.env'), 'utf8');
  for (const line of rootEnv.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // No root .env (e.g. CI provides the environment directly) — carry on.
}

const isDev = process.env.NODE_ENV !== 'production';

let apiOrigin = 'http://localhost:3001';
try {
  apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').origin;
} catch {
  // Keep the default origin if NEXT_PUBLIC_API_URL is not a valid URL.
}

const connectSrc = ["'self'", apiOrigin, isDev ? 'ws: http: https:' : ''].filter(Boolean).join(' ');
const scriptSrc = ["'self'", "'unsafe-inline'", isDev ? "'unsafe-eval'" : ''].filter(Boolean).join(' ');

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The repo maintains its own root AGENTS.md; do not let Next generate a
  // competing apps/web/AGENTS.md and CLAUDE.md.
  agentRules: false,
  transpilePackages: ['@sproutup/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
