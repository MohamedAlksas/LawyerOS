/**
 * Normalizes Eastern Arabic-Indic digits (٠-٩) and Persian digits (۰-۹) to standard ASCII (0-9).
 * Preserves leading zeroes and does not strip non-digit characters.
 */
export function normalizeArabicDigits(input: string): string {
  if (!input) return '';
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalizes Arabic text for search matching:
 * 1. Converts Eastern Arabic-Indic and Persian digits to ASCII.
 * 2. Strips Arabic diacritics / tashkeel (fatha, damma, kasra, sukun, shadda, tanween).
 * 3. Strips Tatweel (kashida).
 * 4. Unifies Alef variants (أ, إ, آ, ٱ) -> ا.
 * 5. Normalizes Taa Marbuta (ة) -> ه.
 * 6. Normalizes Alif Maqsura (ى) and Hamza on Yaa (ئ) -> ي.
 * 7. Normalizes Hamza on Waw (ؤ) -> و.
 * 8. Converts Latin characters to lowercase.
 * 9. Collapses whitespace sequences to a single space and trims edges.
 *
 * Does NOT alter the original string in stored records.
 */
export function normalizeArabicText(input: string): string {
  if (!input) return '';
  return normalizeArabicDigits(input)
    .replace(/[\u064B-\u065F\u0670]/g, '') // Tashkeel
    .replace(/\u0640/g, '')                 // Tatweel
    .replace(/[أإآٱ]/g, 'ا')                 // Alef variants
    .replace(/ة/g, 'ه')                     // Taa Marbuta
    .replace(/[ىئ]/g, 'ي')                  // Alif Maqsura & Hamza-on-Yaa
    .replace(/ؤ/g, 'و')                     // Hamza-on-Waw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes phone numbers for duplicate detection and index searching:
 * 1. Converts Arabic-Indic and Persian digits to standard ASCII.
 * 2. Strips spaces, dashes, parentheses, plus signs, and other non-digit characters.
 * 3. Canonicalizes Egyptian prefixes:
 *    - Leading `0020` -> `0`
 *    - Leading `20` (when followed by 9+ digits) -> `0`
 * Preserves leading zeros.
 */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return '';
  let digits = normalizeArabicDigits(input).replace(/\D/g, '');
  if (digits.startsWith('0020')) {
    const rest = digits.slice(4);
    digits = rest.startsWith('0') ? rest : '0' + rest;
  } else if (digits.startsWith('20') && digits.length >= 11) {
    const rest = digits.slice(2);
    digits = rest.startsWith('0') ? rest : '0' + rest;
  }
  return digits;
}

