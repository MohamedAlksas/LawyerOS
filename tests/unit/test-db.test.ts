import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createValidatedTestPool, createDedicatedTestDatabase } from '../helpers/test-db';
import { EnvironmentValidationError } from '@/lib/env';

describe('Test Database Isolation & Pool Construction Helpers (Phase A)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.TEST_DATABASE_URL = 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_test?schema=public';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects explicit empty string or undefined connectionString in poolConfig and prevents pg driver fallback (Phase A)', () => {
    process.env.PGDATABASE = 'codex_unvalidated_dev';
    process.env.PGPORT = '65432';

    // 1. Explicit undefined connectionString in poolConfig
    expect(() => {
      createValidatedTestPool({}, { connectionString: undefined });
    }).toThrow(EnvironmentValidationError);

    // 2. Explicit empty string connectionString in poolConfig
    expect(() => {
      createValidatedTestPool({}, { connectionString: '' });
    }).toThrow(EnvironmentValidationError);

    // 3. Explicit whitespace connectionString in poolConfig
    expect(() => {
      createValidatedTestPool({}, { connectionString: '   ' });
    }).toThrow(EnvironmentValidationError);
  });

  it('instantiates Pool strictly with validated TEST_DATABASE_URL and strips routing overrides (Phase A)', () => {
    process.env.PGDATABASE = 'codex_unvalidated_dev';
    process.env.PGPORT = '65432';

    const { pool, env } = createValidatedTestPool({}, {
      max: 10,
    });
    const opts = pool.options as unknown as Record<string, unknown>;
    expect(opts.connectionString).toBe(env.TEST_DATABASE_URL);
    expect(opts.database).toBeUndefined();
    expect(opts.port).toBeUndefined();
  });

  it('rejects malformed database identifiers like codex_bad%_test without executing CREATE DATABASE (Phase A)', async () => {
    await expect(createDedicatedTestDatabase('codex_bad%_test')).rejects.toThrow(
      /Dedicated test database name must be alphanumeric and underscores/
    );
  });
});
