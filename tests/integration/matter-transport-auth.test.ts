import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import http from 'http';
import crypto from 'crypto';
import { Pool } from 'pg';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { createDedicatedTestDatabase, validateTestEnvironment } from '../helpers/test-db';
import { runIdentityBaseline } from '@/cli/baseline-identity';
import { provisionOwner, confirmOwnerProvisioning } from '@/modules/identity';
import { closeDbPool } from '@/lib/db';
import { getEnv } from '@/lib/env';

async function clearGlobalSingletons(): Promise<void> {
  await globalThis.__lawoffice_prisma?.$disconnect();
  await closeDbPool().catch(() => {});
  const g = globalThis as Record<string, unknown>;
  delete g.__lawoffice_pg_pool;
  delete g.__lawoffice_prisma;
  delete g.__lawoffice_auth;
}

const RESERVED_NEXT_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109,
  110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045,
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

function getFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => {
        if (err) return reject(err);
        if (port < 1024 || RESERVED_NEXT_PORTS.has(port)) resolve(getFreeLoopbackPort());
        else resolve(port);
      });
    });
  });
}

function isPortClosed(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.on('connect', () => {
      socket.end();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(true);
    });
  });
}

async function waitForPortClosed(port: number, timeoutMs = 5000, host = '127.0.0.1'): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const closed = await isPortClosed(port, host);
    if (closed) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function killOwnedProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error && child.exitCode === null && child.signalCode === null) reject(error);
        else resolve();
      });
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
}

async function generateTotpCode(secret: string): Promise<string> {
  const secretBytes = base32.decode(secret.toUpperCase());
  const otpHelper = createOTP(secretBytes, { period: 30, digits: 6 });
  return otpHelper.totp();
}

interface HttpRequestOptions {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  setCookies: string[];
  body: string;
}

