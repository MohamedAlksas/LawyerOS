import { describe, it, expect } from 'vitest';
import { normalizeOtpDigits } from '@/app/verify/page';

describe('OTP digit normalizer (F09)', () => {
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

  it('normalizes mixed numeral systems and strips non-numeric characters and spaces', () => {
    expect(normalizeOtpDigits('١2۳4٥6')).toBe('123456');
    expect(normalizeOtpDigits('  ١٢٣ ٤٥٦  ')).toBe('123456');
    expect(normalizeOtpDigits('otp: ١٢٣-٤٥٦!')).toBe('123456');
  });

  it('handles empty or non-digit input gracefully', () => {
    expect(normalizeOtpDigits('')).toBe('');
    expect(normalizeOtpDigits('abcdef')).toBe('');
    expect(normalizeOtpDigits('   ')).toBe('');
  });
});
