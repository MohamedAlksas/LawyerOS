import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { checkDatabaseReadiness } from '@/lib/db';
import net from 'net';

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
  it('strictly requires an explicitly configured disposable test database and verifies identity (R01, R02)', async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) {
      throw new Error(
        'TEST_DATABASE_URL environment variable is strictly required for integration tests. The suite fails closed without it.'
      );
    }

    const pool = new Pool({
      connectionString: testUrl,
      connectionTimeoutMillis: 3000,
    });

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
        expect(db_name).toBe('lawoffice_test');
        expect(db_user).toBe('lawoffice_user');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
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
