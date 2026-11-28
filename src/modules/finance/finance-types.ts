import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import {
  FeeAgreementStatus,
  FeeChargingMethod,
  MoneyAccountType,
  MoneyAllocationAction,
  MoneyLineSide,
  MoneyTransactionKind,
  MoneyTransactionStatus,
  PaymentMethod,
} from '@prisma/client';
import { validateStrictCalendarDate } from '@/lib/cairo-date';
import { normalizeArabicDigits } from '@/lib/normalization';

export {
  FeeAgreementStatus,
  FeeChargingMethod,
  MoneyAccountType,
  MoneyAllocationAction,
  MoneyLineSide,
  MoneyTransactionKind,
  MoneyTransactionStatus,
  PaymentMethod,
};

export const EGP_CURRENCY = 'EGP' as const;
export const ADMINISTRATIVE_RECEIPT_NOTICE_AR =
  'إيصال تحصيل إداري — للاستخدام الداخلي بالمكتب وليس مستنداً ضريبياً.';

export const SUPPORTED_T13_TRANSACTION_KINDS = ['FEE_PAYMENT'] as const;
export const DOCUMENTED_FUTURE_TRANSACTION_KINDS = [
  'FEE_CHARGE',
  'REIMBURSABLE_EXPENSE',
  'EXPENSE_REIMBURSEMENT',
  'ADVANCE_RECEIPT',
  'ADVANCE_SPEND',
  'ADVANCE_TO_FEE',
  'MIXED_RECEIPT',
  'REFUND',
  'REVERSAL',
  'OPENING_BALANCE',
  'FEE_ADJUSTMENT',
] as const;

export const MAX_FINANCE_PAGE = 100;
export const MAX_FINANCE_LIMIT = 100;
export const MAX_PIASTRE_AMOUNT = 10_000_000_000_000_000n;
const MAX_AMOUNT_INPUT_LENGTH = 32;

export class FinanceValidationError extends Error {
  fieldErrors?: Record<string, string>;
  code?: string;

