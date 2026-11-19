import { z } from 'zod';
import {
  MatterKind,
  MatterStatus,
  MatterPartyRole,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
} from '@prisma/client';

export {
  MatterKind,
  MatterStatus,
  MatterPartyRole,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
};

export interface MatterPartySummaryDTO {
  id: string;
  matterId: string;
  partyId: string;
  partyName: string;
  role: MatterPartyRole;
  isPrimaryContact: boolean;
  billingEnabled: boolean;
  notes?: string | null;
  version: number;
  operationVersion?: number;
  createdAt: string;
}

export interface ProceedingPartySummaryDTO {
  id: string;
  proceedingId: string;
  matterPartyId: string;
  partyName: string;
  capacityText: string;
  legalCapacity?: ProceedingLegalCapacity | null;
  notes?: string | null;
  version?: number;
  operationVersion?: number;
}

export interface DuplicateCourtWarningDTO {
  detected: boolean;
  message: string;
  existingProceedingId?: string;
  existingNumberText?: string | null;
  existingYearLabel?: string | null;
}

export interface ProceedingSummaryDTO {
  id: string;
  matterId: string;
  courtId: string;
  courtName: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  parentProceedingSummary?: string | null;
  registerType?: string | null;
  circuit?: string | null;
  numberText?: string | null;
  yearLabel?: string | null;
  filingDate?: string | null;
  claimAmount?: string | null;
  status: ProceedingStatus;
  version: number;
  operationVersion?: number;
  createdAt: string;
  parties?: ProceedingPartySummaryDTO[];
  duplicateWarning?: DuplicateCourtWarningDTO | null;
}

export interface MatterAuthorizationSummaryDTO {
  id: string;
  matterId: string;
  powerOfAttorneyId: string;
  poaNumberText: string;
  poaYearLabel: string;
  notarizationOffice: string;
  poaType: string;
  humanReviewStatus: string;
  partyId: string;
  partyName: string;
  operationVersion?: number;
  createdAt: string;
}

export interface MatterDTO {
  id: string;
  fileCode: string;
  title: string;
  kind: MatterKind;
  status: MatterStatus;
  practiceAreaId?: string | null;
  practiceAreaName?: string | null;
  openingDate?: string | null;
  closingDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  paperLocationId?: string | null;
  paperLocationName?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  parties?: MatterPartySummaryDTO[];
  proceedings?: ProceedingSummaryDTO[];
  authorizations?: MatterAuthorizationSummaryDTO[];
}

export interface OpenMatterInput {
  title: string;
  kind: MatterKind;
  status?: MatterStatus;
  practiceAreaId?: string | null;
  openingDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  paperLocationId?: string | null;
  initialClientId?: string | null;
  idempotencyKey: string;
}

export interface OpenMatterResult {
  matter: MatterDTO;
  fileCode: string;
  operationVersion: number;
}

export interface UpdateMatterInput {
  id: string;
  expectedVersion: number;
  title: string;
  kind: MatterKind;
  status: MatterStatus;
  practiceAreaId?: string | null;
  openingDate?: string | null;
  closingDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  paperLocationId?: string | null;
  idempotencyKey: string;
}

export interface UpdateMatterResult {
  matter: MatterDTO;
  operationVersion: number;
}

export interface LinkMatterPartyInput {
  matterId: string;
  partyId: string;
  role: MatterPartyRole;
  isPrimaryContact?: boolean;
  billingEnabled?: boolean;
  notes?: string | null;
  idempotencyKey: string;
}

export interface UpdateMatterPartyInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  role: MatterPartyRole;
  isPrimaryContact?: boolean;
  billingEnabled?: boolean;
  notes?: string | null;
  idempotencyKey: string;
}

export interface UnlinkMatterPartyInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface ProceedingPartyInput {
  matterPartyId: string;
  capacityText?: string;
  legalCapacity?: ProceedingLegalCapacity | null;
  notes?: string | null;
}

export interface AddProceedingInput {
  matterId: string;
  courtId: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  registerType?: string | null;
  circuit?: string | null;
  numberText?: string | null;
  yearLabel?: string | null;
  filingDate?: string | null;
  claimAmount?: string | null;
  status?: ProceedingStatus;
  parties?: ProceedingPartyInput[];
  idempotencyKey: string;
}

export interface UpdateProceedingInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  courtId: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  registerType?: string | null;
  circuit?: string | null;
  numberText?: string | null;
  yearLabel?: string | null;
  filingDate?: string | null;
  claimAmount?: string | null;
  status: ProceedingStatus;
  parties?: ProceedingPartyInput[];
  idempotencyKey: string;
}

