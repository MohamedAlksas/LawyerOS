import {
  MatterKind,
  MatterStatus,
  MatterPartyRole,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
} from '@/modules/matters/matter-types';

export {
  MatterKind,
  MatterStatus,
  MatterPartyRole,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
};

export const MATTER_KIND_LABELS: Record<MatterKind, string> = {
  LITIGATION: 'قضايا ومنازعات',
  CONSULTATION: 'استشارات قانونية',
  CONTRACT: 'عقود وصياغة',
  OTHER: 'أعمال أخرى',
};

export const MATTER_STATUS_LABELS: Record<MatterStatus, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشط',
  ON_HOLD: 'معلق مؤقتاً',
  CLOSED: 'منتهي ومغلق',
  ARCHIVED: 'مؤرشف',
};

export const MATTER_STATUS_CLASSES: Record<MatterStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  ON_HOLD: 'bg-amber-50 text-amber-800 border-amber-200',
  CLOSED: 'bg-gray-100 text-gray-700 border-gray-300',
  ARCHIVED: 'bg-stone-100 text-stone-700 border-stone-300',
};

export const MATTER_PARTY_ROLE_LABELS: Record<MatterPartyRole, string> = {
  CLIENT: 'موكل',
  OPPONENT: 'خصم',
  OTHER: 'طرف آخر',
};

export const PROCEEDING_INSTANCE_LABELS: Record<ProceedingInstance, string> = {
  FIRST_INSTANCE: 'أول درجة / ابتدائي',
  APPEAL: 'استئناف عالي',
  CASSATION: 'نقض ومحكمة عليا',
  OTHER: 'أخرى / فض منازعات',
};

export const PROCEEDING_STATUS_LABELS: Record<ProceedingStatus, string> = {
  DRAFT: 'مسودة قيد',
  ACTIVE: 'متداول بالجلسات',
  AWAITING_JUDGMENT: 'حجز للحكم',
  DECIDED: 'محكوم فيه',
  CLOSED: 'منتهي ومغلق',
};

export const PROCEEDING_LEGAL_CAPACITY_LABELS: Record<ProceedingLegalCapacity, string> = {
  PLAINTIFF: 'مدعي / رافع الدعوى',
  DEFENDANT: 'مدعى عليه',
  APPELLANT: 'مستأنف',
  APPELLEE: 'مستأنف ضده',
  INTERVENOR: 'متدخل / منضم',
  OTHER: 'صفة أخرى',
};

export const PROCEEDING_STATUS_CLASSES: Record<ProceedingStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  AWAITING_JUDGMENT: 'bg-purple-50 text-purple-800 border-purple-200',
  DECIDED: 'bg-blue-50 text-blue-800 border-blue-200',
  CLOSED: 'bg-gray-100 text-gray-700 border-gray-300',
};

export const POA_REVIEW_STATUS_LABELS: Record<string, string> = {
  UNREVIEWED: 'قيد المراجعة',
  VALID: 'ساري ومعتمد',
  EXPIRED: 'منتهي الصلاحية',
  REVOKED: 'ملغى / مفسوخ',
  DEFECTIVE: 'معيب / غير صالح',
};

export const POA_REVIEW_STATUS_CLASSES: Record<string, string> = {
  UNREVIEWED: 'bg-amber-50 text-amber-800 border-amber-200',
  VALID: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  EXPIRED: 'bg-gray-100 text-gray-700 border-gray-300',
  REVOKED: 'bg-red-50 text-red-800 border-red-200',
  DEFECTIVE: 'bg-rose-50 text-rose-800 border-rose-200',
};

export function formatCairoDateOnly(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return isoString;
  }
}

export function generateClientRequestId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Returns the office calendar date (Africa/Cairo) as YYYY-MM-DD.
 * Using UTC's toISOString() near midnight would suggest yesterday's/tomorrow's
 * date depending on the offset.
 */
export function getCairoTodayDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export const AUTH_RECOVERY_CODES = [
  'SESSION_EXPIRED',
  'UNAUTHENTICATED',
  'SESSION_INACTIVE',
  'MFA_REQUIRED',
] as const;

export function isAuthRecoveryCode(code?: string | null): boolean {
  return Boolean(code && (AUTH_RECOVERY_CODES as readonly string[]).includes(code));
}