  constructor(message: string, fieldErrors?: Record<string, string>, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'FinanceValidationError';
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

export class UnsupportedTransactionKindError extends Error {
  readonly code = 'UNSUPPORTED_TRANSACTION_KIND' as const;
  constructor(message = 'نوع الحركة المالية غير مدعوم في هذه المرحلة.') {
    super(message);
    this.name = 'UnsupportedTransactionKindError';
  }
}

export class ExcessAllocationError extends Error {
  readonly code = 'EXCESS_OVERPAYMENT' as const;
  constructor(
    message = 'المبلغ المطلوب يتجاوز الرصيد المستحق على القسط. لا يتم تحويل الفائض تلقائياً إلى دفعة مقدمة.'
  ) {
    super(message);
    this.name = 'ExcessAllocationError';
  }
}

export class ImmutablePostedRecordError extends Error {
  readonly code = 'IMMUTABLE_POSTED_RECORD' as const;
  constructor(
    message = 'السجلات المالية المرحلة غير قابلة للتعديل أو الحذف. استخدم مسار التصحيح المعتمد عند توفره.'
  ) {
    super(message);
    this.name = 'ImmutablePostedRecordError';
  }
}

export class ScopeMismatchError extends Error {
  readonly code = 'CROSS_MATTER_LINK_FORBIDDEN' as const;
  constructor(message = 'البند أو الموكل المحدد لا يتبع نفس ملف القضية أو الموكل المسؤول.') {
    super(message);
    this.name = 'ScopeMismatchError';
  }
}

export class ConcurrencyConflictError extends Error {
  readonly code = 'CONCURRENCY_CONFLICT' as const;
  constructor(message = 'تم تعديل السجل بواسطة مستخدم آخر. يرجى إعادة التحميل والمحاولة مرة أخرى.') {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  constructor(message = 'السجل المالي المطلوب غير موجود.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class MatterArchivedError extends Error {
  readonly code = 'MATTER_ARCHIVED' as const;
  constructor(message = 'ملف القضية مؤرشف ولا يمكن تسجيل عمليات مالية جديدة عليه.') {
    super(message);
    this.name = 'MatterArchivedError';
  }
}

export class AlreadyPostedError extends Error {
  readonly code = 'ALREADY_POSTED' as const;
  constructor(message = 'تم ترحيل هذا الاتفاق بالفعل ولا يمكن تعديله أو اعتماده مرة أخرى.') {
    super(message);
    this.name = 'AlreadyPostedError';
  }
}

export class UnsupportedTransitionError extends Error {
  readonly code = 'UNSUPPORTED_TRANSITION' as const;
  constructor(message = 'الانتقال المطلوب لحالة الاتفاق المالي غير مسموح به.') {
    super(message);
    this.name = 'UnsupportedTransitionError';
  }
}

export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHENTICATED' as const;
  constructor(message = 'غير مصرح. يرجى تسجيل الدخول أولاً.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export type FinanceActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: string; fieldErrors?: Record<string, string> };

export interface FinanceExecutionOptions {
  simulateFailure?: boolean;
  prismaOverride?: PrismaClient;
}

/**
 * Parses a positive integer amount in EGP piastres (BigInt > 0n).
 * Accepts Arabic-Indic / Persian / Latin digit strings, BigInt, or safe positive integers.
 * Explicitly rejects floats, decimals, zero, negative numbers, and invalid text.
 */
export function parsePositivePiastres(value: unknown, fieldName = 'amountPiastres'): bigint {
  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new FinanceValidationError('المبلغ يجب أن يكون أكبر من صفر.', {
        [fieldName]: 'المبلغ يجب أن يكون أكبر من صفر',
      });
    }
    if (value > MAX_PIASTRE_AMOUNT) {
      throw new FinanceValidationError('المبلغ يتجاوز الحد الأقصى المسموح به.', {
        [fieldName]: 'المبلغ يتجاوز الحد الأقصى المسموح به',
      });
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new FinanceValidationError('قيمة المبلغ بالقروش يجب أن تكون رقماً صحيحاً بدون كسور.', {
        [fieldName]: 'ممنوع استخدام الأرقام العشرية (Floats) لقيمة القروش',
      });
    }
    if (value <= 0) {
      throw new FinanceValidationError('المبلغ يجب أن يكون أكبر من صفر.', {
        [fieldName]: 'المبلغ يجب أن يكون أكبر من صفر',
      });
    }
    const parsed = BigInt(value);
    if (parsed > MAX_PIASTRE_AMOUNT) {
      throw new FinanceValidationError('المبلغ يتجاوز الحد الأقصى المسموح به.', {
        [fieldName]: 'المبلغ يتجاوز الحد الأقصى المسموح به',
      });
    }
    return parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > MAX_AMOUNT_INPUT_LENGTH) {
      throw new FinanceValidationError('المبلغ يتجاوز الحد الأقصى المسموح به.', {
        [fieldName]: 'طول المبلغ النصي يتجاوز الحد الأقصى المسموح به',
      });
    }
    const normalized = normalizeArabicDigits(trimmed);
    if (!/^\d+$/.test(normalized)) {
      throw new FinanceValidationError('صيغة المبلغ بالقروش غير صالحة (يجب أن تكون أرقاماً صحيحة موجبة).', {
        [fieldName]: 'أدخل مبلغاً صحيحاً موجباً بالقروش بدون علامات عشرية أو سالبة',
      });
    }
    const parsed = BigInt(normalized);
    if (parsed <= 0n) {
      throw new FinanceValidationError('المبلغ يجب أن يكون أكبر من صفر.', {
        [fieldName]: 'المبلغ يجب أن يكون أكبر من صفر',
      });
    }
    if (parsed > MAX_PIASTRE_AMOUNT) {
      throw new FinanceValidationError('المبلغ يتجاوز الحد الأقصى المسموح به.', {
        [fieldName]: 'المبلغ يتجاوز الحد الأقصى المسموح به',
      });
    }
    return parsed;
  }

  throw new FinanceValidationError('صيغة المبلغ غير صالحة.', {
    [fieldName]: 'المبلغ مطلوب بصيغة نصية أو رقمية صحيحة',
  });
}

/**
 * Parses a human-entered EGP string (e.g. "15000", "١٥٠٠٠", "5000.25", "٥٠٠٠٫٢٥", "15,000")
 * into exact BigInt piastres without using floating-point arithmetic.
 */
export function parseEgpToPiastres(value: unknown, fieldName = 'amountEgp'): bigint {
  if (typeof value !== 'string') {
    throw new FinanceValidationError('مبلغ الجنيه المصري يجب أن يُرسل كنص لتجنب أخطاء الكسور العائمة.', {
      [fieldName]: 'أدخل المبلغ كنص صالح',
    });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new FinanceValidationError('المبلغ مطلوب.', {
      [fieldName]: 'المبلغ مطلوب',
    });
  }
  if (trimmed.length > MAX_AMOUNT_INPUT_LENGTH) {
    throw new FinanceValidationError('المبلغ يتجاوز الحد الأقصى المسموح به.', {
      [fieldName]: 'طول المبلغ النصي يتجاوز الحد الأقصى المسموح به',
    });
  }

  // Normalize Arabic-Indic/Persian digits, Arabic decimal separator (٫), and Arabic thousands separator (٬)
  let normalized = normalizeArabicDigits(trimmed)
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, ',');

  // Strip valid comma thousands grouping only when unambiguous (e.g., 15,000 or 1,250,000.50)
  if (/^[1-9]\d{0,2}(,\d{3})+(\.\d{1,2})?$/.test(normalized)) {
    normalized = normalized.replace(/,/g, '');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new FinanceValidationError(
      'صيغة المبلغ بالجنيه غير صالحة (أدخل رقماً موجباً بحد أقصى منزلتين عشريتين للقروش).',
      {
        [fieldName]: 'صيغة غير صالحة؛ يسمح برقم موجب مع قرشين كحد أقصى',
      }
    );
  }

  const [wholePart, fracPart = ''] = normalized.split('.');
  const paddedFrac = fracPart.padEnd(2, '0');
  const piastres = BigInt(wholePart) * 100n + BigInt(paddedFrac);

  if (piastres <= 0n) {
    throw new FinanceValidationError('المبلغ يجب أن يكون أكبر من صفر.', {
      [fieldName]: 'المبلغ يجب أن يكون أكبر من صفر',
    });
  }
  if (piastres > MAX_PIASTRE_AMOUNT) {
    throw new FinanceValidationError('المبلغ يتجاوز الحد الأقصى المسموح به.', {
      [fieldName]: 'المبلغ يتجاوز الحد الأقصى المسموح به',
    });
  }

  return piastres;
}

/**
 * Converts exact BigInt or string piastres to a machine-safe decimal EGP string (e.g. "15000.00")
 * using pure BigInt division/modulo.
 */
export function piastresToEgpDecimalString(piastres: bigint | string): string {
  const val = typeof piastres === 'bigint' ? piastres : BigInt(piastres);
  const neg = val < 0n;
  const abs = neg ? -val : val;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/**
 * Formats exact BigInt or string piastres for Arabic operational display (e.g. "15,000 ج.م." or "15,000.50 ج.م.")
 * using pure BigInt math and string grouping.
 */
export function formatEgpPiastres(
  piastres: bigint | string,
  options: { showZeroDecimals?: boolean; includeCurrency?: boolean } = {}
): string {
  const { showZeroDecimals = false, includeCurrency = true } = options;
  const val = typeof piastres === 'bigint' ? piastres : BigInt(piastres);
  const neg = val < 0n;
  const abs = neg ? -val : val;
  const whole = abs / 100n;
  const frac = abs % 100n;

  const wholeGrouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr =
    frac > 0n || showZeroDecimals ? `.${frac.toString().padStart(2, '0')}` : '';
  const sign = neg ? '-' : '';
  return `${sign}${wholeGrouped}${fracStr}${includeCurrency ? ' ج.م.' : ''}`;
}

function tryParsePositivePiastresToString(value: unknown): string | null {
  try {
    return parsePositivePiastres(value).toString();
  } catch {
    return null;
  }
}

export const positivePiastresSchema = z
  .union([z.string(), z.number(), z.bigint()], {
    error: 'المبلغ بالقروش يجب أن يكون رقماً صحيحاً موجباً أكبر من صفر بدون كسور.',
  })
  .transform((val, ctx) => {
    const parsed = tryParsePositivePiastresToString(val);
    if (!parsed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'المبلغ بالقروش يجب أن يكون رقماً صحيحاً موجباً أكبر من صفر بدون كسور.',
      });
      return z.NEVER;
    }
    return parsed;
  });

