import { z } from 'zod';
import {
  DocumentOriginalPresence,
  DocumentScanStatus,
  DocumentSensitivity,
  DocumentType,
  DocumentVersionUploadStatus,
  UploadAttemptStatus,
} from '@prisma/client';
import { validateStrictCalendarDate } from '@/lib/cairo-date';
import { CrossMatterLinkForbiddenError } from '@/modules/matters/matter-types';

export {
  DocumentType,
  DocumentOriginalPresence,
  DocumentSensitivity,
  DocumentVersionUploadStatus,
  DocumentScanStatus,
  UploadAttemptStatus,
  CrossMatterLinkForbiddenError,
};

export const MAX_DOCUMENT_BYTES = 26_214_400; // 25 MiB (25 * 1024 * 1024)
export const UPLOAD_ATTEMPT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export const ALLOWED_DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

export const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'] as const;

export const ADR_0003_POLICY_CODE = 'ADR-0003-INITIAL-NO-MALWARE-SCAN';
export const ADR_0003_POLICY_VERSION = '1.0.0';
export const UNSCANNED_POLICY_NOTICE_AR = 'لم يُفحص ضد الفيروسات';
export const UNSCANNED_POLICY_DETAIL_AR = 'لم يُفحص ضد الفيروسات (مؤجل مبدئياً وفق ADR 0003)';
export const DOWNLOAD_DEVICE_RETENTION_NOTICE_AR =
  'تنبيه: إزالة التطبيق أو تسجيل الخروج لا يحذف الملفات التي تم تنزيلها يدوياً إلى الجهاز.';

export const DOCUMENT_TYPE_LABELS_AR: Record<DocumentType, string> = {
  PLEADING: 'صحيفة دعوى / مرافعة',
  MEMORANDUM: 'مذكرة دفاع / قانونية',
  CONTRACT: 'عقد / اتفاق',
  POA_COPY: 'صورة توكيل',
  JUDGMENT: 'صورة حكم',
  EVIDENCE: 'مستند إثبات / حافظة',
  RECEIPT_COPY: 'صورة إيصال',
  CORRESPONDENCE: 'مراسلة / إنذار',
  ID_COPY: 'صورة بطاقة / إثبات شخصية',
  OTHER: 'مستند آخر',
};

export class DocumentValidationError extends Error {
  public readonly fieldErrors?: Record<string, string>;
  public readonly reasonCode?: string;

  constructor(
    message = 'بيانات المستند أو الملف غير صالحة.',
    fieldErrors?: Record<string, string>,
    reasonCode?: string
  ) {
    super(message);
    this.name = 'DocumentValidationError';
    this.fieldErrors = fieldErrors;
    this.reasonCode = reasonCode;
  }
}

export class DocumentNotFoundError extends Error {
  constructor(message = 'المستند أو محاولة الرفع المطلوبة غير موجودة.') {
    super(message);
    this.name = 'DocumentNotFoundError';
  }
}

export class DocumentNotReadyError extends Error {
  constructor(message = 'المستند غير جاهز للعرض أو التحميل بعد.') {
    super(message);
    this.name = 'DocumentNotReadyError';
  }
}

export interface DuplicateChecksumMatchDTO {
  documentId: string;
  title: string;
  documentType: DocumentType;
  matterId: string | null;
  matterFileCode: string | null;
  partyId: string | null;
  partyName: string | null;
  versionId: string;
  originalFilename: string;
  createdAt: string;
}

export class DuplicateChecksumWarningError extends Error {
  public readonly existingDocuments: DuplicateChecksumMatchDTO[];
  public readonly sha256: string;

