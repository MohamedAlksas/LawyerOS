import { z } from 'zod';

/**
 * Validates the raw string syntax of a PostgreSQL connection URL before URL parsing.
 * Enforces a strict supported grammar that avoids triggering the installed driver's
 * whole-string repair branch (which repairs raw spaces and malformed percent escapes by rewriting %25HH).
 */
export function validateRawPostgresUrlSyntax(val: string): { valid: boolean; error?: string } {
  // 1. Reject raw whitespace and ASCII control characters across the complete string
  if (/[\s\u0000-\u001f\u007f]/u.test(val)) {
    return {
      valid: false,
      error: 'PostgreSQL connection string must not contain raw whitespace or control characters; percent-encode special characters (e.g. %20 for spaces)',
    };
  }

  // 2. Reject malformed percent escapes (any % not followed by exactly two hexadecimal digits)
  if (/%(?![0-9A-Fa-f]{2})/u.test(val)) {
    return {
      valid: false,
      error: 'PostgreSQL connection string contains malformed percent-encoding; every % must be followed by two hexadecimal digits',
    };
  }

  return { valid: true };
}

/**
 * Validates the structural integrity of a PostgreSQL connection URL.
 * Checks protocol, presence of host, valid port if specified, and presence of target database.
 * Sanitizes errors so that no credentials or secrets leak.
 */
