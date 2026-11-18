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

describe('T05-R3-04: Real Server Action HTTP Transport Authorization & Wire Verification', () => {
  const OWNER_EMAIL = 'owner-action-transport@example.test';
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

  let verifiedSessionCookie: string;
  let unverifiedMfaSessionCookie: string;
  let revokedSessionCookie: string;

  const actionIds: Record<string, string> = {};

  beforeAll(async () => {
    validateTestEnvironment();

    // 1. Create dedicated isolated test database
    dedicatedDb = await createDedicatedTestDatabase();
    dedicatedPool = new Pool({ connectionString: dedicatedDb.url });

    // 2. Baseline identity schema and catalog triggers
    const baselineResult = await runIdentityBaseline({
      targetUrl: dedicatedDb.url,
      silent: true,
    });
    expect(baselineResult.success).toBe(true);

    // 3. Switch in-memory environment to dedicated test database for Prisma and Better Auth singletons
    const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dedicatedDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    try {
      const owner = await provisionOwner({
        name: 'أستاذ النقل الشبكي',
        email: OWNER_EMAIL,
        password: OWNER_INITIAL_PASSWORD,
      });
      ownerUserId = owner.user.id;
      ownerTotpSecret = owner.totpSecret;
      const initialTotp = await generateTotpCode(ownerTotpSecret);
      await confirmOwnerProvisioning(ownerUserId, initialTotp);

      // Create base party record in database
      const client = await dedicatedPool.connect();
      try {
        existingPartyId = crypto.randomUUID();
        await client.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'PERSON', 'عميل النقل الفعلي', 'عميل النقل الفعلي', '01055554444', '01055554444', 1, $2, $2, now(), now())
        `, [existingPartyId, ownerUserId]);

        await client.query(`
          INSERT INTO "party_identity" ("id", "partyId", "identificationType", "ciphertext", "iv", "authTag", "keyId", "lastFour", "createdById")
          VALUES (gen_random_uuid()::text, $1, 'NATIONAL_ID', 'dGVzdGNpcGhlcg==', 'dGVzdGl2MTI=', 'dGVzdHRhZzE2', 'k2026_01', '1234', $2)
        `, [existingPartyId, ownerUserId]);

        await client.query(`
          INSERT INTO "communication_note" ("id", "partyId", "communicationAt", "channel", "summary", "createdById")
          VALUES ('note-transport-1', $1, now(), 'PHONE', 'ملاحظة نقل أساسية', $2)
        `, [existingPartyId, ownerUserId]);

        await client.query(`
          INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "notarizationOffice", "poaType", "humanReviewStatus", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ('poa-transport-1', $1, '77/ب', '2026', 'مكتب توثيق الجيزة', 'GENERAL', 'UNREVIEWED', $2, $2, now(), now())
        `, [existingPartyId, ownerUserId]);

        // Setup real unverified MFA OWNER user and session
        const nomfaUserId = 'user-owner-nomfa-transport';
        const nomfaToken = crypto.randomBytes(32).toString('hex');
        await client.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "twoFactorEnabled", "emailVerified", "credentialVersion", "createdAt", "updatedAt")
          VALUES ($1, 'مالك بدون MFA', 'nomfa@transport.local', 'OWNER', true, true, 1, now(), now())
        `, [nomfaUserId]);
        await client.query(`
          INSERT INTO "session" ("id", "userId", "token", "credentialVersion", "expiresAt", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 1, now() + interval '12 hours', now(), now())
        `, [crypto.randomUUID(), nomfaUserId, nomfaToken]);
        await client.query(`
          INSERT INTO "twoFactor" ("id", "userId", "secret", "backupCodes", "verified")
          VALUES ($1, $2, 'TESTSECRET2FAUNVERIFIED', '[]', false)
        `, [crypto.randomUUID(), nomfaUserId]);

        const testSecret = process.env.BETTER_AUTH_SECRET || 'synthetic_development_secret_32_bytes_minimum_length_required';
        const signedNomfaToken = signSessionTokenCookie(nomfaToken, testSecret);
        unverifiedMfaSessionCookie = `better-auth.session_token=${signedNomfaToken}`;
      } finally {
        client.release();
      }
    } finally {
      process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
      await clearGlobalSingletons();
    }

    // 4. Ensure production build exists
    const buildIdPath = path.resolve(process.cwd(), '.next/BUILD_ID');
    if (!fs.existsSync(buildIdPath)) {
      await new Promise<void>((resolve, reject) => {
        const build = spawn(process.execPath, [nextBin, 'build'], {
          cwd: process.cwd(),
          windowsHide: true,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: dedicatedDb.url,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        build.on('error', reject);
        build.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Fallback next build failed with exit code ${code}`));
        });
      });
    }

    // 5. Read Server Reference Manifest for actual Action IDs
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

    expect(actionIds.savePartyAction).toBeDefined();
    expect(actionIds.searchPartiesAction).toBeDefined();
    expect(actionIds.addCommunicationNoteAction).toBeDefined();
    expect(actionIds.savePowerOfAttorneyAction).toBeDefined();
    expect(actionIds.revealPartyIdentityAction).toBeDefined();
    expect(actionIds.checkPartyDuplicatesAction).toBeDefined();

    // 6. Allocate port and start production Next.js server
    serverPort = await getFreeLoopbackPort();
    trustedOrigin = `http://127.0.0.1:${serverPort}`;

    const testSecret = process.env.BETTER_AUTH_SECRET || 'synthetic_development_secret_32_bytes_minimum_length_required';
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
        PARTY_IDENTITY_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        PARTY_IDENTITY_KEY_ID: 'k2026_01',
      } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverOutput = '';
    let serverExitCode: number | null = null;
    serverChild.stdout?.on('data', (d) => { serverOutput += d.toString(); });
    serverChild.stderr?.on('data', (d) => { serverOutput += d.toString(); });
    serverChild.on('exit', (code) => { serverExitCode = code; });

    // 7. Poll readiness probe
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
        // waiting for server to accept connections
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(isReady).toBe(true);

    // 8. Establish session cookies via HTTP sign-in flows
    // A. Sign-in with password to get MFA challenge token
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

    // B. Verified Session Cookie (sign-in + verify TOTP)
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

    // C. Revoked Session Cookie: create another session with completed MFA,
    // establish protected-action success using that exact cookie, identify raw DB session,
    // revoke exactly one session row (assert rowCount === 1), then reuse unchanged cookie.
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
    expect(tfToken2).toBeTruthy();

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
    expect(revokedCookieToken!.length).toBeGreaterThan(0);
    revokedSessionCookie = `better-auth.session_token=${revokedCookieToken}`;

    // Establish protected-action success using that exact cookie before revocation
    const preRevocationCheck = await postServerAction('searchPartiesAction', [{ query: 'عميل' }], {
      cookie: revokedSessionCookie,
    });
    expect(preRevocationCheck.status).toBe(200);
    expect(preRevocationCheck.body).toContain('"success":true');

    // Securely identify the corresponding raw DB session and delete exactly one row
    const rawToken = decodeURIComponent(revokedCookieToken!).split('.')[0];
    const deleteResult = await dedicatedPool.query('DELETE FROM "session" WHERE token = $1', [rawToken]);
    expect(deleteResult.rowCount).toBe(1);
  }, 60000);

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
      path: options.path || '/parties',
      headers,
      body: JSON.stringify(args),
    });
  }

  describe('1. Unauthorized Transport (Missing Session Cookie)', () => {
    it('rejects unauthenticated serialized HTTP requests across all action entry points', async () => {
      const allActions: Array<{ name: string; args: unknown[] }> = [
        { name: 'searchPartiesAction', args: [{ query: 'اختبار' }] },
        { name: 'checkPartyDuplicatesAction', args: ['عميل جديد'] },
        {
          name: 'savePartyAction',
          args: [{
            kind: 'PERSON',
            name: 'محاولة غير مصرحة',
            idempotencyKey: `unauth-save-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'addCommunicationNoteAction',
          args: [{
            partyId: existingPartyId,
            communicationAt: '2026-11-18T10:00:00.000Z',
            channel: 'PHONE',
            summary: 'محاولة غير مصرحة',
            idempotencyKey: `unauth-comm-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'savePowerOfAttorneyAction',
          args: [{
            partyId: existingPartyId,
            poaNumberText: '1/ب',
            poaYearLabel: '2026',
            notarizationOffice: 'مكتب التوثيق',
            poaType: 'GENERAL',
            idempotencyKey: `unauth-poa-${crypto.randomUUID()}`,
          }],
        },
        { name: 'revealPartyIdentityAction', args: [existingPartyId, 'محاولة غير مصرحة'] },
      ];

      for (const item of allActions) {
        const res = await postServerAction(item.name, item.args, { cookie: undefined });
        // Next.js returns 200 with serialized error action payload, or 401
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('UNAUTHENTICATED');
        } else {
          expect([401, 403]).toContain(res.status);
        }
      }

      // Verify no records created
      const countRes = await dedicatedPool.query('SELECT count(*)::int FROM party WHERE name = $1', ['محاولة غير مصرحة']);
      expect(countRes.rows[0].count).toBe(0);
    });
  });

  describe('2. Pending MFA Transport (Unverified Session)', () => {
    it('rejects unverified MFA serialized HTTP requests across all action entry points', async () => {
      const actions: Array<{ name: string; args: unknown[] }> = [
        { name: 'searchPartiesAction', args: [{ query: 'اختبار' }] },
        { name: 'checkPartyDuplicatesAction', args: ['عميل جديد'] },
        {
          name: 'savePartyAction',
          args: [{
            kind: 'PERSON',
            name: 'محاولة بدون إكمال MFA',
            idempotencyKey: `nomfa-save-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'addCommunicationNoteAction',
          args: [{
            partyId: existingPartyId,
            communicationAt: '2026-11-18T10:00:00.000Z',
            channel: 'PHONE',
            summary: 'ملاحظة بدون إكمال MFA',
            idempotencyKey: `nomfa-comm-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'savePowerOfAttorneyAction',
          args: [{
            partyId: existingPartyId,
            poaNumberText: '2/ب',
            poaYearLabel: '2026',
            notarizationOffice: 'مكتب التوثيق',
            poaType: 'GENERAL',
            idempotencyKey: `nomfa-poa-${crypto.randomUUID()}`,
          }],
        },
        { name: 'revealPartyIdentityAction', args: [existingPartyId, 'طلب كشف بدون MFA'] },
      ];

      for (const item of actions) {
        const res = await postServerAction(item.name, item.args, { cookie: unverifiedMfaSessionCookie });
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('MFA_REQUIRED');
        } else {
          expect([401, 403]).toContain(res.status);
        }
      }

      // Verify no records created
      const countRes = await dedicatedPool.query('SELECT count(*)::int FROM party WHERE name = $1', ['محاولة بدون إكمال MFA']);
      expect(countRes.rows[0].count).toBe(0);
    });
  });

  describe('3. Untrusted Cross-Origin Transport', () => {
    it('rejects serialized HTTP requests from untrusted external Origin header (CSRF defense-in-depth)', async () => {
      const untrustedOrigins = [
        'http://untrusted-attacker.invalid',
        'http://evil.example.test',
        'http://127.0.0.1:9999',
      ];

      for (const badOrigin of untrustedOrigins) {
        const res = await postServerAction(
          'savePartyAction',
          [{
            kind: 'PERSON',
            name: 'محاولة هجوم عبر أصل غير موثوق',
            idempotencyKey: `csrf-${crypto.randomUUID()}`,
          }],
          {
            cookie: verifiedSessionCookie,
            origin: badOrigin,
          }
        );

        // Next.js built-in action CSRF defense returns 403 Forbidden or 500, or action guard returns FORBIDDEN
        if (res.status === 403) {
          expect(res.status).toBe(403);
        } else if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('FORBIDDEN');
        } else {
          expect([400, 403, 500]).toContain(res.status);
        }
      }

      // Verify no party was created
      const countRes = await dedicatedPool.query('SELECT count(*)::int FROM party WHERE name = $1', ['محاولة هجوم عبر أصل غير موثوق']);
      expect(countRes.rows[0].count).toBe(0);
    });
  });

  describe('4. Forged Serialized Extra Options', () => {
    it('ignores forged caller-injected options and enforces strict server-side MFA and authorization', async () => {
      const forgedPayload = [
        {
          kind: 'PERSON',
          name: 'عميل بخيارات ملغومة',
          idempotencyKey: `forged-${crypto.randomUUID()}`,
        },
        {
          allowIncompleteMfa: true,
          bypassMfa: true,
          simulateAuditFailure: true,
          skipAuthorization: true,
          actorOverride: { id: 'forged-admin', role: 'ADMIN' },
        },
      ];

      // A. Attempt with unverified session: must still fail closed with MFA_REQUIRED
      const nomfaRes = await postServerAction('savePartyAction', forgedPayload, {
        cookie: unverifiedMfaSessionCookie,
      });
      if (nomfaRes.status === 200) {
        expect(nomfaRes.body).toContain('"success":false');
        expect(nomfaRes.body).toContain('MFA_REQUIRED');
      } else {
        expect([401, 403]).toContain(nomfaRes.status);
      }

      // B. Attempt with verified session: succeeds normally using only argument 0, ignoring forged argument 1
      const verifiedRes = await postServerAction('savePartyAction', forgedPayload, {
        cookie: verifiedSessionCookie,
      });
      expect(verifiedRes.status).toBe(200);
      expect(verifiedRes.body).toContain('"success":true');
      expect(verifiedRes.body).toContain('عميل بخيارات ملغومة');

      // Verify party created with genuine owner actor ID, not forged-admin
      const partyRes = await dedicatedPool.query('SELECT "createdById" FROM party WHERE name = $1', ['عميل بخيارات ملغومة']);
      expect(partyRes.rows).toHaveLength(1);
      expect(partyRes.rows[0].createdById).toBe(ownerUserId);
    });
  });

  describe('5. Revoked Session Transport across Note, POA, Reveal, and Party Families', () => {
    it('rejects revoked sessions across all operation families over real HTTP transport', async () => {
      const actions: Array<{ name: string; args: unknown[] }> = [
        { name: 'searchPartiesAction', args: [{ query: 'عميل' }] },
        { name: 'checkPartyDuplicatesAction', args: ['عميل'] },
        {
          name: 'savePartyAction',
          args: [{
            kind: 'PERSON',
            name: 'محاولة بجلسة ملغاة شبكياً',
            idempotencyKey: `revoked-save-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'addCommunicationNoteAction',
          args: [{
            partyId: existingPartyId,
            communicationAt: '2026-11-18T10:00:00.000Z',
            channel: 'PHONE',
            summary: 'محاولة ملاحظة بجلسة ملغاة',
            idempotencyKey: `revoked-comm-${crypto.randomUUID()}`,
          }],
        },
        {
          name: 'savePowerOfAttorneyAction',
          args: [{
            partyId: existingPartyId,
            poaNumberText: '3/ب',
            poaYearLabel: '2026',
            notarizationOffice: 'مكتب التوثيق',
            poaType: 'GENERAL',
            idempotencyKey: `revoked-poa-${crypto.randomUUID()}`,
          }],
        },
        { name: 'revealPartyIdentityAction', args: [existingPartyId, 'طلب كشف بجلسة ملغاة'] },
      ];

      for (const item of actions) {
        const res = await postServerAction(item.name, item.args, { cookie: revokedSessionCookie });
        if (res.status === 200) {
          expect(res.body).toContain('"success":false');
          expect(res.body).toContain('UNAUTHENTICATED');
          // Guarantees zero sensitive data or reveal plaintext leakage
          expect(res.body).not.toContain('dGVzdGNpcGhlcg==');
        } else {
          expect([401, 403]).toContain(res.status);
        }
      }

      // Verify no records created
      const countRes = await dedicatedPool.query('SELECT count(*)::int FROM party WHERE name = $1', ['محاولة بجلسة ملغاة شبكياً']);
      expect(countRes.rows[0].count).toBe(0);
    });
  });

  describe('6. Normal Owner Success Transport', () => {
    it('executes genuine Server Actions successfully over HTTP with verified owner session', async () => {
      // 1. Save party over HTTP
      const partyKey = `owner-http-save-${crypto.randomUUID()}`;
      const saveRes = await postServerAction('savePartyAction', [{
        kind: 'PERSON',
        name: 'عميل ناجح عبر النقل الشبكي الحقيقي',
        primaryPhone: '01012341234',
        idempotencyKey: partyKey,
      }], { cookie: verifiedSessionCookie });

      expect(saveRes.status).toBe(200);
      expect(saveRes.body).toContain('"success":true');
      expect(saveRes.body).toContain('عميل ناجح عبر النقل الشبكي الحقيقي');

      // 2. Search parties over HTTP
      const searchRes = await postServerAction('searchPartiesAction', [{
        query: 'الشبكي الحقيقي',
      }], { cookie: verifiedSessionCookie });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body).toContain('"success":true');
      expect(searchRes.body).toContain('عميل ناجح عبر النقل الشبكي الحقيقي');

      // 3. Add communication note over HTTP
      const noteKey = `owner-http-note-${crypto.randomUUID()}`;
      const noteRes = await postServerAction('addCommunicationNoteAction', [{
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'IN_PERSON',
        summary: 'ملاحظة ناجحة عبر النقل الفعلي',
        idempotencyKey: noteKey,
      }], { cookie: verifiedSessionCookie });

      expect(noteRes.status).toBe(200);
      expect(noteRes.body).toContain('"success":true');
      expect(noteRes.body).toContain('ملاحظة ناجحة عبر النقل الفعلي');

      // 4. Save Power of Attorney over HTTP
      const poaKey = `owner-http-poa-${crypto.randomUUID()}`;
      const poaRes = await postServerAction('savePowerOfAttorneyAction', [{
        partyId: existingPartyId,
        poaNumberText: '88/أ',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق الدقي',
        poaType: 'SPECIAL',
        notes: 'توكيل ناجح عبر النقل الفعلي',
        idempotencyKey: poaKey,
      }], { cookie: verifiedSessionCookie });

      expect(poaRes.status).toBe(200);
      expect(poaRes.body).toContain('"success":true');
      expect(poaRes.body).toContain('مكتب توثيق الدقي');
    });
  });
});
