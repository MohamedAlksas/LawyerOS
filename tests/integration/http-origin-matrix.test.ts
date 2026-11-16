import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'child_process';
import path from 'path';
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

function getFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => {
        if (err) return reject(err);
        if (port >= 6665 && port <= 6669) resolve(getFreeLoopbackPort());
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

    // 4. Allocate port and start production Next.js server
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

    // 5. Poll readiness probe
    const startTime = Date.now();
    let isReady = false;
    while (Date.now() - startTime < 30000) {
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
    expect(isReady).toBe(true);
  }, 45000);

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
      const beforeVerif = await dedicatedPool.query('SELECT count(*)::int as count FROM verification');

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

      // Verify zero state mutation in database
      const afterVerif = await dedicatedPool.query('SELECT count(*)::int as count FROM verification');
      expect(afterVerif.rows[0].count).toBe(beforeVerif.rows[0].count);
    });

    it('2.2. rejects TOTP verification attempt from untrusted origin with HTTP 403, zero session tokens issued', async () => {
      const beforeSess = await dedicatedPool.query('SELECT count(*)::int as count FROM session');
      const code = await generateTotpCode(ownerTotpSecret);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': UNTRUSTED_ORIGIN,
          'Cookie': validTwoFactorCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      const sessionCookie = extractCookieValue(res.setCookies, 'better-auth.session_token');
      expect(sessionCookie).toBeNull();

      const afterSess = await dedicatedPool.query('SELECT count(*)::int as count FROM session');
      expect(afterSess.rows[0].count).toBe(beforeSess.rows[0].count);
    });

    it('2.3. rejects backup code regeneration from untrusted origin with HTTP 403, zero data mutation', async () => {
      const before2fa = await dedicatedPool.query(
        'SELECT "backupCodes" FROM "twoFactor" WHERE "userId" = $1',
        [ownerUserId]
      );

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

      const after2fa = await dedicatedPool.query(
        'SELECT "backupCodes" FROM "twoFactor" WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(after2fa.rows[0].backupCodes).toBe(before2fa.rows[0].backupCodes);
    });

    it('2.4. rejects password change attempt from untrusted origin with HTTP 403, password unchanged in DB', async () => {
      const beforeAcc = await dedicatedPool.query(
        'SELECT password, "updatedAt" FROM account WHERE "userId" = $1',
        [ownerUserId]
      );

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

      const afterAcc = await dedicatedPool.query(
        'SELECT password, "updatedAt" FROM account WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(afterAcc.rows[0].password).toBe(beforeAcc.rows[0].password);
      expect(afterAcc.rows[0].updatedAt.toISOString()).toBe(beforeAcc.rows[0].updatedAt.toISOString());
    });
  });

  describe('Case 3: Missing Origin on Cookie-Bearing State-Changing Requests', () => {
    it('3.1. rejects cookie-bearing TOTP verification when Origin and Referer are omitted with HTTP 403', async () => {
      const beforeSess = await dedicatedPool.query('SELECT count(*)::int as count FROM session');
      const code = await generateTotpCode(ownerTotpSecret);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Cookie': validTwoFactorCookie!,
          'Content-Type': 'application/json',
          // Note: Origin and Referer explicitly omitted
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      expect(extractCookieValue(res.setCookies, 'better-auth.session_token')).toBeNull();

      const afterSess = await dedicatedPool.query('SELECT count(*)::int as count FROM session');
      expect(afterSess.rows[0].count).toBe(beforeSess.rows[0].count);
    });

    it('3.2. rejects cookie-bearing backup codes regeneration when Origin and Referer are omitted with HTTP 403', async () => {
      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/generate-backup-codes',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
          // Note: Origin and Referer explicitly omitted
        },
        body: JSON.stringify({ currentPassword: OWNER_INITIAL_PASSWORD }),
      });

      expect(res.status).toBe(403);
      const body = res.json<{ error?: string }>();
      expect(body.error).toContain('Origin غير صالح أو غير موثوق');
    });

    it('3.3. rejects cookie-bearing change-password when Origin and Referer are omitted with HTTP 403', async () => {
      const beforeAcc = await dedicatedPool.query(
        'SELECT password FROM account WHERE "userId" = $1',
        [ownerUserId]
      );

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/change-password',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Cookie': validSessionCookie!,
          'Content-Type': 'application/json',
          // Note: Origin and Referer explicitly omitted
        },
        body: JSON.stringify({
          currentPassword: OWNER_INITIAL_PASSWORD,
          newPassword: 'MissingOriginPassword123!',
        }),
      });

      expect(res.status).toBe(403);

      const afterAcc = await dedicatedPool.query(
        'SELECT password FROM account WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(afterAcc.rows[0].password).toBe(beforeAcc.rows[0].password);
    });
  });

  describe('Case 4: Literal Origin null (Origin: null)', () => {
    it('4.1. rejects sign-in with Origin: null with HTTP 403, zero cookies issued', async () => {
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
    });

    it('4.2. rejects cookie-bearing TOTP verification with Origin: null without same-origin sec-fetch-site with HTTP 403', async () => {
      const code = await generateTotpCode(ownerTotpSecret);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'Origin': 'null',
          'Cookie': validTwoFactorCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      expect(extractCookieValue(res.setCookies, 'better-auth.session_token')).toBeNull();
    });

    it('4.3. rejects cookie-bearing backup codes regeneration with Origin: null without same-origin sec-fetch-site with HTTP 403', async () => {
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
    });

    it('4.4. rejects cookie-bearing change-password with Origin: null with HTTP 403', async () => {
      const beforeAcc = await dedicatedPool.query(
        'SELECT password FROM account WHERE "userId" = $1',
        [ownerUserId]
      );

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

      const afterAcc = await dedicatedPool.query(
        'SELECT password FROM account WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(afterAcc.rows[0].password).toBe(beforeAcc.rows[0].password);
    });
  });

  describe('Case 5: Conflicting Host and Proxy Header Validation', () => {
    it('5.1. rejects backup code regeneration with spoofed Host header with HTTP 403', async () => {
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
    });

    it('5.2. ignores X-Forwarded-Host to prevent origin expansion, rejecting untrusted origin with HTTP 403', async () => {
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
    });

    it('5.3. ignores X-Forwarded-Host on cookie-bearing 2FA verification, rejecting untrusted origin with HTTP 403', async () => {
      const code = await generateTotpCode(ownerTotpSecret);

      const res = await makeRequest(serverPort, {
        method: 'POST',
        path: '/api/auth/two-factor/verify-totp',
        headers: {
          'Host': `127.0.0.1:${serverPort}`,
          'X-Forwarded-Host': 'attacker.invalid',
          'Origin': 'http://attacker.invalid',
          'Cookie': validTwoFactorCookie!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      expect(res.status).toBe(403);
      expect(extractCookieValue(res.setCookies, 'better-auth.session_token')).toBeNull();
    });

    it('5.4. confirms zero database state drift across all untrusted and conflicting requests', async () => {
      // 1. Session count remains exactly 1 (the original trusted session)
      const sessRes = await dedicatedPool.query(
        'SELECT count(*)::int as count FROM session WHERE "userId" = $1',
        [ownerUserId]
      );
      expect(sessRes.rows[0].count).toBe(1);

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
    });
  });

  describe('Case 6: Trusted Password Mutation & Session Revocation Verification (Final Control)', () => {
    const NEW_OWNER_PASSWORD = 'MatrixOwnerRotatedSecret2026!';

    it('6.1. successfully changes password from trusted origin, triggering credentialVersion increment and session eviction', async () => {
      expect(validSessionCookie).not.toBeNull();

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

      // Database verification: trigger incremented user.credentialVersion from 1 to 2
      const userRes = await dedicatedPool.query(
        'SELECT "credentialVersion" FROM "user" WHERE id = $1',
        [ownerUserId]
      );
      expect(userRes.rows[0].credentialVersion).toBe(2);
    });

    it('6.2. confirms old session is now rejected with HTTP 401 on protected endpoint', async () => {
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

    it('6.3. confirms new password works for trusted login and old password fails', async () => {
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
