import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { createDedicatedTestDatabase } from '../helpers/test-db';
import { setupTestEncryptionKeys } from '../helpers/party-test-helper';

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

describe('T06-15: Schema Migrations & Upgrade Safety (Integration)', () => {
  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  it('applies all migrations cleanly to a fresh database via migrate deploy', async () => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      runPrismaMigrateDeploy(dedicated.url);

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

  it('upgrades cleanly from accepted T05 schema preserving synthetic parties, encrypted IDs, and auth sessions', async () => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      const client = await dedicated.pool.connect();
      try {
        // 1. Initialize _prisma_migrations table
        await client.query(`
          CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
            "id" VARCHAR(36) PRIMARY KEY,
            "checksum" VARCHAR(64) NOT NULL,
            "finished_at" TIMESTAMPTZ,
            "migration_name" VARCHAR(255) NOT NULL,
            "logs" TEXT,
            "rolled_back_at" TIMESTAMPTZ,
            "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "applied_steps_count" INTEGER NOT NULL DEFAULT 0
          );
        `);

        // 2. Apply all T05 migrations in order (1 through 6)
        const t05MigrationDirs = [
          '20261111000000_init_auth',
          '20261114000000_credential_version',
          '20261117000000_parties_communication_poa',
          '20261117010000_party_temporal_types',
          '20261118020000_party_temporal_utc_semantics',
          '20261118150000_party_idempotency_privacy_cleanup',
        ];

        for (const dirName of t05MigrationDirs) {
          const sqlPath = path.resolve(process.cwd(), `prisma/migrations/${dirName}/migration.sql`);
          const sql = fs.readFileSync(sqlPath, 'utf8');
          await client.query(sql);

          const checksum = crypto.createHash('sha256').update(sql).digest('hex');
          await client.query(`
            INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
            VALUES ($1, $2, now(), $3, 1)
          `, [crypto.randomUUID(), checksum, dirName]);
        }

        // 3. Populate synthetic pre-existing T05 records
        await client.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "credentialVersion", "updatedAt")
          VALUES ('existing-owner-t05', 'أستاذ مؤسس الترقية', 't05upgrade@lawoffice.test', 'OWNER', 1, now());
        `);

        await client.query(`
          INSERT INTO "session" ("id", "expiresAt", "token", "userId", "updatedAt")
          VALUES ('existing-session-t05', now() + interval '24 hours', 'token-t05-upgrade-xyz', 'existing-owner-t05', now());
        `);

        const partyId = 'existing-party-t05-1';
        await client.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "primaryPhone", "primaryPhoneNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'PERSON', 'عميل سابق مؤهل للترقية', 'عميل سابق مؤهل للترقيه', '01012345678', '01012345678', 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [partyId]);

        // Encrypted identity record with valid AES-256-GCM ciphertext
        await client.query(`
          INSERT INTO "party_identity" ("id", "partyId", "identificationType", "ciphertext", "iv", "authTag", "keyId", "lastFour", "createdById")
          VALUES ('existing-id-t05', $1, 'NATIONAL_ID', 'testcipher', 'testiv', 'testtag', 'k2026_01', '7890', 'existing-owner-t05');
        `, [partyId]);

        const poaId = 'existing-poa-t05-1';
        await client.query(`
          INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "notarizationOffice", "poaType", "humanReviewStatus", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, '9988/ب', '2026', 'مكتب توثيق الجيزة', 'GENERAL', 'VALID', 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [poaId, partyId]);

        await client.query(`
          INSERT INTO "communication_note" ("id", "partyId", "communicationAt", "channel", "summary", "createdById")
          VALUES ('existing-note-t05', $1, now(), 'PHONE', 'ملاحظة تواصل هاتفية سابقة قبل الترقية', 'existing-owner-t05');
        `, [partyId]);
      } finally {
        client.release();
      }

      // 4. Run prisma migrate deploy to apply T06 migrations
      runPrismaMigrateDeploy(dedicated.url);

      // 5. Connect and verify all pre-existing records survive intact
      const clientAfter = await dedicated.pool.connect();
      try {
        const userRes = await clientAfter.query('SELECT id, name, email FROM "user" WHERE id = $1', ['existing-owner-t05']);
        expect(userRes.rows).toHaveLength(1);
        expect(userRes.rows[0].email).toBe('t05upgrade@lawoffice.test');

        const sessionRes = await clientAfter.query('SELECT id, token FROM "session" WHERE id = $1', ['existing-session-t05']);
        expect(sessionRes.rows).toHaveLength(1);
        expect(sessionRes.rows[0].token).toBe('token-t05-upgrade-xyz');

        const partyRes = await clientAfter.query('SELECT id, name FROM "party" WHERE id = $1', ['existing-party-t05-1']);
        expect(partyRes.rows).toHaveLength(1);
        expect(partyRes.rows[0].name).toBe('عميل سابق مؤهل للترقية');

        const idRes = await clientAfter.query('SELECT id, ciphertext, "lastFour" FROM "party_identity" WHERE id = $1', ['existing-id-t05']);
        expect(idRes.rows).toHaveLength(1);
        expect(idRes.rows[0].lastFour).toBe('7890');

        const poaRes = await clientAfter.query('SELECT id, "poaNumberText" FROM "power_of_attorney" WHERE id = $1', ['existing-poa-t05-1']);
        expect(poaRes.rows).toHaveLength(1);
        expect(poaRes.rows[0].poaNumberText).toBe('9988/ب');

        // 6. Test writing new T06 entities referencing pre-existing T05 party and POA
        const courtId = 'court-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "court" ("id", "name", "isActive", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, 'محكمة جنوب الجيزة الابتدائية', true, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [courtId]);

        const matterId = 'matter-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, '2026/0501', 'ملف جديد مرتبط بعميل سابق من T05', 'LITIGATION', 'ACTIVE', 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [matterId]);

        const matterPartyId = 'mp-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "matter_party" ("id", "matterId", "partyId", "role", "isPrimaryContact", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, 'existing-party-t05-1', 'CLIENT', true, 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
        `, [matterPartyId, matterId]);

        await clientAfter.query(`
          INSERT INTO "matter_authorization" ("id", "matterId", "powerOfAttorneyId", "createdById", "createdAt")
          VALUES ('ma-upgrade-1', $1, 'existing-poa-t05-1', 'existing-owner-t05', now());
        `, [matterId]);

        const procId = 'proc-upgrade-1';
        await clientAfter.query(`
          INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, 'FIRST_INSTANCE', '105', '2026', 'كلي', 'ACTIVE', 1, 'existing-owner-t05', 'existing-owner-t05', now(), now());
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
      } finally {
        clientAfter.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 90000);

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
