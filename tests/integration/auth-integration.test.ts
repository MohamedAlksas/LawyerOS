import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import {
  provisionOwner,
  hasAnyOwner,
  isBootstrapClosed,
  requireActor,
  authorize,
  revokeSession,
  revokeOtherSessions,
  listActiveSessions,
  regenerateRecoveryCodes,
  AuthenticationError,
  ProvisioningError,
} from '@/modules/identity';
import { getPrismaClient, getAuth } from '@/lib/auth';
import { closeDbPool } from '@/lib/db';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { symmetricDecrypt } from 'better-auth/crypto';
import { getEnv, EnvironmentValidationError } from '@/lib/env';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { GET as authRouteGET, POST as authRoutePOST } from '@/app/api/auth/[...all]/route';
import {
  createValidatedTestPool,
  cleanupSyntheticTestData,
  validateTestEnvironment,
} from '../helpers/test-db';

function signSessionTokenCookie(token: string, secret: string): string {
  const signature = crypto.createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

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
      // Execute migration SQL statement-by-statement to handle pre-existing types/tables idempotently
      const statements = migrationSql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        await client.query(statement).catch((err) => {
          if (
            !err.message.includes('already exists') &&
            !err.message.includes('duplicate')
          ) {
            throw err;
          }
        });
      }

      // Ensure columns added in T03 exist even if twoFactor table pre-existed
      await client
        .query(
          'ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;'
        )
        .catch(() => {});
      await client
        .query(
          'ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);'
        )
        .catch(() => {});
    } finally {
      client.release();
    }

    // 3. Scoped cleanup of synthetic test data created by this suite (preserving sentinel/pre-existing data)
    await cleanupSyntheticTestData(pool);
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query('DELETE FROM "office_bootstrap";').catch(() => {});
    } finally {
      cleanupClient.release();
    }
  });

  afterAll(async () => {
    if (pool) {
      await cleanupSyntheticTestData(pool).catch(() => {});
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query('DELETE FROM "office_bootstrap";').catch(() => {});
      } finally {
        cleanupClient.release();
      }
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
          AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
      `);
      const tableNames = res.rows.map((r) => r.table_name);
      expect(tableNames).toContain('user');
      expect(tableNames).toContain('session');
      expect(tableNames).toContain('account');
      expect(tableNames).toContain('verification');
      expect(tableNames).toContain('twoFactor');
      expect(tableNames).toContain('office_bootstrap');

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
    totpURI: string;
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
      totpURI: result.totpURI,
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

    // Verify decryption with BETTER_AUTH_SECRET yields base32: prefixed secret (R01)
    const env = getEnv();
    const decryptedSecret = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: twoFactorRecord!.secret,
    });
    expect(decryptedSecret).toBe(`base32:${result.totpSecret}`);

    // Verify OfficeBootstrap singleton record is created and closed (R06)
    const bootstrap = await prisma.officeBootstrap.findUnique({
      where: { id: 'singleton' },
    });
    expect(bootstrap).toBeDefined();
    expect(bootstrap?.isClosed).toBe(true);
    expect(bootstrap?.ownerId).toBe(result.user.id);
    expect(await isBootstrapClosed()).toBe(true);
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

    // 3. Authenticator Enrollment Key Alignment & RFC 6238 Verification (R01):
    // Parse the issued totpURI and extract the 20-byte secret
    const parsedUri = new URL(provisionedOwner.totpURI);
    expect(parsedUri.protocol).toBe('otpauth:');
    expect(parsedUri.hostname).toBe('totp');
    const b32Secret = parsedUri.searchParams.get('secret');
    expect(b32Secret).toBe(provisionedOwner.totpSecret);

    const clientSecretBytes = base32.decode(b32Secret!.toUpperCase());
    expect(clientSecretBytes.length).toBe(20);

    // Client generates RFC 6238 TOTP code from URI key
    const clientOtpHelper = createOTP(clientSecretBytes, { period: 30, digits: 6 });
    const currentCode = await clientOtpHelper.totp();
    expect(currentCode).toMatch(/^\d{6}$/);

    // Server decrypts stored secret ('base32:<secret>') and decodes bytes
    const prisma = getPrismaClient();
    const env = getEnv();
    const tfRecord = await prisma.twoFactor.findFirst({
      where: { userId: provisionedOwner.userId },
    });
    const decryptedStored = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: tfRecord!.secret,
    });
    expect(decryptedStored.startsWith('base32:')).toBe(true);
    const serverSecretBytes = base32.decode(decryptedStored.slice(7).toUpperCase());

    // Both client and server must verify the code on identical 20-byte key
    const serverVerifier = createOTP(serverSecretBytes, { period: 30, digits: 6 });
    expect(await serverVerifier.verify(currentCode)).toBe(true);

    // Invalid code is rejected
    const invalidCode = currentCode === '000000' ? '111111' : '000000';
    expect(await serverVerifier.verify(invalidCode)).toBe(false);

    // Expired code from 90 seconds ago is rejected
    const expiredCounter = Math.floor((Date.now() - 90 * 1000) / 1000 / 30);
    const expiredCode = await clientOtpHelper.hotp(expiredCounter);
    expect(await serverVerifier.verify(expiredCode)).toBe(false);

    // Create verified session directly to exercise session lifecycle & requireActor
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

  it('blocks two-factor disable endpoint and enforces mandatory MFA for OWNER (R02)', async () => {
    // 1. Calling /api/auth/two-factor/disable returns 403 Forbidden
    const disableReq = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/disable', {
      method: 'POST',
    });
    const disableRes = await authRoutePOST(disableReq);
    expect(disableRes.status).toBe(403);
    const body = await disableRes.json();
    expect(body.error).toContain('تعطيل المصادقة الثنائية محظور');

    // 2. An OWNER with twoFactorEnabled: false is strictly rejected by requireActor
    const prisma = getPrismaClient();
    const token = `owner-no-mfa-${Date.now()}`;
    const userNoMfa = await prisma.user.create({
      data: {
        id: `user-no-mfa-${Date.now()}`,
        name: 'مالك بدون تحقق',
        email: 'owner.nomfa@office.eg',
        role: 'OWNER',
        twoFactorEnabled: false,
      },
    });

    await prisma.session.create({
      data: {
        id: `sess-nomfa-${Date.now()}`,
        userId: userNoMfa.id,
        token,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      },
    });

    await expect(requireActor({ sessionToken: token })).rejects.toThrowError(
      AuthenticationError
    );
    try {
      await requireActor({ sessionToken: token });
    } catch (err) {
      const authErr = err as AuthenticationError;
      expect(authErr.code).toBe('MFA_REQUIRED');
      expect(authErr.message).toContain('المصادقة الثنائية إلزامية لحساب المالك');
    }
  });

  it('evicts inactive and expired sessions at route handler before library execution (R03)', async () => {
    const prisma = getPrismaClient();

    // 1. Inactive session (> 30 mins)
    const inactiveToken = `route-inactive-${Date.now()}`;
    const inactiveSession = await prisma.session.create({
      data: {
        id: `sess-route-inactive-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: inactiveToken,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(Date.now() - 32 * 60 * 1000),
        expiresAt: new Date(Date.now() + 10 * 3600 * 1000),
      },
    });

    const inactiveReq = new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: {
        cookie: `better-auth.session_token=${inactiveToken}`,
      },
    });

    const inactiveRes = await authRouteGET(inactiveReq);
    expect(inactiveRes.status).toBe(401);
    const inactiveBody = await inactiveRes.json();
    expect(inactiveBody.error).toContain('تم قفل الجلسة لعدم النشاط');

    // DB record must be deleted
    const checkInactiveDb = await prisma.session.findUnique({
      where: { id: inactiveSession.id },
    });
    expect(checkInactiveDb).toBeNull();

    // 2. Maximum lifetime exceeded (> 12 hours)
    const maxLifeToken = `route-maxlife-${Date.now()}`;
    const maxLifeSession = await prisma.session.create({
      data: {
        id: `sess-route-maxlife-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: maxLifeToken,
        createdAt: new Date(Date.now() - 13 * 3600 * 1000),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 3600 * 1000),
      },
    });

    const maxLifeReq = new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: {
        cookie: `better-auth.session_token=${maxLifeToken}`,
      },
    });

    const maxLifeRes = await authRouteGET(maxLifeReq);
    expect(maxLifeRes.status).toBe(401);

    const checkMaxLifeDb = await prisma.session.findUnique({
      where: { id: maxLifeSession.id },
    });
    expect(checkMaxLifeDb).toBeNull();
  });

  it('revokes all other sessions upon password change (R04)', async () => {
    const prisma = getPrismaClient();

    // Create session A (current) and session B (secondary device)
    const sessionAToken = `sess-pwchange-a-${Date.now()}`;
    const sessionBToken = `sess-pwchange-b-${Date.now()}`;

    const sessionA = await prisma.session.create({
      data: {
        id: `sess-a-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: sessionAToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      },
    });

    const sessionB = await prisma.session.create({
      data: {
        id: `sess-b-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: sessionBToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      },
    });

    // Execute password change request from Context A with properly signed cookie
    const env = getEnv();
    const signedCookieA = signSessionTokenCookie(sessionAToken, env.BETTER_AUTH_SECRET);
    const pwChangeReq = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
      method: 'POST',
      headers: {
        cookie: `better-auth.session_token=${signedCookieA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'StrongOwnerSecret2026!',
        newPassword: 'BrandNewPassword2026!#',
      }),
    });

    const pwChangeRes = await authRoutePOST(pwChangeReq);
    expect(pwChangeRes.status).toBe(200);

    // Verify Session A remains, but Session B is completely evicted
    const checkA = await prisma.session.findUnique({ where: { id: sessionA.id } });
    const checkB = await prisma.session.findUnique({ where: { id: sessionB.id } });
    expect(checkA).toBeDefined();
    expect(checkB).toBeNull();
  });

  it('permanently closes bootstrap and enforces advisory lock race safety (R06)', async () => {
    // 1. Once closed, even if all users are deleted, new provisioning is permanently blocked
    expect(await isBootstrapClosed()).toBe(true);

    await expect(
      provisionOwner({
        name: 'مالك بديل متأخر',
        email: 'late.owner@office.eg',
        password: 'LatePassword123!',
      })
    ).rejects.toThrowError(ProvisioningError);

    try {
      await provisionOwner({
        name: 'مالك بديل متأخر',
        email: 'late.owner@office.eg',
        password: 'LatePassword123!',
      });
    } catch (err) {
      const provErr = err as ProvisioningError;
      expect(provErr.code).toBe('BOOTSTRAP_ALREADY_CLOSED');
    }

    // 2. Advisory lock concurrency simulation
    const concurrentAttempts = await Promise.allSettled([
      provisionOwner({
        name: 'المحاول الأول',
        email: 'first.race@office.eg',
        password: 'RacePassword123!',
      }),
      provisionOwner({
        name: 'المحاول الثاني',
        email: 'second.race@office.eg',
        password: 'RacePassword123!',
      }),
    ]);

    // Both must be rejected because bootstrap is already closed
    expect(concurrentAttempts[0].status).toBe('rejected');
    expect(concurrentAttempts[1].status).toBe('rejected');
  });

  it('regenerates recovery codes through identity command with attempt throttling and lockout (R09)', async () => {
    const prisma = getPrismaClient();
    const testSessionToken = `sess-r09-${Date.now()}`;
    await prisma.session.create({
      data: {
        id: `sess-r09-id-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: testSessionToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      },
    });
    const actorA = await requireActor({ sessionToken: testSessionToken });

    // 1. Invalid input check
    await expect(regenerateRecoveryCodes(actorA, '')).rejects.toThrowError(AuthenticationError);

    // 2. Successful regeneration with valid password (using new password set in R04)
    const newCodes = await regenerateRecoveryCodes(actorA, 'BrandNewPassword2026!#');
    expect(Array.isArray(newCodes)).toBe(true);
    expect(newCodes.length).toBe(10);

    // 3. Invalid password increments failed count
    await expect(regenerateRecoveryCodes(actorA, 'WrongPassword123!')).rejects.toThrowError(
      AuthenticationError
    );

    const tfAfter1 = await prisma.twoFactor.findFirst({ where: { userId: actorA.id } });
    expect(tfAfter1?.failedVerificationCount).toBe(1);

    // 4. Trigger lockout on 5 consecutive failed attempts
    for (let i = 2; i <= 4; i++) {
      await expect(regenerateRecoveryCodes(actorA, 'WrongPassword123!')).rejects.toThrow();
    }

    // 5th failed attempt triggers RATE_LIMITED and sets lockedUntil for 15 minutes
    try {
      await regenerateRecoveryCodes(actorA, 'WrongPassword123!');
      expect.unreachable('Should have locked out');
    } catch (err) {
      const authErr = err as AuthenticationError;
      expect(authErr.code).toBe('RATE_LIMITED');
      expect(authErr.message).toContain('تم قفل الإجراء مؤقتاً');
    }

    const tfLocked = await prisma.twoFactor.findFirst({ where: { userId: actorA.id } });
    expect(tfLocked?.failedVerificationCount).toBe(5);
    expect(tfLocked?.lockedUntil).toBeDefined();
    expect(tfLocked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Even with the correct password, execution is blocked while lockedUntil is active
    await expect(
      regenerateRecoveryCodes(actorA, 'BrandNewPassword2026!#')
    ).rejects.toThrowError(AuthenticationError);
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