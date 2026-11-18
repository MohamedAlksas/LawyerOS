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
 * Helper to check whether a year is a leap year in the Gregorian calendar.
 */
export function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the maximum number of days in a given Gregorian month (1-based).
 */
export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isGregorianLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Parses an HTML datetime-local input string (YYYY-MM-DDTHH:mm) as Cairo wall-clock time
 * and converts it to an exact UTC ISO-8601 instant string (YYYY-MM-DDTHH:mm:ss.sssZ).
 * 
 * Validates real calendar dates, rejects DST spring-forward gaps where wall time does not exist,
 * and resolves DST fall-back overlaps by selecting standard time (UTC+2).
 */
export function cairoWallTimeToUtcIso(dateStr: string): string {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error('صيغة التاريخ والوقت غير صالحة');
  }

  const [datePart, timePart] = dateStr.split('T');
  if (!datePart || !timePart) {
    throw new Error('صيغة التاريخ والوقت غير صالحة');
  }

  const dateParts = datePart.split('-');
  if (dateParts.length !== 3) {
    throw new Error('صيغة التاريخ والوقت غير صالحة');
  }

  const [yearStr, monthStr, dayStr] = dateParts;
  const timeParts = timePart.split(':');
  if (timeParts.length < 2) {
    throw new Error('صيغة التاريخ والوقت غير صالحة');
  }

  const [hourStr, minuteStr] = timeParts;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (
    isNaN(year) ||
    isNaN(month) ||
    isNaN(day) ||
    isNaN(hour) ||
    isNaN(minute) ||
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12
  ) {
    throw new Error('قيمة التاريخ أو الوقت غير صالحة');
  }

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    throw new Error('تاريخ غير صالح في التقويم (عدد أيام الشهر غير صحيح).');
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('قيمة الوقت غير صالحة (الساعة بين 0-23 والدقيقة بين 0-59).');
  }

  // Africa/Cairo alternates between standard time (UTC+2) and summer time (UTC+3).
  // Evaluate the two possible candidate UTC timestamps:
  const candidateUtc2 = Date.UTC(year, month - 1, day, hour - 2, minute, 0, 0);
  const candidateUtc3 = Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0);

  const cairoDtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });

  const getCairoWallParts = (ms: number) => {
    const parts = cairoDtf.formatToParts(new Date(ms));
    const obj: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') obj[p.type] = Number(p.value);
    }
    return obj;
  };

  const matchesWall = (ms: number) => {
    const p = getCairoWallParts(ms);
    return (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute
    );
  };

  const matchUtc2 = matchesWall(candidateUtc2);
  const matchUtc3 = matchesWall(candidateUtc3);

  // Case 1: Neither candidate matches -> DST spring-forward gap (time does not exist)
  if (!matchUtc2 && !matchUtc3) {
    throw new Error(
      'الوقت المحدد غير موجود في التوقيت المحلي للقاهرة بسبب بدء التوقيت الصيفي (قفزة التوقيت).'
    );
  }

  // Case 2: Both candidates match -> DST fall-back overlap. Policy: select standard time (UTC+2).
  if (matchUtc2 && matchUtc3) {
    return new Date(candidateUtc2).toISOString();
  }

  // Case 3: Exactly one matches
  if (matchUtc2) {
    return new Date(candidateUtc2).toISOString();
  }

  return new Date(candidateUtc3).toISOString();
}