const strictDateSchema = z
  .string({ error: 'التاريخ مطلوب بصيغة YYYY-MM-DD.' })
  .trim()
  .refine((val) => validateStrictCalendarDate(val), {
    message: 'التاريخ غير صالح (يجب أن يكون بصيغة YYYY-MM-DD وتاريخ تقويمي صحيح).',
  });

const optionalDateSchema = z
  .string({ error: 'التاريخ يجب أن يكون نصاً بصيغة YYYY-MM-DD.' })
  .trim()
  .optional()
  .nullable()
  .transform((val) => (val === '' || val === undefined || val === null ? null : val))
  .refine((val) => val === null || validateStrictCalendarDate(val), {
    message: 'التاريخ غير صالح (يجب أن يكون بصيغة YYYY-MM-DD وتاريخ تقويمي صحيح).',
  });

const nonEmptyIdempotencyKeySchema = z
  .string({ error: 'مفتاح منع التكرار مطلوب.' })
  .trim()
  .min(1, 'مفتاح منع التكرار لا يمكن أن يكون فارغاً.')
  .max(200, 'مفتاح منع التكرار طويل جداً.');

export const saveFeeAgreementDraftSchema = z
  .object({
    feeAgreementId: z
      .string({ error: 'معرف اتفاق الأتعاب غير صالح.' })
      .uuid('معرف اتفاق الأتعاب غير صالح.')
      .optional(),
    expectedVersion: z
      .number({ error: 'رقم الإصدار المتوقع غير صالح.' })
      .int('رقم الإصدار المتوقع يجب أن يكون رقماً صحيحاً.')
      .min(1, 'رقم الإصدار غير صالح.')
      .optional(),
    matterId: z
      .string({ error: 'معرف ملف القضية مطلوب.' })
      .uuid('معرف ملف القضية غير صالح.'),
    clientMatterPartyId: z
      .string({ error: 'معرف الموكل بالملف مطلوب.' })
      .uuid('معرف الموكل بالملف غير صالح.'),
    description: z
      .string({ error: 'وصف اتفاق الأتعاب مطلوب.' })
      .trim()
      .min(1, 'وصف اتفاق الأتعاب مطلوب.')
      .max(500, 'وصف اتفاق الأتعاب لا يجب أن يتجاوز 500 حرف.'),
    totalAmountPiastres: positivePiastresSchema,
    agreementDate: strictDateSchema,
    chargingMethod: z.nativeEnum(FeeChargingMethod, {
      error: 'طريقة احتساب الأتعاب غير صالحة.',
    }),
    agreementDocumentId: z
      .string({ error: 'معرف المستند غير صالح.' })
      .uuid('معرف المستند غير صالح.')
      .optional()
      .nullable(),
    notes: z
      .string({ error: 'الملاحظات غير صالحة.' })
      .trim()
      .max(2000, 'الملاحظات لا يجب أن تتجاوز 2000 حرف.')
      .optional()
      .nullable()
      .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
    idempotencyKey: nonEmptyIdempotencyKeySchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.feeAgreementId && data.expectedVersion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedVersion'],
        message: 'رقم الإصدار المتوقع مطلوب عند تحديث مسودة اتفاق الأتعاب.',
      });
    }
  });

