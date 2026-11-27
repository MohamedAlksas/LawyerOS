import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { extractRawTokens, getUserCredentialVersionByEmail } from '@/modules/identity/credential-version';
import { sanitizeAuditPayload } from '@/lib/audit';
import {
  canonicalizeJson,
  computePayloadHash,
  runWithIdempotencyRetry,
  IdempotencyConcurrentConflictError,
  isIdempotencyUniqueConflict,
} from '@/lib/idempotency';
import { parseTargetUrl } from '@/cli/baseline-identity';
import { MAX_SEARCH_PAGE } from '@/lib/search-params';
import {
  searchMattersParamsSchema,
  searchProceedingsParamsSchema,
  getPartyMatterAssociationsSchema,
} from '@/modules/matters/matter-types';
import { parseQueryBooleanParam, parseQueryIntegerParam } from '@/modules/scheduling/deadline-http';
import { SchedulingValidationError } from '@/modules/scheduling/hearing-types';

describe('Audit fixes unit regressions', () => {
  describe('extractRawTokens', () => {
    it('strips cookie attributes before extracting token and candidate identifiers', () => {
      const encoded = encodeURIComponent('2fa-ident123.sigValue');
      const parsed = extractRawTokens(`better-auth.session_token=${encoded}; Domain=localhost; Path=/; HttpOnly`);
      expect(parsed.rawToken).toBe('ident123');
      expect(parsed.candidateIdentifiers).toContain('2fa-ident123');
      expect(parsed.candidateIdentifiers).toContain('ident123');
      expect(parsed.candidateIdentifiers).toContain('two-factor-ident123');
      expect(parsed.candidateIdentifiers.join(' ')).not.toContain('Domain');
    });

    it('handles bare tokens with cookie attributes cleanly', () => {
      const parsed = extractRawTokens('better-auth.session_token=plainTokenValue; Path=/; SameSite=Lax');
      expect(parsed.rawToken).toBe('plainTokenValue');
      expect(parsed.candidateIdentifiers).toContain('plainTokenValue');
    });

    it('returns empty result instead of throwing URIError on malformed percent-encoding', () => {
      const parsed = extractRawTokens('better-auth.session_token=%E0%A4%A; Path=/');
      expect(parsed).toEqual({ rawToken: '', candidateIdentifiers: [] });
    });
  });

  describe('sanitizeAuditPayload', () => {
    it('redacts token-bearing keys at top level and recursively inside arrays', () => {
      const sanitized = sanitizeAuditPayload({
        sessionToken: 'secret-session',
        nested: {
          refresh_token: 'secret-refresh',
          tokenHash: 'secret-hash',
          safeLabel: 'visible',
        },
        items: [
          { token: 'secret-item-token', title: 'ok' },
          [{ password: 'secret-password', note: 'keep' }],
        ],
      }) as Record<string, unknown>;

      expect(sanitized.sessionToken).toBe('[REDACTED_SECRET]');
      expect(sanitized.nested).toEqual({
        refresh_token: '[REDACTED_SECRET]',
        tokenHash: '[REDACTED_SECRET]',
        safeLabel: 'visible',
      });
      expect(sanitized.items).toEqual([
        { token: '[REDACTED_SECRET]', title: 'ok' },
        [{ password: '[REDACTED_SECRET]', note: 'keep' }],
      ]);
    });
  });

  describe('runWithIdempotencyRetry', () => {
    function makeIdempotencyP2002() {
      return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { modelName: 'IdempotencyRecord', target: ['idempotency_key'] },
      });
    }

    it('resolves conflict replay on P2002 without waiting for further retries', async () => {
      let runs = 0;
      const result = await runWithIdempotencyRetry<{ id: string }>(
        async () => {
          runs += 1;
          throw makeIdempotencyP2002();
        },
        async () => ({ resolved: true, value: { id: 'replayed-1' } })
      );

      expect(runs).toBe(1);
      expect(result).toEqual({ id: 'replayed-1' });
    });

    it('retries up to maxAttempts when conflict is transient, then succeeds', async () => {
      let runs = 0;
      let resolutions = 0;
      const result = await runWithIdempotencyRetry(
        async () => {
          runs += 1;
          if (runs < 3) {
            throw makeIdempotencyP2002();
          }
          return 'ok-attempt-3';
        },
        async () => {
          resolutions += 1;
          return { resolved: false };
        },
        3
      );

      expect(runs).toBe(3);
      expect(resolutions).toBe(2);
      expect(result).toBe('ok-attempt-3');
    });

    it('throws IdempotencyConcurrentConflictError when maxAttempts is exhausted', async () => {
      let runs = 0;
      await expect(
        runWithIdempotencyRetry(
          async () => {
            runs += 1;
            throw makeIdempotencyP2002();
          },
          async () => ({ resolved: false }),
          3
        )
      ).rejects.toBeInstanceOf(IdempotencyConcurrentConflictError);
      expect(runs).toBe(3);
    });

    it('rethrows non-idempotency errors immediately without calling resolveConflict', async () => {
      let resolvedCalls = 0;
      const boom = new Error('unexpected domain failure');
      await expect(
        runWithIdempotencyRetry(
          async () => {
            throw boom;
          },
          async () => {
            resolvedCalls += 1;
            return { resolved: false };
          }
        )
      ).rejects.toBe(boom);
      expect(resolvedCalls).toBe(0);
    });
  });

  describe('Pagination upper bounds on matter search schemas', () => {
    const validUuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

    it('enforces MAX_SEARCH_PAGE on searchMattersParamsSchema and searchProceedingsParamsSchema', () => {
      expect(searchMattersParamsSchema.safeParse({ page: MAX_SEARCH_PAGE }).success).toBe(true);
      expect(searchMattersParamsSchema.safeParse({ page: MAX_SEARCH_PAGE + 1 }).success).toBe(false);

      expect(searchProceedingsParamsSchema.safeParse({ page: MAX_SEARCH_PAGE }).success).toBe(true);
      expect(searchProceedingsParamsSchema.safeParse({ page: MAX_SEARCH_PAGE + 1 }).success).toBe(false);
    });

    it('enforces MAX_SEARCH_OFFSET on getPartyMatterAssociationsSchema', () => {
      const maxOffset = MAX_SEARCH_PAGE * 100;
      expect(
        getPartyMatterAssociationsSchema.safeParse({ partyId: validUuid, offset: maxOffset }).success
      ).toBe(true);
      expect(
        getPartyMatterAssociationsSchema.safeParse({ partyId: validUuid, offset: maxOffset + 1 }).success
      ).toBe(false);
    });
  });

  describe('Phase 1 hardening helpers', () => {
    it('canonicalizes Date and bigint deterministically inside canonicalizeJson and computePayloadHash', () => {
      const sampleDate = new Date('2026-11-24T12:34:56.789Z');
      const a = canonicalizeJson({ count: BigInt(42), at: sampleDate, nested: { b: 2, a: 1 } });
      const b = canonicalizeJson({
        nested: { a: 1, b: 2 },
        at: new Date('2026-11-24T12:34:56.789Z'),
        count: BigInt(42),
      });

      expect(a).toBe(b);
      expect(a).toContain('"2026-11-24T12:34:56.789Z"');
      expect(a).toContain('{"$bigint":"42"}');
      expect(computePayloadHash({ at: sampleDate, amount: BigInt(100) })).toBe(
        computePayloadHash({ amount: BigInt(100), at: sampleDate })
      );
    });

    it('redacts snake_case and hyphenated MFA, auth, crypto, and PII keys in sanitizeAuditPayload', () => {
      const sanitized = sanitizeAuditPayload({
        backup_code: '123456',
        recovery_code: 'rec-999',
        totp_secret: 'JBSWY3DPEHPK3PXP',
        national_id: '29901011234567',
        'passport-number': 'A12345678',
        auth_tag: 'tag-val',
        cipher_text: 'enc-val',
        encryption_key: 'key-val',
        initialization_vector: 'iv-val',
        cookie: 'session=abc',
        authorization: 'Bearer xyz',
        safeField: 'visible',
      });

      expect(sanitized).toEqual({
        backup_code: '[REDACTED_SECRET]',
        recovery_code: '[REDACTED_SECRET]',
        totp_secret: '[REDACTED_SECRET]',
        national_id: '[REDACTED_SECRET]',
        'passport-number': '[REDACTED_SECRET]',
        auth_tag: '[REDACTED_SECRET]',
        cipher_text: '[REDACTED_SECRET]',
        encryption_key: '[REDACTED_SECRET]',
        initialization_vector: '[REDACTED_SECRET]',
        cookie: '[REDACTED_SECRET]',
        authorization: '[REDACTED_SECRET]',
        safeField: 'visible',
      });
    });

    it('validates scheduling query integer and boolean parameters fail-closed', () => {
      const validSp = new URLSearchParams({ page: '3', archived: 'false' });
      expect(parseQueryIntegerParam(validSp, 'page')).toBe(3);
      expect(parseQueryIntegerParam(validSp, 'missing')).toBeUndefined();
      expect(parseQueryBooleanParam(validSp, 'archived')).toBe(false);
      expect(parseQueryBooleanParam(validSp, 'missing')).toBeUndefined();

      expect(() => parseQueryIntegerParam(new URLSearchParams({ page: '12abc' }), 'page')).toThrow(
        SchedulingValidationError
      );
      expect(() => parseQueryIntegerParam(new URLSearchParams({ page: '-1' }), 'page')).toThrow(
        SchedulingValidationError
      );
      expect(() => parseQueryIntegerParam(new URLSearchParams({ page: '1000000000' }), 'page')).toThrow(
        SchedulingValidationError
      );
      expect(() => parseQueryBooleanParam(new URLSearchParams({ archived: '1' }), 'archived')).toThrow(
        SchedulingValidationError
      );
    });

    it('returns null from getUserCredentialVersionByEmail without querying when email is blank', async () => {
      expect(await getUserCredentialVersionByEmail('')).toBeNull();
      expect(await getUserCredentialVersionByEmail('   ')).toBeNull();
    });

    it('returns false from isIdempotencyUniqueConflict on non-IdempotencyRecord P2002', () => {
      const nonModelP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { modelName: 'DocumentVersion', target: ['objectKey'] },
      });
      expect(isIdempotencyUniqueConflict(nonModelP2002)).toBe(false);

      const missingCompositeP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { target: ['objectKey'] },
      });
      expect(isIdempotencyUniqueConflict(missingCompositeP2002)).toBe(false);

      const partialCompositeP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { target: ['actorId', 'key'] },
      });
      expect(isIdempotencyUniqueConflict(partialCompositeP2002)).toBe(false);

      const validCompositeP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { target: ['actorId', 'commandType', 'key'] },
      });
      expect(isIdempotencyUniqueConflict(validCompositeP2002)).toBe(true);
    });

    it('omits undefined properties while preserving null in canonicalizeJson, and throws on invalid Date', () => {
      expect(canonicalizeJson({ a: undefined, b: 1 })).toBe('{"b":1}');
      expect(canonicalizeJson({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
      expect(() => canonicalizeJson(new Date('invalid'))).toThrow(TypeError);
    });

    it('redacts storage keys, normalizes valid/invalid Dates, and handles circular references in sanitizeAuditPayload', () => {
      const sanitizedKeys = sanitizeAuditPayload({
        objectKey: 'doc/1/secret.pdf',
        quarantineKey: 'quarantine/secret.pdf',
        storageKey: 'storage/secret.pdf',
        nested: { object_key: 'nested-key' },
      }) as Record<string, unknown>;
      expect(sanitizedKeys.objectKey).toBe('[REDACTED_SECRET]');
      expect(sanitizedKeys.quarantineKey).toBe('[REDACTED_SECRET]');
      expect(sanitizedKeys.storageKey).toBe('[REDACTED_SECRET]');
      expect((sanitizedKeys.nested as Record<string, unknown>).object_key).toBe('[REDACTED_SECRET]');

      const validDate = new Date('2026-11-26T12:00:00.000Z');
      const invalidDate = new Date('invalid');
      const sanitizedDates = sanitizeAuditPayload({
        valid: validDate,
        invalid: invalidDate,
      }) as Record<string, unknown>;
      expect(sanitizedDates.valid).toBe('2026-11-26T12:00:00.000Z');
      expect(sanitizedDates.invalid).toBeNull();

      const circularObj: Record<string, unknown> = { name: 'root' };
      circularObj.self = circularObj;
      const sanitizedCircular = sanitizeAuditPayload(circularObj) as Record<string, unknown>;
      expect(sanitizedCircular.name).toBe('root');
      expect(sanitizedCircular.self).toEqual({ circular: '[CIRCULAR]' });

      const circularArrObj: Record<string, unknown> = { items: [1, 2] };
      (circularArrObj.items as unknown[]).push(circularArrObj);
      const sanitizedArr = sanitizeAuditPayload(circularArrObj) as Record<string, unknown>;
      const items = sanitizedArr.items as unknown[];
      expect(items[0]).toBe(1);
      expect(items[1]).toBe(2);
      expect(items[2]).toEqual({ circular: '[CIRCULAR]' });
    });

    it('strips IPv6 brackets in host while preserving them in canonicalUrl in parseTargetUrl', () => {
      const parsed = parseTargetUrl(
        'postgresql://lawoffice_user:secret@[::1]:5432/lawoffice_test?sslmode=disable'
      );
      expect(parsed.host).toBe('::1');
      expect(parsed.canonicalUrl).toContain('@[::1]:5432/');
    });
  });
});
