import { z } from 'zod';
import { normalizeArabicDigits } from '@/lib/normalization';

export class ValidationError extends Error {
  public readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Validates Egyptian and international phone numbers.
 * Accepts ASCII digits (0-9), Arabic-Indic digits (٠-٩), and Persian digits (۰-۹),
 * along with standard separators (spaces, dashes, parentheses, plus sign).
 * Preserves original input while ensuring normalized digit count is between 7 and 20.
 */
const phoneAllowedCharRegex = /^[\d\u0660-\u0669\u06F0-\u06F9\s+()\-]{7,25}$/;

export function isValidPhoneNumber(val: string): boolean {
  if (!phoneAllowedCharRegex.test(val)) return false;
  const digitsOnly = normalizeArabicDigits(val).replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 20;
}

/**
 * Validates actual calendar dates (YYYY-MM-DD) taking into account:
 * - Real calendar months (1-12)
 * - Number of days in each month
 * - Leap year calculation for February (29 days in leap year, 28 otherwise)
 * - Supported year bounds (1900 - 2100)
 * Strictly rejects impossible dates like 2026-02-31, 2026-02-29, 2026-04-31.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (year < 1900 || year > 2100) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [
    31, // Jan
    isLeapYear ? 29 : 28, // Feb
    31, // Mar
    30, // Apr
    31, // May
    30, // Jun
    31, // Jul
    31, // Aug
    30, // Sep
    31, // Oct
    30, // Nov
    31, // Dec
  ];

  const maxDays = daysInMonth[month - 1];
  return day >= 1 && day <= maxDays;
}

/**
 * Strict calendar-valid ISO 8601 instant validator (R2-02).
 * Requirements:
 * 1. Must be full ISO 8601 instant with time and explicit UTC ('Z') or offset ('[+-]HH:MM' or '[+-]HHMM').
 * 2. Rejects date-only strings ('2026-11-18') and offset-free timestamps ('2026-11-18T10:00:00').
 * 3. Enforces calendar date bounds, month limits, and leap-year rules via isValidCalendarDate.
 * 4. Enforces 24-hour time ranges (HH: 00-23, MM: 00-59, SS: 00-59).
 * 5. Rejects impossible calendar instants ('2026-02-30T10:00:00Z', '2026-02-29T10:00:00Z' non-leap).
 */
export function isValidIsoInstant(val: string): boolean {
  if (typeof val !== 'string' || !val) {
    return false;
  }

  const match = val.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/
  );
  if (!match) {
    return false;
  }

  const [, yearStr, monthStr, dayStr, hourStr, minStr, secStr, offsetStr] = match;

  // 1. Calendar date check (year 1900-2100, month 1-12, leap-year days for Feb)
  if (!isValidCalendarDate(`${yearStr}-${monthStr}-${dayStr}`)) {
    return false;
  }

  // 2. Time components check
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  const sec = parseInt(secStr, 10);

  if (hour < 0 || hour > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) {
    return false;
  }

  // 3. Offset check (if not Z)
  if (offsetStr !== 'Z') {
    const cleanOffset = offsetStr.replace(':', '');
    const offsetHours = parseInt(cleanOffset.slice(1, 3), 10);
    const offsetMins = parseInt(cleanOffset.slice(3, 5), 10);
    if (offsetHours > 14 || offsetMins > 59) {
      return false;
    }
  }

  // 4. Safe Date.parse verify
  const parsed = Date.parse(val);
  return !isNaN(parsed);
}

const UNSUPPORTED_RELATIONSHIP_FIELDS = [
  'matterId',
  'documentId',
  'proceedingId',
  'hearingId',
  'taskJobId',
  'invoiceId',
];

export const partyKindSchema = z.enum(['PERSON', 'ORGANIZATION'], {
  message: 'نوع الطرف يجب أن يكون فرداً أو منشأة/شركة.',
});

