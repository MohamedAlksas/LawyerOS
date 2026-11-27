import { describe, it, expect } from 'vitest';
import {
  normalizeArabicDigits,
  normalizeArabicText,
  normalizePhone,
} from '@/lib/normalization';

describe('T05-02: Party Search Normalization (Unit)', () => {
  describe('normalizeArabicDigits', () => {
    it('converts Eastern Arabic-Indic digits to ASCII and preserves leading zeroes', () => {
      expect(normalizeArabicDigits('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
      expect(normalizeArabicDigits('٠٠٤٥')).toBe('0045');
    });

    it('converts Persian digits to ASCII', () => {
      expect(normalizeArabicDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    });

    it('preserves surrounding letters and symbols', () => {
      expect(normalizeArabicDigits('توكيل رقم ٠٠٤٥ لسنة ٢٠٢٦')).toBe('توكيل رقم 0045 لسنة 2026');
    });
  });

  describe('normalizeArabicText', () => {
    it('unifies Alef variants (أ، إ، آ، ٱ) into a bare Alef (ا)', () => {
      expect(normalizeArabicText('أحمد')).toBe('احمد');
      expect(normalizeArabicText('إبراهيم')).toBe('ابراهيم');
      expect(normalizeArabicText('آدم')).toBe('ادم');
      expect(normalizeArabicText('ٱمرؤ')).toBe('امرو');
    });

    it('normalizes Taa Marbuta (ة) to Haa (ه)', () => {
      expect(normalizeArabicText('فاطمة')).toBe('فاطمه');
      expect(normalizeArabicText('شركة النيل للمحاماة')).toBe('شركه النيل للمحاماه');
    });

    it('normalizes Alif Maqsura (ى) and Hamza-on-Yaa (ئ) to Yaa (ي)', () => {
      expect(normalizeArabicText('مصطفى')).toBe('مصطفي');
      expect(normalizeArabicText('هدى')).toBe('هدي');
      expect(normalizeArabicText('رئيس')).toBe('رييس');
    });

    it('normalizes Hamza on Waw (ؤ) to Waw (و)', () => {
      expect(normalizeArabicText('لؤي')).toBe('لوي');
    });

    it('strips all Arabic diacritics / tashkeel', () => {
      expect(normalizeArabicText('مُحَمَّدٌ')).toBe('محمد');
      expect(normalizeArabicText('عَبْدُ الرَّحْمَٰنِ')).toBe('عبد الرحمن');
    });

    it('strips Tatweel / Kashida (ـ)', () => {
      expect(normalizeArabicText('مــــحــــمــــد')).toBe('محمد');
    });

    it('collapses multiple whitespace characters and trims edges', () => {
      expect(normalizeArabicText('   أحمد    محمود   علي   ')).toBe('احمد محمود علي');
      expect(normalizeArabicText('أحمد\t\nمحمود')).toBe('احمد محمود');
    });

    it('handles mixed Latin characters by converting to lowercase', () => {
      expect(normalizeArabicText('Vodafone مصر')).toBe('vodafone مصر');
    });
  });

  describe('normalizePhone', () => {
    it('converts Eastern digits to ASCII and preserves leading zero in local Egyptian numbers', () => {
      expect(normalizePhone('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
      expect(normalizePhone('010 1234 5678')).toBe('01012345678');
      expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    });

    it('canonicalizes international Egyptian prefix (+20 or 0020) to local 0-prefix', () => {
      expect(normalizePhone('+201012345678')).toBe('01012345678');
      expect(normalizePhone('00201012345678')).toBe('01012345678');
      expect(normalizePhone('+20 10 1234 5678')).toBe('01012345678');
      expect(normalizePhone('0020 10 1234 5678')).toBe('01012345678');
      expect(normalizePhone('+20 (0)1012345678')).toBe('01012345678');
    });

    it('handles Egyptian landline numbers with area codes', () => {
      expect(normalizePhone('02 2345 6789')).toBe('0223456789');
      expect(normalizePhone('+20223456789')).toBe('0223456789');
    });

    it('returns empty string for null, undefined, or empty inputs', () => {
      expect(normalizePhone(null)).toBe('');
      expect(normalizePhone(undefined)).toBe('');
      expect(normalizePhone('')).toBe('');
    });
  });
});

