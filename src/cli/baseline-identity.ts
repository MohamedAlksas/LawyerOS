import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export interface BaselineOptions {
  targetUrl: string;
  migrationSqlPath?: string;
  silent?: boolean;
}

export interface BaselineResult {
  success: boolean;
  appliedMigration: string;
  tables: string[];
  durationMs: number;
}

/**
 * Parses and strictly validates target PostgreSQL URL.
 * Extracts individual connection parameters to prevent ambient driver fallback.
 */
export function parseTargetUrl(targetUrl: string): {
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
  ssl?: boolean;
} {
  if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim().length === 0) {
    throw new Error(
      'Target database URL is required. Ambient target fallback is refused.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch (err) {
    throw new Error(
      `Invalid target database URL: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `Invalid database protocol '${parsed.protocol}'. Expected postgres: or postgresql:`
    );
  }

  if (!parsed.hostname || parsed.hostname.trim().length === 0) {
    throw new Error('Target database URL must specify an explicit hostname.');
  }

  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!database || database.trim().length === 0) {
    throw new Error('Target database URL must specify an explicit database name in path.');
  }

  const port = parsed.port && parsed.port.trim().length > 0 ? parseInt(parsed.port, 10) : 5432;
  const user = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const ssl = parsed.searchParams.get('sslmode') === 'disable' ? false : undefined;

  return {
    host: parsed.hostname,
    port,
    database,
    user,
    password,
    ssl,
  };
}

/**
 * Parses CLI command line arguments.
 * Supports:
 *   --target-url <url>
 *   --target-url=<url>
 *   <url> (positional)
 */
export function parseCliArgs(args: string[]): { targetUrl?: string } {
  let targetUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target-url') {
      targetUrl = args[i + 1];
      i++;
    } else if (arg.startsWith('--target-url=')) {
      targetUrl = arg.slice('--target-url='.length);
    } else if (!arg.startsWith('-') && !targetUrl) {
      targetUrl = arg;
    }
  }

  return { targetUrl };
}

/**
 * Executes canonical identity baseline procedure against explicit target URL.
 * 1. Connects with explicit parameters (preventing ambient PG* redirection).
 * 2. Asserts current_database() === intended_database.
 * 3. Executes migration SQL in a single fail-fast transaction.
 * 4. Deeply verifies schema tables, columns, constraints, and indexes in PostgreSQL BEFORE history.
 * 5. Records migration as applied in Prisma history and verifies status.
 */
export async function runIdentityBaseline(options: BaselineOptions): Promise<BaselineResult> {
  const startTime = Date.now();
  const connParams = parseTargetUrl(options.targetUrl);

  const log = (msg: string) => {
    if (!options.silent) {
      console.log(msg);
    }
  };

  log(`[Identity Baseline] Initializing baseline on target: ${connParams.host}:${connParams.port}/${connParams.database}`);

  // 1. Connect with explicit connection parameters
  const client = new Client({
    host: connParams.host,
    port: connParams.port,
    database: connParams.database,
    user: connParams.user,
    password: connParams.password,
    ssl: connParams.ssl,
  });

  await client.connect();

  try {
    // 2. Assert connected database strictly matches intended target database
    const dbCheckRes = await client.query('SELECT current_database() AS current_db');
    const currentDb = dbCheckRes.rows[0]?.current_db;
    if (currentDb !== connParams.database) {
      throw new Error(
        `Connected database '${currentDb}' does not match intended target database '${connParams.database}'. Ambient redirection detected. Aborting baseline.`
      );
    }

    log(`[Identity Baseline] Target confirmed: ${currentDb}. Executing migration SQL in single transaction...`);

    // 3. Fail-fast single-transaction SQL execution
    const migrationPath =
      options.migrationSqlPath ||
      path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Baseline migration SQL script not found at: ${migrationPath}`);
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

    await client.query('BEGIN');
    try {
      await client.query(migrationSql);
      await client.query('COMMIT');
    } catch (sqlErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(
        `Baseline migration SQL execution failed in transaction: ${
          sqlErr instanceof Error ? sqlErr.message : String(sqlErr)
        }`
      );
    }

    log('[Identity Baseline] Migration SQL applied. Verifying PostgreSQL catalog before recording history...');

    // 4. Deep schema verification before recording migration history
    // 4.1 Tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
    `);
    const foundTables = tablesRes.rows.map((r: { table_name: string }) => r.table_name);
    const expectedTables = ['user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap'];
    const missingTables = expectedTables.filter((t) => !foundTables.includes(t));
    if (missingTables.length > 0) {
      throw new Error(`Catalog verification failed: missing table(s): ${missingTables.join(', ')}`);
    }

    // 4.2 Columns
    const colsRes = await client.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
    `);
    const foundCols = new Set(
      colsRes.rows.map((r: { table_name: string; column_name: string }) => `${r.table_name}.${r.column_name}`)
    );
    const expectedCols = [
      'user.id', 'user.name', 'user.email', 'user.emailVerified', 'user.image', 'user.createdAt', 'user.updatedAt', 'user.role', 'user.twoFactorEnabled',
      'session.id', 'session.expiresAt', 'session.token', 'session.createdAt', 'session.updatedAt', 'session.ipAddress', 'session.userAgent', 'session.userId',
      'account.id', 'account.accountId', 'account.providerId', 'account.userId', 'account.accessToken', 'account.refreshToken', 'account.idToken', 'account.accessTokenExpiresAt', 'account.refreshTokenExpiresAt', 'account.scope', 'account.password', 'account.createdAt', 'account.updatedAt',
      'verification.id', 'verification.identifier', 'verification.value', 'verification.expiresAt', 'verification.createdAt', 'verification.updatedAt',
      'twoFactor.id', 'twoFactor.secret', 'twoFactor.backupCodes', 'twoFactor.userId', 'twoFactor.verified', 'twoFactor.failedVerificationCount', 'twoFactor.lockedUntil',
      'office_bootstrap.id', 'office_bootstrap.isClosed', 'office_bootstrap.closedAt', 'office_bootstrap.ownerId',
    ];
    const missingCols = expectedCols.filter((c) => !foundCols.has(c));
    if (missingCols.length > 0) {
      throw new Error(`Catalog verification failed: missing column(s): ${missingCols.join(', ')}`);
    }

    // 4.3 Primary Keys
    const pkeyRes = await client.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE constraint_type = 'PRIMARY KEY' AND table_schema = 'public';
    `);
    const foundPkeys = new Set(pkeyRes.rows.map((r: { constraint_name: string }) => r.constraint_name));
    const expectedPkeys = [
      'user_pkey',
      'session_pkey',
      'account_pkey',
      'verification_pkey',
      'twoFactor_pkey',
      'office_bootstrap_pkey',
    ];
    const missingPkeys = expectedPkeys.filter((pk) => !foundPkeys.has(pk));
    if (missingPkeys.length > 0) {
      throw new Error(`Catalog verification failed: missing primary key(s): ${missingPkeys.join(', ')}`);
    }

    // 4.4 Foreign Keys
    const fkeyRes = await client.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';
    `);
    const foundFkeys = new Set(fkeyRes.rows.map((r: { constraint_name: string }) => r.constraint_name));
    const expectedFkeys = [
      'session_userId_fkey',
      'account_userId_fkey',
      'twoFactor_userId_fkey',
    ];
    const missingFkeys = expectedFkeys.filter((fk) => !foundFkeys.has(fk));
    if (missingFkeys.length > 0) {
      throw new Error(`Catalog verification failed: missing foreign key(s): ${missingFkeys.join(', ')}`);
    }

    // 4.5 Indexes
    const idxRes = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public';
    `);
    const foundIndexes = new Set(idxRes.rows.map((r: { indexname: string }) => r.indexname));
    const expectedIndexes = [
      'user_email_key',
      'session_token_key',
      'session_userId_idx',
      'account_userId_idx',
      'verification_identifier_idx',
      'twoFactor_userId_idx',
    ];
    const missingIndexes = expectedIndexes.filter((idx) => !foundIndexes.has(idx));
    if (missingIndexes.length > 0) {
      throw new Error(`Catalog verification failed: missing index(es): ${missingIndexes.join(', ')}`);
    }

    // 4.6 Enum UserRole
    const enumRes = await client.query(`
      SELECT typname FROM pg_type WHERE typname = 'UserRole';
    `);
    if (enumRes.rows.length === 0) {
      throw new Error("Catalog verification failed: missing enum type 'UserRole'");
    }

    log('[Identity Baseline] Catalog verification passed. Recording migration in Prisma history table...');

    // 5. Record applied migration in Prisma migration history table
    const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
    const resolveResult = spawnSync(
      process.execPath,
      [prismaJs, 'migrate', 'resolve', '--applied', '20261111000000_init_auth'],
      {
        env: {
          ...process.env,
          DATABASE_URL: options.targetUrl,
        },
        encoding: 'utf-8',
      }
    );

    if (resolveResult.status !== 0) {
      throw new Error(
        `Prisma migrate resolve failed (status ${resolveResult.status}): ${
          resolveResult.stderr || resolveResult.stdout || 'Unknown error'
        }`
      );
    }

    // 6. Verify migration status reports clean state
    const statusResult = spawnSync(
      process.execPath,
      [prismaJs, 'migrate', 'status'],
      {
        env: {
          ...process.env,
          DATABASE_URL: options.targetUrl,
        },
        encoding: 'utf-8',
      }
    );

    if (statusResult.status !== 0) {
      throw new Error(
        `Prisma migrate status failed (status ${statusResult.status}): ${
          statusResult.stderr || statusResult.stdout || 'Unknown error'
        }`
      );
    }

    const durationMs = Date.now() - startTime;
    log(`[Identity Baseline] Success! Migration 20261111000000_init_auth baselined in ${durationMs}ms.`);

    return {
      success: true,
      appliedMigration: '20261111000000_init_auth',
      tables: expectedTables,
      durationMs,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const { targetUrl } = parseCliArgs(process.argv.slice(2));

  if (!targetUrl || targetUrl.trim().length === 0) {
    console.error(
      'Error: Missing required argument: --target-url <database_url>.\nAn explicit target URL is strictly required via --target-url <url> or positional argument.\nAmbient defaults are refused.\n\nUsage: npx tsx src/cli/baseline-identity.ts --target-url "$env:DATABASE_URL"'
    );
    process.exit(1);
  }

  try {
    const result = await runIdentityBaseline({ targetUrl });
    console.log(`✓ Identity baseline successfully completed (${result.durationMs}ms).`);
    process.exit(0);
  } catch (err) {
    console.error(`\n[Identity Baseline Error]: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (require.main === module || process.argv[1]?.includes('baseline-identity')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

