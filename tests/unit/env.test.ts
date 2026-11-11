import { describe, it, expect } from 'vitest';
import { validateEnv, validateStartupEnv, EnvironmentValidationError } from '@/lib/env';

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

  it('fails with actionable, sanitized error when DATABASE_URL is missing in development', () => {
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
      // Must redact secret password
      expect(err.message).not.toContain('secret_password');
    }
  });

  it('strictly requires TEST_DATABASE_URL in test mode and refuses fallback to operational DATABASE_URL (R02)', () => {
    const testEnvWithoutTestDb = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://lawoffice_user:operational_secret@127.0.0.1:5432/lawoffice_dev?schema=public',
    };

    expect(() => validateEnv(testEnvWithoutTestDb)).toThrowError(EnvironmentValidationError);

    try {
      validateEnv(testEnvWithoutTestDb);
    } catch (error) {
      const err = error as EnvironmentValidationError;
      expect(err.missingKeys).toContain('TEST_DATABASE_URL');
      expect(err.message).toContain('TEST_DATABASE_URL is strictly required');
      expect(err.message).toContain('must not fall back to operational DATABASE_URL');
      expect(err.message).not.toContain('operational_secret');
    }
  });

  it('rejects TEST_DATABASE_URL when targeting development/operational database (R02)', () => {
    const testEnvTargetingDev = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_dev',
      TEST_DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_dev',
      CI: 'false',
    };

    expect(() => validateEnv(testEnvTargetingDev)).toThrowError(EnvironmentValidationError);

    try {
      validateEnv(testEnvTargetingDev);
    } catch (error) {
      const err = error as EnvironmentValidationError;
      expect(err.invalidKeys).toContain('TEST_DATABASE_URL');
      expect(err.message).toContain('must not target the operational/development database');
    }
  });

  it('rejects TEST_DATABASE_URL when database name does not end in _test (R02)', () => {
    const testEnvArbitraryDb = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_dev',
      TEST_DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5433/production_backup',
      CI: 'false',
    };

    expect(() => validateEnv(testEnvArbitraryDb)).toThrowError(EnvironmentValidationError);

    try {
      validateEnv(testEnvArbitraryDb);
    } catch (error) {
      const err = error as EnvironmentValidationError;
      expect(err.invalidKeys).toContain('TEST_DATABASE_URL');
      expect(err.message).toContain('dedicated test database (e.g. ending in _test');
    }
  });

  it('permits disposable test database in CI environment where CI=true (R02)', () => {
    const ciEnv = {
      NODE_ENV: 'test',
      CI: 'true',
      DATABASE_URL: 'postgresql://lawoffice_user:secret@localhost:5432/lawoffice_test?schema=public',
      TEST_DATABASE_URL: 'postgresql://lawoffice_user:secret@localhost:5432/lawoffice_test?schema=public',
    };

    const validated = validateEnv(ciEnv);
    expect(validated.NODE_ENV).toBe('test');
    expect(validated.DATABASE_URL).toContain('lawoffice_test');
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

  it('provides validateStartupEnv boundary helper (R05)', () => {
    expect(typeof validateStartupEnv).toBe('function');
  });
});
