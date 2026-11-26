import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  ALLOWED_DOCUMENT_MIMES,
  DOCUMENT_TYPE_LABELS_AR,
  DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
  DocumentActionResult,
  DocumentOriginalPresence,
  DocumentScanStatus,
  DocumentSensitivity,
  DocumentType,
  MAX_DOCUMENT_BYTES,
  UNSCANNED_POLICY_DETAIL_AR,
  UNSCANNED_POLICY_NOTICE_AR,
} from '@/modules/documents/document-types';
import { formatCairoInstantArabic } from '@/lib/cairo-date';

export {
  DOCUMENT_TYPE_LABELS_AR,
  DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
  MAX_DOCUMENT_BYTES,
  UNSCANNED_POLICY_DETAIL_AR,
  UNSCANNED_POLICY_NOTICE_AR,
  formatCairoInstantArabic,
};

export interface SelectablePartyOption {
  id: string;
  name: string;
  kind: string;
}

export const DOCUMENT_INPUT_CLASS =
  'w-full max-w-full min-w-0 min-h-[44px] px-3 py-2 text-base bg-white text-[#172A35] border border-[#6E828C] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-[#14566B] disabled:bg-[#F4F6F7] disabled:opacity-70';
export const DOCUMENT_MESSAGE_CLASS = 'min-w-0 break-words [overflow-wrap:anywhere]';
export const DOCUMENT_FIELD_ERROR_CLASS = `text-xs text-[#A4262C] mt-1 font-medium ${DOCUMENT_MESSAGE_CLASS}`;

export const DOCUMENT_SESSION_EXPIRED_MESSAGE =
  'انتهت الجلسة. البيانات لم تُحفظ، يرجى إعادة تسجيل الدخول والمحاولة.';
export const DOCUMENT_NETWORK_ERROR_MESSAGE = 'الاتصال انقطع، البيانات لسه ما اتحفظتش';
export const DOCUMENT_SIZE_EXCEEDED_MESSAGE =
  'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).';

export const RETRYABLE_UPLOAD_CONFLICT_CODES = new Set<string>([
  'CONCURRENCY_CONFLICT',
  'IDEMPOTENCY_CONCURRENT_CONFLICT',
]);

export type DocumentFailureBody = Extract<DocumentActionResult<unknown>, { success: false }>;

/** Conflicts and server/session faults keep the attempt (and its idempotency keys) for a safe replay. */
export function classifyUploadFailure(
  httpStatus: number,
  body: DocumentFailureBody | null,
  fallback: string
): { status: 'INCOMPLETE' | 'REJECTED'; message: string; isConcurrencyConflict: boolean } {
  const message = body?.error ?? fallback;
  if (httpStatus === 401) {
    return {
      status: 'INCOMPLETE',
      message: DOCUMENT_SESSION_EXPIRED_MESSAGE,
      isConcurrencyConflict: false,
    };
  }
  if (httpStatus === 409 && body && RETRYABLE_UPLOAD_CONFLICT_CODES.has(body.code)) {
    return {
      status: 'INCOMPLETE',
      message,
      isConcurrencyConflict: body.code === 'CONCURRENCY_CONFLICT',
    };
  }
  if (httpStatus >= 500 && body?.code !== 'SCAN_POLICY_UNAVAILABLE') {
    return { status: 'INCOMPLETE', message, isConcurrencyConflict: false };
  }
  if (httpStatus === 413) {
    return {
      status: 'REJECTED',
      message: DOCUMENT_SIZE_EXCEEDED_MESSAGE,
      isConcurrencyConflict: false,
    };
  }
  return { status: 'REJECTED', message, isConcurrencyConflict: false };
}

export const DOCUMENT_TYPE_OPTIONS: Array<{ value: DocumentType; label: string }> = (
  Object.entries(DOCUMENT_TYPE_LABELS_AR) as Array<[DocumentType, string]>
).map(([value, label]) => ({ value, label }));

export const ORIGINAL_PRESENCE_LABELS: Record<DocumentOriginalPresence, string> = {
  YES: 'موجود بالمكتب',
  NO: 'غير موجود بالمكتب',
  UNKNOWN: 'غير معروف',
};

export const ORIGINAL_PRESENCE_OPTIONS: Array<{
  value: DocumentOriginalPresence;
  label: string;
}> = (['UNKNOWN', 'YES', 'NO'] as const).map((value) => ({
  value,
  label: ORIGINAL_PRESENCE_LABELS[value],
}));

export const SENSITIVITY_LABELS: Record<DocumentSensitivity, string> = {
  CONFIDENTIAL: 'سري',
  RESTRICTED: 'سري مقيد للغاية',
};

export const SENSITIVITY_OPTIONS: Array<{ value: DocumentSensitivity; label: string }> = [
  { value: 'CONFIDENTIAL', label: 'سري (الوضع الافتراضي للمستندات الخاصة)' },
  { value: 'RESTRICTED', label: 'سري مقيد للغاية' },
];

