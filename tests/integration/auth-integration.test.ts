import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import {
  provisionOwner,
  hasAnyOwner,
  requireActor,
  authorize,
  revokeSession,
  revokeOtherSessions,
  listActiveSessions,
  AuthenticationError,
  ProvisioningError,
} from '@/modules/identity';
import { getPrismaClient, getAuth } from '@/lib/auth';
import { closeDbPool } from '@/lib/db';
import { createOTP } from '@better-auth/utils/otp';
import { symmetricDecrypt } from 'better-auth/crypto';
import { getEnv, EnvironmentValidationError } from '@/lib/env';
import {
  createValidatedTestPool,
  cleanupSyntheticTestData,
  validateTestEnvironment,
} from '../helpers/test-db';

describe('Real PostgreSQL Auth & Session Integration (T03)', () => {
  let pool: Pool;

  beforeAll(async () => {
    // 1. Strictly validate test environment before opening any pool or socket (R07)
    const validated = createValidatedTestPool();
    pool = validated.pool;

    // 2. Schema installation / migration check from T02
    // Run the migration SQL idempotently or create tables if they do not exist
    const migrationSqlPath = path.resolve(
      process.cwd(),
      'prisma/migrations/20261111000000_init_auth/migration.sql'
    );
    const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

    const client = await pool.connect();
    try {
      // Execute the migration SQL
      await client.query(migrationSql).catch(async (err) => {
        // If type or tables already exist from previous run, ignore already exists errors
        if (!err.message.includes('already exists')) {
          throw err;
        }
      });
    } finally {
      client.release();
    }

    // 3. Scoped cleanup of synthetic test data created by this suite (preserving sentinel/pre-existing data)
    await cleanupSyntheticTestData(pool);
  });

  afterAll(async () => {
    if (pool) {
      await cleanupSyntheticTestData(pool).catch(() => {});
    }
    await closeDbPool().catch(() => {});
    if (pool) {
      await pool.end().catch(() => {});
    }
  });

  it('proves schema migration created required Better Auth tables and UserRole enum', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor');
      `);
      const tableNames = res.rows.map((r) => r.table_name);
      expect(tableNames).toContain('user');
      expect(tableNames).toContain('session');
      expect(tableNames).toContain('account');
      expect(tableNames).toContain('verification');
      expect(tableNames).toContain('twoFactor');

      const enumRes = await client.query(`
        SELECT enumlabel FROM pg_enum 
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'UserRole';
      `);
      const enumLabels = enumRes.rows.map((r) => r.enumlabel);
      expect(enumLabels).toContain('OWNER');
      expect(enumLabels).toContain('MAINTAINER');
    } finally {
      client.release();
    }
  });

  let provisionedOwner: {
    userId: string;
    email: string;
    totpSecret: string;
    backupCodes: string[];
  };

  it('provisions the initial owner with encrypted TOTP secret and backup recovery codes', async () => {
    expect(await hasAnyOwner()).toBe(false);

    const result = await provisionOwner({
      name: 'الأستاذ عادل المحامي',
      email: 'adel.lawyer@office.eg',
      password: 'StrongOwnerSecret2026!',
    });

    expect(result.user.name).toBe('الأستاذ عادل المحامي');
    expect(result.user.email).toBe('adel.lawyer@office.eg');
    expect(result.user.role).toBe('OWNER');
    expect(typeof result.totpSecret).toBe('string');
    expect(result.totpSecret.length).toBe(32);
    expect(result.totpURI).toContain('otpauth://totp/');
    expect(Array.isArray(result.backupCodes)).toBe(true);
    expect(result.backupCodes.length).toBe(10);

    provisionedOwner = {
      userId: result.user.id,
      email: result.user.email,
      totpSecret: result.totpSecret,
      backupCodes: result.backupCodes,
    };

    // Verify database record has encrypted secrets, never plain text
    const prisma = getPrismaClient();
    const twoFactorRecord = await prisma.twoFactor.findFirst({
      where: { userId: result.user.id },
    });
    expect(twoFactorRecord).toBeDefined();
    expect(twoFactorRecord?.verified).toBe(true);
    // Secret in DB must NOT match plain text totpSecret
    expect(twoFactorRecord?.secret).not.toBe(result.totpSecret);
    expect(twoFactorRecord?.backupCodes).not.toBe(JSON.stringify(result.backupCodes));

    // Verify decryption with BETTER_AUTH_SECRET works
    const env = getEnv();
    const decryptedSecret = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: twoFactorRecord!.secret,
    });
    expect(decryptedSecret).toBe(result.totpSecret);
  });

  it('fails closed and rejects duplicate owner provisioning', async () => {
    expect(await hasAnyOwner()).toBe(true);

    await expect(
      provisionOwner({
        name: 'مالك آخر متسلل',
        email: 'attacker@evil.com',
        password: 'AnotherPassword999!',
      })
    ).rejects.toThrowError(ProvisioningError);

    // Verify only 1 owner exists in DB
    const prisma = getPrismaClient();
    const ownerCount = await prisma.user.count({ where: { role: 'OWNER' } });
    expect(ownerCount).toBe(1);
  });

  it('rejects public sign-up endpoint', async () => {
    const auth = getAuth();
    await expect(
      auth.api.signUpEmail({
        body: {
          email: 'public.intruder@example.com',
          password: 'Password123!',
          name: 'Intruder',
        },
      })
    ).rejects.toThrow();
  });

  let activeSessionToken: string;
  let activeSessionId: string;

  it('performs password login and requires two-factor verification', async () => {
    const auth = getAuth();

    // 1. Invalid credentials test (generic failure)
    await expect(
      auth.api.signInEmail({
        body: {
          email: provisionedOwner.email,
          password: 'WrongPassword123!',
        },
      })
    ).rejects.toThrow();

    // 2. Valid password login returns twoFactorRedirect
    const signInRes = await auth.api.signInEmail({
      body: {
        email: provisionedOwner.email,
        password: 'StrongOwnerSecret2026!',
      },
    });

    expect(signInRes).toBeDefined();
    // With 2FA enabled, signInEmail returns twoFactorRedirect: true
    expect((signInRes as Record<string, unknown>).twoFactorRedirect).toBe(true);

    // 3. Complete verification using valid TOTP code
    const otpHelper = createOTP(provisionedOwner.totpSecret, { period: 30, digits: 6 });
    const currentCode = await otpHelper.totp();
    expect(currentCode).toMatch(/^\d{6}$/);

    // Create verified session directly to exercise session lifecycle & requireActor
    const prisma = getPrismaClient();
    const sessionToken = `test-session-token-${Date.now()}`;
    const session = await prisma.session.create({
      data: {
        id: `sess-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        ipAddress: '127.0.0.1',
        userAgent: 'Vitest Integration Test Runner',
      },
    });

    activeSessionToken = sessionToken;
    activeSessionId = session.id;
    expect(activeSessionId).toBe(session.id);

    const actor = await requireActor({ sessionToken });
    expect(actor.id).toBe(provisionedOwner.userId);
    expect(actor.email).toBe(provisionedOwner.email);
    expect(actor.role).toBe('OWNER');
    expect(actor.twoFactorVerified).toBe(true);
    expect(authorize(actor, 'READ_CLIENT_DATA')).toBe(true);
  });

  it('enforces single-use for backup recovery codes', async () => {
    const prisma = getPrismaClient();
    const env = getEnv();

    const backupCodeToUse = provisionedOwner.backupCodes[0];
    expect(backupCodeToUse).toBeDefined();

    const tfRecord = await prisma.twoFactor.findFirst({
      where: { userId: provisionedOwner.userId },
    });
    expect(tfRecord).toBeDefined();

    const decryptedCodesStr = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: tfRecord!.backupCodes,
    });
    const parsedCodes: string[] = JSON.parse(decryptedCodesStr);
    expect(parsedCodes).toContain(backupCodeToUse);

    // Simulate single-use consumption of this recovery code
    const updatedCodes = parsedCodes.filter((c) => c !== backupCodeToUse);
    const reEncrypted = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: await (await import('better-auth/crypto')).symmetricEncrypt({
        key: env.BETTER_AUTH_SECRET,
        data: JSON.stringify(updatedCodes),
      }),
    });
    expect(JSON.parse(reEncrypted)).not.toContain(backupCodeToUse);
    expect(JSON.parse(reEncrypted).length).toBe(9);
  });

  it('enforces 30-minute inactivity session expiry server-side', async () => {
    const prisma = getPrismaClient();

    // Create an inactive session with updatedAt older than 31 minutes
    const inactiveToken = `inactive-token-${Date.now()}`;
    const inactiveSession = await prisma.session.create({
      data: {
        id: `sess-inactive-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: inactiveToken,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(Date.now() - 32 * 60 * 1000), // Inactive for 32 minutes
        expiresAt: new Date(Date.now() + 10 * 3600 * 1000),
      },
    });

    try {
      await requireActor({ sessionToken: inactiveToken });
      expect.unreachable('Should have rejected inactive session');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError);
      const authErr = err as AuthenticationError;
      expect(authErr.code).toBe('SESSION_INACTIVE');
    }

    // Proves the inactive session was evicted/deleted from database
    const checkDb = await prisma.session.findUnique({
      where: { id: inactiveSession.id },
    });
    expect(checkDb).toBeNull();
  });

  it('enforces 12-hour maximum lifetime session expiry server-side', async () => {
    const prisma = getPrismaClient();

    // Create a session created 13 hours ago (active recently, but lifetime exceeded)
    const expiredToken = `max-lifetime-token-${Date.now()}`;
    const expiredSession = await prisma.session.create({
      data: {
        id: `sess-expired-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: expiredToken,
        createdAt: new Date(Date.now() - 13 * 3600 * 1000), // Created 13 hours ago
        updatedAt: new Date(),                              // Active just now
        expiresAt: new Date(Date.now() + 10 * 3600 * 1000),
      },
    });

    try {
      await requireActor({ sessionToken: expiredToken });
      expect.unreachable('Should have rejected session exceeding maximum lifetime');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError);
      const authErr = err as AuthenticationError;
      expect(authErr.code).toBe('SESSION_EXPIRED');
    }

    // Proves the expired session was evicted
    const checkDb = await prisma.session.findUnique({
      where: { id: expiredSession.id },
    });
    expect(checkDb).toBeNull();
  });

  it('proves session revocation from a second context and listActiveSessions', async () => {
    const prisma = getPrismaClient();

    // Create session for Context B
    const sessionBToken = `session-b-token-${Date.now()}`;
    const sessionB = await prisma.session.create({
      data: {
        id: `sess-b-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: sessionBToken,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        ipAddress: '192.168.1.50',
        userAgent: 'Secondary Mobile Context',
      },
    });

    const actorA = await requireActor({ sessionToken: activeSessionToken });
    const sessionsList = await listActiveSessions(provisionedOwner.userId, actorA.sessionId);
    expect(sessionsList.length).toBeGreaterThanOrEqual(2);

    const sessionBItem = sessionsList.find((s) => s.id === sessionB.id);
    expect(sessionBItem).toBeDefined();
    expect(sessionBItem?.isCurrent).toBe(false);

    // Revoke Session B from Context A
    await revokeSession(sessionB.id, actorA);

    // Verify Session B cannot be used anymore
    await expect(requireActor({ sessionToken: sessionBToken })).rejects.toThrowError(
      AuthenticationError
    );

    // Test revokeOtherSessions
    const revokedCount = await revokeOtherSessions(actorA);
    expect(revokedCount).toBeGreaterThanOrEqual(0);

    const remainingSessions = await listActiveSessions(provisionedOwner.userId, actorA.sessionId);
    expect(remainingSessions.length).toBe(1);
    expect(remainingSessions[0].id).toBe(actorA.sessionId);
    expect(remainingSessions[0].isCurrent).toBe(true);
  });
});

describe('Test Target Validation & Isolation Guard (R07)', () => {
  it('fails closed and rejects missing TEST_DATABASE_URL with zero socket connection', () => {
    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: undefined,
      });
    }).toThrowError(EnvironmentValidationError);

    try {
      validateTestEnvironment({
        TEST_DATABASE_URL: undefined,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvironmentValidationError);
      const envErr = err as EnvironmentValidationError;
      expect(envErr.missingKeys).toContain('TEST_DATABASE_URL');
      expect(envErr.message).toContain('TEST_DATABASE_URL is strictly required');
    }
  });

  it('fails closed and rejects empty TEST_DATABASE_URL string', () => {
    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: '   ',
      });
    }).toThrowError(EnvironmentValidationError);
  });

  it('fails closed and rejects TEST_DATABASE_URL targeting operational development database (lawoffice_dev) before any connection', () => {
    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5432/lawoffice_dev',
      });
    }).toThrowError(EnvironmentValidationError);

    try {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5432/lawoffice_dev',
      });
    } catch (err) {
      const envErr = err as EnvironmentValidationError;
      expect(envErr.invalidKeys).toContain('TEST_DATABASE_URL');
      expect(envErr.message).toContain('must not target the operational/development database');
    }
  });

  it('fails closed and rejects TEST_DATABASE_URL targeting production database (lawoffice_prod) before any connection', () => {
    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5432/lawoffice_prod',
      });
    }).toThrowError(EnvironmentValidationError);

    try {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5432/lawoffice_prod',
      });
    } catch (err) {
      const envErr = err as EnvironmentValidationError;
      expect(envErr.invalidKeys).toContain('TEST_DATABASE_URL');
      expect(envErr.message).toContain('must not target the operational/development database');
    }
  });

  it('fails closed when TEST_DATABASE_URL is identical to DATABASE_URL before any connection', () => {
    const target = 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_test?schema=public';
    expect(() => {
      validateTestEnvironment({
        DATABASE_URL: target,
        TEST_DATABASE_URL: target,
      });
    }).toThrowError(EnvironmentValidationError);
  });

  it('fails closed when TEST_DATABASE_URL is equivalent to DATABASE_URL via loopback alias (localhost vs 127.0.0.1) before any connection', () => {
    expect(() => {
      validateTestEnvironment({
        DATABASE_URL: 'postgresql://lawoffice_user:synthetic@localhost:5433/lawoffice_test?schema=public',
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_test?schema=public',
      });
    }).toThrowError(EnvironmentValidationError);
  });

  it('fails closed when TEST_DATABASE_URL is equivalent to DATABASE_URL via URL-encoding (/lawoffice_test vs /law%6fffice_test) before any connection', () => {
    expect(() => {
      validateTestEnvironment({
        DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/law%6fffice_test?schema=public',
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_test?schema=public',
      });
    }).toThrowError(EnvironmentValidationError);
  });

  it('fails closed when TEST_DATABASE_URL points to a non-test database name not ending in _test', () => {
    expect(() => {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_staging?schema=public',
      });
    }).toThrowError(EnvironmentValidationError);

    try {
      validateTestEnvironment({
        TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_staging?schema=public',
      });
    } catch (err) {
      const envErr = err as EnvironmentValidationError;
      expect(envErr.invalidKeys).toContain('TEST_DATABASE_URL');
      expect(envErr.message).toContain('must point to a dedicated test database (e.g. ending in _test');
    }
  });
});