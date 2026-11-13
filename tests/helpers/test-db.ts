import { Pool, PoolConfig, Client } from 'pg';
import crypto from 'crypto';
import { validateEnv, EnvironmentValidationError, AppEnv, validatePostgresUrlStructure } from '@/lib/env';

/**
 * Resolves and canonicalizes effective PostgreSQL routing parameters.
 * Explicitly assigns canonical default port 5432 when omitted, preventing
 * the pg driver from falling back to ambient PGPORT or other environment defaults.
 */
export function canonicalizePostgresUrl(urlStr: string): string {
  const structure = validatePostgresUrlStructure(urlStr);
  if (!structure.valid) {
    return urlStr; // Let validateTestEnvironment handle structural errors fail-closed
  }

  try {
    const parsed = new URL(urlStr);
    if (!parsed.port || parsed.port.trim().length === 0) {
      parsed.port = '5432';
    }
    return parsed.toString();
  } catch {
    return urlStr;
  }
}

interface ClientWithParameters {
  connectionParameters: {
    host?: string;
    port?: number | string;
    database?: string;
    user?: string;
  };
}

/**
 * Validates the test environment strictly through the shared isolation guard.
 * Refuses fallback strings, requiring an explicit TEST_DATABASE_URL.
 * Ensures rejection happens before any network socket is opened.
 * Canonicalizes destination parameters so ambient driver fallbacks cannot cause drift.
 */
export function validateTestEnvironment(
  overrides: Record<string, string | undefined> = {}
): AppEnv {
  const rawTestDbUrl =
    'TEST_DATABASE_URL' in overrides
      ? overrides.TEST_DATABASE_URL
      : process.env.TEST_DATABASE_URL;
  if (!rawTestDbUrl || rawTestDbUrl.trim().length === 0) {
    throw new EnvironmentValidationError(
      'Environment validation failed.\nMissing required environment variable(s): TEST_DATABASE_URL\nTEST_DATABASE_URL is strictly required for test execution. Fails closed without fallback.\nConsult .env.example for required configuration. Secret values are redacted.',
      ['TEST_DATABASE_URL'],
      []
    );
  }

  const rawOpDbUrl =
    'DATABASE_URL' in overrides
      ? overrides.DATABASE_URL
      : process.env.DATABASE_URL;

  // Connection-free driver destination separation check (Phase A / R07)
  // Ensure that operational and test targets do not coincide under effective pg driver parameters
  // (taking ambient PGPORT, omitted ports, and loopback aliases into account)
  if (rawOpDbUrl && rawOpDbUrl.trim().length > 0) {
    const testStructure = validatePostgresUrlStructure(rawTestDbUrl);
    const opStructure = validatePostgresUrlStructure(rawOpDbUrl);

    if (testStructure.valid && opStructure.valid) {
      const originalPgPort = process.env.PGPORT;
      const hasPgPortOverride = 'PGPORT' in overrides;
      try {
        if (hasPgPortOverride) {
          if (overrides.PGPORT === undefined) {
            delete process.env.PGPORT;
          } else {
            process.env.PGPORT = overrides.PGPORT;
          }
        }

        const opClient = new Client({ connectionString: rawOpDbUrl }) as unknown as ClientWithParameters;
        const opParams = opClient.connectionParameters;

        const rawTestClient = new Client({ connectionString: rawTestDbUrl }) as unknown as ClientWithParameters;
        const rawTestParams = rawTestClient.connectionParameters;

        const canonicalTestUrl = canonicalizePostgresUrl(rawTestDbUrl);
        const canonicalTestClient = new Client({ connectionString: canonicalTestUrl }) as unknown as ClientWithParameters;
        const canonicalTestParams = canonicalTestClient.connectionParameters;

        const opHost = decodeURIComponent((opParams.host || '').replace(/^\[(.+)\]$/, '$1')).toLowerCase();
        const opPort = Number(opParams.port);
        const opDb = decodeURIComponent(opParams.database || '');

        const testHost = decodeURIComponent((rawTestParams.host || '').replace(/^\[(.+)\]$/, '$1')).toLowerCase();
        const rawTestPort = Number(rawTestParams.port);
        const canonicalTestPort = Number(canonicalTestParams.port);
        const testDb = decodeURIComponent(rawTestParams.database || '');

        const loopbacks = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
        const hostsCoincide = opHost === testHost || (loopbacks.has(opHost) && loopbacks.has(testHost));
        const dbsCoincide = opDb === testDb;
        const portsCoincide = opPort === rawTestPort || opPort === canonicalTestPort;

        if (hostsCoincide && dbsCoincide && portsCoincide) {
          throw new EnvironmentValidationError(
            `Environment validation failed.\nInvalid environment variable(s): TEST_DATABASE_URL\nTEST_DATABASE_URL must not target the operational/development database ('${testDb || 'unknown'}').\nConsult .env.example for required configuration. Secret values are redacted.`,
            [],
            ['TEST_DATABASE_URL']
          );
        }
      } finally {
        if (hasPgPortOverride) {
          if (originalPgPort === undefined) {
            delete process.env.PGPORT;
          } else {
            process.env.PGPORT = originalPgPort;
          }
        }
      }
    }
  }

  const canonicalTestUrl = canonicalizePostgresUrl(rawTestDbUrl);

  const envSource: Record<string, string | undefined> = {
    ...process.env,
    ...overrides,
    TEST_DATABASE_URL: canonicalTestUrl,
    NODE_ENV: 'test',
  };

  return validateEnv(envSource);
}

