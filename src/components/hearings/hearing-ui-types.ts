import {
  HearingStatus,
  NextDateDisposition,
  TaskPriority,
  HearingDTO,
  HearingResultDTO,
  HearingResultSummaryDTO,
  TaskDTO,
} from '@/modules/scheduling/hearing-types';

export {
  HearingStatus,
  NextDateDisposition,
  TaskPriority,
};

export type {
  HearingDTO,
  HearingResultDTO,
  HearingResultSummaryDTO,
  TaskDTO,
};

export const HEARING_STATUS_LABELS: Record<HearingStatus, string> = {
  SCHEDULED: 'محددة',
  COMPLETED: 'تمت الجلسة',
  CANCELLED: 'ملغاة',
  RESCHEDULED: 'تم تعديل الموعد',
};

export const HEARING_STATUS_CLASSES: Record<HearingStatus, string> = {
  SCHEDULED: 'bg-blue-50 text-blue-800 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  CANCELLED: 'bg-stone-100 text-stone-700 border-stone-300',
  RESCHEDULED: 'bg-amber-50 text-amber-800 border-amber-300',
};

export const NEXT_DATE_DISPOSITION_LABELS: Record<NextDateDisposition, string> = {
  KNOWN: 'تأجيل لجلسة قادمة (تاريخ محدد)',
  NONE: 'لا توجد جلسة أخرى (انتهت الدعوى / حجز للحكم)',
  UNDETERMINED: 'تأجيل إداري / لم يحدد موعد بعد',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'منخفضة',
  NORMAL: 'عادية',
  HIGH: 'عاجلة',
  URGENT: 'قصوى',
};

/**
 * Formats a Cairo date string (YYYY-MM-DD) into readable Egyptian Arabic date.
 * If date is null or invalid, returns fallback.
 */
export function formatHearingDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
      return new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(d);
    }
  } catch {
    // fallback
  }
  return dateStr;
}

/**
 * Formats time string (HH:mm) into Arabic display, or returns «الساعة غير محددة»
 * if time is null, undefined, or empty. Never returns 00:00 or a fake time.
 */
export function formatHearingTimeDisplay(timeStr?: string | null): string {
  if (!timeStr || !timeStr.trim()) {
    return 'الساعة غير محددة';
  }
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return trimmed;
  }
  const hours = parseInt(match[1], 10);
  const minutes = match[2];
  const isPM = hours >= 12;
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = isPM ? 'م' : 'ص';
  return `${displayHours}:${minutes} ${suffix}`;
}

/**
 * Returns literal pre-save summary in Arabic according to T08-TC-02 and T08-TC-07:
 * «هتسجل النتيجة، وتضيف جلسة بتاريخ…، و… مهام»
 */
export function formatRecordResultSummary(params: {
  nextDate?: string | null;
  taskCount: number;
}): string {
  const { nextDate, taskCount } = params;
  const hasNextDate = Boolean(nextDate && nextDate.trim());

  if (hasNextDate) {
    if (taskCount > 0) {
      return `هتسجل النتيجة، وتضيف جلسة بتاريخ ${nextDate}، و ${taskCount} مهام`;
    }
    return `هتسجل النتيجة، وتضيف جلسة بتاريخ ${nextDate}، وبدون مهام متابعة`;
  }

  if (taskCount > 0) {
    return `هتسجل النتيجة بدون جلسة قادمة، و ${taskCount} مهام`;
  }
  return 'هتسجل النتيجة بدون جلسة قادمة، وبدون مهام متابعة';
}
