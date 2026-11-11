import { describe, it, expect } from 'vitest';
import { validateEnv, EnvironmentValidationError } from '@/lib/env';

describe('Environment validation (src/lib/env.ts)', () => {
  const validSyntheticEnv = {
    NODE_ENV: 'development',
    PORT: '3000',
    HOST: '127.0.0.1',
    DATABASE_URL: 'postgresql://lawoffice_user:synthetic_dev_secret@127.0.0.1:5432/lawoffice_dev?schema=public',
    TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic_dev_secret@127.0.0.1:5433/lawoffice_test?schema=public',
  };

  it('successfully validates a well-formed synthetic environment matching .env.example', () => {
    const validated = validateEnv(validSyntheticEnv);
    expect(validated.NODE_ENV).toBe('development');
    expect(validated.PORT).toBe(3000);
    expect(validated.HOST).toBe('127.0.0.1');
    expect(validated.DATABASE_URL).toContain('lawoffice_dev');
  });

  it('fails with actionable, sanitized error when DATABASE_URL is missing', () => {
    const envMissingDb = {
      NODE_ENV: 'development',
      PORT: '3000',
      HOST: '127.0.0.1',
    };

    expect(() => validateEnv(envMissingDb)).toThrowError(EnvironmentValidationError);

    try {
      validateEnv(envMissingDb);
    } catch (error) {
      const err = error as EnvironmentValidationError;
      expect(err.missingKeys).toContain('DATABASE_URL');
      expect(err.message).toContain('Missing required environment variable(s): DATABASE_URL');
      expect(err.message).toContain('Consult .env.example');
      // Must not leak unredacted internals
      expect(err.message).not.toContain('synthetic_dev_secret');
    }
  });

  it('fails with sanitized error when DATABASE_URL has invalid protocol', () => {
    const envInvalidProtocol = {
      ...validSyntheticEnv,
      DATABASE_URL: 'mysql://invalid_user:secret_password@127.0.0.1:3306/db',
    };

    expect(() => validateEnv(envInvalidProtocol)).toThrowError(EnvironmentValidationError);

    try {
      validateEnv(envInvalidProtocol);
    } catch (error) {
      const err = error as EnvironmentValidationError;
      expect(err.invalidKeys).toContain('DATABASE_URL');
      // Must redact the secret password from error message
      expect(err.message).not.toContain('secret_password');
    }
  });

  it('isolates test database when NODE_ENV is test and TEST_DATABASE_URL is provided', () => {
    const testEnv = {
      ...validSyntheticEnv,
      NODE_ENV: 'test',
    };

    const validated = validateEnv(testEnv);
    expect(validated.NODE_ENV).toBe('test');
    // Confirms test database isolation override
    expect(validated.DATABASE_URL).toBe(validSyntheticEnv.TEST_DATABASE_URL);
  });

  it('applies standard defaults for PORT and HOST when omitted', () => {
    const minimalEnv = {
      DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_dev',
    };

    const validated = validateEnv(minimalEnv);
    expect(validated.PORT).toBe(3000);
    expect(validated.HOST).toBe('127.0.0.1');
    expect(validated.NODE_ENV).toBe('development');
  });
});
