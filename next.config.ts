import type { NextConfig } from 'next';

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const NO_STORE_HEADER = [{ key: 'Cache-Control', value: 'private, no-store' }];

const NO_STORE_PATHS = [
  // Preserve /api/documents/:id/content route-level Cache-Control ('private, no-store, max-age=0' on 200 downloads, 'private, no-store' on errors).
  '/api/:path((?!documents/[^/]+/content(?:/.*)?$).*)',
  '/',
  '/today',
  '/agenda',
  '/inbox',
  '/inbox/:path*',
  '/tasks',
  '/deadlines',
  '/deadlines/:path*',
  '/matters',
  '/matters/:path*',
  '/parties',
  '/parties/:path*',
  '/documents',
  '/documents/:path*',
  '/hearings/:path*',
  '/search',
  '/settings/:path*',
  '/login',
  '/verify',
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/(.*)', headers: SECURITY_HEADERS },
      {
        source: '/api/documents/:id/content',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
      ...NO_STORE_PATHS.map((source) => ({ source, headers: NO_STORE_HEADER })),
    ];
  },
};

export default nextConfig;
