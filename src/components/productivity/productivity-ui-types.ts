'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { TaskPriority, TaskStatus } from '@/modules/productivity/productivity-types';
import type { DeadlineStatus } from '@/modules/scheduling/deadline-types';
import { CAIRO_TIMEZONE, addCairoDays, getCairoMonthRange } from '@/lib/cairo-date';

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'منخفضة',
  NORMAL: 'عادية',
  HIGH: 'عاجلة',
  URGENT: 'قصوى',
};

export const TASK_PRIORITY_CLASSES: Record<TaskPriority, string> = {
  LOW: 'bg-slate-100 text-slate-800 border-slate-300',
  NORMAL: 'bg-sky-50 text-sky-900 border-sky-200',
  HIGH: 'bg-amber-50 text-[#7A4A00] border-amber-300',
  URGENT: 'bg-red-50 text-[#A4262C] border-red-300',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: 'مفتوحة',
  IN_PROGRESS: 'قيد التنفيذ',
  DONE: 'تمت',
  CANCELLED: 'ملغاة',
};

export const TASK_STATUS_CLASSES: Record<TaskStatus, string> = {
  OPEN: 'bg-sky-50 text-[#14566B] border-sky-200',
  IN_PROGRESS: 'bg-amber-50 text-[#7A4A00] border-amber-300',
  DONE: 'bg-emerald-50 text-[#176449] border-emerald-200',
  CANCELLED: 'bg-stone-100 text-stone-700 border-stone-300',
};

export const DEADLINE_STATUS_LABELS: Record<DeadlineStatus, string> = {
  DRAFT: 'مسودة تحتاج مراجعة',
  CONFIRMED: 'مؤكد',
  COMPLETED: 'تم الإجراء',
  CANCELLED: 'ألغي',
};

export const DEADLINE_STATUS_CLASSES: Record<DeadlineStatus, string> = {
  DRAFT: 'bg-amber-50 text-[#7A4A00] border-amber-300',
  CONFIRMED: 'bg-sky-50 text-[#14566B] border-sky-300',
  COMPLETED: 'bg-emerald-50 text-[#176449] border-emerald-300',
  CANCELLED: 'bg-stone-100 text-stone-700 border-stone-300',
};

export function isUncertainMutationOutcome(code?: string): boolean {
  return !code || ['INTERNAL_ERROR', 'DATABASE_UNAVAILABLE', 'IDEMPOTENCY_CONCURRENT_CONFLICT'].includes(code);
}

export function formatCairoInstantArabic(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: CAIRO_TIMEZONE,
      calendar: 'gregory',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return isoString;
  }
}

export function shiftCairoMonth(anchorDate: string, deltaMonths: number): string {
  const { startDate } = getCairoMonthRange(anchorDate);
  if (deltaMonths === 0) return startDate;
  const [yStr, mStr] = startDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1 + deltaMonths;
  const shifted = new Date(Date.UTC(year, month, 1));
  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function listCairoDateRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 62) {
    result.push(cursor);
    cursor = addCairoDays(cursor, 1);
    guard += 1;
  }
  return result;
}

export function getCairoWeekdayIndexSatFirst(dateStr: string): number {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const utcDay = new Date(Date.UTC(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10))).getUTCDay();
  // 0=Sun..6=Sat -> Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6
  return utcDay === 6 ? 0 : utcDay + 1;
}

export function renderModalPortal(node: ReactNode) {
  if (typeof document === 'undefined') return null;
  return createPortal(node, document.getElementById('app-shell-modal-root') ?? document.body);
}

/**
 * Accessible modal lifecycle: captures previous active element, marks #app-shell-content inert,
 * handles Escape & Tab focus trapping, and restores focus on close.
 */
export function useAccessibleModal(options: {
  isOpen: boolean;
  isSubmitting: boolean;
  hasPending: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLDivElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
}) {
  const { isOpen, isSubmitting, hasPending, onClose, dialogRef, initialFocusRef } = options;
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const frameId = requestAnimationFrame(() => {
      if (hasPending) {
        const submitBtn = dialogRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (submitBtn) {
          submitBtn.focus();
          return;
        }
      }
      initialFocusRef.current?.focus();
    });

    const shell = document.getElementById('app-shell-content') as (HTMLElement & { inert: boolean }) | null;
    const prevInert = shell?.inert ?? false;
    const prevHidden = shell?.getAttribute('aria-hidden') ?? null;
    if (shell) {
      shell.inert = true;
      shell.setAttribute('aria-hidden', 'true');
    }

    return () => {
      cancelAnimationFrame(frameId);
      if (shell) {
        shell.inert = prevInert;
        if (prevHidden === null) shell.removeAttribute('aria-hidden');
        else shell.setAttribute('aria-hidden', prevHidden);
      }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        requestAnimationFrame(() => {
          previouslyFocused.focus();
        });
      }
    };
  }, [isOpen, hasPending, dialogRef, initialFocusRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmitting) {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialog.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialog.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, dialogRef]);
}