export interface LinkProceedingPartyInput {
  proceedingId: string;
  matterPartyId: string;
  capacityText?: string;
  legalCapacity?: ProceedingLegalCapacity | null;
  notes?: string | null;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface UnlinkProceedingPartyInput {
  id: string;
  proceedingId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface LinkMatterAuthorizationInput {
  matterId: string;
  powerOfAttorneyId: string;
  idempotencyKey: string;
}

export interface UnlinkMatterAuthorizationInput {
  id: string;
  matterId: string;
  idempotencyKey: string;
}

export interface SearchMattersParams {
  query?: string;
  kind?: MatterKind;
  status?: MatterStatus;
  clientId?: string;
  partyId?: string;
  role?: MatterPartyRole;
  courtId?: string;
  practiceAreaId?: string;
  limit?: number;
  offset?: number;
}

export interface SearchMattersResult {
  matters: MatterDTO[];
  total: number;
}

// ==========================================
// Party Matter Associations (C16)
// ==========================================
export interface PartyMatterAssociationDTO {
  matterPartyId: string;
  matterId: string;
  fileCode: string;
  title: string;
  kind: MatterKind;
  status: MatterStatus;
  role: MatterPartyRole;
  isPrimaryContact: boolean;
  billingEnabled: boolean;
  notes?: string | null;
  openingDate?: string | null;
  closingDate?: string | null;
  createdAt: string;
}

export interface PartyMatterAssociationsResult {
  associations: PartyMatterAssociationDTO[];
  total: number;
}

export interface GetPartyMatterAssociationsParams {
  partyId: string;
  role?: MatterPartyRole;
  limit?: number;
  offset?: number;
}

// ==========================================
// Advisory Similar Proceedings Preflight (C18)
// ==========================================
export interface FindSimilarProceedingsParams {
  courtId: string;
  numberText: string;
  yearLabel?: string | null;
  excludeProceedingId?: string | null;
  limit?: number;
}

export interface SimilarProceedingCandidateDTO {
  id: string;
  matterId: string;
  matterFileCode: string;
  matterTitle: string;
  courtId: string;
  courtName: string;
  instance: ProceedingInstance;
  numberText?: string | null;
  yearLabel?: string | null;
  status: ProceedingStatus;
  similarityReason: string;
}

export interface FindSimilarProceedingsResult {
  candidates: SimilarProceedingCandidateDTO[];
  hasDirectMatch: boolean;
}

// ==========================================
// Strict Calendar Date Validation
// ==========================================
export function validateStrictCalendarDate(val: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = val.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return day <= daysInMonth[month - 1];
}

export function parseCalendarDateToUtc(val: string | null | undefined): Date | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (!validateStrictCalendarDate(trimmed)) {
    throw new MatterValidationError('تاريخ غير صالح في التقويم (يجب أن يكون بصيغة YYYY-MM-DD وتاريخ حقيقي غير وهمي).');
  }
  const [yearStr, monthStr, dayStr] = trimmed.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d;
}

export const strictDateSchema = z.string().refine((val) => validateStrictCalendarDate(val), {
  message: 'تاريخ غير صالح في التقويم (يجب أن يكون بصيغة YYYY-MM-DD وتاريخ حقيقي غير وهمي).',
});

// ==========================================
// Strict Zod Runtime Schemas (.strict())
// ==========================================
export const openMatterSchema = z
  .object({
    title: z.string().trim().min(1, 'عنوان الملف مطلوب').max(200, 'عنوان الملف لا يتجاوز 200 حرف'),
    kind: z.nativeEnum(MatterKind, { message: 'نوع العمل القانوني غير صالح' }),
    status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD'], {
      message: 'حالة الملف غير صالحة للإنشاء (الحالات المدعومة عند الإنشاء: مسودة، نشط، معلق)',
    }).optional(),
    practiceAreaId: z.string().uuid('معرف دائرة التخصص غير صالح').nullable().optional(),
    openingDate: strictDateSchema.nullable().optional(),
    summary: z.string().max(2000, 'الملخص لا يتجاوز 2000 حرف').nullable().optional(),
    notes: z.string().max(5000, 'الملاحظات لا تتجاوز 5000 حرف').nullable().optional(),
    paperLocationId: z.string().uuid('معرف مكان الحفظ غير صالح').nullable().optional(),
    initialClientId: z.string().uuid('معرف الموكل غير صالح').nullable().optional(),
    idempotencyKey: z.string().min(1, 'مفتاح عدم التكرار مطلوب').max(128),
  })
  .strict();

