import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadLocalTestEnv } from '../../vitest.config.mjs';
import { validateEnv } from '@/lib/env';

describe('Documented .env.example to local test configuration loading (R08, R19)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create an isolated temporary test directory outside the repository
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-config-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory without touching repository files
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('correctly loads and parses documented .env.example copied to .env.local in isolated workspace', () => {
    const examplePath = path.resolve(process.cwd(), '.env.example');
    expect(fs.existsSync(examplePath)).toBe(true);
    const exampleContent = fs.readFileSync(examplePath, 'utf-8');

    // Simulate developer onboarding step: copy .env.example to .env.local in isolated dir
    const localEnvPath = path.join(tempDir, '.env.local');
    fs.writeFileSync(localEnvPath, exampleContent, 'utf-8');

    // Load configuration using the Vitest test environment loader
    const loaded = loadLocalTestEnv(tempDir) as Record<string, string>;

    expect(loaded.NODE_ENV).toBe('development');
    expect(loaded.PORT).toBe('3000');
    expect(loaded.HOST).toBe('127.0.0.1');
    expect(loaded.DATABASE_URL).toBe(
      'postgresql://lawoffice_user:lawoffice_dev_secret@127.0.0.1:5432/lawoffice_dev?schema=public'
    );
    expect(loaded.TEST_DATABASE_URL).toBe(
      'postgresql://lawoffice_user:lawoffice_dev_secret@127.0.0.1:5433/lawoffice_test?schema=public'
    );

    // Verify that applying test-mode override (as done by vitest.config.mjs) passes validateEnv
    const testConfig = {
      ...loaded,
      NODE_ENV: 'test',
      CI: 'false',
    };
    const validated = validateEnv(testConfig);
    expect(validated.NODE_ENV).toBe('test');
    expect(validated.DATABASE_URL).toContain('lawoffice_test');
    expect(validated.TEST_DATABASE_URL).toContain('lawoffice_test');
  });

  it('respects file precedence: .env.test overrides .env.local', () => {
    // .env.local has default synthetic test db
    fs.writeFileSync(
      path.join(tempDir, '.env.local'),
      'TEST_DATABASE_URL="postgresql://user:secret@127.0.0.1:5433/local_test?schema=public"\nPORT=3000',
      'utf-8'
    );

    // .env.test has specialized test db
    fs.writeFileSync(
      path.join(tempDir, '.env.test'),
      'TEST_DATABASE_URL="postgresql://user:secret@127.0.0.1:6433/dedicated_test?schema=public"',
      'utf-8'
    );

    const loaded = loadLocalTestEnv(tempDir) as Record<string, string>;
    expect(loaded.TEST_DATABASE_URL).toBe(
      'postgresql://user:secret@127.0.0.1:6433/dedicated_test?schema=public'
    );
    expect(loaded.PORT).toBe('3000');
  });

  it('ignores comments and empty lines and strips single and double quotes', () => {
    const rawContent = `
# Comment line
NODE_ENV="test"
PORT='8080'
HOST=127.0.0.1
# Another comment
    `;
    fs.writeFileSync(path.join(tempDir, '.env.local'), rawContent, 'utf-8');

    const loaded = loadLocalTestEnv(tempDir) as Record<string, string>;
    expect(loaded.NODE_ENV).toBe('test');
    expect(loaded.PORT).toBe('8080');
    expect(loaded.HOST).toBe('127.0.0.1');
  });
});
