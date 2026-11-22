import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  validateAndNormalizeHearingTime,
  parseCalendarDateToUtc,
  scheduleHearingSchema,
  recordHearingResultSchema,
  correctHearingResultSchema,
  rescheduleHearingSchema,
  cancelHearingSchema,
  SchedulingValidationError,
} from '@/modules/scheduling/hearing-types';
import { MatterValidationError } from '@/modules/matters/matter-types';

describe('T08 Unit Tests: Scheduling Validation & Invariants', () => {
  describe('validateAndNormalizeHearingTime', () => {
    it('returns null for null, undefined, or empty string (never fabricates midnight)', () => {
      expect(validateAndNormalizeHearingTime(null)).toBeNull();
      expect(validateAndNormalizeHearingTime(undefined)).toBeNull();
      expect(validateAndNormalizeHearingTime('')).toBeNull();
      expect(validateAndNormalizeHearingTime('   ')).toBeNull();
    });

    it('normalizes valid times into HH:mm format', () => {
      expect(validateAndNormalizeHearingTime('10:30')).toBe('10:30');
      expect(validateAndNormalizeHearingTime('9:05')).toBe('09:05');
      expect(validateAndNormalizeHearingTime('00:00')).toBe('00:00');
      expect(validateAndNormalizeHearingTime('23:59')).toBe('23:59');
      expect(validateAndNormalizeHearingTime(' 14:15 ')).toBe('14:15');
    });

    it('rejects invalid time formats and out-of-range hours/minutes', () => {
      expect(() => validateAndNormalizeHearingTime('24:00')).toThrow(SchedulingValidationError);
      expect(() => validateAndNormalizeHearingTime('12:60')).toThrow(SchedulingValidationError);
      expect(() => validateAndNormalizeHearingTime('10:99')).toThrow(SchedulingValidationError);
      expect(() => validateAndNormalizeHearingTime('morning')).toThrow(SchedulingValidationError);
      expect(() => validateAndNormalizeHearingTime('10-30')).toThrow(SchedulingValidationError);
    });
  });

  describe('parseCalendarDateToUtc', () => {
    it('correctly converts YYYY-MM-DD into a UTC midnight Date object', () => {
      const parsed = parseCalendarDateToUtc('2027-05-18');
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe('2027-05-18T00:00:00.000Z');
    });

    it('returns null for empty string and throws for malformed calendar dates', () => {
      expect(parseCalendarDateToUtc('')).toBeNull();
      expect(() => parseCalendarDateToUtc('2027/05/18')).toThrow(MatterValidationError);
      expect(() => parseCalendarDateToUtc('18-05-2027')).toThrow(MatterValidationError);
      expect(() => parseCalendarDateToUtc('invalid')).toThrow(MatterValidationError);
    });
  });

  describe('scheduleHearingSchema', () => {
    it('accepts valid minimal schedule input', () => {
      const proceedingId = crypto.randomUUID();
      const res = scheduleHearingSchema.safeParse({
        proceedingId,
        hearingDate: '2027-06-01',
        idempotencyKey: 'schedule-request',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.proceedingId).toBe(proceedingId);
        expect(res.data.hearingDate).toBe('2027-06-01');
      }
    });

    it('requires a stable idempotency key', () => {
      expect(scheduleHearingSchema.safeParse({
        proceedingId: crypto.randomUUID(),
        hearingDate: '2027-06-01',
      }).success).toBe(false);
    });

    it('accepts optional time, court details, purpose and roll number', () => {
      const proceedingId = crypto.randomUUID();
      const res = scheduleHearingSchema.safeParse({
        proceedingId,
        hearingDate: '2027-06-01',
        hearingTime: '10:30',
        courtHall: 'قاعة 4',
        purpose: 'حضور وتقديم المستندات',
        rollNumber: '15',
        idempotencyKey: 'idemp-key-1',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.courtHall).toBe('قاعة 4');
        expect(res.data.rollNumber).toBe('15');
      }
    });

    it('rejects unknown fields under strict schema validation', () => {
      const res = scheduleHearingSchema.safeParse({
        proceedingId: crypto.randomUUID(),
        hearingDate: '2027-06-01',
        idempotencyKey: 'schedule-request',
        unexpectedField: 'forbidden',
      });
      expect(res.success).toBe(false);
    });

    it('rejects empty proceedingId or invalid date', () => {
      const res1 = scheduleHearingSchema.safeParse({
        proceedingId: '',
        hearingDate: '2027-06-01',
        idempotencyKey: 'schedule-request',
      });
      expect(res1.success).toBe(false);

      const res2 = scheduleHearingSchema.safeParse({
        proceedingId: crypto.randomUUID(),
        hearingDate: 'invalid-date',
        idempotencyKey: 'schedule-request',
      });
      expect(res2.success).toBe(false);
    });
  });

  describe('recordHearingResultSchema', () => {
    it('rejects proceeding status changes and document linkage from a hearing result', () => {
      const input = {
        hearingId: crypto.randomUUID(), expectedVersion: 1, decision: 'حكم تمهيدي',
        nextDateDisposition: 'NONE', idempotencyKey: crypto.randomUUID(),
      };
      expect(recordHearingResultSchema.safeParse(input).success).toBe(true);
      expect(recordHearingResultSchema.safeParse({ ...input, proceedingStatusUpdate: 'CLOSED' }).success).toBe(false);
      expect(recordHearingResultSchema.safeParse({ ...input, decisionDocumentId: crypto.randomUUID() }).success).toBe(false);
    });

    it('accepts valid result recording with next date and tasks', () => {
      const hearingId = crypto.randomUUID();
      const res = recordHearingResultSchema.safeParse({
        hearingId,
        expectedVersion: 1,
        courtDecision: 'قررت المحكمة التأجيل لجلسة 2027/08/01 للإعلان بأصل الصحيفة',
        summary: 'تأجيل للإعلان',
        attendance: 'حضر الأستاذ وكيل المدعي وغاب المدعى عليه',
        nextDateDisposition: 'KNOWN',
        nextHearing: {
          hearingDate: '2027-08-01',
          hearingTime: '10:00',
          courtHall: 'قاعة 2',
          purpose: 'إعادة الإعلان بأصل الصحيفة',
        },
        tasks: [
          {
            title: 'استخراج صورة رسمية من محضر الجلسة وتجهيز أصل الصحيفة',
            dueDate: '2027-07-20',
            priority: 'HIGH',
          },
        ],
        idempotencyKey: 'res-idemp-1',
      });
      expect(res.success).toBe(true);
    });

    it('rejects missing or empty courtDecision', () => {
      const res = recordHearingResultSchema.safeParse({
        hearingId: crypto.randomUUID(),
        expectedVersion: 1,
        courtDecision: '   ',
        nextDateDisposition: 'NONE',
        idempotencyKey: 'result-request',
      });
      expect(res.success).toBe(false);
    });

    it('rejects invalid nextDateDisposition enum value', () => {
      const res = recordHearingResultSchema.safeParse({
        hearingId: crypto.randomUUID(),
        expectedVersion: 1,
        courtDecision: 'حكم تمهيدي',
        nextDateDisposition: 'MAYBE',
        idempotencyKey: 'result-request',
      });
      expect(res.success).toBe(false);
    });
  });

  describe('correctHearingResultSchema', () => {
    it('requires a non-empty reason for corrections', () => {
      const hearingId = crypto.randomUUID();
      const input = {
        hearingId,
        expectedVersion: 1,
        courtDecision: 'القرار المصوب: حجز الدعوى للحكم مع مذكرات في أسبوعين',
        reason: 'تصويب خطأ مادي في منطوق القرار المدون أولاً',
        idempotencyKey: 'correction-request',
      };
      expect(correctHearingResultSchema.safeParse(input).success).toBe(true);
      expect(correctHearingResultSchema.safeParse({ ...input, reason: ' ' }).success).toBe(false);
      expect(correctHearingResultSchema.safeParse({ ...input, expectedVersion: undefined }).success).toBe(false);
    });
  });

  describe('rescheduleHearingSchema & cancelHearingSchema', () => {
    it('enforces mandatory reason on rescheduling', () => {
      const hearingId = crypto.randomUUID();
      const res = rescheduleHearingSchema.safeParse({
        hearingId,
        expectedVersion: 1,
        newHearingDate: '2027-09-01',
        idempotencyKey: 'reschedule-request',
        reason: 'تأجيل إداري لظروف طارئة بالمحكمة',
      });
      expect(res.success).toBe(true);

      const missingReason = rescheduleHearingSchema.safeParse({
        hearingId,
        expectedVersion: 1,
        newHearingDate: '2027-09-01',
        idempotencyKey: 'reschedule-request',
        reason: '',
      });
      expect(missingReason.success).toBe(false);
    });

    it('enforces mandatory reason on cancellation', () => {
      const hearingId = crypto.randomUUID();
      const res = cancelHearingSchema.safeParse({
        hearingId,
        expectedVersion: 1,
        reason: 'شطب الدعوى لتخلف الخصوم عن الحضور',
        idempotencyKey: 'cancel-request',
      });
      expect(res.success).toBe(true);

      const missingReason = cancelHearingSchema.safeParse({
        hearingId,
        expectedVersion: 1,
        reason: '  ',
        idempotencyKey: 'cancel-request',
      });
      expect(missingReason.success).toBe(false);
    });
  });
});
