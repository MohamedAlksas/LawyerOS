import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import http from 'http';
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
  json: <T = unknown>() => T;
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
            json: <T = unknown>() => {
              try {
                return JSON.parse(raw) as T;
              } catch {
                throw new Error(`Failed to parse response as JSON: ${raw}`);
              }
            },
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
      const semi = trimmed.indexOf(';');
      return semi !== -1 ? trimmed.substring(0, semi) : trimmed;
    }
  }
  return null;
}

interface SecurityStateSnapshot {
  user: {
    credentialVersion: number;
    twoFactorEnabled: boolean | null;
  };
  account: {
    passwordHash: string | null;
  };
  twoFactor: {
    secret: string;
    backupCodes: string;
    verified: boolean;
    failedVerificationCount: number;
    lockedUntil: string | null;
  } | null;
  sessions: Array<{
    id: string;
    token: string;
    credentialVersion: number;
    expiresAt: string;
  }>;
  verifications: Array<{
    id: string;
    identifier: string;
    value: string;
    expiresAt: string;
  }>;
}

async function getSecurityStateSnapshot(pool: Pool, userId: string): Promise<SecurityStateSnapshot> {
  const userRes = await pool.query(
    'SELECT "credentialVersion", "twoFactorEnabled" FROM "user" WHERE id = $1',
    [userId]
  );
  const accRes = await pool.query(
    'SELECT password FROM account WHERE "userId" = $1',
    [userId]
  );
  const tfRes = await pool.query(
    'SELECT secret, "backupCodes", verified, "failedVerificationCount", "lockedUntil" FROM "twoFactor" WHERE "userId" = $1',
    [userId]
  );
  const sessRes = await pool.query(
    'SELECT id, token, "credentialVersion", "expiresAt" FROM session WHERE "userId" = $1 ORDER BY id ASC',
    [userId]
  );
  const verRes = await pool.query(
    'SELECT id, identifier, value, "expiresAt" FROM verification WHERE identifier LIKE $1 OR identifier = $2 ORDER BY id ASC',
    [`2fa-cred-ver-${userId}%`, userId]
  );

  return {
    user: {
      credentialVersion: userRes.rows[0]?.credentialVersion,
      twoFactorEnabled: userRes.rows[0]?.twoFactorEnabled,
    },
    account: {
      passwordHash: accRes.rows[0]?.password ?? null,
    },
    twoFactor: tfRes.rows[0]
      ? {
          secret: tfRes.rows[0].secret,
          backupCodes: tfRes.rows[0].backupCodes,
          verified: tfRes.rows[0].verified,
          failedVerificationCount: tfRes.rows[0].failedVerificationCount,
          lockedUntil: tfRes.rows[0].lockedUntil ? new Date(tfRes.rows[0].lockedUntil).toISOString() : null,
        }
      : null,
    sessions: sessRes.rows.map((r) => ({
      id: r.id,
      token: r.token,
      credentialVersion: r.credentialVersion,
      expiresAt: new Date(r.expiresAt).toISOString(),
    })),
    verifications: verRes.rows.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      value: r.value,
      expiresAt: new Date(r.expiresAt).toISOString(),
    })),
  };
}

