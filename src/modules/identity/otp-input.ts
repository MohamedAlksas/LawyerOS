export type OtpValidationCode = 'EMPTY' | 'MALFORMED' | 'TOO_SHORT' | 'TOO_LONG';

export type OtpValidationResult =
  | { valid: true; normalizedCode: string }
  | {
      valid: false;
      code: OtpValidationCode;
      message: string;
    };

/**
 * Normalizes Eastern Arabic-Indic digits (٠-٩) and Persian digits (۰-۹) to standard ASCII (0-9).
 * Preserves leading zeroes and preserves non-digit characters without stripping.
 */
export function normalizeOtpDigits(input: string): string {
  if (!input) return '';
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Parses and validates a TOTP OTP code input.
 * - Converts Eastern Arabic-Indic and Persian digits to ASCII.
 * - Trims leading and trailing whitespace.
 * - Allows an optional single separator (space or hyphen) between two 3-digit groups (e.g. "123 456" or "123-456").
 * - Preserves leading zeroes (e.g. "012345").
 * - Returns structured validation result with Arabic guidance messages.
 */
export function parseAndValidateOtp(input: string): OtpValidationResult {
  if (!input || input.trim().length === 0) {
    return {
      valid: false,
      code: 'EMPTY',
      message: 'يرجى إدخال رمز التحقق المكوّن من 6 أرقام.',
    };
  }

  // 1. Normalize Eastern Arabic-Indic and Persian digits
  const normalized = normalizeOtpDigits(input.trim());

  // Check for allowed single separator between 3-digit groups
  let candidate = normalized;
  if (/^\d{3}[\s-]\d{3}$/.test(normalized)) {
    candidate = normalized.replace(/^(\d{3})[\s-](\d{3})$/, '$1$2');
  }

  // Check for letters or invalid characters
  if (/\D/.test(candidate)) {
    return {
      valid: false,
      code: 'MALFORMED',
      message: 'رمز التحقق يجب أن يحتوي على أرقام فقط.',
    };
  }

  if (candidate.length < 6) {
    return {
      valid: false,
      code: 'TOO_SHORT',
      message: `رمز التحقق غير مكتمل (${candidate.length} من 6 أرقام). يرجى إدخال 6 أرقام.`,
    };
  }

  if (candidate.length > 6) {
    return {
      valid: false,
      code: 'TOO_LONG',
      message: 'رمز التحقق يجب ألا يتجاوز 6 أرقام.',
    };
  }

  return {
    valid: true,
    normalizedCode: candidate,
  };
}

