import { describe, it, expect } from 'vitest';
import { parseCliArgs, parseTargetUrl, runIdentityBaseline } from '@/cli/baseline-identity';

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

  describe('parseTargetUrl', () => {
    it('parses complete postgresql URL and extracts individual parameters', () => {
      const parsed = parseTargetUrl('postgresql://admin:secretPass@db.internal:5433/prod_database?sslmode=disable');
      expect(parsed.host).toBe('db.internal');
      expect(parsed.port).toBe(5433);
      expect(parsed.database).toBe('prod_database');
      expect(parsed.user).toBe('admin');
      expect(parsed.password).toBe('secretPass');
      expect(parsed.ssl).toBe(false);
    });

    it('assigns canonical default port 5432 when port is omitted', () => {
      const parsed = parseTargetUrl('postgresql://admin:secretPass@127.0.0.1/omitted_port_db');
      expect(parsed.host).toBe('127.0.0.1');
      expect(parsed.port).toBe(5432);
      expect(parsed.database).toBe('omitted_port_db');
    });

    it('rejects empty or whitespace-only targetUrl fail-closed', () => {
      expect(() => parseTargetUrl('')).toThrow(/must be a non-empty string/);
      expect(() => parseTargetUrl('   ')).toThrow(/must be a non-empty string/);
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
  });

  describe('runIdentityBaseline entry point validation', () => {
    it('rejects empty targetUrl fail-closed without attempting connection', async () => {
      await expect(runIdentityBaseline({ targetUrl: '' })).rejects.toThrow(
        /Target database URL must be a non-empty string/
      );
    });
  });
});

