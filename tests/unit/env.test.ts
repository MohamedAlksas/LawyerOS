import { describe, it, expect } from 'vitest';
import {
  validateEnv,
  validateStartupEnv,
  EnvironmentValidationError,
  validatePostgresUrlStructure,
  extractNormalizedDbIdentity,
  areDatabaseIdentitiesEqual,
} from '@/lib/env';

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

  it('rejects equivalent URL-encoded database target aliases (R09)', () => {
    const encodedTargetEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_test',
      TEST_DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/law%6fffice_test',
      CI: 'false',
    };

    expect(() => validateEnv(encodedTargetEnv)).toThrowError(EnvironmentValidationError);

    try {
      validateEnv(encodedTargetEnv);
    } catch (error) {
      const err = error as EnvironmentValidationError;
      expect(err.invalidKeys).toContain('TEST_DATABASE_URL');
      expect(err.message).toContain('TEST_DATABASE_URL must not target the operational/development database');
    }
  });

  it('strictly rejects identical operational target even when CI=true (R09)', () => {
    const identicalCiEnv = {
      NODE_ENV: 'test',
      CI: 'true',
      DATABASE_URL: 'postgresql://lawoffice_user:secret@localhost:5432/lawoffice_test?schema=public',
      TEST_DATABASE_URL: 'postgresql://lawoffice_user:secret@localhost:5432/lawoffice_test?schema=public',
    };

    expect(() => validateEnv(identicalCiEnv)).toThrowError(EnvironmentValidationError);
  });

  it('permits clean test-only configuration in CI without requiring dummy operational URL (R09)', () => {
    const testOnlyCiEnv = {
      NODE_ENV: 'test',
      CI: 'true',
      TEST_DATABASE_URL: 'postgresql://lawoffice_user:secret@localhost:5432/lawoffice_test?schema=public',
    };

    const validated = validateEnv(testOnlyCiEnv);
    expect(validated.NODE_ENV).toBe('test');
    expect(validated.DATABASE_URL).toContain('lawoffice_test');
    expect(validated.TEST_DATABASE_URL).toContain('lawoffice_test');
  });

  it('respects explicit source.CI=false even when ambient process.env.CI is true (R11)', () => {
    const originalAmbientCi = process.env.CI;
    try {
      process.env.CI = 'true'; // Simulate hosted GitHub Actions environment

      const explicitSourceEnv = {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_dev',
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_dev',
        CI: 'false', // Explicitly requested false
      };

      expect(() => validateEnv(explicitSourceEnv)).toThrowError(EnvironmentValidationError);

      try {
        validateEnv(explicitSourceEnv);
      } catch (error) {
        const err = error as EnvironmentValidationError;
        expect(err.invalidKeys).toContain('TEST_DATABASE_URL');
        expect(err.message).toContain('must not target the operational/development database');
      }
    } finally {
      process.env.CI = originalAmbientCi;
    }
  });

  it('rejects bare postgresql:// without host or database path (R12)', () => {
    const bareProtocolEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://',
    };

    expect(() => validateEnv(bareProtocolEnv)).toThrowError(EnvironmentValidationError);

    try {
      validateEnv(bareProtocolEnv);
    } catch (error) {
      const err = error as EnvironmentValidationError;
      expect(err.invalidKeys).toContain('DATABASE_URL');
      expect(err.message).toContain('PostgreSQL connection string must include a valid host');
    }
  });

  it('rejects PostgreSQL connection strings with missing database name or malformed encoding (R12)', () => {
    const missingDbEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://127.0.0.1:5432/',
    };

    expect(() => validateEnv(missingDbEnv)).toThrowError(EnvironmentValidationError);

    const malformedPercentEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://127.0.0.1:5432/invalid_%zz_db',
    };

    expect(() => validateEnv(malformedPercentEnv)).toThrowError(EnvironmentValidationError);
  });

  it('fails fast and redacts secrets when validateStartupEnv encounters invalid configuration (R12)', () => {
    const originalEnv = { ...process.env };
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://lawoffice_user:super_secret_password_999@127.0.0.1:5432/';

      expect(() => validateStartupEnv()).toThrowError(EnvironmentValidationError);

      try {
        validateStartupEnv();
      } catch (error) {
        const err = error as EnvironmentValidationError;
        expect(err.invalidKeys).toContain('DATABASE_URL');
        expect(err.message).not.toContain('super_secret_password_999');
      }
    } finally {
      process.env = { ...originalEnv };
    }
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

  it('provides validateStartupEnv boundary helper (R05, R12)', () => {
    expect(typeof validateStartupEnv).toBe('function');
  });

  describe('Driver-effective routing and ambiguous input rejection (R16)', () => {
    const operationalTarget = 'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test';

    it('rejects test URL using authority port 65432 with ?port=5432 overriding to operational port', () => {
      const testUrlWithQueryPort = 'postgresql://synthetic:synthetic@127.0.0.1:65432/lawoffice_test?port=5432';

      // 1. Structural validation rejects routing override query parameters before connection
      const structCheck = validatePostgresUrlStructure(testUrlWithQueryPort);
      expect(structCheck.valid).toBe(false);
      expect(structCheck.error).toContain('must not use query parameters to override host or port routing');

      // 2. Identity extraction accurately derives driver-effective port matching installed pg
      const operationalId = extractNormalizedDbIdentity(operationalTarget);
      const testId = extractNormalizedDbIdentity(testUrlWithQueryPort);
      expect(testId?.port).toBe('5432');
      expect(operationalId?.port).toBe('5432');
      expect(areDatabaseIdentitiesEqual(operationalTarget, testUrlWithQueryPort)).toBe(true);

      // 3. validateEnv rejects before connection
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          DATABASE_URL: operationalTarget,
          TEST_DATABASE_URL: testUrlWithQueryPort,
          CI: 'false',
        })
      ).toThrowError(EnvironmentValidationError);
    });

    it('rejects test URL using authority host unused.invalid with ?host=127.0.0.1 overriding to operational host', () => {
      const testUrlWithQueryHost = 'postgresql://synthetic:synthetic@unused.invalid:5432/lawoffice_test?host=127.0.0.1';

      // 1. Structural validation rejects routing override query parameters before connection
      const structCheck = validatePostgresUrlStructure(testUrlWithQueryHost);
      expect(structCheck.valid).toBe(false);
      expect(structCheck.error).toContain('must not use query parameters to override host or port routing');

      // 2. Identity extraction accurately derives driver-effective host matching installed pg
      const operationalId = extractNormalizedDbIdentity(operationalTarget);
      const testId = extractNormalizedDbIdentity(testUrlWithQueryHost);
      expect(testId?.host).toBe('127.0.0.1');
      expect(operationalId?.host).toBe('127.0.0.1');
      expect(areDatabaseIdentitiesEqual(operationalTarget, testUrlWithQueryHost)).toBe(true);

      // 3. validateEnv rejects before connection
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          DATABASE_URL: operationalTarget,
          TEST_DATABASE_URL: testUrlWithQueryHost,
          CI: 'false',
        })
      ).toThrowError(EnvironmentValidationError);
    });

    it('recognizes reserved character path encoding /%3F_test vs /%253F_test as driver-equivalent database targets', () => {
      const url1 = 'postgresql://synthetic:synthetic@127.0.0.1:5432/%3F_test';
      const url2 = 'postgresql://synthetic:synthetic@127.0.0.1:5432/%253F_test';

      // Both match installed pg (pg-connection-string) decodeURI database resolution
      const id1 = extractNormalizedDbIdentity(url1);
      const id2 = extractNormalizedDbIdentity(url2);
      expect(id1?.database).toBe('%3F_test');
      expect(id2?.database).toBe('%3F_test');
      expect(areDatabaseIdentitiesEqual(url1, url2)).toBe(true);

      // validateEnv rejects TEST_DATABASE_URL targeting DATABASE_URL across percent-encoding aliases
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          DATABASE_URL: url1,
          TEST_DATABASE_URL: url2,
          CI: 'false',
        })
      ).toThrowError(EnvironmentValidationError);
    });

    it('permits normal documented query parameters such as ?schema=public and ?sslmode=disable', () => {
      const validDocumentedUrl =
        'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test?schema=public&sslmode=disable';

      const structCheck = validatePostgresUrlStructure(validDocumentedUrl);
      expect(structCheck.valid).toBe(true);

      const identity = extractNormalizedDbIdentity(validDocumentedUrl);
      expect(identity).toEqual({
        host: '127.0.0.1',
        port: '5432',
        database: 'lawoffice_test',
      });

      const validated = validateEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_dev?schema=public',
        TEST_DATABASE_URL: validDocumentedUrl,
        CI: 'false',
      });
      expect(validated.TEST_DATABASE_URL).toBe(validDocumentedUrl);
    });
  });
});
