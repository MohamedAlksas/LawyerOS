import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import { createDedicatedTestDatabase } from '../helpers/test-db';
import { setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { encryptPartyIdentity, decryptPartyIdentity } from '@/lib/crypto/party-identity';

function runPrismaMigrateDeploy(dbUrl: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      NODE_ENV: 'test',
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

      try {
        const migRows = await clientPre.query('SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at ASC');
        expect(migRows.rows).toHaveLength(6);
        expect(migRows.rows[5].migration_name).toBe('20261118150000_party_idempotency_privacy_cleanup');

        // 3. Seed valid synthetic PERSON and ORGANIZATION records before migration
        await clientPre.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "credentialVersion", "twoFactorEnabled", "emailVerified", "updatedAt")
          VALUES ('existing-owner-t05', 'أستاذ مؤسس الترقية', 't05upgrade@lawoffice.test', 'OWNER', 1, true, true, now());
        `);

        await clientPre.query(`
          INSERT INTO "session" ("id", "expiresAt", "token", "userId", "updatedAt")
          VALUES ('existing-session-t05', now() + interval '24 hours', 'token-t05-upgrade-xyz', 'existing-owner-t05', now());
        `);

        await clientPre.query(`
          INSERT INTO "twoFactor" ("id", "userId", "secret", "backupCodes", "verified")
          VALUES ('existing-2fa-t05', 'existing-owner-t05', 'TESTUPGRADE2FASECRET', '[]', true);
        `);

        personPartyId = 'existing-person-t05';
        await clientPre.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'PERSON', 'عميل سابق مؤهل للترقية', 'عميل سابق مؤهل للترقيه', '01012345678', '01012345678', 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [personPartyId]);

        orgPartyId = 'existing-org-t05';
        await clientPre.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'ORGANIZATION', 'شركة النيل للصناعات والتوريدات', 'شركه النيل للصناعات والتوريدات', '0222334455', '0222334455', 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [orgPartyId]);

        // Genuine encrypted identity: call the application's crypto helper with valid key ID
        envelope = encryptPartyIdentity({
          plaintext: originalPlaintextNationalId,
          partyId: personPartyId,
          identificationType: 'NATIONAL_ID',
        });

        await clientPre.query(`
          INSERT INTO "party_identity" ("id", "partyId", "identificationType", "ciphertext", "iv", "authTag", "keyId", "lastFour", "encryptionVersion", "createdById")
          VALUES ('existing-id-t05', $1, 'NATIONAL_ID', $2, $3, $4, $5, $6, 1, 'existing-owner-t05');
        `, [personPartyId, envelope.ciphertext, envelope.iv, envelope.authTag, envelope.keyId, envelope.lastFour]);

        const poaId = 'existing-poa-t05-1';
        await clientPre.query(`
          INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "issueDate", "notarizationOffice", "poaType", "humanReviewStatus", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, '9988/ب', '2026', '2026-05-10', 'مكتب توثيق الجيزة', 'GENERAL', 'VALID', 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [poaId, personPartyId]);

        await clientPre.query(`
          INSERT INTO "communication_note" ("id", "partyId", "communicationAt", "followUpDate", "channel", "summary", "createdById")
          VALUES ('existing-note-t05', $1, '2026-11-17T11:00:00Z'::timestamptz, '2026-11-28'::date, 'PHONE', 'ملاحظة تواصل هاتفية سابقة قبل الترقية', 'existing-owner-t05');
        `, [personPartyId]);
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

        const userRes = await clientAfter.query('SELECT id, name, email, "twoFactorEnabled" FROM "user" WHERE id = $1', ['existing-owner-t05']);
        expect(userRes.rows).toHaveLength(1);
        expect(userRes.rows[0].email).toBe('t05upgrade@lawoffice.test');
        expect(userRes.rows[0].twoFactorEnabled).toBe(true);

        // Verify active working session and actual session revocation
        const sessionRes = await clientAfter.query('SELECT id, token, "expiresAt" FROM "session" WHERE token = $1', ['token-t05-upgrade-xyz']);
        expect(sessionRes.rows).toHaveLength(1);
        expect(sessionRes.rows[0].token).toBe('token-t05-upgrade-xyz');

        // Genuinely revoke the session row via database deletion and assert rowCount === 1
        const revokeResult = await clientAfter.query('DELETE FROM "session" WHERE token = $1', ['token-t05-upgrade-xyz']);
        expect(revokeResult.rowCount).toBe(1);
        const postRevokeCheck = await clientAfter.query('SELECT id FROM "session" WHERE token = $1', ['token-t05-upgrade-xyz']);
        expect(postRevokeCheck.rows).toHaveLength(0);

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
          VALUES ($1, 'محكمة جنوب الجيزة الابتدائية', true, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [courtId]);

        const matterId = 'matter-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "openingDate", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, '2026/0501', 'ملف جديد مرتبط بعميل سابق من T05', 'LITIGATION', 'ACTIVE', '2026-11-19', 1, 'existing-owner-t05', 'existing-owner-t05', '2026-11-19T09:00:00Z'::timestamptz, '2026-11-19T09:00:00Z'::timestamptz);
        `, [matterId]);

        const matterPartyId = 'mp-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "matter_party" ("id", "matterId", "partyId", "role", "isPrimaryContact", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 'CLIENT', true, 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [matterPartyId, matterId, personPartyId]);

        await clientAfter.query(`
          INSERT INTO "matter_authorization" ("id", "matterId", "powerOfAttorneyId", "createdById", "createdAt")
          VALUES ('ma-upgrade-1', $1, 'existing-poa-t05-1', 'existing-owner-t05', now());
        `, [matterId]);

        const procId = 'proc-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "filingDate", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 'FIRST_INSTANCE', '105', '2026', 'كلي', 'ACTIVE', '2026-11-19', 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [procId, matterId, courtId]);

        await clientAfter.query(`
          INSERT INTO "proceeding_party" ("id", "proceedingId", "matterPartyId", "capacityText", "legalCapacity", "createdById", "createdAt")
          VALUES ('pp-upgrade-1', $1, $2, 'مدعي بصفته', 'PLAINTIFF', 'existing-owner-t05', now());
        `, [procId, matterPartyId]);

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
});
