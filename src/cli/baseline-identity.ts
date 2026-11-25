import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';

export interface BaselineOptions {
  targetUrl: string;
  migrationSqlPath?: string;
  forwardMigrationSqlPath?: string;
  silent?: boolean;
}

export interface BaselineResult {
  success: boolean;
  appliedMigration: string;
  appliedMigrations?: string[];
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
    host: parsed.hostname.replace(/^\[(.+)\]$/, '$1'),
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

  // 3. Columns, Types, Nullability, Precision, Base Type, Domain, and Defaults
  const isStrictCurrentTimestamp = (val: string | null) =>
    val !== null && /^(CURRENT_TIMESTAMP|now\(\))$/i.test(val.trim());
  const isStrictFalse = (val: string | null) =>
    val !== null && /^false$/i.test(val.trim());
  const isStrictTrue = (val: string | null) =>
    val !== null && /^true$/i.test(val.trim());
  const isStrictZero = (val: string | null) =>
    val !== null && /^0(::integer)?$/.test(val.trim());
  const isStrictOne = (val: string | null) =>
    val !== null && /^1(::integer)?$/.test(val.trim());
  const isStrictSingleton = (val: string | null) =>
    val !== null && /^'singleton'(::text)?$/i.test(val.trim());
  const isStrictOwnerEnum = (val: string | null) =>
    val !== null && /^'OWNER'::"?UserRole"?$/i.test(val.trim());

  interface ExpectedColDef {
    type: string;
    nullable: string;
    udt?: string;
    baseType: string;
    typeType: string;
    typeNamespace: string;
    datetimePrecision?: number;
    hasDefault: boolean;
    defaultValidator?: (defaultVal: string | null) => boolean;
    expectedDefaultDesc?: string;
  }

  const expectedCols: Record<string, ExpectedColDef> = {
    'user.id': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'user.name': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'user.email': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'user.emailVerified': { type: 'boolean', nullable: 'NO', baseType: 'bool', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictFalse, expectedDefaultDesc: 'false' },
    'user.image': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'user.createdAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'user.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },
    'user.role': { type: 'USER-DEFINED', nullable: 'NO', udt: 'UserRole', baseType: 'UserRole', typeType: 'e', typeNamespace: 'public', hasDefault: true, defaultValidator: isStrictOwnerEnum, expectedDefaultDesc: "'OWNER'::\"UserRole\"" },
    'user.twoFactorEnabled': { type: 'boolean', nullable: 'YES', baseType: 'bool', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictFalse, expectedDefaultDesc: 'false' },
    'user.credentialVersion': { type: 'integer', nullable: 'NO', baseType: 'int4', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictOne, expectedDefaultDesc: '1' },

