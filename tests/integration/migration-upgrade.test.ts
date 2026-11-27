import { browserSessionToken } from '../helpers/browser-session';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
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

describe('Security trigger drift rejection (R14-01)', () => {
  it('refuses changed recorded migration checksums before accepting completed history', async () => {
    const db = await createDedicatedTestDatabase();
    try {
      await runIdentityBaseline({ targetUrl: db.url, silent: true });
      await db.pool.query("UPDATE _prisma_migrations SET checksum = repeat('0', 64) WHERE migration_name = '20261111000000_init_auth'");
      await expect(runIdentityBaseline({ targetUrl: db.url, silent: true })).rejects.toThrow(/Unsupported migration history/);
      expect((await db.pool.query('SELECT checksum FROM _prisma_migrations WHERE migration_name = $1', ['20261111000000_init_auth'])).rows[0].checksum).toBe('0'.repeat(64));
    } finally {
      await db.drop();
    }
  }, 60000);
  it.each(['unmanaged', 'completed'] as const)('rejects altered security behavior in %s history without certifying it', async (history) => {
    const db = await createDedicatedTestDatabase();
    const initSql = fs.readFileSync('prisma/migrations/20261111000000_init_auth/migration.sql', 'utf8');
    const forwardSql = fs.readFileSync('prisma/migrations/20261114000000_credential_version/migration.sql', 'utf8');
    try {
      await db.pool.query(initSql);
      await db.pool.query(forwardSql);
      if (history === 'completed') await runIdentityBaseline({ targetUrl: db.url, silent: true });
      const alterations = [
        `CREATE OR REPLACE FUNCTION public.trg_account_password_sync_credential_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$ BEGIN RETURN NEW; END; $$`,
        `DROP TRIGGER trg_account_password_sync_credential_version ON public.account; CREATE TRIGGER trg_account_password_sync_credential_version AFTER UPDATE OF password ON public.account FOR EACH ROW WHEN(false) EXECUTE FUNCTION public.trg_account_password_sync_credential_version()`,
        `DROP TRIGGER trg_account_password_sync_credential_version ON public.account; CREATE TRIGGER trg_account_password_sync_credential_version AFTER UPDATE OF scope ON public.account FOR EACH ROW EXECUTE FUNCTION public.trg_account_password_sync_credential_version()`,
        `DROP TRIGGER trg_session_set_credential_version ON public.session; CREATE TRIGGER trg_session_set_credential_version BEFORE INSERT OR UPDATE ON public.session FOR EACH ROW EXECUTE FUNCTION public.trg_session_set_credential_version()`,
        `DROP TRIGGER trg_session_set_credential_version ON public.session; CREATE TRIGGER trg_session_set_credential_version BEFORE INSERT ON public.session FOR EACH ROW EXECUTE FUNCTION public.trg_session_set_credential_version('unexpected')`,
        `ALTER FUNCTION public.trg_session_set_credential_version() SET search_path = public, pg_catalog, decoy`,
      ];
      for (const sql of alterations) {
        await db.pool.query(sql);
        await expect(runIdentityBaseline({ targetUrl: db.url, silent: true }), sql).rejects.toThrow(/verification failed|incompatible/);
        if (history === 'unmanaged') {
          expect((await db.pool.query("SELECT to_regclass('public._prisma_migrations') AS history")).rows[0].history).toBeNull();
        } else {
          const expectedCount = fs
            .readdirSync(path.resolve(process.cwd(), 'prisma/migrations'))
            .filter((n) => fs.existsSync(path.resolve(process.cwd(), 'prisma/migrations', n, 'migration.sql'))).length;
          expect((await db.pool.query('SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].n).toBe(expectedCount);
        }
        await db.pool.query(forwardSql);
      }
    } finally {
      await db.drop();
    }
  }, 90000);
});

describe('Historical identity data upgrade (R14 retained-data evidence)', () => {
  it.each(['unmanaged-baseline', 'managed-baseline', 'managed-deploy'] as const)('retains real credentials/MFA and rejects stale proof through %s', async (mode) => {
    const previousTestUrl = process.env.TEST_DATABASE_URL;
    const db = await createDedicatedTestDatabase();
    const initialSql = fs.readFileSync('prisma/migrations/20261111000000_init_auth/migration.sql');
    // Exact bytes independently verified against f2b53f9's canonical migration.
    const historicalChecksum = '82d4054e5cc3b74064296e86b83c18b5d5a0e414e9c5560653e26862a7aff0bf';
    expect(crypto.createHash('sha256').update(initialSql).digest('hex')).toBe(historicalChecksum);
    const { hashPassword, symmetricEncrypt, symmetricDecrypt } = await import('better-auth/crypto');
    const password = 'HistoricalSyntheticPassword2026!';
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const userId = crypto.randomUUID();
    const email = `historical.${userId}@office.eg`;
    const env = getEnv();
    const passwordHash = await hashPassword(password);
    const encryptedSecret = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: `base32:${secret}` });
    const encryptedRecovery = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: JSON.stringify(['synthetic-backup']) });
    const staleToken = crypto.randomUUID();
    const staleChallenge = `2fa-${crypto.randomUUID()}`;
    try {
      await db.pool.query(initialSql.toString('utf8'));
      await db.pool.query(`CREATE TABLE retained_sentinel (note TEXT NOT NULL); INSERT INTO retained_sentinel VALUES ('preserved');`);
      await db.pool.query(`INSERT INTO public."user" (id,name,email,"emailVerified",role,"twoFactorEnabled","createdAt","updatedAt") VALUES ($1,'Historical synthetic owner',$2,true,'OWNER',true,NOW()-interval '1 hour',NOW())`, [userId,email]);
      await db.pool.query(`INSERT INTO public.account (id,"userId","accountId","providerId",password,"createdAt","updatedAt") VALUES ($1,$2,$2,'credential',$3,NOW()-interval '1 hour',NOW())`, [crypto.randomUUID(),userId,passwordHash]);
      await db.pool.query(`INSERT INTO public."twoFactor" (id,"userId",secret,"backupCodes",verified) VALUES ($1,$2,$3,$4,true)`, [crypto.randomUUID(),userId,encryptedSecret,encryptedRecovery]);
      await db.pool.query(`INSERT INTO public.office_bootstrap (id,"isClosed","closedAt","ownerId") VALUES ('singleton',true,NOW(),$1)`, [userId]);
      await db.pool.query(`INSERT INTO public.session (id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,NOW()+interval '1 hour',NOW()-interval '10 minutes',NOW())`, [crypto.randomUUID(),userId,staleToken]);
      await db.pool.query(`INSERT INTO public.verification (id,identifier,value,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,NOW()+interval '10 minutes',NOW()-interval '10 minutes',NOW())`, [crypto.randomUUID(),staleChallenge,userId]);
      let initialHistory: unknown;
      if (mode !== 'unmanaged-baseline') {
        const resolved = runPrismaCli(['migrate','resolve','--applied','20261111000000_init_auth'], db.url);
        expect(resolved.status, resolved.stderr).toBe(0);
        initialHistory = (await db.pool.query('SELECT * FROM _prisma_migrations WHERE migration_name = $1', ['20261111000000_init_auth'])).rows[0];
        expect((initialHistory as { checksum: string }).checksum).toBe(historicalChecksum);
      }
      if (mode === 'managed-deploy') {
        const deployed = runPrismaCli(['migrate','deploy'], db.url);
        expect(deployed.status, deployed.stderr).toBe(0);

        const t12Mig = await db.pool.query(
          `SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name IN ($1, $2) ORDER BY migration_name`,
          ['20261126000000_t12_document_versions_and_links', '20261126010000_t12_fk_index_hygiene']
        );
        expect(t12Mig.rows).toHaveLength(2);
        expect(t12Mig.rows[0].migration_name).toBe('20261126000000_t12_document_versions_and_links');
        expect(t12Mig.rows[0].finished_at).not.toBeNull();
        expect(t12Mig.rows[1].migration_name).toBe('20261126010000_t12_fk_index_hygiene');
        expect(t12Mig.rows[1].finished_at).not.toBeNull();

        const t12Cols = await db.pool.query(`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'power_of_attorney' AND column_name = 'document_id')
              OR (table_name = 'hearing_result' AND column_name = 'decision_document_id')
              OR (table_name = 'upload_attempt' AND column_name = 'expected_document_version')
            )
          ORDER BY table_name, column_name;
        `);
        expect(t12Cols.rows).toEqual([
          { table_name: 'hearing_result', column_name: 'decision_document_id' },
          { table_name: 'power_of_attorney', column_name: 'document_id' },
          { table_name: 'upload_attempt', column_name: 'expected_document_version' },
        ]);

        const t12Constraints = await db.pool.query(`
          SELECT conname, contype::text AS contype
          FROM pg_constraint
          WHERE conname IN (
            'upload_attempt_expected_document_version_check',
            'power_of_attorney_document_id_fkey',
            'hearing_result_decision_document_id_fkey',
            'deadline_source_document_id_fkey'
          )
          ORDER BY conname;
        `);
        expect(t12Constraints.rows).toEqual([
          { conname: 'deadline_source_document_id_fkey', contype: 'f' },
          { conname: 'hearing_result_decision_document_id_fkey', contype: 'f' },
          { conname: 'power_of_attorney_document_id_fkey', contype: 'f' },
          { conname: 'upload_attempt_expected_document_version_check', contype: 'c' },
        ]);

        const t12Indexes = await db.pool.query(`
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'power_of_attorney_document_id_idx',
              'hearing_result_decision_document_id_idx',
              'deadline_source_document_id_idx',
              'backup_file_pin_document_version_id_released_at_idx',
              'upload_attempt_document_id_idx',
              'backup_file_pin_document_version_id_idx'
            )
          ORDER BY indexname;
        `);
        expect(t12Indexes.rows.map((r: { indexname: string }) => r.indexname)).toEqual([
          'backup_file_pin_document_version_id_released_at_idx',
          'deadline_source_document_id_idx',
          'hearing_result_decision_document_id_idx',
          'power_of_attorney_document_id_idx',
          'upload_attempt_document_id_idx',
        ]);
      }
      expect((await runIdentityBaseline({ targetUrl: db.url, silent: true })).success).toBe(true);
      expect(runPrismaCli(['migrate','deploy'], db.url).status).toBe(0);
      if (initialHistory) {
        expect((await db.pool.query('SELECT * FROM _prisma_migrations WHERE migration_name = $1', ['20261111000000_init_auth'])).rows[0]).toEqual(initialHistory);
      }
      expect((await db.pool.query('SELECT note FROM retained_sentinel')).rows).toEqual([{ note: 'preserved' }]);
      expect((await db.pool.query('SELECT password FROM public.account WHERE "userId"=$1',[userId])).rows[0].password).toBe(passwordHash);
      const mfa = (await db.pool.query('SELECT secret,"backupCodes",verified FROM public."twoFactor" WHERE "userId"=$1',[userId])).rows[0];
      expect(mfa).toEqual({ secret: encryptedSecret, backupCodes: encryptedRecovery, verified: true });
      expect(await symmetricDecrypt({ key:env.BETTER_AUTH_SECRET, data:mfa.secret })).toBe(`base32:${secret}`);
      expect((await db.pool.query('SELECT "ownerId","isClosed" FROM public.office_bootstrap')).rows[0]).toEqual({ ownerId:userId, isClosed:true });
      expect((await db.pool.query('SELECT count(*)::int n FROM public.session')).rows[0].n).toBe(1);
      await clearGlobalSingletons();
      process.env.TEST_DATABASE_URL = db.url;
      getEnv(true);
      await expect(requireActor({headers:makeSessionHeaders(staleToken)})).rejects.toThrow();
      const origin = new URL(env.BETTER_AUTH_URL).origin;
      const post = (endpoint: string, body: unknown, cookie?: string) => authRoutePOST(new NextRequest(`${origin}/api/auth/${endpoint}`, {
        method:'POST', headers:{'content-type':'application/json', origin, ...(cookie ? {cookie} : {})}, body:JSON.stringify(body),
      }));
      const staleCookie = `better-auth.two_factor=${signSessionTokenCookie(staleChallenge,env.BETTER_AUTH_SECRET)}`;
      expect((await post('two-factor/verify-totp',{code:await generateTotpCode(secret)},staleCookie)).status).toBe(401);
      const signIn = await post('sign-in/email',{email,password});
      expect(signIn.status).toBe(200);
      const challenge = signIn.headers.getSetCookie().find((c) => c.startsWith('better-auth.two_factor='));
      expect(challenge).toBeDefined();
      const completed = await post('two-factor/verify-totp',{code:await generateTotpCode(secret)},challenge!.split(';')[0]);
      expect(completed.status).toBe(200);
      const session = completed.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='));
      expect(session).toBeDefined();
      expect((await requireActor({headers:new Headers({cookie:session!.split(';')[0]})})).id).toBe(userId);
    } finally {
      await clearGlobalSingletons();
      process.env.TEST_DATABASE_URL = previousTestUrl;
      getEnv(true);
      await db.drop();
    }
  }, 90000);
});

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
    const authBase = getEnv().BETTER_AUTH_URL;
    const signInReq = new NextRequest(`${authBase}/api/auth/sign-in/email`, {
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
    const verifyTotpReq = new NextRequest(`${authBase}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: tfCookie!.split(';')[0],
      },
      body: JSON.stringify({ code: freshCode }),
    });
    const verifyTotpRes = await authRoutePOST(verifyTotpReq);
    expect(verifyTotpRes.status).toBe(200);
    const sessionToken = await browserSessionToken(verifyTotpRes);

    // 5. Verify authoritative actor resolution via requireActor
    const actor = await requireActor({ headers: makeSessionHeaders(sessionToken) });
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
  }, 120000);

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

  it('rejects baseline when user_email_key is a partial index with predicate (R10 reproduction 1 / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const migrationSqlPath = path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');
      const fs = await import('fs');
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

      await reproDb.pool.query(migrationSql);

      await reproDb.pool.query(`
        CREATE TABLE repro_r10_1_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_r10_1_sentinel (note) VALUES ('SENTINEL_R10_1_PRESERVED');
      `);

      // Replace user_email_key with a partial index having WHERE false
      await reproDb.pool.query('DROP INDEX "user_email_key";');
      await reproDb.pool.query('CREATE UNIQUE INDEX "user_email_key" ON "user"("email") WHERE false;');

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

      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_r10_1_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_R10_1_PRESERVED');
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('rejects baseline when user_email_key is a composite index on (email, name) (R10 reproduction 2 / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const migrationSqlPath = path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');
      const fs = await import('fs');
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

      await reproDb.pool.query(migrationSql);

      await reproDb.pool.query(`
        CREATE TABLE repro_r10_2_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_r10_2_sentinel (note) VALUES ('SENTINEL_R10_2_PRESERVED');
      `);

      // Replace user_email_key with a composite index on (email, name)
      await reproDb.pool.query('DROP INDEX "user_email_key";');
      await reproDb.pool.query('CREATE UNIQUE INDEX "user_email_key" ON "user"("email", "name");');

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

      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_r10_2_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_R10_2_PRESERVED');
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('rejects baseline when user.createdAt has precision 0 and interval arithmetic default (R10 reproduction 3 / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const migrationSqlPath = path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');
      const fs = await import('fs');
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

      await reproDb.pool.query(migrationSql);

      await reproDb.pool.query(`
        CREATE TABLE repro_r10_3_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_r10_3_sentinel (note) VALUES ('SENTINEL_R10_3_PRESERVED');
      `);

      // Alter user.createdAt to TIMESTAMP(0) with default CURRENT_TIMESTAMP + interval '1 day'
      await reproDb.pool.query('ALTER TABLE "user" ALTER COLUMN "createdAt" TYPE TIMESTAMP(0);');
      await reproDb.pool.query(`ALTER TABLE "user" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP + interval '1 day');`);

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

      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_r10_3_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_R10_3_PRESERVED');
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('rejects baseline when user.image uses an unapproved domain type codex_image (R11 domain reproduction / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const migrationSqlPath = path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');
      const fs = await import('fs');
      const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

      await reproDb.pool.query(migrationSql);

      await reproDb.pool.query(`
        CREATE TABLE repro_r11_domain_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_r11_domain_sentinel (note) VALUES ('SENTINEL_R11_DOMAIN_PRESERVED');
      `);

      // Create unapproved domain and alter user.image to use it
      await reproDb.pool.query(`CREATE DOMAIN public.codex_image AS text CHECK (VALUE <> '');`);
      await reproDb.pool.query(`ALTER TABLE "user" ALTER COLUMN "image" TYPE public.codex_image;`);

      await expect(
        runIdentityBaseline({ targetUrl: reproDb.url, silent: true })
      ).rejects.toThrow(/uses an unapproved domain type 'codex_image'|conflicting or incompatible managed entities/);

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

      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_r11_domain_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_R11_DOMAIN_PRESERVED');
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

  it('executes non-destructive upgrade from prior canonical 47-column schema and preserves pre-existing records and sentinel data (R12 / R12-03)', async () => {
    const upgradeDb = await createDedicatedTestDatabase();
    try {
      const fs = await import('fs');
      const initMigrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261111000000_init_auth/migration.sql'
      );
      const initSql = fs.readFileSync(initMigrationSqlPath, 'utf-8');

      // 1. Apply only the prior 47-column canonical baseline
      await upgradeDb.pool.query(initSql);

      // Verify user and session do NOT yet have credentialVersion
      const userColCheckBefore = await upgradeDb.pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'credentialVersion';
      `);
      expect(userColCheckBefore.rows.length).toBe(0);

      // 2. Insert sentinel table and pre-existing user, account, and session data
      await upgradeDb.pool.query(`
        CREATE TABLE upgrade_r12_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO upgrade_r12_sentinel (note) VALUES ('SENTINEL_R12_UPGRADE_PRESERVED');
      `);

      await upgradeDb.pool.query(`
        INSERT INTO "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        VALUES ('usr-preexisting-1', 'Preexisting Lawyer', 'preexisting@office.eg', true, 'OWNER', NOW(), NOW());

        INSERT INTO "account" ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
        VALUES ('acc-preexisting-1', 'usr-preexisting-1', 'preexisting@office.eg', 'credential', '$2a$10$preexistinghash', NOW(), NOW());

        INSERT INTO "session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt")
        VALUES ('ses-preexisting-1', 'usr-preexisting-1', 'preexisting-session-token', NOW() + interval '7 days', NOW(), NOW());
      `);

      // 3. Execute baseline entry point: must detect 47-column schema, run 20261114000000 forward migration in-transaction, verify, and resolve both migrations
      const baselineResult = await runIdentityBaseline({
        targetUrl: upgradeDb.url,
        silent: true,
      });
      expect(baselineResult.success).toBe(true);
      expect(baselineResult.recovered).toBe(true);

      // 4. Verify columns and defaults in information_schema
      const userColCheckAfter = await upgradeDb.pool.query(`
        SELECT column_name, column_default, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'credentialVersion';
      `);
      expect(userColCheckAfter.rows.length).toBe(1);
      expect(userColCheckAfter.rows[0].data_type).toBe('integer');
      expect(userColCheckAfter.rows[0].column_default).toBe('1');

      const sessionColCheckAfter = await upgradeDb.pool.query(`
        SELECT column_name, column_default, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'session' AND column_name = 'credentialVersion';
      `);
      expect(sessionColCheckAfter.rows.length).toBe(1);
      expect(sessionColCheckAfter.rows[0].data_type).toBe('integer');
      expect(sessionColCheckAfter.rows[0].column_default).toBe('1');

      // 5. Verify pre-existing data is intact and populated with credentialVersion = 1
      const userRow = await upgradeDb.pool.query('SELECT * FROM "user" WHERE id = $1', ['usr-preexisting-1']);
      expect(userRow.rows.length).toBe(1);
      expect(userRow.rows[0].credentialVersion).toBe(1);

      const sessionRow = await upgradeDb.pool.query('SELECT * FROM "session" WHERE id = $1', ['ses-preexisting-1']);
      expect(sessionRow.rows.length).toBe(1);
      expect(sessionRow.rows[0].credentialVersion).toBe(1);

      const sentinelCheck = await upgradeDb.pool.query('SELECT * FROM upgrade_r12_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_R12_UPGRADE_PRESERVED');

      // 6. Verify migration history contains both migrations with status clean
      const migHistory = await upgradeDb.pool.query(`
        SELECT migration_name, finished_at, applied_steps_count 
        FROM _prisma_migrations 
        ORDER BY migration_name ASC;
      `);
      const migNames = migHistory.rows.map((r: { migration_name: string }) => r.migration_name);
      expect(migNames).toContain('20261111000000_init_auth');
      expect(migNames).toContain('20261114000000_credential_version');
      for (const row of migHistory.rows) {
        expect(row.finished_at).not.toBeNull();
        expect(row.applied_steps_count).toBeGreaterThanOrEqual(0);
      }

      const deployRes = runPrismaCli(['migrate', 'deploy'], upgradeDb.url);
      expect(deployRes.status).toBe(0);
      expect(deployRes.stdout).toContain('No pending migrations to apply');

      // 7. Verify atomic trigger trg_account_password_sync_credential_version:
      // Insert companion verification record
      await upgradeDb.pool.query(`
        INSERT INTO "verification" ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")
        VALUES ('ver-companion-1', '2fa-cred-ver-usr-preexisting-1', 'dummy-token', NOW() + interval '1 day', NOW(), NOW());
      `);

      // Update account password
      await upgradeDb.pool.query(`
        UPDATE "account" SET "password" = '$2a$10$newhashedpassword' WHERE "id" = 'acc-preexisting-1';
      `);

      // Assert user credentialVersion was incremented to 2
      const userAfterUpdate = await upgradeDb.pool.query('SELECT * FROM "user" WHERE id = $1', ['usr-preexisting-1']);
      expect(userAfterUpdate.rows[0].credentialVersion).toBe(2);

      // Assert old session with credentialVersion 1 was evicted
      const sessionAfterUpdate = await upgradeDb.pool.query('SELECT * FROM "session" WHERE id = $1', ['ses-preexisting-1']);
      expect(sessionAfterUpdate.rows.length).toBe(0);

      // Assert companion verification was purged
      const verAfterUpdate = await upgradeDb.pool.query('SELECT * FROM "verification" WHERE identifier = $1', ['2fa-cred-ver-usr-preexisting-1']);
      expect(verAfterUpdate.rows.length).toBe(0);

      // 8. Verify trigger trg_session_set_credential_version:
      // Insert new session without explicit credentialVersion: trigger sets it to current user.credentialVersion (2)
      await upgradeDb.pool.query(`
        INSERT INTO "session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt")
        VALUES ('ses-new-1', 'usr-preexisting-1', 'new-token-after-pw-change', NOW() + interval '7 days', NOW(), NOW());
      `);
      const newSession = await upgradeDb.pool.query('SELECT * FROM "session" WHERE id = $1', ['ses-new-1']);
      expect(newSession.rows.length).toBe(1);
      expect(newSession.rows[0].credentialVersion).toBe(2);
    } finally {
      await upgradeDb.drop().catch(() => {});
    }
  }, 90000);

  it('rejects baseline when index uses unapproved ICU casefold collation public.review_casefold (R12 / F01)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const fs = await import('fs');
      const initMigrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261111000000_init_auth/migration.sql'
      );
      const forwardMigrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261114000000_credential_version/migration.sql'
      );
      const initSql = fs.readFileSync(initMigrationSqlPath, 'utf-8');
      const forwardSql = fs.readFileSync(forwardMigrationSqlPath, 'utf-8');

      await reproDb.pool.query(initSql);
      await reproDb.pool.query(forwardSql);

      await reproDb.pool.query(`
        CREATE TABLE repro_r12_icu_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_r12_icu_sentinel (note) VALUES ('SENTINEL_R12_ICU_PRESERVED');
      `);

      // Create custom collation public.review_casefold (try ICU first, fallback to standard C if ICU not available)
      try {
        await reproDb.pool.query(`CREATE COLLATION public.review_casefold (provider = icu, locale = 'und-u-ks-level2', deterministic = false);`);
      } catch {
        await reproDb.pool.query(`CREATE COLLATION public.review_casefold (locale = 'C');`);
      }

      // Recreate user_email_key with the unapproved collation
      await reproDb.pool.query('DROP INDEX "user_email_key";');
      await reproDb.pool.query('CREATE UNIQUE INDEX "user_email_key" ON "user"("email" COLLATE public.review_casefold);');

      // Attempt to baseline: must fail fast and report unapproved collation
      await expect(
        runIdentityBaseline({ targetUrl: reproDb.url, silent: true })
      ).rejects.toThrow(/unapproved collation 'public.review_casefold'|conflicting or incompatible managed entities/);

      // Verify migration history was NOT recorded
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

      // Verify sentinel data was NOT damaged
      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_r12_icu_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_R12_ICU_PRESERVED');
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('installs missing triggers on 49-column schema during forward upgrade and fails closed if triggers are disabled (R13-02)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const fs = await import('fs');
      const initMigrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261111000000_init_auth/migration.sql'
      );
      const forwardMigrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261114000000_credential_version/migration.sql'
      );
      const initSql = fs.readFileSync(initMigrationSqlPath, 'utf-8');
      const forwardSql = fs.readFileSync(forwardMigrationSqlPath, 'utf-8');

      // 1. Install tables and columns
      await reproDb.pool.query(initSql);
      await reproDb.pool.query(forwardSql);

      // 2. Remove triggers and trigger functions to simulate 49-column schema missing security triggers (R11 artifact / incomplete migration)
      await reproDb.pool.query(`
        DROP TRIGGER IF EXISTS trg_session_set_credential_version ON public."session";
        DROP TRIGGER IF EXISTS trg_account_password_sync_credential_version ON public."account";
        DROP FUNCTION IF EXISTS public.trg_session_set_credential_version();
        DROP FUNCTION IF EXISTS public.trg_account_password_sync_credential_version();
      `);

      // 3. Add sentinel data
      await reproDb.pool.query(`
        CREATE TABLE repro_r13_trigger_sentinel (id SERIAL PRIMARY KEY, note TEXT);
        INSERT INTO repro_r13_trigger_sentinel (note) VALUES ('SENTINEL_R13_TRIGGERS_PRESERVED');
      `);

      // 4. Run baseline: must detect missing triggers, execute forward migration in transaction, verify, and resolve
      const baselineResult = await runIdentityBaseline({ targetUrl: reproDb.url, silent: true });
      expect(baselineResult.success).toBe(true);

      // Verify triggers now exist in pg_trigger with enabled 'O' and function with safe search_path
      const trgCheck = await reproDb.pool.query(`
        SELECT t.tgname, t.tgenabled::text AS enabled, p.prosecdef, p.proconfig
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname IN ('session', 'account')
          AND t.tgname IN ('trg_session_set_credential_version', 'trg_account_password_sync_credential_version');
      `);
      expect(trgCheck.rows.length).toBe(2);
      for (const row of trgCheck.rows) {
        expect(row.enabled).toBe('O');
        expect(row.prosecdef).toBe(true);
        expect(row.proconfig).toContain('search_path=public, pg_catalog');
      }

      // 5. Verify sentinel intact
      const sentinelCheck = await reproDb.pool.query('SELECT * FROM repro_r13_trigger_sentinel');
      expect(sentinelCheck.rows.length).toBe(1);
      expect(sentinelCheck.rows[0].note).toBe('SENTINEL_R13_TRIGGERS_PRESERVED');

      // 6. Now simulate disabled trigger on an already-recorded baseline: MUST fail closed
      await reproDb.pool.query('ALTER TABLE public."session" DISABLE TRIGGER trg_session_set_credential_version;');
      await expect(
        runIdentityBaseline({ targetUrl: reproDb.url, silent: true })
      ).rejects.toThrow(/Trigger 'trg_session_set_credential_version' is not enabled/);
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);

  it('executes triggers immune to ambient search_path and resolves only public schema (R13-03)', async () => {
    const reproDb = await createDedicatedTestDatabase();
    try {
      const fs = await import('fs');
      const initMigrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261111000000_init_auth/migration.sql'
      );
      const forwardMigrationSqlPath = path.resolve(
        process.cwd(),
        'prisma/migrations/20261114000000_credential_version/migration.sql'
      );
      const initSql = fs.readFileSync(initMigrationSqlPath, 'utf-8');
      const forwardSql = fs.readFileSync(forwardMigrationSqlPath, 'utf-8');

      await reproDb.pool.query(initSql);
      await reproDb.pool.query(forwardSql);

      // 1. Setup decoy schema and decoy user table with credentialVersion 999
      await reproDb.pool.query(`
        CREATE SCHEMA review_decoy;
        CREATE TABLE review_decoy."user" (id TEXT PRIMARY KEY, "credentialVersion" INTEGER NOT NULL);
        INSERT INTO review_decoy."user" (id, "credentialVersion") VALUES ('usr-decoy-test', 999);

        INSERT INTO public."user" (id, name, email, "emailVerified", "role", "credentialVersion", "createdAt", "updatedAt")
        VALUES ('usr-decoy-test', 'Real Public User', 'decoy.test@office.eg', true, 'OWNER', 42, NOW(), NOW());
      `);

      // 2. Open fresh pg.Client connection with ambient search_path routing to review_decoy,public
      const { Client } = await import('pg');
      const decoyClient = new Client({
        connectionString: reproDb.url,
        options: '-c search_path=review_decoy,public',
      });
      await decoyClient.connect();

      try {
        // Assert ambient search_path is indeed review_decoy,public
        const spRes = await decoyClient.query('SHOW search_path;');
        expect(spRes.rows[0].search_path).toContain('review_decoy');

        // Unqualified "user" query on this connection hits review_decoy."user" (version 999)
        const decoyCheck = await decoyClient.query('SELECT "credentialVersion" FROM "user" WHERE id = $1;', ['usr-decoy-test']);
        expect(decoyCheck.rows[0].credentialVersion).toBe(999);

        // Insert new session on public."session" without explicit credentialVersion
        await decoyClient.query(`
          INSERT INTO public."session" (id, "userId", token, "expiresAt", "createdAt", "updatedAt")
          VALUES ('ses-decoy-test-1', 'usr-decoy-test', 'tok-decoy-1', NOW() + interval '1 day', NOW(), NOW());
        `);

        // 3. Verify that the session stamped version 42 from public."user", NOT 999 from decoy!
        const sesCheck = await reproDb.pool.query('SELECT "credentialVersion" FROM public."session" WHERE id = $1;', ['ses-decoy-test-1']);
        expect(sesCheck.rows[0].credentialVersion).toBe(42);
      } finally {
        await decoyClient.end();
      }
    } finally {
      await reproDb.drop().catch(() => {});
    }
  }, 60000);
});

