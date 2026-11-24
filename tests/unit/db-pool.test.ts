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
    process.env.BETTER_AUTH_URL = 'https://lawoffice.example.com';
    process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'synthetic-db-pool-secret-key-at-least-32-chars';

    const pool1 = getDbPool();
    const pool2 = getDbPool();

    expect(pool1).toBeDefined();
    expect(pool2).toBeDefined();
    expect(pool1).toBe(pool2); // Reused singleton in production
  });

  it('closeDbPool cleanly ends the owned pool and allows fresh instantiation (R03)', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_prod?schema=public';
    process.env.BETTER_AUTH_URL = 'https://lawoffice.example.com';
    process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'synthetic-db-pool-secret-key-at-least-32-chars';

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

  it('recovers cleanly on the exact same pool instance after repeated query timeouts (R13)', async () => {
    const releaseCalls: (boolean | undefined)[] = [];
    let callCount = 0;

    // A single shared pool that handles multiple probes
    const sharedPool = {
      connect: vi.fn().mockImplementation(async () => {
        callCount++;
        const isHealthy = callCount > 3; // First 3 calls stall; 4th call is healthy

        return {
          query: vi.fn().mockImplementation(() => {
            if (!isHealthy) {
              return new Promise(() => {}); // stalled query
            }
            return Promise.resolve({ rows: [{ probe: 1 }] });
          }),
          release: vi.fn().mockImplementation((destroy?: boolean) => {
            releaseCalls.push(destroy);
          }),
        } as unknown as PoolClient;
      }),
    } as unknown as Pool;

    // 1st probe: stall & timeout
    const res1 = await checkDatabaseReadiness(30, sharedPool);
    expect(res1.ok).toBe(false);
    expect(res1.error).toContain('Database probe timed out after 30ms');

    // 2nd probe on same pool: stall & timeout
    const res2 = await checkDatabaseReadiness(30, sharedPool);
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain('Database probe timed out after 30ms');

    // 3rd probe on same pool: stall & timeout
    const res3 = await checkDatabaseReadiness(30, sharedPool);
    expect(res3.ok).toBe(false);
    expect(res3.error).toContain('Database probe timed out after 30ms');

    // Verify all 3 timed-out clients were evicted with release(true)
    expect(releaseCalls.slice(0, 3)).toEqual([true, true, true]);

    // 4th probe on the exact same pool: recovers and succeeds cleanly
    const res4 = await checkDatabaseReadiness(500, sharedPool);
    expect(res4.ok).toBe(true);
    expect(res4.error).toBeUndefined();
    expect(typeof res4.latencyMs).toBe('number');

    // 4th client was released cleanly (release() without destroy flag)
    expect(releaseCalls[3]).toBeUndefined();
  });

  it('handles pending acquisition timeout and evicts late-acquired client upon subsequent arrival (R13)', async () => {
    let lateClientReleasedWith: boolean | undefined = undefined;
    let lateResolve: ((client: PoolClient) => void) | undefined;

    const mockLateClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ probe: 1 }] }),
      release: vi.fn().mockImplementation((destroy?: boolean) => {
        lateClientReleasedWith = destroy;
      }),
    } as unknown as PoolClient;

    const pendingPool = {
      connect: vi.fn().mockImplementation(() => {
        return new Promise<PoolClient>((resolve) => {
          lateResolve = resolve;
        });
      }),
    } as unknown as Pool;

    // Probe with short timeout (25ms) while connect is pending
    const probePromise = checkDatabaseReadiness(25, pendingPool);

    const result = await probePromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Database probe timed out after 25ms');

    // Connect resolves late after probe timeout
    if (lateResolve) {
      lateResolve(mockLateClient);
    }
    // Allow microtasks to complete
    await new Promise((r) => setTimeout(r, 10));

    // Assert late-arriving client was immediately evicted with release(true)
    expect(lateClientReleasedWith).toBe(true);
  });

  it('configures bounded resource budget (max: 10 connections, 5000ms acquire timeout) on singleton pool (R19, R21)', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_prod?schema=public';
    process.env.BETTER_AUTH_URL = 'https://lawoffice.example.com';
    process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'synthetic-db-pool-secret-key-at-least-32-chars';

    const pool = getDbPool();
    expect(pool.options.max).toBe(10);
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
    expect(pool.options.idleTimeoutMillis).toBe(30000);
  });

  it('executes concurrent readiness probes and cleanly releases all acquired clients without leaks (R19, R21)', async () => {
    let acquiredClients = 0;
    let releasedClients = 0;

    const mockPool = {
      connect: vi.fn().mockImplementation(async () => {
        acquiredClients++;
        const client: Partial<PoolClient> = {
          query: vi.fn().mockResolvedValue({ rows: [{ probe: 1 }] }),
          release: vi.fn().mockImplementation((destroy?: boolean) => {
            if (!destroy) {
              releasedClients++;
            }
          }),
        };
        return client as PoolClient;
      }),
    } as unknown as Pool;

    // Launch 6 concurrent readiness probes simultaneously
    const totalWorkers = 6;
    const workers = Array.from({ length: totalWorkers }, async (_, i) => {
      const res = await checkDatabaseReadiness(1000, mockPool);
      expect(res.ok).toBe(true);
      return i;
    });

    const results = await Promise.all(workers);
    expect(results).toHaveLength(totalWorkers);

    // Verify all acquired clients were cleanly released back to the pool without leaks
    expect(acquiredClients).toBe(totalWorkers);
    expect(releasedClients).toBe(totalWorkers);
  });

  it('does not leak an unhandled rejection when client.release(true) rejects the stalled query', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      let rejectQuery!: (err: Error) => void;
      const mockClient = {
        query: vi.fn().mockImplementation(
          () =>
            new Promise((_, reject) => {
              rejectQuery = reject;
            })
        ),
        release: vi.fn().mockImplementation((destroy?: boolean) => {
          if (destroy && rejectQuery) {
            rejectQuery(new Error('Connection terminated on eviction'));
          }
        }),
      } as unknown as PoolClient;

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      } as unknown as Pool;

      const result = await checkDatabaseReadiness(25, mockPool);
      await new Promise((r) => setTimeout(r, 15));

      expect(result.ok).toBe(false);
      expect(mockClient.release).toHaveBeenCalledWith(true);
      expect(rejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
