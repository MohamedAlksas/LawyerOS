import { browserSessionToken } from '../helpers/browser-session';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
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
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { closeDbPool } from '@/lib/db';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { symmetricDecrypt } from 'better-auth/crypto';
import { getEnv, EnvironmentValidationError } from '@/lib/env';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { GET as authRouteGET, POST as authRoutePOST } from '@/app/api/auth/[...all]/route';
import { GET as viewSessionGET } from '@/app/api/auth/view-session/route';
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

function extractTrustIdentifierFromCookie(cookieHeader: string): string {
  const cookiePart = cookieHeader.split(';')[0];
  const eqIdx = cookiePart.indexOf('=');
  const cookieVal = decodeURIComponent(cookiePart.substring(eqIdx + 1));
  const dotIdx = cookieVal.lastIndexOf('.');
  const payload = dotIdx !== -1 ? cookieVal.substring(0, dotIdx) : cookieVal;
  const exclIdx = payload.indexOf('!');
  if (exclIdx !== -1) {
    return payload.substring(exclIdx + 1);
  }
  return payload;
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
  await globalThis.__lawoffice_prisma?.$disconnect();
  await closeDbPool().catch(() => {});
  const g = globalThis as Record<string, unknown>;
  delete g.__lawoffice_pg_pool;
  delete g.__lawoffice_prisma;
  delete g.__lawoffice_auth;
}