export const feeInstallmentInputSchema = z
  .object({
    description: z
      .string({ error: 'وصف القسط مطلوب.' })
      .trim()
      .min(1, 'وصف القسط مطلوب.')
      .max(300, 'وصف القسط لا يجب أن يتجاوز 300 حرف.'),
    dueDate: optionalDateSchema,
    amountPiastres: positivePiastresSchema,
  })
  .strict();

export const approveFeeAgreementSchema = z
  .object({
    feeAgreementId: z
      .string({ error: 'معرف اتفاق الأتعاب مطلوب.' })
      .uuid('معرف اتفاق الأتعاب غير صالح.'),
    expectedVersion: z
      .number({ error: 'رقم الإصدار المتوقع غير صالح.' })
      .int('رقم الإصدار المتوقع يجب أن يكون رقماً صحيحاً.')
      .min(1, 'رقم الإصدار المتوقع غير صالح.'),
    transactionDate: optionalDateSchema,
    installments: z
      .array(feeInstallmentInputSchema, { error: 'قائمة الأقساط غير صالحة.' })
      .max(100, 'عدد الأقساط كبير جداً.')
      .optional(),
    idempotencyKey: nonEmptyIdempotencyKeySchema,
  })
  .strict();

export const feeAllocationInputSchema = z
  .object({
    feeChargeId: z
      .string({ error: 'معرف القسط أو البند المستحق مطلوب.' })
      .uuid('معرف القسط أو البند المستحق غير صالح.'),
    amountPiastres: positivePiastresSchema,
  })
  .strict();

