import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { extractRawTokens } from '@/modules/identity/credential-version';
import { sanitizeAuditPayload } from '@/lib/audit';
import { runWithIdempotencyRetry, IdempotencyConcurrentConflictError } from '@/lib/idempotency';
import { MAX_SEARCH_PAGE } from '@/lib/search-params';
import {
  searchMattersParamsSchema,
  searchProceedingsParamsSchema,
  getPartyMatterAssociationsSchema,
} from '@/modules/matters/matter-types';

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
});
