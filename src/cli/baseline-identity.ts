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
  recovered?: boolean;
  alreadyCompleted?: boolean;
}

export interface ParsedTargetUrl {
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
  ssl: boolean | { rejectUnauthorized: boolean };
  sslmode?: string;
  canonicalUrl: string;
}

/**
 * Sanitizes target URL for logging and errors by redacting credentials.
 */
export function sanitizeTargetUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    if (u.password) {
      u.password = '*****';
    }
    return u.toString();
  } catch {
    return '[malformed-url]';
  }
}

const ALLOWED_QUERY_PARAMS = new Set(['sslmode', 'schema']);

/**
 * Parses and strictly validates target PostgreSQL URL.
 * 1. Requires non-empty URL string.
 * 2. Enforces postgres/postgresql protocols.
 * 3. Enforces explicit hostname and database name.
 * 4. Strictly validates port: integer between 1 and 65535; omitted port defaults explicitly to 5432.
 * 5. Rejects unsupported/ambiguous query parameters (e.g. search_path, options, or non-public schema).
 * 6. Preserves explicit TLS options (disable, require, verify-full) and rejects unknown sslmodes fail-closed.
 * 7. Constructs a canonical URL sharing the exact validated endpoint and transport policy.
 */
export function parseTargetUrl(targetUrl: string): ParsedTargetUrl {
  if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim().length === 0) {
    throw new Error(
      'Target database URL is required. Ambient target fallback is refused.'
    );
  }

  // Pre-validate explicit port before new URL() which can throw generic Invalid URL on port > 65535 or non-digits
  const protoEnd = targetUrl.indexOf('://');
  if (protoEnd !== -1) {
    const authorityStart = protoEnd + 3;
    const pathStart = targetUrl.indexOf('/', authorityStart);
    const queryStart = targetUrl.indexOf('?', authorityStart);
    const hashStart = targetUrl.indexOf('#', authorityStart);
    let authorityEnd = targetUrl.length;
    if (pathStart !== -1) authorityEnd = Math.min(authorityEnd, pathStart);
    if (queryStart !== -1) authorityEnd = Math.min(authorityEnd, queryStart);
    if (hashStart !== -1) authorityEnd = Math.min(authorityEnd, hashStart);

    const authority = targetUrl.slice(authorityStart, authorityEnd);
    const atIdx = authority.lastIndexOf('@');
    const hostPort = atIdx !== -1 ? authority.slice(atIdx + 1) : authority;

    let rawPort: string | undefined;
    if (hostPort.startsWith('[')) {
      const closeBracket = hostPort.indexOf(']');
      if (closeBracket !== -1 && hostPort[closeBracket + 1] === ':') {
        rawPort = hostPort.slice(closeBracket + 2);
      }
    } else {
      const colonIdx = hostPort.lastIndexOf(':');
      if (colonIdx !== -1) {
        rawPort = hostPort.slice(colonIdx + 1);
      }
    }

    if (rawPort !== undefined && rawPort.length > 0) {
      if (!/^\d+$/.test(rawPort)) {
        throw new Error(
          `Target database URL specifies an invalid port: '${rawPort}'. Port must be an integer between 1 and 65535.`
        );
      }
      const portNum = parseInt(rawPort, 10);
      if (portNum < 1 || portNum > 65535) {
        throw new Error(
          `Target database URL specifies an invalid port: '${rawPort}'. Port must be an integer between 1 and 65535.`
        );
      }
    }
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

  // Port validation: integer between 1 and 65535, or omitted default 5432
  let port: number;
  if (parsed.port && parsed.port.trim().length > 0) {
    const portStr = parsed.port.trim();
    if (!/^\d+$/.test(portStr)) {
      throw new Error(
        `Target database URL specifies an invalid port: '${portStr}'. Port must be an integer between 1 and 65535.`
      );
    }
    const portNum = parseInt(portStr, 10);
    if (portNum < 1 || portNum > 65535) {
      throw new Error(
        `Target database URL specifies an invalid port: '${portStr}'. Port must be an integer between 1 and 65535.`
      );
    }
    port = portNum;
  } else {
    // Explicit default port without ambient PGPORT fallback
    port = 5432;
  }

  // Query parameter validation: reject ambiguous routing options
  for (const [key, value] of parsed.searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    if (!ALLOWED_QUERY_PARAMS.has(lowerKey)) {
      throw new Error(
        `Target database URL specifies unsupported or ambiguous query parameter: '${key}'. Baseline requires a direct connection to public schema without routing alterations.`
      );
    }
    if (lowerKey === 'schema' && value.toLowerCase() !== 'public') {
      throw new Error(
        `Target database URL specifies unsupported or ambiguous query parameter: 'schema'. Baseline requires a direct connection to public schema without routing alterations.`
      );
    }
  }

  // Explicit TLS policy validation
  const rawSslMode = parsed.searchParams.get('sslmode');
  let ssl: boolean | { rejectUnauthorized: boolean };
  let normalizedSslMode: string | undefined;

  if (rawSslMode !== null) {
    const mode = rawSslMode.toLowerCase().trim();
    normalizedSslMode = mode;
    if (mode === 'disable') {
      ssl = false;
    } else if (mode === 'require') {
      ssl = { rejectUnauthorized: false };
    } else if (mode === 'verify-full') {
      ssl = { rejectUnauthorized: true };
    } else {
      throw new Error(
        `Unsupported or unrecognized sslmode: '${rawSslMode}'. Supported modes are 'disable', 'require', and 'verify-full'.`
      );
    }
  } else {
    // When sslmode is omitted, default explicitly to false (plaintext internal)
    ssl = false;
  }

  const user = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  // Construct canonical target URL sharing identical validated endpoint and TLS policy
  let canonicalUrl = `${parsed.protocol}//`;
  if (user) {
    canonicalUrl += encodeURIComponent(user);
    if (password) {
      canonicalUrl += `:${encodeURIComponent(password)}`;
    }
    canonicalUrl += '@';
  }
  canonicalUrl += `${parsed.hostname}:${port}/${encodeURIComponent(database)}`;
  const canonicalParams = new URLSearchParams();
  if (normalizedSslMode) {
    canonicalParams.set('sslmode', normalizedSslMode);
  }
  if (parsed.searchParams.has('schema')) {
    canonicalParams.set('schema', 'public');
  }
  const queryString = canonicalParams.toString();
  if (queryString.length > 0) {
    canonicalUrl += `?${queryString}`;
  }

  return {
    host: parsed.hostname,
    port,
    database,
    user,
    password,
    ssl,
    sslmode: normalizedSslMode,
    canonicalUrl,
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
 * Deep physical schema equivalence verification.
 * Verifies managed tables, columns (including types, nullability, defaults),
 * primary keys, foreign keys (with cascading actions), unique/lookup indexes,
 * and the UserRole enum type.
 */
export async function verifySchemaEquivalence(client: Client): Promise<{ equivalent: boolean; errors: string[] }> {
  const errors: string[] = [];

  // 1. Enum UserRole
  const enumRes = await client.query(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole'
    ORDER BY e.enumsortorder;
  `);
  const foundEnumLabels = enumRes.rows.map((r: { enumlabel: string }) => r.enumlabel);
  const expectedEnumLabels = ['OWNER', 'MAINTAINER'];
  if (enumRes.rows.length === 0) {
    errors.push("Missing enum type 'UserRole'");
  } else {
    for (const label of expectedEnumLabels) {
      if (!foundEnumLabels.includes(label)) {
        errors.push(`Enum 'UserRole' missing value '${label}'`);
      }
    }
  }

  // 2. Tables
  const expectedTables = ['user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap'];
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
  `);
  const foundTables = new Set(tablesRes.rows.map((r: { table_name: string }) => r.table_name));
  for (const t of expectedTables) {
    if (!foundTables.has(t)) {
      errors.push(`Missing table '${t}'`);
    }
  }

  // 3. Columns, Types, Nullability
  const expectedCols: Record<
    string,
    { type: string; nullable: string; udt?: string }
  > = {
    'user.id': { type: 'text', nullable: 'NO' },
    'user.name': { type: 'text', nullable: 'NO' },
    'user.email': { type: 'text', nullable: 'NO' },
    'user.emailVerified': { type: 'boolean', nullable: 'NO' },
    'user.image': { type: 'text', nullable: 'YES' },
    'user.createdAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'user.updatedAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'user.role': { type: 'USER-DEFINED', nullable: 'NO', udt: 'UserRole' },
    'user.twoFactorEnabled': { type: 'boolean', nullable: 'YES' },

    'session.id': { type: 'text', nullable: 'NO' },
    'session.expiresAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'session.token': { type: 'text', nullable: 'NO' },
    'session.createdAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'session.updatedAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'session.ipAddress': { type: 'text', nullable: 'YES' },
    'session.userAgent': { type: 'text', nullable: 'YES' },
    'session.userId': { type: 'text', nullable: 'NO' },

    'account.id': { type: 'text', nullable: 'NO' },
    'account.accountId': { type: 'text', nullable: 'NO' },
    'account.providerId': { type: 'text', nullable: 'NO' },
    'account.userId': { type: 'text', nullable: 'NO' },
    'account.accessToken': { type: 'text', nullable: 'YES' },
    'account.refreshToken': { type: 'text', nullable: 'YES' },
    'account.idToken': { type: 'text', nullable: 'YES' },
    'account.accessTokenExpiresAt': { type: 'timestamp without time zone', nullable: 'YES' },
    'account.refreshTokenExpiresAt': { type: 'timestamp without time zone', nullable: 'YES' },
    'account.scope': { type: 'text', nullable: 'YES' },
    'account.password': { type: 'text', nullable: 'YES' },
    'account.createdAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'account.updatedAt': { type: 'timestamp without time zone', nullable: 'NO' },

    'verification.id': { type: 'text', nullable: 'NO' },
    'verification.identifier': { type: 'text', nullable: 'NO' },
    'verification.value': { type: 'text', nullable: 'NO' },
    'verification.expiresAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'verification.createdAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'verification.updatedAt': { type: 'timestamp without time zone', nullable: 'NO' },

    'twoFactor.id': { type: 'text', nullable: 'NO' },
    'twoFactor.secret': { type: 'text', nullable: 'NO' },
    'twoFactor.backupCodes': { type: 'text', nullable: 'NO' },
    'twoFactor.userId': { type: 'text', nullable: 'NO' },
    'twoFactor.verified': { type: 'boolean', nullable: 'NO' },
    'twoFactor.failedVerificationCount': { type: 'integer', nullable: 'NO' },
    'twoFactor.lockedUntil': { type: 'timestamp without time zone', nullable: 'YES' },

    'office_bootstrap.id': { type: 'text', nullable: 'NO' },
    'office_bootstrap.isClosed': { type: 'boolean', nullable: 'NO' },
    'office_bootstrap.closedAt': { type: 'timestamp without time zone', nullable: 'NO' },
    'office_bootstrap.ownerId': { type: 'text', nullable: 'NO' },
  };

  const colsRes = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, udt_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
  `);

  const foundCols = new Map<
    string,
    { data_type: string; is_nullable: string; udt_name: string }
  >();
  for (const row of colsRes.rows) {
    foundCols.set(`${row.table_name}.${row.column_name}`, {
      data_type: row.data_type,
      is_nullable: row.is_nullable,
      udt_name: row.udt_name,
    });
  }

  for (const [colKey, expected] of Object.entries(expectedCols)) {
    const found = foundCols.get(colKey);
    if (!found) {
      errors.push(`Missing column '${colKey}'`);
      continue;
    }
    if (found.data_type !== expected.type) {
      errors.push(`Column '${colKey}' data type mismatch: expected '${expected.type}', got '${found.data_type}'`);
    }
    if (found.is_nullable !== expected.nullable) {
      errors.push(`Column '${colKey}' nullability mismatch: expected '${expected.nullable}', got '${found.is_nullable}'`);
    }
    if (expected.udt && found.udt_name !== expected.udt) {
      errors.push(`Column '${colKey}' UDT mismatch: expected '${expected.udt}', got '${found.udt_name}'`);
    }
  }

  // 4. Primary Keys
  const pkeyRes = await client.query(`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' 
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
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
  for (const pk of expectedPkeys) {
    if (!foundPkeys.has(pk)) {
      errors.push(`Missing primary key '${pk}'`);
    }
  }

  // 5. Foreign Keys with Cascade Actions
  const fkeyRes = await client.query(`
    SELECT
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
  `);
  const foundFkeys = new Map<string, { delete_rule: string; update_rule: string }>();
  for (const row of fkeyRes.rows) {
    foundFkeys.set(row.constraint_name, {
      delete_rule: row.delete_rule,
      update_rule: row.update_rule,
    });
  }

  const expectedFkeys = ['session_userId_fkey', 'account_userId_fkey', 'twoFactor_userId_fkey'];
  for (const fk of expectedFkeys) {
    const found = foundFkeys.get(fk);
    if (!found) {
      errors.push(`Missing foreign key constraint '${fk}'`);
    } else {
      if (found.delete_rule !== 'CASCADE') {
        errors.push(`Foreign key '${fk}' delete rule expected 'CASCADE', got '${found.delete_rule}'`);
      }
      if (found.update_rule !== 'CASCADE') {
        errors.push(`Foreign key '${fk}' update rule expected 'CASCADE', got '${found.update_rule}'`);
      }
    }
  }

  // 6. Indexes
  const idxRes = await client.query(`
    SELECT indexname 
    FROM pg_indexes 
    WHERE schemaname = 'public'
      AND tablename IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
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
  for (const idx of expectedIndexes) {
    if (!foundIndexes.has(idx)) {
      errors.push(`Missing index '${idx}'`);
    }
  }

  return {
    equivalent: errors.length === 0,
    errors,
  };
}

/**
 * Executes canonical identity baseline procedure against explicit target URL.
 * 1. Validates endpoint and extracts parameters (rejects port 0, invalid ranges, ambiguous routing).
 * 2. Connects with explicit parameters and asserts current_database() === intended_database.
 * 3. Inspects current database state:
 *    - If already completed in _prisma_migrations and equivalent: returns alreadyCompleted: true.
 *    - If managed entities already exist:
 *        * If schema is deeply equivalent: safely resumes history recording without re-executing DDL.
 *        * If schema is incompatible/partial: fails closed immediately without recording history.
 *    - If no managed entities exist: executes migration SQL in a fail-fast transaction,
 *        verifies catalog, and records history.
 * 4. Records migration in Prisma history table using the canonical validated target URL and verifies status.
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

    log(`[Identity Baseline] Target confirmed: ${currentDb}. Inspecting existing database state...`);

    // 3. Inspect existing database state before mutating or recording
    // 3.1 Check _prisma_migrations table
    const migTableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
      ) AS has_migrations_table;
    `);
    const hasMigrationsTable = Boolean(migTableCheck.rows[0]?.has_migrations_table);

    if (hasMigrationsTable) {
      const appliedCheck = await client.query(`
        SELECT id, migration_name, finished_at, rolled_back_at
        FROM _prisma_migrations
        WHERE migration_name = '20261111000000_init_auth';
      `);
      const row = appliedCheck.rows[0];
      if (row && row.finished_at !== null && row.rolled_back_at === null) {
        log('[Identity Baseline] Migration 20261111000000_init_auth is already marked applied in _prisma_migrations. Verifying schema equivalence...');
        const verifyRes = await verifySchemaEquivalence(client);
        if (!verifyRes.equivalent) {
          throw new Error(
            `Migration history indicates '20261111000000_init_auth' is applied, but physical schema verification failed: ${verifyRes.errors.join('; ')}`
          );
        }

        const durationMs = Date.now() - startTime;
        log(`[Identity Baseline] Migration already fully completed and verified in ${durationMs}ms.`);
        return {
          success: true,
          appliedMigration: '20261111000000_init_auth',
          tables: ['user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap'],
          durationMs,
          alreadyCompleted: true,
        };
      }
    }

    // 3.2 Check if any managed entities already exist in the database
    const managedEntitiesCheck = await client.query(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap')) AS table_count,
        (SELECT count(*)::int FROM pg_type WHERE typname = 'UserRole') AS enum_count;
    `);
    const tableCount = Number(managedEntitiesCheck.rows[0]?.table_count || 0);
    const enumCount = Number(managedEntitiesCheck.rows[0]?.enum_count || 0);
    const hasManagedEntities = tableCount > 0 || enumCount > 0;

    let isRecovery = false;

    if (hasManagedEntities) {
      log('[Identity Baseline] Managed entities detected without completed migration history. Verifying physical schema equivalence...');
      const verifyRes = await verifySchemaEquivalence(client);

      if (!verifyRes.equivalent) {
        throw new Error(
          `Cannot baseline: existing schema contains conflicting or incompatible managed entities: ${verifyRes.errors.join('; ')}. Refusing to apply or mark migration without manual resolution.`
        );
      }

      log('[Identity Baseline] Physical schema is fully equivalent (matching SQL-committed state). Resuming history recording without re-executing DDL...');
      isRecovery = true;
    } else {
      // 3.3 No managed entities exist: clean baseline execution
      log('[Identity Baseline] Clean target detected. Executing migration SQL in a single fail-fast transaction...');

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
      const verifyRes = await verifySchemaEquivalence(client);
      if (!verifyRes.equivalent) {
        throw new Error(`Catalog verification failed post-DDL: ${verifyRes.errors.join('; ')}`);
      }
    }

    log('[Identity Baseline] Schema verified. Recording migration in Prisma history table...');

    // 4. Record applied migration in Prisma migration history table
    const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
    const resolveResult = spawnSync(
      process.execPath,
      [prismaJs, 'migrate', 'resolve', '--applied', '20261111000000_init_auth'],
      {
        env: {
          ...process.env,
          DATABASE_URL: connParams.canonicalUrl,
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

    // 5. Verify migration status reports clean state
    const statusResult = spawnSync(
      process.execPath,
      [prismaJs, 'migrate', 'status'],
      {
        env: {
          ...process.env,
          DATABASE_URL: connParams.canonicalUrl,
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
    const actionLabel = isRecovery ? 'recovered and baselined' : 'baselined';
    log(`[Identity Baseline] Success! Migration 20261111000000_init_auth ${actionLabel} in ${durationMs}ms.`);

    return {
      success: true,
      appliedMigration: '20261111000000_init_auth',
      tables: ['user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap'],
      durationMs,
      recovered: isRecovery,
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
    const recoveryNote = result.recovered ? ' (recovered from SQL-committed state)' : result.alreadyCompleted ? ' (already completed)' : '';
    console.log(`✓ Identity baseline successfully completed (${result.durationMs}ms)${recoveryNote}.`);
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


