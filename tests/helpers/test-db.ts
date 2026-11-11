import { Pool, PoolConfig } from 'pg';
import { validateEnv, EnvironmentValidationError, AppEnv } from '@/lib/env';

/**
 * Validates the test environment strictly through the shared isolation guard.
 * Refuses fallback strings, requiring an explicit TEST_DATABASE_URL.
 * Ensures rejection happens before any network socket is opened.
 */
export function validateTestEnvironment(
  overrides: Record<string, string | undefined> = {}
): AppEnv {
  const envSource: Record<string, string | undefined> = {
    ...process.env,
    ...overrides,
    NODE_ENV: 'test',
  };

  const testDbUrl = envSource.TEST_DATABASE_URL;
  if (!testDbUrl || testDbUrl.trim().length === 0) {
    throw new EnvironmentValidationError(
      'Environment validation failed.\nMissing required environment variable(s): TEST_DATABASE_URL\nTEST_DATABASE_URL is strictly required for test execution. Fails closed without fallback.\nConsult .env.example for required configuration. Secret values are redacted.',
      ['TEST_DATABASE_URL'],
      []
    );
  }

  return validateEnv(envSource);
}

/**
 * Creates a PostgreSQL pool only after passing the shared test environment validator.
 * Guaranteed: No network socket or connection pool is initialized if the target fails isolation validation.
 */
export function createValidatedTestPool(
  overrides: Record<string, string | undefined> = {},
  poolConfig: Partial<PoolConfig> = {}
): { pool: Pool; env: AppEnv } {
  const env = validateTestEnvironment(overrides);

  const pool = new Pool({
    connectionString: env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000,
    ...poolConfig,
  });

  return { pool, env };
}

/**
 * Deletes only synthetic test user accounts and related records created during test execution,
 * preserving all sentinel and pre-existing operational/test data.
 */
export async function cleanupSyntheticTestData(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const userRows = await client.query(`
      SELECT id FROM "user" 
      WHERE email LIKE '%@office.eg' 
         OR email LIKE '%@evil.com' 
         OR email LIKE '%@example.com' 
         OR email LIKE '%synthetic%'
    `);
    const userIds: string[] = userRows.rows.map((r: { id: string }) => r.id);
    if (userIds.length > 0) {
      await client.query('DELETE FROM "twoFactor" WHERE "userId" = ANY($1::text[])', [userIds]);
      await client.query('DELETE FROM "session" WHERE "userId" = ANY($1::text[])', [userIds]);
      await client.query('DELETE FROM "account" WHERE "userId" = ANY($1::text[])', [userIds]);
      await client.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [userIds]);
    }
    await client.query(`
      DELETE FROM "verification" 
      WHERE identifier LIKE '%@office.eg' 
         OR identifier LIKE '%@evil.com' 
         OR identifier LIKE '%@example.com' 
         OR identifier LIKE '%synthetic%'
    `);
  } finally {
    client.release();
  }
}
