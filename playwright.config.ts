import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ||
        'postgresql://lawoffice_user:lawoffice_dev_secret@127.0.0.1:5433/lawoffice_test?schema=public',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ||
        'postgresql://lawoffice_user:lawoffice_dev_secret@127.0.0.1:5433/lawoffice_test?schema=public',
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ||
        'synthetic_development_secret_32_bytes_minimum_length_required',
      BETTER_AUTH_URL: BASE_URL,
    },
  },
});