  constructor(
    existingDocuments: DuplicateChecksumMatchDTO[],
    sha256: string,
    message = 'يوجد مستند مطابق بالفعل لنفس بصمة الملف (SHA-256). تأكد قبل المتابعة بنسخة جديدة.'
  ) {
    super(message);
    this.name = 'DuplicateChecksumWarningError';
    this.existingDocuments = existingDocuments;
    this.sha256 = sha256;
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(message = 'تم تعديل حالة المستند أو محاولة الرفع من جلسة أخرى. يرجى التحديث.') {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'يجب تسجيل الدخول للوصول إلى المستندات.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class DocumentScanPolicyUnavailableError extends Error {
  constructor(
    message = 'فحص البرمجيات الخبيثة مفعل ومطلوب وفق السياسة الحالية، ولكن خدمة الفحص غير متاحة.'
  ) {
    super(message);
    this.name = 'DocumentScanPolicyUnavailableError';
  }
}

export class DocumentStoragePathError extends Error {
  constructor(message = 'مسار التخزين الخاص غير صالح أو غير مسموح به.') {
    super(message);
    this.name = 'DocumentStoragePathError';
  }
}

export type DocumentErrorCode =
  | 'VALIDATION_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'NOT_FOUND'
  | 'DOCUMENT_NOT_READY'
  | 'CROSS_MATTER_LINK_FORBIDDEN'
  | 'DUPLICATE_CHECKSUM_WARNING'
  | 'CONCURRENCY_CONFLICT'
  | 'IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'IDEMPOTENCY_CONCURRENT_CONFLICT'
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'SESSION_INACTIVE'
  | 'FORBIDDEN'
  | 'SCAN_POLICY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export type DocumentActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      code: DocumentErrorCode;
      fieldErrors?: Record<string, string>;
      existingDocuments?: DuplicateChecksumMatchDTO[];
    };

export interface DocumentVersionDTO {
  id: string;
  documentId: string;
  versionNumber: number;
  originalFilename: string;
  declaredMime: string | null;
  detectedMime: string | null;
  sizeBytes: number;
  sha256: string | null;
  uploadStatus: DocumentVersionUploadStatus;
  scanStatus: DocumentScanStatus;
  scanPolicyCode: string | null;
  scanPolicyVersion: string | null;
  scanCheckedAt: string | null;
  scanError: string | null;
  scanStatusLabel: string;
  isReady: boolean;
  createdAt: string;
  createdById: string;
}

export interface DocumentDTO {
  id: string;
  matterId: string | null;
  matterFileCode: string | null;
  matterTitle: string | null;
  partyId: string | null;
  partyName: string | null;
  proceedingId: string | null;
  proceedingLabel: string | null;
  hearingId: string | null;
  hearingDate: string | null;
  title: string;
  documentType: DocumentType;
  documentDate: string | null;
  description: string | null;
  tags: string[];
  originalLocation: string | null;
  originalPresent: DocumentOriginalPresence;
  sensitivity: DocumentSensitivity;
  currentVersionId: string | null;
  currentVersion: DocumentVersionDTO | null;
  versions?: DocumentVersionDTO[];
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  updatedById: string;
  downloadDeviceNotice: string;
}

export interface UploadAttemptDTO {
  id: string;
  documentId: string | null;
  targetDocumentVersionId: string | null;
  matterId: string | null;
  partyId: string | null;
  proceedingId: string | null;
  hearingId: string | null;
  title: string;
  documentType: DocumentType;
  documentDate: string | null;
  description: string | null;
  tags: string[];
  originalLocation: string | null;
  originalPresent: DocumentOriginalPresence;
  sensitivity: DocumentSensitivity;
  originalFilename: string;
  declaredMime: string;
  expectedSizeBytes: number;
  bytesWritten: number;
  sha256: string | null;
  status: UploadAttemptStatus;
  failureReason: string | null;
  expiresAt: string;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListDocumentsResult {
  documents: DocumentDTO[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

export interface BeginUploadInput {
  matterId?: string | null;
  partyId?: string | null;
  proceedingId?: string | null;
  hearingId?: string | null;
  title: string;
  documentType: DocumentType;
  documentDate?: string | null;
  description?: string | null;
  tags?: string[];
  originalLocation?: string | null;
  originalPresent?: DocumentOriginalPresence;
  sensitivity?: DocumentSensitivity;
  originalFilename: string;
  declaredMime: string;
  expectedSizeBytes: number;
  idempotencyKey: string;
}

export interface FinalizeUploadInput {
  attemptId: string;
  confirmDuplicate?: boolean;
  idempotencyKey?: string;
}

export interface ListDocumentsParams {
  matterId?: string;
  partyId?: string;
  proceedingId?: string;
  hearingId?: string;
  documentType?: DocumentType;
  q?: string;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
}

export interface CleanupExpiredUploadsResult {
  skipped: boolean;
  reason?: string;
  expiredAttemptCount: number;
  deletedQuarantineCount: number;
  skippedProtectedCount: number;
}

const strictDateSchema = z.string().refine((val) => validateStrictCalendarDate(val), {
  message: 'تاريخ غير صالح في التقويم (يجب أن يكون بصيغة YYYY-MM-DD وتاريخ حقيقي).',
});

export const beginUploadSchema = z
  .object({
    matterId: z.string().uuid('معرف ملف القضية غير صالح.').nullable().optional(),
    partyId: z.string().uuid('معرف الطرف غير صالح.').nullable().optional(),
    proceedingId: z.string().uuid('معرف القيد القضائي غير صالح.').nullable().optional(),
    hearingId: z.string().uuid('معرف الجلسة غير صالح.').nullable().optional(),
    title: z
      .string()
      .trim()
      .min(1, 'عنوان المستند مطلوب.')
      .max(200, 'عنوان المستند لا يتجاوز 200 حرف.'),
    documentType: z.nativeEnum(DocumentType, { message: 'نوع المستند غير صالح.' }),
    documentDate: strictDateSchema.nullable().optional(),
    description: z.string().trim().max(2000, 'الوصف لا يتجاوز 2000 حرف.').nullable().optional(),
    tags: z
      .array(z.string().trim().min(1, 'الوسم لا يمكن أن يكون فارغاً.').max(50, 'الوسم لا يتجاوز 50 حرفاً.'))
      .max(20, 'الحد الأقصى للوسوم هو 20 وسماً.')
      .optional()
      .default([]),
    originalLocation: z
      .string()
      .trim()
      .max(300, 'مكان الأصل الورقي لا يتجاوز 300 حرف.')
      .nullable()
      .optional(),
    originalPresent: z
      .nativeEnum(DocumentOriginalPresence, { message: 'حالة وجود الأصل غير صالحة.' })
      .optional()
      .default('UNKNOWN'),
    sensitivity: z
      .nativeEnum(DocumentSensitivity, { message: 'درجة حساسية المستند غير صالحة.' })
      .optional()
      .default('CONFIDENTIAL'),
    originalFilename: z
      .string()
      .trim()
      .min(1, 'اسم الملف الأصلي مطلوب.')
      .max(255, 'اسم الملف طويل جداً.'),
    declaredMime: z
      .string()
      .trim()
      .min(1, 'نوع الملف (MIME) مطلوب.')
      .max(120, 'نوع الملف غير صالح.'),
    expectedSizeBytes: z
      .number()
      .int('حجم الملف يجب أن يكون عدداً صحيحاً بالبايت.')
      .positive('الملف الفارغ (0 بايت) غير مسموح به.')
      .max(MAX_DOCUMENT_BYTES, 'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).'),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasMatter = Boolean(data.matterId);
    const hasParty = Boolean(data.partyId);
    if (hasMatter === hasParty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'يجب ربط المستند بملف قضية واحد أو بطرف واحد فقط (وليس كليهما أو بدونهما).',
        path: [hasMatter ? 'partyId' : 'matterId'],
      });
    }
    if ((data.proceedingId || data.hearingId) && !hasMatter) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'لا يمكن ربط القيد القضائي أو الجلسة إلا عندما يكون المستند تابعاً لملف قضية.',
        path: [data.proceedingId ? 'proceedingId' : 'hearingId'],
      });
    }
  });

export const finalizeUploadSchema = z
  .object({
    attemptId: z.string().uuid('معرف محاولة الرفع غير صالح.'),
    confirmDuplicate: z.boolean().optional().default(false),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const listDocumentsSchema = z
  .object({
    matterId: z.string().uuid('معرف ملف القضية غير صالح.').optional(),
    partyId: z.string().uuid('معرف الطرف غير صالح.').optional(),
    proceedingId: z.string().uuid('معرف القيد القضائي غير صالح.').optional(),
    hearingId: z.string().uuid('معرف الجلسة غير صالح.').optional(),
    documentType: z.nativeEnum(DocumentType, { message: 'نوع المستند غير صالح.' }).optional(),
    q: z.string().trim().max(200, 'نص البحث لا يتجاوز 200 حرف.').optional(),
    includeArchived: z.boolean().optional().default(false),
    page: z.number().int().min(1).max(1000).optional().default(1),
    limit: z.number().int().min(1).max(100).optional().default(20),
  })
  .strict();
