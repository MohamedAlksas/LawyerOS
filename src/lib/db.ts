import { Pool, PoolClient } from 'pg';
import { getEnv, redactErrorMessage } from './env';

declare global {
  var __lawoffice_pg_pool: Pool | undefined;
}

let singletonPool: Pool | undefined;

/**
 * Returns a singleton connection pool for PostgreSQL.
 * Reused across requests in production and development (using globalThis to avoid socket leaks across HMR cycles).
 */
export function getDbPool(): Pool {
  if (typeof window !== 'undefined') {
    throw new Error('Database connections cannot be created on the client.');
  }

  const cached = global.__lawoffice_pg_pool ?? singletonPool;
  if (cached) {
    return cached;
  }

  const env = getEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Handle background pool errors cleanly without crashing process unhandled
  pool.on('error', (err) => {
    // Redact any possible credentials from pool-level errors
    console.error('[Database Pool Error]:', redactErrorMessage(err));
  });

  singletonPool = pool;
  global.__lawoffice_pg_pool = pool;

  return pool;
}

export interface ReadinessCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Executes a minimal read-only connectivity probe (SELECT 1 AS probe)
 * against PostgreSQL with bounded timeout, connection eviction on failure,
 * and sanitized error handling.
 */
export async function checkDatabaseReadiness(
  timeoutMs = 3000,
  overridePool?: Pool
): Promise<ReadinessCheckResult> {
  let pool: Pool;
  try {
    pool = overridePool ?? getDbPool();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Database configuration error';
    return {
      ok: false,
      latencyMs: 0,
      error: message.includes('Missing required') || message.includes('Environment validation')
        ? 'Database configuration missing or invalid'
        : 'Database initialization failed',
    };
  }

  const start = Date.now();
  let client: PoolClient | undefined;
  let clientAcquired = false;
  let released = false;
  let timedOut = false;
  let timeoutTimer: NodeJS.Timeout | undefined;

  try {
    const probePromise = (async () => {
      // 1. Acquire client from pool
      client = await pool.connect();
      clientAcquired = true;

      // If timeout already fired while waiting for connection, destroy client immediately
      if (timedOut) {
        if (!released) {
          released = true;
          try {
            client.release(true);
          } catch {}
        }
        return false;
      }

      // 2. Query execution (bounded by enclosing timeout and eviction)
      const res = await client.query('SELECT 1 AS probe');

      return res.rows[0]?.probe === 1;
    })();
    // Prevent unhandled rejection if client.release(true) rejects the in-flight query after timeout
    probePromise.catch(() => {});

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        reject(new Error('DATABASE_PROBE_TIMEOUT'));
      }, timeoutMs);
    });

    const isHealthy = await Promise.race([probePromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    return {
      ok: Boolean(isHealthy),
      latencyMs,
    };
  } catch (error: unknown) {
    timedOut = true;
    const latencyMs = Date.now() - start;
    let safeMessage = 'Database connection failed';

    // On probe error or timeout, evict the client if acquired so broken connections cannot poison pool
    if (clientAcquired && client && !released) {
      released = true;
      try {
        client.release(true); // destroy client and evict from pool
      } catch {}
    }

    if (error instanceof Error) {
      if (error.message === 'DATABASE_PROBE_TIMEOUT' || error.message.includes('Query read timeout')) {
        safeMessage = `Database probe timed out after ${timeoutMs}ms`;
      } else if (
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND')
      ) {
        safeMessage = 'Database service unreachable (connection refused)';
      } else if (
        error.message.includes('password authentication failed') ||
        error.message.includes('authentication failed')
      ) {
        safeMessage = 'Database authentication failed';
      }
    }

    return {
      ok: false,
      latencyMs,
      error: safeMessage,
    };
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
    // Clean return to pool for healthy connection
    if (clientAcquired && client && !released) {
      released = true;
      try {
        client.release();
      } catch {}
    }
  }
}

/**
 * Closes the active database connection pool (for teardown in tests or graceful shutdown).
 */
export async function closeDbPool(): Promise<void> {
  const pool = global.__lawoffice_pg_pool ?? singletonPool;
  global.__lawoffice_pg_pool = undefined;
  singletonPool = undefined;
  if (pool) {
    await pool.end();
  }
}