async function waitForLockWaiters(pool: Pool, expectedCount: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await pool.query(`
      SELECT count(*)::int AS count
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE a.datname = current_database()
        AND l.granted = false;
    `);
    if (res.rows[0].count >= expectedCount) {
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${expectedCount} lock waiter(s) in pg_locks`);
}

async function applyAllTestMigrations(pool: Pool): Promise<void> {
  const initSqlPath = path.resolve(
    process.cwd(),
    'prisma/migrations/20261111000000_init_auth/migration.sql'
  );
  const initSql = fs.readFileSync(initSqlPath, 'utf-8');

  const credSqlPath = path.resolve(
    process.cwd(),
    'prisma/migrations/20261114000000_credential_version/migration.sql'
  );
  const credSql = fs.existsSync(credSqlPath) ? fs.readFileSync(credSqlPath, 'utf-8') : '';

  const client = await pool.connect();
  try {
    const statements = initSql
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

    if (credSql) {
      await client.query(credSql).catch(() => {});
    }
  } finally {
    client.release();
  }
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

    // Install the current schema, including the audit table used by Identity.
    // Legacy-bootstrap fixtures further below still use the historical SQL.
    const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: dedicated.url },
      encoding: 'utf8',
    });
    expect(migration.status, migration.stderr).toBe(0);
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

  it('rejects confirmOwnerProvisioning after bootstrap closure without mutating lockout counters or closedAt', async () => {
    const prisma = getPrismaClient();
    const beforeTf = await prisma.twoFactor.findFirstOrThrow({
      where: { userId: provisionedOwner.userId },
    });
    const beforeBootstrap = await prisma.officeBootstrap.findUniqueOrThrow({
      where: { id: 'singleton' },
    });

    let err: unknown;
    try {
      await confirmOwnerProvisioning(provisionedOwner.userId, '000000');
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ProvisioningError);
    expect((err as ProvisioningError).code).toBe('BOOTSTRAP_ALREADY_CLOSED');

    const afterTf = await prisma.twoFactor.findFirstOrThrow({
      where: { userId: provisionedOwner.userId },
    });
    const afterBootstrap = await prisma.officeBootstrap.findUniqueOrThrow({
      where: { id: 'singleton' },
    });
    expect(afterTf.failedVerificationCount).toBe(beforeTf.failedVerificationCount);
    expect(afterTf.lockedUntil).toEqual(beforeTf.lockedUntil);
    expect(afterBootstrap.closedAt.getTime()).toBe(beforeBootstrap.closedAt.getTime());
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
    const verifyJsonToken = await browserSessionToken(verifyTotpRes);

    const verifyCookies = verifyTotpRes.headers.getSetCookie?.() || [verifyTotpRes.headers.get('set-cookie') || ''];
    const sessionCookie = verifyCookies.find((c) => c.includes('better-auth.session_token='));
    expect(sessionCookie).toBeDefined();

    const sessionToken = verifyJsonToken;
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

  it('rejects authentic signed historical trusted-device cookie and requires fresh 2FA challenge on sign-in (R02)', async () => {
    const prisma = getPrismaClient();
    const env = getEnv();
    const prevAuthUrl = process.env.BETTER_AUTH_URL;

    // Assert current application provider is configured for HTTP (supports both port 3000 and CI port 3100)
    const currentHttpOrigin = getAuth().options.baseURL;
    expect(currentHttpOrigin).toBe(env.BETTER_AUTH_URL || 'http://127.0.0.1:3000');

    // 1. Obtain genuine historical trust cookie through prior 30-day provider configuration
    const priorAuthHttp = betterAuth({
      database: prismaAdapter(getPrismaClient(), { provider: 'postgresql' }),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: currentHttpOrigin,
      emailAndPassword: { enabled: true },
      plugins: [
        twoFactor({
          issuer: 'LawOffice OS',
          trustDeviceMaxAge: 30 * 24 * 3600, // 30-day unexpired historical trust
          otpOptions: {
            period: 30,
            digits: 6,
          },
        }),
      ],
    });

    // Step A: Initial password challenge on prior provider
    const signInPriorReq = new Request(`${currentHttpOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: 'StrongOwnerSecret2026!',
      }),
    });
    const signInPriorRes = await priorAuthHttp.handler(signInPriorReq);
    expect(signInPriorRes.status).toBe(200);
    const signInPriorJson = await signInPriorRes.json();
    expect(signInPriorJson.twoFactorRedirect).toBe(true);

    const priorSetCookies = signInPriorRes.headers.getSetCookie?.() || [
      signInPriorRes.headers.get('set-cookie') || '',
    ];
    const twoFactorCookie = priorSetCookies.find((c) => c.includes('better-auth.two_factor='));
    expect(twoFactorCookie).toBeDefined();

    // Step B: Genuine MFA verification with trustDevice: true on prior provider
    const validTotp = await generateTotpCode(provisionedOwner.totpSecret);
    const verifyPriorReq = new Request(`${currentHttpOrigin}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: twoFactorCookie!.split(';')[0],
      },
      body: JSON.stringify({
        code: validTotp,
        trustDevice: true,
      }),
    });
    const verifyPriorRes = await priorAuthHttp.handler(verifyPriorReq);
    expect(verifyPriorRes.status).toBe(200);
    const verifyPriorJson = await verifyPriorRes.json();
    expect(verifyPriorJson.token).toBeDefined();

    // Step C: Extract authentic issued trust_device cookie and verify exact database record
    const verifySetCookies = verifyPriorRes.headers.getSetCookie?.() || [
      verifyPriorRes.headers.get('set-cookie') || '',
    ];
    const issuedTrustCookie = verifySetCookies.find((c) => c.includes('better-auth.trust_device='));
    expect(issuedTrustCookie).toBeDefined();
    const trustCookieHeader = issuedTrustCookie!.split(';')[0];

    const httpTrustIdentifier = extractTrustIdentifierFromCookie(trustCookieHeader);
    const trustVerifRecord = await prisma.verification.findFirst({
      where: { identifier: httpTrustIdentifier },
    });
    expect(trustVerifRecord).toBeDefined();
    expect(trustVerifRecord?.value).toBe(provisionedOwner.userId);
    expect(trustVerifRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Step D: Extract issued session token cookie and verify session exists in DB
    const priorSessionCookie = verifySetCookies.find((c) =>
      c.includes('better-auth.session_token=')
    );
    expect(priorSessionCookie).toBeDefined();
    const sessionCookieHeader = priorSessionCookie!.split(';')[0];

    const sessionInDb = await prisma.session.findUnique({
      where: { token: verifyPriorJson.token },
    });
    expect(sessionInDb).toBeDefined();

    // Sign out prior session using the actual issued session cookie header (not Authorization: Bearer)
    const signOutReq = new Request(`${currentHttpOrigin}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
      },
    });
    const signOutRes = await priorAuthHttp.handler(signOutReq);
    expect(signOutRes.status).toBe(200);

    // Assert old session is deleted from PostgreSQL
    const deletedSession = await prisma.session.findUnique({
      where: { token: verifyPriorJson.token },
    });
    expect(deletedSession).toBeNull();

    // Assert exact better-auth.trust_device database verification record remains intact and unexpired
    const retainedTrustRecord = await prisma.verification.findFirst({
      where: { identifier: httpTrustIdentifier },
    });
    expect(retainedTrustRecord).toBeDefined();
    expect(retainedTrustRecord?.value).toBe(provisionedOwner.userId);
    expect(retainedTrustRecord!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    try {
      // 1. Client presents authentic signed historical trusted-device cookie over HTTP to CURRENT real route
      const signInReq = new NextRequest(`${currentHttpOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: trustCookieHeader,
        },
        body: JSON.stringify({
          email: provisionedOwner.email,
          password: 'StrongOwnerSecret2026!',
        }),
      });

      const signInRes = await authRoutePOST(signInReq);
      expect(signInRes.status).toBe(200);
      const signInJson = await signInRes.json();

      // Must demand a fresh 2FA challenge (twoFactorRedirect: true) and NOT grant session immediately
      expect(signInJson.twoFactorRedirect).toBe(true);

      // Must NOT set a session token cookie
      const setCookieHeaders = signInRes.headers.getSetCookie?.() || [signInRes.headers.get('set-cookie') || ''];
      const hasSessionToken = setCookieHeaders.some(
        (c) => c.startsWith('better-auth.session_token=') && !c.includes('Max-Age=0')
      );
      expect(hasSessionToken).toBe(false);

      // Subsequent protected access before completing fresh 2FA must fail closed
      await expect(
        requireActor({ headers: signInReq.headers })
      ).rejects.toThrowError(AuthenticationError);

      // 2. HTTPS: Reconfigure current application provider for HTTPS and assert provider options
      process.env.BETTER_AUTH_URL = 'https://office.lawoffice.internal:3000';
      getEnv(true);
      global.__lawoffice_auth = undefined;
      expect(getAuth().options.baseURL).toBe('https://office.lawoffice.internal:3000');

      // Obtain authentic historical trust cookie through HTTPS prior provider configuration
      const priorAuthHttps = betterAuth({
        database: prismaAdapter(getPrismaClient(), { provider: 'postgresql' }),
        secret: env.BETTER_AUTH_SECRET,
        baseURL: 'https://office.lawoffice.internal:3000',
        emailAndPassword: { enabled: true },
        plugins: [
          twoFactor({
            issuer: 'LawOffice OS',
            trustDeviceMaxAge: 30 * 24 * 3600,
            otpOptions: {
              period: 30,
              digits: 6,
            },
          }),
        ],
      });

      const signInHttpsReq = new Request('https://office.lawoffice.internal:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: provisionedOwner.email,
          password: 'StrongOwnerSecret2026!',
        }),
      });
      const signInHttpsRes = await priorAuthHttps.handler(signInHttpsReq);
      expect(signInHttpsRes.status).toBe(200);
      const signInHttpsSetCookies = signInHttpsRes.headers.getSetCookie?.() || [
        signInHttpsRes.headers.get('set-cookie') || '',
      ];
      const tfCookieHttps = signInHttpsSetCookies.find((c) =>
        c.includes('better-auth.two_factor=') || c.includes('__Secure-better-auth.two_factor=')
      );
      expect(tfCookieHttps).toBeDefined();

      const freshTotpHttps = await generateTotpCode(provisionedOwner.totpSecret);
      const verifyHttpsReq = new Request('https://office.lawoffice.internal:3000/api/auth/two-factor/verify-totp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: tfCookieHttps!.split(';')[0],
        },
        body: JSON.stringify({
          code: freshTotpHttps,
          trustDevice: true,
        }),
      });
      const verifyHttpsRes = await priorAuthHttps.handler(verifyHttpsReq);
      expect(verifyHttpsRes.status).toBe(200);
      const verifyHttpsJson = await verifyHttpsRes.json();

      const verifyHttpsCookies = verifyHttpsRes.headers.getSetCookie?.() || [
        verifyHttpsRes.headers.get('set-cookie') || '',
      ];
      const issuedSecureTrustCookie = verifyHttpsCookies.find(
        (c) => c.includes('better-auth.trust_device=') || c.includes('__Secure-better-auth.trust_device=')
      );
      expect(issuedSecureTrustCookie).toBeDefined();
      const secureTrustCookieHeader = issuedSecureTrustCookie!.split(';')[0];

      const secureTrustIdentifier = extractTrustIdentifierFromCookie(secureTrustCookieHeader);
      const secureTrustVerif = await prisma.verification.findFirst({
        where: { identifier: secureTrustIdentifier },
      });
      expect(secureTrustVerif).toBeDefined();
      expect(secureTrustVerif?.value).toBe(provisionedOwner.userId);
      expect(secureTrustVerif!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Extract issued HTTPS session token cookie and verify session exists in DB
      const priorSessionCookieHttps = verifyHttpsCookies.find(
        (c) => c.includes('__Secure-better-auth.session_token=') || c.includes('better-auth.session_token=')
      );
      expect(priorSessionCookieHttps).toBeDefined();
      const sessionCookieHeaderHttps = priorSessionCookieHttps!.split(';')[0];

      const sessionInDbHttps = await prisma.session.findUnique({
        where: { token: verifyHttpsJson.token },
      });
      expect(sessionInDbHttps).toBeDefined();

      // Sign out prior HTTPS session using the actual issued session cookie header (not Authorization: Bearer)
      const signOutHttpsReq = new Request('https://office.lawoffice.internal:3000/api/auth/sign-out', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookieHeaderHttps,
        },
      });
      const signOutHttpsRes = await priorAuthHttps.handler(signOutHttpsReq);
      expect(signOutHttpsRes.status).toBe(200);

      // Assert old HTTPS session is deleted from PostgreSQL
      const deletedSessionHttps = await prisma.session.findUnique({
        where: { token: verifyHttpsJson.token },
      });
      expect(deletedSessionHttps).toBeNull();

      // Assert exact trust verification record remains intact and unexpired in DB
      const retainedSecureTrust = await prisma.verification.findFirst({
        where: { identifier: secureTrustIdentifier },
      });
      expect(retainedSecureTrust).toBeDefined();
      expect(retainedSecureTrust?.value).toBe(provisionedOwner.userId);
      expect(retainedSecureTrust!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Present authentic __Secure- trust cookie to CURRENT application route over HTTPS
      const signInReqSecure = new NextRequest('https://office.lawoffice.internal:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: secureTrustCookieHeader,
        },
        body: JSON.stringify({
          email: provisionedOwner.email,
          password: 'StrongOwnerSecret2026!',
        }),
      });

      const signInResSecure = await authRoutePOST(signInReqSecure);
      expect(signInResSecure.status).toBe(200);
      const signInJsonSecure = await signInResSecure.json();
      expect(signInJsonSecure.twoFactorRedirect).toBe(true);

      const setCookiesSecure = signInResSecure.headers.getSetCookie?.() || [signInResSecure.headers.get('set-cookie') || ''];
      const hasSecureSessionToken = setCookiesSecure.some(
        (c) =>
          (c.startsWith('__Secure-better-auth.session_token=') ||
            c.startsWith('better-auth.session_token=')) &&
          !c.includes('Max-Age=0')
      );
      expect(hasSecureSessionToken).toBe(false);

      await expect(
        requireActor({ headers: signInReqSecure.headers })
      ).rejects.toThrowError(AuthenticationError);
    } finally {
      process.env.BETTER_AUTH_URL = prevAuthUrl || currentHttpOrigin;
      getEnv(true);
      global.__lawoffice_auth = undefined;
      await prisma.verification.deleteMany({
        where: { value: provisionedOwner.userId },
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
    const rawTotpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
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
      data: `base32:${rawTotpSecret}`,
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

    // Log in Context A via genuine wire sign-in and TOTP completion
    const signInReqA = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fcEmail, password: fcPassword }),
    });
    const signInResA = await authRoutePOST(signInReqA);
    expect(signInResA.status).toBe(200);
    const signInJsonA = await signInResA.json();
    expect(signInJsonA.twoFactorRedirect).toBe(true);
    const setCookiesA1 = signInResA.headers.getSetCookie?.() || [signInResA.headers.get('set-cookie') || ''];
    const tfCookieA = setCookiesA1.find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookieA).toBeDefined();

    const codeA = await generateTotpCode(rawTotpSecret);
    const verifyTotpReqA = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieA!.split(';')[0],
      },
      body: JSON.stringify({ code: codeA }),
    });
    const verifyTotpResA = await authRoutePOST(verifyTotpReqA);
    expect(verifyTotpResA.status).toBe(200);
    const verifyJsonAToken = await browserSessionToken(verifyTotpResA);
    const sessionAToken = verifyJsonAToken;
    expect(sessionAToken).toBeDefined();
    const setCookiesA2 = verifyTotpResA.headers.getSetCookie?.() || [verifyTotpResA.headers.get('set-cookie') || ''];
    const sessionCookieHeaderA = setCookiesA2.find((c) => c.includes('better-auth.session_token='));
    expect(sessionCookieHeaderA).toBeDefined();
    const sessionACookie = sessionCookieHeaderA!.split(';')[0];

    // Log in Context B via genuine wire sign-in and TOTP completion
    const signInReqB = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fcEmail, password: fcPassword }),
    });
    const signInResB = await authRoutePOST(signInReqB);
    expect(signInResB.status).toBe(200);
    const signInJsonB = await signInResB.json();
    expect(signInJsonB.twoFactorRedirect).toBe(true);
    const setCookiesB1 = signInResB.headers.getSetCookie?.() || [signInResB.headers.get('set-cookie') || ''];
    const tfCookieB = setCookiesB1.find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookieB).toBeDefined();

    const codeB = await generateTotpCode(rawTotpSecret);
    const verifyTotpReqB = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieB!.split(';')[0],
      },
      body: JSON.stringify({ code: codeB }),
    });
    const verifyTotpResB = await authRoutePOST(verifyTotpReqB);
    expect(verifyTotpResB.status).toBe(200);
    const verifyJsonBToken = await browserSessionToken(verifyTotpResB);
    const sessionBToken = verifyJsonBToken;
    expect(sessionBToken).toBeDefined();
    const setCookiesB2 = verifyTotpResB.headers.getSetCookie?.() || [verifyTotpResB.headers.get('set-cookie') || ''];
    const sessionCookieHeaderB = setCookiesB2.find((c) => c.includes('better-auth.session_token='));
    expect(sessionCookieHeaderB).toBeDefined();
    const sessionBCookie = sessionCookieHeaderB!.split(';')[0];

    // Verify both Context A and Context B can access protected entry points (requireActor AND get-session) before fault
    const actorABefore = await requireActor({ headers: new Headers({ cookie: sessionACookie }) });
    expect(actorABefore.id).toBe(fcUserId);
    const getSessABefore = await authRouteGET(new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: { cookie: sessionACookie },
    }));
    expect(getSessABefore.status).toBe(200);
    const getSessABeforeJson = await getSessABefore.json();
    expect(getSessABeforeJson?.user?.id).toBe(fcUserId);

    const actorBBefore = await requireActor({ headers: new Headers({ cookie: sessionBCookie }) });
    expect(actorBBefore.id).toBe(fcUserId);
    const getSessBBefore = await authRouteGET(new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: { cookie: sessionBCookie },
    }));
    expect(getSessBBefore.status).toBe(200);
    const getSessBBeforeJson = await getSessBBefore.json();
    expect(getSessBBeforeJson?.user?.id).toBe(fcUserId);

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

    try {
      // 1. Password change with OMITTED client revocation preference
      const pwChangeReqOmitted = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
        method: 'POST',
        headers: {
          cookie: sessionACookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: fcPassword,
          newPassword: 'AnotherPassword2026!$',
        }),
      });

      const resOmitted = await authRoutePOST(pwChangeReqOmitted);
      // Route must fail closed (non-200) due to PostgreSQL revocation failure
      expect(resOmitted.status).not.toBe(200);
      expect([500, 503]).toContain(resOmitted.status);

      // Verify account.password hash in DB remains unchanged
      const accDuringFault1 = await prisma.account.findFirst({
        where: { userId: fcUserId, providerId: 'credential' },
      });
      expect(accDuringFault1?.password).toBe(hashedPassword);

      // Verify Context A remains valid across both entry points
      const actorAFault1 = await requireActor({ headers: new Headers({ cookie: sessionACookie }) });
      expect(actorAFault1.id).toBe(fcUserId);
      const getSessAFault1 = await authRouteGET(new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
        headers: { cookie: sessionACookie },
      }));
      expect(getSessAFault1.status).toBe(200);
      const sessA1Json = await getSessAFault1.json();
      expect(sessA1Json?.user?.id).toBe(fcUserId);

      // Verify Context B remains valid across both entry points
      const actorBFault1 = await requireActor({ headers: new Headers({ cookie: sessionBCookie }) });
      expect(actorBFault1.id).toBe(fcUserId);
      const getSessBFault1 = await authRouteGET(new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
        headers: { cookie: sessionBCookie },
      }));
      expect(getSessBFault1.status).toBe(200);
      const sessB1Json = await getSessBFault1.json();
      expect(sessB1Json?.user?.id).toBe(fcUserId);

      // 2. Password change with EXPLICIT FALSE client revocation preference (revokeOtherSessions: false)
      // Must still attempt full revocation per security requirements and fail closed
      const pwChangeReqFalse = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
        method: 'POST',
        headers: {
          cookie: sessionACookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: fcPassword,
          newPassword: 'AnotherPassword2026!$',
          revokeOtherSessions: false,
        }),
      });

      const resFalse = await authRoutePOST(pwChangeReqFalse);
      expect(resFalse.status).not.toBe(200);
      expect([500, 503]).toContain(resFalse.status);

      // Verify account.password hash remains unchanged
      const accDuringFault2 = await prisma.account.findFirst({
        where: { userId: fcUserId, providerId: 'credential' },
      });
      expect(accDuringFault2?.password).toBe(hashedPassword);

      // Verify both contexts remain valid
      const actorAFault2 = await requireActor({ headers: new Headers({ cookie: sessionACookie }) });
      expect(actorAFault2.id).toBe(fcUserId);
      const getSessAFault2 = await authRouteGET(new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
        headers: { cookie: sessionACookie },
      }));
      expect(getSessAFault2.status).toBe(200);
      const sessA2Json = await getSessAFault2.json();
      expect(sessA2Json?.user?.id).toBe(fcUserId);

      const actorBFault2 = await requireActor({ headers: new Headers({ cookie: sessionBCookie }) });
      expect(actorBFault2.id).toBe(fcUserId);
      const getSessBFault2 = await authRouteGET(new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
        headers: { cookie: sessionBCookie },
      }));
      expect(getSessBFault2.status).toBe(200);
      const sessB2Json = await getSessBFault2.json();
      expect(sessB2Json?.user?.id).toBe(fcUserId);

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

      // 3. Retry password change from Context A after fault removal (including stale content-length header)
      const pwChangeRetryReq = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
        method: 'POST',
        headers: {
          cookie: sessionACookie,
          'content-type': 'application/json',
          'content-length': '2',
        },
        body: JSON.stringify({
          currentPassword: fcPassword,
          newPassword: 'AnotherPassword2026!$',
        }),
      });
      const pwChangeRetryRes = await authRoutePOST(pwChangeRetryReq);
      expect(pwChangeRetryRes.status).toBe(200);
      const retryBody = await pwChangeRetryRes.json();
      expect(Object.hasOwn(retryBody, 'token')).toBe(false);

      const retrySetCookies =
        pwChangeRetryRes.headers.getSetCookie?.() || [
          pwChangeRetryRes.headers.get('set-cookie') || '',
        ];
      const newSessionCookieHeader = retrySetCookies.find((c) =>
        c.includes('better-auth.session_token=')
      );
      expect(newSessionCookieHeader).toBeDefined();
      const newSessionACookie = newSessionCookieHeader!.split(';')[0];

      // Verify account.password hash has now changed
      const accAfterSuccess = await prisma.account.findFirst({
        where: { userId: fcUserId, providerId: 'credential' },
      });
      expect(accAfterSuccess?.password).not.toBe(hashedPassword);

      // Context A with newly issued session continues and is accepted across both entry points
      const actorAAfter = await requireActor({ headers: new Headers({ cookie: newSessionACookie }) });
      expect(actorAAfter.id).toBe(fcUserId);
      const getSessAAfter = await authRouteGET(
        new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
          headers: { cookie: newSessionACookie },
        })
      );
      expect(getSessAAfter.status).toBe(200);
      const sessAAfterJson = await getSessAAfter.json();
      expect(sessAAfterJson?.user?.id).toBe(fcUserId);

      // Prior Session A (predating credential change) is revoked/deleted and rejected
      const priorSessionAInDb = await prisma.session.findFirst({
        where: { token: sessionAToken },
      });
      expect(priorSessionAInDb).toBeNull();
      await expect(
        requireActor({ headers: new Headers({ cookie: sessionACookie }) })
      ).rejects.toThrowError(AuthenticationError);

      const getSessAPriorAfter = await authRouteGET(
        new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
          headers: { cookie: sessionACookie },
        })
      );
      if (getSessAPriorAfter.status === 200) {
        expect(await getSessAPriorAfter.json()).toBeNull();
      } else {
        expect(getSessAPriorAfter.status).toBe(401);
      }

      // Verify Context B is evicted from session table and rejected across both entry points
      const sessionBAfter = await prisma.session.findFirst({
        where: { token: sessionBToken },
      });
      expect(sessionBAfter).toBeNull();

      await expect(
        requireActor({ headers: new Headers({ cookie: sessionBCookie }) })
      ).rejects.toThrowError(AuthenticationError);

      const getSessBAfter = await authRouteGET(
        new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
          headers: { cookie: sessionBCookie },
        })
      );
      if (getSessBAfter.status === 200) {
        expect(await getSessBAfter.json()).toBeNull();
      } else {
        expect(getSessBAfter.status).toBe(401);
      }
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
    const verifyJson1Token = await browserSessionToken(verifyRes1);

    // Verify authenticated session issued
    const actor1 = await requireActor({ headers: makeSessionHeaders(verifyJson1Token) });
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

  it('rejects HTTP request with idle session token even when accompanied by invalid secure decoy cookie in any order (R02, R03)', async () => {
    const prisma = getPrismaClient();
    const env = getEnv();

    let targetUserId = provisionedOwner?.userId;
    if (!targetUserId) {
      const ownerUser = await prisma.user.findFirst({ where: { role: 'OWNER' } });
      if (ownerUser) {
        targetUserId = ownerUser.id;
      } else {
        const testUser = await prisma.user.create({
          data: {
            id: `test-user-${Date.now()}`,
            name: 'مالك الاختبار',
            email: `test-owner-${Date.now()}@office.eg`,
            role: 'OWNER',
            twoFactorEnabled: true,
          },
        });
        await prisma.twoFactor.create({
          data: {
            id: `tf-test-${Date.now()}`,
            userId: testUser.id,
            secret: 'base32:GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
            backupCodes: '[]',
            verified: true,
          },
        });
        targetUserId = testUser.id;
      }
    }

    // 1. Create a consistently aged session: 40 mins old, 31 mins idle (inactive), credentials predate login, 11h remaining
    const idlePlainToken = `plain-idle-${Date.now()}`;
    const idlePlainSession = await prisma.session.create({
      data: {
        id: `sess-plain-idle-${Date.now()}`,
        userId: targetUserId,
        token: idlePlainToken,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(Date.now() - 31 * 60 * 1000), // 31 mins idle (> 30m timeout)
        expiresAt: new Date(Date.now() + 11 * 3600 * 1000),
      },
    });

    const signedPlainCookie = signSessionTokenCookie(idlePlainToken, env.BETTER_AUTH_SECRET);

    // Request over HTTP with invalid secure decoy before plain cookie
    const req1 = new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: {
        cookie: `__Secure-better-auth.session_token=decoy-invalid-token; better-auth.session_token=${signedPlainCookie}`,
      },
    });

    const res1 = await authRouteGET(req1);
    expect(res1.status).toBe(401);

    // Verify session was deleted from database
    const inDb1 = await prisma.session.findUnique({ where: { id: idlePlainSession.id } });
    expect(inDb1).toBeNull();

    // Subsequent requireActor fails closed
    await expect(requireActor({ headers: makeSessionHeaders(idlePlainToken) })).rejects.toThrowError(
      AuthenticationError
    );

    // 2. Test reverse cookie order (plain cookie before invalid secure decoy)
    const idlePlainToken2 = `plain-idle-2-${Date.now()}`;
    const idlePlainSession2 = await prisma.session.create({
      data: {
        id: `sess-plain-idle-2-${Date.now()}`,
        userId: targetUserId,
        token: idlePlainToken2,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(Date.now() - 31 * 60 * 1000),
        expiresAt: new Date(Date.now() + 11 * 3600 * 1000),
      },
    });

    const signedPlainCookie2 = signSessionTokenCookie(idlePlainToken2, env.BETTER_AUTH_SECRET);
    const req2 = new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: {
        cookie: `better-auth.session_token=${signedPlainCookie2}; __Secure-better-auth.session_token=decoy-invalid-token`,
      },
    });

    const res2 = await authRouteGET(req2);
    expect(res2.status).toBe(401);
    const inDb2 = await prisma.session.findUnique({ where: { id: idlePlainSession2.id } });
    expect(inDb2).toBeNull();

    // 3. Test active session (5 mins idle) with invalid secure decoy: must NOT be rejected or deleted
    // Ensure account credentials predate session creation so credential-invalidation is not falsely triggered
    await prisma.account.updateMany({
      where: { userId: targetUserId, providerId: 'credential' },
      data: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const activePlainToken = `plain-active-${Date.now()}`;
    const activePlainSession = await prisma.session.create({
      data: {
        id: `sess-plain-active-${Date.now()}`,
        userId: targetUserId,
        token: activePlainToken,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 mins idle (active)
        expiresAt: new Date(Date.now() + 11 * 3600 * 1000),
      },
    });

    const signedActiveCookie = signSessionTokenCookie(activePlainToken, env.BETTER_AUTH_SECRET);
    const req3 = new NextRequest('http://127.0.0.1:3000/api/auth/get-session', {
      headers: {
        cookie: `__Secure-better-auth.session_token=decoy-invalid-token; better-auth.session_token=${signedActiveCookie}`,
      },
    });

    const res3 = await authRouteGET(req3);
    expect(res3.status).toBe(200);

    const actorActive = await requireActor({ headers: makeSessionHeaders(activePlainToken) });
    expect(actorActive.id).toBe(targetUserId);

    // Clean up
    await prisma.session.delete({ where: { id: activePlainSession.id } }).catch(() => {});
  });

  it('rejects HTTPS request with idle __Secure session token even when accompanied by invalid decoy plain cookie (R03)', async () => {
    const prisma = getPrismaClient();

    let targetUserId = provisionedOwner?.userId;
    if (!targetUserId) {
      const ownerUser = await prisma.user.findFirst({ where: { role: 'OWNER' } });
      targetUserId = ownerUser ? ownerUser.id : (await prisma.user.create({
        data: {
          id: `test-https-user-${Date.now()}`,
          name: 'مالك الاختبار آمن',
          email: `test-https-${Date.now()}@office.eg`,
          role: 'OWNER',
          twoFactorEnabled: true,
        },
      })).id;
    }

    // Create an idle session (> 30 mins)
    const idleToken = `secure-idle-${Date.now()}`;
    await prisma.session.create({
      data: {
        id: `sess-sec-idle-${Date.now()}`,
        userId: targetUserId,
        token: idleToken,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(Date.now() - 32 * 60 * 1000),
        expiresAt: new Date(Date.now() + 10 * 3600 * 1000),
      },
    });

    // Configure provider for HTTPS
    const prevAuthUrl = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = 'https://office.lawoffice.internal:3000';
    getEnv(true);
    global.__lawoffice_auth = undefined;

    try {
      const env = getEnv();
      const req = new NextRequest('https://office.lawoffice.internal:3000/api/auth/get-session', {
        headers: {
          cookie: `better-auth.session_token=decoy-invalid-token; __Secure-better-auth.session_token=${signSessionTokenCookie(idleToken, env.BETTER_AUTH_SECRET)}`,
        },
      });

      const res = await authRouteGET(req);
      // Must be rejected as 401 (inactivity timeout), NOT refreshed or allowed to pass
      expect(res.status).toBe(401);

      // Verify idle session was deleted from database
      const inDb = await prisma.session.findUnique({ where: { token: idleToken } });
      expect(inDb).toBeNull();
    } finally {
      process.env.BETTER_AUTH_URL = prevAuthUrl || 'http://127.0.0.1:3000';
      getEnv(true);
      global.__lawoffice_auth = undefined;
    }
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
      await applyAllTestMigrations(freshBootstrapDb.pool);

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
      await applyAllTestMigrations(freshDb.pool);

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
      await clearGlobalSingletons();
    }
  }, 45000);

  it('rechecks authoritative state under FOR UPDATE lock: queued resume rejects after confirmation commits (R06)', async () => {
    // 1. Fresh dedicated unbootstrapped database
    const freshDb = await createDedicatedTestDatabase();
    const prevUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = freshDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    try {
      await applyAllTestMigrations(freshDb.pool);
      const prismaFresh = getPrismaClient();

      // Start fresh reservation for an owner
      const initial = await provisionOwner({
        name: 'الأستاذ عادل المالك',
        email: 'adel.lawyer@office.eg',
        password: 'OriginalPassword2026!',
      });
      expect(initial.user.id).toBeDefined();

      // Acquire an external row lock on twoFactor record using a dedicated PostgreSQL client from the pool
      const blockerClient = await freshDb.pool.connect();
      await blockerClient.query('BEGIN;');
      await blockerClient.query('SELECT id, "userId", verified FROM "twoFactor" WHERE "userId" = $1 FOR UPDATE;', [initial.user.id]);

      // Both confirm and resume will now queue behind blockerClient's FOR UPDATE row lock
      const validCode = await generateTotpCode(initial.totpSecret);

      let confirmFinished = false;
      let resumeFinished = false;
      let resumeError: unknown = null;
      let resumeResult: unknown = null;

      const confirmPromise = confirmOwnerProvisioning(initial.user.id, validCode).then(() => {
        confirmFinished = true;
      });

      // Observable barrier: wait until confirmation physically blocks on the PostgreSQL FOR UPDATE row lock
      await waitForLockWaiters(freshDb.pool, 1);

      const resumePromise = provisionOwner({
        name: 'الأستاذ عادل المالك',
        email: 'adel.lawyer@office.eg',
        password: 'OriginalPassword2026!',
      })
        .then((res) => {
          resumeFinished = true;
          resumeResult = res;
        })
        .catch((err) => {
          resumeFinished = true;
          resumeError = err;
        });

      // Observable barrier: wait until resume also physically blocks as 2nd waiter on the FOR UPDATE row lock
      await waitForLockWaiters(freshDb.pool, 2);

      // Release blocker lock: COMMIT
      await blockerClient.query('COMMIT;');
      blockerClient.release();

      // Wait for both concurrent operations to resolve
      await Promise.all([confirmPromise, resumePromise]);

      // Confirmation committed first and closed setup
      expect(confirmFinished).toBe(true);

      // Queued resume must have rejected under the row lock without returning setup material
      expect(resumeFinished).toBe(true);
      expect(resumeResult).toBeNull();
      expect(resumeError).toBeDefined();
      expect((resumeError as ProvisioningError).code).toBe('BOOTSTRAP_ALREADY_CLOSED');

      // Verify authoritative database state: verified remains true, bootstrap remains closed
      const tfFinal = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfFinal?.verified).toBe(true);

      const bsFinal = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bsFinal?.isClosed).toBe(true);
    } finally {
      await clearGlobalSingletons();
      await freshDb.drop().catch(() => {});
      if (prevUrl) {
        process.env.TEST_DATABASE_URL = prevUrl;
        getEnv(true);
      }
      await clearGlobalSingletons();
    }
  }, 45000);

  it('rechecks authoritative state under FOR UPDATE lock: reversed ordering allows resume before confirmation (R06)', async () => {
    // 1. Fresh dedicated unbootstrapped database
    const freshDb = await createDedicatedTestDatabase();
    const prevUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = freshDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    try {
      await applyAllTestMigrations(freshDb.pool);
      const prismaFresh = getPrismaClient();

      // Start fresh reservation for an owner
      const initial = await provisionOwner({
        name: 'الأستاذ كمال المالك',
        email: 'kamal.lawyer@office.eg',
        password: 'OriginalPassword2026!',
      });
      expect(initial.user.id).toBeDefined();

      // Acquire an external row lock on twoFactor record using a dedicated PostgreSQL client from the pool
      const blockerClient = await freshDb.pool.connect();
      await blockerClient.query('BEGIN;');
      await blockerClient.query(
        'SELECT id, "userId", verified FROM "twoFactor" WHERE "userId" = $1 FOR UPDATE;',
        [initial.user.id]
      );

      const validCode = await generateTotpCode(initial.totpSecret);

      let resumeFinished = false;
      let resumeResult: unknown = null;
      let confirmFinished = false;

      // In reversed ordering: resume enqueues first on PostgreSQL lock queue
      const resumePromise = provisionOwner({
        name: 'الأستاذ كمال المالك',
        email: 'kamal.lawyer@office.eg',
        password: 'OriginalPassword2026!',
      }).then((res) => {
        resumeFinished = true;
        resumeResult = res;
      });

      // Observable barrier: wait until resume blocks as 1st waiter
      await waitForLockWaiters(freshDb.pool, 1);

      // Confirm enqueues second on PostgreSQL lock queue
      const confirmPromise = confirmOwnerProvisioning(initial.user.id, validCode).then(() => {
        confirmFinished = true;
      });

      // Observable barrier: wait until confirm blocks as 2nd waiter
      await waitForLockWaiters(freshDb.pool, 2);

      // Release blocker lock: COMMIT
      await blockerClient.query('COMMIT;');
      blockerClient.release();

      // Wait for both concurrent operations to resolve
      await Promise.all([resumePromise, confirmPromise]);

      // Both operations succeed in reversed sequence: resume ran before closure committed,
      // then confirmation ran and closed setup
      expect(resumeFinished).toBe(true);
      expect((resumeResult as { user: { id: string } }).user.id).toBe(initial.user.id);
      expect(confirmFinished).toBe(true);

      // Verify authoritative database state: verified remains true, bootstrap remains closed
      const tfFinal = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfFinal?.verified).toBe(true);

      const bsFinal = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bsFinal?.isClosed).toBe(true);
    } finally {
      await clearGlobalSingletons();
      await freshDb.drop().catch(() => {});
      if (prevUrl) {
        process.env.TEST_DATABASE_URL = prevUrl;
        getEnv(true);
      }
      await clearGlobalSingletons();
    }
  }, 45000);

  it('enforces lockout and expiry under serialized FOR UPDATE lock for failed resume attempts (R06)', async () => {
    const freshDb = await createDedicatedTestDatabase();
    const prevUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = freshDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    try {
      await applyAllTestMigrations(freshDb.pool);
      const prismaFresh = getPrismaClient();

      const initial = await provisionOwner({
        name: 'الأستاذ سمير المحامي',
        email: 'samir.lawyer@office.eg',
        password: 'ValidSecret2026!',
      });
      expect(initial.user.id).toBeDefined();

      // Correction 5: Launch 8 genuinely simultaneous failed attempts against one pending reservation using real PostgreSQL
      const attempts = Array.from({ length: 8 }, () =>
        provisionOwner({
          name: 'الأستاذ سمير المحامي',
          email: 'samir.lawyer@office.eg',
          password: 'WrongPassword!',
        })
      );
      const results = await Promise.allSettled(attempts);

      // All 8 simultaneous attempts must reject
      expect(results.every((r) => r.status === 'rejected')).toBe(true);

      // In PostgreSQL under the FOR UPDATE lock:
      // Attempts 1..4 increment failure count (1..4) with INVALID_INPUT.
      // Attempt 5 sets lockedUntil and throws ACCOUNT_LOCKED.
      // The remaining 3 excess attempts receive ACCOUNT_LOCKED.
      const rejectedReasons = results.map((r) => (r as PromiseRejectedResult).reason);
      const lockedOutAttempts = rejectedReasons.filter(
        (err) => err instanceof ProvisioningError && err.code === 'ACCOUNT_LOCKED'
      );
      expect(lockedOutAttempts.length).toBe(4);

      // Assert persisted failure count is strictly bounded at 5
      const tfLocked = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfLocked?.failedVerificationCount).toBe(5);
      expect(tfLocked?.lockedUntil).not.toBeNull();
      expect(tfLocked?.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // Subsequent attempt while locked rejects with ACCOUNT_LOCKED
      await expect(
        provisionOwner({
          name: 'الأستاذ سمير المحامي',
          email: 'samir.lawyer@office.eg',
          password: 'ValidSecret2026!',
        })
      ).rejects.toThrowError(ProvisioningError);

      try {
        await provisionOwner({
          name: 'الأستاذ سمير المحامي',
          email: 'samir.lawyer@office.eg',
          password: 'ValidSecret2026!',
        });
        expect.unreachable('Should have thrown ACCOUNT_LOCKED');
      } catch (err) {
        expect(err).toBeInstanceOf(ProvisioningError);
        expect((err as ProvisioningError).code).toBe('ACCOUNT_LOCKED');
      }

      // Simulate lock expiry: set lockedUntil to 1 minute in the past
      await prismaFresh.twoFactor.updateMany({
        where: { userId: initial.user.id },
        data: { lockedUntil: new Date(Date.now() - 60000) },
      });

      // After expiry, valid password clears lockout and succeeds
      const resumeResult = await provisionOwner({
        name: 'الأستاذ سمير المحامي',
        email: 'samir.lawyer@office.eg',
        password: 'ValidSecret2026!',
      });
      expect(resumeResult.user.id).toBe(initial.user.id);

      const tfCleared = await prismaFresh.twoFactor.findFirst({ where: { userId: initial.user.id } });
      expect(tfCleared?.failedVerificationCount).toBe(0);
      expect(tfCleared?.lockedUntil).toBeNull();
    } finally {
      await clearGlobalSingletons();
      await freshDb.drop().catch(() => {});
      if (prevUrl) {
        process.env.TEST_DATABASE_URL = prevUrl;
        getEnv(true);
      }
      await clearGlobalSingletons();
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

  it('enforces provider-compatible credential boundaries and state invariants on owner provisioning (F04 / R10-07)', async () => {
    const freshDb = await createDedicatedTestDatabase();
    const prevUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = freshDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    try {
      await applyAllTestMigrations(freshDb.pool);
      const prismaFresh = getPrismaClient();

      // State before attempts: unbootstrapped database
      expect(await prismaFresh.user.count()).toBe(0);
      expect(await prismaFresh.account.count()).toBe(0);
      expect(await prismaFresh.twoFactor.count()).toBe(0);
      const bootstrapBefore = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bootstrapBefore?.isClosed ?? false).toBe(false);

      // 1. Exact 129-character password ('A'.repeat(127) + '!1' => length 129) is rejected fail-closed
      const password129 = 'A'.repeat(127) + '!1';
      expect(password129.length).toBe(129);

      await expect(
        provisionOwner({
          name: 'الأستاذ عادل المالك',
          email: 'valid.owner@office.eg',
          password: password129,
        })
      ).rejects.toThrowError(ProvisioningError);

      try {
        await provisionOwner({
          name: 'الأستاذ عادل المالك',
          email: 'valid.owner@office.eg',
          password: password129,
        });
        expect.unreachable('Should have thrown on 129-char password');
      } catch (err) {
        expect(err).toBeInstanceOf(ProvisioningError);
        expect((err as ProvisioningError).code).toBe('INVALID_INPUT');
        expect((err as ProvisioningError).message).toContain('128');
      }

      // Assert zero rows inserted and bootstrap remains open
      expect(await prismaFresh.user.count()).toBe(0);
      expect(await prismaFresh.account.count()).toBe(0);
      expect(await prismaFresh.twoFactor.count()).toBe(0);
      const bootstrapAfter129 = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bootstrapAfter129?.isClosed ?? false).toBe(false);

      // 2. Malformed email with consecutive dots rejected fail-closed
      await expect(
        provisionOwner({
          name: 'الأستاذ عادل المالك',
          email: 'owner..name@synthetic.invalid',
          password: 'ValidPassword123!',
        })
      ).rejects.toThrowError(ProvisioningError);

      try {
        await provisionOwner({
          name: 'الأستاذ عادل المالك',
          email: 'owner..name@synthetic.invalid',
          password: 'ValidPassword123!',
        });
        expect.unreachable('Should have thrown on consecutive dots in email');
      } catch (err) {
        expect(err).toBeInstanceOf(ProvisioningError);
        expect((err as ProvisioningError).code).toBe('INVALID_INPUT');
        expect((err as ProvisioningError).message).toContain('البريد الإلكتروني');
      }

      // Assert zero rows inserted and bootstrap remains open
      expect(await prismaFresh.user.count()).toBe(0);
      expect(await prismaFresh.account.count()).toBe(0);
      expect(await prismaFresh.twoFactor.count()).toBe(0);
      const bootstrapAfterEmail = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bootstrapAfterEmail?.isClosed ?? false).toBe(false);

      // 3. Exact 128-character password ('A'.repeat(126) + '!1' => length 128) passes input validation and succeeds
      const password128 = 'A'.repeat(126) + '!1';
      expect(password128.length).toBe(128);

      const res128 = await provisionOwner({
        name: 'الأستاذ عادل المالك',
        email: 'valid.owner@office.eg',
        password: password128,
      });
      expect(res128.user.id).toBeDefined();
      expect(res128.totpSecret).toBeDefined();

      // Confirm owner to complete enrollment and close bootstrap
      const validCode = await generateTotpCode(res128.totpSecret);
      await confirmOwnerProvisioning(res128.user.id, validCode);
      const bootstrapConfirmed = await prismaFresh.officeBootstrap.findUnique({ where: { id: 'singleton' } });
      expect(bootstrapConfirmed?.isClosed).toBe(true);

      // 4. Actual login and MFA verification with the exact 128-character password (R11-04)
      const freshOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
      const login128Req = new NextRequest(`${freshOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: freshOrigin },
        body: JSON.stringify({
          email: 'valid.owner@office.eg',
          password: password128,
        }),
      });
      const login128Res = await authRoutePOST(login128Req);
      expect(login128Res.status).toBe(200);
      const login128Json = await login128Res.json();
      expect(login128Json.twoFactorRedirect).toBe(true);

      const tfCookie128 = (login128Res.headers.getSetCookie?.() || [login128Res.headers.get('set-cookie') || ''])
        .find((c) => c.includes('better-auth.two_factor='));
      expect(tfCookie128).toBeDefined();

      const mfaCode128 = await generateTotpCode(res128.totpSecret);
      const mfa128Req = new NextRequest(`${freshOrigin}/api/auth/two-factor/verify-totp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: tfCookie128!.split(';')[0],
          origin: freshOrigin,
        },
        body: JSON.stringify({ code: mfaCode128 }),
      });
      const mfa128Res = await authRoutePOST(mfa128Req);
      expect(mfa128Res.status).toBe(200);
      const mfa128JsonToken = await browserSessionToken(mfa128Res);

      const session128Cookie = `better-auth.session_token=${signSessionTokenCookie(mfa128JsonToken, getEnv().BETTER_AUTH_SECRET)}`;
      const actor128 = await requireActor({ headers: new Headers({ cookie: session128Cookie }) });
      expect(actor128.id).toBe(res128.user.id);
      expect(actor128.role).toBe('OWNER');
    } finally {
      await clearGlobalSingletons();
      await freshDb.drop().catch(() => {});
      if (prevUrl) {
        process.env.TEST_DATABASE_URL = prevUrl;
        getEnv(true);
      }
      await clearGlobalSingletons();
    }
  });

  it('closes alternate recovery-generation paths on /api/auth/two-factor/generate-backup-codes around persistent lock (F06)', async () => {
    const prisma = getPrismaClient();

    // Reset failed count and lock for test isolation
    await prisma.twoFactor.updateMany({
      where: { userId: provisionedOwner.userId },
      data: { failedVerificationCount: 0, lockedUntil: null },
    });

    const tfInitial = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    const initialCodes = tfInitial?.backupCodes;

    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const generateUrl = `${testOrigin}/api/auth/two-factor/generate-backup-codes`;

    // 1. Unauthenticated request to /api/auth/two-factor/generate-backup-codes fails closed with 401
    const unauthReq = new NextRequest(generateUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testOrigin },
      body: JSON.stringify({ password: 'BrandNewPassword2026!#' }),
    });
    const unauthRes = await authRoutePOST(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 2. Authenticated request with session
    const ownerUser = await prisma.user.findUnique({ where: { id: provisionedOwner.userId } });
    const currentVersion = ownerUser?.credentialVersion ?? 1;

    const testSessionToken = `sess-f06-${Date.now()}`;
    await prisma.session.create({
      data: {
        id: `sess-f06-id-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: testSessionToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        credentialVersion: currentVersion,
      },
    });
    const sessionCookieHeader = `better-auth.session_token=${signSessionTokenCookie(testSessionToken, getEnv().BETTER_AUTH_SECRET)}`;

    // Missing password returns 400
    const noPassReq = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
        origin: testOrigin,
      },
      body: JSON.stringify({}),
    });
    const noPassRes = await authRoutePOST(noPassReq);
    expect(noPassRes.status).toBe(400);

    // 2.5 Cross-origin matrix requests with genuine session cookie must be rejected with 403 (R10-03 & R11-03)
    // Variant 1: Untrusted Origin with matching untrusted Host
    const v1Req = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
        origin: 'https://attacker.evil.com',
        host: 'attacker.evil.com',
        'sec-fetch-site': 'same-site',
      },
      body: JSON.stringify({ password: 'WrongPassword999!' }),
    });
    const v1Res = await authRoutePOST(v1Req);
    expect(v1Res.status).toBe(403);
    const tfV1 = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    expect(tfV1?.failedVerificationCount).toBe(0);

    // Variant 2: Cookie-bearing request without Origin or Referer or Fetch Metadata
    const v2Req = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
      },
      body: JSON.stringify({ password: 'WrongPassword999!' }),
    });
    const v2Res = await authRoutePOST(v2Req);
    expect(v2Res.status).toBe(403);
    const tfV2 = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    expect(tfV2?.failedVerificationCount).toBe(0);

    // Variant 3: Origin: null with untrusted Host
    const v3Req = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
        origin: 'null',
        host: 'attacker.evil.com',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ password: 'WrongPassword999!' }),
    });
    const v3Res = await authRoutePOST(v3Req);
    expect(v3Res.status).toBe(403);
    const tfV3 = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    expect(tfV3?.failedVerificationCount).toBe(0);

    // Standard untrusted Origin request
    const crossOriginReq = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
        origin: 'https://malicious.attacker.com',
      },
      body: JSON.stringify({ password: 'BrandNewPassword2026!#' }),
    });
    const crossOriginRes = await authRoutePOST(crossOriginReq);
    expect(crossOriginRes.status).toBe(403);

    // Failure count in twoFactor must NOT be incremented and remains 0
    const tfAfterCrossOrigin = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    expect(tfAfterCrossOrigin?.failedVerificationCount).toBe(0);

    // 3. Wrong password returns 400 and increments failedVerificationCount under atomic lock
    const wrongPassReq = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
        origin: testOrigin,
      },
      body: JSON.stringify({ password: 'WrongPassword999!' }),
    });
    const wrongPassRes = await authRoutePOST(wrongPassReq);
    expect(wrongPassRes.status).toBe(400);

    const tfAfterWrong = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    expect(tfAfterWrong?.failedVerificationCount).toBe(1);
    expect(tfAfterWrong?.backupCodes).toBe(initialCodes); // Untouched

    // Trigger lock: set failedVerificationCount to 5 and lockedUntil in the future
    await prisma.twoFactor.updateMany({
      where: { userId: provisionedOwner.userId },
      data: { failedVerificationCount: 5, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
    });

    // 4. While locked, request returns 429 and does NOT mutate backup codes even if password is correct
    const lockedReq = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
        origin: testOrigin,
      },
      body: JSON.stringify({ password: 'BrandNewPassword2026!#' }),
    });
    const lockedRes = await authRoutePOST(lockedReq);
    expect(lockedRes.status).toBe(429);
    const lockedJson = await lockedRes.json();
    expect(lockedJson.error).toContain('تم قفل الإجراء مؤقتاً');

    const tfWhileLocked = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    expect(tfWhileLocked?.backupCodes).toBe(initialCodes); // Strictly unchanged

    // An elapsed lock must start a fresh attempt window on the next request.
    await prisma.twoFactor.updateMany({
      where: { userId: provisionedOwner.userId },
      data: { failedVerificationCount: 5, lockedUntil: new Date(Date.now() - 1_000) },
    });
    const expiredLockRequest = new NextRequest(generateUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookieHeader, origin: testOrigin },
      body: JSON.stringify({ password: 'Synthetic-Wrong-Password' }),
    });
    const expiredLockResponse = await authRoutePOST(expiredLockRequest);
    expect(expiredLockResponse.status).toBe(400);
    const renewed = await prisma.twoFactor.findFirstOrThrow({ where: { userId: provisionedOwner.userId } });
    expect(renewed.failedVerificationCount).toBe(1);
    expect(renewed.lockedUntil).toBeNull();

    // Valid authenticated request succeeds with 200 and issues 10 new codes
    const validReq = new NextRequest(generateUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeader,
        origin: testOrigin,
      },
      body: JSON.stringify({ password: 'BrandNewPassword2026!#' }),
    });
    const validRes = await authRoutePOST(validReq);
    expect(validRes.status).toBe(200);
    const validJson = await validRes.json();
    expect(Array.isArray(validJson.backupCodes)).toBe(true);
    expect(validJson.backupCodes.length).toBe(10);

    const tfAfterSuccess = await prisma.twoFactor.findFirst({ where: { userId: provisionedOwner.userId } });
    expect(tfAfterSuccess?.backupCodes).not.toBe(initialCodes); // Rotated
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'REGENERATE_RECOVERY_CODES', userId: provisionedOwner.userId },
    });
    expect(event.changedFields).toBeNull();
  });

  it('invalidates prior-password unfinished MFA challenges upon password rotation (F10)', async () => {
    // 1. Establish an active session (Context A) for the owner with current password
    const currentPassword = 'BrandNewPassword2026!#';

    // Context A sign-in:
    const signInReqA = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: currentPassword,
      }),
    });
    const signInResA = await authRoutePOST(signInReqA);
    expect(signInResA.status).toBe(200);
    const tfCookieA = (signInResA.headers.getSetCookie?.() || [signInResA.headers.get('set-cookie') || ''])
      .find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookieA).toBeDefined();

    const codeA = await generateTotpCode(provisionedOwner.totpSecret);
    const verifyReqA = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieA!.split(';')[0],
      },
      body: JSON.stringify({ code: codeA }),
    });
    const verifyResA = await authRoutePOST(verifyReqA);
    expect(verifyResA.status).toBe(200);
    const verifyJsonAToken = await browserSessionToken(verifyResA);
    const sessionTokenA = verifyJsonAToken;
    const sessionCookieHeaderA = `better-auth.session_token=${signSessionTokenCookie(sessionTokenA, getEnv().BETTER_AUTH_SECRET)}`;

    // Verify Context A has an active actor
    const actorA = await requireActor({ headers: new Headers({ cookie: sessionCookieHeaderA }) });
    expect(actorA.id).toBe(provisionedOwner.userId);

    // 2. Client initiates a SECOND login attempt with current password (Context B),
    // receiving twoFactorRedirect and a two_factor challenge cookie, but does NOT complete MFA yet.
    const signInReqB = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: currentPassword,
      }),
    });
    const signInResB = await authRoutePOST(signInReqB);
    expect(signInResB.status).toBe(200);
    const signInJsonB = await signInResB.json();
    expect(signInJsonB.twoFactorRedirect).toBe(true);

    const pendingChallengeCookie = (signInResB.headers.getSetCookie?.() || [signInResB.headers.get('set-cookie') || ''])
      .find((c) => c.includes('better-auth.two_factor='));
    expect(pendingChallengeCookie).toBeDefined();
    const pendingChallengeHeader = pendingChallengeCookie!.split(';')[0];

    // 3. Now, in session Context A, owner rotates password to a newer password
    const rotatedPassword = 'RotatedPassword2026!@#';
    const pwChangeReq = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieHeaderA,
      },
      body: JSON.stringify({
        currentPassword,
        newPassword: rotatedPassword,
        revokeOtherSessions: true,
      }),
    });
    const pwChangeRes = await authRoutePOST(pwChangeReq);
    expect(pwChangeRes.status).toBe(200);

    // 4. The pending challenge (Context B) based on the OLD password credential is now submitted with valid TOTP
    const codeB = await generateTotpCode(provisionedOwner.totpSecret);
    const finishOldChallengeReq = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: pendingChallengeHeader,
      },
      body: JSON.stringify({ code: codeB }),
    });
    const finishOldChallengeRes = await authRoutePOST(finishOldChallengeReq);

    // Must be rejected (non-200 / 401) and issue NO session token cookie
    expect(finishOldChallengeRes.status).not.toBe(200);
    const finishCookies = finishOldChallengeRes.headers.getSetCookie?.() || [
      finishOldChallengeRes.headers.get('set-cookie') || '',
    ];
    const hasIssuedSession = finishCookies.some(
      (c) => c.startsWith('better-auth.session_token=') && !c.includes('Max-Age=0')
    );
    expect(hasIssuedSession).toBe(false);

    // 5. Subsequent sign-in with the NEW password and fresh TOTP succeeds cleanly
    const freshSignInReq = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: rotatedPassword,
      }),
    });
    const freshSignInRes = await authRoutePOST(freshSignInReq);
    expect(freshSignInRes.status).toBe(200);
    const freshTfCookie = (freshSignInRes.headers.getSetCookie?.() || [freshSignInRes.headers.get('set-cookie') || ''])
      .find((c) => c.includes('better-auth.two_factor='));
    expect(freshTfCookie).toBeDefined();

    const freshCode = await generateTotpCode(provisionedOwner.totpSecret);
    const freshVerifyReq = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: freshTfCookie!.split(';')[0],
      },
      body: JSON.stringify({ code: freshCode }),
    });
    const freshVerifyRes = await authRoutePOST(freshVerifyReq);
    expect(freshVerifyRes.status).toBe(200);
    const freshVerifyJsonToken = await browserSessionToken(freshVerifyRes);

    // Reset password back for subsequent tests if any
    const resetPwReq = new NextRequest('http://127.0.0.1:3000/api/auth/change-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `better-auth.session_token=${signSessionTokenCookie(freshVerifyJsonToken, getEnv().BETTER_AUTH_SECRET)}`,
      },
      body: JSON.stringify({
        currentPassword: rotatedPassword,
        newPassword: 'BrandNewPassword2026!#',
        revokeOtherSessions: true,
      }),
    });
    await authRoutePOST(resetPwReq);
  });

  it('invalidates password proof when sign-in completes after password rotation via genuine PostgreSQL barrier (R11-01)', async () => {
    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const currentPassword = 'BrandNewPassword2026!#';
    const rotatedPassword = 'RotatedAgainPassword2026!#';

    // 1. Establish an active session (Context A) for the owner with current password
    const signInReqA = new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testOrigin },
      body: JSON.stringify({
        email: provisionedOwner.email,
        password: currentPassword,
      }),
    });
    const signInResA = await authRoutePOST(signInReqA);
    expect(signInResA.status).toBe(200);
    const tfCookieA = (signInResA.headers.getSetCookie?.() || [signInResA.headers.get('set-cookie') || ''])
      .find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookieA).toBeDefined();

    const codeA = await generateTotpCode(provisionedOwner.totpSecret);
    const verifyReqA = new NextRequest(`${testOrigin}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookieA!.split(';')[0],
        origin: testOrigin,
      },
      body: JSON.stringify({ code: codeA }),
    });
    const verifyResA = await authRoutePOST(verifyReqA);
    expect(verifyResA.status).toBe(200);
    const verifyJsonAToken = await browserSessionToken(verifyResA);
    const sessionTokenA = verifyJsonAToken;
    const sessionCookieHeaderA = `better-auth.session_token=${signSessionTokenCookie(sessionTokenA, getEnv().BETTER_AUTH_SECRET)}`;

    const actorA = await requireActor({ headers: new Headers({ cookie: sessionCookieHeaderA }) });
    expect(actorA.id).toBe(provisionedOwner.userId);

    // 2. Install temporary PostgreSQL trigger on "session" gated on B's User-Agent
    const barrierClient = await pool.connect();
    const barrierLockId = 987654321;
    try {
      await barrierClient.query(`
        CREATE OR REPLACE FUNCTION trg_fn_wait_barrier() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW."userAgent" = 'synthetic-round11-exploit-agent' THEN
            PERFORM pg_advisory_lock(${barrierLockId});
            PERFORM pg_advisory_unlock(${barrierLockId});
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_session_barrier ON "session";
        CREATE TRIGGER trg_session_barrier
          BEFORE INSERT ON "session"
          FOR EACH ROW
          EXECUTE FUNCTION trg_fn_wait_barrier();
      `);

      // Acquire advisory lock on barrierClient so that B will block
      await barrierClient.query(`SELECT pg_advisory_lock(${barrierLockId});`);

      // 3. Begin Context B sign-in with the OLD password
      const signInReqB = new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'synthetic-round11-exploit-agent',
          origin: testOrigin,
        },
        body: JSON.stringify({
          email: provisionedOwner.email,
          password: currentPassword,
        }),
      });

      const signInPromiseB = authRoutePOST(signInReqB);

      // Wait until B reaches the BEFORE INSERT trigger and blocks on advisory lock
      let waitingOnBarrier = false;
      for (let i = 0; i < 50; i++) {
        const lockRes = await pool.query(
          `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${barrierLockId} AND granted = false;`
        );
        if (parseInt(lockRes.rows[0].count, 10) > 0) {
          waitingOnBarrier = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(waitingOnBarrier).toBe(true);

      // 4. Change password through Context A and commit with HTTP 200
      const pwChangeReq = new NextRequest(`${testOrigin}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookieHeaderA,
          origin: testOrigin,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword: rotatedPassword,
          revokeOtherSessions: true,
        }),
      });
      const pwChangeRes = await authRoutePOST(pwChangeReq);
      expect(pwChangeRes.status).toBe(200);

      // 5. Release Context B by unlocking the advisory lock
      await barrierClient.query(`SELECT pg_advisory_unlock(${barrierLockId});`);

      // Await B's sign-in response
      const signInResB = await signInPromiseB;
      expect(signInResB.status).toBe(200);
      const tfCookieB = (signInResB.headers.getSetCookie?.() || [signInResB.headers.get('set-cookie') || ''])
        .find((c) => c.includes('better-auth.two_factor='));
      expect(tfCookieB).toBeDefined();

      // 6. Submit valid TOTP on B's challenge: must return HTTP 401, zero session cookie, and fail requireActor
      const codeB = await generateTotpCode(provisionedOwner.totpSecret);
      const finishBReq = new NextRequest(`${testOrigin}/api/auth/two-factor/verify-totp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: tfCookieB!.split(';')[0],
          origin: testOrigin,
        },
        body: JSON.stringify({ code: codeB }),
      });
      const finishBRes = await authRoutePOST(finishBReq);

      expect(finishBRes.status).toBe(401);
      const finishBCookies = finishBRes.headers.getSetCookie?.() || [
        finishBRes.headers.get('set-cookie') || '',
      ];
      const hasIssuedSessionB = finishBCookies.some(
        (c) => c.startsWith('better-auth.session_token=') && !c.includes('Max-Age=0')
      );
      expect(hasIssuedSessionB).toBe(false);

      // finishBRes returned 401 and issued no session cookie, so requireActor fails closed
      await expect(requireActor({ headers: finishBRes.headers })).rejects.toThrowError(
        expect.objectContaining({ code: 'UNAUTHENTICATED' })
      );

      // 7. Reset password back for subsequent tests
      const freshLoginReq = new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: testOrigin },
        body: JSON.stringify({
          email: provisionedOwner.email,
          password: rotatedPassword,
        }),
      });
      const freshLoginRes = await authRoutePOST(freshLoginReq);
      expect(freshLoginRes.status).toBe(200);
      const freshTf = (freshLoginRes.headers.getSetCookie?.() || [freshLoginRes.headers.get('set-cookie') || ''])
        .find((c) => c.includes('better-auth.two_factor='));
      const freshCode = await generateTotpCode(provisionedOwner.totpSecret);
      const freshMfaReq = new NextRequest(`${testOrigin}/api/auth/two-factor/verify-totp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: freshTf!.split(';')[0],
          origin: testOrigin,
        },
        body: JSON.stringify({ code: freshCode }),
      });
      const freshMfaRes = await authRoutePOST(freshMfaReq);
      const freshMfaJsonToken = await browserSessionToken(freshMfaRes);
      const freshSessionCookie = `better-auth.session_token=${signSessionTokenCookie(freshMfaJsonToken, getEnv().BETTER_AUTH_SECRET)}`;

      const resetPwReq = new NextRequest(`${testOrigin}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: freshSessionCookie,
          origin: testOrigin,
        },
        body: JSON.stringify({
          currentPassword: rotatedPassword,
          newPassword: currentPassword,
          revokeOtherSessions: true,
        }),
      });
      await authRoutePOST(resetPwReq);
    } finally {
      await barrierClient.query(`SELECT pg_advisory_unlock_all();`).catch(() => {});
      await pool.query(`DROP TRIGGER IF EXISTS trg_session_barrier ON "session";`).catch(() => {});
      await pool.query(`DROP FUNCTION IF EXISTS trg_fn_wait_barrier();`).catch(() => {});
      barrierClient.release();
    }
  });

  it('direct requireActor eviction: evicts active session and deletes row from PostgreSQL when user.credentialVersion increments (R12-01 / R12-05)', async () => {
    const prisma = getPrismaClient();
    const env = getEnv();

    const ownerUser = await prisma.user.findUnique({ where: { id: provisionedOwner.userId } });
    const currentVersion = ownerUser?.credentialVersion ?? 1;

    const testSessionToken = `sess-r12-direct-${Date.now()}`;
    const sessionRecord = await prisma.session.create({
      data: {
        id: `sess-r12-id-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: testSessionToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        credentialVersion: currentVersion,
      },
    });

    const sessionCookieHeader = `better-auth.session_token=${signSessionTokenCookie(testSessionToken, env.BETTER_AUTH_SECRET)}`;

    // Verified: requireActor succeeds with valid session
    const actorBefore = await requireActor({ headers: new Headers({ cookie: sessionCookieHeader }) });
    expect(actorBefore.id).toBe(provisionedOwner.userId);

    // Atomically increment user.credentialVersion in PostgreSQL
    await pool.query('UPDATE "user" SET "credentialVersion" = "credentialVersion" + 1 WHERE id = $1', [
      provisionedOwner.userId,
    ]);

    // Calling requireActor now throws AuthenticationError ('SESSION_EXPIRED')
    await expect(
      requireActor({ headers: new Headers({ cookie: sessionCookieHeader }) })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'SESSION_EXPIRED',
        message: expect.stringContaining('تم تغيير كلمة المرور أو إثبات الهوية'),
      })
    );

    // Assert session row was permanently deleted from PostgreSQL
    const sessionInDb = await prisma.session.findUnique({
      where: { id: sessionRecord.id },
    });
    expect(sessionInDb).toBeNull();
  });

  it('companion persistence failure: fails closed with HTTP 500 and cleans up primary challenge when 2fa-cred-ver insert fails (R12-01)', async () => {
    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION fail_companion_insert() RETURNS trigger AS $$
        BEGIN
          IF NEW.identifier LIKE '2fa-cred-ver-%' THEN
            RAISE EXCEPTION 'Simulated PostgreSQL failure during companion verification insert';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_fail_companion_insert ON "verification";
        CREATE TRIGGER trg_fail_companion_insert
        BEFORE INSERT ON "verification"
        FOR EACH ROW
        EXECUTE FUNCTION fail_companion_insert();
      `);

      const signInReq = new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: testOrigin },
        body: JSON.stringify({
          email: provisionedOwner.email,
          password: 'BrandNewPassword2026!#',
        }),
      });

      const signInRes = await authRoutePOST(signInReq);

      expect(signInRes.status).toBe(500);
      const resJson = await signInRes.json();
      expect(resJson.error).toBe('فشل في تهيئة سياق أمان التحقق الثنائي.');

      // Assert no valid 2FA cookies left (either omitted or expired via Max-Age=0 / 1970)
      const setCookies = signInRes.headers.getSetCookie?.() || [
        signInRes.headers.get('set-cookie') || '',
      ];
      const validTfCookie = setCookies.find((c) => {
        if (!c.includes('better-auth.two_factor=')) return false;
        if (c.includes('Max-Age=0') || c.includes('Expires=Thu, 01 Jan 1970')) return false;
        const val = c.split(';')[0].split('=')[1];
        return val && val.length > 0;
      });
      expect(validTfCookie).toBeUndefined();

      // Assert companion records and primary verification record for this user are cleaned up
      const verifRows = await pool.query(
        'SELECT * FROM "verification" WHERE value = $1 OR identifier LIKE $2',
        [provisionedOwner.userId, '2fa-cred-ver-%']
      );
      expect(verifRows.rows.length).toBe(0);
    } finally {
      await client.query('DROP TRIGGER IF EXISTS trg_fail_companion_insert ON "verification";').catch(() => {});
      await client.query('DROP FUNCTION IF EXISTS fail_companion_insert();').catch(() => {});
      client.release();
    }
  });

  it('rotation failure: rolls back PostgreSQL transaction when user.credentialVersion update fails and preserves original password hash (R12-01)', async () => {
    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const prisma = getPrismaClient();
    const env = getEnv();

    // 1. Establish an active session for the owner
    const testSessionToken = `sess-r12-rotfail-${Date.now()}`;
    const ownerUser = await prisma.user.findUnique({ where: { id: provisionedOwner.userId } });
    const currentVersion = ownerUser?.credentialVersion ?? 1;

    await prisma.session.create({
      data: {
        id: `sess-r12-rotfail-id-${Date.now()}`,
        userId: provisionedOwner.userId,
        token: testSessionToken,
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
        credentialVersion: currentVersion,
      },
    });

    const sessionCookieHeader = `better-auth.session_token=${signSessionTokenCookie(testSessionToken, env.BETTER_AUTH_SECRET)}`;

    // Read initial password hash from account table
    const accBefore = await prisma.account.findFirst({
      where: { userId: provisionedOwner.userId, providerId: 'credential' },
    });
    expect(accBefore).toBeDefined();
    const originalHashedPassword = accBefore!.password;

    // 2. Attach a trigger on "user" that prevents credentialVersion update
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION fail_user_cred_ver_update() RETURNS trigger AS $$
        BEGIN
          IF NEW."credentialVersion" <> OLD."credentialVersion" THEN
            RAISE EXCEPTION 'Simulated PostgreSQL failure during user credentialVersion update';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_test_fail_cred_ver ON "user";
        CREATE TRIGGER trg_test_fail_cred_ver
        BEFORE UPDATE OF "credentialVersion" ON "user"
        FOR EACH ROW
        EXECUTE FUNCTION fail_user_cred_ver_update();
      `);

      // 3. Attempt password change
      const pwChangeReq = new NextRequest(`${testOrigin}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookieHeader,
          origin: testOrigin,
        },
        body: JSON.stringify({
          currentPassword: 'BrandNewPassword2026!#',
          newPassword: 'AttemptedRotatedPassword2026!#',
          revokeOtherSessions: true,
        }),
      });

      const pwChangeRes = await authRoutePOST(pwChangeReq);

      // Assert password change failed closed (non-200)
      expect(pwChangeRes.status).not.toBe(200);
      expect([500, 503]).toContain(pwChangeRes.status);

      // 4. Assert PostgreSQL transaction rolled back:
      // account.password still contains original password hash and was NOT changed
      const accAfter = await prisma.account.findFirst({
        where: { userId: provisionedOwner.userId, providerId: 'credential' },
      });
      expect(accAfter?.password).toBe(originalHashedPassword);

      // user.credentialVersion was NOT modified
      const userAfter = await prisma.user.findUnique({
        where: { id: provisionedOwner.userId },
      });
      expect(userAfter?.credentialVersion).toBe(currentVersion);
    } finally {
      await client.query('DROP TRIGGER IF EXISTS trg_test_fail_cred_ver ON "user";').catch(() => {});
      await client.query('DROP FUNCTION IF EXISTS fail_user_cred_ver_update();').catch(() => {});
      client.release();
    }
  });

  it('fails closed with HTTP 500 when initial credentialVersion read throws during sign-in (R13-01)', async () => {
    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const credVerModule = await import('@/modules/identity/credential-version');
    const spy = vi
      .spyOn(credVerModule, 'getUserCredentialVersionByEmail')
      .mockRejectedValueOnce(new Error('Simulated database failure during initial credentialVersion read'));

    try {
      const signInReq = new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: testOrigin },
        body: JSON.stringify({
          email: provisionedOwner.email,
          password: 'BrandNewPassword2026!#',
        }),
      });

      const signInRes = await authRoutePOST(signInReq);

      expect(signInRes.status).toBe(500);
      const resJson = await signInRes.json();
      expect(resJson.error).toBe('فشل في قراءة حالة أمان الحساب. يرجى إعادة المحاولة.');

      // Assert zero session or 2FA cookies issued
      const setCookies = signInRes.headers.getSetCookie?.() || [
        signInRes.headers.get('set-cookie') || '',
      ];
      const validCookie = setCookies.find(
        (c) =>
          (c.includes('better-auth.session_token=') || c.includes('better-auth.two_factor=')) &&
          !c.includes('Max-Age=0') &&
          !c.includes('Expires=Thu, 01 Jan 1970')
      );
      expect(validCookie).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('enforces single authoritative rotation boundary: atomically increments to version 2 (not 3) and authorizes replacement session (R13-04)', async () => {
    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const prisma = getPrismaClient();
    const env = getEnv();

    // 1. Create a dedicated user starting cleanly at credentialVersion 1
    const rotUserId = crypto.randomUUID();
    const rotEmail = `rot.boundary.${Date.now()}@office.eg`;
    const initialPass = 'InitialPass2026!#';
    const newPass = 'NewRotatedPass2026!#';
    const { hashPassword, symmetricEncrypt } = await import('better-auth/crypto');
    const initialHash = await hashPassword(initialPass);

    await prisma.user.create({
      data: {
        id: rotUserId,
        name: 'مالك حدود التدوير',
        email: rotEmail,
        emailVerified: true,
        role: 'OWNER',
        twoFactorEnabled: true,
        credentialVersion: 1,
      },
    });

    await prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: rotUserId,
        providerId: 'credential',
        accountId: rotUserId,
        password: initialHash,
      },
    });

    const rotTotpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const encSecret = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: `base32:${rotTotpSecret}`,
    });
    const encBackupCodes = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: JSON.stringify(['code1111', 'code2222']),
    });

    await prisma.twoFactor.create({
      data: {
        id: crypto.randomUUID(),
        userId: rotUserId,
        secret: encSecret,
        backupCodes: encBackupCodes,
        verified: true,
      },
    });

    // 2. Sign in Context A and acquire valid session A
    const signInA = await authRoutePOST(new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testOrigin },
      body: JSON.stringify({ email: rotEmail, password: initialPass }),
    }));
    expect(signInA.status).toBe(200);
    const tfA = (signInA.headers.getSetCookie?.() || [signInA.headers.get('set-cookie') || ''])
      .find((c) => c.includes('better-auth.two_factor='));
    const codeA = await generateTotpCode(rotTotpSecret);
    const verifyA = await authRoutePOST(new NextRequest(`${testOrigin}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfA!.split(';')[0],
        origin: testOrigin,
      },
      body: JSON.stringify({ code: codeA }),
    }));
    expect(verifyA.status).toBe(200);
    const verifyAJsonToken = await browserSessionToken(verifyA);
    const sessionCookieA = `better-auth.session_token=${signSessionTokenCookie(verifyAJsonToken, env.BETTER_AUTH_SECRET)}`;

    // 3. Sign in Context B and acquire valid session B
    const signInB = await authRoutePOST(new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testOrigin },
      body: JSON.stringify({ email: rotEmail, password: initialPass }),
    }));
    expect(signInB.status).toBe(200);
    const tfB = (signInB.headers.getSetCookie?.() || [signInB.headers.get('set-cookie') || ''])
      .find((c) => c.includes('better-auth.two_factor='));
    const codeB = await generateTotpCode(rotTotpSecret);
    const verifyB = await authRoutePOST(new NextRequest(`${testOrigin}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfB!.split(';')[0],
        origin: testOrigin,
      },
      body: JSON.stringify({ code: codeB }),
    }));
    expect(verifyB.status).toBe(200);
    const verifyBJsonToken = await browserSessionToken(verifyB);
    const sessionCookieB = `better-auth.session_token=${signSessionTokenCookie(verifyBJsonToken, env.BETTER_AUTH_SECRET)}`;

    // Verify both session A and session B have credentialVersion: 1
    const userBeforeRot = await prisma.user.findUnique({ where: { id: rotUserId } });
    expect(userBeforeRot?.credentialVersion).toBe(1);

    // 4. In Context A, change password via POST /api/auth/change-password
    const changePwRes = await authRoutePOST(new NextRequest(`${testOrigin}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieA,
        origin: testOrigin,
      },
      body: JSON.stringify({
        currentPassword: initialPass,
        newPassword: newPass,
        revokeOtherSessions: true,
      }),
    }));
    expect(changePwRes.status).toBe(200);

    // 5. Assert user's version in PostgreSQL is EXACTLY 2 (single atomic increment, NO second increment to 3)
    const userAfterRot = await prisma.user.findUnique({ where: { id: rotUserId } });
    expect(userAfterRot?.credentialVersion).toBe(2);

    // Extract replacement session cookie from response
    const changePwCookies = changePwRes.headers.getSetCookie?.() || [changePwRes.headers.get('set-cookie') || ''];
    const repCookieHeader = changePwCookies.find(
      (c) => (c.startsWith('better-auth.session_token=') || c.startsWith('__Secure-better-auth.session_token=')) && !c.includes('Max-Age=0')
    );
    expect(repCookieHeader).toBeDefined();
    const repCookie = repCookieHeader!.split(';')[0];

    // Assert replacement session in PostgreSQL has credentialVersion: 2
    const repSessions = await prisma.session.findMany({ where: { userId: rotUserId } });
    expect(repSessions.length).toBe(1);
    expect(repSessions[0].credentialVersion).toBe(2);

    // 6. Assert replacement session authorizes requireActor
    const actorRep = await requireActor({ headers: new Headers({ cookie: repCookie }) });
    expect(actorRep.id).toBe(rotUserId);

    // 7. Assert old session B is physically revoked from PostgreSQL and fails requireActor
    const oldSessionInDb = await prisma.session.findFirst({ where: { token: verifyBJsonToken } });
    expect(oldSessionInDb).toBeNull();

    await expect(requireActor({ headers: new Headers({ cookie: sessionCookieB }) })).rejects.toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    );

    // 8. Assert fresh login with new password works
    const freshSignIn = await authRoutePOST(new NextRequest(`${testOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testOrigin },
      body: JSON.stringify({ email: rotEmail, password: newPass }),
    }));
    expect(freshSignIn.status).toBe(200);
  });

  it('enforces fresh connection search_path matrix isolation against decoy table hijacking (R13-03)', async () => {
    const origPgOptions = process.env.PGOPTIONS;
    const client = await pool.connect();
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS review_decoy;');
      await client.query(`
        CREATE TABLE IF NOT EXISTS review_decoy."user" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          "emailVerified" BOOLEAN NOT NULL DEFAULT true,
          image TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          role TEXT NOT NULL DEFAULT 'OWNER',
          "twoFactorEnabled" BOOLEAN DEFAULT true,
          "credentialVersion" INTEGER NOT NULL DEFAULT 999
        );
      `);
      await client.query(`
        INSERT INTO review_decoy."user" (id, name, email, role, "credentialVersion")
        VALUES ($1, 'مستخدم تضليلي خبيث', $2, 'OWNER', 999)
        ON CONFLICT (id) DO UPDATE SET "credentialVersion" = 999;
      `, [provisionedOwner.userId, provisionedOwner.email]);

      // Set ambient PGOPTIONS so that fresh connections adopt search_path=review_decoy,public
      process.env.PGOPTIONS = '-c search_path=review_decoy,public';

      const freshPool = new Pool({ connectionString: dedicated.url });
      const freshClient = await freshPool.connect();
      try {
        const spRes = await freshClient.query('SHOW search_path;');
        expect(spRes.rows[0].search_path).toContain('review_decoy');

        // Verify that raw unqualified SELECT FROM "user" hits the decoy
        const rawRes = await freshClient.query('SELECT "credentialVersion" FROM "user" WHERE id = $1', [
          provisionedOwner.userId,
        ]);
        expect(rawRes.rows[0].credentialVersion).toBe(999);

        // Now test that session insertion trigger stamps from public.user (immune to ambient search_path)
        const testSessId = `sess-sp-fresh-${Date.now()}`;
        const sessRes = await freshClient.query(
          'INSERT INTO public."session" (id, "userId", token, "expiresAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW() + interval \'1 hour\', NOW(), NOW()) RETURNING "credentialVersion"',
          [testSessId, provisionedOwner.userId, `tok-${testSessId}`]
        );
        // Must be stamped with public.user credentialVersion (e.g. 1 or 2), NOT 999!
        expect(sessRes.rows[0].credentialVersion).not.toBe(999);

        const pubUserVer = await client.query('SELECT "credentialVersion" FROM public."user" WHERE id = $1', [
          provisionedOwner.userId,
        ]);
        expect(sessRes.rows[0].credentialVersion).toBe(pubUserVer.rows[0].credentialVersion);

        // Clean up test session
        await freshClient.query('DELETE FROM public."session" WHERE id = $1', [testSessId]);
      } finally {
        freshClient.release();
        await freshPool.end();
      }
    } finally {
      if (origPgOptions !== undefined) {
        process.env.PGOPTIONS = origPgOptions;
      } else {
        delete process.env.PGOPTIONS;
      }
      await client.query('DROP SCHEMA IF EXISTS review_decoy CASCADE;').catch(() => {});
      client.release();
    }
  });

  it('enforces database and role search_path isolation against malicious search_path redirection (R11-04)', async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS evil_schema;
        CREATE TABLE IF NOT EXISTS evil_schema."user" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          "emailVerified" BOOLEAN NOT NULL DEFAULT true,
          image TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          role TEXT NOT NULL DEFAULT 'OWNER',
          "twoFactorEnabled" BOOLEAN DEFAULT true
        );
        INSERT INTO evil_schema."user" (id, name, email, role)
        VALUES ('decoy-evil-user-id', 'مهاجم خبيث', 'attacker@evil.invalid', 'OWNER')
        ON CONFLICT (id) DO NOTHING;
      `);

      // Verify that Prisma and identity queries pin to public schema
      // Even if ambient PGOPTIONS or search_path is set to evil_schema, public
      const originalPgOptions = process.env.PGOPTIONS;
      process.env.PGOPTIONS = '-c search_path=evil_schema,public';
      try {
        const isolatedPool = new Pool({
          connectionString: dedicated.url,
        });
        const isolatedClient = await isolatedPool.connect();
        try {
          // Unqualified raw query hits evil_schema."user" due to search_path
          const unqualifiedRes = await isolatedClient.query('SELECT name FROM "user" ORDER BY "createdAt" ASC LIMIT 1');
          expect(unqualifiedRes.rows[0].name).toBe('مهاجم خبيث');

          // BUT our application and Prisma adapter explicitly pin public schema
          const prisma = getPrismaClient();
          const publicUsers = await prisma.user.findMany({
            where: { id: 'decoy-evil-user-id' },
          });
          // Must NOT find the decoy attacker in public user catalog
          expect(publicUsers.length).toBe(0);

          // Authentic owner in public schema is resolved
          const authenticOwner = await prisma.user.findFirst({
            where: { email: provisionedOwner.email },
          });
          expect(authenticOwner).toBeDefined();
          expect(authenticOwner?.email).toBe(provisionedOwner.email);
        } finally {
          isolatedClient.release();
          await isolatedPool.end();
        }
      } finally {
        if (originalPgOptions !== undefined) {
          process.env.PGOPTIONS = originalPgOptions;
        } else {
          delete process.env.PGOPTIONS;
        }
      }
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS evil_schema CASCADE;`).catch(() => {});
      client.release();
    }
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

describe('R14 atomic credential rotation and application namespace isolation', () => {
  const password = 'SyntheticR14Password2026!';
  const newPassword = 'SyntheticR14Replacement2026!';
  let baseUrl: string;
  let originalPgOptions: string | undefined;
  let fixture: Awaited<ReturnType<typeof createDedicatedTestDatabase>>;
  let owner: Awaited<ReturnType<typeof provisionOwner>>;
  let ownedRole: string | undefined;

  function request(endpoint: string, body: Record<string, unknown>, cookie = '') {
    const origin = new URL(getEnv().BETTER_AUTH_URL).origin;
    return new NextRequest(`${origin}/api/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  function responseCookie(response: Response, name: string): string {
    const header = response.headers.getSetCookie().find((value) =>
      value.startsWith(`better-auth.${name}=`) && !value.includes('Max-Age=0')
    );
    expect(header).toBeDefined();
    return header!.split(';')[0];
  }

  async function signIn(currentPassword = password) {
    return authRoutePOST(request('sign-in/email', { email: owner.user.email, password: currentPassword }));
  }

  async function login(currentPassword = password) {
    const challenge = await signIn(currentPassword);
    expect(challenge.status).toBe(200);
    const verification = await authRoutePOST(request('two-factor/verify-totp', {
      code: await generateTotpCode(owner.totpSecret),
    }, responseCookie(challenge, 'two_factor')));
    expect(verification.status).toBe(200);
    const cookie = responseCookie(verification, 'session_token');
    expect((await requireActor({ headers: new Headers({ cookie }) })).id).toBe(owner.user.id);
    return cookie;
  }

  beforeEach(async () => {
    baseUrl = process.env.TEST_DATABASE_URL!;
    originalPgOptions = process.env.PGOPTIONS;
    delete process.env.PGOPTIONS;
    await clearGlobalSingletons();
    fixture = await createDedicatedTestDatabase();
    process.env.TEST_DATABASE_URL = fixture.url;
    getEnv(true);
    for (const migration of [
      '20261111000000_init_auth',
      '20261114000000_credential_version',
      '20261117000000_parties_communication_poa',
      '20261122010000_audit_password_rotation',
    ]) {
      await fixture.pool.query(fs.readFileSync(path.resolve('prisma/migrations', migration, 'migration.sql'), 'utf8'));
    }
    owner = await provisionOwner({ name: 'مالك اختبار المعاملات', email: 'r14.owner@synthetic.invalid', password });
    await confirmOwnerProvisioning(owner.user.id, await generateTotpCode(owner.totpSecret));
  }, 30000);

  afterEach(async () => {
    await clearGlobalSingletons();
    if (fixture) await fixture.drop();
    if (ownedRole) {
      const admin = new Pool({ connectionString: baseUrl });
      try {
        // Only this test's randomly named role; its exclusively owned database is already gone.
        await admin.query(`DROP ROLE "${ownedRole}"`);
      } finally {
        await admin.end();
        ownedRole = undefined;
      }
    }
    process.env.TEST_DATABASE_URL = baseUrl;
    if (originalPgOptions === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = originalPgOptions;
    getEnv(true);
  }, 30000);

  it('revalidates a visible session without extending its inactivity window', async () => {
    const cookie = await login();
    const getSessionRow = async () => (await fixture.pool.query(
      'SELECT id, "updatedAt" FROM public.session WHERE "userId"=$1',
      [owner.user.id],
    )).rows[0];
    const before = await getSessionRow();
    const response = await viewSessionGET(new Request(`${getEnv().BETTER_AUTH_URL}/api/auth/view-session`, {
      headers: { cookie },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ actorId: owner.user.id, sessionId: before.id, role: 'OWNER', name: owner.user.name, email: owner.user.email });
    expect(await getSessionRow()).toEqual(before);
  });

  it.each(['replacement insert', 'session revocation'] as const)(
    'R14 atomic rotation rolls back %s failure and permits a coherent retry',
    async (fault) => {
      const sessionA = await login();
      const sessionB = await login();
      const before = (await fixture.pool.query('SELECT password FROM public.account WHERE "userId"=$1', [owner.user.id])).rows[0];
      const sessionsBefore = (await fixture.pool.query('SELECT id FROM public.session WHERE "userId"=$1 ORDER BY id', [owner.user.id])).rows;
      const pending = await signIn();
      expect(pending.status).toBe(200);
      const pendingCookie = responseCookie(pending, 'two_factor');
      const verificationBefore = (await fixture.pool.query('SELECT id FROM public.verification ORDER BY id')).rows;

      await fixture.pool.query(fault === 'replacement insert' ? `
        CREATE FUNCTION public.r14_rotation_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF (SELECT "credentialVersion" FROM public."user" WHERE id=NEW."userId") > 1 THEN
            RAISE EXCEPTION 'synthetic replacement insertion fault';
          END IF;
          RETURN NEW;
        END; $$;
        CREATE TRIGGER r14_rotation_fault BEFORE INSERT ON public.session
        FOR EACH ROW EXECUTE FUNCTION public.r14_rotation_fault();
      ` : `
        CREATE FUNCTION public.r14_rotation_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic revocation fault'; END; $$;
        CREATE TRIGGER r14_rotation_fault BEFORE DELETE ON public.session
        FOR EACH ROW EXECUTE FUNCTION public.r14_rotation_fault();
      `);
      try {
        const result = await authRoutePOST(request('change-password', { currentPassword: password, newPassword }, sessionA));
        expect(result.status).toBe(500);
        expect(result.headers.getSetCookie().some((value) => value.startsWith('better-auth.session_token=') && !value.includes('Max-Age=0'))).toBe(false);
        expect((await fixture.pool.query('SELECT password FROM public.account WHERE "userId"=$1', [owner.user.id])).rows[0].password).toBe(before.password);
        expect((await fixture.pool.query('SELECT "credentialVersion" FROM public."user" WHERE id=$1', [owner.user.id])).rows[0].credentialVersion).toBe(1);
        expect((await fixture.pool.query('SELECT id FROM public.session WHERE "userId"=$1 ORDER BY id', [owner.user.id])).rows).toEqual(sessionsBefore);
        expect((await fixture.pool.query('SELECT id FROM public.verification ORDER BY id')).rows).toEqual(verificationBefore);
        expect((await requireActor({ headers: new Headers({ cookie: sessionA }) })).id).toBe(owner.user.id);
        expect((await requireActor({ headers: new Headers({ cookie: sessionB }) })).id).toBe(owner.user.id);
      } finally {
        await fixture.pool.query('DROP TRIGGER r14_rotation_fault ON public.session; DROP FUNCTION public.r14_rotation_fault();');
      }
      const readPasswordAudits = async () => (await fixture.pool.query(`
        SELECT "action", "entityType", "entityId", "changedFields" FROM public.audit_event
        WHERE "userId" = $1 AND "action" IN ('CHANGE_PASSWORD', 'REJECT_PASSWORD_CHANGE')
        ORDER BY "createdAt", "action"
      `, [owner.user.id])).rows;
      expect(await readPasswordAudits()).toEqual([
        { action: 'REJECT_PASSWORD_CHANGE', entityType: 'User', entityId: owner.user.id, changedFields: null },
      ]);
      // A failed rotation preserves the old credential and denies the uncommitted new one.
      expect((await signIn(newPassword)).status).toBe(401);
      await login();
      const retry = await authRoutePOST(request('change-password', { currentPassword: password, newPassword }, sessionA));
      expect(retry.status).toBe(200);
      expect(await readPasswordAudits()).toEqual([
        { action: 'REJECT_PASSWORD_CHANGE', entityType: 'User', entityId: owner.user.id, changedFields: null },
        { action: 'CHANGE_PASSWORD', entityType: 'User', entityId: owner.user.id, changedFields: null },
      ]);
      const replacement = responseCookie(retry, 'session_token');
      expect((await requireActor({ headers: new Headers({ cookie: replacement }) })).id).toBe(owner.user.id);
      expect((await fixture.pool.query('SELECT "credentialVersion" FROM public."user" WHERE id=$1', [owner.user.id])).rows[0].credentialVersion).toBe(2);
      for (const oldCookie of [sessionA, sessionB]) {
        await expect(requireActor({ headers: new Headers({ cookie: oldCookie }) })).rejects.toThrow();
      }
      const oldProof = await authRoutePOST(request('two-factor/verify-totp', { code: await generateTotpCode(owner.totpSecret) }, pendingCookie));
      expect(oldProof.status).not.toBe(200);
      expect((await signIn()).status).toBe(401);
      await login(newPassword);
    }, 30000
  );

  it.each(['PGOPTIONS', 'database default', 'role default'] as const)(
    'R14 fresh application connections isolate both security triggers under %s',
    async (setting) => {
      await fixture.pool.query(`
        CREATE SCHEMA review_decoy;
        CREATE TABLE review_decoy."user" (LIKE public."user" INCLUDING ALL);
        INSERT INTO review_decoy."user" SELECT * FROM public."user";
        UPDATE review_decoy."user" SET "credentialVersion"=999;
        CREATE TABLE review_decoy.session (LIKE public.session INCLUDING ALL);
        CREATE TABLE review_decoy.account (LIKE public.account INCLUDING ALL);
        INSERT INTO review_decoy.account SELECT * FROM public.account;
        CREATE TABLE review_decoy.verification (LIKE public.verification INCLUDING ALL);
        INSERT INTO review_decoy.verification (id,identifier,value,"expiresAt","createdAt","updatedAt")
        VALUES ('r14-decoy','2fa-cred-ver-r14-decoy','999',NOW()+interval '1 hour',NOW(),NOW());
      `);
      const databaseName = new URL(fixture.url).pathname.slice(1);
      if (setting === 'PGOPTIONS') process.env.PGOPTIONS = '-c search_path=review_decoy,public';
      if (setting === 'database default') {
        await fixture.pool.query(`ALTER DATABASE "${databaseName}" SET search_path=review_decoy,public`);
      }
      if (setting === 'role default') {
        ownedRole = `r14_app_${crypto.randomUUID().replace(/-/g, '')}`;
        await fixture.pool.query(`CREATE ROLE "${ownedRole}" LOGIN PASSWORD 'synthetic-r14-role';
          GRANT USAGE ON SCHEMA public,review_decoy TO "${ownedRole}";
          GRANT ALL ON ALL TABLES IN SCHEMA public,review_decoy TO "${ownedRole}";
          GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${ownedRole}";
          ALTER ROLE "${ownedRole}" SET search_path=review_decoy,public;`);
        const appUrl = new URL(fixture.url);
        appUrl.username = ownedRole;
        appUrl.password = 'synthetic-r14-role';
        process.env.TEST_DATABASE_URL = appUrl.toString();
      }
      // Discard every application singleton, so the actual provider and Prisma use new connections.
      await clearGlobalSingletons();
      getEnv(true);
      const prisma = getPrismaClient();
      const actualPath = await prisma.$queryRawUnsafe<Array<{ search_path: string }>>('SHOW search_path');
      expect(actualPath[0].search_path.split(',').map((schema) => schema.trim())).toEqual(['review_decoy', 'public']);
      const unqualified = await prisma.$queryRawUnsafe<Array<{ credentialVersion: number }>>('SELECT "credentialVersion" FROM "user"');
      expect(unqualified[0].credentialVersion).toBe(999);
      const session = await login();
      const pending = await signIn();
      const pendingCookie = responseCookie(pending, 'two_factor');
      expect((await fixture.pool.query('SELECT "credentialVersion" FROM public.session WHERE "userId"=$1', [owner.user.id])).rows.every((row) => row.credentialVersion === 1)).toBe(true);
      const rotation = await authRoutePOST(request('change-password', { currentPassword: password, newPassword }, session));
      expect(rotation.status).toBe(200);
      const replacement = responseCookie(rotation, 'session_token');
      expect((await requireActor({ headers: new Headers({ cookie: replacement }) })).id).toBe(owner.user.id);
      expect((await fixture.pool.query('SELECT "credentialVersion" FROM public."user" WHERE id=$1', [owner.user.id])).rows[0].credentialVersion).toBe(2);
      const sessions = (await fixture.pool.query('SELECT "credentialVersion" FROM public.session WHERE "userId"=$1', [owner.user.id])).rows;
      expect(sessions).toEqual([{ credentialVersion: 2 }]);
      expect((await fixture.pool.query("SELECT count(*)::int n FROM public.verification WHERE identifier LIKE '2fa-cred-ver-%'")).rows[0].n).toBe(0);
      await expect(requireActor({ headers: new Headers({ cookie: session }) })).rejects.toThrow();
      expect((await authRoutePOST(request('two-factor/verify-totp', { code: await generateTotpCode(owner.totpSecret) }, pendingCookie))).status).not.toBe(200);
      expect((await signIn()).status).toBe(401);
      await login(newPassword);
      expect((await fixture.pool.query('SELECT "credentialVersion" FROM review_decoy."user"')).rows[0].credentialVersion).toBe(999);
      expect((await fixture.pool.query("SELECT count(*)::int n FROM review_decoy.verification WHERE id='r14-decoy'")).rows[0].n).toBe(1);
      const decoyPassword = (await fixture.pool.query('SELECT password FROM review_decoy.account')).rows[0].password;
      const { verifyPassword } = await import('better-auth/crypto');
      expect(await verifyPassword({ hash: decoyPassword, password })).toBe(true);
    }, 30000
  );
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
      await applyAllTestMigrations(sentinelDb.pool);

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