function makeRequest(port: number, options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          const setCookies: string[] = [];
          const sc = res.headers['set-cookie'];
          if (Array.isArray(sc)) {
            setCookies.push(...sc);
          } else if (typeof sc === 'string') {
            setCookies.push(sc);
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            setCookies,
            body: raw,
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function extractCookieValue(setCookies: string[], cookieName: string): string | null {
  for (const c of setCookies) {
    const trimmed = c.trim();
    if (trimmed.startsWith(`${cookieName}=`)) {
      const parts = trimmed.split(';')[0];
      return parts.slice(`${cookieName}=`.length);
    }
  }
  return null;
}

function signSessionTokenCookie(token: string, secret: string): string {
  const signature = crypto.createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

describe('T06-13: Real Server Action HTTP Transport Authorization & Wire Verification', () => {
  const OWNER_EMAIL = 'owner-matter-transport@example.test';
  const OWNER_INITIAL_PASSWORD = 'TemporaryInitialPassword123!';
  const nextBin = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');

  let dedicatedDb: { url: string; drop: () => Promise<void> };
  let dedicatedPool: Pool;
  let serverChild: ChildProcess;
  let serverPort: number;
  let trustedOrigin: string;

  let ownerUserId: string;
  let ownerTotpSecret: string;

  let existingPartyId: string;
  let existingPoaId: string;
  let existingCourtId: string;
  let existingMatterId: string;
  let existingProcId: string;
  let existingMatterPartyId: string;

  let verifiedSessionCookie: string;
  let unverifiedMfaSessionCookie: string;
  let expiredSessionCookie: string;
  let maintainerSessionCookie: string;
  let revokedSessionCookie: string;

  const actionIds: Record<string, string> = {};

  beforeAll(async () => {
    validateTestEnvironment();

    // 1. Create dedicated isolated test database
    dedicatedDb = await createDedicatedTestDatabase();
    dedicatedPool = new Pool({ connectionString: dedicatedDb.url });

    // 2. Baseline identity schema and deploy all migrations
    const baselineResult = await runIdentityBaseline({
      targetUrl: dedicatedDb.url,
      silent: true,
    });
    expect(baselineResult.success).toBe(true);

    const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
    const { spawnSync } = await import('child_process');
    const migRes = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: dedicatedDb.url, NODE_ENV: 'test' },
      encoding: 'utf-8',
    });
    expect(migRes.status).toBe(0);

    // 3. Switch in-memory environment to dedicated test database for Prisma and Better Auth singletons
    const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dedicatedDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    const testSecret = process.env.BETTER_AUTH_SECRET || 'synthetic_development_secret_32_bytes_minimum_length_required';

    try {
      const owner = await provisionOwner({
        name: 'أستاذ نقل القضايا',
        email: OWNER_EMAIL,
        password: OWNER_INITIAL_PASSWORD,
      });
      ownerUserId = owner.user.id;
      ownerTotpSecret = owner.totpSecret;
      const initialTotp = await generateTotpCode(ownerTotpSecret);
      await confirmOwnerProvisioning(ownerUserId, initialTotp);

      // Create base fixtures in dedicated database
      const client = await dedicatedPool.connect();
      try {
        existingPartyId = crypto.randomUUID();
        await client.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'PERSON', 'موكل نقل القضايا', 'موكل نقل القضايا', '01099998888', '01099998888', 1, $2, $2, now(), now())
        `, [existingPartyId, ownerUserId]);

        existingPoaId = crypto.randomUUID();
        await client.query(`
          INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "notarizationOffice", "poaType", "humanReviewStatus", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, '5544/ق', '2026', 'مكتب توثيق النزهة', 'GENERAL', 'VALID', $3, $3, now(), now())
        `, [existingPoaId, existingPartyId, ownerUserId]);

        existingCourtId = crypto.randomUUID();
        await client.query(`
          INSERT INTO "court" ("id", "name", "code", "isActive", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'محكمة القاهرة الاقتصادية', 'ECON-01', true, 1, $2, $2, now(), now())
        `, [existingCourtId, ownerUserId]);

        existingMatterId = crypto.randomUUID();
        await client.query(`
          INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, '2026/0888', 'ملف فحص النقل الشبكي للقضايا', 'LITIGATION', 'ACTIVE', 1, $2, $2, now(), now())
        `, [existingMatterId, ownerUserId]);

        existingMatterPartyId = crypto.randomUUID();
        await client.query(`
          INSERT INTO "matter_party" ("id", "matterId", "partyId", "role", "isPrimaryContact", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 'CLIENT', true, 1, $4, $4, now(), now())
        `, [existingMatterPartyId, existingMatterId, existingPartyId, ownerUserId]);

        existingProcId = crypto.randomUUID();
        await client.query(`
          INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 'FIRST_INSTANCE', '777', '2026', 'تجاري كلي', 'ACTIVE', 1, $4, $4, now(), now())
        `, [existingProcId, existingMatterId, existingCourtId, ownerUserId]);

        // Setup real unverified MFA OWNER session
        const nomfaUserId = 'user-owner-nomfa-matter';
        const nomfaToken = crypto.randomBytes(32).toString('hex');
        await client.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "twoFactorEnabled", "emailVerified", "credentialVersion", "createdAt", "updatedAt")
          VALUES ($1, 'مالك بدون MFA قضايا', 'nomfa-matters@transport.local', 'OWNER', true, true, 1, now(), now())
        `, [nomfaUserId]);
        await client.query(`
          INSERT INTO "session" ("id", "userId", "token", "credentialVersion", "expiresAt", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 1, now() + interval '12 hours', now(), now())
        `, [crypto.randomUUID(), nomfaUserId, nomfaToken]);
        await client.query(`
          INSERT INTO "twoFactor" ("id", "userId", "secret", "backupCodes", "verified")
          VALUES ($1, $2, 'TESTSECRET2FAUNVERIFIED', '[]', false)
        `, [crypto.randomUUID(), nomfaUserId]);

        const signedNomfaToken = signSessionTokenCookie(nomfaToken, testSecret);
        unverifiedMfaSessionCookie = `better-auth.session_token=${signedNomfaToken}`;

        // Setup MAINTAINER session
        const maintainerUserId = 'user-maintainer-matter';
        const maintainerToken = crypto.randomBytes(32).toString('hex');
        await client.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "twoFactorEnabled", "emailVerified", "credentialVersion", "createdAt", "updatedAt")
          VALUES ($1, 'مسؤول صيانة قضايا', 'maintainer-matters@transport.local', 'MAINTAINER', true, true, 1, now(), now())
        `, [maintainerUserId]);
        await client.query(`
          INSERT INTO "session" ("id", "userId", "token", "credentialVersion", "expiresAt", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 1, now() + interval '12 hours', now(), now())
        `, [crypto.randomUUID(), maintainerUserId, maintainerToken]);
        await client.query(`
          INSERT INTO "twoFactor" ("id", "userId", "secret", "backupCodes", "verified")
          VALUES ($1, $2, 'TESTSECRET2FAMAINTAINER', '[]', true)
        `, [crypto.randomUUID(), maintainerUserId]);

        const signedMaintainerToken = signSessionTokenCookie(maintainerToken, testSecret);
        maintainerSessionCookie = `better-auth.session_token=${signedMaintainerToken}`;

        // Setup EXPIRED session
        const expiredUserId = 'user-expired-matter';
        const expiredToken = crypto.randomBytes(32).toString('hex');
        await client.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "twoFactorEnabled", "emailVerified", "credentialVersion", "createdAt", "updatedAt")
          VALUES ($1, 'مالك منتهي الجلسة', 'expired-matters@transport.local', 'OWNER', true, true, 1, now(), now())
        `, [expiredUserId]);
        await client.query(`
          INSERT INTO "session" ("id", "userId", "token", "credentialVersion", "expiresAt", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 1, now() - interval '2 hours', now(), now())
        `, [crypto.randomUUID(), expiredUserId, expiredToken]);
        await client.query(`
          INSERT INTO "twoFactor" ("id", "userId", "secret", "backupCodes", "verified")
          VALUES ($1, $2, 'TESTSECRET2FAEXPIRED', '[]', true)
        `, [crypto.randomUUID(), expiredUserId]);

        const signedExpiredToken = signSessionTokenCookie(expiredToken, testSecret);
        expiredSessionCookie = `better-auth.session_token=${signedExpiredToken}`;
      } finally {
        client.release();
      }
    } finally {
      process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
      await clearGlobalSingletons();
    }

    // 4. Ensure production build exists and read action manifest
    const manifestPath = path.resolve(process.cwd(), '.next/server/server-reference-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const nodeEntries = manifest.node || {};
    for (const [id, meta] of Object.entries(nodeEntries)) {
      const entry = meta as { exportedName?: string };
      if (entry.exportedName) {
        actionIds[entry.exportedName] = id;
      }
    }

    expect(actionIds.openMatterAction).toBeDefined();
    expect(actionIds.updateMatterAction).toBeDefined();
    expect(actionIds.addProceedingAction).toBeDefined();
    expect(actionIds.updateProceedingAction).toBeDefined();
    expect(actionIds.linkMatterAuthorizationAction).toBeDefined();
    expect(actionIds.updateOfficeSettingsAction).toBeDefined();
    expect(actionIds.createReferenceItemAction).toBeDefined();

    // 5. Allocate port and start production Next.js server
    serverPort = await getFreeLoopbackPort();
    trustedOrigin = `http://127.0.0.1:${serverPort}`;

    const childEnv: Record<string, string | undefined> = { ...process.env };
    delete childEnv.VITEST;
    delete childEnv.VITEST_POOL_ID;
    delete childEnv.VITEST_WORKER_ID;

    serverChild = spawn(process.execPath, [nextBin, 'start', '-p', String(serverPort), '-H', '127.0.0.1'], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: {
        ...childEnv,
        NODE_ENV: 'production',
        PORT: String(serverPort),
        DATABASE_URL: dedicatedDb.url,
        BETTER_AUTH_URL: trustedOrigin,
        BETTER_AUTH_SECRET: testSecret,
      } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverOutput = '';
    let serverExitCode: number | null = null;
    serverChild.stdout?.on('data', (d) => { serverOutput += d.toString(); });
    serverChild.stderr?.on('data', (d) => { serverOutput += d.toString(); });
    serverChild.on('exit', (code) => { serverExitCode = code; });

    // 6. Poll readiness probe
    const startTime = Date.now();
    let isReady = false;
    while (Date.now() - startTime < 30000) {
      if (serverExitCode !== null) {
        throw new Error(`Production Next.js server exited prematurely with code ${serverExitCode}. Output:\n${serverOutput}`);
      }
      try {
        const res = await makeRequest(serverPort, { path: '/api/health/ready' });
        if (res.status === 200) {
          isReady = true;
          break;
        }
      } catch {
        // waiting for server
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(isReady).toBe(true);

    // 7. Establish verified session cookie via HTTP sign-in flows
    const loginRes = await makeRequest(serverPort, {
      method: 'POST',
      path: '/api/auth/sign-in/email',
      headers: {
        'Host': `127.0.0.1:${serverPort}`,
        'Origin': trustedOrigin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: OWNER_EMAIL,
        password: OWNER_INITIAL_PASSWORD,
      }),
    });
    expect(loginRes.status).toBe(200);

    const tfToken = extractCookieValue(loginRes.setCookies, 'better-auth.two_factor');
    expect(tfToken).not.toBeNull();
    const totpCode = await generateTotpCode(ownerTotpSecret);

    const mfaRes = await makeRequest(serverPort, {
      method: 'POST',
      path: '/api/auth/two-factor/verify-totp',
      headers: {
        'Host': `127.0.0.1:${serverPort}`,
        'Origin': trustedOrigin,
        'Content-Type': 'application/json',
        'Cookie': `better-auth.two_factor=${tfToken}`,
      },
      body: JSON.stringify({
        code: totpCode,
      }),
    });
    expect(mfaRes.status).toBe(200);
    const verifiedSessionToken = extractCookieValue(mfaRes.setCookies, 'better-auth.session_token');
    expect(verifiedSessionToken).not.toBeNull();
    verifiedSessionCookie = `better-auth.session_token=${verifiedSessionToken}`;

    // Establish second session to test genuine DB revocation
    const loginRevoked = await makeRequest(serverPort, {
      method: 'POST',
      path: '/api/auth/sign-in/email',
      headers: {
        'Host': `127.0.0.1:${serverPort}`,
        'Origin': trustedOrigin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: OWNER_EMAIL,
        password: OWNER_INITIAL_PASSWORD,
      }),
    });
    expect(loginRevoked.status).toBe(200);
    const tfToken2 = extractCookieValue(loginRevoked.setCookies, 'better-auth.two_factor');
    const totpCode2 = await generateTotpCode(ownerTotpSecret);

    const mfaRes2 = await makeRequest(serverPort, {
      method: 'POST',
      path: '/api/auth/two-factor/verify-totp',
      headers: {
        'Host': `127.0.0.1:${serverPort}`,
        'Origin': trustedOrigin,
        'Content-Type': 'application/json',
        'Cookie': `better-auth.two_factor=${tfToken2}`,
      },
      body: JSON.stringify({
        code: totpCode2,
      }),
    });
    expect(mfaRes2.status).toBe(200);
    const revokedCookieToken = extractCookieValue(mfaRes2.setCookies, 'better-auth.session_token');
    expect(revokedCookieToken).toBeTruthy();
    revokedSessionCookie = `better-auth.session_token=${revokedCookieToken}`;

    // Verify it works before revocation
    const preCheck = await postServerAction('searchMattersAction', [{ query: 'فحص' }], {
      cookie: revokedSessionCookie,
    });
    expect(preCheck.status).toBe(200);
    expect(preCheck.body).toContain('"success":true');

    // Revoke exactly one row in DB and verify rowCount === 1
    const rawToken = decodeURIComponent(revokedCookieToken!).split('.')[0];
    const updateResult = await dedicatedPool.query(
      'UPDATE "session" SET "expiresAt" = now() - interval \'1 hour\' WHERE token = $1',
      [rawToken]
    );
    expect(updateResult.rowCount).toBe(1);
  }, 90000);

  afterAll(async () => {
    if (serverChild) {
      await killOwnedProcess(serverChild);
      await waitForPortClosed(serverPort);
    }
    if (dedicatedPool) {
      await dedicatedPool.end().catch(() => {});
    }
    if (dedicatedDb) {
      await dedicatedDb.drop().catch(() => {});
    }
  });

  async function postServerAction(
    actionName: string,
    args: unknown[],
    options: {
      cookie?: string;
      origin?: string;
      path?: string;
    } = {}
  ): Promise<HttpResponse> {
    const actionId = actionIds[actionName];
    if (!actionId) {
      throw new Error(`Action ${actionName} not found in server-reference-manifest.json`);
    }

    const headers: Record<string, string> = {
      'Host': `127.0.0.1:${serverPort}`,
      'Origin': options.origin ?? trustedOrigin,
      'Next-Action': actionId,
      'Accept': 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
    };

    if (options.cookie) {
      headers.Cookie = options.cookie;
    }

    return makeRequest(serverPort, {
      method: 'POST',
      path: options.path || '/matters',
      headers,
      body: JSON.stringify(args),
    });
  }

  function getTargetActions(): Array<{ name: string; args: unknown[] }> {
    return [
      {
        name: 'openMatterAction',
        args: [{
          title: 'محاولة فتح ملف غير مصرحة',
          kind: 'LITIGATION',
          idempotencyKey: `unauth-open-${crypto.randomUUID()}`,
        }],
      },
      {
        name: 'updateMatterAction',
        args: [{
          id: existingMatterId,
          expectedVersion: 1,
          title: 'تعديل غير مصرح',
          kind: 'LITIGATION',
          status: 'ACTIVE',
          idempotencyKey: `unauth-upd-${crypto.randomUUID()}`,
        }],
      },
      {
        name: 'addProceedingAction',
        args: [{
          matterId: existingMatterId,
          courtId: existingCourtId,
          instance: 'FIRST_INSTANCE',
          idempotencyKey: `unauth-proc-${crypto.randomUUID()}`,
        }],
      },
      {
        name: 'updateProceedingAction',
        args: [{
          id: existingProcId,
          matterId: existingMatterId,
          expectedVersion: 1,
          courtId: existingCourtId,
          instance: 'FIRST_INSTANCE',
          status: 'DRAFT',
          idempotencyKey: `unauth-uproc-${crypto.randomUUID()}`,
        }],
      },
      {
        name: 'linkMatterAuthorizationAction',
        args: [{
          matterId: existingMatterId,
          powerOfAttorneyId: existingPoaId,
          idempotencyKey: `unauth-poa-${crypto.randomUUID()}`,
        }],
      },
      {
        name: 'updateOfficeSettingsAction',
        args: [{
          officeName: 'تحديث إعدادات غير مصرح',
          expectedVersion: 1,
          idempotencyKey: `unauth-set-${crypto.randomUUID()}`,
        }],
      },
      {
        name: 'createReferenceItemAction',
        args: [{
          type: 'COURT',
          name: 'محكمة غير مصرحة',
          idempotencyKey: `unauth-ref-${crypto.randomUUID()}`,
        }],
      },
    ];
  }

  describe('1. Unauthenticated Transport (Missing Session Cookie)', () => {
    it('rejects unauthenticated HTTP requests across all 7 target server actions', async () => {
      const actions = getTargetActions();

      for (const item of actions) {
        const res = await postServerAction(item.name, item.args, { cookie: undefined });
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('UNAUTHENTICATED');
        } else {
          expect([401, 403]).toContain(res.status);
        }
      }
    });
  });

  describe('2. Expired Session Transport', () => {
    it('rejects expired session HTTP requests across all 7 target server actions', async () => {
      const actions = getTargetActions();

      for (const item of actions) {
        const res = await postServerAction(item.name, item.args, { cookie: expiredSessionCookie });
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('UNAUTHENTICATED');
        } else {
          expect([401, 403]).toContain(res.status);
        }
      }
    });
  });

  describe('3. Genuinely Revoked Session Transport', () => {
    it('rejects revoked session across all target actions after rowCount === 1 revocation', async () => {
      const actions = getTargetActions();

      for (const item of actions) {
        const res = await postServerAction(item.name, item.args, { cookie: revokedSessionCookie });
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('UNAUTHENTICATED');
        } else {
          expect([401, 403]).toContain(res.status);
        }
      }
    });
  });

  describe('4. Unverified MFA Transport', () => {
    it('rejects unverified MFA sessions across all target actions', async () => {
      const actions = getTargetActions();

      for (const item of actions) {
        const res = await postServerAction(item.name, item.args, { cookie: unverifiedMfaSessionCookie });
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('MFA_REQUIRED');
        } else {
          expect([401, 403]).toContain(res.status);
        }
      }
    });
  });

  describe('5. MAINTAINER Role Denial (Least Privilege)', () => {
    it('strictly denies MAINTAINER access to matter, proceeding, and POA actions', async () => {
      const confidentialActions: Array<{ name: string; args: unknown[] }> = [
        {
          name: 'openMatterAction',
          args: [{
            title: 'محاولة صيانة لفتح ملف',
            kind: 'LITIGATION',
            idempotencyKey: `maint-open-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'updateMatterAction',
          args: [{
            id: existingMatterId,
            expectedVersion: 1,
            title: 'تعديل صيانة',
            kind: 'LITIGATION',
            status: 'ACTIVE',
            idempotencyKey: `maint-upd-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'addProceedingAction',
          args: [{
            matterId: existingMatterId,
            courtId: existingCourtId,
            instance: 'FIRST_INSTANCE',
            idempotencyKey: `maint-proc-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'updateProceedingAction',
          args: [{
            id: existingProcId,
            matterId: existingMatterId,
            expectedVersion: 1,
            courtId: existingCourtId,
            instance: 'FIRST_INSTANCE',
            status: 'DRAFT',
            idempotencyKey: `maint-uproc-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'linkMatterAuthorizationAction',
          args: [{
            matterId: existingMatterId,
            powerOfAttorneyId: existingPoaId,
            idempotencyKey: `maint-poa-${crypto.randomUUID()}`,
          }],
        },
      ];

      for (const item of confidentialActions) {
        const res = await postServerAction(item.name, item.args, { cookie: maintainerSessionCookie });
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('FORBIDDEN');
        } else {
          expect([403]).toContain(res.status);
        }
      }
    });
  });

  describe('6. Untrusted Origin Transport', () => {
    it('rejects action requests with untrusted Origin header', async () => {
      const untrustedOrigins = [
        'http://evil.attacker.local',
        'http://127.0.0.1:9999',
      ];

      for (const badOrigin of untrustedOrigins) {
        const res = await postServerAction(
          'openMatterAction',
          [{
            title: 'محاولة من أصل غير موثوق',
            kind: 'LITIGATION',
            idempotencyKey: `bad-origin-${crypto.randomUUID()}`,
          }],
          {
            cookie: verifiedSessionCookie,
            origin: badOrigin,
          }
        );

        if (res.status === 403) {
          expect(res.status).toBe(403);
        } else if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('FORBIDDEN');
        } else {
          expect([400, 403, 500]).toContain(res.status);
        }
      }
    });
  });

  describe('7. Forged Body Parameters & Actor Injection', () => {
    it('ignores caller-injected options and strictly derives actor from session', async () => {
      const forgedPayload = [
        {
          title: 'ملف بخيارات محقونة',
          kind: 'LITIGATION',
          idempotencyKey: `forged-matter-${crypto.randomUUID()}`,
        },
        {
          allowIncompleteMfa: true,
          bypassMfa: true,
          actorOverride: { id: 'forged-attacker', role: 'ADMIN' },
          role: 'ADMIN',
        },
      ];

      // A. With unverified session: fails closed with MFA_REQUIRED
      const nomfaRes = await postServerAction('openMatterAction', forgedPayload, {
        cookie: unverifiedMfaSessionCookie,
      });
      if (nomfaRes.status === 200) {
        expect(nomfaRes.body).toContain('"success":false');
        expect(nomfaRes.body).toContain('MFA_REQUIRED');
      } else {
        expect([401, 403]).toContain(nomfaRes.status);
      }

      // B. With verified session: succeeds using only argument 0
      const verifiedRes = await postServerAction('openMatterAction', forgedPayload, {
        cookie: verifiedSessionCookie,
      });
      expect(verifiedRes.status).toBe(200);
      expect(verifiedRes.body).toContain('"success":true');
      expect(verifiedRes.body).toContain('ملف بخيارات محقونة');

      // Verify createdById in DB is genuine ownerUserId, NOT forged-attacker
      const dbCheck = await dedicatedPool.query('SELECT "createdById" FROM matter WHERE title = $1', ['ملف بخيارات محقونة']);
      expect(dbCheck.rows).toHaveLength(1);
      expect(dbCheck.rows[0].createdById).toBe(ownerUserId);
    });
  });

  describe('8. Verified Owner Success Transport', () => {
    it('executes genuine target Server Actions successfully over HTTP with verified owner session', async () => {
      // 1. Create Reference Item (Court)
      const courtKey = `owner-http-court-${crypto.randomUUID()}`;
      const courtRes = await postServerAction('createReferenceItemAction', [{
        type: 'COURT',
        name: 'محكمة النقل الموثق',
        code: 'TRANS-01',
        idempotencyKey: courtKey,
      }], { cookie: verifiedSessionCookie });
      expect(courtRes.status).toBe(200);
      expect(courtRes.body).toContain('"success":true');
      expect(courtRes.body).toContain('محكمة النقل الموثق');

      // 2. Open Matter
      const matterKey = `owner-http-open-${crypto.randomUUID()}`;
      const openRes = await postServerAction('openMatterAction', [{
        title: 'قضية النقل الشبكي الناجحة',
        kind: 'LITIGATION',
        idempotencyKey: matterKey,
      }], { cookie: verifiedSessionCookie });
      expect(openRes.status).toBe(200);
      expect(openRes.body).toContain('"success":true');
      expect(openRes.body).toContain('قضية النقل الشبكي الناجحة');

      // 3. Update Office Settings
      const setKey = `owner-http-set-${crypto.randomUUID()}`;
      const setRes = await postServerAction('updateOfficeSettingsAction', [{
        officeName: 'مكتب المحاماة الرئيسي المتكامل',
        lawyerName: 'الأستاذ المحامي المؤسس',
        phone: '01011112222',
        expectedVersion: 1,
        idempotencyKey: setKey,
      }], { cookie: verifiedSessionCookie });
      expect(setRes.status).toBe(200);
      expect(setRes.body).toContain('"success":true');
      expect(setRes.body).toContain('مكتب المحاماة الرئيسي المتكامل');
    });
  });
});