export const updateMatterSchema = z
  .object({
    id: z.string().uuid('معرف الملف غير صالح'),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة يجب أن يكون رقماً صحيحاً موجباً'),
    title: z.string().trim().min(1, 'عنوان الملف مطلوب').max(200, 'عنوان الملف لا يتجاوز 200 حرف'),
    kind: z.nativeEnum(MatterKind, { message: 'نوع العمل القانوني غير صالح' }),
    status: z.nativeEnum(MatterStatus, { message: 'حالة الملف غير صالحة' }),
    practiceAreaId: z.string().uuid('معرف دائرة التخصص غير صالح').nullable().optional(),
    openingDate: strictDateSchema.nullable().optional(),
    closingDate: strictDateSchema.nullable().optional(),
    summary: z.string().max(2000, 'الملخص لا يتجاوز 2000 حرف').nullable().optional(),
    notes: z.string().max(5000, 'الملاحظات لا تتجاوز 5000 حرف').nullable().optional(),
    paperLocationId: z.string().uuid('معرف مكان الحفظ غير صالح').nullable().optional(),
    idempotencyKey: z.string().min(1, 'مفتاح عدم التكرار مطلوب').max(128),
  })
  .strict()
  .refine(
    (data) => {
      if (data.openingDate && data.closingDate) {
        return data.openingDate <= data.closingDate;
      }
      return true;
    },
    {
      message: 'تاريخ إغلاق الملف لا يمكن أن يكون قبل تاريخ الفتح.',
      path: ['closingDate'],
    }
  );