export const explicitLedgerLineInputSchema = z
  .object({
    accountType: z
      .string({ error: 'نوع الحساب غير صالح.' })
      .trim()
      .min(1, 'نوع الحساب لا يمكن أن يكون فارغاً.')
      .optional(),
    side: z.nativeEnum(MoneyLineSide, {
      error: 'اتجاه القيد المالي غير صالح.',
    }),
    amountPiastres: positivePiastresSchema,
  })
  .strict();

export const postTransactionSchema = z
  .object({
    kind: z.literal('FEE_PAYMENT', {
      error: 'نوع الحركة المالية غير مدعوم في هذه المرحلة.',
    }),
    matterId: z
      .string({ error: 'معرف ملف القضية مطلوب.' })
      .uuid('معرف ملف القضية غير صالح.'),
    clientMatterPartyId: z
      .string({ error: 'معرف الموكل المسؤول مطلوب.' })
      .uuid('معرف الموكل المسؤول غير صالح.'),
    payerPartyId: z
      .string({ error: 'معرف الدافع غير صالح.' })
      .uuid('معرف الدافع غير صالح.')
      .optional()
      .nullable(),
    transactionDate: strictDateSchema,
    paymentMethod: z.nativeEnum(PaymentMethod, {
      error: 'طريقة السداد غير صالحة.',
    }),
    totalAmountPiastres: positivePiastresSchema,
    reference: z
      .string({ error: 'المرجع غير صالح.' })
      .trim()
      .max(120, 'المرجع لا يجب أن يتجاوز 120 حرفاً.')
      .optional()
      .nullable()
      .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
    description: z
      .string({ error: 'الوصف غير صالح.' })
      .trim()
      .max(500, 'الوصف لا يجب أن يتجاوز 500 حرف.')
      .optional(),
    allocations: z
      .array(feeAllocationInputSchema, { error: 'قائمة التوزيعات غير صالحة.' })
      .min(1, 'يجب تحديد توزيع واحد على الأقل على بنود الأتعاب المستحقة.')
      .max(100, 'عدد بنود التوزيع في الدفعة الواحدة كبير جداً.'),
    lines: z
      .array(explicitLedgerLineInputSchema, { error: 'قائمة السطور المالية غير صالحة.' })
      .max(20, 'عدد سطور القيد المالي كبير جداً.')
      .optional(),
    idempotencyKey: nonEmptyIdempotencyKeySchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    const seenCharges = new Set<string>();
    let allocSum = 0n;
    for (const [idx, alloc] of data.allocations.entries()) {
      if (seenCharges.has(alloc.feeChargeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allocations', idx, 'feeChargeId'],
          message: 'لا يمكن تكرار نفس بند الأتعاب في الدفعة الواحدة.',
        });
      }
      seenCharges.add(alloc.feeChargeId);
      allocSum += BigInt(alloc.amountPiastres);
    }

    const total = BigInt(data.totalAmountPiastres);
    if (allocSum !== total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allocations'],
        message: 'مجموع التوزيعات يجب أن يساوي إجمالي مبلغ الدفعة تماماً.',
      });
    }

    if (data.lines !== undefined) {
      if (data.lines.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines'],
          message: 'القيد المالي يجب أن يحتوي على سطرين متوازنين على الأقل (مدين ودائن).',
        });
      } else {
        let debitSum = 0n;
        let creditSum = 0n;
        for (const line of data.lines) {
          const amt = BigInt(line.amountPiastres);
          if (line.side === 'DEBIT') debitSum += amt;
          else creditSum += amt;
        }
        if (debitSum <= 0n || debitSum !== creditSum || debitSum !== total) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lines'],
            message: 'السطور المالية غير متوازنة (يجب أن يتساوى إجمالي المدين مع الدائن ومع إجمالي الحركة).',
          });
        }
      }
    }
  });

