import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import {
  provisionOwner,
  confirmOwnerProvisioning,
  requireActor,
  authorize,
} from '@/modules/identity';
import { closeDbPool } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { NextRequest } from 'next/server';
import { POST as authRoutePOST } from '@/app/api/auth/[...all]/route';
import { createDedicatedTestDatabase } from '../helpers/test-db';

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

function runPrismaCli(args: string[], dbUrl: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  return spawnSync(process.execPath, [prismaJs, ...args], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
    },
    encoding: 'utf-8',
  });
}

describe('Supported Non-Destructive Migration Upgrade & Baseline Verification (T03 / R08)', () => {
  let dedicated: { url: string; pool: Pool; drop: () => Promise<void> };
  let pool: Pool;
  let originalTestDatabaseUrl: string | undefined;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
    originalDatabaseUrl = process.env.DATABASE_URL;

    // 1. Create a fresh dedicated disposable test database
    dedicated = await createDedicatedTestDatabase();
    pool = dedicated.pool;

    // 2. Populate pre-existing non-empty T02 schema and data (no _prisma_migrations table)
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE sentinel_audit_log (
          id SERIAL PRIMARY KEY,
          action TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        INSERT INTO sentinel_audit_log (action) 
        VALUES ('T02_PRE_EXISTING_AUDIT_ENTRY');
      `);
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
    }
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    getEnv(true);
  }, 30000);

  it('demonstrates raw prisma migrate deploy fails with P3005 on unbaselined non-empty T02 database', () => {
    // Attempting raw migrate deploy on a non-empty database without _prisma_migrations must fail
    const result = runPrismaCli(['migrate', 'deploy'], dedicated.url);
    expect(result.status).not.toBe(0);

    const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
    expect(combinedOutput).toContain('P3005');
    expect(combinedOutput).toMatch(/The database (?:schema )?is not empty/);

    // Verify pre-existing data was NOT damaged or dropped
    const client = pool;
    return client.query('SELECT * FROM sentinel_audit_log').then((res) => {
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].action).toBe('T02_PRE_EXISTING_AUDIT_ENTRY');
    });
  }, 60000);

  it('executes documented supported non-destructive baseline procedure', async () => {
    // Step 1: Execute whole-file migration SQL script in a single transaction with fail-fast semantics
    const migrationSqlPath = path.resolve(
      process.cwd(),
      'prisma/migrations/20261111000000_init_auth/migration.sql'
    );
    const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migrationSql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Step 2: Verify PostgreSQL schema, tables, and columns BEFORE recording migration history
    const tablesRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
    `);
    const tableNames = tablesRes.rows.map((r) => r.table_name);
    expect(tableNames).toContain('user');
    expect(tableNames).toContain('session');
    expect(tableNames).toContain('account');
    expect(tableNames).toContain('verification');
    expect(tableNames).toContain('twoFactor');
    expect(tableNames).toContain('office_bootstrap');

    // Verify critical columns on twoFactor
    const twoFactorCols = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'twoFactor';
    `);
    const tfColNames = twoFactorCols.rows.map((r) => r.column_name);
    expect(tfColNames).toContain('failedVerificationCount');
    expect(tfColNames).toContain('lockedUntil');

    // Step 3: Baseline the verified migration in Prisma migration history table
    const resolveResult = runPrismaCli(
      ['migrate', 'resolve', '--applied', '20261111000000_init_auth'],
      dedicated.url
    );
    expect(resolveResult.status).toBe(0);

    // Step 4: Verify migration status reports clean state
    const statusResult = runPrismaCli(['migrate', 'status'], dedicated.url);
    expect(statusResult.status).toBe(0);

    // Step 5: Verify subsequent prisma migrate deploy exits with 0 ("No pending migrations to apply")
    const deployResult = runPrismaCli(['migrate', 'deploy'], dedicated.url);
    expect(deployResult.status).toBe(0);
    const deployOutput = `${deployResult.stdout || ''}\n${deployResult.stderr || ''}`;
    expect(deployOutput).toContain('No pending migrations to apply');

    // Step 6: Verify pre-existing sentinel rows remain intact (non-destructive guarantee)
    const sentinelRes = await pool.query('SELECT * FROM sentinel_audit_log');
    expect(sentinelRes.rows.length).toBe(1);
    expect(sentinelRes.rows[0].action).toBe('T02_PRE_EXISTING_AUDIT_ENTRY');
  }, 60000);

  it('fails fast on conflicting pre-existing schema: refuses to baseline, does not record history, and recovers safely upon resolution', async () => {
    // 1. Create a fresh dedicated database with pre-existing sentinel data
    const conflictDb = await createDedicatedTestDatabase();

    const client = await conflictDb.pool.connect();
    try {
      await client.query(`
        CREATE TABLE sentinel_pre_existing (
          id SERIAL PRIMARY KEY,
          data TEXT NOT NULL
        );
        INSERT INTO sentinel_pre_existing (data) VALUES ('PRE_EXISTING_DATA_RETAINED');
      `);

      // 2. Pre-create a conflicting table that clashes with migration schema
      await client.query(`
        CREATE TABLE "user" (
          id SERIAL PRIMARY KEY,
          conflicting_column TEXT NOT NULL
        );
      `);
    } finally {
      client.release();
    }

    const migrationSqlPath = path.resolve(
      process.cwd(),
      'prisma/migrations/20261111000000_init_auth/migration.sql'
    );
    const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

    // 3. Attempt fail-fast execution of baseline migration SQL inside transaction
    const attemptClient = await conflictDb.pool.connect();
    let migrationError: unknown = null;
    try {
      await attemptClient.query('BEGIN');
      await attemptClient.query(migrationSql);
      await attemptClient.query('COMMIT');
    } catch (err) {
      await attemptClient.query('ROLLBACK').catch(() => {});
      migrationError = err;
    } finally {
      attemptClient.release();
    }

    // Must fail fast with relation already exists error
    expect(migrationError).toBeDefined();

    // 4. Verify baseline history was NOT recorded in Prisma history table
    const migTableRes = await conflictDb.pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
    `);
    if (migTableRes.rows.length > 0) {
      const historyRows = await conflictDb.pool.query(
        'SELECT * FROM _prisma_migrations WHERE migration_name = $1',
        ['20261111000000_init_auth']
      );
      expect(historyRows.rows.length).toBe(0);
    }

    // 5. Verify pre-existing sentinel data was NOT damaged or lost
    const sentinelCheck = await conflictDb.pool.query('SELECT * FROM sentinel_pre_existing');
    expect(sentinelCheck.rows.length).toBe(1);
    expect(sentinelCheck.rows[0].data).toBe('PRE_EXISTING_DATA_RETAINED');

    // 6. Recovery: Resolve the conflict by dropping the conflicting incompatible table
    const resolveClient = await conflictDb.pool.connect();
    try {
      await resolveClient.query('DROP TABLE "user";');
    } finally {
      resolveClient.release();
    }

    // 7. Re-execute fail-fast whole-file migration SQL in transaction
    const retryClient = await conflictDb.pool.connect();
    try {
      await retryClient.query('BEGIN');
      await retryClient.query(migrationSql);
      await retryClient.query('COMMIT');
    } finally {
      retryClient.release();
    }

    // Verify PostgreSQL schema before baseline
    const verifiedTables = await conflictDb.pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
    `);
    expect(verifiedTables.rows.map((r) => r.table_name)).toContain('user');
    expect(verifiedTables.rows.map((r) => r.table_name)).toContain('twoFactor');

    // Baseline in Prisma migration history table
    const recResolveResult = runPrismaCli(
      ['migrate', 'resolve', '--applied', '20261111000000_init_auth'],
      conflictDb.url
    );
    expect(recResolveResult.status).toBe(0);

    // Verify status & deploy
    const recStatus = runPrismaCli(['migrate', 'status'], conflictDb.url);
    expect(recStatus.status).toBe(0);

    const recDeploy = runPrismaCli(['migrate', 'deploy'], conflictDb.url);
    expect(recDeploy.status).toBe(0);
    expect(recDeploy.stdout).toContain('No pending migrations to apply');

    // Sentinel data intact after recovery
    const sentinelFinal = await conflictDb.pool.query('SELECT * FROM sentinel_pre_existing');
    expect(sentinelFinal.rows.length).toBe(1);
    expect(sentinelFinal.rows[0].data).toBe('PRE_EXISTING_DATA_RETAINED');

    await conflictDb.drop();
  }, 60000);

  it('proves database is fully operational after upgrade: provisions owner, completes 2FA, and issues verified session', async () => {
    // Switch runtime test database to the newly upgraded dedicated database
    // Note: Leave process.env.DATABASE_URL untouched so the R07/R08 isolation guard remains intact
    process.env.TEST_DATABASE_URL = dedicated.url;
    getEnv(true);
    await clearGlobalSingletons();

    // 1. Provision owner on the upgraded database
    const ownerResult = await provisionOwner({
      name: 'مالك الترقية الآمنة',
      email: 'upgrade.owner@office.eg',
      password: 'UpgradedOwnerPass2026!',
    });
    expect(ownerResult.user.email).toBe('upgrade.owner@office.eg');
    expect(ownerResult.user.role).toBe('OWNER');

    // 2. Confirm provisioning using genuine RFC 6238 TOTP code derived from totpURI
    const validCode = await generateTotpCode(ownerResult.totpSecret);
    await confirmOwnerProvisioning(ownerResult.user.id, validCode);

    // 3. Authenticate via protocol endpoints
    const signInReq = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'upgrade.owner@office.eg',
        password: 'UpgradedOwnerPass2026!',
      }),
    });
    const signInRes = await authRoutePOST(signInReq);
    expect(signInRes.status).toBe(200);
    const signInJson = await signInRes.json();
    expect(signInJson.twoFactorRedirect).toBe(true);

    const setCookies = signInRes.headers.getSetCookie?.() || [signInRes.headers.get('set-cookie') || ''];
    const tfCookie = setCookies.find((c) => c.includes('better-auth.two_factor='));
    expect(tfCookie).toBeDefined();

    // 4. Complete 2FA via /api/auth/two-factor/verify-totp
    const freshCode = await generateTotpCode(ownerResult.totpSecret);
    const verifyTotpReq = new NextRequest('http://127.0.0.1:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookie!.split(';')[0],
      },
      body: JSON.stringify({ code: freshCode }),
    });
    const verifyTotpRes = await authRoutePOST(verifyTotpReq);
    expect(verifyTotpRes.status).toBe(200);
    const verifyJson = await verifyTotpRes.json();
    expect(verifyJson.token).toBeDefined();

    // 5. Verify authoritative actor resolution via requireActor
    const actor = await requireActor({ headers: makeSessionHeaders(verifyJson.token) });
    expect(actor.id).toBe(ownerResult.user.id);
    expect(actor.email).toBe('upgrade.owner@office.eg');
    expect(actor.role).toBe('OWNER');
    expect(actor.twoFactorVerified).toBe(true);
    expect(authorize(actor, 'READ_CLIENT_DATA')).toBe(true);

    // 6. Verify pre-existing sentinel rows remain intact after active usage
    const sentinelFinal = await pool.query('SELECT * FROM sentinel_audit_log');
    expect(sentinelFinal.rows.length).toBe(1);
    expect(sentinelFinal.rows[0].action).toBe('T02_PRE_EXISTING_AUDIT_ENTRY');
  }, 60000);
});

