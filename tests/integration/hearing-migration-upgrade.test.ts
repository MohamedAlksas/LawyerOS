import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
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
    } finally {
      client.release();
    }
  });

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