export function validatePostgresUrlStructure(val: string): { valid: boolean; error?: string } {
  const rawCheck = validateRawPostgresUrlSyntax(val);
  if (!rawCheck.valid) {
    return rawCheck;
  }

  try {
    const parsed = new URL(val);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return {
        valid: false,
        error: 'Must be a valid PostgreSQL connection string starting with postgresql:// or postgres://',
      };
    }
    const host = parsed.hostname;
    if (!host || host.trim().length === 0) {
      return {
        valid: false,
        error: 'PostgreSQL connection string must include a valid host (e.g. 127.0.0.1 or localhost)',
      };
    }

    // Reject percent-encoded hostnames (unsupported/ambiguous host representation)
    if (host.includes('%') && !host.startsWith('[')) {
      return {
        valid: false,
        error: 'PostgreSQL connection string must not use percent-encoded characters in hostname; specify a plain hostname or IP address',
      };
    }

    if (parsed.port) {
      const portNum = Number(parsed.port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return {
          valid: false,
          error: 'PostgreSQL connection string contains an invalid port number',
        };
      }
    }

    // Reject ambiguous routing query overrides (e.g. ?host= or ?port=)
    // Standard URL authority must be used; routing overrides via query string are rejected.
    for (const [key] of parsed.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (lower === 'host' || lower === 'port') {
        return {
          valid: false,
          error: 'PostgreSQL connection string must not use query parameters to override host or port routing; specify host and port in authority',
        };
      }
    }

    const rawPath = parsed.pathname.replace(/^\//, '').split('?')[0];
    if (!rawPath || rawPath.trim().length === 0) {
      return {
        valid: false,
        error: 'PostgreSQL connection string must specify a target database name',
      };
    }
    try {
      decodeURI(rawPath);
    } catch {
      return {
        valid: false,
        error: 'PostgreSQL connection string contains a malformed URL-encoded database name',
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      error: 'Invalid PostgreSQL connection URL structure',
    };
  }
}

export interface NormalizedDbIdentity {
  host: string;
  port: string;
  database: string;
}

/**
 * Safely extracts normalized database connection identity for driver-level equivalence checks.
 * Matches installed pg driver (pg-connection-string) semantics:
 * - Resolves query routing overrides (?host=, ?port=)
 * - Strips IPv6 brackets
 * - Decodes database path using decodeURI (matching pg-connection-string)
 * - Normalizes default port (5432)
 */
export function extractNormalizedDbIdentity(urlStr: string): NormalizedDbIdentity | null {
  const rawCheck = validateRawPostgresUrlSyntax(urlStr);
  if (!rawCheck.valid) {
    return null;
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return null;
    }

    // Driver-effective query parameter resolution matching installed pg-connection-string:
    // pg-connection-string only checks exact lowercase !config.host and !config.port
    const queryHost = parsed.searchParams.get('host') || undefined;
    const queryPort = parsed.searchParams.get('port') || undefined;

    // Decode hostname matching pg-connection-string: decodeURIComponent(hostname)
    const rawHostname = (queryHost || parsed.hostname).replace(/^\[(.+)\]$/, '$1');
    const host = decodeURIComponent(rawHostname).toLowerCase();
    if (!host) return null;

    const port = queryPort || parsed.port || '5432';
    const rawDb = parsed.pathname.replace(/^\//, '').split('?')[0];
    if (!rawDb) return null;

    let database: string;
    try {
      database = decodeURI(rawDb);
    } catch {
      return null;
    }

    return { host, port, database };
  } catch {
    return null;
  }
}

/**
 * Determines whether two database connection URLs resolve to the same database.
 * Driver semantics resolve both localhost and 127.0.0.1 on the same port to the same instance.
 */
export function areDatabaseIdentitiesEqual(url1: string, url2: string): boolean {
  const id1 = extractNormalizedDbIdentity(url1);
  const id2 = extractNormalizedDbIdentity(url2);
  if (!id1 || !id2) return false;

  // Databases must match
  if (id1.database !== id2.database) return false;

  // Ports must match
  if (id1.port !== id2.port) return false;

  // Hosts match or are equivalent loopback aliases
  if (id1.host === id2.host) return true;
  const loopbacks = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (loopbacks.has(id1.host) && loopbacks.has(id2.host)) {
    return true;
  }

  return false;
}

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
    .superRefine((val, ctx) => {
      const check = validatePostgresUrlStructure(val);
      if (!check.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: check.error || 'DATABASE_URL must be a valid PostgreSQL connection string',
        });
      }
    }),
  TEST_DATABASE_URL: z
    .string()
    .superRefine((val, ctx) => {
      const check = validatePostgresUrlStructure(val);
      if (!check.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: check.error || 'TEST_DATABASE_URL must be a valid PostgreSQL connection string',
        });
      }
    })
    .optional(),
  CI: z.string().optional(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
    .default('synthetic_development_secret_32_bytes_minimum_length_required'),
  BETTER_AUTH_URL: z
    .string()
    .url('BETTER_AUTH_URL must be a valid URL')
    .default('http://127.0.0.1:3000'),
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

  // Deterministic CI precedence (R11):
  // When caller explicitly specifies CI in source, that takes precedence over ambient process.env.CI
  if (effectiveSource.CI === undefined && process.env.CI !== undefined) {
    effectiveSource.CI = process.env.CI;
  }

  // In test mode: TEST_DATABASE_URL is strictly required; operational DATABASE_URL fallback is forbidden.
  if (isTest) {
    if (!effectiveSource.TEST_DATABASE_URL) {
      throw new EnvironmentValidationError(
        'Environment validation failed.\nMissing required environment variable(s): TEST_DATABASE_URL\nIn test mode (NODE_ENV=test), TEST_DATABASE_URL is strictly required and must not fall back to operational DATABASE_URL.\nConsult .env.example for required configuration. Secret values are redacted.',
        ['TEST_DATABASE_URL'],
        []
      );
    }
  }


  // Validate operational DATABASE_URL structure upfront if provided (before comparison or test-mode replacement)
  if (effectiveSource.DATABASE_URL) {
    const dbStructure = validatePostgresUrlStructure(effectiveSource.DATABASE_URL);
    if (!dbStructure.valid) {
      throw new EnvironmentValidationError(
        `Environment validation failed.\nInvalid environment variable(s): DATABASE_URL\n${dbStructure.error}\nConsult .env.example for required configuration. Secret values are redacted.`,
        [],
        ['DATABASE_URL']
      );
    }
  }

  if (isTest) {
    // Validate structural validity of TEST_DATABASE_URL before identity checks
    const testStructure = validatePostgresUrlStructure(effectiveSource.TEST_DATABASE_URL!);
    if (!testStructure.valid) {
      throw new EnvironmentValidationError(
        `Environment validation failed.\nInvalid environment variable(s): TEST_DATABASE_URL\n${testStructure.error}\nConsult .env.example for required configuration. Secret values are redacted.`,
        [],
        ['TEST_DATABASE_URL']
      );
    }

    const testIdentity = extractNormalizedDbIdentity(effectiveSource.TEST_DATABASE_URL!);
    const testDbName = testIdentity?.database;

    // Check 1: Ensure TEST_DATABASE_URL does not target operational/development database or match DATABASE_URL (R02, R09)
    if (
      testDbName === 'lawoffice_dev' ||
      testDbName === 'lawoffice_prod' ||
      (effectiveSource.DATABASE_URL &&
        areDatabaseIdentitiesEqual(effectiveSource.TEST_DATABASE_URL!, effectiveSource.DATABASE_URL))
    ) {
      throw new EnvironmentValidationError(
        `Environment validation failed.\nInvalid environment variable(s): TEST_DATABASE_URL\nTEST_DATABASE_URL must not target the operational/development database ('${testDbName || 'unknown'}').\nConsult .env.example for required configuration. Secret values are redacted.`,
        [],
        ['TEST_DATABASE_URL']
      );
    }

    // Check 2: Ensure test database name is a dedicated test database (ending in _test or lawoffice_test)
    if (!testDbName || (!testDbName.endsWith('_test') && testDbName !== 'lawoffice_test')) {
      throw new EnvironmentValidationError(
        `Environment validation failed.\nInvalid environment variable(s): TEST_DATABASE_URL\nTEST_DATABASE_URL must point to a dedicated test database (e.g. ending in _test, such as lawoffice_test), but received database '${testDbName || 'unknown'}'.\nConsult .env.example for required configuration. Secret values are redacted.`,
        [],
        ['TEST_DATABASE_URL']
      );
    }

    // In test mode, effective DATABASE_URL for all database connections is TEST_DATABASE_URL
    effectiveSource.DATABASE_URL = effectiveSource.TEST_DATABASE_URL!;
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
    for (const issue of result.error.issues) {
      if (issue.message && !issue.message.startsWith('Invalid input') && issue.message !== 'Required') {
        errorDetails.push(issue.message);
      }
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
