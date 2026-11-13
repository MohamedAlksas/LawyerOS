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
 * Tracked fixture record identifiers for strictly owned test data teardown.
 */
export interface TrackedFixtures {
  userIds?: string[];
  emails?: string[];
  verificationIdentifiers?: string[];
}

/**
 * Deletes strictly owned fixture records created by a test run,
 * leaving all unrelated sentinel users, records, and markers completely untouched.
 */
export async function cleanupTrackedFixtures(
  pool: Pool,
  fixtures: TrackedFixtures
): Promise<void> {
  const userIds = new Set<string>(fixtures.userIds || []);
  const emails = fixtures.emails || [];
  const verifs = fixtures.verificationIdentifiers || [];

  const client = await pool.connect();
  try {
    if (emails.length > 0) {
      const found = await client.query('SELECT id FROM "user" WHERE email = ANY($1::text[])', [emails]);
      for (const row of found.rows) {
        userIds.add(row.id);
      }
    }

    const uniqueIds = Array.from(userIds);
    if (uniqueIds.length > 0) {
      await client.query('DELETE FROM "twoFactor" WHERE "userId" = ANY($1::text[])', [uniqueIds]);
      await client.query('DELETE FROM "session" WHERE "userId" = ANY($1::text[])', [uniqueIds]);
      await client.query('DELETE FROM "account" WHERE "userId" = ANY($1::text[])', [uniqueIds]);
      await client.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [uniqueIds]);
    }

    if (verifs.length > 0) {
      await client.query('DELETE FROM "verification" WHERE identifier = ANY($1::text[])', [verifs]);
    }
  } finally {
    client.release();
  }
}

/**
 * Creates an isolated dedicated test database for test suites requiring an unbootstrapped
 * environment or complete isolation. Guarantees that pre-existing sentinel users and
 * bootstrap markers in the base test database remain untouched.
 */
export async function createDedicatedTestDatabase(
  dbName: string,
  overrides: Record<string, string | undefined> = {}
): Promise<{
  url: string;
  pool: Pool;
  drop: () => Promise<void>;
}> {
  if (!dbName.endsWith('_test')) {
    throw new Error(`Dedicated test database name must end with '_test', got: ${dbName}`);
  }

  const baseEnv = validateTestEnvironment(overrides);
  const testDbUrl = baseEnv.TEST_DATABASE_URL!;

  // Connect to base server to execute CREATE DATABASE
  const adminPool = new Pool({
    connectionString: testDbUrl,
    connectionTimeoutMillis: 5000,
  });

  const adminClient = await adminPool.connect();
  try {
    // Drop first if leaked from a previous aborted run
    await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
    await adminClient.query(`CREATE DATABASE ${dbName};`);
  } finally {
    adminClient.release();
    await adminPool.end();
  }

  // Construct dedicated database URL
  const dedicatedParsed = new URL(testDbUrl);
  dedicatedParsed.pathname = `/${dbName}`;
  const dedicatedUrl = dedicatedParsed.toString();

  // Validate the dedicated test URL through the shared isolation guard
  validateTestEnvironment({
    ...overrides,
    TEST_DATABASE_URL: dedicatedUrl,
  });

  const dedicatedPool = new Pool({
    connectionString: dedicatedUrl,
    connectionTimeoutMillis: 5000,
  });

  const drop = async () => {
    await dedicatedPool.end().catch(() => {});
    const cleanupPool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
    });
    const cleanupClient = await cleanupPool.connect();
    try {
      await cleanupClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
    } finally {
      cleanupClient.release();
      await cleanupPool.end();
    }
  };

  return {
    url: dedicatedUrl,
    pool: dedicatedPool,
    drop,
  };
}

