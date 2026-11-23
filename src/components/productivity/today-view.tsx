'use client';

import React, { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { completeTaskAction } from '@/modules/productivity/productivity-actions';
import type {
  ActionResult,
  AgendaDeadlineItemDTO,
  AgendaHearingItemDTO,
  AgendaTaskItemDTO,
  TodayOverviewDTO,
} from '@/modules/productivity/productivity-types';
import { formatCairoDateArabic } from '@/lib/cairo-date';
import { LoadingIndicator, EmptyStateContainer } from '@/components/presentation-state';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';
import {
  IconCalendar,
  IconCheck,
  IconClock,
  IconDeadline,
  IconFolder,
  IconGavel,
  IconPlus,
  IconRefresh,
  IconTask,
  IconToday,
  IconWarning,
} from '@/components/stitch-icons';
import {
  DEADLINE_STATUS_CLASSES,
  DEADLINE_STATUS_LABELS,
  TASK_PRIORITY_CLASSES,
  TASK_PRIORITY_LABELS,
  isUncertainMutationOutcome,
} from './productivity-ui-types';

interface TodayViewProps {
  initialOverview: TodayOverviewDTO | null;
  initialError?: string;
}

export function TodayView({ initialOverview, initialError }: TodayViewProps) {
  const router = useRouter();
  const [overview, setOverview] = useState<TodayOverviewDTO | null>(initialOverview);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const [taskActionNotice, setTaskActionNotice] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const pendingCompleteKeysRef = useRef<Map<string, string>>(new Map());

  const refreshToday = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/today', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as ActionResult<TodayOverviewDTO> | null;
      if (!res.ok || !body || !body.success) {
        throw new Error(body && !body.success ? body.error : 'تعذر تحميل ملخص اليوم من الخادم.');
      }
      setOverview(body.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل ملخص اليوم من الخادم.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCompleteTask = async (task: AgendaTaskItemDTO) => {
    if (completingTaskId) return;
    setTaskActionError(null);
    setTaskActionNotice(null);

    const opKey = `today-complete:${task.id}:${task.version}`;
    const idempotencyKey =
      pendingCompleteKeysRef.current.get(opKey) ?? generateClientRequestId('today-done');
    pendingCompleteKeysRef.current.set(opKey, idempotencyKey);

    setCompletingTaskId(task.id);
    try {
      const res = await completeTaskAction({
        taskId: task.id,
        expectedVersion: task.version,
        idempotencyKey,
      });
      if (!res.success) {
        if (!isUncertainMutationOutcome(res.code)) {
          pendingCompleteKeysRef.current.delete(opKey);
        }
        setTaskActionError(res.error || 'تعذر تسجيل إتمام المهمة.');
        return;
      }

      pendingCompleteKeysRef.current.delete(opKey);
      setTaskActionNotice('تم تسجيل إتمام المهمة (ولم يتم تعديل أي موعد قانوني مرتبط).');
      await refreshToday();
      router.refresh();
    } catch {
      setTaskActionError('تعذر الاتصال بالخادم لإتمام المهمة. يمكنك إعادة المحاولة.');
    } finally {
      setCompletingTaskId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="today-view">
        <div data-testid="agenda-loading-state" className="bg-white rounded-[6px] border border-[#D5DFE3] p-8">
          <LoadingIndicator label="جارٍ تحميل لوحة المتابعة اليومية..." />
        </div>
      </div>
    );
  }

  if (loadError || !overview) {
    return (
      <div className="space-y-6" data-testid="today-view">
        <div data-testid="agenda-error-state">
          <div
            role="alert"
            data-testid="error-container"
            className="bg-white rounded-[6px] border border-red-200 p-6 sm:p-8 text-center space-y-4 shadow-xs"
          >
            <div
              className="w-12 h-12 mx-auto rounded-[6px] bg-red-50 border border-red-200 flex items-center justify-center text-[#A4262C] select-none"
              aria-hidden="true"
            >
              <IconWarning className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-bold text-[#172A35]">تعذر تحميل بيانات اليوم</h2>
              <p className="text-sm text-[#4D606A] max-w-md mx-auto leading-relaxed">
                {loadError || 'حدث خطأ أثناء الاتصال بالخادم. يرجى المحاولة مجدداً.'}
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                data-testid="agenda-error-retry-button"
                onClick={refreshToday}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px]"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { agenda, operatingAlerts, weeklySummary } = overview;

  const upcomingDeadlineMap = new Map<string, AgendaDeadlineItemDTO>();
  for (const d of agenda.overdueDeadlines) upcomingDeadlineMap.set(d.id, d);
  for (const d of agenda.confirmedDeadlines) {
    if (!upcomingDeadlineMap.has(d.id)) upcomingDeadlineMap.set(d.id, d);
  }
  const upcomingConfirmedDeadlines = Array.from(upcomingDeadlineMap.values());

  const taskMap = new Map<string, AgendaTaskItemDTO>();
  for (const t of agenda.overdueTasks) taskMap.set(t.id, t);
  for (const t of agenda.datedTasks) {
    if (!taskMap.has(t.id)) taskMap.set(t.id, t);
  }
  const dueAndOverdueTasks = Array.from(taskMap.values());

  const hasAnyItems =
    agenda.hearings.length > 0 ||
    agenda.draftDeadlines.length > 0 ||
    upcomingConfirmedDeadlines.length > 0 ||
    dueAndOverdueTasks.length > 0 ||
    agenda.undatedTasks.length > 0;

  const renderHearingRow = (h: AgendaHearingItemDTO) => (
    <article
      key={h.id}
      data-testid={`agenda-item-hearing-${h.id}`}
      className="p-5 hover:bg-[#FAFBFD] transition-colors flex flex-col sm:flex-row gap-4"
    >
      {/* Stitch Right Time Column */}
      <div className="sm:w-32 shrink-0 flex sm:flex-col items-center sm:items-start justify-between sm:justify-start gap-1.5 sm:pt-0.5 sm:border-l sm:border-[#E5ECEE] sm:pl-3">
        {h.hearingTime ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#14566B] bg-[#E9F2F5] border border-[#C2D9E2] px-2.5 py-1 rounded-[4px]">
              <IconClock className="w-3.5 h-3.5" />
              <span>{h.timeLabel}</span>
            </span>
            <span className="text-xs text-[#4D606A]">موعد محدد</span>
          </>
        ) : (
          <span
            data-testid={`hearing-unknown-time-${h.id}`}
            className="inline-block text-xs font-semibold px-2.5 py-1 rounded-[4px] bg-[#FFF7E6] text-[#7A4A00] border border-[#E0B46A]"
          >
            {h.timeLabel}
          </span>
        )}
      </div>

      {/* Stitch Hearing Details Column */}
      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Link
              href={`/matters/${h.matterId}`}
              className="text-base font-bold text-[#172A35] hover:text-[#14566B] hover:underline [overflow-wrap:anywhere]"
            >
              {h.matterTitle}
            </Link>
            <bdi
              dir="ltr"
              className="text-xs font-mono font-semibold text-[#14566B] bg-[#E9F2F5] px-2 py-0.5 rounded-[4px] border border-[#C2D9E2]"
            >
              {h.matterFileCode}
            </bdi>
          </div>
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-[4px] bg-[#F8FAFB] text-[#4D606A] border border-[#D5DFE3]">
            جلسة قضائية
          </span>
        </div>

        <div className="text-sm text-[#4D606A] flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            الجهة القضائية: <strong className="text-[#172A35] font-semibold">{h.courtName}</strong>
          </span>
          {h.circuit && (
            <>
              <span className="text-[#D5DFE3]">—</span>
              <span>{h.circuit}</span>
            </>
          )}
          <span className="text-[#D5DFE3]">—</span>
          <span>قيد: {h.proceedingLabel}</span>
        </div>

        {(h.clientNames.length > 0 || h.paperLocationName) && (
          <div className="text-xs text-[#4D606A] flex flex-wrap items-center gap-x-4 gap-y-1">
            {h.clientNames.length > 0 && (
              <span>
                الموكل: <strong className="text-[#172A35]">{h.clientNames.join('، ')}</strong>
              </span>
            )}
            {h.paperLocationName && (
              <span>
                الحفظ الورقي: <strong className="text-[#172A35]">{h.paperLocationName}</strong>
              </span>
            )}
          </div>
        )}

        {h.purpose && (
          <div className="bg-[#F8FAFB] border border-[#E5ECEE] rounded-[4px] p-2.5 text-xs text-[#172A35] flex items-center gap-2">
            <IconGavel className="w-4 h-4 text-[#14566B] shrink-0" />
            <span>
              <strong className="text-[#4D606A]">المطلوب قبل الجلسة:</strong> {h.purpose}
            </span>
          </div>
        )}

        <div className="pt-1 flex flex-wrap items-center gap-2.5">
          <Link
            href={`/hearings/${h.id}/result`}
            className="min-h-[44px] px-4 bg-[#14566B] hover:bg-[#0F4354] text-white rounded-[6px] text-sm font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <IconGavel className="w-4 h-4" />
            <span>تسجيل نتيجة الجلسة</span>
          </Link>
          <Link
            href={`/matters/${h.matterId}`}
            className="min-h-[44px] px-3.5 bg-white border border-[#D5DFE3] hover:bg-[#F4F6F7] text-[#172A35] rounded-[6px] text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <IconFolder className="w-4 h-4 text-[#4D606A]" />
            <span>فتح ملف القضية</span>
          </Link>
        </div>
      </div>
    </article>
  );

  return (
    <div className="space-y-6 max-w-[1240px] mx-auto" data-testid="today-view">
      {/* Stitch S02 Operational Header Card */}
      <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 flex flex-col gap-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold text-[#172A35]">لوحة المتابعة اليومية</h1>
              <span className="bg-[#E9F2F5] text-[#14566B] border border-[#C2D9E2] text-xs font-semibold px-2.5 py-0.5 rounded-[4px] inline-flex items-center gap-1.5">
                <IconToday className="w-3.5 h-3.5" />
                <span>توقيت القاهرة</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[#4D606A]">
              <p className="font-semibold text-[#172A35]" data-testid="today-cairo-date">
                {overview.cairoTodayFormatted} (<bdi dir="ltr">{overview.cairoToday}</bdi>)
              </p>
              <span className="text-[#D5DFE3]">•</span>
              <span>متابعة الجلسات والمواعيد القانونية والمهام المقررة اليوم</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-[#F4F6F7] border border-[#D5DFE3] px-3.5 py-2 rounded-[6px] text-xs text-[#4D606A] min-h-[44px]">
              <IconCalendar className="w-4 h-4 text-[#14566B]" />
              <span>
                دفتر الجلسات اليومي:{' '}
                <strong className="text-[#172A35] font-bold">{agenda.hearings.length} جلسات مُدرجة</strong>
              </span>
            </div>
            <button
              type="button"
              data-testid="today-refresh-button"
              onClick={refreshToday}
              className="px-3.5 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] inline-flex items-center gap-1.5 transition-colors"
            >
              <IconRefresh className="w-4 h-4 text-[#14566B]" />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {/* Stitch Quick Action Buttons Bar */}
        <div className="pt-3 border-t border-[#D5DFE3] flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-[#4D606A] ml-1">إجراء سريع:</span>
          <Link
            href="/agenda"
            className="min-h-[44px] px-3.5 bg-[#14566B] hover:bg-[#0F4354] text-white rounded-[6px] text-sm font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <IconCalendar className="w-4 h-4" />
            <span>الأجندة الكاملة</span>
          </Link>
          <Link
            href="/deadlines"
            className="min-h-[44px] px-3.5 bg-white border border-[#D5DFE3] hover:border-[#14566B] hover:text-[#14566B] text-[#172A35] rounded-[6px] text-sm font-medium inline-flex items-center gap-2 transition-colors"
          >
            <IconDeadline className="w-4 h-4 text-[#14566B]" />
            <span>المواعيد القانونية</span>
          </Link>
          <Link
            href="/tasks"
            className="min-h-[44px] px-3.5 bg-white border border-[#D5DFE3] hover:border-[#14566B] hover:text-[#14566B] text-[#172A35] rounded-[6px] text-sm font-medium inline-flex items-center gap-2 transition-colors"
          >
            <IconTask className="w-4 h-4 text-[#14566B]" />
            <span>المهام الإجرائية</span>
          </Link>
          <Link
            href="/matters/new"
            className="min-h-[44px] px-3.5 bg-white border border-[#D5DFE3] hover:border-[#14566B] hover:text-[#14566B] text-[#172A35] rounded-[6px] text-sm font-medium inline-flex items-center gap-2 transition-colors"
          >
            <IconPlus className="w-4 h-4 text-[#14566B]" />
            <span>فتح ملف قضية</span>
          </Link>
        </div>
      </div>

      {/* Operational Alerts & Court Conflicts */}
      {(operatingAlerts.notes.length > 0 || agenda.sameDayCourtConflicts.length > 0) && (
        <div role="region" aria-label="تنبيهات التشغيل" className="space-y-2">
          {agenda.sameDayCourtConflicts.map((c) => (
            <div
              key={`${c.date}-${c.courtIds.join(',')}`}
              role="alert"
              className="p-3.5 bg-[#FFF7E6] border border-[#E0B46A] text-[#7A4A00] rounded-[6px] text-sm font-semibold flex items-center gap-2"
            >
              <IconWarning className="w-4 h-4 shrink-0" />
              <span>{c.message}</span>
            </div>
          ))}
          {operatingAlerts.notes.map((note, idx) => (
            <div
              key={idx}
              className="p-3 bg-[#E9F2F5] border border-[#C2D9E2] text-[#14566B] rounded-[6px] text-sm font-medium"
            >
              {note}
            </div>
          ))}
        </div>
      )}

      {taskActionNotice && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-[#176449] rounded-[6px] text-sm font-medium">
          {taskActionNotice}
        </div>
      )}
      {taskActionError && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-sm font-medium">
          {taskActionError}
        </div>
      )}

      {!hasAnyItems ? (
        <div data-testid="agenda-empty-state">
          <EmptyStateContainer
            title="لا توجد جلسات أو مواعيد أو مهام مستحقة اليوم"
            description="يومك خالٍ من الأعمال المجدولة حالياً. يمكنك مراجعة الأجندة الكاملة أو إضافة مهمة جديدة أو موعد قانوني."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  href="/agenda"
                  className="px-4 py-2 bg-[#14566B] text-white text-sm font-bold rounded-[6px] min-h-[44px] inline-flex items-center"
                >
                  عرض الأجندة
                </Link>
                <Link
                  href="/tasks"
                  className="px-4 py-2 bg-white text-[#14566B] border border-[#D5DFE3] text-sm font-bold rounded-[6px] min-h-[44px] inline-flex items-center"
                >
                  إضافة مهمة
                </Link>
              </div>
            }
          />
        </div>
      ) : (
        /* Stitch S02 Two-Column Split Grid (8 cols right hearings/summary, 4 cols left deadlines/tasks) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* DOMINANT RIGHT COLUMN (8/12) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            {/* 1. Today's Hearings */}
            <section
              data-testid="today-hearings-section"
              aria-labelledby="today-hearings-heading"
              className="bg-white border border-[#D5DFE3] rounded-[6px] overflow-hidden shadow-xs"
            >
              <div className="p-4 px-5 border-b border-[#D5DFE3] flex flex-wrap items-center justify-between gap-2 bg-white">
                <div className="flex items-center gap-2.5">
                  <IconGavel className="w-5 h-5 text-[#14566B]" />
                  <h2 id="today-hearings-heading" className="text-lg font-bold text-[#172A35]">
                    جلسات اليوم ({agenda.hearings.length})
                  </h2>
                </div>
                <Link
                  href="/agenda"
                  className="min-h-[36px] px-3 py-1.5 bg-[#F8FAFB] hover:bg-[#E9F2F5] border border-[#D5DFE3] rounded-[6px] text-xs font-semibold text-[#14566B] inline-flex items-center gap-1.5 transition-colors"
                >
                  <IconCalendar className="w-3.5 h-3.5" />
                  <span>عرض كشف الجلسات والأجندة</span>
                </Link>
              </div>

              {agenda.hearings.length === 0 ? (
                <p className="text-sm text-[#4D606A] p-5">
                  لا توجد جلسات قضائية محددة لهذا اليوم.
                </p>
              ) : (
                <div className="divide-y divide-[#D5DFE3]">
                  {agenda.timedHearings.map(renderHearingRow)}

                  {agenda.untimedHearings.length > 0 && (
                    <div
                      data-testid="agenda-unknown-time-group"
                      className="bg-[#FAFBFD] p-4 space-y-3"
                    >
                      <div className="flex items-center gap-2 px-1">
                        <IconClock className="w-4 h-4 text-[#7A4A00]" />
                        <h3 className="text-sm font-bold text-[#172A35]">
                          جلسات بدون ساعة محددة ({agenda.untimedHearings.length})
                        </h3>
                      </div>
                      <div className="bg-white border border-[#D5DFE3] rounded-[6px] divide-y divide-[#D5DFE3]">
                        {agenda.untimedHearings.map(renderHearingRow)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 5. Weekly Summary & Truthful Operational Status */}
            <section
              aria-label="ملخص الأسبوع الحالي"
              className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5ECEE]">
                <div className="flex items-center gap-2">
                  <IconCalendar className="w-5 h-5 text-[#14566B]" />
                  <h2 className="text-base font-bold text-[#172A35]">ملخص الأسبوع الحالي</h2>
                </div>
                <span className="text-xs font-medium text-[#4D606A] bg-[#F8FAFB] px-2.5 py-1 rounded border border-[#D5DFE3]">
                  من <bdi dir="ltr">{weeklySummary.startDate}</bdi> إلى <bdi dir="ltr">{weeklySummary.endDate}</bdi>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="p-3.5 bg-[#F8FAFB] rounded-[6px] border border-[#D5DFE3]">
                  <span className="text-xs text-[#4D606A] block">جلسات الأسبوع المحددة</span>
                  <strong className="text-xl font-bold text-[#14566B] mt-1 block">{weeklySummary.hearingsCount}</strong>
                </div>
                <div className="p-3.5 bg-[#F8FAFB] rounded-[6px] border border-[#D5DFE3]">
                  <span className="text-xs text-[#4D606A] block">مواعيد قانونية مؤكدة</span>
                  <strong className="text-xl font-bold text-[#14566B] mt-1 block">{weeklySummary.confirmedDeadlinesCount}</strong>
                </div>
                <div className="p-3.5 bg-[#F8FAFB] rounded-[6px] border border-[#D5DFE3]">
                  <span className="text-xs text-[#4D606A] block">مهام مجدولة هذا الأسبوع</span>
                  <strong className="text-xl font-bold text-[#14566B] mt-1 block">{weeklySummary.tasksCount}</strong>
                </div>
              </div>

              <p className="text-xs text-[#4D606A] leading-relaxed bg-[#F8FAFB] p-3 rounded-[4px] border border-[#E5ECEE]">
                {operatingAlerts.workerStatusNote}
              </p>
            </section>
          </div>

          {/* FOCUSED LEFT COLUMN (4/12): Deadlines & Tasks */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            {/* 2. Legal Deadlines Needing Confirmation (Stitch Warm Amber Box) */}
            <section
              data-testid="today-deadlines-review-section"
              aria-labelledby="today-deadlines-review-heading"
              className="bg-[#FFFDF9] border border-[#E0B46A] rounded-[6px] overflow-hidden shadow-xs"
            >
              <div className="p-4 border-b border-[#EED29F] bg-[#FFF7E6] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IconWarning className="w-5 h-5 text-[#7A4A00] shrink-0" />
                  <h2 id="today-deadlines-review-heading" className="text-base font-bold text-[#7A4A00]">
                    مواعيد قانونية تحتاج مراجعة ({agenda.draftDeadlines.length})
                  </h2>
                </div>
                <span className="bg-white text-[#7A4A00] border border-[#E0B46A] text-xs font-bold px-2 py-0.5 rounded-[4px] shrink-0">
                  حاسم
                </span>
              </div>

              {agenda.draftDeadlines.length === 0 ? (
                <p className="text-sm text-[#4D606A] p-4">
                  لا توجد مسودات مواعيد قانونية بانتظار المراجعة.
                </p>
              ) : (
                <div className="p-4 space-y-3">
                  {agenda.draftDeadlines.map((d) => (
                    <article
                      key={d.id}
                      data-testid={`agenda-item-deadline-${d.id}`}
                      className="bg-white rounded-[6px] border border-[#EED29F] p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${DEADLINE_STATUS_CLASSES[d.status]}`}>
                          {DEADLINE_STATUS_LABELS[d.status]}
                        </span>
                        <bdi dir="ltr" className="text-xs font-mono text-[#14566B] bg-[#E9F2F5] px-2 py-0.5 rounded">
                          {d.matterFileCode}
                        </bdi>
                      </div>
                      <h3 className="text-sm font-bold text-[#172A35] [overflow-wrap:anywhere]">{d.title}</h3>
                      <div className="text-xs text-[#4D606A] space-y-1">
                        <div>{d.matterTitle}</div>
                        <div>{d.dueDate ? formatCairoDateArabic(d.dueDate) : 'بدون تاريخ محدد'}</div>
                      </div>
                      <Link
                        href={`/deadlines?review=${d.id}`}
                        className="w-full min-h-[44px] px-4 py-2 bg-[#7A4A00] hover:bg-[#5E3800] text-white text-sm font-bold rounded-[6px] inline-flex items-center justify-center gap-2 transition-colors"
                      >
                        <IconCheck className="w-4 h-4" />
                        <span>مراجعة واعتماد الموعد</span>
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* 3. Approaching / Today / Overdue Confirmed Deadlines */}
            <section
              data-testid="today-deadlines-upcoming-section"
              aria-labelledby="today-deadlines-upcoming-heading"
              className="bg-white border border-[#D5DFE3] rounded-[6px] overflow-hidden shadow-xs"
            >
              <div className="p-4 border-b border-[#D5DFE3] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IconDeadline className="w-5 h-5 text-[#14566B] shrink-0" />
                  <h2 id="today-deadlines-upcoming-heading" className="text-base font-bold text-[#172A35]">
                    مواعيد قانونية مؤكدة ({upcomingConfirmedDeadlines.length})
                  </h2>
                </div>
              </div>

              {upcomingConfirmedDeadlines.length === 0 ? (
                <p className="text-sm text-[#4D606A] p-4">
                  لا توجد مواعيد قانونية مؤكدة مستحقة اليوم أو متأخرة.
                </p>
              ) : (
                <div className="p-4 space-y-3">
                  {upcomingConfirmedDeadlines.map((d) => (
                    <article
                      key={d.id}
                      data-testid={`agenda-item-deadline-${d.id}`}
                      className={`bg-white rounded-[6px] border p-3.5 space-y-2 ${
                        d.isOverdue ? 'border-[#A4262C]' : 'border-[#D5DFE3]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${DEADLINE_STATUS_CLASSES[d.status]}`}>
                          موعد قانوني — {DEADLINE_STATUS_LABELS[d.status]}
                        </span>
                        {d.isOverdue && (
                          <span
                            data-testid={`deadline-overdue-badge-${d.id}`}
                            className="text-xs font-bold px-2 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300"
                          >
                            متأخر
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-[#172A35] [overflow-wrap:anywhere]">{d.title}</h3>
                      <div className="text-xs text-[#4D606A] space-y-1">
                        <div>
                          ملف <bdi dir="ltr">{d.matterFileCode}</bdi> — {d.matterTitle}
                        </div>
                        {d.dueDate && (
                          <div>
                            {formatCairoDateArabic(d.dueDate)} (<bdi dir="ltr">{d.dueDate}</bdi>) — {d.timeLabel}
                          </div>
                        )}
                      </div>
                      <Link
                        href="/deadlines"
                        className="w-full min-h-[44px] px-3 py-2 bg-[#F8FAFB] hover:bg-[#E9F2F5] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#D5DFE3] inline-flex items-center justify-center transition-colors"
                      >
                        إدارة الموعد القانوني
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* 4. Overdue & Today's Tasks */}
            <section
              data-testid="today-overdue-tasks-section"
              aria-labelledby="today-tasks-heading"
              className="bg-white border border-[#D5DFE3] rounded-[6px] overflow-hidden shadow-xs"
            >
              <div className="p-4 border-b border-[#D5DFE3] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IconTask className="w-5 h-5 text-[#14566B] shrink-0" />
                  <h2 id="today-tasks-heading" className="text-base font-bold text-[#172A35]">
                    المهام المتأخرة ومهام اليوم ({dueAndOverdueTasks.length})
                  </h2>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {dueAndOverdueTasks.length === 0 ? (
                  <p className="text-sm text-[#4D606A]">
                    لا توجد مهام متأخرة أو مستحقة اليوم.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {dueAndOverdueTasks.map((t) => (
                      <article
                        key={t.id}
                        data-testid={`agenda-item-task-${t.id}`}
                        className={`bg-white rounded-[6px] border p-3.5 space-y-2.5 ${
                          t.isOverdue ? 'border-[#A4262C]/60' : 'border-[#D5DFE3]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${TASK_PRIORITY_CLASSES[t.priority]}`}>
                            مهمة • {TASK_PRIORITY_LABELS[t.priority]}
                          </span>
                          {t.isOverdue && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300">
                              متأخرة
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-[#172A35] [overflow-wrap:anywhere]">{t.title}</h3>
                        <div className="text-xs text-[#4D606A] space-y-1">
                          <div>
                            {t.matterTitle ? (
                              <>
                                ملف <bdi dir="ltr">{t.matterFileCode}</bdi> — {t.matterTitle}
                              </>
                            ) : (
                              'مهمة عامة'
                            )}
                          </div>
                          {t.dueDate && (
                            <div>
                              {formatCairoDateArabic(t.dueDate)} ({t.timeLabel})
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={completingTaskId === t.id}
                          onClick={() => handleCompleteTask(t)}
                          className="w-full px-3 py-2 bg-[#176449] hover:bg-[#114D38] text-white text-xs font-bold rounded-[6px] min-h-[44px] inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          <IconCheck className="w-4 h-4" />
                          <span>{completingTaskId === t.id ? 'جارٍ التنفيذ...' : 'تمت'}</span>
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                {agenda.undatedTasks.length > 0 && (
                  <div
                    data-testid="agenda-undated-tasks-group"
                    className="bg-[#F8FAFB] border border-[#D5DFE3] rounded-[6px] p-3.5 space-y-2.5"
                  >
                    <h3 className="text-sm font-bold text-[#172A35]">
                      مهام بدون تاريخ محدد ({agenda.undatedTasks.length})
                    </h3>
                    <div className="space-y-2">
                      {agenda.undatedTasks.map((t) => (
                        <div
                          key={t.id}
                          data-testid={`agenda-item-task-${t.id}`}
                          className="bg-white rounded-[6px] border border-[#D5DFE3] p-3 space-y-2"
                        >
                          <div>
                            <p className="text-sm font-bold text-[#172A35] [overflow-wrap:anywhere]">{t.title}</p>
                            <p className="text-xs text-[#4D606A]">
                              {t.matterTitle ? `${t.matterFileCode} — ${t.matterTitle}` : 'مهمة عامة بدون تاريخ'}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={completingTaskId === t.id}
                            onClick={() => handleCompleteTask(t)}
                            className="w-full px-3 py-2 bg-[#176449] hover:bg-[#114D38] text-white text-xs font-bold rounded-[6px] min-h-[44px] inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                          >
                            <IconCheck className="w-4 h-4" />
                            <span>{completingTaskId === t.id ? 'جارٍ التنفيذ...' : 'تمت'}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
