import { Pool } from 'pg';
import { getEnv } from './env';

declare global {
  var __lawoffice_pg_pool: Pool | undefined;
}

/**
 * Returns a singleton connection pool for PostgreSQL.
 * In development, reuses globalThis to avoid socket leaks across HMR cycles.
 */
export function getDbPool(): Pool {
  if (typeof window !== 'undefined') {
    throw new Error('Database connections cannot be created on the client.');
  }

  if (global.__lawoffice_pg_pool) {
    return global.__lawoffice_pg_pool;
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
    const sanitized = err.message ? err.message.replace(/:\/\/.*@/, '://[REDACTED]@') : 'Pool error';
    console.error('[Database Pool Error]:', sanitized);
  });

  if (process.env.NODE_ENV !== 'production') {
    global.__lawoffice_pg_pool = pool;
  }

  return pool;
}

export interface ReadinessCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Executes a minimal read-only connectivity probe (SELECT 1 AS probe)
 * against PostgreSQL with strict timeout and sanitized error handling.
 */
export async function checkDatabaseReadiness(
  timeoutMs = 3000,
  overridePool?: Pool
): Promise<ReadinessCheckResult> {
  const pool = overridePool ?? getDbPool();
  const start = Date.now();

  let timeoutId: NodeJS.Timeout | undefined;

  try {
    const probePromise = (async () => {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT 1 AS probe');
        return res.rows[0]?.probe === 1;
      } finally {
        client.release();
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
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
    const latencyMs = Date.now() - start;
    let safeMessage = 'Database connection failed';

    if (error instanceof Error) {
      if (error.message === 'DATABASE_PROBE_TIMEOUT') {
        safeMessage = `Database probe timed out after ${timeoutMs}ms`;
      } else if (
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND')
      ) {
        safeMessage = 'Database service unreachable (connection refused)';
      } else if (error.message.includes('authentication failed')) {
        safeMessage = 'Database authentication failed';
      }
    }

    return {
      ok: false,
      latencyMs,
      error: safeMessage,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Closes the active database connection pool (for teardown in tests or graceful shutdown).
 */
export async function closeDbPool(): Promise<void> {
  if (global.__lawoffice_pg_pool) {
    const pool = global.__lawoffice_pg_pool;
    global.__lawoffice_pg_pool = undefined;
    await pool.end();
  }
}
