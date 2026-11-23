export const CAIRO_TIMEZONE = 'Africa/Cairo';
export const UNSPECIFIED_TIME_LABEL = 'الساعة غير محددة';

export class CalendarValidationError extends Error {
  fieldErrors?: Record<string, string>;

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'CalendarValidationError';
    this.fieldErrors = fieldErrors;
  }
}

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

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const trimmed = dateStr.trim();
  if (!validateStrictCalendarDate(trimmed)) {
    throw new CalendarValidationError('تاريخ غير صالح في التقويم (يجب أن يكون بصيغة YYYY-MM-DD وتاريخ حقيقي).');
  }
  const [yearStr, monthStr, dayStr] = trimmed.split('-');
  return {
    year: parseInt(yearStr, 10),
    month: parseInt(monthStr, 10),
    day: parseInt(dayStr, 10),
  };
}

export function parseCalendarDateToUtcDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const { year, month, day } = parseDateParts(trimmed);
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d;
}

export function formatUtcDateToIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Returns today's Gregorian YYYY-MM-DD calendar date in Africa/Cairo timezone.
 * Uses Gregorian calendar and Latin digits explicitly so host/browser locale never shifts or localizes digits.
 */
export function getCairoTodayDateString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TIMEZONE,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new CalendarValidationError('تعذر قراءة تاريخ اليوم بتوقيت القاهرة.');
  }
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Shifts a YYYY-MM-DD calendar date by N calendar days using UTC calendar math,
 * preventing Cairo DST 23h/25h days from skipping or repeating calendar dates.
 */
export function addCairoDays(dateStr: string, days: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the 7-day Egyptian workweek (Saturday through Friday) containing anchorDate.
 */
export function getCairoWeekRange(anchorDate: string): { startDate: string; endDate: string } {
  const { year, month, day } = parseDateParts(anchorDate);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceSaturday = utcDay === 6 ? 0 : utcDay + 1;
  const startDate = addCairoDays(anchorDate, -daysSinceSaturday);
  const endDate = addCairoDays(startDate, 6);
  return { startDate, endDate };
}

/**
 * Returns the full Gregorian month range [YYYY-MM-01, YYYY-MM-lastDay] containing anchorDate.
 */
export function getCairoMonthRange(anchorDate: string): { startDate: string; endDate: string } {
  const { year, month } = parseDateParts(anchorDate);
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(daysInMonth).padStart(2, '0');
  return {
    startDate: `${yyyy}-${mm}-01`,
    endDate: `${yyyy}-${mm}-${dd}`,
  };
}

/**
 * Overdue check evaluated dynamically against Cairo today: dueDate < todayCairo.
 * Items due on todayCairo itself are due today, not overdue.
 */
export function isCairoDateOverdue(
  dueDate: string | null | undefined,
  todayCairo: string = getCairoTodayDateString()
): boolean {
  if (!validateStrictCalendarDate(todayCairo)) {
    throw new CalendarValidationError('تاريخ المرجع بتوقيت القاهرة غير صالح.');
  }
  if (!dueDate || !validateStrictCalendarDate(dueDate)) {
    return false;
  }
  return dueDate < todayCairo;
}

/**
 * Validates and normalizes optional HH:mm time, rejecting any time supplied without a dueDate.
 */
export function validateOptionalCalendarTime(
  dueDate: string | null | undefined,
  dueTime: string | null | undefined,
  fieldName = 'dueTime'
): string | null {
  if (dueTime === null || dueTime === undefined) return null;
  const trimmedTime = dueTime.trim();
  if (!trimmedTime) return null;

  const trimmedDate = dueDate?.trim() ?? '';
  if (!trimmedDate) {
    throw new CalendarValidationError('لا يمكن تحديد وقت بدون تحديد التاريخ.', {
      [fieldName]: 'يجب تحديد التاريخ أولاً قبل إدخال الوقت',
    });
  }
  if (!validateStrictCalendarDate(trimmedDate)) {
    throw new CalendarValidationError('تاريخ غير صالح في التقويم.', {
      dueDate: 'صيغة التاريخ غير صالحة (YYYY-MM-DD)',
    });
  }

  const match = trimmedTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new CalendarValidationError('صيغة الوقت غير صالحة (يجب أن تكون بصيغة HH:mm مثل 10:30).', {
      [fieldName]: 'صيغة الوقت يجب أن تكون HH:mm',
    });
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new CalendarValidationError('قيمة الوقت خارج النطاق المسموح (الساعات 00-23 والدقائق 00-59).', {
      [fieldName]: 'قيمة الوقت خارج النطاق المسموح',
    });
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatCairoDateArabic(dateStr: string | null | undefined): string {
  if (!dateStr || !dateStr.trim()) return '—';
  const trimmed = dateStr.trim();
  if (!validateStrictCalendarDate(trimmed)) return trimmed;
  const { year, month, day } = parseDateParts(trimmed);
  const noonUtc = new Date(Date.UTC(2000, month - 1, day, 12, 0, 0));
  noonUtc.setUTCFullYear(year);
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TIMEZONE,
    calendar: 'gregory',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(noonUtc);
}

export function formatTimeOrUnspecified(time: string | null | undefined): string {
  if (!time || !time.trim()) {
    return UNSPECIFIED_TIME_LABEL;
  }
  const trimmed = time.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return trimmed;
  const hours = parseInt(match[1], 10);
  const minutes = match[2];
  if (hours < 0 || hours > 23) return trimmed;
  const isPM = hours >= 12;
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${minutes} ${isPM ? 'م' : 'ص'}`;
}