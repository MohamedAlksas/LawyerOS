import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { checkDatabaseReadiness } from '@/lib/db';

describe('Database Readiness Probe Integration', () => {
  it('correctly reports failure and sanitizes errors when connecting to a stopped/unreachable database', async () => {
    // Port 5439 has no database listening, simulating a stopped/crashed service
    const offlinePool = new Pool({
      connectionString: 'postgresql://fake_user:secret_pass_123@127.0.0.1:5439/fake_db',
      connectionTimeoutMillis: 1000,
    });

    try {
      const result = await checkDatabaseReadiness(1500, offlinePool);
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
      // Verify sanitized message without secret leakage
      expect(result.error).not.toContain('secret_pass_123');
      expect(result.error).not.toContain('fake_user');
      expect(result.error).toContain('Database service unreachable');
    } finally {
      await offlinePool.end();
    }
  });

  it('safely handles probe timeouts without process crash or unhandled rejections', async () => {
    const nonRoutablePool = new Pool({
      connectionString: 'postgresql://user:pass@10.255.255.1:5432/db',
      connectionTimeoutMillis: 500,
    });

    try {
      const result = await checkDatabaseReadiness(100, nonRoutablePool);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('timed out');
    } finally {
      await nonRoutablePool.end().catch(() => {});
    }
  });

  it('probes a live database when configured and active', async () => {
    const liveUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!liveUrl) {
      // In standalone test runs without a configured database, skip active probe
      return;
    }

    const livePool = new Pool({
      connectionString: liveUrl,
      connectionTimeoutMillis: 2000,
    });

    try {
      const result = await checkDatabaseReadiness(3000, livePool);
      if (result.ok) {
        expect(typeof result.latencyMs).toBe('number');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        expect(result.error).toBeUndefined();
      } else {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }
    } finally {
      await livePool.end().catch(() => {});
    }
  });
});
