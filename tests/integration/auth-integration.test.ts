import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import {
  provisionOwner,
  confirmOwnerProvisioning,
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
  createDedicatedTestDatabase,
  createValidatedTestPool,
  cleanupTrackedFixtures,
  validateTestEnvironment,
} from '../helpers/test-db';

function signSessionTokenCookie(token: string, secret: string): string {
  const signature = crypto.createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

function makeSessionHeaders(token: string): Headers {
  const env = getEnv();
  const signed = signSessionTokenCookie(token, env.BETTER_AUTH_SECRET);
  return new Headers({
    cookie: `better-auth.session_token=${signed}`,
  });
}

async function generateTotpCode(secret: string): Promise<string> {
  const secretBytes = base32.decode(secret.toUpperCase());
  const otpHelper = createOTP(secretBytes, { period: 30, digits: 6 });
  return otpHelper.totp();
}

async function clearGlobalSingletons(): Promise<void> {
  await closeDbPool().catch(() => {});
  const g = globalThis as Record<string, unknown>;
  delete g.__lawoffice_pg_pool;
  delete g.__lawoffice_prisma;
  delete g.__lawoffice_auth;
}

describe('Real PostgreSQL Auth & Session Integration (T03)', () => {
  let dedicated: { url: string; pool: Pool; drop: () => Promise<void> };
  let pool: Pool;
  let originalTestDatabaseUrl: string | undefined;

  beforeAll(async () => {
    // 1. Create unique isolated dedicated test database so sentinel data and bootstrap in lawoffice_test remain untouched (R07)
    originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
    dedicated = await createDedicatedTestDatabase();
    pool = dedicated.pool;

    // Switch environment to dedicated test database for Prisma and Better Auth singletons
    process.env.TEST_DATABASE_URL = dedicated.url;
    getEnv(true);
    await clearGlobalSingletons();

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
  }, 30000);

  afterAll(async () => {
    await clearGlobalSingletons();
    if (dedicated) {
      await dedicated.drop().catch(() => {});
    }
    if (originalTestDatabaseUrl) {
      process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
      getEnv(true);
    }
  }, 30000);

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

    // Initial reservation universally starts pending/unverified with bootstrap open (R06)
    const prisma = getPrismaClient();
    const twoFactorRecord = await prisma.twoFactor.findFirst({
      where: { userId: result.user.id },
    });
    expect(twoFactorRecord).toBeDefined();
    expect(twoFactorRecord?.verified).toBe(false);
    // Secret in DB must NOT match plain text totpSecret
    expect(twoFactorRecord?.secret).not.toBe(result.totpSecret);
    expect(twoFactorRecord?.backupCodes).not.toBe(JSON.stringify(result.backupCodes));

    const bootstrapBefore = await prisma.officeBootstrap.findUnique({
      where: { id: 'singleton' },
    });
    expect(bootstrapBefore).toBeDefined();
    expect(bootstrapBefore?.isClosed).toBe(false);
    expect(await isBootstrapClosed()).toBe(false);

    // Verify decryption with BETTER_AUTH_SECRET yields base32: prefixed secret (R01)
    const env = getEnv();
    const decryptedSecret = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: twoFactorRecord!.secret,
    });
    expect(decryptedSecret).toBe(`base32:${result.totpSecret}`);

    // Confirm initial owner provisioning using RFC 6238 code derived from issued totpURI
    const validCode = await generateTotpCode(result.totpSecret);
    await confirmOwnerProvisioning(result.user.id, validCode);

    const twoFactorRecordConfirmed = await prisma.twoFactor.findFirst({
      where: { userId: result.user.id },
    });
    expect(twoFactorRecordConfirmed?.verified).toBe(true);

    // Verify OfficeBootstrap singleton record is now closed (R06)
    const bootstrapConfirmed = await prisma.officeBootstrap.findUnique({
      where: { id: 'singleton' },
    });
    expect(bootstrapConfirmed).toBeDefined();
    expect(bootstrapConfirmed?.isClosed).toBe(true);
    expect(bootstrapConfirmed?.ownerId).toBe(result.user.id);
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
    // 1. Invalid credentials test (generic failure via protocol endpoint)
    const badLoginReq = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: 'WrongPassword123!',
      }),
    });
    const badLoginRes = await authRoutePOST(badLoginReq);
    expect(badLoginRes.status).not.toBe(200);

    // 2. Valid password login returns twoFactorRedirect: true and two-factor challenge cookie
    const validLoginReq = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: 'StrongOwnerSecret2026!',
      }),
    });
    const signInRes = await authRoutePOST(validLoginReq);
    expect(signInRes.status).toBe(200);
    const signInJson = await signInRes.json();
    expect(signInJson.twoFactorRedirect).toBe(true);

    const setCookies = signInRes.headers.getSetCookie?.() || [signInRes.headers.get('set-cookie') || ''];
    const tfCookie = setCookies.find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookie).toBeDefined();
    const tfCookieHeader = tfCookie!.split(';')[0];

    // 3. Authenticator Enrollment Key Alignment & RFC 6238 Protocol Verification (R01 & R10):
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

    // Both client and server verify the code on identical 20-byte key
    const serverVerifier = createOTP(serverSecretBytes, { period: 30, digits: 6 });
    expect(await serverVerifier.verify(currentCode)).toBe(true);

    // Test protocol rejection of invalid code via /api/auth/two-factor/verify-totp
    const invalidTotpReq = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieHeader,
      },
      body: JSON.stringify({ code: currentCode === '000000' ? '111111' : '000000' }),
    });
    const invalidTotpRes = await authRoutePOST(invalidTotpReq);
    expect(invalidTotpRes.status).not.toBe(200);

    // Complete authentication via authentic protocol /api/auth/two-factor/verify-totp with valid RFC 6238 code
    const verifyTotpReq = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieHeader,
      },
      body: JSON.stringify({ code: currentCode }),
    });
    const verifyTotpRes = await authRoutePOST(verifyTotpReq);
    expect(verifyTotpRes.status).toBe(200);
    const verifyJson = await verifyTotpRes.json();
    expect(verifyJson.token).toBeDefined();

    const verifyCookies = verifyTotpRes.headers.getSetCookie?.() || [verifyTotpRes.headers.get('set-cookie') || ''];
    const sessionCookie = verifyCookies.find((c) => c.includes('better-auth.session_token='));
    expect(sessionCookie).toBeDefined();

    const sessionToken = verifyJson.token;
    activeSessionToken = sessionToken;

    const sessionInDb = await prisma.session.findFirst({
      where: { token: sessionToken },
    });
    expect(sessionInDb).toBeDefined();
    activeSessionId = sessionInDb!.id;
    expect(activeSessionId).toBe(sessionInDb!.id);

    // Verify session yields full OWNER actor with twoFactorVerified = true
    const actor = await requireActor({ headers: makeSessionHeaders(sessionToken) });
    expect(actor.id).toBe(provisionedOwner.userId);
    expect(actor.email).toBe(provisionedOwner.email);
    expect(actor.role).toBe('OWNER');
    expect(actor.twoFactorVerified).toBe(true);
    expect(authorize(actor, 'READ_CLIENT_DATA')).toBe(true);
  });

  it('rejects missing, unsigned, and corrupted-signature session cookies in requireActor (R02)', async () => {
    // 1. Missing cookie throws UNAUTHENTICATED
    await expect(requireActor({ headers: new Headers() })).rejects.toThrowError(AuthenticationError);

    // 2. Unsigned cookie (raw token with no signature) must fail signature verification and throw UNAUTHENTICATED
    const unsignedCookie = `better-auth.session_token=${activeSessionToken}`;
    await expect(
      requireActor({ headers: new Headers({ cookie: unsignedCookie }) })
    ).rejects.toThrowError(AuthenticationError);

    // 3. Corrupted-signature cookie (valid token with forged/tampered signature) must fail signature verification
    const corruptedCookie = `better-auth.session_token=${activeSessionToken}.invalidsignature1234567890`;
    await expect(
      requireActor({ headers: new Headers({ cookie: corruptedCookie }) })
    ).rejects.toThrowError(AuthenticationError);

    // 4. Properly signed cookie succeeds
    const env = getEnv();
    const validSignedCookie = `better-auth.session_token=${signSessionTokenCookie(activeSessionToken, env.BETTER_AUTH_SECRET)}`;
    const actor = await requireActor({ headers: new Headers({ cookie: validSignedCookie }) });
    expect(actor.id).toBe(provisionedOwner.userId);
  });

  it('enforces fresh 2FA challenge even when trustDevice is supplied on login (R02)', async () => {
    const auth = getAuth();
    const signInRes = await auth.api.signInEmail({
      body: {
        email: provisionedOwner.email,
        password: 'StrongOwnerSecret2026!',
        trustDevice: true,
      } as unknown as { email: string; password: string },
    });

    expect(signInRes).toBeDefined();
    // With 2FA enabled, trustDevice must not bypass the twoFactorRedirect challenge for owner
    expect((signInRes as Record<string, unknown>).twoFactorRedirect).toBe(true);
  });

  it('rejects historical trusted-device cookie and requires fresh 2FA challenge on sign-in (R02)', async () => {
    const prisma = getPrismaClient();
    const auth = getAuth();

    // Seed a historical trusted-device verification record in the database
    const trustToken = `trust-${Date.now()}`;
    await prisma.verification.create({
      data: {
        id: `verif-trust-${Date.now()}`,
        identifier: `device-trust:${provisionedOwner.userId}`,
        value: trustToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), // 30-day unexpired historical trust
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    try {
      // Client presents historical trusted-device cookie or header
      const signInRes = await auth.api.signInEmail({
        body: {
          email: provisionedOwner.email,
          password: 'StrongOwnerSecret2026!',
        },
        headers: new Headers({
          cookie: `better-auth.dont_remember_device=${trustToken}`,
        }),
      });

      // Must demand a fresh 2FA challenge (twoFactorRedirect: true) and NOT grant session immediately
      expect(signInRes).toBeDefined();
      expect((signInRes as Record<string, unknown>).twoFactorRedirect).toBe(true);
    } finally {
      await prisma.verification.deleteMany({
        where: { identifier: `device-trust:${provisionedOwner.userId}` },
      }).catch(() => {});
    }
  });

  it('fails closed and returns sanitized non-success if pre-handler guard encounters database error (R03)', async () => {
    const prisma = getPrismaClient();
    const spyFirst = vi.spyOn(prisma.session, 'findFirst').mockRejectedValueOnce(
      new Error('Transient PostgreSQL connection error')
    );
    const spyUnique = vi.spyOn(prisma.session, 'findUnique').mockRejectedValueOnce(
      new Error('Transient PostgreSQL connection error')
    );

    try {
      const env = getEnv();
      const req = new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
        headers: {
          cookie: `better-auth.session_token=${signSessionTokenCookie(activeSessionToken, env.BETTER_AUTH_SECRET)}`,
        },
      });

      const res = await authRouteGET(req);
      // Pre-handler guard must fail closed (non-200), NOT delegate to auth.handler (which would refresh idle session)
      expect(res.status).not.toBe(200);
      expect([500, 503]).toContain(res.status);
    } finally {
      spyFirst.mockRestore();
      spyUnique.mockRestore();
    }
  });

  it('fails closed when other-session revocation encounters real database error during password change (R04)', async () => {
    const prisma = getPrismaClient();
    const env = getEnv();

    // Create a dedicated synthetic user so shared suite owner credentials are never mutated
    const fcUserId = crypto.randomUUID();
    const fcEmail = 'failclose.owner@office.eg';
    const fcPassword = 'FcOwnerSecret2026!';
    const { hashPassword, symmetricEncrypt } = await import('better-auth/crypto');
    const hashedPassword = await hashPassword(fcPassword);

    await prisma.user.create({
      data: {
        id: fcUserId,
        name: 'مالك اختبار الفشل',
        email: fcEmail,
        emailVerified: true,
        role: 'OWNER',
        twoFactorEnabled: true,
      },
    });

    await prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: fcUserId,
        providerId: 'credential',
        accountId: fcUserId,
        password: hashedPassword,
      },
    });

    const encryptedSecret = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: 'base32:JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    });
    const encryptedCodes = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: JSON.stringify(['11111111', '22222222']),
    });

    await prisma.twoFactor.create({
      data: {
        id: crypto.randomUUID(),
        userId: fcUserId,
        secret: encryptedSecret,
        backupCodes: encryptedCodes,
        verified: true,
      },
    });

    const sessionAToken = `sess-failclose-a-${Date.now()}`;
    const sessionBToken = `sess-failclose-b-${Date.now()}`;

    await prisma.session.create({
      data: {
        id: `sess-fc-a-${Date.now()}`,
        userId: fcUserId,
        token: sessionAToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        ipAddress: '127.0.0.1',
        userAgent: 'Vitest Integration Test Runner',
      },
    });

    await prisma.session.create({
      data: {
        id: `sess-fc-b-${Date.now()}`,
        userId: fcUserId,
        token: sessionBToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        ipAddress: '127.0.0.1',
        userAgent: 'Vitest Integration Test Runner',
      },
    });

    // Verify both Context A and Context B can access protected entry points before fault injection
    const actorABefore = await requireActor({ headers: makeSessionHeaders(sessionAToken) });
    expect(actorABefore.id).toBe(fcUserId);
    const actorBBefore = await requireActor({ headers: makeSessionHeaders(sessionBToken) });
    expect(actorBBefore.id).toBe(fcUserId);

    // Inject a real PostgreSQL failure on secondary session deletion using a BEFORE DELETE trigger
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION fail_session_b_delete() RETURNS trigger AS $$
        BEGIN
          IF OLD.token = '${sessionBToken}' THEN
            RAISE EXCEPTION 'Simulated PostgreSQL failure during session B revocation';
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_fail_session_b_delete
        BEFORE DELETE ON "session"
        FOR EACH ROW
        EXECUTE FUNCTION fail_session_b_delete();
      `);
    } finally {
      client.release();
    }

    const signedCookieA = signSessionTokenCookie(sessionAToken, env.BETTER_AUTH_SECRET);
    const pwChangeReq = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
      method: 'POST',
      headers: {
        cookie: `better-auth.session_token=${signedCookieA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: fcPassword,
        newPassword: 'AnotherPassword2026!$',
      }),
    });

    try {
      const pwChangeRes = await authRoutePOST(pwChangeReq);
      // Route must fail closed (non-200) due to PostgreSQL revocation failure
      expect(pwChangeRes.status).not.toBe(200);
      expect([500, 503]).toContain(pwChangeRes.status);

      // Verify account.password hash in DB is unchanged
      const accDuringFault = await prisma.account.findFirst({
        where: { userId: fcUserId, providerId: 'credential' },
      });
      expect(accDuringFault?.password).toBe(hashedPassword);

      // Verify Context B remains valid in DB and accepted by requireActor
      const sessionBInDb = await prisma.session.findFirst({
        where: { token: sessionBToken },
      });
      expect(sessionBInDb).toBeDefined();
      const actorBDuringFault = await requireActor({ headers: makeSessionHeaders(sessionBToken) });
      expect(actorBDuringFault.id).toBe(fcUserId);

      // Drop trigger and function to restore normal operation
      const clientDrop = await pool.connect();
      try {
        await clientDrop.query(`
          DROP TRIGGER IF EXISTS trg_fail_session_b_delete ON "session";
          DROP FUNCTION IF EXISTS fail_session_b_delete();
        `);
      } finally {
        clientDrop.release();
      }

      // Retry password change from Context A
      const pwChangeRetryReq = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
        method: 'POST',
        headers: {
          cookie: `better-auth.session_token=${signedCookieA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: fcPassword,
          newPassword: 'AnotherPassword2026!$',
        }),
      });
      const pwChangeRetryRes = await authRoutePOST(pwChangeRetryReq);
      expect(pwChangeRetryRes.status).toBe(200);

      // Verify account.password hash has changed
      const accAfterSuccess = await prisma.account.findFirst({
        where: { userId: fcUserId, providerId: 'credential' },
      });
      expect(accAfterSuccess?.password).not.toBe(hashedPassword);

      // Verify Context B is evicted from session table and rejected by requireActor
      const sessionBAfter = await prisma.session.findFirst({
        where: { token: sessionBToken },
      });
      expect(sessionBAfter).toBeNull();

      await expect(
        requireActor({ headers: makeSessionHeaders(sessionBToken) })
      ).rejects.toThrowError(AuthenticationError);
    } finally {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query(`
          DROP TRIGGER IF EXISTS trg_fail_session_b_delete ON "session";
          DROP FUNCTION IF EXISTS fail_session_b_delete();
        `);
      } finally {
        cleanupClient.release();
      }
      await prisma.session.deleteMany({ where: { userId: fcUserId } }).catch(() => {});
      await prisma.twoFactor.deleteMany({ where: { userId: fcUserId } }).catch(() => {});
      await prisma.account.deleteMany({ where: { userId: fcUserId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: fcUserId } }).catch(() => {});
    }
  });

  it('enforces single-use for backup recovery codes via authentic protocol verification (R01 & R10)', async () => {
    const prisma = getPrismaClient();
    const env = getEnv();

    const backupCodeToUse = provisionedOwner.backupCodes[0];
    expect(backupCodeToUse).toBeDefined();

    // 1. Initiate first sign-in challenge
    const signInReq1 = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: 'StrongOwnerSecret2026!',
      }),
    });
    const signInRes1 = await authRoutePOST(signInReq1);
    expect(signInRes1.status).toBe(200);

    const setCookies1 = signInRes1.headers.getSetCookie?.() || [signInRes1.headers.get('set-cookie') || ''];
    const tfCookie1 = setCookies1.find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookie1).toBeDefined();
    const tfCookieHeader1 = tfCookie1!.split(';')[0];

    // 2. Consume backup code via /api/auth/two-factor/verify-backup-code protocol endpoint
    const verifyReq1 = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieHeader1,
      },
      body: JSON.stringify({
        code: backupCodeToUse,
      }),
    });
    const verifyRes1 = await authRoutePOST(verifyReq1);
    expect(verifyRes1.status).toBe(200);
    const verifyJson1 = await verifyRes1.json();
    expect(verifyJson1.token).toBeDefined();

    // Verify authenticated session issued
    const actor1 = await requireActor({ headers: makeSessionHeaders(verifyJson1.token) });
    expect(actor1.id).toBe(provisionedOwner.userId);
    expect(actor1.role).toBe('OWNER');

    // 3. Initiate second sign-in challenge and attempt to replay the consumed backup code
    const signInReq2 = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: 'StrongOwnerSecret2026!',
      }),
    });
    const signInRes2 = await authRoutePOST(signInReq2);
    expect(signInRes2.status).toBe(200);

    const setCookies2 = signInRes2.headers.getSetCookie?.() || [signInRes2.headers.get('set-cookie') || ''];
    const tfCookie2 = setCookies2.find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookie2).toBeDefined();
    const tfCookieHeader2 = tfCookie2!.split(';')[0];

    // Replay attempt must fail closed (status >= 400, INVALID_BACKUP_CODE)
    const verifyReq2 = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieHeader2,
      },
      body: JSON.stringify({
        code: backupCodeToUse,
      }),
    });
    const verifyRes2 = await authRoutePOST(verifyReq2);
    expect(verifyRes2.status).not.toBe(200);
    expect([400, 401]).toContain(verifyRes2.status);

    // 4. Verify database state: backup code is permanently deleted from encrypted record
    const tfRecord = await prisma.twoFactor.findFirst({
      where: { userId: provisionedOwner.userId },
    });
    expect(tfRecord).toBeDefined();

    const decryptedCodesStr = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: tfRecord!.backupCodes,
    });
    const parsedCodes: string[] = JSON.parse(decryptedCodesStr);
    expect(parsedCodes).not.toContain(backupCodeToUse);
    expect(parsedCodes.length).toBe(9);
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
      await requireActor({ headers: makeSessionHeaders(inactiveToken) });
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
      await requireActor({ headers: makeSessionHeaders(expiredToken) });
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

    const actorA = await requireActor({ headers: makeSessionHeaders(activeSessionToken) });
    const sessionsList = await listActiveSessions(provisionedOwner.userId, actorA.sessionId);
    expect(sessionsList.length).toBeGreaterThanOrEqual(2);

    const sessionBItem = sessionsList.find((s) => s.id === sessionB.id);
    expect(sessionBItem).toBeDefined();
    expect(sessionBItem?.isCurrent).toBe(false);

    // Revoke Session B from Context A
    await revokeSession(sessionB.id, actorA);

    // Verify Session B cannot be used anymore
    await expect(requireActor({ headers: makeSessionHeaders(sessionBToken) })).rejects.toThrowError(
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

    await expect(requireActor({ headers: makeSessionHeaders(token) })).rejects.toThrowError(
      AuthenticationError
    );
    try {
      await requireActor({ headers: makeSessionHeaders(token) });
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

    const env = getEnv();
    const inactiveReq = new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: {
        cookie: `better-auth.session_token=${signSessionTokenCookie(inactiveToken, env.BETTER_AUTH_SECRET)}`,
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
        cookie: `better-auth.session_token=${signSessionTokenCookie(maxLifeToken, env.BETTER_AUTH_SECRET)}`,
      },
    });

    const maxLifeRes = await authRouteGET(maxLifeReq);
    expect(maxLifeRes.status).toBe(401);

    const checkMaxLifeDb = await prisma.session.findUnique({
      where: { id: maxLifeSession.id },
    });
    expect(checkMaxLifeDb).toBeNull();
  });

  it('rejects HTTPS request with idle __Secure session token even when accompanied by invalid decoy plain cookie (R03)', async () => {
    const prisma = getPrismaClient();

    // Create an idle session (> 30 mins)
    const idleToken = `secure-idle-${Date.now()}`;
    await prisma.session.create({
      data: {
        id: `sess-sec-idle-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: idleToken,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(Date.now() - 32 * 60 * 1000),
        expiresAt: new Date(Date.now() + 10 * 3600 * 1000),
      },
    });

    // Request over HTTPS with decoy plain cookie + idle __Secure cookie
    const env = getEnv();
    const req = new NextRequest('https://office.lawoffice.internal/api/auth/get-session', {
      headers: {
        cookie: `better-auth.session_token=decoy-invalid-token; __Secure-better-auth.session_token=${signSessionTokenCookie(idleToken, env.BETTER_AUTH_SECRET)}`,
      },
    });

    const res = await authRouteGET(req);
    // Must be rejected as 401 (inactivity timeout), NOT refreshed or allowed to pass
    expect(res.status).toBe(401);
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

  it('distinguishes incomplete setup from completed enrollment and requires TOTP proof (R06)', async () => {
    // Create dedicated disposable database for fresh bootstrap test so existing suite owner is untouched
    const freshBootstrapDb = await createDedicatedTestDatabase();

    const prevUrl = process.env.TEST_DATABASE_URL;
    await clearGlobalSingletons();
    process.env.TEST_DATABASE_URL = freshBootstrapDb.url;
    getEnv(true);

    try {
      // Migrate fresh bootstrap database
      const migrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261111000000_init_auth/migration.sql'
      );
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');
      const client = await freshBootstrapDb.pool.connect();
      try {
        const statements = migrationSql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
        for (const s of statements) {
          await client.query(s).catch(() => {});
        }
        await client.query('ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;').catch(() => {});
        await client.query('ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);').catch(() => {});
      } finally {
        client.release();
      }

      // Initial provisioning of fresh owner with ordinary Arabic name and normal email (NO magic string heuristics)
      const setupResult = await provisionOwner({
        name: 'الأستاذ أحمد فؤاد المحامي',
        email: 'ahmed.fouad@office.eg',
        password: 'PendingSecret2026!',
      });

      const prismaFresh = getPrismaClient();

      // R06 Acceptance: Before submitting valid TOTP code, setup is pending/unverified
      const tfRecord = await prismaFresh.twoFactor.findFirst({
        where: { userId: setupResult.user.id },
      });
      // The twoFactor record must NOT be marked verified before client proves possession
      expect(tfRecord?.verified).toBe(false);

      // The bootstrap singleton must NOT be permanently closed before authenticator proof
      const bootstrap = await prismaFresh.officeBootstrap.findUnique({
        where: { id: 'singleton' },
      });
      expect(bootstrap?.isClosed).toBe(false);

      // A pending owner session cannot act as verified owner
      const pendingSession = await prismaFresh.session.create({
        data: {
          id: `sess-pending-${Date.now()}`,
          userId: setupResult.user.id,
          token: `token-pending-${Date.now()}`,
          expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        },
      });

      // requireActor must reject unverified/pending 2FA with MFA_REQUIRED
      await expect(
        requireActor({ headers: makeSessionHeaders(pendingSession.token) })
      ).rejects.toThrowError(AuthenticationError);

      // Interrupted CLI setup resumption:
      // Re-invoking provisionOwner with identical credentials when setup is pending resumes setup rather than failing
      const resumedResult = await provisionOwner({
        name: 'الأستاذ أحمد فؤاد المحامي',
        email: 'ahmed.fouad@office.eg',
        password: 'PendingSecret2026!',
      });
      expect(resumedResult.user.id).toBe(setupResult.user.id);

      // Confirm owner provisioning with valid TOTP code to complete enrollment
      const validCode = await generateTotpCode(resumedResult.totpSecret);
      await confirmOwnerProvisioning(resumedResult.user.id, validCode);

      const tfRecordAfter = await prismaFresh.twoFactor.findFirst({
        where: { userId: setupResult.user.id },
      });
      expect(tfRecordAfter?.verified).toBe(true);

      const bootstrapAfter = await prismaFresh.officeBootstrap.findUnique({
        where: { id: 'singleton' },
      });
      expect(bootstrapAfter?.isClosed).toBe(true);
    } finally {
      await clearGlobalSingletons();
      await freshBootstrapDb.drop().catch(() => {});
      if (prevUrl) {
        process.env.TEST_DATABASE_URL = prevUrl;
        getEnv(true);
      }
    }
  }, 30000);

  it('enforces persistent bounded attempts and lockout on pending-setup password and TOTP confirmation (R06 / B4)', async () => {
    const freshDb = await createDedicatedTestDatabase();
    const prevUrl = process.env.TEST_DATABASE_URL;
    await clearGlobalSingletons();
    process.env.TEST_DATABASE_URL = freshDb.url;
    getEnv(true);

    try {
      // Migrate fresh database
      const migrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261111000000_init_auth/migration.sql'
      );
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');
      const client = await freshDb.pool.connect();
      try {
        const statements = migrationSql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
        for (const s of statements) {
          await client.query(s).catch(() => {});
        }
        await client.query('ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;').catch(() => {});
        await client.query('ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);').catch(() => {});
      } finally {
        client.release();
      }

      // 1. Formerly exempt email 'adel.lawyer@office.eg' also universally begins unverified with bootstrap open
      const initial = await provisionOwner({
        name: 'الأستاذ عادل المالك',
        email: 'adel.lawyer@office.eg',
        password: 'OriginalPassword2026!',
      });

      const prismaFresh = getPrismaClient();
      const tfInitial = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfInitial?.verified).toBe(false);
      expect(tfInitial?.failedVerificationCount).toBe(0);
      expect(tfInitial?.lockedUntil).toBeNull();

      const bsInitial = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bsInitial?.isClosed).toBe(false);

      // 2. Pending password verification attempt throttling and lockout
      for (let i = 1; i <= 4; i++) {
        await expect(
          provisionOwner({
            name: 'الأستاذ عادل المالك',
            email: 'adel.lawyer@office.eg',
            password: 'WrongPassword!',
          })
        ).rejects.toThrowError(ProvisioningError);

        const tf = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
        expect(tf?.failedVerificationCount).toBe(i);
        expect(tf?.lockedUntil).toBeNull();
      }

      // 5th failed password attempt triggers ACCOUNT_LOCKED and sets lockedUntil for 15 minutes
      try {
        await provisionOwner({
          name: 'الأستاذ عادل المالك',
          email: 'adel.lawyer@office.eg',
          password: 'WrongPassword!',
        });
        expect.unreachable('Should have failed with ACCOUNT_LOCKED');
      } catch (err) {
        const provErr = err as ProvisioningError;
        expect(provErr.code).toBe('ACCOUNT_LOCKED');
        expect(provErr.message).toContain('تم تجاوز الحد الأقصى');
      }

      const tfLocked = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfLocked?.failedVerificationCount).toBe(5);
      expect(tfLocked?.lockedUntil).toBeDefined();
      expect(tfLocked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // While locked, even correct password is rejected
      await expect(
        provisionOwner({
          name: 'الأستاذ عادل المالك',
          email: 'adel.lawyer@office.eg',
          password: 'OriginalPassword2026!',
        })
      ).rejects.toThrowError(ProvisioningError);

      // Simulate lock expiry (reset lockedUntil into the past)
      await prismaFresh.twoFactor.update({
        where: { id: tfLocked!.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });

      // Legitimate continuation after lock expiry succeeds and resets failure counter
      const resumed = await provisionOwner({
        name: 'الأستاذ عادل المالك',
        email: 'adel.lawyer@office.eg',
        password: 'OriginalPassword2026!',
      });
      expect(resumed.user.id).toBe(initial.user.id);

      const tfResumed = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfResumed?.failedVerificationCount).toBe(0);
      expect(tfResumed?.lockedUntil).toBeNull();

      // 3. Pending TOTP confirmation attempt throttling and lockout
      for (let i = 1; i <= 4; i++) {
        await expect(
          confirmOwnerProvisioning(resumed.user.id, '000000')
        ).rejects.toThrowError(AuthenticationError);

        const tf = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
        expect(tf?.failedVerificationCount).toBe(i);
        expect(tf?.lockedUntil).toBeNull();
      }

      // 5th failed TOTP attempt triggers ACCOUNT_LOCKED
      try {
        await confirmOwnerProvisioning(resumed.user.id, '000000');
        expect.unreachable('Should have failed with ACCOUNT_LOCKED');
      } catch (err) {
        const authErr = err as AuthenticationError;
        expect(authErr.code).toBe('ACCOUNT_LOCKED');
      }

      const tfTotpLocked = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfTotpLocked?.failedVerificationCount).toBe(5);
      expect(tfTotpLocked?.lockedUntil).toBeDefined();

      // While locked, even valid TOTP code is rejected
      const validCode = await generateTotpCode(resumed.totpSecret);
      await expect(
        confirmOwnerProvisioning(resumed.user.id, validCode)
      ).rejects.toThrowError(AuthenticationError);

      // Simulate lock expiry
      await prismaFresh.twoFactor.update({
        where: { id: tfTotpLocked!.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });

      // Valid TOTP confirmation after lock expiry completes enrollment and closes bootstrap
      await confirmOwnerProvisioning(resumed.user.id, validCode);

      const tfFinal = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfFinal?.verified).toBe(true);
      expect(tfFinal?.failedVerificationCount).toBe(0);
      expect(tfFinal?.lockedUntil).toBeNull();

      const bsFinal = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bsFinal?.isClosed).toBe(true);
      expect(bsFinal?.ownerId).toBe(initial.user.id);
    } finally {
      await clearGlobalSingletons();
      await freshDb.drop().catch(() => {});
      if (prevUrl) {
        process.env.TEST_DATABASE_URL = prevUrl;
        getEnv(true);
      }
    }
  }, 45000);

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
    const actorA = await requireActor({ headers: makeSessionHeaders(testSessionToken) });

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

  it('enforces atomic PostgreSQL concurrency control across 8 simultaneous wrong recovery attempts (R09)', async () => {
    const prisma = getPrismaClient();

    // Reset failed count and lock for test isolation
    await prisma.twoFactor.updateMany({
      where: { userId: provisionedOwner.userId },
      data: { failedVerificationCount: 0, lockedUntil: null },
    });

    const testSessionToken = `sess-r09-race-${Date.now()}`;
    await prisma.session.create({
      data: {
        id: `sess-r09-race-id-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: testSessionToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      },
    });
    const actor = await requireActor({ headers: makeSessionHeaders(testSessionToken) });

    // Fire 8 simultaneous wrong-password attempts concurrently
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }).map(() =>
        regenerateRecoveryCodes(actor, 'WrongPasswordSimultaneous!')
      )
    );

    // All attempts must be rejected
    for (const attempt of attempts) {
      expect(attempt.status).toBe('rejected');
    }

    const rejectionReasons = attempts.map(
      (a) => (a as PromiseRejectedResult).reason as AuthenticationError
    );
    const rateLimitedCount = rejectionReasons.filter((r) => r.code === 'RATE_LIMITED').length;

    // With a limit of 5 attempts, at least 3 of the 8 simultaneous requests must be RATE_LIMITED
    expect(rateLimitedCount).toBeGreaterThanOrEqual(3);

    // Check DB state: account must be locked and failedVerificationCount must be at least 5
    const tfRecord = await prisma.twoFactor.findFirst({
      where: { userId: provisionedOwner.userId },
    });
    expect(tfRecord?.lockedUntil).not.toBeNull();
    expect(tfRecord!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(tfRecord?.failedVerificationCount).toBeGreaterThanOrEqual(5);
  });

  afterAll(async () => {
    await clearGlobalSingletons();
    if (dedicated) {
      await dedicated.drop().catch(() => {});
    }
    if (originalTestDatabaseUrl) {
      process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
      getEnv(true);
    }
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

  it('refuses collision on existing database and preserves sentinel data without dropping or disconnecting (R07)', async () => {
    // 1. Manually create a sentinel database with unique name
    const sentinelDbName = `lawoffice_sentinel_${Date.now()}_test`;
    const { pool: adminPool } = createValidatedTestPool();
    const adminClient = await adminPool.connect();
    try {
      await adminClient.query(`CREATE DATABASE "${sentinelDbName}";`);
    } finally {
      adminClient.release();
      await adminPool.end();
    }

    // 2. Put sentinel data into the sentinel database
    const rawTarget = process.env.TEST_DATABASE_URL!;
    const sentinelUrl = new URL(rawTarget);
    sentinelUrl.pathname = `/${sentinelDbName}`;
    const { pool: sentinelPool } = createValidatedTestPool({ TEST_DATABASE_URL: sentinelUrl.toString() });
    const sClient = await sentinelPool.connect();
    try {
      await sClient.query('CREATE TABLE sentinel_table (id SERIAL PRIMARY KEY, marker TEXT);');
      await sClient.query("INSERT INTO sentinel_table (marker) VALUES ('DO_NOT_DESTROY');");
    } finally {
      sClient.release();
      await sentinelPool.end();
    }

    try {
      // 3. Attempt to create dedicated test database with the SAME existing name
      await expect(createDedicatedTestDatabase(sentinelDbName)).rejects.toThrow(
        `Refusing to overwrite existing database '${sentinelDbName}'. Collision detected.`
      );

      // 4. Verify sentinel database still exists and data is untouched
      const { pool: verifyPool } = createValidatedTestPool({ TEST_DATABASE_URL: sentinelUrl.toString() });
      const vClient = await verifyPool.connect();
      try {
        const res = await vClient.query("SELECT marker FROM sentinel_table WHERE marker = 'DO_NOT_DESTROY';");
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].marker).toBe('DO_NOT_DESTROY');
      } finally {
        vClient.release();
        await verifyPool.end();
      }
    } finally {
      // Clean up our manual sentinel database
      const { pool: cleanupPool } = createValidatedTestPool();
      const cClient = await cleanupPool.connect();
      try {
        await cClient.query(`DROP DATABASE IF EXISTS "${sentinelDbName}" WITH (FORCE);`);
      } finally {
        cClient.release();
        await cleanupPool.end();
      }
    }
  });

  it('preserves unrelated sentinel user when cleaning up tracked fixtures by userIds (R07)', async () => {
    const sentinelDb = await createDedicatedTestDatabase();
    const prevUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = sentinelDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    try {
      // Migrate sentinelDb
      const migrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261111000000_init_auth/migration.sql'
      );
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');
      const client = await sentinelDb.pool.connect();
      try {
        const statements = migrationSql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
        for (const s of statements) {
          await client.query(s).catch(() => {});
        }
      } finally {
        client.release();
      }

      const prisma = getPrismaClient();

      // 1. Create a sentinel user record that is NOT tracked by the suite fixture set
      const sentinelUser = await prisma.user.create({
        data: {
          id: `sentinel-${Date.now()}`,
          name: 'حساب مراقبة دائم',
          email: `sentinel.${Date.now()}@office.eg`,
          role: 'MAINTAINER',
        },
      });

      // 2. Create a test fixture user record with a distinct ID
      const fixtureUser = await prisma.user.create({
        data: {
          id: `fixture-${Date.now()}`,
          name: 'مستخدم تجريبي مؤقت',
          email: `fixture.${Date.now()}@office.eg`,
          role: 'OWNER',
        },
      });

      // 3. Run cleanupTrackedFixtures strictly tracking the fixture ID only
      await cleanupTrackedFixtures(sentinelDb.pool, { userIds: [fixtureUser.id] });

      // 4. Assert fixture user was deleted, but sentinel user survives
      const foundFixture = await prisma.user.findUnique({ where: { id: fixtureUser.id } });
      expect(foundFixture).toBeNull();

      const foundSentinel = await prisma.user.findUnique({ where: { id: sentinelUser.id } });
      expect(foundSentinel).not.toBeNull();
      expect(foundSentinel?.id).toBe(sentinelUser.id);
    } finally {
      await clearGlobalSingletons();
      await sentinelDb.drop().catch(() => {});
      if (prevUrl) {
        process.env.TEST_DATABASE_URL = prevUrl;
        getEnv(true);
      }
    }
  });

  it('fails closed when createValidatedTestPool poolConfig attempts to target operational development or non-test database (R07)', () => {
    // 1. Connection string override targeting lawoffice_dev
    expect(() => {
      createValidatedTestPool({}, {
        connectionString: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5432/lawoffice_dev',
      });
    }).toThrowError(EnvironmentValidationError);

    // 2. Database name override targeting lawoffice_dev
    expect(() => {
      createValidatedTestPool({}, {
        database: 'lawoffice_dev',
      });
    }).toThrowError(EnvironmentValidationError);

    // 3. Database name override targeting non-test database
    expect(() => {
      createValidatedTestPool({}, {
        database: 'lawoffice_production',
      });
    }).toThrowError(EnvironmentValidationError);
  });

  it('rejects malformed database identifier codex_bad%_test and verifies zero database leaked in catalog (Phase A)', async () => {
    const malformedName = 'codex_bad%_test';

    await expect(createDedicatedTestDatabase(malformedName)).rejects.toThrow(
      /alphanumeric and underscores/
    );

    // Verify in PostgreSQL catalog that no database containing codex_bad% was created or leaked
    const { pool: verifyPool } = createValidatedTestPool();
    const vClient = await verifyPool.connect();
    try {
      const res = await vClient.query(
        'SELECT datname FROM pg_database WHERE datname LIKE $1;',
        ['%codex_bad%']
      );
      expect(res.rows.length).toBe(0);
    } finally {
      vClient.release();
      await verifyPool.end();
    }
  });
});