export const identificationTypeSchema = z.enum(
  ['NATIONAL_ID', 'PASSPORT', 'COMMERCIAL_REG', 'TAX_CARD', 'OTHER'],
  {
    message: 'نوع إثبات الشخصية غير صالح.',
  }
);

export const communicationChannelSchema = z.enum(
  ['PHONE', 'IN_PERSON', 'WHATSAPP', 'EMAIL', 'OTHER'],
  {
    message: 'وسيلة التواصل غير صالحة.',
  }
);

export const poaTypeSchema = z.enum(
  ['GENERAL', 'SPECIAL', 'LITIGATION', 'COMMERCIAL', 'OTHER'],
  {
    message: 'نوع التوكيل غير صالح.',
  }
);

export const poaReviewStatusSchema = z.enum(
  ['UNREVIEWED', 'VALID', 'EXPIRED', 'REVOKED', 'DEFECTIVE'],
  {
    message: 'حالة مراجعة التوكيل غير صالحة.',
  }
);

export const identityInputSchema = z
  .object({
    identificationType: identificationTypeSchema,
    number: z
      .string()
      .trim()
      .min(1, 'رقم إثبات الهوية مطلوب عند تحديد وثيقة.')
      .max(50, 'رقم إثبات الهوية لا يمكن أن يتجاوز 50 حرفاً.'),
  })
  .strict()
  .nullable()
  .optional();

export const savePartySchema = z
  .object({
    id: z.string().uuid('معرف الطرف غير صالح').optional(),
    kind: partyKindSchema,
    name: z
      .string()
      .trim()
      .min(1, 'اسم الطرف مطلوب ولا يمكن أن يكون فارغاً.')
      .max(200, 'اسم الطرف لا يمكن أن يتجاوز 200 حرف.'),
    primaryPhone: z
      .string()
      .trim()
      .refine((val) => val === '' || isValidPhoneNumber(val), {
        message: 'رقم الهاتف يجب أن يحتوي على 7 إلى 20 رقماً بصيغة مقبولة (يقبل الأرقام العربية واللاتينية).',
      })
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    additionalPhones: z
      .array(
        z
          .string()
          .trim()
          .refine((val) => isValidPhoneNumber(val), {
            message: 'رقم الهاتف الإضافي غير صالح (يقبل الأرقام العربية واللاتينية من 7 إلى 20 رقماً).',
          })
      )
      .optional(),
    email: z
      .string()
      .trim()
      .refine(
        (val) =>
          val === '' ||
          (z.string().email().safeParse(val).success && val.length <= 254),
        {
          message: 'صيغة البريد الإلكتروني غير صحيحة.',
        }
      )
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    address: z
      .string()
      .trim()
      .max(500, 'العنوان لا يمكن أن يتجاوز 500 حرف.')
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    notes: z
      .string()
      .trim()
      .max(2000, 'الملاحظات لا يمكن أن تتجاوز 2000 حرف.')
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    identity: identityInputSchema,
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1, 'مفتاح التكرار مطلوب.')
      .max(100, 'مفتاح التكرار طويل جداً.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    // If id is present (update), expectedVersion is strictly required
    if (data.id && (data.expectedVersion === undefined || data.expectedVersion === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedVersion'],
        message: 'رقم الإصدار المتوقع (expectedVersion) مطلوب عند تعديل بيانات الطرف.',
      });
    }
    // Check unsupported relationship fields
    for (const field of UNSUPPORTED_RELATIONSHIP_FIELDS) {
      if (field in (data as Record<string, unknown>)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `الحقل '${field}' غير مدعوم في هذا الإصدار (T05 لا يدعم ربط القضايا أو المستندات).`,
        });
      }
    }
  });

