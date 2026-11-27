import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { validateEnv } from '@/lib/env';

const RESERVED_NEXT_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109,
  110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045,
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

/**
 * Dynamically obtains an unused private loopback port.
 */
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

/**
 * Checks whether a given loopback port is closed (refuses connections).
 */
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

/**
 * Polls until the port is confirmed closed, or times out.
 * Accommodates OS socket release delays across platforms.
 */
async function waitForPortClosed(port: number, timeoutMs = 5000, host = '127.0.0.1'): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const closed = await isPortClosed(port, host);
    if (closed) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Terminates strictly the task-owned child process and its process tree.
 * On Windows: uses taskkill /PID <pid> /T /F
 * On POSIX: kills the process group or process tree using process.kill(-pid, 'SIGKILL')
 * Avoids any blanket or by-name process termination.
 */
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
  await waitForExit(child, 5000);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Owned process did not exit within ${timeoutMs}ms; PID: ${child.pid}`));
    }, timeoutMs);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

describe('Startup Process Failure Boundary & Process Ownership (R24, R25)', () => {
  const nextBin = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');
  const activeChildren: ChildProcess[] = [];
  const activePorts = new Map<ChildProcess, number>();
  let validatedTestUrl: string;

  beforeAll(async () => {
    // Validate the original pair before launching any build or server child.
    // In particular, never replace DATABASE_URL before its identity is compared.
    validatedTestUrl = validateEnv({ ...process.env, NODE_ENV: 'test' }).DATABASE_URL;
    const bundler = process.env.STARTUP_TEST_BUNDLER ?? 'turbopack';
    if (bundler !== 'turbopack' && bundler !== 'webpack') {
      throw new Error('STARTUP_TEST_BUNDLER must be turbopack or webpack.');
    }

    const buildIdPath = path.resolve('.next/BUILD_ID');
    if (!process.env.FORCE_STARTUP_REBUILD && fs.existsSync(buildIdPath)) {
      const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
      console.info(`[startup-process] reusing existing build: ${buildId}`);
      return;
    }

    // Build this checkout if no valid pre-built artifact exists.
    const build = spawn(process.execPath, [nextBin, 'build', ...(bundler === 'webpack' ? ['--webpack'] : [])], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: validatedTestUrl,
        BETTER_AUTH_URL: 'https://lawoffice.example.com',
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'synthetic-startup-secret-key-at-least-32-chars',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.push(build);
    let output = '';
    build.stdout?.on('data', (data) => { output += data.toString(); });
    build.stderr?.on('data', (data) => { output += data.toString(); });
    try {
      const result = await waitForExit(build, 120000);
      if (result.code !== 0) throw new Error(`Fresh startup build failed: ${output}`);
    } catch (error) {
      await killOwnedProcess(build);
      throw error;
    }
    const buildId = fs.readFileSync(path.resolve('.next/BUILD_ID'), 'utf8').trim();
    console.info(`[startup-process] fresh ${bundler} build: ${buildId}`);
  }, 140000);

  afterEach(async () => {
    // Clean up only task-spawned child processes
    while (activeChildren.length > 0) {
      const child = activeChildren.pop();
      if (child) {
        await killOwnedProcess(child);
        const port = activePorts.get(child);
        if (port !== undefined) {
          expect(await waitForPortClosed(port)).toBe(true);
          activePorts.delete(child);
        }
      }
    }
  });

  it('exits naturally with code 1 and closes its port when DATABASE_URL has raw space (R24, R25)', async () => {
    const port = await getFreeLoopbackPort();
    const invalidUrl =
      'postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test?application_name=synthetic name';

    let stdout = '';
    let stderr = '';

    const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATABASE_URL: invalidUrl,
        BETTER_AUTH_URL: 'https://lawoffice.example.com',
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'synthetic-startup-secret-key-at-least-32-chars',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.push(child);
    activePorts.set(child, port);
    expect(child.pid).toBeDefined();

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    // Wait for the child process's OWN natural exit within 10 seconds.
    // If watchdog timer expires, fail the test (server hung instead of naturally exiting).
    const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Server process did not exit on its own within timeout; PID: ${child.pid}`));
        }, 10000);

        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      }
    );

    // 1. Natural exit status must be nonzero (code 1)
    expect(exitResult.code).toBe(1);

    // 2. Output contains sanitized diagnostic message
    const combinedOutput = stdout + stderr;
    expect(combinedOutput).toContain('[Startup Failure]');
    expect(combinedOutput).toContain('PostgreSQL connection string must not contain raw whitespace');
    // Must never leak synthetic credentials
    expect(combinedOutput).not.toContain('synthetic:synthetic');

    // 3. Port was never left bound/listening
    const closed = await waitForPortClosed(port);
    expect(closed).toBe(true);
  }, 15000);

  it('exits naturally with code 1 and closes its port when DATABASE_URL has malformed percent-escape (R24, R25)', async () => {
    const port = await getFreeLoopbackPort();
    const invalidUrl =
      'postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test?application_name=%zz';

    let stdout = '';
    let stderr = '';

    const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATABASE_URL: invalidUrl,
        BETTER_AUTH_URL: 'https://lawoffice.example.com',
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'synthetic-startup-secret-key-at-least-32-chars',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.push(child);
    activePorts.set(child, port);
    expect(child.pid).toBeDefined();

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Server process did not exit on its own within timeout; PID: ${child.pid}`));
        }, 10000);

        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      }
    );

    // 1. Natural exit status must be nonzero (code 1)
    expect(exitResult.code).toBe(1);

    // 2. Output contains sanitized diagnostic message
    const combinedOutput = stdout + stderr;
    expect(combinedOutput).toContain('[Startup Failure]');
    expect(combinedOutput).toContain('PostgreSQL connection string contains malformed percent-encoding');
    expect(combinedOutput).not.toContain('synthetic:synthetic');

    // 3. Port was never left bound/listening
    const closed = await waitForPortClosed(port);
    expect(closed).toBe(true);
  }, 15000);

  it('starts successfully with valid configuration, responds HTTP 200 on health probe, and cleans up owned PID (R25)', async () => {
    const port = await getFreeLoopbackPort();
    const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATABASE_URL: validatedTestUrl,
        BETTER_AUTH_URL: 'https://lawoffice.example.com',
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'synthetic-startup-secret-key-at-least-32-chars',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.push(child);
    activePorts.set(child, port);
    const pid = child.pid;
    expect(pid).toBeDefined();

    // Poll liveness endpoint until ready
    const startTime = Date.now();
    let isReady = false;
    let livenessResponse: Response | null = null;

    while (Date.now() - startTime < 15000) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health/live`, { signal: AbortSignal.timeout(1000) });
        if (res.status === 200) {
          isReady = true;
          livenessResponse = res;
          break;
        }
        await res.body?.cancel();
      } catch {
        // Server not ready yet; wait and retry
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    expect(isReady).toBe(true);
    expect(livenessResponse).not.toBeNull();
    expect(livenessResponse?.status).toBe(200);

    const body = (await livenessResponse?.json()) as { status: string; check: string };
    expect(body.status).toBe('pass');
    expect(body.check).toBe('liveness');

    // Readiness is mandatory: status, JSON, header and network failures must fail.
    const readyRes = await fetch(`http://127.0.0.1:${port}/api/health/ready`, { signal: AbortSignal.timeout(5000) });
    expect(readyRes.status).toBe(200);
    const readyBody = (await readyRes.json()) as {
      status: string;
      check: string;
      database?: { status: string };
    };
    expect(readyBody.status).toBe('pass');
    expect(readyBody.check).toBe('readiness');
    expect(readyBody.database?.status).toBe('connected');
    expect(readyRes.headers.get('cache-control')).toContain('no-store');

    // Clean up strictly the owned process
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    await killOwnedProcess(child);

    // Verify port is closed after owned cleanup (polling with retry)
    const closedAfter = await waitForPortClosed(port);
    expect(closedAfter).toBe(true);
  }, 20000);
});
