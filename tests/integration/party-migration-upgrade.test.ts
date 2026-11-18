import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
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

describe('T05-10: Schema Migrations & Upgrade Safety (Integration)', () => {
  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  it('applies all migrations cleanly to a fresh database via migrate deploy', async () => {
    // 1. Create a clean dedicated test database
    const dedicated = await createDedicatedTestDatabase();

    try {
      // 2. Run prisma migrate deploy against the clean database
      runPrismaMigrateDeploy(dedicated.url);

      // 3. Connect to the migrated database and verify tables and indexes exist
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

        // New T05 Party models
        expect(tableNames).toContain('party');
        expect(tableNames).toContain('party_identity');
        expect(tableNames).toContain('communication_note');
        expect(tableNames).toContain('power_of_attorney');
        expect(tableNames).toContain('audit_event');
        expect(tableNames).toContain('idempotency_record');

        // Verify foreign key constraints
        const fkRes = await client.query(`
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE constraint_type = 'FOREIGN KEY'
        `);
        const fkNames = fkRes.rows.map((r) => r.constraint_name);
        expect(fkNames).toContain('party_identity_partyId_fkey');
        expect(fkNames).toContain('communication_note_partyId_fkey');
        expect(fkNames).toContain('power_of_attorney_partyId_fkey');

        // Verify native temporal types (STD-04)
        const columnsRes = await client.query(`
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'communication_note' AND column_name IN ('communicationAt', 'followUpDate'))
              OR
              (table_name = 'power_of_attorney' AND column_name IN ('issueDate', 'humanReviewedAt'))
            )
        `);
        const colTypes = Object.fromEntries(
          columnsRes.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type])
        );
        expect(colTypes['communication_note.communicationAt']).toBe('timestamp with time zone');
        expect(colTypes['communication_note.followUpDate']).toBe('date');
        expect(colTypes['power_of_attorney.issueDate']).toBe('date');
        expect(colTypes['power_of_attorney.humanReviewedAt']).toBe('timestamp with time zone');
      } finally {
        client.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);

  it('preserves existing T03 auth records during upgrade and allows new party writes', async () => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      // 1. Apply ONLY the two initial auth migrations to simulate pre-T05 state
      const client = await dedicated.pool.connect();
      try {
        // Run migration 1: init_auth
        const fs = await import('fs');
        const path = await import('path');

        const mig1 = fs.readFileSync(
          path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql'),
          'utf8'
        );
        await client.query(mig1);

        // Run migration 2: credential_version
        const mig2 = fs.readFileSync(
          path.resolve(process.cwd(), 'prisma/migrations/20261114000000_credential_version/migration.sql'),
          'utf8'
        );
        await client.query(mig2);

        // Record migrations as applied in _prisma_migrations table
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
        await client.query(`
          INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
          VALUES 
            (gen_random_uuid()::text, 'checksum1', now(), '20261111000000_init_auth', 1),
            (gen_random_uuid()::text, 'checksum2', now(), '20261114000000_credential_version', 1);
        `);

        // Populate synthetic pre-existing user and session
        await client.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "credentialVersion", "updatedAt")
          VALUES ('existing-user-1', 'المحامي المؤسس', 'founder@lawoffice.test', 'OWNER', 1, now());
        `);
        await client.query(`
          INSERT INTO "session" ("id", "expiresAt", "token", "userId", "updatedAt")
          VALUES ('existing-session-1', now() + interval '12 hours', 'token-12345', 'existing-user-1', now());
        `);
      } finally {
        client.release();
      }

      // 2. Run migrate deploy to upgrade database to T05
      runPrismaMigrateDeploy(dedicated.url);

      // 3. Verify pre-existing auth records are preserved intact
      const clientAfter = await dedicated.pool.connect();
      try {
        const userRes = await clientAfter.query(
          'SELECT id, name, email FROM "user" WHERE id = $1',
          ['existing-user-1']
        );
        expect(userRes.rows).toHaveLength(1);
        expect(userRes.rows[0].name).toBe('المحامي المؤسس');

        const sessionRes = await clientAfter.query(
          'SELECT id, token FROM "session" WHERE id = $1',
          ['existing-session-1']
        );
        expect(sessionRes.rows).toHaveLength(1);
        expect(sessionRes.rows[0].token).toBe('token-12345');

        // 4. Verify new Party write succeeds on upgraded database
        const partyRes = await clientAfter.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "version", "createdById", "updatedById", "updatedAt")
          VALUES (gen_random_uuid()::text, 'PERSON', 'عميل جديد بعد الترقية', 'عميل جديد بعد الترقيه', 1, 'existing-user-1', 'existing-user-1', now())
          RETURNING id, name;
        `);
        expect(partyRes.rows).toHaveLength(1);
        expect(partyRes.rows[0].name).toBe('عميل جديد بعد الترقية');

        // 5. Verify upgraded database has correct native temporal types
        const colRes = await clientAfter.query(`
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'communication_note' AND column_name IN ('communicationAt', 'followUpDate', 'createdAt'))
              OR
              (table_name = 'power_of_attorney' AND column_name IN ('issueDate', 'humanReviewedAt', 'createdAt', 'updatedAt'))
              OR
              (table_name = 'party' AND column_name IN ('createdAt', 'updatedAt', 'archivedAt'))
              OR
              (table_name = 'party_identity' AND column_name = 'createdAt')
              OR
              (table_name = 'audit_event' AND column_name = 'createdAt')
              OR
              (table_name = 'idempotency_record' AND column_name IN ('createdAt', 'completedAt'))
            )
        `);
        const colTypes = Object.fromEntries(
          colRes.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type])
        );
        expect(colTypes['communication_note.communicationAt']).toBe('timestamp with time zone');
        expect(colTypes['communication_note.followUpDate']).toBe('date');
        expect(colTypes['communication_note.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['power_of_attorney.issueDate']).toBe('date');
        expect(colTypes['power_of_attorney.humanReviewedAt']).toBe('timestamp with time zone');
        expect(colTypes['power_of_attorney.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['power_of_attorney.updatedAt']).toBe('timestamp with time zone');
        expect(colTypes['party.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['party.updatedAt']).toBe('timestamp with time zone');
        expect(colTypes['party.archivedAt']).toBe('timestamp with time zone');
        expect(colTypes['party_identity.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['audit_event.createdAt']).toBe('timestamp with time zone');
        expect(colTypes['idempotency_record.createdAt']).toBe('timestamp with time zone');
      } finally {
        clientAfter.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);

  it.each([
    { zone4: 'UTC', zone5: 'UTC', desc: 'UTC mig4 / UTC mig5' },
    { zone4: 'Africa/Cairo', zone5: 'Africa/Cairo', desc: 'Cairo mig4 / Cairo mig5' },
    { zone4: 'UTC', zone5: 'Africa/Cairo', desc: 'UTC mig4 / Cairo mig5' },
    { zone4: 'Africa/Cairo', zone5: 'UTC', desc: 'Cairo mig4 / UTC mig5' },
  ])('preserves exact UTC temporal instants across communication, review, and party columns under $desc (R4-01)', async ({ zone4, zone5 }) => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      const client = await dedicated.pool.connect();
      try {
        const fs = await import('fs');
        const path = await import('path');

        // Apply migrations 1 through 3 to create prior T05 schema
        const mig1 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql'), 'utf8');
        await client.query(mig1);
        const mig2 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261114000000_credential_version/migration.sql'), 'utf8');
        await client.query(mig2);
        const mig3 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261117000000_parties_communication_poa/migration.sql'), 'utf8');
        await client.query(mig3);

        // Populate test party, legacy communication note, and legacy power of attorney with known instants
        await client.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ('party-tz-test-1', 'PERSON', 'عميل اختبار التوقيت', 'عميل اختبار التوقيت', 1, 'system', 'system', '2026-11-18 10:00:00'::timestamp, '2026-11-18 10:00:00'::timestamp);
        `);

        await client.query(`
          INSERT INTO "communication_note" ("id", "partyId", "communicationAt", "channel", "summary", "createdById")
          VALUES ('note-legacy-1', 'party-tz-test-1', '2026-11-18 10:00:00'::timestamp, 'PHONE', 'ملاحظة قديمة قبل الهجرة', 'system');
        `);

        await client.query(`
          INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "notarizationOffice", "poaType", "humanReviewStatus", "humanReviewedAt", "humanReviewedById", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ('poa-legacy-1', 'party-tz-test-1', '101/أ', '2026', 'مكتب توثيق الأهرام', 'GENERAL', 'VALID', '2026-11-18 10:00:00'::timestamp, 'system', 'system', 'system', '2026-11-18 10:00:00'::timestamp, '2026-11-18 10:00:00'::timestamp);
        `);

        // Set session TimeZone to zone4 and execute migration 4
        await client.query(`SET TIME ZONE '${zone4}'`);
        const mig4 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261117010000_party_temporal_types/migration.sql'), 'utf8');
        await client.query(mig4);

        // Insert new records created AFTER migration 4 with explicit UTC timestamptz
        await client.query(`
          INSERT INTO "communication_note" ("id", "partyId", "communicationAt", "channel", "summary", "createdById")
          VALUES ('note-new-1', 'party-tz-test-1', '2026-11-19T10:00:00Z'::timestamptz, 'PHONE', 'ملاحظة جديدة بعد الهجرة 4', 'system');
        `);

        await client.query(`
          INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "notarizationOffice", "poaType", "humanReviewStatus", "humanReviewedAt", "humanReviewedById", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ('poa-new-1', 'party-tz-test-1', '102/ب', '2026', 'مكتب توثيق الأهرام', 'GENERAL', 'VALID', '2026-11-19T10:00:00Z'::timestamptz, 'system', 'system', 'system', '2026-11-19T10:00:00Z'::timestamptz, '2026-11-19T10:00:00Z'::timestamptz);
        `);

        // Set session TimeZone to zone5 and execute migration 5
        await client.query(`SET TIME ZONE '${zone5}'`);
        const mig5 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261118020000_party_temporal_utc_semantics/migration.sql'), 'utf8');
        await client.query(mig5);

        // Verify exact UTC instant preservation across legacy and new records for communication note and POA:
        // Expected values are independently specified constants, not expressions.
        const partyRes = await client.query(`
          SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS val
          FROM "party"
          WHERE id = 'party-tz-test-1'
        `);
        expect(partyRes.rows[0].val).toBe('2026-11-18T10:00:00.000Z');

        const commLegacyRes = await client.query(`
          SELECT to_char("communicationAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS val
          FROM "communication_note"
          WHERE id = 'note-legacy-1'
        `);
        expect(commLegacyRes.rows[0].val).toBe('2026-11-18T10:00:00.000Z');

        const commNewRes = await client.query(`
          SELECT to_char("communicationAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS val
          FROM "communication_note"
          WHERE id = 'note-new-1'
        `);
        expect(commNewRes.rows[0].val).toBe('2026-11-19T10:00:00.000Z');

        const poaLegacyRes = await client.query(`
          SELECT to_char("humanReviewedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS val
          FROM "power_of_attorney"
          WHERE id = 'poa-legacy-1'
        `);
        expect(poaLegacyRes.rows[0].val).toBe('2026-11-18T10:00:00.000Z');

        const poaNewRes = await client.query(`
          SELECT to_char("humanReviewedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS val
          FROM "power_of_attorney"
          WHERE id = 'poa-new-1'
        `);
        expect(poaNewRes.rows[0].val).toBe('2026-11-19T10:00:00.000Z');
      } finally {
        client.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);

  it('applies additive migration 6 to clean up top-level duplicateWarnings from existing checkpoint 5 databases (R4-02)', async () => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      const client = await dedicated.pool.connect();
      try {
        const fs = await import('fs');
        const path = await import('path');

        // Apply migrations 1 through 5 (checkpoint 5 state)
        for (const n of [
          '20261111000000_init_auth',
          '20261114000000_credential_version',
          '20261117000000_parties_communication_poa',
          '20261117010000_party_temporal_types',
          '20261118020000_party_temporal_utc_semantics',
        ]) {
          await client.query(fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations', n, 'migration.sql'), 'utf8'));
        }

        // Seed a historical idempotency record containing top-level duplicateWarnings with personal data
        // (This simulates databases that completed migration 5 on the preceding candidate)
        await client.query(`
          INSERT INTO "idempotency_record" ("id", "actorId", "commandType", "key", "payloadHash", "status", "resultType", "resultId", "resultPayload", "createdAt")
          VALUES (
            'idemp-r4-02',
            'actor-r4-test',
            'saveParty',
            'key-duplicate-warnings-only',
            'hash-r4-123',
            'COMPLETED',
            'Party',
            'party-r4-1',
            '{"command": "saveParty", "partyId": "party-r4-1", "operationVersion": 1, "duplicateWarnings": [{"name": "طرف مكرر سري", "primaryPhone": "01099998888"}]}'::jsonb,
            '2026-11-18 10:00:00'::timestamp
          );
        `);

        // Apply additive migration 6
        const mig6 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261118150000_party_idempotency_privacy_cleanup/migration.sql'), 'utf8');
        await client.query(mig6);

        // Verify that personal data is stripped while operational identifiers remain intact
        const res = await client.query(`SELECT * FROM "idempotency_record" WHERE id = 'idemp-r4-02'`);
        expect(res.rows).toHaveLength(1);
        const row = res.rows[0];
        expect(row.actorId).toBe('actor-r4-test');
        expect(row.commandType).toBe('saveParty');
        expect(row.key).toBe('key-duplicate-warnings-only');
        expect(row.payloadHash).toBe('hash-r4-123');
        expect(row.status).toBe('COMPLETED');
        expect(row.resultType).toBe('Party');
        expect(row.resultId).toBe('party-r4-1');

        const payload = row.resultPayload;
        expect(payload.command).toBe('saveParty');
        expect(payload.partyId).toBe('party-r4-1');
        expect(payload.operationVersion).toBe(1);
        expect(payload.duplicateWarnings).toBeUndefined();
        expect(JSON.stringify(payload)).not.toContain('طرف مكرر سري');
        expect(JSON.stringify(payload)).not.toContain('01099998888');
      } finally {
        client.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);
});

