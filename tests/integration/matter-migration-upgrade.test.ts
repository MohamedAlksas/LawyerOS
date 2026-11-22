import { describe, it, expect, beforeAll } from 'vitest';
import { Client, Pool } from 'pg';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { NextRequest } from 'next/server';
import { createDedicatedTestDatabase } from '../helpers/test-db';
import { setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { encryptPartyIdentity, decryptPartyIdentity } from '@/lib/crypto/party-identity';
import { provisionOwner, confirmOwnerProvisioning, requireActor, authorize } from '@/modules/identity';
import { POST as authRoutePOST } from '@/app/api/auth/[...all]/route';
import { getEnv } from '@/lib/env';
import { closeDbPool } from '@/lib/db';
import { normalizeArabicText } from '@/lib/normalization';

async function clearGlobalSingletons(): Promise<void> {
  await globalThis.__lawoffice_prisma?.$disconnect();
  await closeDbPool().catch(() => {});
  const g = globalThis as Record<string, unknown>;
  delete g.__lawoffice_pg_pool;
  delete g.__lawoffice_prisma;
  delete g.__lawoffice_auth;
}

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

function runPrismaMigrateDeploy(dbUrl: string, timezone?: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      NODE_ENV: 'test',
      ...(timezone ? { TZ: timezone } : {}),
    },
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(
      `Prisma migrate deploy failed with status ${res.status}:\nSTDOUT: ${res.stdout}\nSTDERR: ${res.stderr}`
    );
  }
  return res;
}

function runPrismaMigrateDeployCustom(schemaPath: string, dbUrl: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy', `--schema=${schemaPath}`], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      NODE_ENV: 'test',
    },
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(
      `Custom Prisma migrate deploy failed with status ${res.status}:\nSTDOUT: ${res.stdout}\nSTDERR: ${res.stderr}`
    );
  }
  return res;
}

function runPrismaMigrateStatus(dbUrl: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(process.execPath, [prismaJs, 'migrate', 'status'], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      NODE_ENV: 'test',
    },
    encoding: 'utf-8',
  });
  return res;
}

function stageT05BaselineDirectory(targetDir: string) {
  const migrationsDir = path.join(targetDir, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });

  const schemaContent = `
datasource db {
  provider = "postgresql"
}
`;
  fs.writeFileSync(path.join(targetDir, 'schema.prisma'), schemaContent, 'utf8');

  // Copy exactly the 6 accepted T05 predecessor migrations
  const t05MigrationDirs = [
    '20261111000000_init_auth',
    '20261114000000_credential_version',
    '20261117000000_parties_communication_poa',
    '20261117010000_party_temporal_types',
    '20261118020000_party_temporal_utc_semantics',
    '20261118150000_party_idempotency_privacy_cleanup',
  ];

  for (const dirName of t05MigrationDirs) {
    const srcDir = path.resolve(process.cwd(), `prisma/migrations/${dirName}`);
    const dstDir = path.join(migrationsDir, dirName);
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, 'migration.sql'), path.join(dstDir, 'migration.sql'));
  }
}

function stageMigration8BaselineDirectory(targetDir: string) {
  const migrationsDir = path.join(targetDir, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });

  const schemaContent = `
datasource db {
  provider = "postgresql"
}
`;
  fs.writeFileSync(path.join(targetDir, 'schema.prisma'), schemaContent, 'utf8');

  // Copy exactly migrations 1 through 8 (predecessors to migration 9)
  const migrationDirs = [
    '20261111000000_init_auth',
    '20261114000000_credential_version',
    '20261117000000_parties_communication_poa',
    '20261117010000_party_temporal_types',
    '20261118020000_party_temporal_utc_semantics',
    '20261118150000_party_idempotency_privacy_cleanup',
    '20261118160000_matters_proceedings_references',
    '20261118210000_t06_status_capacity_corrections',
  ];

  for (const dirName of migrationDirs) {
    const srcDir = path.resolve(process.cwd(), `prisma/migrations/${dirName}`);
    const dstDir = path.join(migrationsDir, dirName);
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, 'migration.sql'), path.join(dstDir, 'migration.sql'));
  }
}

function stageT06BaselineDirectory(targetDir: string) {
  const migrationsDir = path.join(targetDir, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });

  const schemaContent = `
datasource db {
  provider = "postgresql"
}
`;
  fs.writeFileSync(path.join(targetDir, 'schema.prisma'), schemaContent, 'utf8');

  // Copy all 10 predecessor migrations leading up to T07 migration
  const migrationDirs = [
    '20261111000000_init_auth',
    '20261114000000_credential_version',
    '20261117000000_parties_communication_poa',
    '20261117010000_party_temporal_types',
    '20261118020000_party_temporal_utc_semantics',
    '20261118150000_party_idempotency_privacy_cleanup',
    '20261118160000_matters_proceedings_references',
    '20261118210000_t06_status_capacity_corrections',
    '20261119000000_t06_matter_title_normalized',
    '20261121000000_redact_legacy_identity_metadata',
  ];

  for (const dirName of migrationDirs) {
    const srcDir = path.resolve(process.cwd(), `prisma/migrations/${dirName}`);
    const dstDir = path.join(migrationsDir, dirName);
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, 'migration.sql'), path.join(dstDir, 'migration.sql'));
  }
}