function assertSecurityStateUnchanged(before: SecurityStateSnapshot, after: SecurityStateSnapshot): void {
  // Compare non-sensitive fields directly
  expect(after.user.credentialVersion).toBe(before.user.credentialVersion);
  expect(after.user.twoFactorEnabled).toBe(before.user.twoFactorEnabled);

  // Compare sensitive values using labeled boolean equality so failure diagnostics remain redacted
  expect(after.account.passwordHash === before.account.passwordHash).toBe(true);

  if (before.twoFactor && after.twoFactor) {
    expect(after.twoFactor.secret === before.twoFactor.secret).toBe(true);
    expect(after.twoFactor.backupCodes === before.twoFactor.backupCodes).toBe(true);
    expect(after.twoFactor.verified).toBe(before.twoFactor.verified);
    expect(after.twoFactor.failedVerificationCount).toBe(before.twoFactor.failedVerificationCount);
    expect(after.twoFactor.lockedUntil).toBe(before.twoFactor.lockedUntil);
  } else {
    expect(after.twoFactor).toEqual(before.twoFactor);
  }

  expect(after.sessions.length).toBe(before.sessions.length);
  for (let i = 0; i < before.sessions.length; i++) {
    expect(after.sessions[i].id).toBe(before.sessions[i].id);
    expect(after.sessions[i].token === before.sessions[i].token).toBe(true);
    expect(after.sessions[i].credentialVersion).toBe(before.sessions[i].credentialVersion);
    expect(after.sessions[i].expiresAt).toBe(before.sessions[i].expiresAt);
  }

  expect(after.verifications.length).toBe(before.verifications.length);
  for (let i = 0; i < before.verifications.length; i++) {
    expect(after.verifications[i].id).toBe(before.verifications[i].id);
    expect(after.verifications[i].identifier).toBe(before.verifications[i].identifier);
    expect(after.verifications[i].value === before.verifications[i].value).toBe(true);
    expect(after.verifications[i].expiresAt).toBe(before.verifications[i].expiresAt);
  }
}