export const addCommunicationNoteSchema = z
  .object({
    partyId: z.string().uuid('معرف الطرف غير صالح.'),
    communicationAt: z
      .string()
      .trim()
      .refine(isValidIsoInstant, {
        message: 'تاريخ ووقت التواصل غير صالح (يجب أن يكون بصيغة ISO صالحة مع منطقة زمنية محددة مثل UTC أو فارق توقيت).',
      }),
    channel: communicationChannelSchema,
    summary: z
      .string()
      .trim()
      .min(1, 'ملخص التواصل مطلوب.')
      .max(1000, 'ملخص التواصل لا يمكن أن يتجاوز 1000 حرف.'),
    followUpRequired: z.boolean().optional().default(false),
    followUpDate: z
      .string()
      .trim()
      .refine((val) => val === '' || isValidCalendarDate(val), {
        message: 'تاريخ المتابعة غير صالح في التقويم (يجب أن يكون تاريخاً صحيحاً بصيغة YYYY-MM-DD).',
      })
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1, 'مفتاح التكرار مطلوب.')
      .max(100, 'مفتاح التكرار طويل جداً.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    for (const field of UNSUPPORTED_RELATIONSHIP_FIELDS) {
      if (field in (data as Record<string, unknown>)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `الحقل '${field}' غير مدعوم في هذا الإصدار (T05 لا يدعم ربط القضايا أو المستندات).`,
        });
      }
    }
  });

export const savePowerOfAttorneySchema = z
  .object({
    id: z.string().uuid('معرف التوكيل غير صالح.').optional(),
    partyId: z.string().uuid('معرف الطرف غير صالح.'),
    poaNumberText: z
      .string()
      .trim()
      .min(1, 'رقم التوكيل مطلوب.')
      .max(50, 'رقم التوكيل لا يتجاوز 50 حرفاً.'),
    poaYearLabel: z
      .string()
      .trim()
      .min(1, 'سنة التوكيل مطلوبة.')
      .max(20, 'سنة التوكيل غير صالحة.'),
    notarizationOffice: z
      .string()
      .trim()
      .min(1, 'مكتب التوثيق مطلوب.')
      .max(100, 'مكتب التوثيق لا يتجاوز 100 حرف.'),
    poaType: poaTypeSchema,
    issueDate: z
      .string()
      .trim()
      .refine((val) => val === '' || isValidCalendarDate(val), {
        message: 'تاريخ الإصدار غير صالح في التقويم (يجب أن يكون تاريخاً صحيحاً بصيغة YYYY-MM-DD).',
      })
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    humanReviewStatus: poaReviewStatusSchema.optional(),
    notes: z
      .string()
      .trim()
      .max(2000, 'الملاحظات لا تتجاوز 2000 حرف.')
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1, 'مفتاح التكرار مطلوب.')
      .max(100, 'مفتاح التكرار طويل جداً.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.id && (data.expectedVersion === undefined || data.expectedVersion === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedVersion'],
        message: 'رقم الإصدار المتوقع (expectedVersion) مطلوب عند تعديل التوكيل.',
      });
    }
    for (const field of UNSUPPORTED_RELATIONSHIP_FIELDS) {
      if (field in (data as Record<string, unknown>)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `الحقل '${field}' غير مدعوم في هذا الإصدار (T05 لا يدعم ربط القضايا أو المستندات).`,
        });
      }
    }
  })
  .transform((data) => data.id || data.humanReviewStatus !== undefined
    ? data
    : { ...data, humanReviewStatus: 'UNREVIEWED' as const });

/**
 * Validates input against a schema and throws a structured ValidationError with Arabic messages.
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        const keys = (issue as { keys?: string[] }).keys || [];
        for (const key of keys) {
          fieldErrors[key] = `الحقل '${key}' غير مدعوم أو غير معترف به.`;
        }
      } else {
        const field = issue.path.join('.') || 'root';
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
    }
    const firstMessage = result.error.issues[0]?.message || 'بيانات المدخلات غير صالحة.';
    throw new ValidationError(firstMessage, fieldErrors);
  }
  return result.data;
}

