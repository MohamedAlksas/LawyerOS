import { z } from 'zod';

/**
 * Server-only environment schema for LawOffice OS.
 * Validates presence, formatting, and safety of operational variables.
 */
const envSchema = z.object({
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
});

export type AppEnv = z.infer<typeof envSchema>;

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

  // In test mode, prefer TEST_DATABASE_URL over DATABASE_URL if provided, ensuring test isolation.
  const effectiveSource = { ...source };
  if (effectiveSource.NODE_ENV === 'test' && effectiveSource.TEST_DATABASE_URL) {
    effectiveSource.DATABASE_URL = effectiveSource.TEST_DATABASE_URL;
  }

  const result = envSchema.safeParse(effectiveSource);

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
