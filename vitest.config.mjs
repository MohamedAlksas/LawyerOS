import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Helper to parse local environment files for test execution without external dependencies.
 * Loads .env.test first, then falls back to .env.local or .env.
 */
export function loadLocalTestEnv(baseDir = __dirname) {
  const loaded = {};
  for (const filename of ['.env.test', '.env.local', '.env']) {
    const filePath = path.resolve(baseDir, filename);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!(key in loaded)) {
            loaded[key] = value;
          }
        }
      }
    }
  }
  return loaded;
}

const localEnv = loadLocalTestEnv();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    fileParallelism: false,
    env: {
      ...localEnv,
      // Force test mode unconditionally after local files are loaded (R08)
      NODE_ENV: 'test',
      // Preserve explicit environment variables from shell or CI
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.TEST_DATABASE_URL ? { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
      ...(process.env.CI !== undefined ? { CI: process.env.CI } : {}),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
