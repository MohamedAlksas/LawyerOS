import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { checkDatabaseReadiness } from '@/lib/db';
import { validateEnv, EnvironmentValidationError } from '@/lib/env';
import net from 'net';

/**
 * Creates a validated PostgreSQL pool strictly through the shared isolation guard.
 * Prevents any pool connection or write if the target resolves to the operational database (R10).
 */
function createValidatedTestPool(
  testUrl: string,
  extraEnv: Record<string, string | undefined> = {}
): Pool {
  validateEnv({
    ...process.env,
    ...extraEnv,
    NODE_ENV: 'test',
    TEST_DATABASE_URL: testUrl,
  });

  return new Pool({
    connectionString: testUrl,
    connectionTimeoutMillis: 3000,
  });
}

/**
 * Helper to dynamically obtain a guaranteed closed loopback port.
 * Avoids hardcoding arbitrary ports or relying on external IPs.
 */
async function getClosedLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

describe('Database Readiness Probe Integration (Real PostgreSQL & Failure Modes)', () => {
  it('strictly requires an explicitly configured disposable test database and verifies identity (R01, R02, R10)', async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) {
      throw new Error(
        'TEST_DATABASE_URL environment variable is strictly required for integration tests. The suite fails closed without it.'
      );
    }

    const pool = createValidatedTestPool(testUrl);

    try {
      const result = await checkDatabaseReadiness(3000, pool);

      // Must be an explicit pass; conditional or silent success is forbidden
      expect(result.ok).toBe(true);
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();

      // Verify that the connected database is the expected disposable test database
      const client = await pool.connect();
      try {
        const idQuery = await client.query(
          'SELECT current_database() AS db_name, current_user AS db_user'
        );
        const { db_name, db_user } = idQuery.rows[0];
        const parsedUrl = new URL(testUrl);
        const expectedDbName = parsedUrl.pathname.replace(/^\//, '');
        expect(db_name).toBe(expectedDbName);
        expect(db_user).toBe(parsedUrl.username || 'lawoffice_user');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  it('rejects operational target misuse and URL-encoded aliases before connection (R09, R10)', () => {
    const testUrl = process.env.TEST_DATABASE_URL || 'postgresql://lawoffice_user:secret@127.0.0.1:5433/lawoffice_test';
    
    // Test exact match
    expect(() => {
      createValidatedTestPool(testUrl, {
        DATABASE_URL: testUrl,
        CI: 'false',
      });
    }).toThrowError(EnvironmentValidationError);

    // Test URL-encoded alias equivalence (/lawoffice_test vs /law%6fffice_test)
    const encodedDevUrl = testUrl.replace('/lawoffice_test', '/law%6fffice_test');
    expect(() => {
      createValidatedTestPool(testUrl, {
        DATABASE_URL: encodedDevUrl,
        CI: 'false',
      });
    }).toThrowError(EnvironmentValidationError);
  });

  it('correctly reports failure and sanitizes errors when connecting to an unreachable socket (R01)', async () => {
    const closedPort = await getClosedLoopbackPort();
    const offlinePool = new Pool({
      connectionString: `postgresql://fake_user:secret_pass_123@127.0.0.1:${closedPort}/lawoffice_test`,
      connectionTimeoutMillis: 1000,
    });

    try {
      const result = await checkDatabaseReadiness(1500, offlinePool);
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error).toContain('Database service unreachable (connection refused)');
      // Redaction assertion
      expect(result.error).not.toContain('secret_pass_123');
      expect(result.error).not.toContain('fake_user');
    } finally {
      await offlinePool.end();
    }
  });

  it('correctly reports failure and sanitizes errors when authentication fails (R01)', async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) {
      throw new Error('TEST_DATABASE_URL is required for integration tests');
    }

    const parsed = new URL(testUrl);
    parsed.password = 'intentionally_wrong_test_secret_xyz';

    const badAuthPool = new Pool({
      connectionString: parsed.toString(),
      connectionTimeoutMillis: 2000,
    });

    try {
      const result = await checkDatabaseReadiness(2000, badAuthPool);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Database authentication failed');
      expect(result.error).not.toContain('intentionally_wrong_test_secret_xyz');
    } finally {
      await badAuthPool.end().catch(() => {});
    }
  });
});