export const getClientStatementSchema = z
  .object({
    matterId: z
      .string({ error: 'معرف ملف القضية غير صالح.' })
      .uuid('معرف ملف القضية غير صالح.')
      .optional(),
    partyId: z
      .string({ error: 'معرف الموكل غير صالح.' })
      .uuid('معرف الموكل غير صالح.')
      .optional(),
    clientMatterPartyId: z
      .string({ error: 'معرف ارتباط الموكل بالملف غير صالح.' })
      .uuid('معرف ارتباط الموكل بالملف غير صالح.')
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.matterId && !data.partyId && !data.clientMatterPartyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'يجب تحديد ملف القضية أو الموكل لعرض كشف الحساب.',
      });
    }
  });

export const listFinanceOverviewSchema = z
  .object({
    matterId: z
      .string({ error: 'معرف ملف القضية غير صالح.' })
      .uuid('معرف ملف القضية غير صالح.')
      .optional(),
    q: z
      .string({ error: 'نص البحث غير صالح.' })
      .trim()
      .max(120, 'نص البحث لا يجب أن يتجاوز 120 حرفاً.')
      .optional(),
    page: z
      .number({ error: 'رقم الصفحة غير صالح.' })
      .int('رقم الصفحة يجب أن يكون رقماً صحيحاً.')
      .min(1, 'رقم الصفحة يجب أن لا يقل عن 1.')
      .max(MAX_FINANCE_PAGE, `رقم الصفحة لا يجب أن يتجاوز ${MAX_FINANCE_PAGE}.`)
      .default(1),
    limit: z
      .number({ error: 'حد النتائج غير صالح.' })
      .int('حد النتائج يجب أن يكون رقماً صحيحاً.')
      .min(1, 'حد النتائج يجب أن لا يقل عن 1.')
      .max(MAX_FINANCE_LIMIT, `حد النتائج لا يجب أن يتجاوز ${MAX_FINANCE_LIMIT}.`)
      .default(20),
  })
  .strict();

export type SaveFeeAgreementDraftInput = z.input<typeof saveFeeAgreementDraftSchema>;
export type ApproveFeeAgreementInput = z.input<typeof approveFeeAgreementSchema>;
export type PostTransactionInput = Omit<z.input<typeof postTransactionSchema>, 'kind'> & {
  kind: MoneyTransactionKind | 'OFFICE_EXPENSE' | string;
};
export type GetClientStatementParams = z.input<typeof getClientStatementSchema>;
export type ListFinanceOverviewParams = z.input<typeof listFinanceOverviewSchema>;

export interface FeeChargeDTO {
  id: string;
  feeAgreementId: string;
  matterId: string;
  clientMatterPartyId: string;
  clientPartyId: string;
  clientName: string;
  installmentNumber: number;
  description: string;
  dueDate: string | null;
  amountPiastres: string;
  allocatedPiastres: string;
  remainingPiastres: string;
  currency: 'EGP';
  receivableLineId: string;
  createdAt: string;
}

export interface FeeAgreementDTO {
  id: string;
  matterId: string;
  matterFileCode: string;
  matterTitle: string;
  clientMatterPartyId: string;
  clientPartyId: string;
  clientName: string;
  description: string;
  totalAmountPiastres: string;
  currency: 'EGP';
  agreementDate: string;
  chargingMethod: FeeChargingMethod;
  agreementDocumentId: string | null;
  status: FeeAgreementStatus;
  approvedTransactionId: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  charges: FeeChargeDTO[];
}

export interface MoneyLineDTO {
  id: string;
  transactionId: string;
  accountId: string;
  accountType: MoneyAccountType;
  side: MoneyLineSide;
  amountPiastres: string;
  currency: 'EGP';
  matterId: string | null;
  clientMatterPartyId: string | null;
  description: string | null;
}

export interface MoneyAllocationDTO {
  id: string;
  settlementLineId: string;
  receivableLineId: string;
  feeChargeId: string | null;
  feeChargeDescription: string | null;
  amountPiastres: string;
  currency: 'EGP';
  action: MoneyAllocationAction;
  createdAt: string;
}