export const SENSITIVITY_BADGE_CLASSES: Record<DocumentSensitivity, string> = {
  CONFIDENTIAL: 'bg-sky-50 text-[#14566B] border-sky-200',
  RESTRICTED: 'bg-red-50 text-[#A4262C] border-red-200',
};

export type QueueUploadStatus =
  | 'QUEUED'
  | 'UPLOADING'
  | 'VALIDATING'
  | 'READY'
  | 'REJECTED'
  | 'INCOMPLETE'
  | 'DUPLICATE_WARNING'
  | 'CANCELLED';

export const QUEUE_STATUS_META: Record<
  QueueUploadStatus,
  { label: string; badgeClass: string }
> = {
  QUEUED: {
    label: 'في قائمة الانتظار',
    badgeClass: 'bg-slate-100 text-[#172A35] border-slate-300',
  },
  UPLOADING: {
    label: 'بيترفع',
    badgeClass: 'bg-sky-50 text-[#14566B] border-sky-300',
  },
  VALIDATING: {
    label: 'جاري التحقق من الملف',
    badgeClass: 'bg-[#FFF7E6] text-[#7A4A00] border-[#E0B46A]',
  },
  READY: {
    label: 'جاهز',
    badgeClass: 'bg-emerald-50 text-[#176449] border-emerald-300',
  },
  REJECTED: {
    label: 'مرفوض',
    badgeClass: 'bg-red-50 text-[#A4262C] border-red-300',
  },
  INCOMPLETE: {
    label: 'الرفع غير مكتمل',
    badgeClass: 'bg-red-50 text-[#A4262C] border-red-300',
  },
  DUPLICATE_WARNING: {
    label: 'تنبيه تطابق بصمة الملف',
    badgeClass: 'bg-[#FFF7E6] text-[#7A4A00] border-[#E0B46A]',
  },
  CANCELLED: {
    label: 'تم الإلغاء',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-300',
  },
};

export const SCAN_STATUS_BADGE_CLASSES: Record<DocumentScanStatus, string> = {
  NOT_SCANNED_POLICY: 'bg-[#FFF7E6] text-[#7A4A00] border-[#E0B46A]',
  CLEAN: 'bg-emerald-50 text-[#176449] border-emerald-300',
  PENDING: 'bg-sky-50 text-[#14566B] border-sky-300',
  INFECTED: 'bg-red-50 text-[#A4262C] border-red-300',
  FAILED: 'bg-red-50 text-[#A4262C] border-red-300',
  TIMEOUT: 'bg-red-50 text-[#A4262C] border-red-300',
  STALE_DEFINITIONS: 'bg-red-50 text-[#A4262C] border-red-300',
};

export function getScanStatusBadgeClassFromLabel(label: string): string {
  if (label.includes('سليم') || label.includes('نظيف')) {
    return SCAN_STATUS_BADGE_CLASSES.CLEAN;
  }
  if (label.includes('قيد الفحص')) {
    return SCAN_STATUS_BADGE_CLASSES.PENDING;
  }
  return SCAN_STATUS_BADGE_CLASSES.NOT_SCANNED_POLICY;
}

export function formatFileSizeArabic(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 بايت';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} ميجابايت`;
}

export const MAX_DOCUMENT_TITLE_LENGTH = 200;

export function clampTitle(value: string): string {
  return value.slice(0, MAX_DOCUMENT_TITLE_LENGTH).replace(/[\uD800-\uDBFF]$/, '').trim();
}

export function suggestTitleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^./\\]+$/, '');
  const cleaned = withoutExt.replace(/_+/g, ' ').trim();
  return clampTitle(cleaned || filename.trim()) || 'مستند جديد';
}

const LEGACY_MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

export function resolveDeclaredMime(file: File): string {
  const explicit = file.type?.trim().toLowerCase();
  if (explicit && explicit !== 'application/octet-stream') {
    return LEGACY_MIME_ALIASES[explicit] ?? explicit;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

/** Returns an Arabic rejection reason, or null when the file may be sent to the server. */
export function validateClientFile(file: File): string | null {
  if (file.size === 0) return 'الملف فارغ (0 بايت) ولا يمكن رفعه.';
  if (file.size > MAX_DOCUMENT_BYTES) {
    return 'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).';
  }
  const lower = file.name.toLowerCase();
  const extensionAllowed = ALLOWED_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
  const mimeAllowed = (ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(
    resolveDeclaredMime(file)
  );
  if (!extensionAllowed || !mimeAllowed) {
    return 'صيغة الملف غير مسموحة. الصيغ المسموحة: PDF أو JPEG أو PNG.';
  }
  return null;
}

export function isPreviewableImageFile(file: File): boolean {
  const mime = resolveDeclaredMime(file);
  return mime === 'image/jpeg' || mime === 'image/png';
}

export function isPdfFile(file: File): boolean {
  return resolveDeclaredMime(file) === 'application/pdf';
}