    'session.id': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'session.expiresAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },
    'session.token': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'session.createdAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'session.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },
    'session.ipAddress': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'session.userAgent': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'session.userId': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'session.credentialVersion': { type: 'integer', nullable: 'NO', baseType: 'int4', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictOne, expectedDefaultDesc: '1' },

    'account.id': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.accountId': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.providerId': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.userId': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.accessToken': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.refreshToken': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.idToken': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.accessTokenExpiresAt': { type: 'timestamp without time zone', nullable: 'YES', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },
    'account.refreshTokenExpiresAt': { type: 'timestamp without time zone', nullable: 'YES', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },
    'account.scope': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.password': { type: 'text', nullable: 'YES', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'account.createdAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'account.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },

    'verification.id': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'verification.identifier': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'verification.value': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'verification.expiresAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },
    'verification.createdAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'verification.updatedAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },

    'twoFactor.id': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'twoFactor.secret': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'twoFactor.backupCodes': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'twoFactor.userId': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
    'twoFactor.verified': { type: 'boolean', nullable: 'NO', baseType: 'bool', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictTrue, expectedDefaultDesc: 'true' },
    'twoFactor.failedVerificationCount': { type: 'integer', nullable: 'NO', baseType: 'int4', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictZero, expectedDefaultDesc: '0' },
    'twoFactor.lockedUntil': { type: 'timestamp without time zone', nullable: 'YES', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: false },

    'office_bootstrap.id': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictSingleton, expectedDefaultDesc: "'singleton'::text" },
    'office_bootstrap.isClosed': { type: 'boolean', nullable: 'NO', baseType: 'bool', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: true, defaultValidator: isStrictTrue, expectedDefaultDesc: 'true' },
    'office_bootstrap.closedAt': { type: 'timestamp without time zone', nullable: 'NO', baseType: 'timestamp', typeType: 'b', typeNamespace: 'pg_catalog', datetimePrecision: 3, hasDefault: true, defaultValidator: isStrictCurrentTimestamp, expectedDefaultDesc: 'CURRENT_TIMESTAMP' },
    'office_bootstrap.ownerId': { type: 'text', nullable: 'NO', baseType: 'text', typeType: 'b', typeNamespace: 'pg_catalog', hasDefault: false },
  };

  const colsRes = await client.query(`
    SELECT
      c.relname AS table_name,
      a.attname AS column_name,
      col.data_type,
      col.is_nullable,
      col.column_default,
      col.datetime_precision,
      col.udt_name,
      t.typname AS pg_typname,
      t.typtype AS pg_typtype,
      tn.nspname AS pg_typnamespace
    FROM pg_class c
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = t.typnamespace
    LEFT JOIN information_schema.columns col 
      ON col.table_schema = cn.nspname 
      AND col.table_name = c.relname 
      AND col.column_name = a.attname
    WHERE cn.nspname = 'public' 
      AND c.relname IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap')
      AND a.attnum > 0
      AND NOT a.attisdropped;
  `);

  const foundCols = new Map<
    string,
    {
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      datetime_precision: number | null;
      udt_name: string;
      pg_typname: string;
      pg_typtype: string;
      pg_typnamespace: string;
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
      pg_typname: row.pg_typname,
      pg_typtype: row.pg_typtype,
      pg_typnamespace: row.pg_typnamespace,
    });
  }

  for (const [colKey, expected] of Object.entries(expectedCols)) {
    const found = foundCols.get(colKey);
    if (!found) {
      errors.push(`Missing column '${colKey}'`);
      continue;
    }
    if (found.pg_typtype === 'd') {
      errors.push(
        `Column '${colKey}' uses an unapproved domain type '${found.pg_typname}'. Domains are strictly rejected.`
      );
    }
    if (found.pg_typtype !== expected.typeType) {
      errors.push(
        `Column '${colKey}' type category mismatch: expected '${expected.typeType}', got '${found.pg_typtype}'`
      );
    }
    if (found.pg_typnamespace !== expected.typeNamespace) {
      errors.push(
        `Column '${colKey}' type namespace mismatch: expected '${expected.typeNamespace}', got '${found.pg_typnamespace}'`
      );
    }
    if (found.pg_typname !== expected.baseType) {
      errors.push(
        `Column '${colKey}' base type mismatch: expected '${expected.baseType}', got '${found.pg_typname}'`
      );
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

  // 6. Indexes: verify name, table, access method, uniqueness, validity, readiness, non-partial, non-expression, nulls-distinctness, collation, opclass, indoption, and exact column order
  const idxRes = await client.query(`
    SELECT
      i.relname AS indexname,
      t.relname AS tablename,
      am.amname AS access_method,
      ix.indisunique,
      ix.indisvalid,
      ix.indisready,
      ix.indnatts,
      ix.indnkeyatts,
      COALESCE((to_jsonb(ix.*) ->> 'indnullsnotdistinct')::boolean, false) AS nulls_not_distinct,
      ix.indpred IS NOT NULL AS is_partial,
      ix.indexprs IS NOT NULL AS is_expression,
      pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
      ARRAY(
        SELECT pg_get_indexdef(ix.indexrelid, k, true)
        FROM generate_series(1, ix.indnatts) AS k
      ) AS index_columns,
      ARRAY(
        SELECT COALESCE(c.collname, 'none')::text
        FROM generate_series(1, ix.indnkeyatts) AS k
        LEFT JOIN pg_collation c ON c.oid = (string_to_array(ix.indcollation::text, ' '))[k]::oid
      )::text[] AS coll_names,
      ARRAY(
        SELECT COALESCE(cnsp.nspname, 'none')::text
        FROM generate_series(1, ix.indnkeyatts) AS k
        LEFT JOIN pg_collation c ON c.oid = (string_to_array(ix.indcollation::text, ' '))[k]::oid
        LEFT JOIN pg_namespace cnsp ON cnsp.oid = c.collnamespace
      )::text[] AS coll_namespaces,
      ARRAY(
        SELECT COALESCE(opc.opcname, 'none')::text
        FROM generate_series(1, ix.indnkeyatts) AS k
        LEFT JOIN pg_opclass opc ON opc.oid = (string_to_array(ix.indclass::text, ' '))[k]::oid
      )::text[] AS opc_names,
      ARRAY(
        SELECT COALESCE(onsp.nspname, 'none')::text
        FROM generate_series(1, ix.indnkeyatts) AS k
        LEFT JOIN pg_opclass opc ON opc.oid = (string_to_array(ix.indclass::text, ' '))[k]::oid
        LEFT JOIN pg_namespace onsp ON onsp.oid = opc.opcnamespace
      )::text[] AS opc_namespaces,
      ARRAY(
        SELECT (string_to_array(ix.indoption::text, ' '))[k]::int
        FROM generate_series(1, ix.indnkeyatts) AS k
      ) AS ind_options,
      pg_get_indexdef(ix.indexrelid) AS indexdef
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_am am ON am.oid = i.relam
    WHERE n.nspname = 'public'
      AND t.relname IN ('user', 'session', 'account', 'verification', 'twoFactor', 'office_bootstrap');
  `);

  const foundIndexes = new Map<
    string,
    {
      table: string;
      accessMethod: string;
      unique: boolean;
      valid: boolean;
      ready: boolean;
      indnatts: number;
      indnkeyatts: number;
      nullsNotDistinct: boolean;
      isPartial: boolean;
      isExpression: boolean;
      predicate: string | null;
      columns: string[];
      collNames: string[];
      collNamespaces: string[];
      opcNames: string[];
      opcNamespaces: string[];
      indOptions: number[];
      indexdef: string;
    }
  >();
  const parsePgStringArray = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
      return val.slice(1, -1).split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    }
    return [];
  };

  for (const row of idxRes.rows) {
    const rawCols: string[] = parsePgStringArray(row.index_columns);
    const normalizedCols = rawCols.map((c: string) => c.trim().replace(/^"|"$/g, ''));
    const collNames: string[] = parsePgStringArray(row.coll_names);
    const collNamespaces: string[] = parsePgStringArray(row.coll_namespaces);
    const opcNames: string[] = parsePgStringArray(row.opc_names);
    const opcNamespaces: string[] = parsePgStringArray(row.opc_namespaces);
    const indOptions: number[] = Array.isArray(row.ind_options)
      ? row.ind_options.map(Number)
      : typeof row.ind_options === 'string' && row.ind_options.startsWith('{') && row.ind_options.endsWith('}')
      ? row.ind_options.slice(1, -1).split(',').map(Number)
      : [];

    foundIndexes.set(row.indexname, {
      table: row.tablename,
      accessMethod: row.access_method,
      unique: Boolean(row.indisunique),
      valid: Boolean(row.indisvalid),
      ready: Boolean(row.indisready),
      indnatts: Number(row.indnatts),
      indnkeyatts: Number(row.indnkeyatts),
      nullsNotDistinct: Boolean(row.nulls_not_distinct),
      isPartial: Boolean(row.is_partial),
      isExpression: Boolean(row.is_expression),
      predicate: row.predicate || null,
      columns: normalizedCols,
      collNames,
      collNamespaces,
      opcNames,
      opcNamespaces,
      indOptions,
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
    if (found.accessMethod !== 'btree') {
      errors.push(`Index '${idxName}' access method mismatch: expected 'btree', got '${found.accessMethod}'`);
    }
    if (!found.valid) {
      errors.push(`Index '${idxName}' is marked invalid in pg_index`);
    }
    if (!found.ready) {
      errors.push(`Index '${idxName}' is marked not ready in pg_index`);
    }
    if (found.indnatts !== expected.columns.length) {
      errors.push(`Index '${idxName}' attribute count mismatch: expected ${expected.columns.length}, got ${found.indnatts}`);
    }
    if (found.indnkeyatts !== expected.columns.length) {
      errors.push(`Index '${idxName}' key attribute count mismatch: expected ${expected.columns.length}, got ${found.indnkeyatts}`);
    }
    if (found.indnatts > found.indnkeyatts) {
      errors.push(`Index '${idxName}' contains unapproved included non-key columns (indnatts: ${found.indnatts}, indnkeyatts: ${found.indnkeyatts})`);
    }
    if (found.nullsNotDistinct) {
      errors.push(`Index '${idxName}' specifies unapproved NULLS NOT DISTINCT semantics`);
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
        const colName = expected.columns[i];
        if (found.columns[i] !== colName) {
          errors.push(
            `Index '${idxName}' column ${i + 1} mismatch: expected '${colName}', got '${found.columns[i]}'`
          );
        }
        const collName = found.collNames[i];
        const collNamespace = found.collNamespaces[i];
        if (collName !== 'default' || collNamespace !== 'pg_catalog') {
          errors.push(
            `Index '${idxName}' column '${colName}' specifies unapproved collation '${collNamespace}.${collName}'. Expected 'pg_catalog.default'.`
          );
        }
        const opcName = found.opcNames[i];
        const opcNamespace = found.opcNamespaces[i];
        if (opcName !== 'text_ops' || opcNamespace !== 'pg_catalog') {
          errors.push(
            `Index '${idxName}' column '${colName}' specifies unapproved operator class '${opcNamespace}.${opcName}'. Expected 'pg_catalog.text_ops'.`
          );
        }
        const optVal = found.indOptions[i];
        if (optVal !== 0) {
          errors.push(
            `Index '${idxName}' column '${colName}' specifies unapproved index options (${optVal}). Expected 0.`
          );
        }
      }
    }
  }

  // 7. Security Triggers & Trigger Functions: verify existence, table binding, event, timing, enabled state, function namespace, security definer, and search_path configuration
  const trgRes = await client.query(`
    SELECT
      t.tgname AS trigger_name,
      c.relname AS table_name,
      t.tgenabled::text AS enabled,
      p.proname AS function_name,
      pn.nspname AS function_schema,
      p.prosecdef,
      p.proconfig,
      p.prosrc AS function_body,
      l.lanname AS function_language,
      p.provolatile,
      p.proisstrict,
      p.proleakproof,
      p.pronargs,
      p.proretset,
      p.prokind,
      p.prorettype = 'pg_catalog.trigger'::regtype AS returns_trigger,
      t.tgtype::int AS trigger_type,
      t.tgqual IS NULL AS unconditional,
      t.tgnargs::int AS argument_count,
      encode(t.tgargs, 'hex') AS argument_bytes,
      t.tgconstraint = 0 AS not_constraint,
      t.tgoldtable IS NULL AND t.tgnewtable IS NULL AS no_transition_tables,
      ARRAY(SELECT a.attname::text FROM unnest(t.tgattr) WITH ORDINALITY AS col(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = col.attnum ORDER BY col.ord) AS update_columns,
      CASE
        WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
        ELSE 'AFTER'
      END AS action_timing,
      CASE
        WHEN (t.tgtype & 4) <> 0 THEN 'INSERT'
        WHEN (t.tgtype & 8) <> 0 THEN 'DELETE'
        WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE'
      END AS action_event,
      ((t.tgtype & 1) <> 0) AS is_row_trigger
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_language l ON l.oid = p.prolang
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE cn.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname IN ('trg_session_set_credential_version', 'trg_account_password_sync_credential_version');
  `);

  const foundTriggers = new Map<
    string,
    {
      tableName: string;
      enabled: string;
      functionName: string;
      functionSchema: string;
      prosecdef: boolean;
      proconfig: string[];
      actionTiming: string;
      actionEvent: string;
      isRowTrigger: boolean;
      definition: (typeof trgRes.rows)[number];
    }
  >();

  for (const row of trgRes.rows) {
    if (foundTriggers.has(row.trigger_name)) {
      errors.push(`Duplicate security trigger '${row.trigger_name}'`);
    }
    foundTriggers.set(row.trigger_name, {
      tableName: row.table_name,
      enabled: String(row.enabled),
      functionName: row.function_name,
      functionSchema: row.function_schema,
      prosecdef: Boolean(row.prosecdef),
      proconfig: parsePgStringArray(row.proconfig),
      actionTiming: row.action_timing,
      actionEvent: row.action_event,
      isRowTrigger: Boolean(row.is_row_trigger),
      definition: row,
    });
  }

  const expectedTriggers: Record<
    string,
    {
      table: string;
      timing: string;
      event: string;
      functionName: string;
      functionSchema: string;
      expectedConfigSubstring: string;
    }
  > = {
    trg_session_set_credential_version: {
      table: 'session',
      timing: 'BEFORE',
      event: 'INSERT',
      functionName: 'trg_session_set_credential_version',
      functionSchema: 'public',
      expectedConfigSubstring: 'search_path=public, pg_catalog',
    },
    trg_account_password_sync_credential_version: {
      table: 'account',
      timing: 'AFTER',
      event: 'UPDATE',
      functionName: 'trg_account_password_sync_credential_version',
      functionSchema: 'public',
      expectedConfigSubstring: 'search_path=public, pg_catalog',
    },
  };

  // Use the shipped migration as the body contract. Compare text conservatively:
  // changing whitespace inside a SQL string/comment can change behavior, so only
  // line endings and outer whitespace are normalized. Unknown rewrites fail closed.
  const canonicalSql = fs.readFileSync(
    path.resolve(process.cwd(), 'prisma/migrations/20261114000000_credential_version/migration.sql'), 'utf8'
  );
  const normalizeBody = (body: string) => body.replace(/\r\n/g, '\n').trim();
  for (const [trgName, expected] of Object.entries(expectedTriggers)) {
    const found = foundTriggers.get(trgName);
    if (!found) {
      errors.push(`Missing security trigger '${trgName}'`);
      continue;
    }
    if (found.tableName !== expected.table) {
      errors.push(`Trigger '${trgName}' table mismatch: expected '${expected.table}', got '${found.tableName}'`);
    }
    if (found.actionTiming !== expected.timing) {
      errors.push(`Trigger '${trgName}' timing mismatch: expected '${expected.timing}', got '${found.actionTiming}'`);
    }
    if (found.actionEvent !== expected.event) {
      errors.push(`Trigger '${trgName}' event mismatch: expected '${expected.event}', got '${found.actionEvent}'`);
    }
    if (!found.isRowTrigger) {
      errors.push(`Trigger '${trgName}' must be FOR EACH ROW`);
    }
    if (found.enabled !== 'O') {
      errors.push(`Trigger '${trgName}' is not enabled (expected 'O', got '${found.enabled}')`);
    }
    if (found.functionSchema !== expected.functionSchema || found.functionName !== expected.functionName) {
      errors.push(
        `Trigger '${trgName}' function mismatch: expected '${expected.functionSchema}.${expected.functionName}', got '${found.functionSchema}.${found.functionName}'`
      );
    }
    if (!found.prosecdef) {
      errors.push(`Trigger function '${expected.functionSchema}.${expected.functionName}' must be SECURITY DEFINER`);
    }
    const hasSafeSearchPath = found.proconfig.length === 1 &&
      found.proconfig[0] === expected.expectedConfigSubstring;
    if (!hasSafeSearchPath) {
      errors.push(
        `Trigger function '${expected.functionSchema}.${expected.functionName}' missing safe search_path config (expected exactly '${expected.expectedConfigSubstring}', got: [${found.proconfig.join(', ')}])`
      );
    }
    const definition = found.definition;
    const canonicalBody = canonicalSql.match(new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${expected.functionName}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`
    ))?.[1];
    if (!canonicalBody || typeof definition.function_body !== 'string' ||
        normalizeBody(definition.function_body) !== normalizeBody(canonicalBody)) {
      errors.push(`Trigger function '${expected.functionName}' body differs from canonical migration`);
    }
    if (definition.function_language !== 'plpgsql' || definition.provolatile !== 'v' ||
        definition.proisstrict !== false || definition.proleakproof !== false ||
        Number(definition.pronargs) !== 0 || definition.proretset !== false ||
        definition.prokind !== 'f' || definition.returns_trigger !== true) {
      errors.push(`Trigger function '${expected.functionName}' signature or execution attributes differ from canonical migration`);
    }
    const expectedColumns = expected.table === 'account' ? ['password'] : [];
    if (Number(definition.trigger_type) !== (expected.table === 'account' ? 17 : 7) ||
        definition.unconditional !== true || Number(definition.argument_count) !== 0 ||
        definition.argument_bytes !== '' || definition.not_constraint !== true ||
        definition.no_transition_tables !== true ||
        JSON.stringify(parsePgStringArray(definition.update_columns)) !== JSON.stringify(expectedColumns)) {
      errors.push(`Trigger '${trgName}' event, columns, predicate or arguments differ from canonical migration`);
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
    const appliedSet = new Set<string>();

    if (hasMigrationsTable) {
      const appliedCheck = await client.query(`
        SELECT migration_name, checksum, finished_at
        FROM _prisma_migrations
        WHERE rolled_back_at IS NULL;
      `);
      for (const r of appliedCheck.rows) {
        if (['20261111000000_init_auth', '20261114000000_credential_version'].includes(r.migration_name)) {
          const migrationBytes = fs.readFileSync(path.resolve(process.cwd(), 'prisma/migrations', r.migration_name, 'migration.sql'));
          const checksum = createHash('sha256').update(migrationBytes).digest('hex');
          if (r.checksum !== checksum || !r.finished_at || appliedSet.has(r.migration_name)) {
            throw new Error(`Unsupported migration history for '${r.migration_name}': checksum mismatch, unfinished or duplicate entry. Refusing schema changes; inspect and resolve the history manually.`);
          }
        }
        if (!r.finished_at) continue;
        appliedSet.add(r.migration_name);
      }

      if (appliedSet.has('20261111000000_init_auth') && appliedSet.has('20261114000000_credential_version')) {
        log('[Identity Baseline] Both migrations are already marked applied in _prisma_migrations. Verifying schema equivalence...');
        const verifyRes = await verifySchemaEquivalence(client);
        if (!verifyRes.equivalent) {
          throw new Error(
            `Migration history indicates all migrations are applied, but physical schema verification failed: ${verifyRes.errors.join('; ')}`
          );
        }

        const durationMs = Date.now() - startTime;
        log(`[Identity Baseline] Migration already fully completed and verified in ${durationMs}ms.`);
        return {
          success: true,
          appliedMigration: '20261111000000_init_auth',
          appliedMigrations: ['20261111000000_init_auth', '20261114000000_credential_version'],
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

    const credVerCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'credentialVersion'
      ) AS has_cred_ver;
    `);
    const hasCredVer = Boolean(credVerCheck.rows[0]?.has_cred_ver);

    const triggerCountCheck = await client.query(`
      SELECT count(*)::int AS trigger_count
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace cn ON cn.oid = c.relnamespace
      WHERE cn.nspname = 'public'
        AND NOT t.tgisinternal
        AND t.tgname IN ('trg_session_set_credential_version', 'trg_account_password_sync_credential_version');
    `);
    const triggerCount = Number(triggerCountCheck.rows[0]?.trigger_count || 0);
    const hasBothTriggers = triggerCount === 2;

    const allManagedTablesExist = tableCount === 6;
    const needsForwardUpgrade = allManagedTablesExist && (!hasCredVer || !hasBothTriggers);

    const initMigrationPath =
      options.migrationSqlPath ||
      path.resolve(process.cwd(), 'prisma/migrations/20261111000000_init_auth/migration.sql');

    const forwardMigrationPath =
      options.forwardMigrationSqlPath ||
      path.resolve(process.cwd(), 'prisma/migrations/20261114000000_credential_version/migration.sql');

    let isRecovery = false;

    if (needsForwardUpgrade) {
      // 3.3 Target database has prior canonical schema (47 columns) or lacks required security triggers:
      // Perform non-destructive upgrade by executing forward migration 20261114000000_credential_version
      log('[Identity Baseline] Detected schema needing forward upgrade (prior canonical 47 columns or missing triggers). Executing non-destructive forward upgrade...');
      if (!fs.existsSync(forwardMigrationPath)) {
        throw new Error(`Forward migration SQL script not found at: ${forwardMigrationPath}`);
      }
      const forwardSql = fs.readFileSync(forwardMigrationPath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL search_path = public;');
        await client.query(forwardSql);

        const inTxVerifyRes = await verifySchemaEquivalence(client);
        if (!inTxVerifyRes.equivalent) {
          throw new Error(
            `Upgrade schema verification failed: conflicting or incompatible managed entities: ${inTxVerifyRes.errors.join(
              '; '
            )}`
          );
        }

        await client.query('COMMIT');
      } catch (sqlErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(
          `Cannot baseline: existing schema contains conflicting or incompatible managed entities: Non-destructive upgrade execution failed: ${
            sqlErr instanceof Error ? sqlErr.message : String(sqlErr)
          }`
        );
      }
      isRecovery = true;
    } else if (hasManagedEntities) {
      // 3.4 Managed entities exist and credentialVersion column is present: verify physical schema equivalence
      log('[Identity Baseline] Managed entities detected. Verifying physical schema equivalence...');
      const verifyRes = await verifySchemaEquivalence(client);

      if (!verifyRes.equivalent) {
        throw new Error(
          `Cannot baseline: existing schema contains conflicting or incompatible managed entities: ${verifyRes.errors.join('; ')}. Refusing to apply or mark migration without manual resolution.`
        );
      }

      log('[Identity Baseline] Physical schema is fully equivalent (matching SQL-committed state). Resuming history recording without re-executing DDL...');
      isRecovery = true;
    } else {
      // 3.5 No managed entities exist: clean baseline execution (applies init migration + forward migration)
      log('[Identity Baseline] Clean target detected. Executing migration SQL in a single fail-fast transaction...');

      if (!fs.existsSync(initMigrationPath)) {
        throw new Error(`Baseline migration SQL script not found at: ${initMigrationPath}`);
      }
      if (!fs.existsSync(forwardMigrationPath)) {
        throw new Error(`Forward migration SQL script not found at: ${forwardMigrationPath}`);
      }

      const initSql = fs.readFileSync(initMigrationPath, 'utf-8');
      const forwardSql = fs.readFileSync(forwardMigrationPath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL search_path = public;');
        await client.query(initSql);
        await client.query(forwardSql);

        // Verify catalog in-transaction before committing DDL
        const inTxVerifyRes = await verifySchemaEquivalence(client);
        if (!inTxVerifyRes.equivalent) {
          throw new Error(
            `In-transaction catalog verification failed: conflicting or incompatible managed entities: ${inTxVerifyRes.errors.join(
              '; '
            )}`
          );
        }

        await client.query('COMMIT');
      } catch (sqlErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(
          `Cannot baseline: existing schema contains conflicting or incompatible managed entities: Baseline migration SQL execution failed: ${
            sqlErr instanceof Error ? sqlErr.message : String(sqlErr)
          }`
        );
      }
    }

    log('[Identity Baseline] Schema verified. Recording migration in Prisma history table...');

    // 4. Record applied migrations in Prisma migration history table
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

    const resolveMigration = (migName: string) => {
      const resolveResult = spawnSync(
        process.execPath,
        [prismaJs, 'migrate', 'resolve', '--applied', migName],
        {
          env: cleanEnv,
          encoding: 'utf-8',
        }
      );

      if (resolveResult.status !== 0) {
        throw new Error(
          `Prisma migrate resolve failed for '${migName}' (status ${resolveResult.status}): ${
            resolveResult.stderr || resolveResult.stdout || 'Unknown error'
          }`
        );
      }
    };

    if (!appliedSet.has('20261111000000_init_auth')) {
      log('[Identity Baseline] Resolving migration 20261111000000_init_auth...');
      resolveMigration('20261111000000_init_auth');
    }

    if (!appliedSet.has('20261114000000_credential_version')) {
      log('[Identity Baseline] Resolving migration 20261114000000_credential_version...');
      resolveMigration('20261114000000_credential_version');
    }

    // Deploy any forward migrations (e.g. 20261117000000_parties_communication_poa)
    const deployResult = spawnSync(
      process.execPath,
      [prismaJs, 'migrate', 'deploy'],
      {
        env: cleanEnv,
        encoding: 'utf-8',
      }
    );

    if (deployResult.status !== 0) {
      throw new Error(
        `Prisma migrate deploy failed during forward migration step (status ${deployResult.status}): ${
          deployResult.stderr || deployResult.stdout || 'Unknown error'
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
        `Prisma migrate status reported errors (status ${statusResult.status}): ${
          statusResult.stderr || statusResult.stdout || 'Unknown error'
        }`
      );
    }

    const durationMs = Date.now() - startTime;
    const actionLabel = isRecovery ? 'recovered and baselined' : 'baselined';
    log(`[Identity Baseline] Success! Migrations 20261111000000_init_auth & 20261114000000_credential_version ${actionLabel} in ${durationMs}ms.`);

    return {
      success: true,
      appliedMigration: '20261111000000_init_auth',
      appliedMigrations: ['20261111000000_init_auth', '20261114000000_credential_version'],
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


