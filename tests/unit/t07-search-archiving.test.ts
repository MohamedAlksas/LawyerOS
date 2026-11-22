import { describe, it, expect } from 'vitest';
import { normalizeArabicDigits, normalizeArabicText } from '@/lib/normalization';
import {
  archiveMatterSchema,
  reopenMatterSchema,
  archiveProceedingSchema,
  reopenProceedingSchema,
  searchProceedingsParamsSchema,
  unifiedSearchParamsSchema,
  searchMatterClientsParamsSchema,
  MatterArchivedError,
  ProceedingArchivedError,
  ActiveObligationError,
} from '@/modules/matters/matter-types';

describe('T07 Search & Normalization Unit Tests', () => {
  describe('Arabic Digit Normalization', () => {
    it('normalizes Eastern Arabic-Indic digits to ASCII standard digits', () => {
      const input = '١٢٣٤٥٦٧٨٩٠';
      expect(normalizeArabicDigits(input)).toBe('1234567890');
    });

    it('normalizes Persian/Urdu digits to ASCII standard digits', () => {
      const input = '۱۲۳۴۵۶۷۸۹۰';
      expect(normalizeArabicDigits(input)).toBe('1234567890');
    });

    it('preserves ASCII numbers and formats docket years correctly', () => {
      const docket = '١٢٣٤ / ٢٠٢٤';
      expect(normalizeArabicDigits(docket)).toBe('1234 / 2024');
    });
  });

  describe('Arabic Text Normalization', () => {
    it('normalizes all Alef forms (أ, إ, آ, ٱ) to bare Alef (ا)', () => {
      expect(normalizeArabicText('أحمد إبراهيم آمنة ٱعتراض')).toBe('احمد ابراهيم امنه اعتراض');
    });

    it('normalizes Taa Marbuta (ة) to Haa (ه)', () => {
      expect(normalizeArabicText('محكمة القاهرة الجديدة')).toBe('محكمه القاهره الجديده');
    });

    it('normalizes Alif Maqsura (ى) to Yaa (ي)', () => {
      expect(normalizeArabicText('دعوى مدعى')).toBe('دعوي مدعي');
    });

    it('strips all Arabic diacritics / tashkeel', () => {
      const withTashkeel = 'مَحْكَمَةُ جُنَحِ مُسْتَأْنَفِ مَصْرَ الجَدِيدَةِ';
      expect(normalizeArabicText(withTashkeel)).toBe('محكمه جنح مستانف مصر الجديده');
    });
  });

  describe('Archive & Reopen Zod Schemas', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const validUuid2 = '223e4567-e89b-12d3-a456-426614174000';

    it('validates archiveMatterSchema with valid input', () => {
      const res = archiveMatterSchema.safeParse({
        matterId: validUuid,
        reason: 'تم الفصل في الدعوى بحكم نهائي وتنفيذه',
        expectedVersion: 1,
        idempotencyKey: 'idemp-archive-matter-001',
      });
      expect(res.success).toBe(true);
    });

    it('rejects archiveMatterSchema when reason is less than 3 characters', () => {
      const res = archiveMatterSchema.safeParse({
        matterId: validUuid,
        reason: 'تم',
        expectedVersion: 1,
        idempotencyKey: 'idemp-archive-matter-002',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toContain('3 أحرف');
      }
    });

    it('rejects archiveMatterSchema with non-positive expectedVersion', () => {
      const res = archiveMatterSchema.safeParse({
        matterId: validUuid,
        reason: 'سبب كافي ومقبول',
        expectedVersion: 0,
        idempotencyKey: 'idemp-archive-matter-003',
      });
      expect(res.success).toBe(false);
    });

    it('validates reopenMatterSchema with valid input', () => {
      const res = reopenMatterSchema.safeParse({
        matterId: validUuid,
        reason: 'ظهور مستندات جديدة تستدعي إعادة فتح الملف',
        expectedVersion: 2,
        idempotencyKey: 'idemp-reopen-matter-001',
      });
      expect(res.success).toBe(true);
    });

    it('validates archiveProceedingSchema with valid input', () => {
      const res = archiveProceedingSchema.safeParse({
        proceedingId: validUuid,
        matterId: validUuid2,
        reason: 'انتهت إجراءات هذه الدرجة بالحكم النهائي',
        expectedVersion: 1,
        idempotencyKey: 'idemp-archive-proc-001',
      });
      expect(res.success).toBe(true);
    });

    it('validates reopenProceedingSchema with valid input', () => {
      const res = reopenProceedingSchema.safeParse({
        proceedingId: validUuid,
        matterId: validUuid2,
        reason: 'إلغاء الحكم وإعادة المحاكمة',
        expectedVersion: 2,
        idempotencyKey: 'idemp-reopen-proc-001',
      });
      expect(res.success).toBe(true);
    });
  });

  describe('Search Proceedings & Unified Search Schemas', () => {
    it('validates searchProceedingsParamsSchema with valid filters and bounds limit', () => {
      const res = searchProceedingsParamsSchema.safeParse({
        query: '١٢٣٤ / ٢٠٢٤',
        status: 'ACTIVE',
        limit: 25,
        page: 2,
        includeArchived: true,
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.limit).toBe(25);
        expect(res.data.page).toBe(2);
        expect(res.data.includeArchived).toBe(true);
      }
    });

    it('rejects searchProceedingsParamsSchema with limit > 100', () => {
      const res = searchProceedingsParamsSchema.safeParse({
        limit: 101,
      });
      expect(res.success).toBe(false);
    });

    it('validates unifiedSearchParamsSchema with all allowed search types', () => {
      for (const t of ['ALL', 'PARTY', 'MATTER', 'PROCEEDING'] as const) {
        const res = unifiedSearchParamsSchema.safeParse({
          query: 'أحمد',
          type: t,
          includeArchived: false,
          limit: 15,
        });
        expect(res.success).toBe(true);
      }
    });

    it('rejects unifiedSearchParamsSchema with invalid type or unknown keys', () => {
      const res = unifiedSearchParamsSchema.safeParse({
        query: 'test',
        type: 'INVALID_TYPE',
      });
      expect(res.success).toBe(false);

      const unknownKeyRes = unifiedSearchParamsSchema.safeParse({
        query: 'test',
        extraField: true,
      });
      expect(unknownKeyRes.success).toBe(false);
    });
  });

  describe('Search Matter Clients Params Schema', () => {
    it('validates searchMatterClientsParamsSchema with default values', () => {
      const res = searchMatterClientsParamsSchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(1);
        expect(res.data.limit).toBe(20);
        expect(res.data.includeArchived).toBe(false);
        expect(res.data.query).toBeUndefined();
      }
    });

    it('validates searchMatterClientsParamsSchema with custom valid parameters', () => {
      const res = searchMatterClientsParamsSchema.safeParse({
        query: 'شركة النور',
        includeArchived: true,
        page: 5,
        limit: 50,
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.query).toBe('شركة النور');
        expect(res.data.includeArchived).toBe(true);
        expect(res.data.page).toBe(5);
        expect(res.data.limit).toBe(50);
      }
    });

    it('rejects searchMatterClientsParamsSchema with query exceeding 100 characters', () => {
      const longQuery = 'أ'.repeat(101);
      const res = searchMatterClientsParamsSchema.safeParse({
        query: longQuery,
      });
      expect(res.success).toBe(false);
    });

    it('rejects searchMatterClientsParamsSchema with invalid page (< 1 or > 1000)', () => {
      expect(searchMatterClientsParamsSchema.safeParse({ page: 0 }).success).toBe(false);
      expect(searchMatterClientsParamsSchema.safeParse({ page: -1 }).success).toBe(false);
      expect(searchMatterClientsParamsSchema.safeParse({ page: 1001 }).success).toBe(false);
    });

    it('rejects searchMatterClientsParamsSchema with invalid limit (< 1 or > 100)', () => {
      expect(searchMatterClientsParamsSchema.safeParse({ limit: 0 }).success).toBe(false);
      expect(searchMatterClientsParamsSchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('rejects searchMatterClientsParamsSchema with unknown extra keys (strict)', () => {
      const res = searchMatterClientsParamsSchema.safeParse({
        query: 'valid',
        unauthorizedFilter: 'malicious',
      });
      expect(res.success).toBe(false);
    });
  });

  describe('T07 Custom Error Classes', () => {
    it('instantiates MatterArchivedError correctly', () => {
      const err = new MatterArchivedError();
      expect(err.name).toBe('MatterArchivedError');
      expect(err.message).toContain('مؤرشف');
    });

    it('instantiates ProceedingArchivedError correctly', () => {
      const err = new ProceedingArchivedError();
      expect(err.name).toBe('ProceedingArchivedError');
      expect(err.message).toContain('مؤرشف');
    });

    it('instantiates ActiveObligationError correctly', () => {
      const err = new ActiveObligationError();
      expect(err.name).toBe('ActiveObligationError');
      expect(err.message).toContain('التزامات');
    });
  });
});
