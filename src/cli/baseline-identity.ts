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

  // Query parameter validation: reject ambiguous routing options and duplicate parameters
  const paramCounts = new Map<string, number>();
  const normalizedParams = new Map<string, string>();

  for (const [key, value] of parsed.searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    const count = (paramCounts.get(lowerKey) || 0) + 1;
    paramCounts.set(lowerKey, count);

    if (count > 1) {
      throw new Error(
        `Target database URL specifies duplicate or contradictory connection parameter: '${lowerKey}'.`
      );
    }

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

    normalizedParams.set(lowerKey, value);
  }

  // Explicit TLS policy validation (case-insensitive key and value matching)
  const rawSslMode = normalizedParams.get('sslmode');
  let ssl: boolean | { rejectUnauthorized: boolean };
  let normalizedSslMode: string | undefined;

  if (rawSslMode !== undefined) {
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
  if (normalizedParams.has('schema')) {
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

  // 1. Enum UserRole (verified in public namespace with exact value set)
  const enumRes = await client.query(`
    SELECT
      n.nspname AS schemaname,
      t.typname,
      e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'UserRole'
      AND n.nspname = 'public'
    ORDER BY e.enumsortorder;
  `);
  const foundEnumLabels = enumRes.rows.map((r: { enumlabel: string }) => r.enumlabel);
  const expectedEnumLabels = ['OWNER', 'MAINTAINER'];
  if (enumRes.rows.length === 0) {
    errors.push("Missing enum type 'UserRole' in schema 'public'");
  } else {
    for (const label of expectedEnumLabels) {
      if (!foundEnumLabels.includes(label)) {
        errors.push(`Enum 'UserRole' missing value '${label}'`);
      }
    }
    for (const label of foundEnumLabels) {
      if (!expectedEnumLabels.includes(label)) {
        errors.push(`Enum 'UserRole' contains unexpected value '${label}'`);
      }
    }
  }

  // 2. Tables (all 6 managed tables in public schema)
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

  // 3. Columns, Types, Nullability, Precision, and Defaults
  const isStrictCurrentTimestamp = (val: string | null) =>
    val !== null && /^(CURRENT_TIMESTAMP|now\(\))$/i.test(val.trim());
  const isStrictFalse = (val: string | null) =>
    val !== null && /^false$/i.test(val.trim());
  const isStrictTrue = (val: string | null) =>
    val !== null && /^true$/i.test(val.trim());
  const isStrictZero = (val: string | null) =>
    val !== null && /^0$/.test(val.trim());
  const isStrictSingleton = (val: string | null) =>
    val !== null && /^'singleton'(::text)?$/i.test(val.trim());
  const isStrictOwnerEnum = (val: string | null) =>
    val !== null && /^'OWNER'::"?UserRole"?$/i.test(val.trim());

  interface ExpectedColDef {
    type: string;
    nullable: string;
    udt?: string;
    datetimePrecision?: number;
    hasDefault: boolean;
    defaultValidator?: (defaultVal: string | null) => boolean;
    expectedDefaultDesc?: string;
  }

  const expectedCols: Record<string, ExpectedColDef> = {
    'user.id': { type: 'text', nullable: 'NO', hasDefault: false },
    'user.name': { type: 'text', nullable: 'NO', hasDefault: false },
    'user.email': { type: 'text', nullable: 'NO', hasDefault: false },
    'user.emailVerified': { type: 'boolean', nullable: 'NO', hasDefault: true, defaultValidator: isStrictFalse, expectedDefaultDesc: 'false' },
    'user.image': { type: 'text', nullable: 'YES', hasDefault: false },
    'user.createdAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'user.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: false },
    'user.role': { type: 'USER-DEFINED', nullable: 'NO', udt: 'UserRole', hasDefault: true, defaultValidator: isStrictOwnerEnum, expectedDefaultDesc: "'OWNER'::\"UserRole\"" },
    'user.twoFactorEnabled': { type: 'boolean', nullable: 'YES', hasDefault: true, defaultValidator: isStrictFalse, expectedDefaultDesc: 'false' },

    'session.id': { type: 'text', nullable: 'NO', hasDefault: false },
    'session.expiresAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: false },
    'session.token': { type: 'text', nullable: 'NO', hasDefault: false },
    'session.createdAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'session.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: false },
    'session.ipAddress': { type: 'text', nullable: 'YES', hasDefault: false },
    'session.userAgent': { type: 'text', nullable: 'YES', hasDefault: false },
    'session.userId': { type: 'text', nullable: 'NO', hasDefault: false },

    'account.id': { type: 'text', nullable: 'NO', hasDefault: false },
    'account.accountId': { type: 'text', nullable: 'NO', hasDefault: false },
    'account.providerId': { type: 'text', nullable: 'NO', hasDefault: false },
    'account.userId': { type: 'text', nullable: 'NO', hasDefault: false },
    'account.accessToken': { type: 'text', nullable: 'YES', hasDefault: false },
    'account.refreshToken': { type: 'text', nullable: 'YES', hasDefault: false },
    'account.idToken': { type: 'text', nullable: 'YES', hasDefault: false },
    'account.accessTokenExpiresAt': { type: 'timestamp without time zone', nullable: 'YES', datetimePrecision: 3, hasDefault: false },
    'account.refreshTokenExpiresAt': { type: 'timestamp without time zone', nullable: 'YES', datetimePrecision: 3, hasDefault: false },
    'account.scope': { type: 'text', nullable: 'YES', hasDefault: false },
    'account.password': { type: 'text', nullable: 'YES', hasDefault: false },
    'account.createdAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'account.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: false },

    'verification.id': { type: 'text', nullable: 'NO', hasDefault: false },
    'verification.identifier': { type: 'text', nullable: 'NO', hasDefault: false },
    'verification.value': { type: 'text', nullable: 'NO', hasDefault: false },
    'verification.expiresAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: false },
    'verification.createdAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'verification.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: false },

    'twoFactor.id': { type: 'text', nullable: 'NO', hasDefault: false },
    'twoFactor.secret': { type: 'text', nullable: 'NO', hasDefault: false },
    'twoFactor.backupCodes': { type: 'text', nullable: 'NO', hasDefault: false },
    'twoFactor.userId': { type: 'text', nullable: 'NO', hasDefault: false },
    'twoFactor.verified': { type: 'boolean', nullable: 'NO', hasDefault: true, defaultValidator: isStrictTrue, expectedDefaultDesc: 'true' },
    'twoFactor.failedVerificationCount': { type: 'integer', nullable: 'NO', hasDefault: true, defaultValidator: isStrictZero, expectedDefaultDesc: '0' },
    'twoFactor.lockedUntil': { type: 'timestamp without time zone', nullable: 'YES', datetimePrecision: 3, hasDefault: false },

    'office_bootstrap.id': { type: 'text', nullable: 'NO', hasDefault: true, defaultValidator: isStrictSingleton, expectedDefaultDesc: "'singleton'::text" },
    'office_bootstrap.isClosed': { type: 'boolean', nullable: 'NO', hasDefault: true, defaultValidator: isStrictTrue, expectedDefaultDesc: 'true' },
    'office_bootstrap.closedAt': { type: 'timestamp without time zone', nullable: 'NO', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'office_bootstrap.ownerId': { type: 'text', nullable: 'NO', hasDefault: false },
  };

  const colsRes = await client.query(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default,
      datetime_precision,
      udt_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
  `);

  const foundCols = new Map<
    string,
    {
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      datetime_precision: number | null;
      udt_name: string;
    }
  >();
  for (const row of colsRes.rows) {
    foundCols.set(`${row.table_name}.${row.column_name}`, {
      data_type: row.data_type,
      is_nullable: row.is_nullable,
      column_default: row.column_default !== undefined ? row.column_default : null,
      datetime_precision:
        row.datetime_precision !== undefined && row.datetime_precision !== null
          ? Number(row.datetime_precision)
          : null,
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
    if (expected.datetimePrecision !== undefined) {
      if (found.datetime_precision !== expected.datetimePrecision) {
        errors.push(
          `Column '${colKey}' datetime precision mismatch: expected ${expected.datetimePrecision}, got ${
            found.datetime_precision !== null ? found.datetime_precision : 'null'
          }`
        );
      }
    }
    if (expected.hasDefault) {
      if (found.column_default === null) {
        errors.push(`Column '${colKey}' missing expected default '${expected.expectedDefaultDesc}'`);
      } else if (expected.defaultValidator && !expected.defaultValidator(found.column_default)) {
        errors.push(`Column '${colKey}' default mismatch: expected '${expected.expectedDefaultDesc}', got '${found.column_default}'`);
      }
    } else {
      if (found.column_default !== null) {
        errors.push(`Column '${colKey}' unexpected default: expected no default, got '${found.column_default}'`);
      }
    }
  }

  for (const [colKey] of foundCols) {
    if (!expectedCols[colKey]) {
      errors.push(`Table column '${colKey}' is not part of the managed baseline schema`);
    }
  }

  // 4. Primary Keys: verify constraint names, tables, and exact key columns
  const pkeyRes = await client.query(`
    SELECT
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' 
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap')
    ORDER BY tc.table_name, kcu.ordinal_position;
  `);

  const foundPkeys = new Map<string, { table: string; columns: string[] }>();
  for (const row of pkeyRes.rows) {
    let entry = foundPkeys.get(row.constraint_name);
    if (!entry) {
      entry = { table: row.table_name, columns: [] };
      foundPkeys.set(row.constraint_name, entry);
    }
    entry.columns.push(row.column_name);
  }

  const expectedPkeys: Record<string, { table: string; columns: string[] }> = {
    user_pkey: { table: 'user', columns: ['id'] },
    session_pkey: { table: 'session', columns: ['id'] },
    account_pkey: { table: 'account', columns: ['id'] },
    verification_pkey: { table: 'verification', columns: ['id'] },
    twoFactor_pkey: { table: 'twoFactor', columns: ['id'] },
    office_bootstrap_pkey: { table: 'office_bootstrap', columns: ['id'] },
  };

  for (const [pkName, expected] of Object.entries(expectedPkeys)) {
    const found = foundPkeys.get(pkName);
    if (!found) {
      errors.push(`Missing primary key constraint '${pkName}'`);
      continue;
    }
    if (found.table !== expected.table) {
      errors.push(`Primary key '${pkName}' attached to table '${found.table}', expected '${expected.table}'`);
    }
    if (found.columns.join(',') !== expected.columns.join(',')) {
      errors.push(
        `Primary key '${pkName}' columns mismatch: expected [${expected.columns.join(', ')}], got [${found.columns.join(', ')}]`
      );
    }
  }

  // 5. Foreign Keys with source/target definitions and cascading actions
  const fkeyRes = await client.query(`
    SELECT
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
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

  const foundFkeys = new Map<
    string,
    {
      table: string;
      column: string;
      foreignSchema: string;
      foreignTable: string;
      foreignColumn: string;
      deleteRule: string;
      updateRule: string;
    }
  >();
  for (const row of fkeyRes.rows) {
    foundFkeys.set(row.constraint_name, {
      table: row.table_name,
      column: row.column_name,
      foreignSchema: row.foreign_table_schema,
      foreignTable: row.foreign_table_name,
      foreignColumn: row.foreign_column_name,
      deleteRule: row.delete_rule,
      updateRule: row.update_rule,
    });
  }

  const expectedFkeys: Record<
    string,
    {
      table: string;
      column: string;
      foreignSchema: string;
      foreignTable: string;
      foreignColumn: string;
      deleteRule: string;
      updateRule: string;
    }
  > = {
    session_userId_fkey: {
      table: 'session',
      column: 'userId',
      foreignSchema: 'public',
      foreignTable: 'user',
      foreignColumn: 'id',
      deleteRule: 'CASCADE',
      updateRule: 'CASCADE',
    },
    account_userId_fkey: {
      table: 'account',
      column: 'userId',
      foreignSchema: 'public',
      foreignTable: 'user',
      foreignColumn: 'id',
      deleteRule: 'CASCADE',
      updateRule: 'CASCADE',
    },
    twoFactor_userId_fkey: {
      table: 'twoFactor',
      column: 'userId',
      foreignSchema: 'public',
      foreignTable: 'user',
      foreignColumn: 'id',
      deleteRule: 'CASCADE',
      updateRule: 'CASCADE',
    },
  };

  for (const [fkName, expected] of Object.entries(expectedFkeys)) {
    const found = foundFkeys.get(fkName);
    if (!found) {
      errors.push(`Missing foreign key constraint '${fkName}'`);
      continue;
    }
    if (found.table !== expected.table) {
      errors.push(`Foreign key '${fkName}' source table expected '${expected.table}', got '${found.table}'`);
    }
    if (found.column !== expected.column) {
      errors.push(`Foreign key '${fkName}' source column expected '${expected.column}', got '${found.column}'`);
    }
    if (found.foreignSchema !== expected.foreignSchema) {
      errors.push(
        `Foreign key '${fkName}' referenced schema expected '${expected.foreignSchema}', got '${found.foreignSchema}'`
      );
    }
    if (found.foreignTable !== expected.foreignTable) {
      errors.push(
        `Foreign key '${fkName}' referenced table expected '${expected.foreignTable}', got '${found.foreignTable}'`
      );
    }
    if (found.foreignColumn !== expected.foreignColumn) {
      errors.push(
        `Foreign key '${fkName}' referenced column expected '${expected.foreignColumn}', got '${found.foreignColumn}'`
      );
    }
    if (found.deleteRule !== expected.deleteRule) {
      errors.push(`Foreign key '${fkName}' delete rule expected '${expected.deleteRule}', got '${found.deleteRule}'`);
    }
    if (found.updateRule !== expected.updateRule) {
      errors.push(`Foreign key '${fkName}' update rule expected '${expected.updateRule}', got '${found.updateRule}'`);
    }
  }

  // 6. Indexes: verify name, table, uniqueness, validity, non-partial, non-expression, and exact column order
  const idxRes = await client.query(`
    SELECT
      i.relname AS indexname,
      t.relname AS tablename,
      ix.indisunique,
      ix.indisvalid,
      ix.indpred IS NOT NULL AS is_partial,
      ix.indexprs IS NOT NULL AS is_expression,
      pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
      ARRAY(
        SELECT pg_get_indexdef(ix.indexrelid, k, true)
        FROM generate_series(1, ix.indnatts) AS k
      ) AS index_columns,
      pg_get_indexdef(ix.indexrelid) AS indexdef
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
  `);

  const foundIndexes = new Map<
    string,
    {
      table: string;
      unique: boolean;
      valid: boolean;
      isPartial: boolean;
      isExpression: boolean;
      predicate: string | null;
      columns: string[];
      indexdef: string;
    }
  >();
  for (const row of idxRes.rows) {
    const rawCols: string[] = Array.isArray(row.index_columns) ? row.index_columns : [];
    const normalizedCols = rawCols.map((c: string) => c.trim().replace(/^"|"$/g, ''));

    foundIndexes.set(row.indexname, {
      table: row.tablename,
      unique: Boolean(row.indisunique),
      valid: Boolean(row.indisvalid),
      isPartial: Boolean(row.is_partial),
      isExpression: Boolean(row.is_expression),
      predicate: row.predicate || null,
      columns: normalizedCols,
      indexdef: row.indexdef,
    });
  }

  const expectedIndexes: Record<
    string,
    {
      table: string;
      unique: boolean;
      columns: string[];
    }
  > = {
    user_email_key: {
      table: 'user',
      unique: true,
      columns: ['email'],
    },
    session_token_key: {
      table: 'session',
      unique: true,
      columns: ['token'],
    },
    session_userId_idx: {
      table: 'session',
      unique: false,
      columns: ['userId'],
    },
    account_userId_idx: {
      table: 'account',
      unique: false,
      columns: ['userId'],
    },
    verification_identifier_idx: {
      table: 'verification',
      unique: false,
      columns: ['identifier'],
    },
    twoFactor_userId_idx: {
      table: 'twoFactor',
      unique: false,
      columns: ['userId'],
    },
  };

  for (const [idxName, expected] of Object.entries(expectedIndexes)) {
    const found = foundIndexes.get(idxName);
    if (!found) {
      errors.push(`Missing index '${idxName}'`);
      continue;
    }
    if (found.table !== expected.table) {
      errors.push(`Index '${idxName}' on table '${found.table}', expected '${expected.table}'`);
    }
    if (!found.valid) {
      errors.push(`Index '${idxName}' is marked invalid in pg_index`);
    }
    if (expected.unique && !found.unique) {
      errors.push(`Index '${idxName}' must be UNIQUE, but found non-unique index`);
    }
    if (!expected.unique && found.unique) {
      errors.push(`Index '${idxName}' expected to be non-unique, but found UNIQUE index`);
    }
    if (found.isPartial) {
      errors.push(
        `Index '${idxName}' must not be a partial index, but found predicate: ${found.predicate || found.indexdef}`
      );
    }
    if (found.isExpression) {
      errors.push(`Index '${idxName}' must not be an expression index: ${found.indexdef}`);
    }
    if (found.columns.length !== expected.columns.length) {
      errors.push(
        `Index '${idxName}' column count mismatch: expected [${expected.columns.join(', ')}], got [${found.columns.join(', ')}]`
      );
    } else {
      for (let i = 0; i < expected.columns.length; i++) {
        if (found.columns[i] !== expected.columns[i]) {
          errors.push(
            `Index '${idxName}' column ${i + 1} mismatch: expected '${expected.columns[i]}', got '${found.columns[i]}'`
          );
        }
      }
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

  // 1. Connect with explicit connection parameters and search_path pinning
  const client = new Client({
    host: connParams.host,
    port: connParams.port,
    database: connParams.database,
    user: connParams.user,
    password: connParams.password,
    ssl: connParams.ssl,
    options: '-c search_path=public',
  });

  await client.connect();

  try {
    // Enforce explicit search_path on connection to neutralize ambient PGOPTIONS or role search_path
    await client.query('SET search_path = public;');

    // 2. Assert connected database strictly matches intended target database
    const dbCheckRes = await client.query('SELECT current_database() AS current_db');
    const currentDb = dbCheckRes.rows[0]?.current_db;
    if (currentDb !== connParams.database) {
      throw new Error(
        `Connected database '${currentDb}' does not match intended target database '${connParams.database}'. Ambient redirection detected. Aborting baseline.`
      );
    }

    const schemaCheck = await client.query('SELECT current_schema() AS current_schema');
    const currentSchema = schemaCheck.rows[0]?.current_schema;
    if (currentSchema !== 'public') {
      throw new Error(
        `Connected schema '${currentSchema}' does not match intended schema 'public'. Ambient schema routing detected. Aborting baseline.`
      );
    }

    log(`[Identity Baseline] Target confirmed: ${currentDb} (schema: ${currentSchema}). Inspecting existing database state...`);

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
        (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'UserRole') AS enum_count;
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
        await client.query('SET LOCAL search_path = public;');
        await client.query(migrationSql);

        // Verify catalog in-transaction before committing DDL
        const inTxVerifyRes = await verifySchemaEquivalence(client);
        if (!inTxVerifyRes.equivalent) {
          throw new Error(`In-transaction catalog verification failed: ${inTxVerifyRes.errors.join('; ')}`);
        }

        await client.query('COMMIT');
      } catch (sqlErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(
          `Baseline migration SQL execution failed in transaction: ${
            sqlErr instanceof Error ? sqlErr.message : String(sqlErr)
          }`
        );
      }
    }

    log('[Identity Baseline] Schema verified. Recording migration in Prisma history table...');

    // 4. Record applied migration in Prisma migration history table
    const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
    const cleanEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: connParams.canonicalUrl,
    };
    if (cleanEnv.PGOPTIONS) {
      const sanitized = cleanEnv.PGOPTIONS.replace(/-c\s+search_path=[^\s]+/gi, '').trim();
      if (sanitized.length > 0) {
        cleanEnv.PGOPTIONS = `${sanitized} -c search_path=public`;
      } else {
        delete cleanEnv.PGOPTIONS;
      }
    }

    const resolveResult = spawnSync(
      process.execPath,
      [prismaJs, 'migrate', 'resolve', '--applied', '20261111000000_init_auth'],
      {
        env: cleanEnv,
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
        env: cleanEnv,
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


