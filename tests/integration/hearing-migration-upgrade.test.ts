import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'child_process';
import { createDedicatedTestDatabase } from '../helpers/test-db';
import { setupTestEncryptionKeys } from '../helpers/party-test-helper';

function runPrismaMigrateDeploy(dbUrl: string, schema?: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])], {
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

/**
 * T08 Integration Tests: Hearing, Task, and Outbox Migration & Schema Upgrade Verification
 */
describe('T08 Integration Tests: Migration & Schema Upgrade Verification', () => {
  let dbUrl: string;
  let pool: Pool;
  let dropDb: () => Promise<void>;

  beforeAll(async () => {
    setupTestEncryptionKeys();
    const dedicated = await createDedicatedTestDatabase();
    dbUrl = dedicated.url;
    pool = dedicated.pool;
    dropDb = dedicated.drop;

    // Run full migration suite on fresh database
    runPrismaMigrateDeploy(dbUrl);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end().catch(() => {});
    }
    if (dropDb) {
      await dropDb().catch(() => {});
    }
  });

  it('verifies hearing table exists with date-only hearing_date and proper constraints', async () => {
    const client = await pool.connect();
    try {
      // Check hearing table columns
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'hearing'
        ORDER BY column_name;
      `);
      expect(colsRes.rows.length).toBeGreaterThan(0);

      const colMap = new Map(colsRes.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]));
      expect(colMap.get('id')).toBe('text');
      expect(colMap.get('proceeding_id')).toBe('text');
      expect(colMap.get('hearing_date')).toBe('date'); // Must be date-only, not timestamptz!
      expect(colMap.get('status')).toBe('USER-DEFINED'); // Enum HearingStatus
      expect(colMap.get('version')).toBe('integer');

      // Check foreign keys on hearing
      const fkRes = await client.query(`
        SELECT
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'hearing';
      `);
      const proceedingFk = fkRes.rows.find((r: { column_name: string }) => r.column_name === 'proceeding_id');
      expect(proceedingFk).toBeDefined();
      expect(proceedingFk.foreign_table_name).toBe('proceeding');
    } finally {
      client.release();
    }
  });

  it('verifies hearing_result table exists with revision and supersedes_result_id', async () => {
    const client = await pool.connect();
    try {
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'hearing_result'
        ORDER BY column_name;
      `);
      expect(colsRes.rows.length).toBeGreaterThan(0);

      const colMap = new Map(colsRes.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]));
      expect(colMap.get('id')).toBe('text');
      expect(colMap.get('hearing_id')).toBe('text');
      expect(colMap.get('decision_text')).toBe('text');
      expect(colMap.get('revision')).toBe('integer');
      expect(colMap.get('recorded_at')).toMatch(/timestamp/);
      const index = await client.query(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'hearing_result' AND indexdef ILIKE '%UNIQUE%(hearing_id, revision)%'",
      );
      expect(index.rowCount).toBe(1);
    } finally {
      client.release();
    }
  });

  it('preserves populated T07 Matter, Party and Proceeding records when applying T08', async () => {
    const baseline = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-t07-baseline-'));
    const dedicated = await createDedicatedTestDatabase();
    try {
      const schema = path.join(baseline, 'schema.prisma');
      const migrations = path.join(baseline, 'migrations');
      fs.mkdirSync(migrations);
      fs.copyFileSync(path.resolve('prisma/schema.prisma'), schema);
      for (const name of fs.readdirSync(path.resolve('prisma/migrations'))) {
        if (name === 'migration_lock.toml' || name < '20261122020000') {
          fs.cpSync(path.resolve('prisma/migrations', name), path.join(migrations, name), { recursive: true });
        }
      }
      runPrismaMigrateDeploy(dedicated.url, schema);
      expect((await dedicated.pool.query("SELECT to_regclass('public.hearing') AS table_name")).rows[0].table_name).toBeNull();
      await dedicated.pool.query(`
        INSERT INTO "court" ("id", "name", "createdById", "updatedById", "updatedAt")
        VALUES ('baseline-court', 'محكمة الترقية', 'fixture', 'fixture', now());
        INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "createdById", "updatedById", "updatedAt")
        VALUES ('baseline-party', 'PERSON', 'موكل الترقية', 'موكل الترقيه', 'fixture', 'fixture', now());
        INSERT INTO "matter" ("id", "fileCode", "title", "titleNormalized", "kind", "status", "notes", "createdById", "updatedById", "updatedAt")
        VALUES ('baseline-matter', 'LO-2026-0183', 'ملف الترقية', 'ملف الترقيه', 'LITIGATION', 'ACTIVE', 'ملاحظة قبل الترقية', 'fixture', 'fixture', now());
        INSERT INTO "matter_party" ("id", "matterId", "partyId", "role", "createdById", "updatedById", "updatedAt")
        VALUES ('baseline-link', 'baseline-matter', 'baseline-party', 'CLIENT', 'fixture', 'fixture', now());
        INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "createdById", "updatedById", "updatedAt")
        VALUES ('baseline-proceeding', 'baseline-matter', 'baseline-court', 'FIRST_INSTANCE', '999', '2026', 'مدني', 'ACTIVE', 'fixture', 'fixture', now());
      `);
      const snapshot = () => dedicated.pool.query(`
        SELECT m.title, m.notes, m.version, p.name, r."numberText", r.version AS proceeding_version
        FROM "matter" m
        JOIN "matter_party" mp ON mp."matterId" = m.id
        JOIN "party" p ON p.id = mp."partyId"
        JOIN "proceeding" r ON r."matterId" = m.id
        WHERE m.id = 'baseline-matter'
      `);
      const before = (await snapshot()).rows;
      expect(before).toHaveLength(1);
      const initialT08 = '20261122020000_t08_hearings_results_tasks_jobs';
      fs.cpSync(path.resolve('prisma/migrations', initialT08), path.join(migrations, initialT08), { recursive: true });
      runPrismaMigrateDeploy(dedicated.url, schema);
      const formerReceipt = {
        resultId: 'legacy-result',
        result: { decisionText: 'مضمون سري' },
        hearing: { id: 'legacy-hearing', version: 2, status: 'COMPLETED', updatedAt: '2026-11-22T09:00:00.000Z' },
        nextHearing: null,
        tasks: [{ id: 'legacy-task', title: 'عنوان مهمة سري', status: 'OPEN', version: 1 }],
      };
      await dedicated.pool.query(`
        INSERT INTO "idempotency_record" ("id", "actorId", "commandType", "key", "payloadHash", "status", "resultType", "resultId", "resultPayload")
        VALUES ('legacy-receipt', 'fixture', 'recordHearingResult', 'legacy-key', 'fixture', 'COMPLETED', 'HearingResult', 'legacy-result', $1)
      `, [formerReceipt]);
      runPrismaMigrateDeploy(dedicated.url);
      expect((await snapshot()).rows).toEqual(before);
      const receipt = (await dedicated.pool.query('SELECT "resultPayload" FROM "idempotency_record" WHERE "id" = $1', ['legacy-receipt'])).rows[0].resultPayload;
      expect(receipt).toMatchObject({ resultId: 'legacy-result', hearing: formerReceipt.hearing, next: null, tasks: [{ id: 'legacy-task' }] });
      expect(JSON.stringify(receipt)).not.toContain('سري');
      const hearing = await dedicated.pool.query(`
        INSERT INTO "hearing" ("id", "proceeding_id", "hearing_date", "created_by_id", "updated_by_id", "updated_at")
        VALUES ('upgraded-hearing', 'baseline-proceeding', '2027-04-30', 'fixture', 'fixture', now())
        RETURNING "hearing_date"::text AS date
      `);
      expect(hearing.rows[0].date).toBe('2027-04-30');
    } finally {
      await dedicated.pool.end();
      await dedicated.drop();
      fs.rmSync(baseline, { recursive: true, force: true });
    }
  }, 60_000);

  it('verifies hearing_link table exists with relation enum', async () => {
    const client = await pool.connect();
    try {
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'hearing_link';
      `);
      expect(colsRes.rows.length).toBeGreaterThan(0);
      const colMap = new Map(colsRes.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]));
      expect(colMap.get('from_hearing_id')).toBe('text');
      expect(colMap.get('to_hearing_id')).toBe('text');
      expect(colMap.get('relation')).toBe('USER-DEFINED');
    } finally {
      client.release();
    }
  });

  it('verifies task table exists with date-only due_date and matter/proceeding links', async () => {
    const client = await pool.connect();
    try {
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'task';
      `);
      expect(colsRes.rows.length).toBeGreaterThan(0);
      const colMap = new Map(colsRes.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]));
      expect(colMap.get('title')).toBe('text');
      expect(colMap.get('due_date')).toBe('date');
      expect(colMap.get('status')).toBe('USER-DEFINED');
      expect(colMap.get('priority')).toBe('USER-DEFINED');
      expect(colMap.get('matter_id')).toBe('text');
      expect(colMap.get('proceeding_id')).toBe('text');
      expect(colMap.get('hearing_id')).toBe('text');
    } finally {
      client.release();
    }
  });

  it('verifies job_run outbox table exists with unique deduplication_key', async () => {
    const client = await pool.connect();
    try {
      const colsRes = await client.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'job_run';
      `);
      expect(colsRes.rows.length).toBeGreaterThan(0);

      // Check unique constraint on deduplication_key
      const idxRes = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'job_run' AND indexdef LIKE '%deduplication_key%';
      `);
      expect(idxRes.rows.length).toBeGreaterThan(0);
      expect(idxRes.rows[0].indexdef).toContain('UNIQUE');
    } finally {
      client.release();
    }
  });
});