describe('Production HTTP Origin Matrix & Request Security Guard (T03 Acceptance)', () => {
  const nextBin = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');
  let serverChild: ChildProcess;
  let serverPort: number;
  let trustedOrigin: string;
  let dedicatedDb: Awaited<ReturnType<typeof createDedicatedTestDatabase>>;
  let dedicatedPool: Pool;
  let ownerTotpSecret: string;
  let ownerUserId: string;

  const OWNER_EMAIL = 'matrix.owner@synthetic.invalid';
  const OWNER_INITIAL_PASSWORD = 'MatrixOwnerSecret2026!';
  const UNTRUSTED_ORIGIN = 'http://untrusted-attacker.invalid';

  // State retained across sequential matrix phases
  let validTwoFactorCookie: string | null = null;
  let validSessionCookie: string | null = null;

  let originalTestDatabaseUrl: string | undefined;

  async function getFreshMfaChallenge(): Promise<string> {
    const res = await makeRequest(serverPort, {
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
    expect(res.status).toBe(200);
    const tfCookie = extractCookieValue(res.setCookies, 'better-auth.two_factor');
    expect(tfCookie).not.toBeNull();
    return tfCookie!;
  }

  beforeAll(async () => {
    validateTestEnvironment();

    // 1. Create isolated test database
    dedicatedDb = await createDedicatedTestDatabase();
    dedicatedPool = new Pool({ connectionString: dedicatedDb.url });

    // 2. Baseline identity schema and catalog triggers
    const baselineResult = await runIdentityBaseline({
      targetUrl: dedicatedDb.url,
      silent: true,
    });
    expect(baselineResult.success).toBe(true);

    // 3. Switch in-memory environment to dedicated test database for Prisma and Better Auth singletons
    originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dedicatedDb.url;
    getEnv(true);
    await clearGlobalSingletons();

    try {
      const owner = await provisionOwner({
        name: 'الأستاذ مالك المصفوفة',
        email: OWNER_EMAIL,
        password: OWNER_INITIAL_PASSWORD,
      });
      ownerUserId = owner.user.id;
      ownerTotpSecret = owner.totpSecret;
      const initialTotp = await generateTotpCode(ownerTotpSecret);
      await confirmOwnerProvisioning(ownerUserId, initialTotp);
    } finally {
      await clearGlobalSingletons();
    }

    // 4. Ensure production build exists; if missing, build fallback before launching server child
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
        let buildOutput = '';
        build.stdout?.on('data', (d) => { buildOutput += d.toString(); });
        build.stderr?.on('data', (d) => { buildOutput += d.toString(); });
        build.on('error', reject);
        build.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Fallback next build failed with exit code ${code}: ${buildOutput}`));
        });
      });
    }

    // 5. Allocate port and start production Next.js server
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
      } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(serverChild.pid).toBeDefined();

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
        throw new Error(
          `Production Next.js server child exited prematurely with code ${serverExitCode}. Output:\n${serverOutput}`
        );
      }
      try {
        const res = await makeRequest(serverPort, { path: '/api/health/ready' });
        if (res.status === 200) {
          const body = res.json<{ status: string; check: string; database?: { status: string } }>();
          if (body.status === 'pass' && body.database?.status === 'connected') {
            isReady = true;
            break;
          }
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!isReady && serverExitCode !== null) {
      throw new Error(`Production Next.js server child exited with code ${serverExitCode}. Output:\n${serverOutput}`);
    }
    expect(isReady).toBe(true);
  }, 120000);

  afterAll(async () => {
    await clearGlobalSingletons();
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
    if (originalTestDatabaseUrl) {
      process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
      getEnv(true);
    }
  }, 15000);

  describe('Case 1: Trusted Origin Control (Baseline Authentication & MFA Flow)', () => {
    it('1.1. accepts sign-in from trusted origin, returns twoFactorRedirect and issues challenge cookie', async () => {
      const res = await makeRequest(serverPort, {
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

      expect(res.status).toBe(200);
      const body = res.json<{ twoFactorRedirect?: boolean }>();
      expect(body.twoFactorRedirect).toBe(true);

      const tfCookie = extractCookieValue(res.setCookies, 'better-auth.two_factor');
      expect(tfCookie).not.toBeNull();
      validTwoFactorCookie = tfCookie!;

      // Verify companion record was created in database
      const verifRes = await dedicatedPool.query(
        'SELECT count(*)::int as count FROM verification WHERE identifier LIKE $1',
        ['2fa-cred-ver-%']
      );
      expect(verifRes.rows[0].count).toBeGreaterThan(0);
    });

    it('1.2. accepts TOTP verification from trusted origin with challenge cookie, issues session cookie', async () => {
      expect(validTwoFactorCookie).not.toBeNull();
      const code = await generateTotpCode(ownerTotpSecret);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Cookie': validTwoFactorCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(200);
      const sessionCookie = extractCookieValue(res.setCookies, 'better-auth.session_token');
      expect(sessionCookie).not.toBeNull();
      validSessionCookie = sessionCookie!;

      // Database verification: session created
      const sessRes = await dedicatedPool.query(
        'SELECT count(*)::int as count FROM session WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(sessRes.rows[0].count).toBe(1);
    });

    it('1.3. accepts backup codes regeneration from trusted origin with session cookie and valid password', async () => {
      expect(validSessionCookie).not.toBeNull();

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/generate-backup-codes',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword: OWNER_INITIAL_PASSWORD }),
      });

      expect(res.status).toBe(200);
      const body = res.json<{ status: boolean; backupCodes: string[] }>();
      expect(body.status).toBe(true);
      expect(body.backupCodes).toBeInstanceOf(Array);
      expect(body.backupCodes.length).toBe(10);
    });
  });

  describe('Case 2: Untrusted Origin (http://untrusted-attacker.invalid)', () => {
    it('2.1. rejects sign-in attempt from untrusted origin with HTTP 403, zero cookies, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/sign-in/email',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': UNTRUSTED_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: OWNER_EMAIL,
          password: OWNER_INITIAL_PASSWORD,
        }),
      });

      expect(res.status).toBe(403);
      expect(res.setCookies.length).toBe(0);

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });

    it('2.2. rejects TOTP verification from untrusted origin with fresh challenge, proves challenge remains valid for trusted request', async () => {
      // 1. Issue a fresh, valid, unconsumed MFA challenge from trusted origin
      const freshChallengeCookie = await getFreshMfaChallenge();
      const code = await generateTotpCode(ownerTotpSecret);

      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      // 2. Untrusted origin attempt
      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': UNTRUSTED_ORIGIN,
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      expect(extractCookieValue(res.setCookies, 'better-auth.session_token')).toBeNull();

      // State is unmutated by the untrusted attempt
      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);

      // 3. Demonstrate that the exact same challenge STILL WORKS through an allowed trusted request
      const freshCode = await generateTotpCode(ownerTotpSecret);
      const trustedRes = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: freshCode }),
      });

      expect(trustedRes.status).toBe(200);
      const sessionCookie = extractCookieValue(trustedRes.setCookies, 'better-auth.session_token');
      expect(sessionCookie).not.toBeNull();
    });

    it('2.3. rejects backup code regeneration from untrusted origin with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/generate-backup-codes',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': UNTRUSTED_ORIGIN,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword: OWNER_INITIAL_PASSWORD }),
      });

      expect(res.status).toBe(403);
      const body = res.json<{ error?: string }>();
      expect(body.error).toContain('Origin غير صالح أو غير موثوق');

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });

    it('2.4. rejects password change attempt from untrusted origin with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/change-password',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': UNTRUSTED_ORIGIN,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: OWNER_INITIAL_PASSWORD,
          newPassword: 'AttackerCompromisedPassword123!',
        }),
      });

      expect(res.status).toBe(403);

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });
  });

  describe('Case 3: Missing Origin on Cookie-Bearing State-Changing Requests', () => {
    it('3.1. rejects cookie-bearing TOTP verification when Origin and Referer are omitted with HTTP 403, challenge remains valid', async () => {
      const freshChallengeCookie = await getFreshMfaChallenge();
      const code = await generateTotpCode(ownerTotpSecret);

      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
          // Origin and Referer explicitly omitted
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      expect(extractCookieValue(res.setCookies, 'better-auth.session_token')).toBeNull();

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);

      // Demonstrate that challenge remains valid through trusted request
      const freshCode = await generateTotpCode(ownerTotpSecret);
      const trustedRes = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: freshCode }),
      });
      expect(trustedRes.status).toBe(200);
    });

    it('3.2. rejects cookie-bearing backup codes regeneration when Origin and Referer are omitted with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/generate-backup-codes',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
          // Origin and Referer explicitly omitted
        },
        body: JSON.stringify({ currentPassword: OWNER_INITIAL_PASSWORD }),
      });

      expect(res.status).toBe(403);
      const body = res.json<{ error?: string }>();
      expect(body.error).toContain('Origin غير صالح أو غير موثوق');

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });

    it('3.3. rejects cookie-bearing change-password when Origin and Referer are omitted with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/change-password',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
          // Origin and Referer explicitly omitted
        },
        body: JSON.stringify({
          currentPassword: OWNER_INITIAL_PASSWORD,
          newPassword: 'MissingOriginPassword123!',
        }),
      });

      expect(res.status).toBe(403);

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });
  });

  describe('Case 4: Literal Origin null (Origin: null)', () => {
    it('4.1. rejects sign-in with Origin: null with HTTP 403, zero cookies, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/sign-in/email',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': 'null',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: OWNER_EMAIL,
          password: OWNER_INITIAL_PASSWORD,
        }),
      });

      expect(res.status).toBe(403);
      expect(res.setCookies.length).toBe(0);

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });

    it('4.2. rejects cookie-bearing TOTP verification with Origin: null without same-origin sec-fetch-site with HTTP 403, challenge remains valid', async () => {
      const freshChallengeCookie = await getFreshMfaChallenge();
      const code = await generateTotpCode(ownerTotpSecret);

      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': 'null',
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      expect(extractCookieValue(res.setCookies, 'better-auth.session_token')).toBeNull();

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);

      // Demonstrate that challenge remains valid through trusted request
      const freshCode = await generateTotpCode(ownerTotpSecret);
      const trustedRes = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: freshCode }),
      });
      expect(trustedRes.status).toBe(200);
    });

    it('4.3. rejects cookie-bearing backup codes regeneration with Origin: null without same-origin sec-fetch-site with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/generate-backup-codes',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': 'null',
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword: OWNER_INITIAL_PASSWORD }),
      });

      expect(res.status).toBe(403);
      const body = res.json<{ error?: string }>();
      expect(body.error).toContain('Origin غير صالح أو غير موثوق');

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });

    it('4.4. rejects cookie-bearing change-password with Origin: null with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/change-password',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': 'null',
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: OWNER_INITIAL_PASSWORD,
          newPassword: 'NullOriginPassword123!',
        }),
      });

      expect(res.status).toBe(403);

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });
  });

  describe('Case 5: Conflicting Host and Proxy Header Validation', () => {
    it('5.1. rejects backup code regeneration with spoofed Host header with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/generate-backup-codes',
        headers: {
          'Host': 'attacker.invalid',
          'Origin': trustedOrigin,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword: OWNER_INITIAL_PASSWORD }),
      });

      expect(res.status).toBe(403);
      const body = res.json<{ error?: string }>();
      expect(body.error).toContain('Origin غير صالح أو غير موثوق');

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });

    it('5.2. ignores X-Forwarded-Host to prevent origin expansion, rejecting untrusted origin with HTTP 403, zero state mutation', async () => {
      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/sign-in/email',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'X-Forwarded-Host': 'attacker.invalid',
          'Origin': 'http://attacker.invalid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: OWNER_EMAIL,
          password: OWNER_INITIAL_PASSWORD,
        }),
      });

      expect(res.status).toBe(403);
      expect(res.setCookies.length).toBe(0);

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);
    });

    it('5.3. ignores X-Forwarded-Host on cookie-bearing 2FA verification, rejecting untrusted origin with HTTP 403, challenge remains valid', async () => {
      const freshChallengeCookie = await getFreshMfaChallenge();
      const code = await generateTotpCode(ownerTotpSecret);

      const beforeState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'X-Forwarded-Host': 'attacker.invalid',
          'Origin': 'http://attacker.invalid',
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      expect(extractCookieValue(res.setCookies, 'better-auth.session_token')).toBeNull();

      const afterState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
      assertSecurityStateUnchanged(beforeState, afterState);

      // Demonstrate that challenge remains valid through trusted request
      const freshCode = await generateTotpCode(ownerTotpSecret);
      const trustedRes = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Cookie': freshChallengeCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: freshCode }),
      });
      expect(trustedRes.status).toBe(200);
    });

    it('5.4. confirms zero database state drift across all untrusted and conflicting requests', async () => {
      // 1. Session count remains valid
      const sessRes = await dedicatedPool.query(
        'SELECT count(*)::int as count FROM session WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(sessRes.rows[0].count).toBeGreaterThanOrEqual(1);

      // 2. User credentialVersion remains untouched
      const userRes = await dedicatedPool.query(
        'SELECT "credentialVersion" FROM "user" WHERE id = $1',
        [ownerUserId]
      );
      expect(userRes.rows[0].credentialVersion).toBe(1);

      // 3. Password hash remains the initial password
      const accRes = await dedicatedPool.query(
        'SELECT password FROM account WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(accRes.rows[0].password).toBeDefined();

      // 4. TwoFactor failed verification count remains 0
      const tfRes = await dedicatedPool.query(
        'SELECT "failedVerificationCount", "lockedUntil" FROM "twoFactor" WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(tfRes.rows[0].failedVerificationCount).toBe(0);
      expect(tfRes.rows[0].lockedUntil).toBeNull();
    });
  });

  describe('Case 6: Production Password-Change Rate-Limiting Throttling & Recovery (R16-01 Boundary Regression)', () => {
    const NEW_OWNER_PASSWORD = 'MatrixOwnerRotatedSecret2026!';

    it(
      '6.1. proves rate-limiting boundary: 3 wrong-current-password attempts allowed (400), 4th throttled with HTTP 429 and X-Retry-After, zero state mutation',
      async () => {
        // Wait 10.5s to ensure a fresh, dedicated 10-second rate-limit window for /change-password
        await new Promise((r) => setTimeout(r, 10500));

        const baselineState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);

        // Requests 1, 2, 3: Within the allowance (max: 3 per 10s) -> Rejected by credential verification (HTTP 400 BAD_REQUEST)
        for (let i = 1; i <= 3; i++) {
          const res = await makeRequest(serverPort, {
            method: 'POST',
            path: '/api/auth/change-password',
            headers: {
              'Host': `127.0.0.1:${serverPort}`,
              'Origin': trustedOrigin,
              'Cookie': validSessionCookie!,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              currentPassword: `WrongPasswordAttempt${i}!#`,
              newPassword: 'AttemptedNewPassword123!#',
            }),
          });
          expect(res.status).toBe(400);
        }

        // Request 4: Exceeds the rate limit (4th request in the same 10s bucket) -> Must receive HTTP 429
        const throttledRes = await makeRequest(serverPort, {
          method: 'POST',
          path: '/api/auth/change-password',
          headers: {
            'Host': `127.0.0.1:${serverPort}`,
            'Origin': trustedOrigin,
            'Cookie': validSessionCookie!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currentPassword: 'WrongPasswordAttempt4!#',
            newPassword: 'AttemptedNewPassword123!#',
          }),
        });

        expect(throttledRes.status).toBe(429);

        // Verify presence and validity of Retry-After headers without exposing secrets
        const retryAfterHeader =
          (throttledRes.headers['x-retry-after'] as string | undefined) ||
          (throttledRes.headers['retry-after'] as string | undefined);
        expect(retryAfterHeader).toBeDefined();
        const retryAfterSeconds = parseInt(retryAfterHeader!, 10);
        expect(retryAfterSeconds).toBeGreaterThan(0);
        expect(retryAfterSeconds).toBeLessThanOrEqual(10);

        const body = throttledRes.json<{ message?: string }>();
        expect(body.message).toMatch(/too many requests/i);

        // Verify that all rejected and throttled attempts caused ZERO database mutation
        const afterThrottledState = await getSecurityStateSnapshot(dedicatedPool, ownerUserId);
        assertSecurityStateUnchanged(baselineState, afterThrottledState);
      },
      30000
    );

    it(
      '6.2. proves recovery after rate-limit window expiration and executes genuine password rotation',
      async () => {
        // Wait 11 seconds for the rate-limit window to completely reset
        await new Promise((r) => setTimeout(r, 11000));

        // Submit a genuine password change request with valid current password and trusted origin
        const res = await makeRequest(serverPort, {
          method: 'POST',
          path: '/api/auth/change-password',
          headers: {
            'Host': `127.0.0.1:${serverPort}`,
            'Origin': trustedOrigin,
            'Cookie': validSessionCookie!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currentPassword: OWNER_INITIAL_PASSWORD,
            newPassword: NEW_OWNER_PASSWORD,
            revokeOtherSessions: true,
          }),
        });

        expect(res.status).toBe(200);

        // Database verification: PostgreSQL trigger incremented user.credentialVersion from 1 to 2
        const userRes = await dedicatedPool.query(
          'SELECT "credentialVersion" FROM "user" WHERE id = $1',
          [ownerUserId]
        );
        expect(userRes.rows[0].credentialVersion).toBe(2);
      },
      30000
    );

    it('6.3. confirms old session is now rejected with HTTP 401 on protected endpoint', async () => {
      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/generate-backup-codes',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword: NEW_OWNER_PASSWORD }),
      });

      expect(res.status).toBe(401);
    });

    it('6.4. confirms new password works for trusted login and old password fails', async () => {
      // Old password fails
      const oldRes = await makeRequest(serverPort, {
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
      expect([400, 401]).toContain(oldRes.status);

      // New password succeeds
      const newRes = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/sign-in/email',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': trustedOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: OWNER_EMAIL,
          password: NEW_OWNER_PASSWORD,
        }),
      });
      expect(newRes.status).toBe(200);
      const body = newRes.json<{ twoFactorRedirect?: boolean }>();
      expect(body.twoFactorRedirect).toBe(true);
    });
  });
});
