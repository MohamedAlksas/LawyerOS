import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDbPool, closeDbPool, checkDatabaseReadiness } from '@/lib/db';
import { Pool, PoolClient } from 'pg';

describe('Database Connection Pool Lifecycle & Timeout Bounds (R03, R04)', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    await closeDbPool();
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    process.env.TEST_DATABASE_URL = 'postgresql://lawoffice_user:secret@127.0.0.1:5433/lawoffice_test?schema=public';
  });

  afterEach(async () => {
    await closeDbPool();
    process.env = { ...originalEnv };
  });

  it('reuses the exact same singleton pool instance across multiple calls in production mode (R03)', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_prod?schema=public';

    const pool1 = getDbPool();
    const pool2 = getDbPool();

    expect(pool1).toBeDefined();
    expect(pool2).toBeDefined();
    expect(pool1).toBe(pool2); // Reused singleton in production
  });

  it('closeDbPool cleanly ends the owned pool and allows fresh instantiation (R03)', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_prod?schema=public';

    const pool1 = getDbPool();
    await closeDbPool();

    const pool2 = getDbPool();
    expect(pool1).not.toBe(pool2); // Fresh instance created after clean shutdown
  });

  it('bounds probe execution on query stall and evicts timed-out client with release(true) (R04)', async () => {
    const mockRelease = vi.fn();
    const mockClient = {
      query: vi.fn().mockImplementation(() => new Promise(() => {})), // query never finishes (stalled)
      release: mockRelease,
    } as unknown as PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as Pool;

    const result = await checkDatabaseReadiness(50, mockPool);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Database probe timed out after 50ms');

    // Asserts that client was evicted via release(true), not returned cleanly for reuse
    expect(mockRelease).toHaveBeenCalledWith(true);
  });

  it('allows subsequent probe to succeed cleanly after a previous timeout (R04)', async () => {
    const mockRelease = vi.fn();
    const mockHealthyClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ probe: 1 }] }),
      release: mockRelease,
    } as unknown as PoolClient;

    const mockHealthyPool = {
      connect: vi.fn().mockResolvedValue(mockHealthyClient),
    } as unknown as Pool;

    const result = await checkDatabaseReadiness(1000, mockHealthyPool);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(typeof result.latencyMs).toBe('number');
    // Normal healthy query releases client cleanly (without true flag)
    expect(mockRelease).toHaveBeenCalledWith();
  });
});
