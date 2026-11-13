import { describe, it, expect } from 'vitest';
import {
  parseCliArgs,
  parseTargetUrl,
  runIdentityBaseline,
  sanitizeTargetUrl,
} from '@/cli/baseline-identity';

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
});