export interface TransactionDTO {
  id: string;
  kind: MoneyTransactionKind;
  status: MoneyTransactionStatus;
  transactionDate: string;
  currency: 'EGP';
  totalAmountPiastres: string;
  paymentMethod: PaymentMethod | null;
  reference: string | null;
  description: string;
  matterId: string | null;
  matterFileCode: string | null;
  matterTitle: string | null;
  payerPartyId: string | null;
  payerName: string | null;
  postedById: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: MoneyLineDTO[];
  allocations: MoneyAllocationDTO[];
  receiptId: string | null;
  receiptNumber: string | null;
}

export interface ReceiptHeaderSnapshot {
  officeName: string;
  lawyerName: string | null;
  phone: string | null;
  address: string | null;
  matterId: string;
  matterFileCode: string;
  matterTitle: string;
  clientMatterPartyId: string;
  clientName: string;
  payerPartyId: string;
  payerName: string;
  paymentMethod: PaymentMethod;
  transactionDate: string;
  reference: string | null;
  description: string;
  allocations: Array<{
    feeChargeId: string;
    installmentNumber: number;
    description: string;
    amountPiastres: string;
  }>;
  feesRemainingAfterPiastres: string;
  administrativeNotice: string;
}

export interface ReceiptDTO {
  id: string;
  transactionId: string;
  receiptNumber: string;
  year: number;
  paymentMethod: PaymentMethod;
  payerName: string;
  amountPiastres: string;
  currency: 'EGP';
  issuedAt: string;
  issuedById: string;
  headerSnapshot: ReceiptHeaderSnapshot;
  administrativeNotice: string;
}

export interface ClientMatterBalanceDTO {
  clientMatterPartyId: string;
  partyId: string;
  partyName: string;
  isPrimaryContact: boolean;
  billingEnabled: boolean;
  feesChargedPiastres: string;
  feesCollectedPiastres: string;
  feesDuePiastres: string;
  expensesDuePiastres: string;
  advanceAvailablePiastres: string;
}

export interface MatterFinanceSummaryDTO {
  matterId: string;
  matterFileCode: string;
  matterTitle: string;
  matterStatus: string;
  currency: 'EGP';
  feesChargedPiastres: string;
  feesCollectedPiastres: string;
  feesDuePiastres: string;
  expensesDuePiastres: string;
  advanceAvailablePiastres: string;
  clients: ClientMatterBalanceDTO[];
  agreements: FeeAgreementDTO[];
  charges: FeeChargeDTO[];
  transactions: TransactionDTO[];
}

export interface ClientStatementDTO {
  scope: {
    matterId: string | null;
    matterFileCode: string | null;
    matterTitle: string | null;
    partyId: string | null;
    partyName: string | null;
    clientMatterPartyId: string | null;
  };
  currency: 'EGP';
  feesChargedPiastres: string;
  feesCollectedPiastres: string;
  feesDuePiastres: string;
  expensesDuePiastres: string;
  advanceAvailablePiastres: string;
  charges: FeeChargeDTO[];
  transactions: TransactionDTO[];
  reconciled: boolean;
}

export interface SelectableMatterClientDTO {
  clientMatterPartyId: string;
  partyId: string;
  partyName: string;
  isPrimaryContact: boolean;
  billingEnabled: boolean;
}

export interface SelectableFinanceMatterDTO {
  matterId: string;
  fileCode: string;
  title: string;
  status: string;
  clients: SelectableMatterClientDTO[];
}

export interface FinanceOverviewDTO {
  currency: 'EGP';
  totals: {
    feesChargedPiastres: string;
    feesCollectedPiastres: string;
    feesDuePiastres: string;
    expensesDuePiastres: string;
    advanceAvailablePiastres: string;
  };
  selectableMatters: SelectableFinanceMatterDTO[];
  agreements: FeeAgreementDTO[];
  openCharges: FeeChargeDTO[];
  recentTransactions: TransactionDTO[];
  selectedMatterSummary: MatterFinanceSummaryDTO | null;
  page: number;
  limit: number;
  totalAgreements: number;
}

export interface ApproveFeeAgreementResult {
  feeAgreement: FeeAgreementDTO;
  transaction: TransactionDTO;
  charges: FeeChargeDTO[];
}

export interface PostTransactionResult {
  transaction: TransactionDTO;
  receipt: ReceiptDTO;
  matterSummary: MatterFinanceSummaryDTO;
}