import { describe, it, expect } from 'vitest';
import {
  formatHearingDateDisplay,
  formatHearingTimeDisplay,
  formatRecordResultSummary,
  HEARING_STATUS_LABELS,
  NEXT_DATE_DISPOSITION_LABELS,
} from '@/components/hearings/hearing-ui-types';

describe('T08 Unit Tests: Frontend UI Formatting & Invariants', () => {
  describe('formatHearingTimeDisplay — Unknown Time Invariant', () => {
    it('returns literal «الساعة غير محددة» when time is null, undefined, or empty (T08-TC-01, T08-TC-07)', () => {
      expect(formatHearingTimeDisplay(null)).toBe('الساعة غير محددة');
      expect(formatHearingTimeDisplay(undefined)).toBe('الساعة غير محددة');
      expect(formatHearingTimeDisplay('')).toBe('الساعة غير محددة');
      expect(formatHearingTimeDisplay('   ')).toBe('الساعة غير محددة');
    });

    it('never fabricates 00:00 or midnight for missing time', () => {
      const formatted = formatHearingTimeDisplay(null);
      expect(formatted).not.toContain('00:00');
      expect(formatted).not.toContain('12:00 ص');
      expect(formatted).toBe('الساعة غير محددة');
    });

    it('formats valid hours and minutes with Arabic indicators', () => {
      expect(formatHearingTimeDisplay('10:30')).toBe('10:30 ص');
      expect(formatHearingTimeDisplay('14:15')).toBe('2:15 م');
      expect(formatHearingTimeDisplay('09:00')).toBe('9:00 ص');
      expect(formatHearingTimeDisplay('00:30')).toBe('12:30 ص');
      expect(formatHearingTimeDisplay('12:00')).toBe('12:00 م');
    });
  });

  describe('formatRecordResultSummary — Pre-Save Literal Confirmation (T08-TC-02, T08-TC-07)', () => {
    it('generates exact summary for adjournment with next date and tasks (T08-TC-02)', () => {
      const summary = formatRecordResultSummary({
        nextDate: '2027-02-09',
        taskCount: 2,
      });
      expect(summary).toBe('هتسجل النتيجة، وتضيف جلسة بتاريخ 2027-02-09، و 2 مهام');
    });

    it('generates exact summary for adjournment with next date and 0 tasks', () => {
      const summary = formatRecordResultSummary({
        nextDate: '2027-02-09',
        taskCount: 0,
      });
      expect(summary).toBe('هتسجل النتيجة، وتضيف جلسة بتاريخ 2027-02-09، وبدون مهام متابعة');
    });

    it('generates summary when no next date is scheduled but follow-up tasks exist', () => {
      const summary = formatRecordResultSummary({
        nextDate: null,
        taskCount: 3,
      });
      expect(summary).toBe('هتسجل النتيجة بدون جلسة قادمة، و 3 مهام');
    });

    it('generates summary when no next date and no tasks', () => {
      const summary = formatRecordResultSummary({
        nextDate: null,
        taskCount: 0,
      });
      expect(summary).toBe('هتسجل النتيجة بدون جلسة قادمة، وبدون مهام متابعة');
    });
  });

  describe('formatHearingDateDisplay', () => {
    it('returns placeholder for missing date', () => {
      expect(formatHearingDateDisplay(null)).toBe('—');
      expect(formatHearingDateDisplay('')).toBe('—');
    });

    it('formats valid YYYY-MM-DD date string into readable Arabic', () => {
      const formatted = formatHearingDateDisplay('2027-01-12');
      expect(formatted).toBeTruthy();
      expect(formatted).not.toBe('—');
      // Should format in Egyptian Arabic locale with month name
      expect(formatted).toContain('يناير');
    });
  });

  describe('Labels and Status Mappings', () => {
    it('provides correct Egyptian Arabic labels for hearing status', () => {
      expect(HEARING_STATUS_LABELS.SCHEDULED).toBe('محددة');
      expect(HEARING_STATUS_LABELS.COMPLETED).toBe('تمت الجلسة');
      expect(HEARING_STATUS_LABELS.CANCELLED).toBe('ملغاة');
      expect(HEARING_STATUS_LABELS.RESCHEDULED).toBe('تم تعديل الموعد');
    });

    it('provides correct labels for next date dispositions', () => {
      expect(NEXT_DATE_DISPOSITION_LABELS.KNOWN).toBe('تأجيل لجلسة قادمة (تاريخ محدد)');
      expect(NEXT_DATE_DISPOSITION_LABELS.NONE).toBe('لا توجد جلسة أخرى (انتهت الدعوى / حجز للحكم)');
      expect(NEXT_DATE_DISPOSITION_LABELS.UNDETERMINED).toBe('تأجيل إداري / لم يحدد موعد بعد');
    });
  });
});
