import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T04 browser-verification configuration.
 *
 * This file is deliberately separate from the accepted T03 `playwright.config.ts`
 * (port 3100) so T04 work cannot disturb the existing suite. It targets port
 * 3204 and a dedicated test database supplied through `.env.test`.
 *
 * Contract section 8 names `http://localhost:3204`; the suite binds and addresses
 * the same loopback server as `127.0.0.1` so Windows cannot resolve `localhost`
 * to IPv6 while Next listens only on IPv4. baseURL, webServer.url and
 * BETTER_AUTH_URL share that one origin, which keeps session cookies valid.
 */

if (!process.env.TEST_DATABASE_URL) {
  const envTestPath = path.resolve(process.cwd(), '.env.test');
  if (fs.existsSync(envTestPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envTestPath);
  }
}

import { validateTestEnvironment } from './tests/helpers/test-db';

const PORT = 3204;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const env = validateTestEnvironment();
// Worker-side Prisma fixtures must use the same isolated database as the server.
Object.assign(process.env, { NODE_ENV: 'test' });

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /t04-.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: true,
  // A test that needs a retry to pass is a flake, not a pass. T04 keeps retries
  // at zero so the suite reports its real health.
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/t04',
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
      // Desktop runs every T04 test, including viewport-agnostic journeys and
      // the explicit responsive matrix.
      grep: /@(?:shell|once|matrix|desktop)\b/,
    },
    {
      name: 'tablet-768',
      use: {
        viewport: { width: 768, height: 1024 },
      },
      grep: /@(?:shell|tablet)\b/,
    },
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
      },
      grep: /@(?:shell|mobile)\b/,
    },
  ],
  webServer: {
    command: `npx next start -H ${HOST} -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      HOST,
      NODE_ENV: 'test',
      TEST_DATABASE_URL: env.TEST_DATABASE_URL!,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: BASE_URL,
      PARTY_IDENTITY_ENCRYPTION_KEY:
        process.env.PARTY_IDENTITY_ENCRYPTION_KEY ||
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      PARTY_IDENTITY_KEY_ID: process.env.PARTY_IDENTITY_KEY_ID || 'k2026_01',
    },
  },
});