describe('T13 Migration & Upgrade Verification (from prior T12 schema)', () => {
  it('upgrades cleanly from prior T12 schema, preserves synthetic records, and enforces T13 constraints & triggers', async () => {
    const db = await createDedicatedTestDatabase();
    try {
      const migrationsRoot = path.resolve(process.cwd(), 'prisma/migrations');
      const priorMigrations = fs
        .readdirSync(migrationsRoot)
        .filter((name) => {
          const sqlPath = path.join(migrationsRoot, name, 'migration.sql');
          return fs.existsSync(sqlPath) && name < '20261127000000_t13_balanced_ledger_fees_receipts';
        })
        .sort();

      expect(priorMigrations.length).toBeGreaterThanOrEqual(20);
      expect(priorMigrations[priorMigrations.length - 1]).toBe('20261126010000_t12_fk_index_hygiene');

      for (const name of priorMigrations) {
        const sql = fs.readFileSync(path.join(migrationsRoot, name, 'migration.sql'), 'utf-8');
        await db.pool.query(sql);
        const resolved = runPrismaCli(['migrate', 'resolve', '--applied', name], db.url);
        expect(resolved.status, `${name}: ${resolved.stderr}`).toBe(0);
      }

      // Insert synthetic T12 records before T13 migration
      const userId = crypto.randomUUID();
      const partyId = crypto.randomUUID();
      const matterId = crypto.randomUUID();
      const mpId = crypto.randomUUID();

      await db.pool.query(
        `INSERT INTO public."user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
         VALUES ($1, 'محامي الترقية T13', $2, true, 'OWNER', NOW(), NOW())`,
        [userId, `t13.upgrade.${userId.slice(0, 8)}@office.eg`]
      );
      await db.pool.query(
        `INSERT INTO public."party" (id, kind, name, "nameNormalized", "createdAt", "updatedAt", "createdById", "updatedById")
         VALUES ($1, 'PERSON', 'موكل الترقية التلقائية', 'موكل الترقيه التلقائيه', NOW(), NOW(), $2, $2)`,
        [partyId, userId]
      );
      await db.pool.query(
        `INSERT INTO public."matter" (id, "fileCode", title, "titleNormalized", kind, status, "createdAt", "updatedAt", "createdById", "updatedById")
         VALUES ($1, '2026/9901', 'ملف ما قبل الترقية T13', 'ملف ما قبل الترقيه t13', 'LITIGATION', 'ACTIVE', NOW(), NOW(), $2, $2)`,
        [matterId, userId]
      );
      await db.pool.query(
        `INSERT INTO public."matter_party" (id, "matterId", "partyId", role, "isPrimaryContact", "billingEnabled", "createdAt", "updatedAt", "createdById", "updatedById")
         VALUES ($1, $2, $3, 'CLIENT', true, true, NOW(), NOW(), $4, $4)`,
        [mpId, matterId, partyId, userId]
      );

      // Run prisma migrate deploy to apply T13 migration
      const deployRes = runPrismaCli(['migrate', 'deploy'], db.url);
      expect(deployRes.status, deployRes.stderr).toBe(0);

      // Verify T13 migration recorded
      const migRow = await db.pool.query(
        `SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = $1`,
        ['20261127000000_t13_balanced_ledger_fees_receipts']
      );
      expect(migRow.rows).toHaveLength(1);
      expect(migRow.rows[0].finished_at).not.toBeNull();

      // Verify pre-existing synthetic T12 records preserved
      const preservedMp = await db.pool.query(
        `SELECT id, "matterId", "partyId", role::text FROM public."matter_party" WHERE id = $1`,
        [mpId]
      );
      expect(preservedMp.rows).toEqual([
        { id: mpId, matterId, partyId, role: 'CLIENT' },
      ]);

      // Verify T13 tables exist
      const tables = await db.pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'money_account', 'money_transaction', 'money_line',
            'fee_agreement', 'fee_charge', 'money_allocation',
            'receipt_sequence', 'receipt'
          )
        ORDER BY table_name;
      `);
      expect(tables.rows).toHaveLength(8);

      // Verify partial unique indexes on money_account
      const partialIdx = await db.pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'money_account_cash_clearing_key',
            'money_account_matter_client_key',
            'money_account_opening_bridge_key'
          )
        ORDER BY indexname;
      `);
      expect(partialIdx.rows.map((r: { indexname: string }) => r.indexname)).toEqual([
        'money_account_cash_clearing_key',
        'money_account_matter_client_key',
        'money_account_opening_bridge_key',
      ]);

      // Verify immutability & balanced constraint triggers are enabled
      const triggers = await db.pool.query(`
        SELECT tgname, tgenabled::text AS enabled
        FROM pg_trigger
        WHERE tgname IN (
          'trg_money_transaction_immutable',
          'trg_money_line_immutable',
          'trg_money_allocation_immutable',
          'trg_fee_charge_immutable',
          'trg_receipt_immutable',
          'trg_fee_agreement_approved_immutable',
          'trg_money_transaction_balanced',
          'trg_money_line_balanced'
        )
        ORDER BY tgname;
      `);
      expect(triggers.rows).toHaveLength(8);
      for (const row of triggers.rows) {
        expect(row.enabled).toBe('O');
      }

      // Verify CHECK and unique index enforcement
      await expect(
        db.pool.query(
          `INSERT INTO public."money_account" (id, type, currency) VALUES ($1, 'CASH_CLEARING', 'EGP')`,
          [crypto.randomUUID()]
        )
      ).rejects.toThrow(/money_account_dimensions_check/i);

      await expect(
        db.pool.query(
          `INSERT INTO public."money_account" (id, type, currency) VALUES ($1, 'OPENING_BRIDGE', 'USD')`,
          [crypto.randomUUID()]
        )
      ).rejects.toThrow(/money_account_currency_check/i);
    } finally {
      await db.drop().catch(() => {});
    }
  }, 90000);
});
