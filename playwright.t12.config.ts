import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * T12 browser-verification configuration.
 *
 * Dedicated to Task T12 document versions, paper original presence/location,
 * metadata search, and linked hearing/deadline/POA document references.
 * Runs on isolated application port 3212 against test PostgreSQL database and private E2E storage.
 */

if (!process.env.TEST_DATABASE_URL) {
  const envTestPath = path.resolve(process.cwd(), '.env.test');
  if (fs.existsSync(envTestPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envTestPath);
  }
}

import { validateTestEnvironment } from './tests/helpers/test-db';

const PORT = 3212;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const T12_E2E_STORAGE_ROOT = (process.env.T12_E2E_STORAGE_ROOT ??= path.join(
  os.tmpdir(),
  `lawoffice-t12-e2e-${process.pid}-${Date.now()}`
));

const env = validateTestEnvironment();
Object.assign(process.env, {
  NODE_ENV: 'test',
  DOCUMENTS_STORAGE_ROOT: T12_E2E_STORAGE_ROOT,
  DOCUMENT_SCAN_POLICY_MODE: 'INITIAL_DEFERRED',
});

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/t12-*.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/t12',
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
    },
    {
      name: 'tablet-768',
      use: {
        viewport: { width: 768, height: 1024 },
      },
      grep: /@(?:responsive|a11y)\b/,
    },
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
      },
      grep: /@(?:responsive|a11y)\b/,
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
      DOCUMENTS_STORAGE_ROOT: T12_E2E_STORAGE_ROOT,
      DOCUMENT_SCAN_POLICY_MODE: 'INITIAL_DEFERRED',
    },
  },
});