export const linkMatterPartySchema = z
  .object({
    matterId: z.string().uuid('معرف الملف غير صالح'),
    partyId: z.string().uuid('معرف الطرف غير صالح'),
    role: z.nativeEnum(MatterPartyRole, { message: 'صفة الطرف غير صالحة' }),
    isPrimaryContact: z.boolean().optional(),
    billingEnabled: z.boolean().optional(),
    notes: z.string().max(1000).nullable().optional(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const updateMatterPartySchema = z
  .object({
    id: z.string().uuid('معرف صلة الطرف غير صالح'),
    matterId: z.string().uuid('معرف الملف غير صالح'),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة مطلوب'),
    role: z.nativeEnum(MatterPartyRole, { message: 'صفة الطرف غير صالحة' }),
    isPrimaryContact: z.boolean().optional(),
    billingEnabled: z.boolean().optional(),
    notes: z.string().max(1000).nullable().optional(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const unlinkMatterPartySchema = z
  .object({
    id: z.string().uuid('معرف صلة الطرف غير صالح'),
    matterId: z.string().uuid('معرف الملف غير صالح'),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة مطلوب'),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const proceedingPartyInputSchema = z
  .object({
    matterPartyId: z.string().uuid('معرف طرف الملف غير صالح'),
    capacityText: z.string().max(100, 'الصفة القضائية لا تتجاوز 100 حرف').optional(),
    legalCapacity: z.nativeEnum(ProceedingLegalCapacity).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine(
    (data) => Boolean(data.capacityText?.trim() || data.legalCapacity),
    {
      message: 'الصفة القضائية مطلوبة للطرف في القيد القضائي.',
      path: ['capacityText'],
    }
  );

export const addProceedingSchema = z
  .object({
    matterId: z.string().uuid('معرف الملف غير صالح'),
    courtId: z.string().uuid('المحكمة مطلوبة لإضافة قيد قضائي'),
    instance: z.nativeEnum(ProceedingInstance, { message: 'درجة التقاضي غير صالحة' }),
    parentProceedingId: z.string().uuid().nullable().optional(),
    registerType: z.string().max(100).nullable().optional(),
    circuit: z.string().max(100).nullable().optional(),
    numberText: z.string().max(100).nullable().optional(),
    yearLabel: z.string().max(20).nullable().optional(),
    filingDate: strictDateSchema.nullable().optional(),
    claimAmount: z.string().max(50).nullable().optional(),
    status: z.nativeEnum(ProceedingStatus).optional(),
    parties: z.array(proceedingPartyInputSchema).optional(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const updateProceedingSchema = z
  .object({
    id: z.string().uuid('معرف القيد القضائي غير صالح'),
    matterId: z.string().uuid('معرف الملف غير صالح'),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة مطلوب'),
    courtId: z.string().uuid('المحكمة مطلوبة للقيد القضائي'),
    instance: z.nativeEnum(ProceedingInstance, { message: 'درجة التقاضي غير صالحة' }),
    parentProceedingId: z.string().uuid().nullable().optional(),
    registerType: z.string().max(100).nullable().optional(),
    circuit: z.string().max(100).nullable().optional(),
    numberText: z.string().max(100).nullable().optional(),
    yearLabel: z.string().max(20).nullable().optional(),
    filingDate: strictDateSchema.nullable().optional(),
    claimAmount: z.string().max(50).nullable().optional(),
    status: z.nativeEnum(ProceedingStatus, { message: 'حالة القيد القضائي غير صالحة' }),
    parties: z.array(proceedingPartyInputSchema).optional(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const linkProceedingPartySchema = z
  .object({
    proceedingId: z.string().uuid('معرف القيد القضائي غير صالح'),
    matterPartyId: z.string().uuid('معرف طرف الملف غير صالح'),
    capacityText: z.string().max(100, 'الصفة القضائية لا تتجاوز 100 حرف').optional(),
    legalCapacity: z.nativeEnum(ProceedingLegalCapacity).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة للقيد القضائي مطلوب'),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict()
  .refine(
    (data) => Boolean(data.capacityText?.trim() || data.legalCapacity),
    {
      message: 'الصفة القضائية مطلوبة للربط بالقيد القضائي.',
      path: ['capacityText'],
    }
  );

export const unlinkProceedingPartySchema = z
  .object({
    id: z.string().uuid('معرف صفة الطرف بالقيد غير صالح'),
    proceedingId: z.string().uuid('معرف القيد القضائي غير صالح'),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة للقيد القضائي مطلوب'),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const linkMatterAuthorizationSchema = z
  .object({
    matterId: z.string().uuid('معرف الملف غير صالح'),
    powerOfAttorneyId: z.string().uuid('معرف التوكيل غير صالح'),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const unlinkMatterAuthorizationSchema = z
  .object({
    id: z.string().uuid('معرف ارتباط التوكيل غير صالح'),
    matterId: z.string().uuid('معرف الملف غير صالح'),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const searchMattersParamsSchema = z
  .object({
    query: z.string().max(200).optional(),
    kind: z.nativeEnum(MatterKind).optional(),
    status: z.nativeEnum(MatterStatus).optional(),
    clientId: z.string().uuid().optional(),
    partyId: z.string().uuid().optional(),
    role: z.nativeEnum(MatterPartyRole).optional(),
    courtId: z.string().uuid().optional(),
    practiceAreaId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

export const getPartyMatterAssociationsSchema = z
  .object({
    partyId: z.string().uuid('معرف الطرف غير صالح'),
    role: z.nativeEnum(MatterPartyRole).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

export const findSimilarProceedingsSchema = z
  .object({
    courtId: z.string().uuid('معرف المحكمة مطلوب'),
    numberText: z.string().trim().min(1, 'رقم الدعوى مطلوب').max(100),
    yearLabel: z.string().trim().max(20).nullable().optional(),
    excludeProceedingId: z.string().uuid().nullable().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

// ==========================================
// Error Classes
// ==========================================
export class UnauthorizedError extends Error {
  constructor(message = 'غير مصرح. يرجى تسجيل الدخول أولاً.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class MatterValidationError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'MatterValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class LastClientRequiredError extends Error {
  constructor(message = 'لا يمكن إلغاء أو تغيير صفة الموكل الأخير في ملف نشط.') {
    super(message);
    this.name = 'LastClientRequiredError';
  }
}

export class PrimaryContactConflictError extends Error {
  constructor(message = 'يوجد بالفعل جهة اتصال رئيسية محددة لهذا الملف.') {
    super(message);
    this.name = 'PrimaryContactConflictError';
  }
}

export class CrossMatterLinkForbiddenError extends Error {
  constructor(message = 'لا يمكن ربط قيد قضائي بقيد تابع لملف آخر.') {
    super(message);
    this.name = 'CrossMatterLinkForbiddenError';
  }
}

export class ProceedingCycleDetectedError extends Error {
  constructor(message = 'تعذر حفظ القيد: تم اكتشاف حلقة تسلسل غير صالحة في درجات التقاضي.') {
    super(message);
    this.name = 'ProceedingCycleDetectedError';
  }
}

export class ClientPoaDependencyError extends Error {
  constructor(message = 'لا يمكن إزالة صفة الموكل لوجود توكيلات مرتبطة بهذا الملف.') {
    super(message);
    this.name = 'ClientPoaDependencyError';
  }
}

export class InactiveReferenceSelectedError extends Error {
  constructor(message = 'العنصر المرجعي المختار غير نشط ولا يمكن استخدامه لقيود جديدة.') {
    super(message);
    this.name = 'InactiveReferenceSelectedError';
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(message = 'تم تعديل هذا السجل بواسطة مستخدم آخر. يرجى تحديث الصفحة والمحاولة مجدداً.') {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'السجل المطلوب غير موجود.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class UnsupportedTransitionError extends Error {
  constructor(message = 'الانتقال إلى هذه الحالة غير مدعوم في هذا الإصدار.') {
    super(message);
    this.name = 'UnsupportedTransitionError';
  }
}