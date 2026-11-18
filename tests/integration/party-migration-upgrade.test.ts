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

  it('preserves exact UTC instants when applying additive migration under non-UTC session (Africa/Cairo) and sanitizes historical idempotency snapshots (R2-06, Residual STD-01)', async () => {
    const dedicated = await createDedicatedTestDatabase();

    try {
      const client = await dedicated.pool.connect();
      try {
        const fs = await import('fs');
        const path = await import('path');

        // Apply migrations 1 through 4
        const mig1 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql'), 'utf8');
        await client.query(mig1);
        const mig2 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261114000000_credential_version/migration.sql'), 'utf8');
        await client.query(mig2);
        const mig3 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261117000000_parties_communication_poa/migration.sql'), 'utf8');
        await client.query(mig3);
        const mig4 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261117010000_party_temporal_types/migration.sql'), 'utf8');
        await client.query(mig4);

        // Populate test party with known instant
        await client.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "version", "createdById", "updatedById", "createdAt", "updatedAt")
          VALUES ('party-tz-test-1', 'PERSON', 'عميل اختبار التوقيت', 'عميل اختبار التوقيت', 1, 'system', 'system', '2026-11-18 10:00:00'::timestamp, '2026-11-18 10:00:00'::timestamp);
        `);

        // Populate historical idempotency record containing sensitive DTO snapshot
        await client.query(`
          INSERT INTO "idempotency_record" ("id", "actorId", "commandType", "key", "payloadHash", "status", "resultType", "resultId", "resultPayload", "createdAt")
          VALUES (
            gen_random_uuid()::text,
            'actor-hist-test',
            'saveParty',
            'key-historical-snapshot',
            'hash-historical-123',
            'COMPLETED',
            'Party',
            'party-tz-test-1',
            '{"party": {"id": "party-tz-test-1", "name": "عميل اختبار التوقيت", "address": "عنوان سكني سري للغاية", "notes": "ملاحظات قضائية سرية جداً", "version": 3}, "duplicateWarnings": []}'::jsonb,
            '2026-11-18 10:00:00'::timestamp
          );
        `);

        // Set non-UTC session TimeZone: Africa/Cairo (+02:00 in winter)
        await client.query("SET TIME ZONE 'Africa/Cairo'");

        // Execute the additive migration SQL under this non-UTC connection
        const mig5 = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations/20261118020000_party_temporal_utc_semantics/migration.sql'), 'utf8');
        await client.query(mig5);

        // 1. Verify exact UTC instant preservation: must remain 10:00:00 UTC (not shifted by Cairo +02:00)
        const partyTzRes = await client.query(`
          SELECT "createdAt" AS utc_created,
                 to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc_formatted
          FROM "party"
          WHERE id = 'party-tz-test-1'
        `);
        expect(partyTzRes.rows).toHaveLength(1);
        const isoCreated = new Date(partyTzRes.rows[0].utc_created).toISOString();
        expect(isoCreated).toBe('2026-11-18T10:00:00.000Z');
        expect(partyTzRes.rows[0].utc_formatted).toBe('2026-11-18T10:00:00.000Z');

        // 2. Verify historical idempotency snapshot sanitization (Residual STD-01)
        const idempRes = await client.query(`
          SELECT "resultPayload"
          FROM "idempotency_record"
          WHERE key = 'key-historical-snapshot'
        `);
        expect(idempRes.rows).toHaveLength(1);
        const stored = idempRes.rows[0].resultPayload;
        expect(stored.command).toBe('saveParty');
        expect(stored.partyId).toBe('party-tz-test-1');
        expect(stored.operationVersion).toBe(3);
        expect(stored.party).toBeUndefined();
        expect(stored.address).toBeUndefined();
        expect(stored.notes).toBeUndefined();
        expect(JSON.stringify(stored)).not.toContain('عنوان سكني سري للغاية');
        expect(JSON.stringify(stored)).not.toContain('ملاحظات قضائية سرية جداً');
      } finally {
        client.release();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);
});

