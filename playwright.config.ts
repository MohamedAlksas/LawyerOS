import { defineConfig, devices } from '@playwright/test';
import { validateTestEnvironment } from './tests/helpers/test-db';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Strictly validate test environment before starting test runner or web server (R07)
const env = validateTestEnvironment();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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
    },
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      TEST_DATABASE_URL: env.TEST_DATABASE_URL!,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: BASE_URL,
    },
  },
});