describe('T06-15: Schema Migrations & Upgrade Safety (Integration)', () => {
  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  it('applies all migrations cleanly to a fresh database via migrate deploy and verifies status', async () => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      const deployRes = runPrismaMigrateDeploy(dedicated.url);
      expect(deployRes.status).toBe(0);

      // Verify migrate status reports clean up-to-date state
      const statusRes = runPrismaMigrateStatus(dedicated.url);
      expect(statusRes.status).toBe(0);
      expect(statusRes.stdout).toContain('Database schema is up to date');

      const client = await dedicated.pool.connect();
      try {
        const tablesRes = await client.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
        `);
        const tableNames = tablesRes.rows.map((r) => r.table_name);

        // Core auth tables from T03
        expect(tableNames).toContain('user');
        expect(tableNames).toContain('session');
        expect(tableNames).toContain('account');

        // T05 Party tables
        expect(tableNames).toContain('party');
        expect(tableNames).toContain('party_identity');
        expect(tableNames).toContain('communication_note');
        expect(tableNames).toContain('power_of_attorney');
        expect(tableNames).toContain('audit_event');
        expect(tableNames).toContain('idempotency_record');

        // New T06 Matter & Proceeding & Reference models
        expect(tableNames).toContain('matter');
        expect(tableNames).toContain('matter_party');
        expect(tableNames).toContain('proceeding');
        expect(tableNames).toContain('proceeding_party');
        expect(tableNames).toContain('matter_authorization');
        expect(tableNames).toContain('office_settings');
        expect(tableNames).toContain('court');
        expect(tableNames).toContain('practice_area');
        expect(tableNames).toContain('storage_location');
        expect(tableNames).toContain('file_code_sequence');

        // Verify foreign key constraints
        const fkRes = await client.query(`
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE constraint_type = 'FOREIGN KEY'
        `);
        const fkNames = fkRes.rows.map((r) => r.constraint_name);
        expect(fkNames).toContain('matter_party_matterId_fkey');
        expect(fkNames).toContain('matter_party_partyId_fkey');
        expect(fkNames).toContain('proceeding_matterId_fkey');
        expect(fkNames).toContain('proceeding_courtId_fkey');
        expect(fkNames).toContain('proceeding_parentProceedingId_fkey');
        expect(fkNames).toContain('proceeding_party_proceedingId_fkey');
        expect(fkNames).toContain('proceeding_party_matterPartyId_fkey');
        expect(fkNames).toContain('matter_authorization_matterId_fkey');
        expect(fkNames).toContain('matter_authorization_powerOfAttorneyId_fkey');

        // Verify unique constraints and indexes
        const indexRes = await client.query(`
          SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        `);
        const indexNames = indexRes.rows.map((r) => r.indexname);
        expect(indexNames).toContain('matter_fileCode_key');
        expect(indexNames).toContain('court_isActive_name_idx');
        expect(indexNames).toContain('storage_location_isActive_name_idx');

        // Verify native temporal types (STD-04)
        const columnsRes = await client.query(`
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'matter' AND column_name IN ('openingDate', 'closingDate', 'createdAt', 'updatedAt'))
              OR
              (table_name = 'proceeding' AND column_name IN ('filingDate', 'createdAt', 'updatedAt'))
              OR
              (table_name = 'matter_party' AND column_name IN ('createdAt', 'updatedAt'))
              OR
              (table_name = 'proceeding_party' AND column_name = 'createdAt')
              OR
              (table_name = 'matter_authorization' AND column_name = 'createdAt')
              OR
              (table_name = 'office_settings' AND column_name = 'updatedAt')
              OR
              (table_name = 'file_code_sequence' AND column_name = 'updatedAt')
            )
        `);
        const colTypes = Object.fromEntries(
          columnsRes.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type])
        );

        expect(colTypes['matter.openingDate']).toBe('date');
        expect(colTypes['matter.closingDate']).toBe('date');
        expect(colTypes['matter.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['matter.updatedAt']).toBe('timestamp with time zone');
        expect(colTypes['proceeding.filingDate']).toBe('date');
        expect(colTypes['proceeding.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['proceeding.updatedAt']).toBe('timestamp with time zone');
        expect(colTypes['matter_party.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['matter_party.updatedAt']).toBe('timestamp with time zone');
        expect(colTypes['proceeding_party.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['matter_authorization.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['office_settings.updatedAt']).toBe('timestamp with time zone');
        expect(colTypes['file_code_sequence.updatedAt']).toBe('timestamp with time zone');
      } finally {
        client.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);

  it('upgrades cleanly from accepted T05 schema preserving synthetic parties, encrypted IDs, auth sessions, and cross-timezone data', async () => {
    const originalTestDbUrl = process.env.TEST_DATABASE_URL;
    const dedicated = await createDedicatedTestDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-t05-upgrade-'));

    try {
      // 1. Stage the actual accepted T05 migration tree/history in an isolated baseline fixture
      stageT05BaselineDirectory(tempDir);
      const tempSchemaPath = path.join(tempDir, 'schema.prisma');

      // 2. Run real Prisma CLI to deploy T05 migrations (1 through 6)
      const t05DeployRes = runPrismaMigrateDeployCustom(tempSchemaPath, dedicated.url);
      expect(t05DeployRes.status).toBe(0);

      // Verify that exactly 6 migrations were applied by Prisma
      const clientPre = await dedicated.pool.connect();
      let personPartyId: string;
      let orgPartyId: string;
      let envelope: { ciphertext: string; iv: string; authTag: string; keyId: string; lastFour: string };
      const originalPlaintextNationalId = '29501011234567';
      let ownerResult: Awaited<ReturnType<typeof provisionOwner>>;
      let preMigrationSessionToken: string;

      try {
        const migRows = await clientPre.query('SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at ASC');
        expect(migRows.rows).toHaveLength(6);
        expect(migRows.rows[5].migration_name).toBe('20261118150000_party_idempotency_privacy_cleanup');

        // 3. Establish working credential and verified login on pre-migration database
        process.env.TEST_DATABASE_URL = dedicated.url;
        getEnv(true);
        await clearGlobalSingletons();

        ownerResult = await provisionOwner({
          name: 'أستاذ مؤسس الترقية',
          email: 't05upgrade@lawoffice.test',
          password: 'UpgradePass2026!Valid',
        });
        const validTotp = await generateTotpCode(ownerResult.totpSecret);
        await confirmOwnerProvisioning(ownerResult.user.id, validTotp);

        // Authenticate via Next.js auth endpoint to issue genuine signed session
        const signInReq = new NextRequest('http://127.0.0.1:3000/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 't05upgrade@lawoffice.test',
            password: 'UpgradePass2026!Valid',
          }),
        });
        const signInRes = await authRoutePOST(signInReq);
        expect(signInRes.status).toBe(200);
        const setCookies = signInRes.headers.getSetCookie?.() || [signInRes.headers.get('set-cookie') || ''];
        const tfCookie = setCookies.find((c) => c.includes('better-auth.two_factor='));
        expect(tfCookie).toBeDefined();

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
        preMigrationSessionToken = verifyJson.token;

        // Verify authenticated actor behavior before migration
        const actorPre = await requireActor({ headers: makeSessionHeaders(preMigrationSessionToken) });
        expect(actorPre.id).toBe(ownerResult.user.id);
        expect(actorPre.email).toBe('t05upgrade@lawoffice.test');
        expect(actorPre.role).toBe('OWNER');
        expect(actorPre.twoFactorVerified).toBe(true);
        expect(authorize(actorPre, 'READ_CLIENT_DATA')).toBe(true);

        personPartyId = 'existing-person-t05';
        await clientPre.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'PERSON', 'عميل سابق مؤهل للترقية', 'عميل سابق مؤهل للترقيه', '01012345678', '01012345678', 1, $2, $2, now(), now());
        `, [personPartyId, ownerResult.user.id]);

        orgPartyId = 'existing-org-t05';
        await clientPre.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'ORGANIZATION', 'شركة النيل للصناعات والتوريدات', 'شركه النيل للصناعات والتوريدات', '0222334455', '0222334455', 1, $2, $2, now(), now());
        `, [orgPartyId, ownerResult.user.id]);

        // Genuine encrypted identity: call the application's crypto helper with valid key ID
        envelope = encryptPartyIdentity({
          plaintext: originalPlaintextNationalId,
          partyId: personPartyId,
          identificationType: 'NATIONAL_ID',
        });

        await clientPre.query(`
          INSERT INTO "party_identity" ("id", "partyId", "identificationType", "ciphertext", "iv", "authTag", "keyId", "lastFour", "encryptionVersion", "createdById")
          VALUES ('existing-id-t05', $1, 'NATIONAL_ID', $2, $3, $4, $5, $6, 1, $7);
        `, [personPartyId, envelope.ciphertext, envelope.iv, envelope.authTag, envelope.keyId, envelope.lastFour, ownerResult.user.id]);

        const poaId = 'existing-poa-t05-1';
        await clientPre.query(`
          INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "issueDate", "notarizationOffice", "poaType", "humanReviewStatus", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, '9988/ب', '2026', '2026-05-10', 'مكتب توثيق الجيزة', 'GENERAL', 'VALID', $3, $3, now(), now());
        `, [poaId, personPartyId, ownerResult.user.id]);

        await clientPre.query(`
          INSERT INTO "communication_note" ("id", "partyId", "communicationAt", "followUpDate", "channel", "summary", "createdById")
          VALUES ('existing-note-t05', $1, '2026-11-17T11:00:00Z'::timestamptz, '2026-11-28'::date, 'PHONE', 'ملاحظة تواصل هاتفية سابقة قبل الترقية', $2);
        `, [personPartyId, ownerResult.user.id]);

        // Pre-migration session timezone variations (UTC, Africa/Cairo, America/New_York)
        for (const tz of ['UTC', 'Africa/Cairo', 'America/New_York']) {
          await clientPre.query(`SET TIME ZONE '${tz}'`);
          const preNoteTz = await clientPre.query(`
            SELECT
              to_char("followUpDate", 'YYYY-MM-DD') AS follow_up,
              to_char("communicationAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS comm_utc
            FROM "communication_note" WHERE id = 'existing-note-t05'
          `);
          expect(preNoteTz.rows[0].follow_up).toBe('2026-11-28');
          expect(preNoteTz.rows[0].comm_utc).toBe('2026-11-17T11:00:00Z');

          const prePoaTz = await clientPre.query(`
            SELECT to_char("issueDate", 'YYYY-MM-DD') AS issue_date
            FROM "power_of_attorney" WHERE id = 'existing-poa-t05-1'
          `);
          expect(prePoaTz.rows[0].issue_date).toBe('2026-05-10');
        }
      } finally {
        clientPre.release();
      }

      // 4. Upgrade with actual T06 migrations (7, 8, and 9) via real CLI
      const upgradeRes = runPrismaMigrateDeploy(dedicated.url);
      expect(upgradeRes.status).toBe(0);

      // Verify migration status confirms all migrations applied cleanly
      const statusRes = runPrismaMigrateStatus(dedicated.url);
      expect(statusRes.status).toBe(0);
      expect(statusRes.stdout).toContain('Database schema is up to date');

      // 5. Connect and verify all pre-existing records survive intact
      const clientAfter = await dedicated.pool.connect();
      try {
        const totalMigRows = await clientAfter.query('SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at ASC');
        // Total migrations: 6 from T05 + 3 from T06 = 9
        expect(totalMigRows.rows.length).toBeGreaterThanOrEqual(9);

        const userRes = await clientAfter.query('SELECT id, name, email, "twoFactorEnabled" FROM "user" WHERE id = $1', [ownerResult.user.id]);
        expect(userRes.rows).toHaveLength(1);
        expect(userRes.rows[0].email).toBe('t05upgrade@lawoffice.test');
        expect(userRes.rows[0].twoFactorEnabled).toBe(true);

        // 5a. Verify pre-migration working session is operational after upgrade
        process.env.TEST_DATABASE_URL = dedicated.url;
        getEnv(true);
        await clearGlobalSingletons();

        const actorAfter = await requireActor({ headers: makeSessionHeaders(preMigrationSessionToken) });
        expect(actorAfter.id).toBe(ownerResult.user.id);
        expect(actorAfter.twoFactorVerified).toBe(true);
        expect(authorize(actorAfter, 'READ_CLIENT_DATA')).toBe(true);

        // 5b. Genuinely revoke the session row via database deletion and assert rowCount === 1
        const revokeResult = await clientAfter.query('DELETE FROM "session" WHERE token = $1', [preMigrationSessionToken]);
        expect(revokeResult.rowCount).toBe(1);
        const postRevokeCheck = await clientAfter.query('SELECT id FROM "session" WHERE token = $1', [preMigrationSessionToken]);
        expect(postRevokeCheck.rows).toHaveLength(0);

        // 5c. Verify request with unchanged cookie/token fails closed after revocation
        await expect(requireActor({ headers: makeSessionHeaders(preMigrationSessionToken) })).rejects.toThrow();

        // Verify PERSON party survived intact
        const personRes = await clientAfter.query('SELECT id, name, kind, "primaryPhone" FROM "party" WHERE id = $1', [personPartyId]);
        expect(personRes.rows).toHaveLength(1);
        expect(personRes.rows[0].name).toBe('عميل سابق مؤهل للترقية');
        expect(personRes.rows[0].kind).toBe('PERSON');
        expect(personRes.rows[0].primaryPhone).toBe('01012345678');

        // Verify ORGANIZATION party survived intact
        const orgRes = await clientAfter.query('SELECT id, name, kind, "primaryPhone" FROM "party" WHERE id = $1', [orgPartyId]);
        expect(orgRes.rows).toHaveLength(1);
        expect(orgRes.rows[0].name).toBe('شركة النيل للصناعات والتوريدات');
        expect(orgRes.rows[0].kind).toBe('ORGANIZATION');
        expect(orgRes.rows[0].primaryPhone).toBe('0222334455');

        // Verify EXACT preserved cryptographic values for encrypted identity
        const idRes = await clientAfter.query('SELECT id, ciphertext, iv, "authTag", "keyId", "lastFour" FROM "party_identity" WHERE id = $1', ['existing-id-t05']);
        expect(idRes.rows).toHaveLength(1);
        const idRow = idRes.rows[0];
        expect(idRow.ciphertext).toBe(envelope.ciphertext);
        expect(idRow.iv).toBe(envelope.iv);
        expect(idRow.authTag).toBe(envelope.authTag);
        expect(idRow.keyId).toBe(envelope.keyId);
        expect(idRow.lastFour).toBe(envelope.lastFour);

        // Genuine authorized decryption verification: decrypt with application helper
        const decryptedNationalId = decryptPartyIdentity({
          ciphertext: idRow.ciphertext,
          iv: idRow.iv,
          authTag: idRow.authTag,
          partyId: personPartyId,
          identificationType: 'NATIONAL_ID',
          keyId: idRow.keyId,
          encryptionVersion: 1,
        });
        expect(decryptedNationalId).toBe(originalPlaintextNationalId);

        // Verify POA survived intact
        const poaRes = await clientAfter.query('SELECT id, "poaNumberText", to_char("issueDate", \'YYYY-MM-DD\') as issue_date FROM "power_of_attorney" WHERE id = $1', ['existing-poa-t05-1']);
        expect(poaRes.rows).toHaveLength(1);
        expect(poaRes.rows[0].poaNumberText).toBe('9988/ب');
        expect(poaRes.rows[0].issue_date).toBe('2026-05-10');

        // Verify Communication Note survived intact
        const noteRes = await clientAfter.query(`
          SELECT
            id,
            summary,
            to_char("followUpDate", 'YYYY-MM-DD') AS follow_up,
            to_char("communicationAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS comm_utc
          FROM "communication_note"
          WHERE id = 'existing-note-t05'
        `);
        expect(noteRes.rows).toHaveLength(1);
        expect(noteRes.rows[0].summary).toBe('ملاحظة تواصل هاتفية سابقة قبل الترقية');
        expect(noteRes.rows[0].follow_up).toBe('2026-11-28');
        expect(noteRes.rows[0].comm_utc).toBe('2026-11-17T11:00:00Z');

        // 6. Test writing new T06 entities referencing pre-existing T05 person and POA
        const courtId = 'court-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "court" ("id", "name", "isActive", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'محكمة جنوب الجيزة الابتدائية', true, $2, $2, now(), now());
        `, [courtId, ownerResult.user.id]);

        const matterId = 'matter-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "openingDate", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, '2026/0501', 'ملف جديد مرتبط بعميل سابق من T05', 'LITIGATION', 'ACTIVE', '2026-11-19', 1, $2, $2, '2026-11-19T09:00:00Z'::timestamptz, '2026-11-19T09:00:00Z'::timestamptz);
        `, [matterId, ownerResult.user.id]);

        const matterPartyId = 'mp-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "matter_party" ("id", "matterId", "partyId", "role", "isPrimaryContact", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 'CLIENT', true, 1, $4, $4, now(), now());
        `, [matterPartyId, matterId, personPartyId, ownerResult.user.id]);

        await clientAfter.query(`
          INSERT INTO "matter_authorization" ("id", "matterId", "powerOfAttorneyId", "createdById", "createdAt")
          VALUES ('ma-upgrade-1', $1, 'existing-poa-t05-1', $2, now());
        `, [matterId, ownerResult.user.id]);

        const procId = 'proc-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "filingDate", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 'FIRST_INSTANCE', '105', '2026', 'كلي', 'ACTIVE', '2026-11-19', 1, $4, $4, now(), now());
        `, [procId, matterId, courtId, ownerResult.user.id]);

        await clientAfter.query(`
          INSERT INTO "proceeding_party" ("id", "proceedingId", "matterPartyId", "capacityText", "legalCapacity", "createdById", "createdAt")
          VALUES ('pp-upgrade-1', $1, $2, 'مدعي بصفته', 'PLAINTIFF', $3, now());
        `, [procId, matterPartyId, ownerResult.user.id]);

        // Verify join query across upgraded relationships
        const joinRes = await clientAfter.query(`
          SELECT
            m.title AS matter_title,
            p.name AS party_name,
            poa."poaNumberText" AS poa_number,
            pr."numberText" AS proc_number,
            c.name AS court_name,
            pp."capacityText" AS party_capacity
          FROM "matter" m
          JOIN "matter_party" mp ON mp."matterId" = m.id
          JOIN "party" p ON p.id = mp."partyId"
          JOIN "matter_authorization" ma ON ma."matterId" = m.id
          JOIN "power_of_attorney" poa ON poa.id = ma."powerOfAttorneyId"
          JOIN "proceeding" pr ON pr."matterId" = m.id
          JOIN "court" c ON c.id = pr."courtId"
          JOIN "proceeding_party" pp ON pp."proceedingId" = pr.id
          WHERE m.id = $1
        `, [matterId]);

        expect(joinRes.rows).toHaveLength(1);
        expect(joinRes.rows[0].matter_title).toBe('ملف جديد مرتبط بعميل سابق من T05');
        expect(joinRes.rows[0].party_name).toBe('عميل سابق مؤهل للترقية');
        expect(joinRes.rows[0].poa_number).toBe('9988/ب');
        expect(joinRes.rows[0].proc_number).toBe('105');
        expect(joinRes.rows[0].court_name).toBe('محكمة جنوب الجيزة الابتدائية');
        expect(joinRes.rows[0].party_capacity).toBe('مدعي بصفته');

        // 7. Exercise UTC, Africa/Cairo, and America/New_York session permutations
        // for records created before the migration and records added after the migration
        const testTimezones = ['UTC', 'Africa/Cairo', 'America/New_York'];
        for (const tz of testTimezones) {
          await clientAfter.query(`SET TIME ZONE '${tz}'`);

          // Pre-migration note check: date-only and timestamptz
          const preNoteRes = await clientAfter.query(`
            SELECT
              to_char("followUpDate", 'YYYY-MM-DD') AS follow_up,
              to_char("communicationAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS comm_utc
            FROM "communication_note" WHERE id = 'existing-note-t05'
          `);
          expect(preNoteRes.rows[0].follow_up).toBe('2026-11-28');
          expect(preNoteRes.rows[0].comm_utc).toBe('2026-11-17T11:00:00Z');

          // Pre-migration POA check: date-only
          const prePoaRes = await clientAfter.query(`
            SELECT to_char("issueDate", 'YYYY-MM-DD') AS issue_date
            FROM "power_of_attorney" WHERE id = 'existing-poa-t05-1'
          `);
          expect(prePoaRes.rows[0].issue_date).toBe('2026-05-10');

          // Post-migration Matter check: date-only and timestamptz
          const postMatterRes = await clientAfter.query(`
            SELECT
              to_char("openingDate", 'YYYY-MM-DD') AS opening_date,
              to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_utc
            FROM "matter" WHERE id = $1
          `, [matterId]);
          expect(postMatterRes.rows[0].opening_date).toBe('2026-11-19');
          expect(postMatterRes.rows[0].created_utc).toBe('2026-11-19T09:00:00Z');

          // Post-migration Proceeding check: date-only
          const postProcRes = await clientAfter.query(`
            SELECT to_char("filingDate", 'YYYY-MM-DD') AS filing_date
            FROM "proceeding" WHERE id = $1
          `, [procId]);
          expect(postProcRes.rows[0].filing_date).toBe('2026-11-19');
        }
      } finally {
        clientAfter.release();
      }
    } finally {
      process.env.TEST_DATABASE_URL = originalTestDbUrl;
      getEnv(true);
      await clearGlobalSingletons();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      await dedicated.drop();
    }
  }, 120000);

  it('preserves exact date-only and timestamptz values across UTC and Africa/Cairo session timezones', async () => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      runPrismaMigrateDeploy(dedicated.url);

      const client = await dedicated.pool.connect();
      try {
        // Insert record under UTC session
        await client.query(`SET TIME ZONE 'UTC'`);

        await client.query(`
          INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "openingDate", "closingDate", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ('matter-tz-1', '2026/0999', 'ملف اختبار المناطق الزمنية', 'LITIGATION', 'DRAFT', '2026-11-18', '2027-05-30', 1, 'system', 'system', '2026-11-18T14:30:00Z'::timestamptz, '2026-11-18T14:30:00Z'::timestamptz);
        `);

        // Query under UTC
        const utcRes = await client.query(`
          SELECT
            to_char("openingDate", 'YYYY-MM-DD') AS opening_date,
            to_char("closingDate", 'YYYY-MM-DD') AS closing_date,
            to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at_utc
          FROM "matter" WHERE id = 'matter-tz-1'
        `);
        expect(utcRes.rows[0].opening_date).toBe('2026-11-18');
        expect(utcRes.rows[0].closing_date).toBe('2027-05-30');
        expect(utcRes.rows[0].created_at_utc).toBe('2026-11-18T14:30:00Z');

        // Switch session to Africa/Cairo
        await client.query(`SET TIME ZONE 'Africa/Cairo'`);
        const cairoRes = await client.query(`
          SELECT
            to_char("openingDate", 'YYYY-MM-DD') AS opening_date,
            to_char("closingDate", 'YYYY-MM-DD') AS closing_date,
            to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at_utc
          FROM "matter" WHERE id = 'matter-tz-1'
        `);
        // Date-only columns MUST remain exactly identical calendar days without offset shifting
        expect(cairoRes.rows[0].opening_date).toBe('2026-11-18');
        expect(cairoRes.rows[0].closing_date).toBe('2027-05-30');
        expect(cairoRes.rows[0].created_at_utc).toBe('2026-11-18T14:30:00Z');

        // Switch session to America/New_York (UTC-5)
        await client.query(`SET TIME ZONE 'America/New_York'`);
        const nyRes = await client.query(`
          SELECT
            to_char("openingDate", 'YYYY-MM-DD') AS opening_date,
            to_char("closingDate", 'YYYY-MM-DD') AS closing_date,
            to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at_utc
          FROM "matter" WHERE id = 'matter-tz-1'
        `);
        expect(nyRes.rows[0].opening_date).toBe('2026-11-18');
        expect(nyRes.rows[0].closing_date).toBe('2027-05-30');
        expect(nyRes.rows[0].created_at_utc).toBe('2026-11-18T14:30:00Z');
      } finally {
        client.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);

  it('runs checked-in migration 9 via CLI on a populated migration 8 fixture, preserving source titles and backfilling normalized titles', async () => {
    const originalTestDbUrl = process.env.TEST_DATABASE_URL;
    const dedicated = await createDedicatedTestDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-mig8-upgrade-'));

    try {
      // 1. Stage migrations 1 through 8 in isolated fixture
      stageMigration8BaselineDirectory(tempDir);
      const tempSchemaPath = path.join(tempDir, 'schema.prisma');

      // 2. Deploy migrations 1-8 via Prisma CLI
      const mig8Deploy = runPrismaMigrateDeployCustom(tempSchemaPath, dedicated.url);
      expect(mig8Deploy.status).toBe(0);

      const client = await dedicated.pool.connect();
      const testMatters = [
        { id: 'mig9-matter-1', code: '2026/0801', title: '   قَضِيَّةُ التَّعْوِيضِ رَقْمُ ١٢٣   ' },
        { id: 'mig9-matter-2', code: '2026/0802', title: 'دعوى إيجارات وأتعاب — شركة الأمل' },
        { id: 'mig9-matter-3', code: '2026/0803', title: 'نِزَاعٌ تَجَارِيٌّ مَعَ بنك مصر' },
        { id: 'mig9-matter-4', code: '2026/0804', title: 'مَسْأَلَةُ إِرْثٍ وَتَرِكَاتٍ (أحمد ومحمد)' },
        { id: 'mig9-matter-5', code: '2026/0805', title: 'عقد مقاولة وتوريد بأحرف هجائية (أ إ آ ة ى)' },
      ];

      try {
        // Create user for foreign keys
        await client.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "credentialVersion", "twoFactorEnabled", "emailVerified", "updatedAt")
          VALUES ('mig9-user', 'أستاذ ترقية الهجرة 9', 'mig9@lawoffice.test', 'OWNER', 1, true, true, now());
        `);

        // Populate matter table on Migration 8 schema (no titleNormalized column yet)
        for (const m of testMatters) {
          await client.query(`
            INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, 'LITIGATION', 'ACTIVE', 1, 'mig9-user', 'mig9-user', now(), now());
          `, [m.id, m.code, m.title]);
        }
      } finally {
        client.release();
      }

      // 3. Run real Prisma CLI to deploy checked-in migration 9 from project workspace
      const mig9Deploy = runPrismaMigrateDeploy(dedicated.url);
      expect(mig9Deploy.status).toBe(0);

      // Verify migrate status confirms fully up-to-date
      const statusRes = runPrismaMigrateStatus(dedicated.url);
      expect(statusRes.status).toBe(0);
      expect(statusRes.stdout).toContain('Database schema is up to date');

      // 4. Connect and verify source titles preserved verbatim and titleNormalized backfilled accurately
      const clientAfter = await dedicated.pool.connect();
      try {
        const rows = await clientAfter.query(`
          SELECT id, "fileCode", title, "titleNormalized"
          FROM "matter"
          WHERE id LIKE 'mig9-matter-%'
          ORDER BY id ASC
        `);
        expect(rows.rows).toHaveLength(testMatters.length);

        for (let i = 0; i < testMatters.length; i++) {
          const expected = testMatters[i];
          const actual = rows.rows[i];
          expect(actual.id).toBe(expected.id);
          // Original title MUST be 100% preserved without mutation
          expect(actual.title).toBe(expected.title);
          // titleNormalized must match canonical normalization algorithm
          expect(actual.titleNormalized).toBe(normalizeArabicText(expected.title));
        }

        // Verify index matter_titleNormalized_idx exists and is valid
        const idxRes = await clientAfter.query(`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'matter' AND indexname = 'matter_titleNormalized_idx'
        `);
        expect(idxRes.rows).toHaveLength(1);
      } finally {
        clientAfter.release();
      }
    } finally {
      process.env.TEST_DATABASE_URL = originalTestDbUrl;
      getEnv(true);
      await clearGlobalSingletons();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      await dedicated.drop();
    }
  }, 120000);

  it.each([
    { tz: 'UTC', desc: 'UTC migration CLI environment' },
    { tz: 'Africa/Cairo', desc: 'Africa/Cairo migration CLI environment' },
  ])(
    'runs Prisma migrate deploy under $desc and verifies exact temporal and record preservation (E2)',
    async ({ tz }) => {
      const dedicated = await createDedicatedTestDatabase();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lawoffice-t05-tz-${tz.replace('/', '_')}-`));
      try {
        // 1. Stage and deploy baseline migrations 1-6 using real Prisma CLI
        stageT05BaselineDirectory(tempDir);
        const tempSchemaPath = path.join(tempDir, 'schema.prisma');
        const t05DeployRes = runPrismaMigrateDeployCustom(tempSchemaPath, dedicated.url);
        expect(t05DeployRes.status).toBe(0);

        const clientPre = await dedicated.pool.connect();
        try {
          // Insert a user first
          await clientPre.query(`
            INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
            VALUES ('tz-test-user', 'مستخدم الترقية الزمني', 'tz@lawoffice.test', true, now(), now());
          `);

          // Insert baseline temporal data before migration
          await clientPre.query(`
            INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('tz-test-party', 'PERSON', 'طرف اختبار الترقية الزمني', 'طرف اختبار الترقيه الزمني', '01055554444', '01055554444', 1, 'tz-test-user', 'tz-test-user', '2026-11-18T10:00:00Z'::timestamptz, '2026-11-18T10:00:00Z'::timestamptz);
          `);

          await clientPre.query(`
            INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "issueDate", "notarizationOffice", "poaType", "humanReviewStatus", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('tz-test-poa', 'tz-test-party', '123/أ', '2026', '2026-05-10', 'توثيق الدقي', 'GENERAL', 'VALID', 'tz-test-user', 'tz-test-user', now(), now());
          `);

          await clientPre.query(`
            INSERT INTO "communication_note" ("id", "partyId", "communicationAt", "followUpDate", "channel", "summary", "createdById")
            VALUES ('tz-test-note', 'tz-test-party', '2026-11-17T11:00:00Z'::timestamptz, '2026-11-28'::date, 'PHONE', 'ملاحظة تواصل هاتفية قبل الترقية', 'tz-test-user');
          `);
        } finally {
          clientPre.release();
        }

        // Configure disposable baseline database default timezone to $tz
        const dbName = new URL(dedicated.url).pathname.replace('/', '');
        const clientAdmin = await dedicated.pool.connect();
        try {
          await clientAdmin.query(`ALTER DATABASE "${dbName}" SET timezone TO '${tz}';`);
        } finally {
          clientAdmin.release();
        }

        // Close old pool connections so new connections adopt the altered database timezone default
        await dedicated.pool.end();
        dedicated.pool = new Pool({ connectionString: dedicated.url });

        // Verify effective session timezone setting on a fresh connection with same db and role as CLI
        const verifyClient = new Client({ connectionString: dedicated.url });
        await verifyClient.connect();
        try {
          const tzCheck = await verifyClient.query(`SHOW timezone;`);
          expect(tzCheck.rows[0].TimeZone.toLowerCase()).toBe(tz.toLowerCase());
        } finally {
          await verifyClient.end();
        }

        // 2. Run the migration CLI under the explicit timezone permutation ($tz)
        const upgradeRes = runPrismaMigrateDeploy(dedicated.url, tz);
        expect(upgradeRes.status).toBe(0);

        // 3. Connect and verify all records survive intact with preserved dates and instants
        const clientAfter = await dedicated.pool.connect();
        try {
          const noteRes = await clientAfter.query(`
            SELECT
              to_char("followUpDate", 'YYYY-MM-DD') AS follow_up,
              to_char("communicationAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS comm_utc
            FROM "communication_note" WHERE id = 'tz-test-note'
          `);
          expect(noteRes.rows[0].follow_up).toBe('2026-11-28');
          expect(noteRes.rows[0].comm_utc).toBe('2026-11-17T11:00:00Z');

          const poaRes = await clientAfter.query(`
            SELECT to_char("issueDate", 'YYYY-MM-DD') AS issue_date
            FROM "power_of_attorney" WHERE id = 'tz-test-poa'
          `);
          expect(poaRes.rows[0].issue_date).toBe('2026-05-10');

          // 4. Assert preservation for newly created post-migration temporal fixtures (E2)
          await clientAfter.query(`
            INSERT INTO "court" ("id", "name", "isActive", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('tz-new-court', 'محكمة الترقية الجديدة', true, 1, 'tz-test-user', 'tz-test-user', now(), now());
          `);

          await clientAfter.query(`
            INSERT INTO "matter" ("id", "fileCode", "title", "titleNormalized", "kind", "status", "openingDate", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('tz-new-matter', '2026/TZ-01', 'ملف زمني جديد', 'ملف زمني جديد', 'LITIGATION', 'ACTIVE', '2026-11-20'::date, 1, 'tz-test-user', 'tz-test-user', '2026-11-20T12:00:00Z'::timestamptz, '2026-11-20T12:00:00Z'::timestamptz);
          `);

          await clientAfter.query(`
            INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "filingDate", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('tz-new-proc', 'tz-new-matter', 'tz-new-court', 'FIRST_INSTANCE', '9988', '2026', '2026-06-15'::date, 'ACTIVE', 1, 'tz-test-user', 'tz-test-user', '2026-11-20T12:00:00Z'::timestamptz, '2026-11-20T12:00:00Z'::timestamptz);
          `);

          const matterRes = await clientAfter.query(`
            SELECT
              to_char("openingDate", 'YYYY-MM-DD') AS opening_date,
              to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_utc
            FROM "matter" WHERE id = 'tz-new-matter'
          `);
          expect(matterRes.rows[0].opening_date).toBe('2026-11-20');
          expect(matterRes.rows[0].created_utc).toBe('2026-11-20T12:00:00Z');

          const procRes = await clientAfter.query(`
            SELECT to_char("filingDate", 'YYYY-MM-DD') AS filing_date
            FROM "proceeding" WHERE id = 'tz-new-proc'
          `);
          expect(procRes.rows[0].filing_date).toBe('2026-06-15');
        } finally {
          clientAfter.release();
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        await dedicated.pool.end().catch(() => {});
        await dedicated.drop();
      }
    },
    120000
  );

  it(
    'upgrades cleanly from predecessor T06 migrations to T07, backfilling proceeding normalized numbers and archivedAt while preserving historical casework and links',
    async () => {
      const dedicated = await createDedicatedTestDatabase();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't06-t07-upgrade-'));
      const tempSchemaPath = path.join(tempDir, 'schema.prisma');

      try {
        // 1. Stage predecessor T06 migrations and deploy
        stageT06BaselineDirectory(tempDir);
        const t06DeployRes = runPrismaMigrateDeployCustom(tempSchemaPath, dedicated.url);
        expect(t06DeployRes.status).toBe(0);

        // 2. Seed historical T06 data
        const clientPre = await dedicated.pool.connect();
        try {
          await clientPre.query(`
            INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
            VALUES ('t06-hist-user', 'مستخدم الترقية التاريخي', 't06hist@lawoffice.test', true, now(), now());
          `);

          await clientPre.query(`
            INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-party', 'PERSON', 'الموكل التراثي القديم', 'الموكل التراثي القديم', '01011223344', '01011223344', 1, 't06-hist-user', 't06-hist-user', now(), now());
          `);

          await clientPre.query(`
            INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "notarizationOffice", "poaType", "humanReviewStatus", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-poa', 't06-hist-party', '9988/ت', '2025', 'توثيق الأهرام', 'GENERAL', 'VALID', 't06-hist-user', 't06-hist-user', now(), now());
          `);

          await clientPre.query(`
            INSERT INTO "court" ("id", "name", "code", "isActive", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-court', 'محكمة الجيزة الابتدائية', 'GIZA-01', true, 1, 't06-hist-user', 't06-hist-user', now(), now());
          `);

          // Active matter
          await clientPre.query(`
            INSERT INTO "matter" ("id", "fileCode", "title", "titleNormalized", "kind", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-matter-active', '2026/0101', 'نزاع عقاري نشط', 'نزاع عقاري نشط', 'LITIGATION', 'ACTIVE', 1, 't06-hist-user', 't06-hist-user', now(), now());
          `);

          // Pre-existing ARCHIVED matter (status = ARCHIVED, but archivedAt does not exist in T06 table schema)
          await clientPre.query(`
            INSERT INTO "matter" ("id", "fileCode", "title", "titleNormalized", "kind", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-matter-archived', '2026/0102', 'ملف مؤرشف مسبقاً بالتراث', 'ملف مؤرشف مسبقا بالتراث', 'CONSULTATION', 'ARCHIVED', 1, 't06-hist-user', 't06-hist-user', '2026-11-10T12:00:00Z', '2026-11-15T15:30:00Z');
          `);

          // Proceeding 1: with Eastern Arabic digits in numberText and yearLabel
          await clientPre.query(`
            INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-proc-east', 't06-hist-matter-active', 't06-hist-court', 'FIRST_INSTANCE', '١٢٣٤/ق', '٢٠٢٥', 'مدني كلي', 'ACTIVE', 1, 't06-hist-user', 't06-hist-user', now(), now());
          `);

          // Proceeding 2: with Western digits
          await clientPre.query(`
            INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-proc-west', 't06-hist-matter-active', 't06-hist-court', 'FIRST_INSTANCE', '5678', '2024', 'تجاري', 'ACTIVE', 1, 't06-hist-user', 't06-hist-user', now(), now());
          `);

          // Links
          await clientPre.query(`
            INSERT INTO "matter_party" ("id", "matterId", "partyId", "role", "isPrimaryContact", "version", "createdById", "updatedById", "createdAt", "updatedAt")
            VALUES ('t06-hist-mp', 't06-hist-matter-active', 't06-hist-party', 'CLIENT', true, 1, 't06-hist-user', 't06-hist-user', now(), now());
          `);

          await clientPre.query(`
            INSERT INTO "proceeding_party" ("id", "proceedingId", "matterPartyId", "capacityText", "legalCapacity", "createdById", "createdAt")
            VALUES ('t06-hist-pp', 't06-hist-proc-east', 't06-hist-mp', 'مدعي أصلي', 'PLAINTIFF', 't06-hist-user', now());
          `);

          await clientPre.query(`
            INSERT INTO "matter_authorization" ("id", "matterId", "powerOfAttorneyId", "createdById", "createdAt")
            VALUES ('t06-hist-auth', 't06-hist-matter-active', 't06-hist-poa', 't06-hist-user', now());
          `);
        } finally {
          clientPre.release();
        }

        // 3. Stage and deploy T07 migration 20261122000000_t07_archive_and_search_indexes
        const t07SrcDir = path.resolve(process.cwd(), 'prisma/migrations/20261122000000_t07_archive_and_search_indexes');
        const t07DstDir = path.join(tempDir, 'migrations/20261122000000_t07_archive_and_search_indexes');
        fs.mkdirSync(t07DstDir, { recursive: true });
        fs.copyFileSync(path.join(t07SrcDir, 'migration.sql'), path.join(t07DstDir, 'migration.sql'));

        const t07DeployRes = runPrismaMigrateDeployCustom(tempSchemaPath, dedicated.url);
        expect(t07DeployRes.status).toBe(0);

        // 4. Assert schema, backfill, and data preservation
        const clientAfter = await dedicated.pool.connect();
        try {
          // Check columns exist
          const columnsRes = await clientAfter.query(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name IN ('matter', 'proceeding')
          `);
          const matterCols = columnsRes.rows.filter((r) => r.table_name === 'matter').map((r) => r.column_name);
          const procCols = columnsRes.rows.filter((r) => r.table_name === 'proceeding').map((r) => r.column_name);

          expect(matterCols).toContain('archivedAt');
          expect(matterCols).toContain('archiveReason');
          expect(procCols).toContain('archivedAt');
          expect(procCols).toContain('archiveReason');
          expect(procCols).toContain('numberNormalized');
          expect(procCols).toContain('yearNormalized');

          // Check backfill of archivedAt for historical archived matter
          const archMatterRes = await clientAfter.query(`
            SELECT status, "archivedAt", "updatedAt"
            FROM "matter" WHERE id = 't06-hist-matter-archived'
          `);
          expect(archMatterRes.rows).toHaveLength(1);
          expect(archMatterRes.rows[0].status).toBe('ARCHIVED');
          expect(archMatterRes.rows[0].archivedAt).not.toBeNull();
          expect(new Date(archMatterRes.rows[0].archivedAt).getTime()).toBe(new Date(archMatterRes.rows[0].updatedAt).getTime());

          // Check active matter has null archivedAt
          const actMatterRes = await clientAfter.query(`
            SELECT status, "archivedAt"
            FROM "matter" WHERE id = 't06-hist-matter-active'
          `);
          expect(actMatterRes.rows[0].status).toBe('ACTIVE');
          expect(actMatterRes.rows[0].archivedAt).toBeNull();

          // Check backfill of Eastern Arabic digits in proceeding
          const procEastRes = await clientAfter.query(`
            SELECT "numberText", "numberNormalized", "yearLabel", "yearNormalized"
            FROM "proceeding" WHERE id = 't06-hist-proc-east'
          `);
          expect(procEastRes.rows).toHaveLength(1);
          expect(procEastRes.rows[0].numberText).toBe('١٢٣٤/ق');
          expect(procEastRes.rows[0].yearLabel).toBe('٢٠٢٥');
          expect(procEastRes.rows[0].numberNormalized).toBe('1234/ق');
          expect(procEastRes.rows[0].yearNormalized).toBe('2025');

          // Check Western digits proceeding
          const procWestRes = await clientAfter.query(`
            SELECT "numberText", "numberNormalized", "yearLabel", "yearNormalized"
            FROM "proceeding" WHERE id = 't06-hist-proc-west'
          `);
          expect(procWestRes.rows[0].numberNormalized).toBe('5678');
          expect(procWestRes.rows[0].yearNormalized).toBe('2024');

          // Check links preservation
          const mpRes = await clientAfter.query(`SELECT id, "matterId", "partyId" FROM "matter_party" WHERE id = 't06-hist-mp'`);
          expect(mpRes.rows).toHaveLength(1);

          const ppRes = await clientAfter.query(`SELECT id, "proceedingId" FROM "proceeding_party" WHERE id = 't06-hist-pp'`);
          expect(ppRes.rows).toHaveLength(1);

          const authRes = await clientAfter.query(`SELECT id, "matterId" FROM "matter_authorization" WHERE id = 't06-hist-auth'`);
          expect(authRes.rows).toHaveLength(1);

          // Check search query matching using normalized indexes
          const searchByWestern = await clientAfter.query(`
            SELECT id FROM "proceeding" WHERE "numberNormalized" LIKE '%1234%'
          `);
          expect(searchByWestern.rows.map((r) => r.id)).toContain('t06-hist-proc-east');
        } finally {
          clientAfter.release();
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        await dedicated.pool.end().catch(() => {});
        await dedicated.drop();
      }
    },
    120000
  );
});
