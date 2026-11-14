import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import {
  provisionOwner,
  confirmOwnerProvisioning,
  requireActor,
  authorize,
} from '@/modules/identity';
import { runIdentityBaseline } from '@/cli/baseline-identity';
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
    // Execute canonical executable baseline entry point
    const baselineResult = await runIdentityBaseline({
      targetUrl: dedicated.url,
      silent: true,
    });
    expect(baselineResult.success).toBe(true);
    expect(baselineResult.appliedMigration).toBe('20261111000000_init_auth');

    // Verify subsequent prisma migrate deploy exits with 0 ("No pending migrations to apply")
    const deployResult = runPrismaCli(['migrate', 'deploy'], dedicated.url);
    expect(deployResult.status).toBe(0);
    const deployOutput = `${deployResult.stdout || ''}\n${deployResult.stderr || ''}`;
    expect(deployOutput).toContain('No pending migrations to apply');

    // Verify pre-existing sentinel rows remain intact (non-destructive guarantee)
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

    // 3. Attempt execution of canonical baseline entry point; must fail fast
    await expect(
      runIdentityBaseline({ targetUrl: conflictDb.url, silent: true })
    ).rejects.toThrow();

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

    // 7. Re-execute canonical baseline entry point; must succeed
    const recoveryResult = await runIdentityBaseline({
      targetUrl: conflictDb.url,
      silent: true,
    });
    expect(recoveryResult.success).toBe(true);

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

  it('rejects missing or empty target URL without executing DDL or mutating database', async () => {
    // 1. Invoking runIdentityBaseline without a target URL must throw
    await expect(runIdentityBaseline({ targetUrl: '', silent: true })).rejects.toThrow(
      'Target database URL is required'
    );

    // 2. Invoking CLI with missing target argument exits non-zero (1)
    const cliJs = path.resolve(process.cwd(), 'src/cli/baseline-identity.ts');
    const cliRes = spawnSync(process.execPath, [
      path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      cliJs,
    ], {
      env: { ...process.env, DATABASE_URL: '' },
      encoding: 'utf-8',
    });
    expect(cliRes.status).toBe(1);
    expect(cliRes.stderr).toContain('Missing required argument: --target-url <database_url>');
  });

  it('executes baseline against explicit target and does not mutate ambient PGDATABASE fixture', async () => {
    // 1. Create two isolated dedicated test databases
    const targetDb = await createDedicatedTestDatabase();
    const ambientFixtureDb = await createDedicatedTestDatabase();

    try {
      // 2. Insert sentinel in ambient fixture
      await ambientFixtureDb.pool.query(`
        CREATE TABLE ambient_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO ambient_sentinel (note) VALUES ('SHOULD_REMAIN_UNMUTATED');
      `);

      // 3. Execute baseline targeting targetDb while environment has PGDATABASE pointing to ambientFixtureDb
      const ambientDbParsed = new URL(ambientFixtureDb.url);
      const ambientDbName = decodeURIComponent(ambientDbParsed.pathname.replace(/^\//, ''));

      const cliJs = path.resolve(process.cwd(), 'src/cli/baseline-identity.ts');
      const cliRes = spawnSync(process.execPath, [
        path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        cliJs,
        '--target-url',
        targetDb.url,
      ], {
        env: {
          ...process.env,
          PGDATABASE: ambientDbName, // ambient PGDATABASE set to other database
        },
        encoding: 'utf-8',
      });
      expect(cliRes.status).toBe(0);

      // 4. Verify targetDb received full baseline managed tables
      const targetTables = await targetDb.pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
      `);
      expect(targetTables.rows.length).toBe(6);

      // 5. Verify ambient fixture was NOT mutated (no Identity tables created)
      const ambientTables = await ambientFixtureDb.pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
      `);
      expect(ambientTables.rows.length).toBe(0);

      const ambientSentinel = await ambientFixtureDb.pool.query('SELECT * FROM ambient_sentinel;');
      expect(ambientSentinel.rows.length).toBe(1);
      expect(ambientSentinel.rows[0].note).toBe('SHOULD_REMAIN_UNMUTATED');
    } finally {
      await targetDb.drop().catch(() => {});
      await ambientFixtureDb.drop().catch(() => {});
    }
  }, 60000);

  it('handles post-DDL history recording failure and safely recovers upon retry (Correction 3)', async () => {
    // 1. Create a fresh dedicated database with pre-existing sentinel data
    const recoveryDb = await createDedicatedTestDatabase();

    try {
      // Insert sentinel data
      await recoveryDb.pool.query(`
        CREATE TABLE sentinel_recovery_test (
          id SERIAL PRIMARY KEY,
          note TEXT NOT NULL
        );
        INSERT INTO sentinel_recovery_test (note) VALUES ('SENTINEL_SURVIVES_POST_DDL_FAILURE');
      `);

      // Pre-create _prisma_migrations table with a trigger that raises an exception on insert,
      // simulating permission failure / connectivity failure during history recording
      await recoveryDb.pool.query(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          id VARCHAR(36) PRIMARY KEY,
          checksum VARCHAR(64) NOT NULL,
          finished_at TIMESTAMPTZ,
          migration_name VARCHAR(255) NOT NULL,
          logs TEXT,
          rolled_back_at TIMESTAMPTZ,
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          applied_steps_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE OR REPLACE FUNCTION fail_prisma_history_insert() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Simulated PostgreSQL failure during _prisma_migrations recording';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER trig_fail_history_insert
          BEFORE INSERT ON "_prisma_migrations"
          FOR EACH ROW EXECUTE FUNCTION fail_prisma_history_insert();
      `);

      // 2. Execute baseline: SQL commits, schema is verified, but Prisma history recording fails!
      await expect(
        runIdentityBaseline({ targetUrl: recoveryDb.url, silent: true })
      ).rejects.toThrow();

      // 3. Verify post-DDL state:
      // a) DDL is committed in PostgreSQL (all 6 managed tables exist)
      const tablesCheck = await recoveryDb.pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
      `);
      expect(tablesCheck.rows.length).toBe(6);

      // b) Zero history in _prisma_migrations
      const histCheck = await recoveryDb.pool.query('SELECT * FROM "_prisma_migrations";');
      expect(histCheck.rows.length).toBe(0);

      // c) Sentinel data is completely undamaged
      const sentCheck = await recoveryDb.pool.query('SELECT * FROM sentinel_recovery_test;');
      expect(sentCheck.rows.length).toBe(1);
      expect(sentCheck.rows[0].note).toBe('SENTINEL_SURVIVES_POST_DDL_FAILURE');

      // 4. Recovery: Remove the simulated fault / restore permission
      await recoveryDb.pool.query('DROP TRIGGER trig_fail_history_insert ON "_prisma_migrations";');

      // 5. Rerun baseline: must detect verified matching schema, safely resume history recording, and succeed!
      const recoveryResult = await runIdentityBaseline({
        targetUrl: recoveryDb.url,
        silent: true,
      });
      expect(recoveryResult.success).toBe(true);
      expect(recoveryResult.recovered).toBe(true);
      expect(recoveryResult.appliedMigration).toBe('20261111000000_init_auth');

      // 6. Verify migration status reports clean state
      const deployResult = runPrismaCli(['migrate', 'deploy'], recoveryDb.url);
      expect(deployResult.status).toBe(0);
      expect(deployResult.stdout).toContain('No pending migrations to apply');

      // 7. Sentinel data remains intact after recovery
      const sentFinal = await recoveryDb.pool.query('SELECT * FROM sentinel_recovery_test;');
      expect(sentFinal.rows.length).toBe(1);
      expect(sentFinal.rows[0].note).toBe('SENTINEL_SURVIVES_POST_DDL_FAILURE');
    } finally {
      await recoveryDb.drop().catch(() => {});
    }
  }, 90000);

  it('succeeds idempotently on already-completed baseline with alreadyCompleted: true (Correction 3)', async () => {
    // dedicated.url was already baselined in earlier test
    const result = await runIdentityBaseline({
      targetUrl: dedicated.url,
      silent: true,
    });
    expect(result.success).toBe(true);
    expect(result.alreadyCompleted).toBe(true);
    expect(result.appliedMigration).toBe('20261111000000_init_auth');
    expect(result.tables.length).toBe(6);
  });

  it('fails fast on incompatible partial or mismatched managed schema and refuses to baseline or record history (Correction 3)', async () => {
    const mismatchedDb = await createDedicatedTestDatabase();
    try {
      // Create an incompatible 'user' table missing required columns
      await mismatchedDb.pool.query(`
        CREATE TABLE "user" (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);

      await expect(
        runIdentityBaseline({ targetUrl: mismatchedDb.url, silent: true })
      ).rejects.toThrow(/Cannot baseline: existing schema contains conflicting or incompatible managed entities/);

      // Zero history recorded in _prisma_migrations
      const migTableRes = await mismatchedDb.pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
      `);
      if (migTableRes.rows.length > 0) {
        const historyRows = await mismatchedDb.pool.query(
          'SELECT * FROM _prisma_migrations WHERE migration_name = $1',
          ['20261111000000_init_auth']
        );
        expect(historyRows.rows.length).toBe(0);
      }
    } finally {
      await mismatchedDb.drop().catch(() => {});
    }
  }, 60000);

  it('rejects baseline when user_email_key is non-unique (reproduction a / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const migrationSqlPath = path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');
      const fs = await import('fs');
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

      // 1. Apply approved migration SQL without Prisma history
      await reproDb.pool.query(migrationSql);

      // 2. Insert sentinel data
      await reproDb.pool.query(`
        CREATE TABLE repro_a_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_a_sentinel (note) VALUES ('SENTINEL_A_PRESERVED');
      `);

      // 3. Mutate user_email_key to be non-unique (same name)
      await reproDb.pool.query('DROP INDEX "user_email_key";');
      await reproDb.pool.query('CREATE INDEX "user_email_key" ON "user"("email");');

      // 4. Baseline must fail fast and refuse to record history
      await expect(
        runIdentityBaseline({ targetUrl: reproDb.url, silent: true })
      ).rejects.toThrow(/conflicting or incompatible managed entities/);

      // 5. Zero history recorded in _prisma_migrations
      const migTableRes = await reproDb.pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
      `);
      if (migTableRes.rows.length > 0) {
        const historyRows = await reproDb.pool.query(
          'SELECT * FROM _prisma_migrations WHERE migration_name = $1',
          ['20261111000000_init_auth']
        );
        expect(historyRows.rows.length).toBe(0);
      }

      // 6. Sentinel data remains intact
      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_a_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_A_PRESERVED');
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('rejects baseline when twoFactor.verified default is false instead of true (reproduction b / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const migrationSqlPath = path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');
      const fs = await import('fs');
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

      await reproDb.pool.query(migrationSql);

      await reproDb.pool.query(`
        CREATE TABLE repro_b_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_b_sentinel (note) VALUES ('SENTINEL_B_PRESERVED');
      `);

      // Mutate default to false
      await reproDb.pool.query('ALTER TABLE "twoFactor" ALTER COLUMN "verified" SET DEFAULT false;');

      await expect(
        runIdentityBaseline({ targetUrl: reproDb.url, silent: true })
      ).rejects.toThrow(/conflicting or incompatible managed entities/);

      const migTableRes = await reproDb.pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
      `);
      if (migTableRes.rows.length > 0) {
        const historyRows = await reproDb.pool.query(
          'SELECT * FROM _prisma_migrations WHERE migration_name = $1',
          ['20261111000000_init_auth']
        );
        expect(historyRows.rows.length).toBe(0);
      }

      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_b_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_B_PRESERVED');
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('rejects baseline when session_userId_fkey is retargeted to an unrelated table (reproduction c / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const migrationSqlPath = path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');
      const fs = await import('fs');
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

      await reproDb.pool.query(migrationSql);

      await reproDb.pool.query(`
        CREATE TABLE unrelated_target (id TEXT PRIMARY KEY);
        CREATE TABLE repro_c_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_c_sentinel (note) VALUES ('SENTINEL_C_PRESERVED');
      `);

      // Retarget session_userId_fkey to unrelated table while keeping name and cascade actions
      await reproDb.pool.query('ALTER TABLE "session" DROP CONSTRAINT "session_userId_fkey";');
      await reproDb.pool.query(
        'ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES unrelated_target(id) ON DELETE CASCADE ON UPDATE CASCADE;'
      );

      await expect(
        runIdentityBaseline({ targetUrl: reproDb.url, silent: true })
      ).rejects.toThrow(/conflicting or incompatible managed entities/);

      const migTableRes = await reproDb.pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
      `);
      if (migTableRes.rows.length > 0) {
        const historyRows = await reproDb.pool.query(
          'SELECT * FROM _prisma_migrations WHERE migration_name = $1',
          ['20261111000000_init_auth']
        );
        expect(historyRows.rows.length).toBe(0);
      }

      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_c_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_C_PRESERVED');
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('pins public schema and neutralizes ambient PGOPTIONS search_path routing (F05)', async () => {
    const ambientDb = await createDedicatedTestDatabase();
    const origPgOptions = process.env.PGOPTIONS;
    try {
      // 1. Create a staging schema in the dedicated target database
      await ambientDb.pool.query('CREATE SCHEMA staging;');
      await ambientDb.pool.query(`
        CREATE TABLE staging.sentinel_staging (id SERIAL PRIMARY KEY, data TEXT);
        INSERT INTO staging.sentinel_staging (data) VALUES ('STAGING_DATA_INTACT');
      `);

      // 2. Set ambient PGOPTIONS to redirect search_path to staging,public
      process.env.PGOPTIONS = '-c search_path=staging,public';

      // 3. Execute baseline: must neutralize ambient routing, pin public schema, and succeed
      const baselineResult = await runIdentityBaseline({
        targetUrl: ambientDb.url,
        silent: true,
      });
      expect(baselineResult.success).toBe(true);

      // 4. Verify staging schema received ZERO managed tables (no leakage into staging)
      const stagingTablesRes = await ambientDb.pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'staging' AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
      `);
      expect(stagingTablesRes.rows.length).toBe(0);

      // Staging sentinel intact
      const stagingSentinel = await ambientDb.pool.query('SELECT * FROM staging.sentinel_staging;');
      expect(stagingSentinel.rows.length).toBe(1);
      expect(stagingSentinel.rows[0].data).toBe('STAGING_DATA_INTACT');

      // 5. Verify public schema received all 6 managed tables
      const publicTablesRes = await ambientDb.pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
      `);
      expect(publicTablesRes.rows.length).toBe(6);

      // 6. Verify migration status is clean in public schema
      const statusRes = runPrismaCli(['migrate', 'status'], ambientDb.url);
      expect(statusRes.status).toBe(0);
      expect(statusRes.stdout).toContain('Database schema is up to date');
    } finally {
      if (origPgOptions === undefined) {
        delete process.env.PGOPTIONS;
      } else {
        process.env.PGOPTIONS = origPgOptions;
      }
      await ambientDb.drop().catch(() => {});
    }
  }, 90000);
});

