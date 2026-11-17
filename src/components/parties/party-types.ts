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

/**
 * Returns the current wall-clock date and time in Cairo formatted as YYYY-MM-DDTHH:mm
 * for use in HTML datetime-local inputs regardless of the client browser's local timezone.
 */
export function getCairoCurrentWallTime(): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date());
  const obj: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') obj[p.type] = p.value;
  }
  if (obj.hour === '24') obj.hour = '00';
  return `${obj.year}-${obj.month}-${obj.day}T${obj.hour}:${obj.minute}`;
}

/**
 * Parses an HTML datetime-local input string (YYYY-MM-DDTHH:mm) as Cairo wall-clock time
 * and converts it to an exact UTC ISO-8601 instant string (YYYY-MM-DDTHH:mm:ss.sssZ).
 * Ensures consistency regardless of whether the client browser is in Cairo, UTC, or another zone.
 */
export function cairoWallTimeToUtcIso(dateStr: string): string {
  const [datePart, timePart] = dateStr.split('T');
  if (!datePart || !timePart) {
    throw new Error('صيغة التاريخ والوقت غير صالحة');
  }
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  if (
    isNaN(year) ||
    isNaN(month) ||
    isNaN(day) ||
    isNaN(hour) ||
    isNaN(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error('قيمة التاريخ أو الوقت غير صالحة');
  }

  let candidate = Date.UTC(year, month - 1, day, hour, minute, 0);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const getCairoParts = (ms: number) => {
    const parts = dtf.formatToParts(new Date(ms));
    const obj: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') obj[p.type] = Number(p.value);
    }
    if (obj.hour === 24) obj.hour = 0;
    return obj;
  };

  // Iteratively adjust for Cairo offset (including standard vs daylight saving transitions)
  for (let i = 0; i < 3; i++) {
    const cairo = getCairoParts(candidate);
    const cairoAsUtc = Date.UTC(
      cairo.year,
      cairo.month - 1,
      cairo.day,
      cairo.hour,
      cairo.minute,
      cairo.second
    );
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = targetAsUtc - cairoAsUtc;
    if (diff === 0) break;
    candidate += diff;
  }

  return new Date(candidate).toISOString();
}
