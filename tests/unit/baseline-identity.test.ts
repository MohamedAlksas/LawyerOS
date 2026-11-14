import { describe, it, expect } from 'vitest';
import {
  parseCliArgs,
  parseTargetUrl,
  runIdentityBaseline,
  sanitizeTargetUrl,
  verifySchemaEquivalence,
} from '@/cli/baseline-identity';
import type { Client } from 'pg';

describe('CLI Baseline Identity Unit Tests (R08)', () => {
  describe('parseCliArgs', () => {
    it('parses --target-url with separate argument', () => {
      const res = parseCliArgs(['--target-url', 'postgresql://user:pass@127.0.0.1:5432/test_db']);
      expect(res.targetUrl).toBe('postgresql://user:pass@127.0.0.1:5432/test_db');
    });

    it('parses --target-url= syntax', () => {
      const res = parseCliArgs(['--target-url=postgresql://user:pass@127.0.0.1:5432/test_db']);
      expect(res.targetUrl).toBe('postgresql://user:pass@127.0.0.1:5432/test_db');
    });

    it('parses positional target URL argument', () => {
      const res = parseCliArgs(['postgresql://user:pass@127.0.0.1:5432/test_db']);
      expect(res.targetUrl).toBe('postgresql://user:pass@127.0.0.1:5432/test_db');
    });

    it('returns undefined when no target argument is provided', () => {
      const res = parseCliArgs([]);
      expect(res.targetUrl).toBeUndefined();
    });
  });

  describe('parseTargetUrl: Port Validation (Correction 1)', () => {
    it('parses complete postgresql URL and extracts individual parameters', () => {
      const parsed = parseTargetUrl('postgresql://admin:secretPass@db.internal:5433/prod_database?sslmode=disable');
      expect(parsed.host).toBe('db.internal');
      expect(parsed.port).toBe(5433);
      expect(parsed.database).toBe('prod_database');
      expect(parsed.user).toBe('admin');
      expect(parsed.password).toBe('secretPass');
      expect(parsed.ssl).toBe(false);
      expect(parsed.canonicalUrl).toBe('postgresql://admin:secretPass@db.internal:5433/prod_database?sslmode=disable');
    });

    it('assigns canonical default port 5432 when port is omitted and does not inherit ambient PGPORT', () => {
      const origPgPort = process.env.PGPORT;
      try {
        process.env.PGPORT = '65432';
        const parsed = parseTargetUrl('postgresql://admin:secretPass@127.0.0.1/omitted_port_db');
        expect(parsed.host).toBe('127.0.0.1');
        expect(parsed.port).toBe(5432);
        expect(parsed.database).toBe('omitted_port_db');
        expect(parsed.canonicalUrl).toBe('postgresql://admin:secretPass@127.0.0.1:5432/omitted_port_db');
      } finally {
        if (origPgPort === undefined) {
          delete process.env.PGPORT;
        } else {
          process.env.PGPORT = origPgPort;
        }
      }
    });

    it('generates driver connection parameters and canonical URL for accepted inputs', () => {
      const parsed = parseTargetUrl('postgresql://my_user:my_secret@my-host.internal:5433/my_db?sslmode=disable');
      expect(parsed).toEqual({
        host: 'my-host.internal',
        port: 5433,
        database: 'my_db',
        user: 'my_user',
        password: 'my_secret',
        ssl: false,
        sslmode: 'disable',
        canonicalUrl: 'postgresql://my_user:my_secret@my-host.internal:5433/my_db?sslmode=disable',
      });
    });

    it('rejects explicit port 0 fail-closed before creating any client or socket', () => {
      expect(() => parseTargetUrl('postgresql://admin:secretPass@127.0.0.1:0/test_db')).toThrowError(
        /Target database URL specifies an invalid port: '0'\. Port must be an integer between 1 and 65535\./
      );
    });

    it('rejects out-of-range ports (> 65535 or < 1) fail-closed', () => {
      expect(() => parseTargetUrl('postgresql://admin:secretPass@127.0.0.1:70000/test_db')).toThrowError(
        /Target database URL specifies an invalid port: '70000'\. Port must be an integer between 1 and 65535\./
      );
      expect(() => parseTargetUrl('postgresql://admin:secretPass@127.0.0.1:-1/test_db')).toThrow();
    });

    it('rejects non-numeric port strings fail-closed', () => {
      expect(() => parseTargetUrl('postgresql://admin:secretPass@127.0.0.1:5432abc/test_db')).toThrowError(
        /Target database URL specifies an invalid port/
      );
    });

    it('accepts legitimate boundary ports (1, 65535, 5432, 5433)', () => {
      const p1 = parseTargetUrl('postgresql://127.0.0.1:1/test_db');
      expect(p1.port).toBe(1);
      const p65535 = parseTargetUrl('postgresql://127.0.0.1:65535/test_db');
      expect(p65535.port).toBe(65535);
    });
  });

  describe('parseTargetUrl: Query Parameter & Routing Validation (Correction 1)', () => {
    it('rejects schema routing parameter fail-closed', () => {
      expect(() =>
        parseTargetUrl('postgresql://admin:secretPass@127.0.0.1:5432/test_db?schema=custom_schema')
      ).toThrowError(/Target database URL specifies unsupported or ambiguous query parameter: 'schema'/);
    });

    it('rejects search_path routing parameter fail-closed', () => {
      expect(() =>
        parseTargetUrl('postgresql://admin:secretPass@127.0.0.1:5432/test_db?search_path=custom_schema')
      ).toThrowError(/Target database URL specifies unsupported or ambiguous query parameter: 'search_path'/);
    });

    it('rejects options routing parameter fail-closed', () => {
      expect(() =>
        parseTargetUrl('postgresql://admin:secretPass@127.0.0.1:5432/test_db?options=-c%20search_path=foo')
      ).toThrowError(/Target database URL specifies unsupported or ambiguous query parameter: 'options'/);
    });
  });

  describe('parseTargetUrl: TLS Policy Validation (Correction 2)', () => {
    it('configures ssl: false for sslmode=disable', () => {
      const parsed = parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sslmode=disable');
      expect(parsed.ssl).toBe(false);
      expect(parsed.sslmode).toBe('disable');
      expect(parsed.canonicalUrl).toContain('sslmode=disable');
    });

    it('configures ssl: { rejectUnauthorized: false } for sslmode=require', () => {
      const parsed = parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sslmode=require');
      expect(parsed.ssl).toEqual({ rejectUnauthorized: false });
      expect(parsed.sslmode).toBe('require');
      expect(parsed.canonicalUrl).toContain('sslmode=require');
    });

    it('configures ssl: { rejectUnauthorized: true } for sslmode=verify-full', () => {
      const parsed = parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sslmode=verify-full');
      expect(parsed.ssl).toEqual({ rejectUnauthorized: true });
      expect(parsed.sslmode).toBe('verify-full');
      expect(parsed.canonicalUrl).toContain('sslmode=verify-full');
    });

    it('rejects unsupported or unrecognized sslmode fail-closed', () => {
      expect(() =>
        parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sslmode=prefer')
      ).toThrowError(/Unsupported or unrecognized sslmode: 'prefer'/);

      expect(() =>
        parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sslmode=allow')
      ).toThrowError(/Unsupported or unrecognized sslmode: 'allow'/);
    });

    it('defaults ssl to false when sslmode is omitted', () => {
      const parsed = parseTargetUrl('postgresql://127.0.0.1:5432/test_db');
      expect(parsed.ssl).toBe(false);
      expect(parsed.sslmode).toBeUndefined();
    });

    it('supports case-insensitive key and value matching for sslmode (F02)', () => {
      const p1 = parseTargetUrl('postgresql://127.0.0.1:5432/test_db?SSLMODE=verify-full');
      expect(p1.ssl).toEqual({ rejectUnauthorized: true });
      expect(p1.sslmode).toBe('verify-full');
      expect(p1.canonicalUrl).toContain('sslmode=verify-full');

      const p2 = parseTargetUrl('postgresql://127.0.0.1:5432/test_db?SslMode=REQUIRE');
      expect(p2.ssl).toEqual({ rejectUnauthorized: false });
      expect(p2.sslmode).toBe('require');
      expect(p2.canonicalUrl).toContain('sslmode=require');

      const p3 = parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sSLmODe=DISABLE');
      expect(p3.ssl).toBe(false);
      expect(p3.sslmode).toBe('disable');
      expect(p3.canonicalUrl).toContain('sslmode=disable');
    });

    it('rejects duplicate or contradictory sslmode parameters fail-closed (F02)', () => {
      expect(() =>
        parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sslmode=disable&sslmode=verify-full')
      ).toThrowError(/Target database URL specifies duplicate or contradictory connection parameter: 'sslmode'\./);

      expect(() =>
        parseTargetUrl('postgresql://127.0.0.1:5432/test_db?sslmode=require&SSLMODE=disable')
      ).toThrowError(/Target database URL specifies duplicate or contradictory connection parameter: 'sslmode'\./);

      expect(() =>
        parseTargetUrl('postgresql://127.0.0.1:5432/test_db?SSLMODE=verify-full&sslmode=verify-full')
      ).toThrowError(/Target database URL specifies duplicate or contradictory connection parameter: 'sslmode'\./);
    });

    it('rejects duplicate schema parameters fail-closed (F02)', () => {
      expect(() =>
        parseTargetUrl('postgresql://127.0.0.1:5432/test_db?schema=public&schema=public')
      ).toThrowError(/Target database URL specifies duplicate or contradictory connection parameter: 'schema'\./);

      expect(() =>
        parseTargetUrl('postgresql://127.0.0.1:5432/test_db?schema=public&SCHEMA=public')
      ).toThrowError(/Target database URL specifies duplicate or contradictory connection parameter: 'schema'\./);
    });
  });

  describe('parseTargetUrl: General Structure & Sanitization', () => {
    it('rejects empty or whitespace-only targetUrl fail-closed', () => {
      expect(() => parseTargetUrl('')).toThrow(/Target database URL is required/);
      expect(() => parseTargetUrl('   ')).toThrow(/Target database URL is required/);
    });

    it('rejects invalid URL structure', () => {
      expect(() => parseTargetUrl('not-a-valid-url')).toThrow(/Invalid target database URL/);
    });

    it('rejects non-postgres protocols', () => {
      expect(() => parseTargetUrl('http://127.0.0.1:5432/my_db')).toThrow(/Invalid database protocol/);
      expect(() => parseTargetUrl('mysql://127.0.0.1:3306/my_db')).toThrow(/Invalid database protocol/);
    });

    it('rejects missing database name in path', () => {
      expect(() => parseTargetUrl('postgresql://127.0.0.1:5432')).toThrow(/must specify an explicit database name/);
      expect(() => parseTargetUrl('postgresql://127.0.0.1:5432/')).toThrow(/must specify an explicit database name/);
    });

    it('sanitizes password in sanitizeTargetUrl', () => {
      const sanitized = sanitizeTargetUrl('postgresql://admin:superSecretPassword123@127.0.0.1:5432/test_db?sslmode=disable');
      expect(sanitized).not.toContain('superSecretPassword123');
      expect(sanitized).toContain('admin:*****@127.0.0.1:5432/test_db');
    });
  });

  describe('runIdentityBaseline entry point validation', () => {
    it('rejects empty targetUrl fail-closed without attempting connection', async () => {
      await expect(runIdentityBaseline({ targetUrl: '' })).rejects.toThrow(
        /Target database URL is required/
      );
    });
  });

  describe('verifySchemaEquivalence Semantic Checks (F01)', () => {
    function buildValidCatalog() {
      const enums = [
        { schemaname: 'public', typname: 'UserRole', enumlabel: 'OWNER' },
        { schemaname: 'public', typname: 'UserRole', enumlabel: 'MAINTAINER' },
      ];

      const tables = [
        { table_name: 'user' },
        { table_name: 'session' },
        { table_name: 'account' },
        { table_name: 'verification' },
        { table_name: 'twoFactor' },
        { table_name: 'office_bootstrap' },
      ];

      const cols = [
        { table_name: 'user', column_name: 'id', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'user', column_name: 'name', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'user', column_name: 'email', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'user', column_name: 'emailVerified', data_type: 'boolean', is_nullable: 'NO', column_default: 'false', datetime_precision: null, udt_name: 'bool' },
        { table_name: 'user', column_name: 'image', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'user', column_name: 'createdAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: 'CURRENT_TIMESTAMP', datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'user', column_name: 'updatedAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'user', column_name: 'role', data_type: 'USER-DEFINED', is_nullable: 'NO', column_default: "'OWNER'::\"UserRole\"", datetime_precision: null, udt_name: 'UserRole' },
        { table_name: 'user', column_name: 'twoFactorEnabled', data_type: 'boolean', is_nullable: 'YES', column_default: 'false', datetime_precision: null, udt_name: 'bool' },

        { table_name: 'session', column_name: 'id', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'session', column_name: 'expiresAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'session', column_name: 'token', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'session', column_name: 'createdAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: 'CURRENT_TIMESTAMP', datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'session', column_name: 'updatedAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'session', column_name: 'ipAddress', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'session', column_name: 'userAgent', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'session', column_name: 'userId', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },

        { table_name: 'account', column_name: 'id', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'accountId', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'providerId', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'userId', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'accessToken', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'refreshToken', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'idToken', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'accessTokenExpiresAt', data_type: 'timestamp without time zone', is_nullable: 'YES', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'account', column_name: 'refreshTokenExpiresAt', data_type: 'timestamp without time zone', is_nullable: 'YES', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'account', column_name: 'scope', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'password', data_type: 'text', is_nullable: 'YES', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'account', column_name: 'createdAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: 'CURRENT_TIMESTAMP', datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'account', column_name: 'updatedAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },

        { table_name: 'verification', column_name: 'id', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'verification', column_name: 'identifier', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'verification', column_name: 'value', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'verification', column_name: 'expiresAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'verification', column_name: 'createdAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: 'CURRENT_TIMESTAMP', datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'verification', column_name: 'updatedAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },

        { table_name: 'twoFactor', column_name: 'id', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'twoFactor', column_name: 'secret', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'twoFactor', column_name: 'backupCodes', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'twoFactor', column_name: 'userId', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
        { table_name: 'twoFactor', column_name: 'verified', data_type: 'boolean', is_nullable: 'NO', column_default: 'true', datetime_precision: null, udt_name: 'bool' },
        { table_name: 'twoFactor', column_name: 'failedVerificationCount', data_type: 'integer', is_nullable: 'NO', column_default: '0', datetime_precision: null, udt_name: 'int4' },
        { table_name: 'twoFactor', column_name: 'lockedUntil', data_type: 'timestamp without time zone', is_nullable: 'YES', column_default: null, datetime_precision: 3, udt_name: 'timestamp' },

        { table_name: 'office_bootstrap', column_name: 'id', data_type: 'text', is_nullable: 'NO', column_default: "'singleton'::text", datetime_precision: null, udt_name: 'text' },
        { table_name: 'office_bootstrap', column_name: 'isClosed', data_type: 'boolean', is_nullable: 'NO', column_default: 'true', datetime_precision: null, udt_name: 'bool' },
        { table_name: 'office_bootstrap', column_name: 'closedAt', data_type: 'timestamp without time zone', is_nullable: 'NO', column_default: 'CURRENT_TIMESTAMP', datetime_precision: 3, udt_name: 'timestamp' },
        { table_name: 'office_bootstrap', column_name: 'ownerId', data_type: 'text', is_nullable: 'NO', column_default: null, datetime_precision: null, udt_name: 'text' },
      ];

      const pkeys = [
        { table_name: 'user', constraint_name: 'user_pkey', column_name: 'id', ordinal_position: 1 },
        { table_name: 'session', constraint_name: 'session_pkey', column_name: 'id', ordinal_position: 1 },
        { table_name: 'account', constraint_name: 'account_pkey', column_name: 'id', ordinal_position: 1 },
        { table_name: 'verification', constraint_name: 'verification_pkey', column_name: 'id', ordinal_position: 1 },
        { table_name: 'twoFactor', constraint_name: 'twoFactor_pkey', column_name: 'id', ordinal_position: 1 },
        { table_name: 'office_bootstrap', constraint_name: 'office_bootstrap_pkey', column_name: 'id', ordinal_position: 1 },
      ];

      const fkeys = [
        {
          constraint_name: 'session_userId_fkey',
          table_name: 'session',
          column_name: 'userId',
          foreign_table_schema: 'public',
          foreign_table_name: 'user',
          foreign_column_name: 'id',
          delete_rule: 'CASCADE',
          update_rule: 'CASCADE',
        },
        {
          constraint_name: 'account_userId_fkey',
          table_name: 'account',
          column_name: 'userId',
          foreign_table_schema: 'public',
          foreign_table_name: 'user',
          foreign_column_name: 'id',
          delete_rule: 'CASCADE',
          update_rule: 'CASCADE',
        },
        {
          constraint_name: 'twoFactor_userId_fkey',
          table_name: 'twoFactor',
          column_name: 'userId',
          foreign_table_schema: 'public',
          foreign_table_name: 'user',
          foreign_column_name: 'id',
          delete_rule: 'CASCADE',
          update_rule: 'CASCADE',
        },
      ];

      const indexes = [
        {
          indexname: 'user_email_key',
          tablename: 'user',
          indisunique: true,
          indisvalid: true,
          is_partial: false,
          is_expression: false,
          predicate: null as string | null,
          index_columns: ['email'],
          indexdef: 'CREATE UNIQUE INDEX user_email_key ON public."user" USING btree (email)',
        },
        {
          indexname: 'session_token_key',
          tablename: 'session',
          indisunique: true,
          indisvalid: true,
          is_partial: false,
          is_expression: false,
          predicate: null as string | null,
          index_columns: ['token'],
          indexdef: 'CREATE UNIQUE INDEX session_token_key ON public.session USING btree (token)',
        },
        {
          indexname: 'session_userId_idx',
          tablename: 'session',
          indisunique: false,
          indisvalid: true,
          is_partial: false,
          is_expression: false,
          predicate: null as string | null,
          index_columns: ['userId'],
          indexdef: 'CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId")',
        },
        {
          indexname: 'account_userId_idx',
          tablename: 'account',
          indisunique: false,
          indisvalid: true,
          is_partial: false,
          is_expression: false,
          predicate: null as string | null,
          index_columns: ['userId'],
          indexdef: 'CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId")',
        },
        {
          indexname: 'verification_identifier_idx',
          tablename: 'verification',
          indisunique: false,
          indisvalid: true,
          is_partial: false,
          is_expression: false,
          predicate: null as string | null,
          index_columns: ['identifier'],
          indexdef: 'CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier)',
        },
        {
          indexname: 'twoFactor_userId_idx',
          tablename: 'twoFactor',
          indisunique: false,
          indisvalid: true,
          is_partial: false,
          is_expression: false,
          predicate: null as string | null,
          index_columns: ['userId'],
          indexdef: 'CREATE INDEX "twoFactor_userId_idx" ON public."twoFactor" USING btree ("userId")',
        },
      ];

      return { enums, tables, cols, pkeys, fkeys, indexes };
    }

    function createMockClient(catalog: ReturnType<typeof buildValidCatalog>) {
      return {
        query: async (sql: string) => {
          if (sql.includes('pg_enum')) {
            return { rows: catalog.enums };
          }
          if (sql.includes('information_schema.tables')) {
            return { rows: catalog.tables };
          }
          if (sql.includes('information_schema.columns')) {
            return { rows: catalog.cols };
          }
          if (sql.includes("tc.constraint_type = 'PRIMARY KEY'")) {
            return { rows: catalog.pkeys };
          }
          if (sql.includes("tc.constraint_type = 'FOREIGN KEY'")) {
            return { rows: catalog.fkeys };
          }
          if (sql.includes('FROM pg_index')) {
            return { rows: catalog.indexes };
          }
          return { rows: [] };
        },
      } as unknown as Client;
    }

    it('approves a fully equivalent valid catalog matching approved migration SQL', async () => {
      const catalog = buildValidCatalog();
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it('rejects reproduction (a): same-name non-unique user_email_key index fail-closed', async () => {
      const catalog = buildValidCatalog();
      const idx = catalog.indexes.find((i) => i.indexname === 'user_email_key');
      if (idx) {
        idx.indisunique = false;
        idx.indexdef = 'CREATE INDEX user_email_key ON public."user" USING btree (email)';
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Index 'user_email_key' must be UNIQUE, but found non-unique index");
    });

    it('rejects reproduction (b): twoFactor.verified default false instead of true fail-closed', async () => {
      const catalog = buildValidCatalog();
      const col = catalog.cols.find((c) => c.table_name === 'twoFactor' && c.column_name === 'verified');
      if (col) {
        col.column_default = 'false';
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Column 'twoFactor.verified' default mismatch: expected 'true', got 'false'");
    });

    it('rejects reproduction (c): session_userId_fkey retargeted to unrelated table fail-closed', async () => {
      const catalog = buildValidCatalog();
      const fk = catalog.fkeys.find((f) => f.constraint_name === 'session_userId_fkey');
      if (fk) {
        fk.foreign_table_name = 'sentinel_audit_log';
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain(
        "Foreign key 'session_userId_fkey' referenced table expected 'user', got 'sentinel_audit_log'"
      );
    });

    it('rejects primary key on wrong column (e.g. user_pkey on name)', async () => {
      const catalog = buildValidCatalog();
      const pk = catalog.pkeys.find((p) => p.constraint_name === 'user_pkey');
      if (pk) {
        pk.column_name = 'name';
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Primary key 'user_pkey' columns mismatch: expected [id], got [name]");
    });

    it('rejects foreign key with incorrect delete rule (e.g. RESTRICT instead of CASCADE)', async () => {
      const catalog = buildValidCatalog();
      const fk = catalog.fkeys.find((f) => f.constraint_name === 'account_userId_fkey');
      if (fk) {
        fk.delete_rule = 'RESTRICT';
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Foreign key 'account_userId_fkey' delete rule expected 'CASCADE', got 'RESTRICT'");
    });

    it('rejects UserRole enum missing required value', async () => {
      const catalog = buildValidCatalog();
      catalog.enums = [{ schemaname: 'public', typname: 'UserRole', enumlabel: 'OWNER' }];
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Enum 'UserRole' missing value 'MAINTAINER'");
    });

    it('rejects UserRole enum containing unexpected value', async () => {
      const catalog = buildValidCatalog();
      catalog.enums.push({ schemaname: 'public', typname: 'UserRole', enumlabel: 'SUPERUSER' });
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Enum 'UserRole' contains unexpected value 'SUPERUSER'");
    });

    it('rejects missing table fail-closed', async () => {
      const catalog = buildValidCatalog();
      catalog.tables = catalog.tables.filter((t) => t.table_name !== 'office_bootstrap');
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Missing table 'office_bootstrap'");
    });

    it('rejects missing required column fail-closed', async () => {
      const catalog = buildValidCatalog();
      catalog.cols = catalog.cols.filter((c) => !(c.table_name === 'user' && c.column_name === 'role'));
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Missing column 'user.role'");
    });

    it('rejects unexpected extra columns on managed table fail-closed', async () => {
      const catalog = buildValidCatalog();
      catalog.cols.push({
        table_name: 'user',
        column_name: 'injected_column',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
        datetime_precision: null,
        udt_name: 'text',
      });
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain("Table column 'user.injected_column' is not part of the managed baseline schema");
    });

    it('rejects R10 reproduction 1: partial user_email_key index with WHERE predicate fail-closed', async () => {
      const catalog = buildValidCatalog();
      const idx = catalog.indexes.find((i) => i.indexname === 'user_email_key');
      if (idx) {
        idx.is_partial = true;
        idx.predicate = 'false';
        idx.indexdef = 'CREATE UNIQUE INDEX user_email_key ON public."user" USING btree (email) WHERE false';
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain(
        "Index 'user_email_key' must not be a partial index, but found predicate: false"
      );
    });

    it('rejects R10 reproduction 2: composite user_email_key (email, name) index fail-closed', async () => {
      const catalog = buildValidCatalog();
      const idx = catalog.indexes.find((i) => i.indexname === 'user_email_key');
      if (idx) {
        idx.index_columns = ['email', 'name'];
        idx.indexdef = 'CREATE UNIQUE INDEX user_email_key ON public."user" USING btree (email, name)';
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain(
        "Index 'user_email_key' column count mismatch: expected [email], got [email, name]"
      );
    });

    it('rejects R10 reproduction 3: user.createdAt with datetime_precision 0 fail-closed', async () => {
      const catalog = buildValidCatalog();
      const col = catalog.cols.find((c) => c.table_name === 'user' && c.column_name === 'createdAt');
      if (col) {
        col.datetime_precision = 0;
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain(
        "Column 'user.createdAt' datetime precision mismatch: expected 3, got 0"
      );
    });

    it('rejects R10 reproduction 3: user.createdAt default with interval addition fail-closed', async () => {
      const catalog = buildValidCatalog();
      const col = catalog.cols.find((c) => c.table_name === 'user' && c.column_name === 'createdAt');
      if (col) {
        col.column_default = "(CURRENT_TIMESTAMP + '1 day'::interval)";
      }
      const client = createMockClient(catalog);
      const res = await verifySchemaEquivalence(client);
      expect(res.equivalent).toBe(false);
      expect(res.errors).toContain(
        "Column 'user.createdAt' default mismatch: expected 'CURRENT_TIMESTAMP', got '(CURRENT_TIMESTAMP + '1 day'::interval)'"
      );
    });
  });
});


