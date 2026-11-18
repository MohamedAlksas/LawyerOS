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
  SUSPENDED: 'موقوف مؤقتاً',
  CLOSED: 'منتهي ومغلق',
};

export const MATTER_STATUS_CLASSES: Record<MatterStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  SUSPENDED: 'bg-amber-50 text-amber-800 border-amber-200',
  CLOSED: 'bg-gray-100 text-gray-700 border-gray-300',
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
  JUDGMENT_ISSUED: 'صدر حكم',
  SUSPENDED: 'موقوف',
  CLOSED: 'منتهي',
};

export const PROCEEDING_LEGAL_CAPACITY_LABELS: Record<ProceedingLegalCapacity, string> = {
  PLAINTIFF: 'مدعي / رافع الدعوى',
  DEFENDANT: 'مدعى عليه',
  APPELLANT: 'مستأنف',
  APPELLEE: 'مستأنف ضده',
  INTERVENOR: 'متدخل / منضم',
  OTHER: 'صفة أخرى',
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

