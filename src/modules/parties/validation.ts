import { z } from 'zod';

export class ValidationError extends Error {
  public readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

const phoneRegex = /^[\d\s+()\-]{7,25}$/;

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
      .refine((val) => val === '' || phoneRegex.test(val), {
        message: 'رقم الهاتف يجب أن يحتوي على 7 إلى 25 رقماً بصيغة مقبولة.',
      })
      .transform((val) => (val === '' ? null : val))
      .nullable()
      .optional(),
    additionalPhones: z
      .array(
        z
          .string()
          .trim()
          .refine((val) => phoneRegex.test(val), {
            message: 'رقم الهاتف الإضافي غير صالح.',
          })
      )
      .optional()
      .default([]),
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
  .superRefine((data, ctx) => {
    // If id is present (update), expectedVersion is strictly required
    if (data.id && (data.expectedVersion === undefined || data.expectedVersion === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedVersion'],
        message: 'رقم الإصدار المتوقع (expectedVersion) مطلوب عند تعديل بيانات الطرف.',
      });
    }
  });

export const addCommunicationNoteSchema = z.object({
  partyId: z.string().uuid('معرف الطرف غير صالح.'),
  communicationAt: z
    .string()
    .trim()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'تاريخ ووقت التواصل غير صالح.',
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
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ المتابعة يجب أن يكون بصيغة YYYY-MM-DD.')
    .nullable()
    .optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1, 'مفتاح التكرار مطلوب.')
    .max(100, 'مفتاح التكرار طويل جداً.'),
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
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ الإصدار يجب أن يكون بصيغة YYYY-MM-DD.')
      .nullable()
      .optional(),
    humanReviewStatus: poaReviewStatusSchema.optional().default('UNREVIEWED'),
    notes: z
      .string()
      .trim()
      .max(2000, 'الملاحظات لا تتجاوز 2000 حرف.')
      .nullable()
      .optional(),
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1, 'مفتاح التكرار مطلوب.')
      .max(100, 'مفتاح التكرار طويل جداً.'),
  })
  .superRefine((data, ctx) => {
    if (data.id && (data.expectedVersion === undefined || data.expectedVersion === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedVersion'],
        message: 'رقم الإصدار المتوقع (expectedVersion) مطلوب عند تعديل التوكيل.',
      });
    }
  });

/**
 * Validates input against a schema and throws a structured ValidationError with Arabic messages.
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || 'root';
      if (!fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    const firstMessage = result.error.issues[0]?.message || 'بيانات المدخلات غير صالحة.';
    throw new ValidationError(firstMessage, fieldErrors);
  }
  return result.data;
}

