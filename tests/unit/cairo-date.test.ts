import { describe, expect, it } from 'vitest';
import {
  addCairoDays,
  CalendarValidationError,
  formatCairoDateArabic,
  formatCairoInstantArabic,
  formatTimeOrUnspecified,
  formatUtcDateToIsoDate,
  getCairoMonthRange,
  getCairoTodayDateString,
  getCairoWeekRange,
  isCairoDateOverdue,
  parseCalendarDateToUtcDate,
  UNSPECIFIED_TIME_LABEL,
  validateOptionalCalendarTime,
  validateStrictCalendarDate,
} from '@/lib/cairo-date';

describe('T09 Unit Tests: Africa/Cairo Date, DST, and Time Validation', () => {
  it('computes Cairo calendar day accurately across Cairo midnight and spring DST transition (T09-TC-04)', () => {
    // Standard time (UTC+2): 2027-04-29T21:59:59Z is 2027-04-29 23:59:59 in Cairo
    expect(getCairoTodayDateString(new Date('2027-04-29T21:59:59Z'))).toBe('2027-04-29');

    // Spring DST start in Egypt (last Friday of April 2027 = 2027-04-30):
    // 2027-04-29T22:00:00Z jumps to 2027-04-30 01:00:00 (UTC+3) in Cairo
    expect(getCairoTodayDateString(new Date('2027-04-29T22:00:00Z'))).toBe('2027-04-30');

    // During UTC+3 DST: 2027-04-30T20:59:59Z is 23:59:59 Cairo (still 2027-04-30)
    expect(getCairoTodayDateString(new Date('2027-04-30T20:59:59Z'))).toBe('2027-04-30');
    // 2027-04-30T21:00:00Z is 2027-05-01 00:00:00 in Cairo even though UTC is still 2027-04-30
    expect(getCairoTodayDateString(new Date('2027-04-30T21:00:00Z'))).toBe('2027-05-01');

    // Autumn DST end (last Thursday of October 2027 = 2027-10-28):
    // 2027-10-28T20:59:59Z = 23:59:59 UTC+3 -> falls back to 23:00 UTC+2, so 21:59:59Z is still 2027-10-28
    expect(getCairoTodayDateString(new Date('2027-10-28T20:59:59Z'))).toBe('2027-10-28');
    expect(getCairoTodayDateString(new Date('2027-10-28T21:59:59Z'))).toBe('2027-10-28');
    expect(getCairoTodayDateString(new Date('2027-10-28T22:00:00Z'))).toBe('2027-10-29');
  });

  it('adds and subtracts calendar days without DST or leap-year drift', () => {
    expect(addCairoDays('2027-04-29', 1)).toBe('2027-04-30');
    expect(addCairoDays('2027-04-29', 2)).toBe('2027-05-01');
    expect(addCairoDays('2027-10-28', 2)).toBe('2027-10-30');
    expect(addCairoDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addCairoDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addCairoDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCairoDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('computes Saturday-through-Friday Egyptian workweeks and month bounds accurately', () => {
    // 2027-04-30 is Friday -> week is Sat 2027-04-24 .. Fri 2027-04-30
    expect(getCairoWeekRange('2027-04-30')).toEqual({
      startDate: '2027-04-24',
      endDate: '2027-04-30',
    });
    // 2027-05-01 is Saturday -> week is Sat 2027-05-01 .. Fri 2027-05-07
    expect(getCairoWeekRange('2027-05-01')).toEqual({
      startDate: '2027-05-01',
      endDate: '2027-05-07',
    });
    // Month ranges handle leap and non-leap February
    expect(getCairoMonthRange('2027-02-15')).toEqual({
      startDate: '2027-02-01',
      endDate: '2027-02-28',
    });
    expect(getCairoMonthRange('2028-02-15')).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    });
  });

  it('evaluates overdue strictly against Cairo today without shifting date-only values', () => {
    expect(isCairoDateOverdue('2027-04-29', '2027-04-30')).toBe(true);
    expect(isCairoDateOverdue('2027-04-30', '2027-04-30')).toBe(false);
    expect(isCairoDateOverdue('2027-05-01', '2027-04-30')).toBe(false);
    expect(isCairoDateOverdue(null, '2027-04-30')).toBe(false);
    expect(isCairoDateOverdue(undefined, '2027-04-30')).toBe(false);

    const utcDate = parseCalendarDateToUtcDate('2027-04-30');
    expect(formatUtcDateToIsoDate(utcDate)).toBe('2027-04-30');
    expect(validateStrictCalendarDate('2027-02-29')).toBe(false);
    expect(validateStrictCalendarDate('2028-02-29')).toBe(true);
  });

  it('rejects time without a date and formats missing time explicitly without 00:00', () => {
    expect(validateOptionalCalendarTime(null, null)).toBeNull();
    expect(validateOptionalCalendarTime(null, '   ')).toBeNull();
    expect(validateOptionalCalendarTime('2027-05-01', '9:05')).toBe('09:05');

    expect(() => validateOptionalCalendarTime(null, '10:30')).toThrow(CalendarValidationError);
    expect(() => validateOptionalCalendarTime('', '09:00')).toThrow(CalendarValidationError);
    expect(() => validateOptionalCalendarTime('2027-05-01', '25:00')).toThrow(CalendarValidationError);

    expect(formatTimeOrUnspecified(null)).toBe(UNSPECIFIED_TIME_LABEL);
    expect(formatTimeOrUnspecified('')).toBe(UNSPECIFIED_TIME_LABEL);
    expect(formatTimeOrUnspecified(null)).not.toContain('00:00');
    expect(formatTimeOrUnspecified('14:30')).toBe('2:30 م');
    expect(formatTimeOrUnspecified('14:60')).toBe('14:60');
    expect(formatTimeOrUnspecified('09:99')).toBe('09:99');
    expect(formatTimeOrUnspecified('24:00')).toBe('24:00');
    expect(formatCairoDateArabic('2027-04-30')).toContain('أبريل');
  });

  it('formats Cairo instants safely with fallback for missing or invalid inputs', () => {
    expect(formatCairoInstantArabic(null)).toBe('—');
    expect(formatCairoInstantArabic(undefined)).toBe('—');
    expect(formatCairoInstantArabic(new Date('invalid'))).toBe('—');
    expect(formatCairoInstantArabic('not-a-timestamp')).toBe('not-a-timestamp');

    const formatted = formatCairoInstantArabic('2027-04-30T10:15:00.000Z');
    expect(formatted).toContain('أبريل');
    expect(formatted).toMatch(/2027|٢٠٢٧/);
  });
});
