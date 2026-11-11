import { z } from 'zod';

/**
 * Server-only environment schema for LawOffice OS.
 * Validates presence, formatting, and safety of operational variables.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (val) => val.startsWith('postgresql://') || val.startsWith('postgres://'),
      'DATABASE_URL must be a valid PostgreSQL connection string starting with postgresql:// or postgres://'
    ),
  TEST_DATABASE_URL: z
    .string()
    .refine(
      (val) => val.startsWith('postgresql://') || val.startsWith('postgres://'),
      'TEST_DATABASE_URL must be a valid PostgreSQL connection string'
    )
    .optional(),
  CI: z.string().optional(),
});

export type AppEnv = z.infer<typeof baseEnvSchema>;

export class EnvironmentValidationError extends Error {
  public readonly missingKeys: string[];
  public readonly invalidKeys: string[];

  constructor(message: string, missingKeys: string[] = [], invalidKeys: string[] = []) {
    super(message);
    this.name = 'EnvironmentValidationError';
    this.missingKeys = missingKeys;
    this.invalidKeys = invalidKeys;
  }
}

/**
 * Helper to safely extract database name from a PostgreSQL connection string.
 */
function extractDatabaseName(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
    return dbName || null;
  } catch {
    return null;
  }
}

/**
 * Validates the provided environment map with actionable, sanitized error reporting.
 * Explicitly excludes secret values from the output to prevent log leakage.
 */
export function validateEnv(
  source: Record<string, string | undefined> = process.env
): AppEnv {
  if (typeof window !== 'undefined') {
    throw new Error('Environment configuration must never be evaluated in client-side code.');
  }

  const effectiveSource = { ...source };
  const nodeEnv = effectiveSource.NODE_ENV || 'development';
  const isTest = nodeEnv === 'test';
  const isCI = effectiveSource.CI === 'true' || process.env.CI === 'true';

  // In test mode: TEST_DATABASE_URL is strictly required; operational DATABASE_URL fallback is forbidden.
  if (isTest) {
    if (!effectiveSource.TEST_DATABASE_URL) {
      throw new EnvironmentValidationError(
        'Environment validation failed.\nMissing required environment variable(s): TEST_DATABASE_URL\nIn test mode (NODE_ENV=test), TEST_DATABASE_URL is strictly required and must not fall back to operational DATABASE_URL.\nConsult .env.example for required configuration. Secret values are redacted.',
        ['TEST_DATABASE_URL'],
        []
      );
    }

    // Verify test target is distinct from operational database
    const testDbName = extractDatabaseName(effectiveSource.TEST_DATABASE_URL);
    const devDbName = effectiveSource.DATABASE_URL
      ? extractDatabaseName(effectiveSource.DATABASE_URL)
      : null;

    // In local non-CI environment, ensure TEST_DATABASE_URL does not target the same database as DATABASE_URL
    if (!isCI && (testDbName === 'lawoffice_dev' || (devDbName && testDbName === devDbName))) {
      throw new EnvironmentValidationError(
        `Environment validation failed.\nInvalid environment variable(s): TEST_DATABASE_URL\nTEST_DATABASE_URL must not target the operational/development database ('${testDbName || 'unknown'}').\nConsult .env.example for required configuration. Secret values are redacted.`,
        [],
        ['TEST_DATABASE_URL']
      );
    }

    if (!testDbName || (!testDbName.endsWith('_test') && testDbName !== 'lawoffice_test')) {
      throw new EnvironmentValidationError(
        `Environment validation failed.\nInvalid environment variable(s): TEST_DATABASE_URL\nTEST_DATABASE_URL must point to a dedicated test database (e.g. ending in _test, such as lawoffice_test), but received database '${testDbName || 'unknown'}'.\nConsult .env.example for required configuration. Secret values are redacted.`,
        [],
        ['TEST_DATABASE_URL']
      );
    }

    // In test mode, effective DATABASE_URL for all database connections is TEST_DATABASE_URL
    effectiveSource.DATABASE_URL = effectiveSource.TEST_DATABASE_URL;
  }

  const result = baseEnvSchema.safeParse(effectiveSource);

  if (!result.success) {
    const missingKeys: string[] = [];
    const invalidKeys: string[] = [];

    for (const issue of result.error.issues) {
      const key = issue.path.join('.');
      if (effectiveSource[key] === undefined) {
        missingKeys.push(key);
      } else {
        invalidKeys.push(key);
      }
    }

    const errorDetails: string[] = [];
    if (missingKeys.length > 0) {
      errorDetails.push(`Missing required environment variable(s): ${missingKeys.join(', ')}`);
    }
    if (invalidKeys.length > 0) {
      errorDetails.push(`Invalid environment variable(s): ${invalidKeys.join(', ')}`);
    }

    const message = [
      'Environment validation failed.',
      ...errorDetails,
      'Consult .env.example for required configuration. Secret values are redacted.',
    ].join('\n');

    throw new EnvironmentValidationError(message, missingKeys, invalidKeys);
  }

  return result.data;
}

let cachedEnv: AppEnv | null = null;

/**
 * Retrieves the validated application environment.
 * Validates once and caches the result for process lifetime, or revalidates if reload is requested.
 */
export function getEnv(reload = false): AppEnv {
  if (!cachedEnv || reload) {
    cachedEnv = validateEnv(process.env);
  }
  return cachedEnv;
}

/**
 * Supported runtime-startup validation boundary.
 * Called at server bootstrap (or instrumentation) to ensure missing/invalid required configuration
 * fails fast with actionable sanitized error reporting.
 */
export function validateStartupEnv(): AppEnv {
  return validateEnv(process.env);
}
