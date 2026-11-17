import {
  PartyKind,
  IdentificationType,
  CommunicationChannel,
  PoAType,
  PoAReviewStatus,
} from '@/modules/parties/types';

export const PARTY_KIND_LABELS: Record<PartyKind, string> = {
  PERSON: 'شخص طبيعي (فرد)',
  ORGANIZATION: 'شخص اعتباري (شركة / مؤسسة)',
};

export const PARTY_KIND_SHORT_LABELS: Record<PartyKind, string> = {
  PERSON: 'فرد',
  ORGANIZATION: 'شركة',
};

export const IDENTIFICATION_TYPE_LABELS: Record<IdentificationType, string> = {
  NATIONAL_ID: 'بطاقة رقم قومي',
  PASSPORT: 'جواز سفر',
  COMMERCIAL_REG: 'سجل تجاري',
  TAX_CARD: 'بطاقة ضريبية',
  OTHER: 'وثيقة إثبات أخرى',
};

export const COMMUNICATION_CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  PHONE: 'اتصال هاتفي',
  IN_PERSON: 'مقابلة شخصية بالمكتب',
  WHATSAPP: 'واتساب',
  EMAIL: 'بريد إلكتروني',
  OTHER: 'قناة أخرى',
};

export const POA_TYPE_LABELS: Record<PoAType, string> = {
  GENERAL: 'توكيل عام رسمي',
  SPECIAL: 'توكيل خاص',
  LITIGATION: 'توكيل عام في القضايا',
  COMMERCIAL: 'توكيل تجاري / شركات',
  OTHER: 'توكيل آخر',
};

export const POA_REVIEW_STATUS_CONFIG: Record<
  PoAReviewStatus,
  { label: string; badgeClass: string; description: string }
> = {
  UNREVIEWED: {
    label: 'قيد المراجعة',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-300',
    description: 'لم تتم مراجعة بيانات التوكيل من المحامي بعد',
  },
  VALID: {
    label: 'سارٍ ومعتمد',
    badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-300',
    description: 'تم فحص التوكيل بشرياً والتأكد من مطابقته وسريانه',
  },
  EXPIRED: {
    label: 'منتهٍ',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
    description: 'انتهت مدة سريان التوكيل',
  },
  REVOKED: {
    label: 'ملغى رسمياً',
    badgeClass: 'bg-rose-50 text-rose-900 border-rose-300',
    description: 'تم إلغاء التوكيل رسمياً بالشهر العقاري',
  },
  DEFECTIVE: {
    label: 'معيب / يحتاج استيفاء',
    badgeClass: 'bg-orange-50 text-orange-900 border-orange-300',
    description: 'يوجد عيب شكلي أو نقص في بيانات التوكيل يتطلب المعالجة',
  },
};

/**
 * Formats an ISO instant string or Date into Cairo local time in Arabic.
 * e.g. "الثلاثاء، 17 نوفمبر 2026، 03:45 م"
 */
export function formatCairoDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'غير محدد';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return 'تاريخ غير صالح';
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    }).format(date);
  } catch {
    return 'تاريخ غير صالح';
  }
}

/**
 * Formats a date-only field into Cairo local date in Arabic without time shift.
 * e.g. "17 نوفمبر 2026"
 */
export function formatCairoDateOnly(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'غير محدد';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return 'تاريخ غير صالح';
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return 'تاريخ غير صالح';
  }
}
