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
          <LoadingIndicator label="جارٍ تحميل ملخص اليوم..." />
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
              className="w-12 h-12 mx-auto rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-xl text-[#A4262C] select-none"
              aria-hidden="true"
            >
              ⚠️
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

  // Deduplicate upcoming/overdue confirmed deadlines, keeping overdue first
  const upcomingDeadlineMap = new Map<string, AgendaDeadlineItemDTO>();
  for (const d of agenda.overdueDeadlines) upcomingDeadlineMap.set(d.id, d);
  for (const d of agenda.confirmedDeadlines) {
    if (!upcomingDeadlineMap.has(d.id)) upcomingDeadlineMap.set(d.id, d);
  }
  const upcomingConfirmedDeadlines = Array.from(upcomingDeadlineMap.values());

  // Deduplicate overdue + today's tasks, overdue first
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

  const renderHearingCard = (h: AgendaHearingItemDTO) => (
    <article
      key={h.id}
      data-testid={`agenda-item-hearing-${h.id}`}
      className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-2.5"
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-2 border-b border-[#E8EEF1]">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold px-2 py-0.5 rounded bg-sky-50 text-[#14566B] border border-sky-200">
              ⚖️ جلسة
            </span>
            <Link
              href={`/matters/${h.matterId}`}
              className="text-base font-bold text-[#172A35] hover:text-[#14566B] hover:underline [overflow-wrap:anywhere]"
            >
              {h.matterTitle}
            </Link>
            <bdi dir="ltr" className="text-sm font-mono text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
              {h.matterFileCode}
            </bdi>
          </div>
          <div className="text-sm text-[#4D606A] flex flex-wrap items-center gap-2">
            <span>{h.courtName}</span>
            {h.circuit && <span>• {h.circuit}</span>}
            <span>• قيد: {h.proceedingLabel}</span>
          </div>
        </div>

        <div className="shrink-0">
          {h.hearingTime ? (
            <span className="inline-block text-sm font-bold px-2.5 py-1 rounded bg-blue-50 text-blue-900 border border-blue-200">
              🕒 {h.timeLabel}
            </span>
          ) : (
            <span
              data-testid={`hearing-unknown-time-${h.id}`}
              className="inline-block text-sm font-semibold px-2.5 py-1 rounded bg-stone-100 text-[#4D606A] border border-stone-300"
            >
              {h.timeLabel}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-[#172A35]">
        {h.clientNames.length > 0 && (
          <div>
            <span className="font-semibold text-[#4D606A]">الموكل: </span>
            <span>{h.clientNames.join('، ')}</span>
          </div>
        )}
        {h.paperLocationName && (
          <div>
            <span className="font-semibold text-[#4D606A]">الحفظ الورقي: </span>
            <span>{h.paperLocationName}</span>
          </div>
        )}
        {h.purpose && (
          <div className="sm:col-span-2">
            <span className="font-semibold text-[#4D606A]">المطلوب قبل الجلسة: </span>
            <span>{h.purpose}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link
          href={`/hearings/${h.id}/result`}
          className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] inline-flex items-center gap-1.5"
        >
          <span>⚖️</span>
          <span>تسجيل نتيجة الجلسة</span>
        </Link>
        <Link
          href={`/matters/${h.matterId}`}
          className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] inline-flex items-center"
        >
          فتح ملف القضية
        </Link>
      </div>
    </article>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="today-view">
      {/* Header: Cairo Today Date + Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#D5DFE3]">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[#172A35]">☀️ النهارده — أجندة اليوم</h1>
          <p className="text-base font-semibold text-[#14566B]" data-testid="today-cairo-date">
            {overview.cairoTodayFormatted} (<bdi dir="ltr">{overview.cairoToday}</bdi>)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="today-refresh-button"
            onClick={refreshToday}
            className="px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
          >
            🔄 تحديث
          </button>
          <Link
            href="/agenda"
            className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] inline-flex items-center"
          >
            📅 الأجندة الكاملة
          </Link>
          <Link
            href="/deadlines"
            className="px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#14566B] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] inline-flex items-center"
          >
            ⏳ المواعيد القانونية
          </Link>
          <Link
            href="/tasks"
            className="px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#14566B] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] inline-flex items-center"
          >
            ☑️ المهام
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
              className="p-3.5 bg-amber-50 border border-amber-300 text-[#7A4A00] rounded-[6px] text-sm font-semibold"
            >
              ⚠️ {c.message}
            </div>
          ))}
          {operatingAlerts.notes.map((note, idx) => (
            <div
              key={idx}
              className="p-3 bg-sky-50 border border-sky-200 text-[#14566B] rounded-[6px] text-sm font-medium"
            >
              ℹ️ {note}
            </div>
          ))}
        </div>
      )}

      {taskActionNotice && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-[#176449] rounded-[6px] text-sm font-medium">
          ✓ {taskActionNotice}
        </div>
      )}
      {taskActionError && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-sm font-medium">
          ⚠️ {taskActionError}
        </div>
      )}

      {!hasAnyItems ? (
        <div data-testid="agenda-empty-state">
          <EmptyStateContainer
            icon="☀️"
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
        <div className="space-y-8">
          {/* 1. Today's Hearings */}
          <section data-testid="today-hearings-section" className="space-y-3" aria-labelledby="today-hearings-heading">
            <h2 id="today-hearings-heading" className="text-lg font-bold text-[#172A35]">
              ⚖️ جلسات اليوم ({agenda.hearings.length})
            </h2>
            {agenda.hearings.length === 0 ? (
              <p className="text-sm text-[#4D606A] bg-white p-4 rounded-[6px] border border-[#D5DFE3]">
                لا توجد جلسات محددة لهذا اليوم.
              </p>
            ) : (
              <div className="space-y-4">
                {agenda.timedHearings.length > 0 && (
                  <div className="space-y-3">{agenda.timedHearings.map(renderHearingCard)}</div>
                )}

                {agenda.untimedHearings.length > 0 && (
                  <div
                    data-testid="agenda-unknown-time-group"
                    className="space-y-3 bg-stone-50 p-4 rounded-[6px] border border-stone-300"
                  >
                    <h3 className="text-base font-bold text-[#172A35]">
                      🕒 جلسات بدون ساعة محددة ({agenda.untimedHearings.length})
                    </h3>
                    <div className="space-y-3">{agenda.untimedHearings.map(renderHearingCard)}</div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 2. Legal Deadlines Needing Confirmation */}
          <section
            data-testid="today-deadlines-review-section"
            className="space-y-3"
            aria-labelledby="today-deadlines-review-heading"
          >
            <h2 id="today-deadlines-review-heading" className="text-lg font-bold text-[#7A4A00]">
              ⚠️ مواعيد قانونية تحتاج مراجعة واعتماد ({agenda.draftDeadlines.length})
            </h2>
            {agenda.draftDeadlines.length === 0 ? (
              <p className="text-sm text-[#4D606A] bg-white p-4 rounded-[6px] border border-[#D5DFE3]">
                لا توجد مسودات مواعيد قانونية بانتظار المراجعة.
              </p>
            ) : (
              <div className="space-y-3">
                {agenda.draftDeadlines.map((d) => (
                  <article
                    key={d.id}
                    data-testid={`agenda-item-deadline-${d.id}`}
                    className="bg-white rounded-[6px] border border-amber-300 p-4 shadow-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-bold px-2 py-0.5 rounded border ${DEADLINE_STATUS_CLASSES[d.status]}`}>
                          ⏳ {DEADLINE_STATUS_LABELS[d.status]}
                        </span>
                        <h3 className="text-base font-bold text-[#172A35]">{d.title}</h3>
                      </div>
                      <Link
                        href={`/deadlines?review=${d.id}`}
                        className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] inline-flex items-center"
                      >
                        مراجعة واعتماد الموعد
                      </Link>
                    </div>
                    <div className="text-sm text-[#4D606A] flex flex-wrap gap-2">
                      <span>
                        ملف <bdi dir="ltr">{d.matterFileCode}</bdi> — {d.matterTitle}
                      </span>
                      <span>• {d.dueDate ? formatCairoDateArabic(d.dueDate) : 'بدون تاريخ محدد'}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* 3. Approaching / Today / Overdue Confirmed Deadlines */}
          <section
            data-testid="today-deadlines-upcoming-section"
            className="space-y-3"
            aria-labelledby="today-deadlines-upcoming-heading"
          >
            <h2 id="today-deadlines-upcoming-heading" className="text-lg font-bold text-[#14566B]">
              ⏳ مواعيد قانونية مؤكدة (اليوم والمتأخرة) ({upcomingConfirmedDeadlines.length})
            </h2>
            {upcomingConfirmedDeadlines.length === 0 ? (
              <p className="text-sm text-[#4D606A] bg-white p-4 rounded-[6px] border border-[#D5DFE3]">
                لا توجد مواعيد قانونية مؤكدة مستحقة اليوم أو متأخرة.
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingConfirmedDeadlines.map((d) => (
                  <article
                    key={d.id}
                    data-testid={`agenda-item-deadline-${d.id}`}
                    className={`bg-white rounded-[6px] border p-4 shadow-xs space-y-2 ${
                      d.isOverdue ? 'border-[#A4262C]' : 'border-[#D5DFE3]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-bold px-2 py-0.5 rounded border ${DEADLINE_STATUS_CLASSES[d.status]}`}>
                          ⏳ موعد قانوني — {DEADLINE_STATUS_LABELS[d.status]}
                        </span>
                        {d.isOverdue && (
                          <span
                            data-testid={`deadline-overdue-badge-${d.id}`}
                            className="text-sm font-bold px-2 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300"
                          >
                            ⚠️ متأخر
                          </span>
                        )}
                        <h3 className="text-base font-bold text-[#172A35]">{d.title}</h3>
                      </div>
                      <Link
                        href="/deadlines"
                        className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-sm font-bold rounded-[6px] border border-[#D5DFE3] min-h-[44px] inline-flex items-center"
                      >
                        إدارة الموعد القانوني
                      </Link>
                    </div>
                    <div className="text-sm text-[#4D606A] flex flex-wrap gap-2">
                      <span>
                        ملف <bdi dir="ltr">{d.matterFileCode}</bdi> — {d.matterTitle}
                      </span>
                      {d.dueDate && (
                        <span>
                          • {formatCairoDateArabic(d.dueDate)} (<bdi dir="ltr">{d.dueDate}</bdi>) — {d.timeLabel}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* 4. Overdue & Today's Tasks */}
          <section
            data-testid="today-overdue-tasks-section"
            className="space-y-3"
            aria-labelledby="today-tasks-heading"
          >
            <h2 id="today-tasks-heading" className="text-lg font-bold text-[#172A35]">
              ☑️ المهام المتأخرة ومهام اليوم ({dueAndOverdueTasks.length})
            </h2>
            {dueAndOverdueTasks.length === 0 ? (
              <p className="text-sm text-[#4D606A] bg-white p-4 rounded-[6px] border border-[#D5DFE3]">
                لا توجد مهام متأخرة أو مستحقة اليوم.
              </p>
            ) : (
              <div className="space-y-3">
                {dueAndOverdueTasks.map((t) => (
                  <article
                    key={t.id}
                    data-testid={`agenda-item-task-${t.id}`}
                    className={`bg-white rounded-[6px] border p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      t.isOverdue ? 'border-[#A4262C]/50' : 'border-[#D5DFE3]'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-semibold px-2 py-0.5 rounded border ${TASK_PRIORITY_CLASSES[t.priority]}`}>
                          ☑️ مهمة • {TASK_PRIORITY_LABELS[t.priority]}
                        </span>
                        {t.isOverdue && (
                          <span className="text-sm font-bold px-2 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300">
                            ⚠️ متأخرة
                          </span>
                        )}
                        <h3 className="text-base font-bold text-[#172A35] [overflow-wrap:anywhere]">{t.title}</h3>
                      </div>
                      <div className="text-sm text-[#4D606A] flex flex-wrap gap-2">
                        {t.matterTitle ? (
                          <span>
                            ملف <bdi dir="ltr">{t.matterFileCode}</bdi> — {t.matterTitle}
                          </span>
                        ) : (
                          <span>مهمة عامة</span>
                        )}
                        {t.dueDate && (
                          <span>
                            • {formatCairoDateArabic(t.dueDate)} ({t.timeLabel})
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={completingTaskId === t.id}
                      onClick={() => handleCompleteTask(t)}
                      className="px-4 py-2 bg-[#176449] hover:bg-[#114D38] text-white text-sm font-bold rounded-[6px] min-h-[44px] shrink-0 disabled:opacity-50"
                    >
                      {completingTaskId === t.id ? 'جارٍ التنفيذ...' : '✓ تمت'}
                    </button>
                  </article>
                ))}
              </div>
            )}

            {agenda.undatedTasks.length > 0 && (
              <div
                data-testid="agenda-undated-tasks-group"
                className="bg-slate-50 border border-slate-300 rounded-[6px] p-4 space-y-3"
              >
                <h3 className="text-base font-bold text-[#172A35]">
                  📌 مهام بدون تاريخ محدد ({agenda.undatedTasks.length})
                </h3>
                <div className="space-y-2">
                  {agenda.undatedTasks.map((t) => (
                    <div
                      key={t.id}
                      data-testid={`agenda-item-task-${t.id}`}
                      className="bg-white rounded-[6px] border border-[#D5DFE3] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <p className="text-base font-bold text-[#172A35]">{t.title}</p>
                        <p className="text-sm text-[#4D606A]">
                          {t.matterTitle ? `${t.matterFileCode} — ${t.matterTitle}` : 'مهمة عامة بدون تاريخ'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={completingTaskId === t.id}
                        onClick={() => handleCompleteTask(t)}
                        className="px-4 py-2 bg-[#176449] hover:bg-[#114D38] text-white text-sm font-bold rounded-[6px] min-h-[44px] shrink-0 disabled:opacity-50"
                      >
                        {completingTaskId === t.id ? 'جارٍ التنفيذ...' : '✓ تمت'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* 5. Weekly Summary & Truthful Operational Status */}
      <section
        aria-label="ملخص الأسبوع الحالي"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[#172A35]">📊 ملخص الأسبوع الحالي</h2>
          <span className="text-sm text-[#4D606A]">
            من <bdi dir="ltr">{weeklySummary.startDate}</bdi> إلى <bdi dir="ltr">{weeklySummary.endDate}</bdi>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="p-3 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3]">
            <span className="text-[#4D606A] block">جلسات الأسبوع المحددة</span>
            <strong className="text-lg text-[#14566B]">{weeklySummary.hearingsCount}</strong>
          </div>
          <div className="p-3 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3]">
            <span className="text-[#4D606A] block">مواعيد قانونية مؤكدة</span>
            <strong className="text-lg text-[#14566B]">{weeklySummary.confirmedDeadlinesCount}</strong>
          </div>
          <div className="p-3 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3]">
            <span className="text-[#4D606A] block">مهام مجدولة هذا الأسبوع</span>
            <strong className="text-lg text-[#14566B]">{weeklySummary.tasksCount}</strong>
          </div>
        </div>

        <p className="text-sm text-[#4D606A] pt-1">{operatingAlerts.workerStatusNote}</p>
      </section>
    </div>
  );
}
