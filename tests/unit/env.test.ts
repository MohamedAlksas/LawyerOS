import { describe, it, expect } from 'vitest';
import { Client } from 'pg';
import {
  validateEnv,
  validateStartupEnv,
  EnvironmentValidationError,
  validatePostgresUrlStructure,
  validateRawPostgresUrlSyntax,
  extractNormalizedDbIdentity,
  areDatabaseIdentitiesEqual,
  parseTrustedProxyIps,
  redactErrorMessage,
} from '@/lib/env';

describe('Environment validation (src/lib/env.ts)', () => {
  const validSyntheticEnv = {
    NODE_ENV: 'development',
    PORT: '3000',
    HOST: '127.0.0.1',
    DATABASE_URL: 'postgresql://lawoffice_user:synthetic_dev_secret@127.0.0.1:5432/lawoffice_dev?schema=public',
    TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic_dev_secret@127.0.0.1:5433/lawoffice_test?schema=public',
    BETTER_AUTH_SECRET: 'synthetic_development_secret_32_bytes_minimum_length_required',
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
      BETTER_AUTH_SECRET: 'synthetic_development_secret_32_bytes_minimum_length_required',
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
      if (originalAmbientCi === undefined) delete process.env.CI;
      else process.env.CI = originalAmbientCi;
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
      BETTER_AUTH_SECRET: 'synthetic_development_secret_32_bytes_minimum_length_required',
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

    it('rejects test URL using percent-encoded hostname 127.0.0.%31 while installed pg resolves to 127.0.0.1', () => {
      const testUrlWithEncodedHost = 'postgresql://synthetic:synthetic@127.0.0.%31:5432/lawoffice_test';

      // 1. Structural validation rejects percent-encoded hostname before connection
      const structCheck = validatePostgresUrlStructure(testUrlWithEncodedHost);
      expect(structCheck.valid).toBe(false);
      expect(structCheck.error).toContain('must not use percent-encoded characters in hostname');

      // 2. Direct driver comparison proves installed pg decodes hostname to 127.0.0.1 without connection
      const clientOp = new Client({ connectionString: operationalTarget }) as unknown as {
        connectionParameters: { host: string; port: number; database: string };
      };
      const clientTest = new Client({ connectionString: testUrlWithEncodedHost }) as unknown as {
        connectionParameters: { host: string; port: number; database: string };
      };
      expect(clientTest.connectionParameters.host).toBe('127.0.0.1');
      expect(clientOp.connectionParameters.host).toBe('127.0.0.1');
      expect(clientTest.connectionParameters.port).toBe(5432);
      expect(clientTest.connectionParameters.database).toBe('lawoffice_test');

      // 3. Identity extraction accurately derives driver-effective host matching installed pg
      const operationalId = extractNormalizedDbIdentity(operationalTarget);
      const testId = extractNormalizedDbIdentity(testUrlWithEncodedHost);
      expect(testId?.host).toBe('127.0.0.1');
      expect(operationalId?.host).toBe('127.0.0.1');
      expect(areDatabaseIdentitiesEqual(operationalTarget, testUrlWithEncodedHost)).toBe(true);

      // 4. validateEnv rejects before connection on either input
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          DATABASE_URL: operationalTarget,
          TEST_DATABASE_URL: testUrlWithEncodedHost,
          CI: 'false',
        })
      ).toThrowError(EnvironmentValidationError);

      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          DATABASE_URL: testUrlWithEncodedHost,
          TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5433/lawoffice_test?schema=public',
          CI: 'false',
        })
      ).toThrowError(EnvironmentValidationError);
    });

    it('rejects uppercase routing query parameter ?HOST=unused.invalid on either input before connection', () => {
      const opUrlWithUpperHost =
        'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test?HOST=unused.invalid';

      // 1. Structural validation rejects routing override query parameters case-insensitively before connection
      const structCheck = validatePostgresUrlStructure(opUrlWithUpperHost);
      expect(structCheck.valid).toBe(false);
      expect(structCheck.error).toContain('must not use query parameters to override host or port routing');

      // 2. Direct driver comparison proves installed pg ignores uppercase HOST for routing without connection
      const clientOp = new Client({ connectionString: opUrlWithUpperHost }) as unknown as {
        connectionParameters: { host: string; port: number; database: string };
      };
      expect(clientOp.connectionParameters.host).toBe('127.0.0.1');
      expect(clientOp.connectionParameters.port).toBe(5432);
      expect(clientOp.connectionParameters.database).toBe('lawoffice_test');

      // 3. validateEnv rejects upfront on DATABASE_URL before comparison or test-mode replacement
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          DATABASE_URL: opUrlWithUpperHost,
          TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5433/lawoffice_test?schema=public',
          CI: 'false',
        })
      ).toThrowError(EnvironmentValidationError);

      // 4. validateEnv rejects upfront on TEST_DATABASE_URL as well
      expect(() =>
        validateEnv({
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_dev?schema=public',
          TEST_DATABASE_URL: opUrlWithUpperHost,
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
        BETTER_AUTH_SECRET: 'synthetic_development_secret_32_bytes_minimum_length_required',
        CI: 'false',
      });
      expect(validated.TEST_DATABASE_URL).toBe(validDocumentedUrl);
    });
  });

  describe('Driver repair branch triggers and raw syntax rejection (R16)', () => {
    const operationalBase = 'postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test';
    const testBase = 'postgresql://synthetic:synthetic@127.0.0.1:5432/law%256fffice_test';

    const repairTriggerCases = [
      {
        description: 'raw ASCII space in query parameter',
        url: `${operationalBase}?application_name=synthetic name`,
        expectedDriverEquivalence: true,
      },
      {
        description: 'non-hex percent escape (%zz) in query parameter',
        url: `${operationalBase}?application_name=%zz`,
        expectedDriverEquivalence: true,
      },
      {
        description: 'mixed non-hex percent escape (%0z) in query parameter',
        url: `${operationalBase}?application_name=%0z`,
        expectedDriverEquivalence: true,
      },
      {
        description: 'fragment with non-hex percent escape (#%zz)',
        url: `${operationalBase}#%zz`,
        expectedDriverEquivalence: true,
      },
      {
        description: 'raw space in credentials',
        url: 'postgresql://synthetic user:synthetic@127.0.0.1:5432/law%6fffice_test',
        expectedDriverEquivalence: true,
      },
      {
        description: 'trailing incomplete percent escape (%)',
        url: `${operationalBase}%`,
        expectedDriverEquivalence: false,
      },
      {
        description: 'trailing single-hex percent escape (%a)',
        url: `${operationalBase}%a`,
        expectedDriverEquivalence: false,
      },
    ];

    it.each(repairTriggerCases)(
      'rejects $description on both original inputs before connection',
      ({ url, expectedDriverEquivalence }) => {
        // 1. Raw syntax validation rejects the raw string
        const rawCheck = validateRawPostgresUrlSyntax(url);
        expect(rawCheck.valid).toBe(false);

        // 2. Structural validation fails closed before URL parsing
        const structCheck = validatePostgresUrlStructure(url);
        expect(structCheck.valid).toBe(false);

        // 3. Normalization helper fails closed and returns null
        expect(extractNormalizedDbIdentity(url)).toBeNull();

        // 4. If driver repair branch applies, verify that installed pg resolves both to database law%6fffice_test without connection
        if (expectedDriverEquivalence) {
          const clientOp = new Client({ connectionString: url }) as unknown as {
            connectionParameters: { host: string; port: number; database: string };
          };
          const clientTest = new Client({ connectionString: testBase }) as unknown as {
            connectionParameters: { host: string; port: number; database: string };
          };
          expect(clientOp.connectionParameters.host).toBe('127.0.0.1');
          expect(clientOp.connectionParameters.port).toBe(5432);
          expect(clientOp.connectionParameters.database).toBe('law%6fffice_test');
          expect(clientTest.connectionParameters.database).toBe('law%6fffice_test');
        }

        // 5. validateEnv rejects upfront when provided as DATABASE_URL
        expect(() =>
          validateEnv({
            NODE_ENV: 'test',
            DATABASE_URL: url,
            TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5433/lawoffice_test?schema=public',
            CI: 'false',
          })
        ).toThrowError(EnvironmentValidationError);

        // 6. validateEnv rejects upfront when provided as TEST_DATABASE_URL
        expect(() =>
          validateEnv({
            NODE_ENV: 'test',
            DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_dev?schema=public',
            TEST_DATABASE_URL: url,
            CI: 'false',
          })
        ).toThrowError(EnvironmentValidationError);
      }
    );

    it('permits properly encoded spaces (%20) and valid %HH sequences', () => {
      const validEncodedUrl =
        'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_test?application_name=synthetic%20name&schema=public';

      expect(validateRawPostgresUrlSyntax(validEncodedUrl).valid).toBe(true);
      expect(validatePostgresUrlStructure(validEncodedUrl).valid).toBe(true);

      const identity = extractNormalizedDbIdentity(validEncodedUrl);
      expect(identity).toEqual({
        host: '127.0.0.1',
        port: '5432',
        database: 'lawoffice_test',
      });

      const validated = validateEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/lawoffice_dev?schema=public',
        TEST_DATABASE_URL: validEncodedUrl,
        BETTER_AUTH_SECRET: 'synthetic_development_secret_32_bytes_minimum_length_required',
        CI: 'false',
      });
      expect(validated.TEST_DATABASE_URL).toBe(validEncodedUrl);
    });

    it('strictly requires BETTER_AUTH_SECRET without falling back to a default (R05)', () => {
      const envWithoutSecret = {
        ...validSyntheticEnv,
        BETTER_AUTH_SECRET: undefined,
      };

      expect(() => validateEnv(envWithoutSecret)).toThrowError(EnvironmentValidationError);
      try {
        validateEnv(envWithoutSecret);
      } catch (err) {
        const error = err as EnvironmentValidationError;
        expect(error.missingKeys).toContain('BETTER_AUTH_SECRET');
        expect(error.message).toContain('Missing required environment variable(s): BETTER_AUTH_SECRET');
      }
    });

    it('rejects BETTER_AUTH_SECRET shorter than 32 characters (R05)', () => {
      const envWithShortSecret = {
        ...validSyntheticEnv,
        BETTER_AUTH_SECRET: 'short_secret_under_32_bytes',
      };

      expect(() => validateEnv(envWithShortSecret)).toThrowError(EnvironmentValidationError);
      try {
        validateEnv(envWithShortSecret);
      } catch (err) {
        const error = err as EnvironmentValidationError;
        expect(error.invalidKeys).toContain('BETTER_AUTH_SECRET');
        expect(error.message).toContain('BETTER_AUTH_SECRET must be at least 32 characters');
        // Ensure secret value is never printed
        expect(error.message).not.toContain('short_secret_under_32_bytes');
      }
    });
  });

  describe('Production BETTER_AUTH_URL hardening', () => {
    const baseProdEnv = {
      NODE_ENV: 'production',
      PORT: '3000',
      HOST: '127.0.0.1',
      DATABASE_URL: 'postgresql://lawoffice_user:synthetic_prod_secret@127.0.0.1:5432/lawoffice_prod?schema=public',
      BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
    };

    it('rejects omitted BETTER_AUTH_URL in production runtime instead of falling back to localhost', () => {
      expect(() => validateEnv(baseProdEnv)).toThrow(EnvironmentValidationError);
      try {
        validateEnv(baseProdEnv);
      } catch (err) {
        expect((err as EnvironmentValidationError).missingKeys).toContain('BETTER_AUTH_URL');
      }
    });

    it('rejects non-loopback http:// BETTER_AUTH_URL in production', () => {
      expect(() =>
        validateEnv({
          ...baseProdEnv,
          BETTER_AUTH_URL: 'http://office.example.com',
        })
      ).toThrow(EnvironmentValidationError);
    });

    it('accepts https:// and loopback http:// BETTER_AUTH_URL in production', () => {
      const httpsEnv = validateEnv({
        ...baseProdEnv,
        BETTER_AUTH_URL: 'https://office.example.com',
      });
      expect(httpsEnv.BETTER_AUTH_URL).toBe('https://office.example.com');

      const loopbackEnv = validateEnv({
        ...baseProdEnv,
        BETTER_AUTH_URL: 'http://127.0.0.1:3000',
      });
      expect(loopbackEnv.BETTER_AUTH_URL).toBe('http://127.0.0.1:3000');
    });

    it('permits omitted BETTER_AUTH_URL only during NEXT_PHASE=phase-production-build', () => {
      const buildEnv = validateEnv({
        ...baseProdEnv,
        NEXT_PHASE: 'phase-production-build',
      });
      expect(buildEnv.BETTER_AUTH_URL).toBe('http://127.0.0.1:3000');
    });

    it('rejects omitted BETTER_AUTH_URL for explicit custom source without NEXT_PHASE even when ambient NEXT_PHASE is phase-production-build', () => {
      const originalAmbientNextPhase = process.env.NEXT_PHASE;
      try {
        process.env.NEXT_PHASE = 'phase-production-build';

        expect(() => validateEnv({ ...baseProdEnv })).toThrow(EnvironmentValidationError);
        try {
          validateEnv({ ...baseProdEnv });
        } catch (err) {
          expect((err as EnvironmentValidationError).missingKeys).toContain('BETTER_AUTH_URL');
        }
      } finally {
        if (originalAmbientNextPhase === undefined) {
          delete process.env.NEXT_PHASE;
        } else {
          process.env.NEXT_PHASE = originalAmbientNextPhase;
        }
      }
    });
  });

  describe('TRUSTED_PROXY_IPS validation and redactErrorMessage path redaction', () => {
    it('accepts valid IPv4/IPv6/CIDR entries and rejects empty tokens, hostnames, and out-of-range CIDR masks', () => {
      const validList = '127.0.0.1, ::1, 10.0.0.0/8, fd00::/8';
      expect(parseTrustedProxyIps(validList)).toEqual([
        '127.0.0.1',
        '::1',
        '10.0.0.0/8',
        'fd00::/8',
      ]);

      const validated = validateEnv({
        ...validSyntheticEnv,
        TRUSTED_PROXY_IPS: validList,
      });
      expect(validated.TRUSTED_PROXY_IPS).toBe(validList);

      for (const invalidValue of ['127.0.0.1,,', 'nginx', '10.0.0.1/33', '::1/129']) {
        expect(() => parseTrustedProxyIps(invalidValue)).toThrowError(EnvironmentValidationError);
        expect(() =>
          validateEnv({
            ...validSyntheticEnv,
            TRUSTED_PROXY_IPS: invalidValue,
          })
        ).toThrowError(EnvironmentValidationError);
      }
    });

    it('redacts Windows and POSIX filesystem paths in redactErrorMessage', () => {
      const winErr = new Error('Failed reading C:\\Users\\foo\\bar.ts during job');
      const winRedacted = redactErrorMessage(winErr);
      expect(winRedacted).toContain('[REDACTED_PATH]');
      expect(winRedacted).not.toContain('C:\\Users\\foo\\bar.ts');

      const posixErr = new Error('Missing file /home/app/secret.txt in worker');
      const posixRedacted = redactErrorMessage(posixErr);
      expect(posixRedacted).toContain('[REDACTED_PATH]');
      expect(posixRedacted).not.toContain('/home/app/secret.txt');
    });
  });
});
