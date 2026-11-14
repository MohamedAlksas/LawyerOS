import { describe, it, expect } from 'vitest';
import { normalizeOtpDigits, parseAndValidateOtp } from '@/modules/identity/otp-input';

describe('OTP digit normalizer and validator (R10-05 / F09)', () => {
  describe('normalizeOtpDigits', () => {
    it('converts Eastern Arabic-Indic digits (٠-٩) to ASCII digits', () => {
      expect(normalizeOtpDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
      expect(normalizeOtpDigits('١٢٣٤٥٦')).toBe('123456');
    });

    it('converts Persian/Extended Arabic-Indic digits (۰-۹) to ASCII digits', () => {
      expect(normalizeOtpDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
      expect(normalizeOtpDigits('۱۲۳۴۵۶')).toBe('123456');
    });

    it('preserves standard Latin ASCII digits (0-9)', () => {
      expect(normalizeOtpDigits('0123456789')).toBe('0123456789');
      expect(normalizeOtpDigits('654321')).toBe('654321');
    });

    it('preserves leading zeroes', () => {
      expect(normalizeOtpDigits('٠١٢٣٤٥')).toBe('012345');
      expect(normalizeOtpDigits('۰۱۲۳۴۵')).toBe('012345');
    });

    it('preserves non-digit characters without stripping them', () => {
      expect(normalizeOtpDigits('otp-١٢٣')).toBe('otp-123');
      expect(normalizeOtpDigits('abc def')).toBe('abc def');
    });

    it('handles empty input gracefully', () => {
      expect(normalizeOtpDigits('')).toBe('');
    });
  });

  describe('parseAndValidateOtp', () => {
    it('validates standard 6-digit ASCII numbers', () => {
      const res = parseAndValidateOtp('123456');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.normalizedCode).toBe('123456');
      }
    });

    it('preserves leading zeroes on valid 6-digit codes', () => {
      const res = parseAndValidateOtp('012345');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.normalizedCode).toBe('012345');
      }
    });

    it('normalizes Eastern Arabic-Indic numerals and preserves leading zeroes', () => {
      const res = parseAndValidateOtp('٠١٢٣٤٥');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.normalizedCode).toBe('012345');
      }
    });

    it('normalizes Persian numerals', () => {
      const res = parseAndValidateOtp('۰۱۲۳۴۵');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.normalizedCode).toBe('012345');
      }
    });

    it('normalizes mixed numeral systems', () => {
      const res = parseAndValidateOtp('١2۳4٥6');
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.normalizedCode).toBe('123456');
      }
    });

    it('allows a single space or hyphen separator between 3-digit groups', () => {
      const withSpace = parseAndValidateOtp('123 456');
      expect(withSpace.valid).toBe(true);
      if (withSpace.valid) {
        expect(withSpace.normalizedCode).toBe('123456');
      }

      const withHyphen = parseAndValidateOtp('123-456');
      expect(withHyphen.valid).toBe(true);
      if (withHyphen.valid) {
        expect(withHyphen.normalizedCode).toBe('123456');
      }

      const arabicWithHyphen = parseAndValidateOtp('  ١٢٣-٤٥٦  ');
      expect(arabicWithHyphen.valid).toBe(true);
      if (arabicWithHyphen.valid) {
        expect(arabicWithHyphen.normalizedCode).toBe('123456');
      }
    });

    it('returns EMPTY code for empty or whitespace-only inputs', () => {
      const emptyRes = parseAndValidateOtp('');
      expect(emptyRes).toEqual({
        valid: false,
        code: 'EMPTY',
        message: 'يرجى إدخال رمز التحقق المكوّن من 6 أرقام.',
      });

      const spacesRes = parseAndValidateOtp('   ');
      expect(spacesRes).toEqual({
        valid: false,
        code: 'EMPTY',
        message: 'يرجى إدخال رمز التحقق المكوّن من 6 أرقام.',
      });
    });

    it('returns MALFORMED code for inputs containing letters or invalid separators', () => {
      const letterRes = parseAndValidateOtp('12a456');
      expect(letterRes).toEqual({
        valid: false,
        code: 'MALFORMED',
        message: 'رمز التحقق يجب أن يحتوي على أرقام فقط.',
      });

      const symbolRes = parseAndValidateOtp('12.3456');
      expect(symbolRes).toEqual({
        valid: false,
        code: 'MALFORMED',
        message: 'رمز التحقق يجب أن يحتوي على أرقام فقط.',
      });

      const badSpacingRes = parseAndValidateOtp('12 34 56');
      expect(badSpacingRes).toEqual({
        valid: false,
        code: 'MALFORMED',
        message: 'رمز التحقق يجب أن يحتوي على أرقام فقط.',
      });

      const arabicLetterRes = parseAndValidateOtp('رمز123');
      expect(arabicLetterRes).toEqual({
        valid: false,
        code: 'MALFORMED',
        message: 'رمز التحقق يجب أن يحتوي على أرقام فقط.',
      });
    });

    it('returns TOO_SHORT code for inputs with fewer than 6 digits', () => {
      const short5 = parseAndValidateOtp('12345');
      expect(short5).toEqual({
        valid: false,
        code: 'TOO_SHORT',
        message: 'رمز التحقق غير مكتمل (5 من 6 أرقام). يرجى إدخال 6 أرقام.',
      });

      const shortArabic = parseAndValidateOtp('١٢٣');
      expect(shortArabic).toEqual({
        valid: false,
        code: 'TOO_SHORT',
        message: 'رمز التحقق غير مكتمل (3 من 6 أرقام). يرجى إدخال 6 أرقام.',
      });
    });

    it('returns TOO_LONG code for inputs with more than 6 digits', () => {
      const long7 = parseAndValidateOtp('1234567');
      expect(long7).toEqual({
        valid: false,
        code: 'TOO_LONG',
        message: 'رمز التحقق يجب ألا يتجاوز 6 أرقام.',
      });

      const longArabic = parseAndValidateOtp('١٢٣٤٥٦٧٨');
      expect(longArabic).toEqual({
        valid: false,
        code: 'TOO_LONG',
        message: 'رمز التحقق يجب ألا يتجاوز 6 أرقام.',
      });
    });
  });
});

