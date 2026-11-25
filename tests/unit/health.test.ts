import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET as livenessHandler } from '@/app/api/health/live/route';
import { GET as readinessHandler } from '@/app/api/health/ready/route';
import * as dbModule from '@/lib/db';
import { EnvironmentValidationError } from '@/lib/env';

describe('Health Routes (Liveness and Readiness)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('liveness route returns HTTP 200 with non-sensitive status and uptime', async () => {
    const response = await livenessHandler();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('pass');
    expect(body.check).toBe('liveness');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');

    // Ensure no sensitive credentials or database internals are leaked
    expect(JSON.stringify(body)).not.toContain('password');
    expect(JSON.stringify(body)).not.toContain('postgres');
    expect(JSON.stringify(body)).not.toContain('postgresql');
  });

  it('readiness route returns HTTP 503 when database probe fails', async () => {
    const checkReadinessSpy = vi.spyOn(dbModule, 'checkDatabaseReadiness').mockResolvedValueOnce({
      ok: false,
      latencyMs: 15,
      error: 'Database service unreachable (connection refused)',
    });

    const response = await readinessHandler();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('fail');
    expect(body.check).toBe('readiness');
    expect(body.database.status).toBe('disconnected');
    expect(body.database.error).toBe('Database service unreachable (connection refused)');

    // Ensure no credentials or raw connection strings are returned
    expect(JSON.stringify(body)).not.toContain('password');
    expect(JSON.stringify(body)).not.toContain('secret');

    checkReadinessSpy.mockRestore();
  });

  it('readiness route returns HTTP 200 when database probe succeeds', async () => {
    const checkReadinessSpy = vi.spyOn(dbModule, 'checkDatabaseReadiness').mockResolvedValueOnce({
      ok: true,
      latencyMs: 4,
    });

    const response = await readinessHandler();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('pass');
    expect(body.check).toBe('readiness');
    expect(body.database.status).toBe('connected');
    expect(body.database.latencyMs).toBe(4);

    checkReadinessSpy.mockRestore();
  });

  it('readiness route catches configuration failures and returns HTTP 503 without unhandled 500 (R05)', async () => {
    const checkReadinessSpy = vi.spyOn(dbModule, 'checkDatabaseReadiness').mockRejectedValueOnce(
      new EnvironmentValidationError('Missing required environment variable(s): DATABASE_URL', ['DATABASE_URL'])
    );

    const response = await readinessHandler();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('fail');
    expect(body.check).toBe('readiness');
    expect(body.database.status).toBe('disconnected');
    expect(body.database.error).toBe('Database configuration missing or invalid');

    checkReadinessSpy.mockRestore();
  });
});
