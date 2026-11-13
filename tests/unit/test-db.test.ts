import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { createValidatedTestPool, createDedicatedTestDatabase, validateTestEnvironment } from '../helpers/test-db';
import { EnvironmentValidationError } from '@/lib/env';

describe('Test Database Isolation & Pool Construction Helpers (Phase A)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://lawoffice_user:synthetic@127.0.0.1:5432/lawoffice_dev';
    process.env.TEST_DATABASE_URL = 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_test?schema=public';
    delete process.env.PGPORT;
    delete process.env.PGDATABASE;
    delete process.env.PGHOST;
    delete process.env.PGUSER;
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

  it('connection-free check: canonicalizes omitted port to 5432 so Client.connectionParameters ignores ambient PGPORT (R07)', () => {
    process.env.PGPORT = '65432';
    process.env.PGDATABASE = 'ambient_dev_db';

    // Test URL with omitted port
    const { pool, env } = createValidatedTestPool({
      TEST_DATABASE_URL: 'postgresql://synthetic_user:synthetic_pw@127.0.0.1/omitted_port_test',
    });

    expect(env.TEST_DATABASE_URL).toContain(':5432/');

    // Instantiate Client connection-free without connecting/opening socket
    const client = new Client(pool.options);
    const params = (client as unknown as { connectionParameters: { port: number; database: string; user?: string } }).connectionParameters;
    expect(params.port).toBe(5432);
    expect(params.database).toBe('omitted_port_test');
    expect(params.user).toBe('synthetic_user');
  });

  it('connection-free check: preserves explicit default port 5432 in Client.connectionParameters (R07)', () => {
    process.env.PGPORT = '65432';

    const { pool, env } = createValidatedTestPool({
      TEST_DATABASE_URL: 'postgresql://synthetic_user:synthetic_pw@127.0.0.1:5432/explicit_5432_test',
    });

    expect(env.TEST_DATABASE_URL).toContain(':5432/');
    const client = new Client(pool.options);
    const params = (client as unknown as { connectionParameters: { port: number; database: string } }).connectionParameters;
    expect(params.port).toBe(5432);
    expect(params.database).toBe('explicit_5432_test');
  });

  it('connection-free check: preserves legitimate explicit non-default port in Client.connectionParameters (R07)', () => {
    process.env.PGPORT = '65432';

    const { pool, env } = createValidatedTestPool({
      TEST_DATABASE_URL: 'postgresql://synthetic_user:synthetic_pw@127.0.0.1:5433/explicit_5433_test',
    });

    expect(env.TEST_DATABASE_URL).toContain(':5433/');
    const client = new Client(pool.options);
    const params = (client as unknown as { connectionParameters: { port: number; database: string } }).connectionParameters;
    expect(params.port).toBe(5433);
    expect(params.database).toBe('explicit_5433_test');
  });

  it('connection-free check: rejects same-target separation violation when operational and test match (R07)', () => {
    process.env.PGPORT = '65432';
    process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:65432/shared_test';

    // 1. Explicit matching port
    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:65432/shared_test',
      });
    }).toThrow(EnvironmentValidationError);

    // 2. Omitted port canonicalized to 5432 vs operational on 5432
    expect(() => {
      validateTestEnvironment({
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/shared_test',
        TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1/shared_test',
      });
    }).toThrow(EnvironmentValidationError);
  });

  describe('Connection-Free Driver Destination Regressions (R07 Reversed Omitted-Port Matrix)', () => {
    it('1. Operational omitted port + Test explicit matching port with ambient PGPORT (defect reproduction case) -> throws', () => {
      process.env.PGPORT = '65432';
      const opUrl = 'postgresql://synthetic:synthetic@127.0.0.1/shared_test';
      const testUrl = 'postgresql://synthetic:synthetic@127.0.0.1:65432/shared_test';

      // Verify connection-free Client.connectionParameters resolution:
      // pg resolves omitted port in opUrl to PGPORT=65432
      const opClient = new Client({ connectionString: opUrl });
      const opParams = (opClient as unknown as { connectionParameters: { port: number; database: string } }).connectionParameters;
      expect(opParams.port).toBe(65432);
      expect(opParams.database).toBe('shared_test');

      const testClient = new Client({ connectionString: testUrl });
      const testParams = (testClient as unknown as { connectionParameters: { port: number; database: string } }).connectionParameters;
      expect(testParams.port).toBe(65432);
      expect(testParams.database).toBe('shared_test');

      // Assert fail-closed validation rejection
      expect(() => {
        validateTestEnvironment({
          DATABASE_URL: opUrl,
          TEST_DATABASE_URL: testUrl,
        });
      }).toThrow(EnvironmentValidationError);
    });

    it('2. Test omitted port + Operational explicit matching port with ambient PGPORT -> throws', () => {
      process.env.PGPORT = '65432';
      const opUrl = 'postgresql://synthetic:synthetic@127.0.0.1:65432/shared_test';
      const testUrl = 'postgresql://synthetic:synthetic@127.0.0.1/shared_test';

      // Verify connection-free Client.connectionParameters resolution:
      // pg resolves omitted port in testUrl to PGPORT=65432
      const testClient = new Client({ connectionString: testUrl });
      const testParams = (testClient as unknown as { connectionParameters: { port: number; database: string } }).connectionParameters;
      expect(testParams.port).toBe(65432);

      // Assert fail-closed validation rejection
      expect(() => {
        validateTestEnvironment({
          DATABASE_URL: opUrl,
          TEST_DATABASE_URL: testUrl,
        });
      }).toThrow(EnvironmentValidationError);
    });

    it('3. Both omitted port + ambient PGPORT -> throws if db matches', () => {
      process.env.PGPORT = '65432';
      const opUrl = 'postgresql://synthetic:synthetic@127.0.0.1/shared_test';
      const testUrl = 'postgresql://synthetic:synthetic@127.0.0.1/shared_test';

      // Both URLs resolve to effective port 65432 under ambient PGPORT
      expect(() => {
        validateTestEnvironment({
          DATABASE_URL: opUrl,
          TEST_DATABASE_URL: testUrl,
        });
      }).toThrow(EnvironmentValidationError);
    });

    it('4. Both omitted port without ambient PGPORT -> throws if db matches (defaults to 5432)', () => {
      delete process.env.PGPORT;
      const opUrl = 'postgresql://synthetic:synthetic@127.0.0.1/shared_test';
      const testUrl = 'postgresql://synthetic:synthetic@127.0.0.1/shared_test';

      expect(() => {
        validateTestEnvironment({
          DATABASE_URL: opUrl,
          TEST_DATABASE_URL: testUrl,
        });
      }).toThrow(EnvironmentValidationError);
    });

    it('5. Loopback equivalence (localhost vs 127.0.0.1, ::1) -> throws', () => {
      // 5a. localhost vs 127.0.0.1 with explicit matching ports
      expect(() => {
        validateTestEnvironment({
          DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/shared_test',
          TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/shared_test',
        });
      }).toThrow(EnvironmentValidationError);

      // 5b. 127.0.0.1 vs localhost with ambient PGPORT and omitted port
      process.env.PGPORT = '65432';
      expect(() => {
        validateTestEnvironment({
          DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1/shared_test',
          TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:65432/shared_test',
        });
      }).toThrow(EnvironmentValidationError);

      // 5c. [::1] IPv6 loopback vs 127.0.0.1
      expect(() => {
        validateTestEnvironment({
          DATABASE_URL: 'postgresql://synthetic:synthetic@[::1]:5432/shared_test',
          TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/shared_test',
        });
      }).toThrow(EnvironmentValidationError);
    });

    it('6. Port mismatch -> passes separation check', () => {
      // 6a. Operational explicit 5432 vs Test explicit 5433
      process.env.PGPORT = '65432';
      const env1 = validateTestEnvironment({
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/shared_test',
        TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5433/shared_test',
      });
      expect(env1.TEST_DATABASE_URL).toContain(':5433/');

      // 6b. Operational explicit 65432 vs Test explicit 5432
      const env2 = validateTestEnvironment({
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:65432/shared_test',
        TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/shared_test',
      });
      expect(env2.TEST_DATABASE_URL).toContain(':5432/');
    });

    it('7. DB name mismatch -> passes separation check', () => {
      process.env.PGPORT = '65432';
      // Same host, same effective port (65432), different databases
      const env = validateTestEnvironment({
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:65432/lawoffice_dev',
        TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:65432/different_db_test',
      });
      expect(env.TEST_DATABASE_URL).toContain('different_db_test');
    });

    it('8. Explicit undefined or empty overrides in validateTestEnvironment -> rejects', () => {
      // 8a. Explicit undefined TEST_DATABASE_URL override
      expect(() => {
        validateTestEnvironment({ TEST_DATABASE_URL: undefined });
      }).toThrow(EnvironmentValidationError);

      // 8b. Explicit empty string TEST_DATABASE_URL override
      expect(() => {
        validateTestEnvironment({ TEST_DATABASE_URL: '' });
      }).toThrow(EnvironmentValidationError);

      // 8c. Explicit whitespace-only TEST_DATABASE_URL override
      expect(() => {
        validateTestEnvironment({ TEST_DATABASE_URL: '   ' });
      }).toThrow(EnvironmentValidationError);
    });
  });

  it('connection-free check: rejects malformed URLs fail-closed before connection (R07)', () => {
    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'not-a-valid-url',
      });
    }).toThrow(EnvironmentValidationError);

    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://127.0.0.1:99999/bad_port_test',
      });
    }).toThrow(EnvironmentValidationError);
  });

  it('rejects malformed database identifiers and lengths > 63 characters without executing CREATE DATABASE (Phase A)', async () => {
    // 1. Invalid characters
    await expect(createDedicatedTestDatabase('codex_bad%_test')).rejects.toThrow(
      /Dedicated test database name must be alphanumeric and underscores/
    );

    // 2. Length exceeding 63 characters (PostgreSQL NAMEDATALEN - 1)
    const tooLong = `${'a'.repeat(60)}_test`; // 65 chars
    await expect(createDedicatedTestDatabase(tooLong)).rejects.toThrow(
      /at most 63 characters/
    );

    // 3. Valid bounded name (<= 63 chars) passes regex validation
    // (createDedicatedTestDatabase will attempt connection to testDbUrl, confirming syntax check passed)
    const validBounded = `${'a'.repeat(30)}_test`; // 35 chars
    // Syntax validation passes, error thrown only at connection attempt
    await expect(createDedicatedTestDatabase(validBounded, {
      TEST_DATABASE_URL: 'postgresql://invalid_host:5432/test?connect_timeout=1',
    })).rejects.not.toThrow(/Dedicated test database name must be alphanumeric/);
  });
});
