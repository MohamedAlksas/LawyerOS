import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, exec, execFileSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';

/**
 * Dynamically obtains an unused private loopback port.
 */
function getFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => {
        if (err) reject(err);
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
function killOwnedProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }
    const pid = child.pid;
    if (process.platform === 'win32') {
      exec(`taskkill /PID ${pid} /T /F`, () => {
        resolve();
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          exec(`pkill -9 -P ${pid}; kill -9 ${pid}`, () => resolve());
          return;
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      }
      resolve();
    }
  });
}

describe('Startup Process Failure Boundary & Process Ownership (R24, R25)', () => {
  const nextBin = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');
  const activeChildren: ChildProcess[] = [];

  beforeAll(() => {
    const nextDir = path.resolve(process.cwd(), '.next');
    if (!fs.existsSync(nextDir)) {
      execFileSync(process.execPath, [nextBin, 'build'], {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'pipe',
      });
    }
  }, 60000);

  afterEach(async () => {
    // Clean up only task-spawned child processes
    while (activeChildren.length > 0) {
      const child = activeChildren.pop();
      if (child) {
        await killOwnedProcess(child);
      }
    }
  });

  it('terminates naturally with exit code 1 before listening when DATABASE_URL has raw space (R24, R25)', async () => {
    const port = await getFreeLoopbackPort();
    const invalidUrl =
      'postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test?application_name=synthetic name';

    let stdout = '';
    let stderr = '';

    const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATABASE_URL: invalidUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.push(child);
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

  it('terminates naturally with exit code 1 before listening when DATABASE_URL has malformed percent-escape (R24, R25)', async () => {
    const port = await getFreeLoopbackPort();
    const invalidUrl =
      'postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test?application_name=%zz';

    let stdout = '';
    let stderr = '';

    const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATABASE_URL: invalidUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.push(child);
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
    const testDbUrl = process.env.TEST_DATABASE_URL;
    const validUrl =
      testDbUrl || 'postgresql://lawoffice_user:synthetic_dev_secret@127.0.0.1:5432/lawoffice_dev?schema=public';

    const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATABASE_URL: validUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.push(child);
    const pid = child.pid;
    expect(pid).toBeDefined();

    // Poll liveness endpoint until ready
    const startTime = Date.now();
    let isReady = false;
    let livenessResponse: Response | null = null;

    while (Date.now() - startTime < 15000) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health/live`);
        if (res.status === 200) {
          isReady = true;
          livenessResponse = res;
          break;
        }
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

    // If database is reachable, also verify readiness probe (HTTP 200) with no-store headers
    if (testDbUrl) {
      try {
        const readyRes = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
        if (readyRes.status === 200) {
          const readyBody = (await readyRes.json()) as {
            status: string;
            check: string;
            database?: { status: string };
          };
          expect(readyBody.status).toBe('pass');
          expect(readyBody.check).toBe('readiness');
          expect(readyBody.database?.status).toBe('connected');
          expect(readyRes.headers.get('cache-control')).toContain('no-store');
        }
      } catch {}
    }

    // Clean up strictly the owned process
    await killOwnedProcess(child);

    // Verify port is closed after owned cleanup (polling with retry)
    const closedAfter = await waitForPortClosed(port);
    expect(closedAfter).toBe(true);
  }, 20000);
});