/**
 * Creates a PostgreSQL pool only after passing the shared test environment validator.
 * Guaranteed: No network socket or connection pool is initialized if the target fails isolation validation.
 * Composes the effective destination from poolConfig overrides before validation,
 * canonicalizes routing parameters to eliminate ambient driver fallback, and strips
 * individual routing fields so the driver adheres strictly to the validated URL.
 */
export function createValidatedTestPool(
  overrides: Record<string, string | undefined> = {},
  poolConfig: Partial<PoolConfig> = {}
): { pool: Pool; env: AppEnv } {
  // If connectionString was explicitly provided in poolConfig, it must not be undefined or empty (Phase A)
  if ('connectionString' in poolConfig) {
    if (typeof poolConfig.connectionString !== 'string' || poolConfig.connectionString.trim().length === 0) {
      throw new EnvironmentValidationError(
        'Environment validation failed.\nInvalid connectionString provided in poolConfig: must be a non-empty string.\nConsult .env.example for required configuration. Secret values are redacted.',
        ['TEST_DATABASE_URL'],
        []
      );
    }
  }

  // Compose effective target URL to prevent poolConfig overrides from bypassing destination validation (R07)
  let candidateUrl = poolConfig.connectionString || overrides.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

  if (!poolConfig.connectionString && (poolConfig.host || poolConfig.port || poolConfig.database || poolConfig.user)) {
    try {
      const base = candidateUrl || 'postgresql://localhost:5432/unknown';
      const parsed = new URL(base);
      if (poolConfig.host) parsed.hostname = poolConfig.host;
      if (poolConfig.port) parsed.port = String(poolConfig.port);
      if (poolConfig.database) parsed.pathname = `/${poolConfig.database}`;
      if (poolConfig.user) parsed.username = poolConfig.user;
      if (poolConfig.password) parsed.password = String(poolConfig.password);
      candidateUrl = parsed.toString();
    } catch {
      // Keep candidateUrl as-is; validateTestEnvironment will fail closed
    }
  }

  if (candidateUrl) {
    candidateUrl = canonicalizePostgresUrl(candidateUrl);
  }

  const env = validateTestEnvironment({
    ...overrides,
    TEST_DATABASE_URL: candidateUrl,
  });

  // Strip all routing parameters from poolConfig so pg driver defaults (e.g. PGDATABASE, PGPORT)
  // cannot be resolved or override the validated destination (Phase A)
  const safePoolConfig: Partial<PoolConfig> = { ...poolConfig };
  delete safePoolConfig.connectionString;
  delete safePoolConfig.host;
  delete safePoolConfig.port;
  delete safePoolConfig.database;
  delete safePoolConfig.user;
  delete safePoolConfig.password;

  const pool = new Pool({
    connectionTimeoutMillis: 5000,
    ...safePoolConfig,
    connectionString: env.TEST_DATABASE_URL,
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
    // Only search by email if no explicit userIds were provided
    if (emails.length > 0 && userIds.size === 0) {
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
 *
 * Refuses collisions without modifying pre-existing databases, quotes identifiers safely,
 * and tracks ownership so teardown drops only the exact database created by this run.
 */
export async function createDedicatedTestDatabase(
  dbName?: string,
  overrides: Record<string, string | undefined> = {}
): Promise<{
  url: string;
  pool: Pool;
  drop: () => Promise<void>;
}> {
  const targetName =
    dbName ||
    `lawoffice_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}_test`;

  // 1. Strict identifier syntax validation: alphanumeric and underscores only, ending in _test, bounded to 63 chars (PostgreSQL NAMEDATALEN - 1)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,57}_test$/.test(targetName) || targetName.length > 63) {
    throw new Error(
      `Dedicated test database name must be alphanumeric and underscores ending in '_test' (at most 63 characters), got: ${targetName}`
    );
  }

  // 2. Validate base environment and construct dedicated database URL
  const baseEnv = validateTestEnvironment(overrides);
  const testDbUrl = baseEnv.TEST_DATABASE_URL!;

  const dedicatedParsed = new URL(testDbUrl);
  dedicatedParsed.pathname = `/${targetName}`;
  const dedicatedUrl = dedicatedParsed.toString();

  // 3. Strictly validate dedicated URL through the shared isolation guard BEFORE executing CREATE DATABASE (Phase A)
  validateTestEnvironment({
    ...overrides,
    TEST_DATABASE_URL: dedicatedUrl,
  });

  // 4. Connect to base server to check collision and execute CREATE DATABASE
  const adminPool = new Pool({
    connectionString: testDbUrl,
    connectionTimeoutMillis: 5000,
  });

  const adminClient = await adminPool.connect();
  let createdAndOwned = false;
  const quotedName = `"${targetName.replace(/"/g, '""')}"`;

  try {
    // Collision refusal: refuse if database already exists in PostgreSQL without modifying it (R07)
    const existing = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1;',
      [targetName]
    );
    if (existing.rows.length > 0) {
      throw new Error(
        `Refusing to overwrite existing database '${targetName}'. Collision detected.`
      );
    }

    await adminClient.query(`CREATE DATABASE ${quotedName};`);
    createdAndOwned = true;
  } finally {
    adminClient.release();
    await adminPool.end();
  }

  // 5. Subsequent pool creation and teardown registration protected against catalog leaks (Phase A)
  try {
    const dedicatedPool = new Pool({
      connectionString: dedicatedUrl,
      connectionTimeoutMillis: 5000,
    });

    const drop = async () => {
      // Teardown drops ONLY the exact database created and owned by this run
      if (!createdAndOwned) return;

      await dedicatedPool.end().catch(() => {});
      const cleanupPool = new Pool({
        connectionString: testDbUrl,
        connectionTimeoutMillis: 5000,
      });
      const cleanupClient = await cleanupPool.connect();
      try {
        await cleanupClient.query(`DROP DATABASE IF EXISTS ${quotedName} WITH (FORCE);`);
        createdAndOwned = false;
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
  } catch (err) {
    if (createdAndOwned) {
      const cleanupPool = new Pool({
        connectionString: testDbUrl,
        connectionTimeoutMillis: 5000,
      });
      try {
        const cleanupClient = await cleanupPool.connect();
        try {
          await cleanupClient.query(`DROP DATABASE IF EXISTS ${quotedName} WITH (FORCE);`);
        } finally {
          cleanupClient.release();
        }
      } catch {
        // preserve original error
      } finally {
        await cleanupPool.end().catch(() => {});
      }
    }
    throw err;
  }
}

