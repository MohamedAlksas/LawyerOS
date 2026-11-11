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
});
