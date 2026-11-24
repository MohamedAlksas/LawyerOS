'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  markReminderReadAction,
  retryFailedReminderJobAction,
  updateReminderRuleAction,
} from '@/modules/reminders/reminder-actions';
import type {
  ActionResult,
  FailedReminderJobDTO,
  InboxItemDTO,
  InboxOverviewDTO,
  ReminderRuleDTO,
  WorkerHealthState,
} from '@/modules/reminders/reminder-types';
import { formatCairoDateArabic } from '@/lib/cairo-date';
import { EmptyStateContainer, ErrorContainer, LoadingIndicator } from '@/components/presentation-state';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';
import {
  formatCairoInstantArabic,
  isUncertainMutationOutcome,
} from '@/components/productivity/productivity-ui-types';
import {
  IconBell,
  IconCheck,
  IconClock,
  IconFolder,
  IconRefresh,
  IconSettings,
  IconWarning,
} from '@/components/stitch-icons';

interface InboxViewProps {
  initialOverview: InboxOverviewDTO | null;
  initialError?: string;
}

type InboxFilter = 'all' | 'unread' | 'overdue';

const WORKER_STATUS_META: Record<
  WorkerHealthState,
  { label: string; badgeClass: string; summary: string }
> = {
  HEALTHY: {
    label: 'يعمل بصورة طبيعية',
    badgeClass: 'bg-emerald-50 text-[#176449] border-emerald-300',
    summary: 'عامل التذكيرات متصل ويُحدّث صندوق التنبيهات دورياً.',
  },
  FAILED: {
    label: 'متعطل — توجد مهام متعثرة',
    badgeClass: 'bg-red-50 text-[#A4262C] border-red-300',
    summary: 'فشلت إحدى مهام التذكير بعد استنفاد المحاولات أو رُصد خطأ تشغيلي.',
  },
  RESTORE_MODE: {
    label: 'وضع الاستعادة (الإرسال معطّل)',
    badgeClass: 'bg-[#FFF7E6] text-[#7A4A00] border-[#E0B46A]',
    summary: 'نظام التذكيرات متوقف مؤقتاً في وضع الاستعادة لحين المراجعة اليدوية.',
  },
  STALE: {
    label: 'تأخر التحديث',
    badgeClass: 'bg-[#FFF7E6] text-[#7A4A00] border-[#E0B46A]',
    summary: 'لم يُسجّل عامل التذكيرات نبضة حديثة خلال الدقائق الأخيرة.',
  },
  NOT_STARTED: {
    label: 'لم يبدأ التشغيل بعد',
    badgeClass: 'bg-[#F8FAFB] text-[#4D606A] border-[#D5DFE3]',
    summary: 'لم يُرصد تشغيل عامل التذكيرات حتى الآن؛ ستظهر التنبيهات بعد تشغيله.',
  },
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  Hearing: 'جلسة قضائية',
  Deadline: 'موعد قانوني',
  Task: 'مهمة إجرائية',
};

const RULE_EVENT_LABELS: Record<ReminderRuleDTO['eventType'], string> = {
  HEARING: 'الجلسات القضائية',
  DEADLINE: 'المواعيد القانونية المؤكدة',
  TASK: 'المهام الإجرائية المؤرخة',
};

export function InboxView({ initialOverview, initialError }: InboxViewProps) {
  const router = useRouter();
  const [overview, setOverview] = useState<InboxOverviewDTO | null>(initialOverview);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<
    Record<string, { dayOffset: number; reminderTime: string; enabled: boolean }>
  >(() => {
    const initial: Record<string, { dayOffset: number; reminderTime: string; enabled: boolean }> = {};
    for (const r of initialOverview?.rules ?? []) {
      initial[r.id] = { dayOffset: r.dayOffset, reminderTime: r.reminderTime, enabled: r.enabled };
    }
    return initial;
  });

  const retryJobKeysRef = useRef<Map<string, string>>(new Map());
  const ruleKeysRef = useRef<Map<string, string>>(new Map());
  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshSeqRef = useRef(0);

  const syncRuleDrafts = useCallback((rules: ReminderRuleDTO[]) => {
    setRuleDrafts(() => {
      const next: Record<string, { dayOffset: number; reminderTime: string; enabled: boolean }> = {};
      for (const r of rules) {
        next[r.id] = { dayOffset: r.dayOffset, reminderTime: r.reminderTime, enabled: r.enabled };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

  const refreshInbox = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const seq = ++refreshSeqRef.current;

    setIsRefreshing(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/reminders/inbox', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
      }
      const body = (await res.json().catch(() => null)) as ActionResult<InboxOverviewDTO> | null;
      if (seq !== refreshSeqRef.current) return;
      if (!res.ok || !body || !body.success) {
        throw new Error(
          body && !body.success
            ? body.error
            : 'تعذر تحديث صندوق التنبيهات من الخادم. تحقق من الاتصال وأعد المحاولة.'
        );
      }
      setOverview(body.data);
      syncRuleDrafts(body.data.rules);
    } catch (err) {
      if (controller.signal.aborted || seq !== refreshSeqRef.current) return;
      setLoadError(
        err instanceof Error
          ? err.message
          : 'تعذر الاتصال بالخادم لتحديث صندوق التنبيهات.'
      );
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      if (seq === refreshSeqRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [syncRuleDrafts]);

  const handleMarkRead = async (item: InboxItemDTO) => {
    if (markingId || item.isRead) return;
    setActionError(null);
    setActionNotice(null);
    setMarkingId(item.id);
    try {
      const res = await markReminderReadAction({
        deliveryId: item.id,
        idempotencyKey: generateClientRequestId('inbox-read'),
      });
      if (!res.success) {
        setActionError(res.error || 'تعذر تأشير التنبيه كمقروء.');
        return;
      }
      setActionNotice(
        'تم تأشير التنبيه كمقروء في الصندوق (ولم تتغير حالة المهمة أو الموعد القانوني المرتبط).'
      );
      await refreshInbox();
      router.refresh();
    } catch {
      setActionError('تعذر الاتصال بالخادم لتأشير التنبيه. يمكنك إعادة المحاولة.');
    } finally {
      setMarkingId(null);
    }
  };

  const handleRetryFailedJob = async (job: FailedReminderJobDTO) => {
    if (retryingJobId) return;
    setActionError(null);
    setActionNotice(null);

    const opKey = `retry:${job.id}:${job.updatedAt}`;
    const idempotencyKey =
      retryJobKeysRef.current.get(opKey) ?? generateClientRequestId('inbox-retry-job');
    retryJobKeysRef.current.set(opKey, idempotencyKey);

    setRetryingJobId(job.id);
    try {
      const res = await retryFailedReminderJobAction({
        jobRunId: job.id,
        idempotencyKey,
      });
      if (!res.success) {
        if (!isUncertainMutationOutcome(res.code)) {
          retryJobKeysRef.current.delete(opKey);
        }
        setActionError(res.error || 'تعذر جدولة إعادة تشغيل مهمة التذكير.');
        return;
      }

      retryJobKeysRef.current.delete(opKey);
      setActionNotice('تمت إعادة جدولة مهمة التذكير للتنفيذ عند الفحص التالي للعامل.');
      await refreshInbox();
      router.refresh();
    } catch {
      setActionError('تعذر الاتصال بالخادم لإعادة تشغيل مهمة التذكير. يمكنك إعادة المحاولة.');
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleSaveRule = async (rule: ReminderRuleDTO) => {
    if (savingRuleId) return;
    const draft = ruleDrafts[rule.id];
    if (!draft) return;

    setActionError(null);
    setActionNotice(null);

    const opKey = `rule:${rule.id}:${rule.version}:${draft.dayOffset}:${draft.reminderTime}:${draft.enabled}`;
    const idempotencyKey =
      ruleKeysRef.current.get(opKey) ?? generateClientRequestId('inbox-rule');
    ruleKeysRef.current.set(opKey, idempotencyKey);

    setSavingRuleId(rule.id);
    try {
      const res = await updateReminderRuleAction({
        ruleId: rule.id,
        expectedVersion: rule.version,
        dayOffset: Number(draft.dayOffset),
        reminderTime: draft.reminderTime,
        enabled: draft.enabled,
        idempotencyKey,
      });
      if (!res.success) {
        if (!isUncertainMutationOutcome(res.code)) {
          ruleKeysRef.current.delete(opKey);
        }
        setActionError(res.error || 'تعذر حفظ سياسة التذكير.');
        return;
      }

      ruleKeysRef.current.delete(opKey);
      setActionNotice('تم تحديث سياسة التذكير بنجاح.');
      await refreshInbox();
      router.refresh();
    } catch {
      setActionError('تعذر الاتصال بالخادم لحفظ سياسة التذكير.');
    } finally {
      setSavingRuleId(null);
    }
  };

  if (!overview && isRefreshing) {
    return (
      <div className="space-y-6" data-testid="inbox-view">
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-8">
          <LoadingIndicator label="جارٍ تحميل صندوق التنبيهات..." />
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="space-y-6" data-testid="inbox-view">
        <ErrorContainer
          title="تعذر تحميل صندوق التنبيهات"
          message={loadError || 'حدث خطأ أثناء الاتصال بالخادم.'}
          onRetry={refreshInbox}
          isRetrying={isRefreshing}
        />
      </div>
    );
  }

  const workerMeta = WORKER_STATUS_META[overview.workerHealth.status];
  const filteredItems = overview.items.filter((item) => {
    if (filter === 'unread') return !item.isRead;
    if (filter === 'overdue') return item.isOverdue || item.isMissed;
    return true;
  });

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto min-w-0 w-full" data-testid="inbox-view">
      {/* Operational Header */}
      <section className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 space-y-4 shadow-xs min-w-0">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold text-[#172A35] [overflow-wrap:anywhere]">
                صندوق التنبيهات
              </h1>
              <span
                data-testid="worker-health-badge"
                className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-[4px] border max-w-full [overflow-wrap:anywhere] ${workerMeta.badgeClass}`}
              >
                <IconBell className="w-3.5 h-3.5 shrink-0" />
                <span>حالة العامل: {workerMeta.label}</span>
              </span>
            </div>
            <p className="text-sm text-[#4D606A] [overflow-wrap:anywhere]">
              متابعة تنبيهات الجلسات والمواعيد القانونية المؤكدة والمهام داخل التطبيق بتوقيت القاهرة
            </p>
            <p
              className="text-xs text-[#4D606A] [overflow-wrap:anywhere]"
              data-testid="inbox-last-refresh"
              data-refreshed-at={overview.workerHealth.lastRefreshedAt}
            >
              آخر تحديث للقائمة:{' '}
              <strong className="text-[#172A35]">
                {formatCairoInstantArabic(overview.workerHealth.lastRefreshedAt)}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="inbox-refresh-button"
              onClick={refreshInbox}
              disabled={isRefreshing}
              className="min-h-[44px] min-w-[44px] px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white rounded-[6px] text-sm font-semibold inline-flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
            >
              <IconRefresh className={`w-4 h-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'جارٍ التحديث...' : 'تحديث الصندوق'}</span>
            </button>
            <Link
              href="/today"
              className="min-h-[44px] px-3.5 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] rounded-[6px] text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <span>العودة إلى اليوم</span>
            </Link>
          </div>
        </div>

        {/* Refresh / Connectivity Error Banner while keeping existing view visible */}
        {loadError && (
          <div
            role="alert"
            data-testid="inbox-refresh-error"
            className="p-3.5 bg-red-50 border border-red-300 text-[#A4262C] rounded-[6px] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2 text-sm font-medium min-w-0">
              <IconWarning className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="[overflow-wrap:anywhere]">{loadError}</span>
            </div>
            <button
              type="button"
              data-testid="inbox-error-retry-button"
              onClick={refreshInbox}
              disabled={isRefreshing}
              className="min-h-[44px] px-4 py-2 bg-[#A4262C] hover:bg-[#861F24] text-white text-xs font-bold rounded-[6px] shrink-0 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Closed-app / Offline Delivery Limits Notice */}
        <div
          role="note"
          data-testid="inbox-delivery-limit-notice"
          className="p-3.5 bg-[#E9F2F5] border border-[#C2D9E2] text-[#14566B] rounded-[6px] text-xs sm:text-sm leading-relaxed flex items-start gap-2.5"
        >
          <IconWarning className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="[overflow-wrap:anywhere]">{overview.deliveryLimitsNotice}</p>
        </div>
      </section>

      {/* Worker Health & Counters */}
      <section
        data-testid="worker-health-card"
        aria-label="حالة عامل التذكيرات والإحصاءات"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-0"
      >
        <div className="sm:col-span-2 lg:col-span-2 bg-white border border-[#D5DFE3] rounded-[6px] p-4 space-y-2 shadow-xs min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#172A35]">نبض عامل التذكيرات</h2>
            <span className={`text-xs font-bold px-2 py-0.5 rounded border max-w-full [overflow-wrap:anywhere] ${workerMeta.badgeClass}`}>
              {workerMeta.label}
            </span>
          </div>
          <p className="text-xs text-[#4D606A] leading-relaxed [overflow-wrap:anywhere]">
            {workerMeta.summary}
          </p>
          <div className="text-xs text-[#4D606A] space-y-1 pt-1 border-t border-[#E5ECEE]">
            <div data-testid="worker-last-poll" className="[overflow-wrap:anywhere]">
              آخر فحص: <strong className="text-[#172A35]">{formatCairoInstantArabic(overview.workerHealth.lastPollAt)}</strong>
            </div>
            <div data-testid="worker-last-success" className="[overflow-wrap:anywhere]">
              آخر تشغيل ناجح:{' '}
              <strong className="text-[#172A35]">
                {formatCairoInstantArabic(overview.workerHealth.lastSuccessAt)}
              </strong>
            </div>
            {overview.workerHealth.lastError && (
              <div data-testid="worker-last-error" className="text-[#A4262C] [overflow-wrap:anywhere]">
                آخر خطأ مسجل: {overview.workerHealth.lastError}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex flex-col justify-between shadow-xs min-w-0">
          <span className="text-xs font-semibold text-[#4D606A]">تنبيهات غير مقروءة</span>
          <strong className="text-2xl font-bold text-[#14566B] mt-2" data-testid="inbox-unread-count">
            {overview.unreadCount}
          </strong>
          <span className="text-xs text-[#4D606A] mt-1">متاحة داخل الصندوق</span>
        </div>

        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex flex-col justify-between shadow-xs min-w-0">
          <span className="text-xs font-semibold text-[#4D606A]">فائتة / متعثرة</span>
          <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 mt-2">
            <strong className="text-2xl font-bold text-[#7A4A00]" data-testid="inbox-overdue-count">
              {overview.overdueCount}
            </strong>
            <span className="text-xs text-[#4D606A]">متأخرة</span>
            <span className="text-[#D5DFE3]">•</span>
            <strong className="text-2xl font-bold text-[#A4262C]" data-testid="inbox-failed-count">
              {overview.failedCount}
            </strong>
            <span className="text-xs text-[#4D606A]">فشل نهائي</span>
          </div>
          <span className="text-xs text-[#4D606A] mt-1">تحتاج متابعة أو إعادة تشغيل</span>
        </div>
      </section>

      {actionNotice && (
        <div
          role="status"
          data-testid="inbox-action-notice"
          className="p-3 bg-emerald-50 border border-emerald-200 text-[#176449] rounded-[6px] text-sm font-medium"
        >
          {actionNotice}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          data-testid="inbox-action-error"
          className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-sm font-medium"
        >
          {actionError}
        </div>
      )}

      {/* Terminal Failed Reminder Jobs */}
      {overview.failedJobs.length > 0 && (
        <section
          data-testid="inbox-failed-jobs-section"
          aria-labelledby="failed-jobs-heading"
          className="bg-white border border-red-300 rounded-[6px] overflow-hidden shadow-xs"
        >
          <div className="p-4 bg-red-50 border-b border-red-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconWarning className="w-5 h-5 text-[#A4262C] shrink-0" />
              <h2 id="failed-jobs-heading" className="text-base font-bold text-[#A4262C]">
                مهام تذكير متعثرة ({overview.failedJobs.length})
              </h2>
            </div>
            <span className="text-xs font-semibold text-[#A4262C]">
              توقفت بعد استنفاد المحاولات — أعد التشغيل يدوياً بعد فحص السبب
            </span>
          </div>

          <div className="divide-y divide-[#E5ECEE]">
            {overview.failedJobs.map((job) => (
              <article
                key={job.id}
                data-testid={`failed-job-card-${job.id}`}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 min-w-0"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300">
                      فشل نهائي ({job.attemptCount}/{job.maxAttempts})
                    </span>
                    <span className="text-sm font-bold text-[#172A35] [overflow-wrap:anywhere]">
                      {job.sourceLabel}
                    </span>
                    {job.matterFileCode && (
                      <bdi
                        dir="ltr"
                        className="text-xs font-mono text-[#14566B] bg-[#E9F2F5] px-2 py-0.5 rounded border border-[#C2D9E2] [overflow-wrap:anywhere]"
                      >
                        {job.matterFileCode}
                      </bdi>
                    )}
                  </div>
                  <p
                    data-testid={`failed-job-error-${job.id}`}
                    className="text-xs text-[#A4262C] bg-red-50/70 border border-red-200 rounded p-2 [overflow-wrap:anywhere]"
                  >
                    السبب: {job.lastError}
                  </p>
                  <p className="text-xs text-[#4D606A] [overflow-wrap:anywhere]">
                    موعد التنبيه المجدول: {formatCairoInstantArabic(job.scheduledAt)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid={`retry-failed-job-${job.id}`}
                    disabled={retryingJobId === job.id}
                    onClick={() => handleRetryFailedJob(job)}
                    className="min-h-[44px] px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-xs font-bold rounded-[6px] inline-flex items-center gap-1.5 transition-colors"
                  >
                    <IconRefresh className="w-4 h-4" />
                    <span>
                      {retryingJobId === job.id ? 'جارٍ إعادة التشغيل...' : 'إعادة المحاولة الآن'}
                    </span>
                  </button>
                  {job.targetHref && (
                    <Link
                      href={job.targetHref}
                      className="min-h-[44px] px-3.5 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-xs font-medium rounded-[6px] inline-flex items-center gap-1.5 transition-colors"
                    >
                      <IconFolder className="w-4 h-4 text-[#4D606A]" />
                      <span>فتح المصدر</span>
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Reminder Inbox List */}
      <section
        data-testid="inbox-items-section"
        aria-labelledby="inbox-items-heading"
        className="bg-white border border-[#D5DFE3] rounded-[6px] overflow-hidden shadow-xs"
      >
        <div className="p-4 border-b border-[#D5DFE3] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconBell className="w-5 h-5 text-[#14566B]" />
            <h2
              id="inbox-items-heading"
              data-testid="inbox-items-heading"
              className="text-lg font-bold text-[#172A35]"
            >
              التنبيهات الواردة ({filteredItems.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="تصفية التنبيهات">
            <button
              type="button"
              data-testid="inbox-filter-all"
              onClick={() => setFilter('all')}
              className={`min-h-[44px] px-3 py-1.5 rounded-[6px] text-xs font-bold border transition-colors ${
                filter === 'all'
                  ? 'bg-[#14566B] text-white border-[#14566B]'
                  : 'bg-white text-[#4D606A] border-[#D5DFE3] hover:bg-[#F4F6F7]'
              }`}
            >
              الكل ({overview.items.length})
            </button>
            <button
              type="button"
              data-testid="inbox-filter-unread"
              onClick={() => setFilter('unread')}
              className={`min-h-[44px] px-3 py-1.5 rounded-[6px] text-xs font-bold border transition-colors ${
                filter === 'unread'
                  ? 'bg-[#14566B] text-white border-[#14566B]'
                  : 'bg-white text-[#4D606A] border-[#D5DFE3] hover:bg-[#F4F6F7]'
              }`}
            >
              غير مقروءة ({overview.unreadCount})
            </button>
            <button
              type="button"
              data-testid="inbox-filter-overdue"
              onClick={() => setFilter('overdue')}
              className={`min-h-[44px] px-3 py-1.5 rounded-[6px] text-xs font-bold border transition-colors ${
                filter === 'overdue'
                  ? 'bg-[#14566B] text-white border-[#14566B]'
                  : 'bg-white text-[#4D606A] border-[#D5DFE3] hover:bg-[#F4F6F7]'
              }`}
            >
              متأخرة / فائتة ({overview.overdueCount})
            </button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-6">
            <EmptyStateContainer
              testId="inbox-empty-state"
              title="لا توجد تنبيهات مطابقة حالياً"
              description="ستظهر هنا تنبيهات الجلسات القضائية والمواعيد القانونية المؤكدة والمهام فور استحقاقها ومعالجتها عبر عامل التذكيرات."
            />
          </div>
        ) : (
          <div className="divide-y divide-[#D5DFE3]">
            {filteredItems.map((item) => (
              <article
                key={item.id}
                data-testid={`inbox-item-${item.id}`}
                className={`p-5 transition-colors flex flex-col lg:flex-row lg:items-start justify-between gap-4 min-w-0 ${
                  item.isRead ? 'bg-white' : 'bg-[#FAFBFD]'
                }`}
              >
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      data-testid={`inbox-read-badge-${item.id}`}
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-[4px] border ${
                        item.isRead
                          ? 'bg-[#F4F6F7] text-[#4D606A] border-[#D5DFE3]'
                          : 'bg-[#E9F2F5] text-[#14566B] border-[#C2D9E2]'
                      }`}
                    >
                      {item.isRead ? 'مقروء' : 'غير مقروء • متاح بالصندوق'}
                    </span>

                    <span className="text-xs font-medium px-2 py-0.5 rounded-[4px] bg-[#F8FAFB] text-[#4D606A] border border-[#D5DFE3]">
                      {SOURCE_TYPE_LABELS[item.sourceType] ?? item.sourceType}
                    </span>

                    {item.isOverdue && (
                      <span
                        data-testid={`inbox-overdue-badge-${item.id}`}
                        className="text-xs font-bold px-2 py-0.5 rounded-[4px] border bg-red-50 text-[#A4262C] border-red-300"
                      >
                        متأخر عن الموعد
                      </span>
                    )}

                    {item.isMissed && !item.isOverdue && (
                      <span
                        data-testid={`inbox-missed-badge-${item.id}`}
                        className="text-xs font-bold px-2 py-0.5 rounded-[4px] border bg-[#FFF7E6] text-[#7A4A00] border-[#E0B46A]"
                      >
                        تنبيه فائت أثناء التوقف
                      </span>
                    )}

                    {item.matterFileCode && (
                      <bdi
                        dir="ltr"
                        className="text-xs font-mono font-semibold text-[#14566B] bg-[#E9F2F5] px-2 py-0.5 rounded-[4px] border border-[#C2D9E2]"
                      >
                        {item.matterFileCode}
                      </bdi>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-[#172A35] [overflow-wrap:anywhere]">
                    {item.title}
                  </h3>
                  <p className="text-sm text-[#4D606A] leading-relaxed [overflow-wrap:anywhere]">
                    {item.body}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4D606A] pt-1">
                    {item.eventDate && (
                      <span className="inline-flex items-center gap-1">
                        <IconClock className="w-3.5 h-3.5 text-[#14566B]" />
                        <span>
                          تاريخ الواقعة: {formatCairoDateArabic(item.eventDate)} ({item.timeLabel})
                        </span>
                      </span>
                    )}
                    <span>
                      وقت التسليم (SENT):{' '}
                      <strong className="text-[#172A35]">
                        {formatCairoInstantArabic(item.deliveredAt ?? item.scheduledAt)}
                      </strong>
                    </span>
                    {item.readAt && (
                      <span>
                        تاريخ القراءة:{' '}
                        <strong className="text-[#172A35]">
                          {formatCairoInstantArabic(item.readAt)}
                        </strong>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!item.isRead && (
                    <button
                      type="button"
                      data-testid={`mark-reminder-read-${item.id}`}
                      disabled={markingId === item.id}
                      onClick={() => handleMarkRead(item)}
                      className="min-h-[44px] px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-xs font-bold rounded-[6px] inline-flex items-center gap-1.5 transition-colors"
                    >
                      <IconCheck className="w-4 h-4" />
                      <span>
                        {markingId === item.id ? 'جارٍ التأشير...' : 'تأشير كمقروء'}
                      </span>
                    </button>
                  )}
                  {item.targetHref && (
                    <Link
                      href={item.targetHref}
                      className="min-h-[44px] px-3.5 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-xs font-medium rounded-[6px] inline-flex items-center gap-1.5 transition-colors"
                    >
                      <IconFolder className="w-4 h-4 text-[#4D606A]" />
                      <span>فتح المصدر</span>
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Reminder Policy Settings */}
      <section
        data-testid="inbox-rules-section"
        aria-labelledby="reminder-rules-heading"
        className="bg-white border border-[#D5DFE3] rounded-[6px] overflow-hidden shadow-xs"
      >
        <div className="p-4 border-b border-[#D5DFE3] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconSettings className="w-5 h-5 text-[#14566B]" />
            <h2 id="reminder-rules-heading" className="text-base font-bold text-[#172A35]">
              سياسات مواعيد التذكير (توقيت القاهرة)
            </h2>
          </div>
          <span className="text-xs text-[#4D606A]">
            التذكير يحدد وقت التنبيه فقط ولا يغير وقت الجلسة المجهول
          </span>
        </div>

        <div className="divide-y divide-[#E5ECEE]">
          {overview.rules.map((rule) => {
            const draft = ruleDrafts[rule.id] ?? {
              dayOffset: rule.dayOffset,
              reminderTime: rule.reminderTime,
              enabled: rule.enabled,
            };
            return (
              <div
                key={rule.id}
                data-testid={`reminder-rule-row-${rule.id}`}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-sm font-bold text-[#172A35]">
                    {RULE_EVENT_LABELS[rule.eventType]}
                  </div>
                  <div className="text-xs text-[#4D606A]">
                    القناة: إشعار داخل التطبيق (IN_APP) • الإصدار {rule.version}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[#172A35]">
                    <span>قبل الموعد بـ</span>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={draft.dayOffset}
                      onChange={(e) =>
                        setRuleDrafts((prev) => ({
                          ...prev,
                          [rule.id]: {
                            ...draft,
                            dayOffset: Number(e.target.value),
                          },
                        }))
                      }
                      className="w-20 min-h-[40px] px-2 py-1 border border-[#D5DFE3] rounded-[4px] text-sm text-[#172A35] bg-white"
                      aria-label={`عدد الأيام قبل الموعد (${RULE_EVENT_LABELS[rule.eventType]})`}
                    />
                    <span>يوم</span>
                  </label>

                  <label className="flex items-center gap-1.5 text-xs font-medium text-[#172A35]">
                    <span>الساعة</span>
                    <input
                      type="time"
                      value={draft.reminderTime}
                      onChange={(e) =>
                        setRuleDrafts((prev) => ({
                          ...prev,
                          [rule.id]: {
                            ...draft,
                            reminderTime: e.target.value,
                          },
                        }))
                      }
                      className="min-h-[40px] px-2 py-1 border border-[#D5DFE3] rounded-[4px] text-sm text-[#172A35] bg-white"
                      aria-label={`ساعة التذكير (${RULE_EVENT_LABELS[rule.eventType]})`}
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 min-h-[40px] text-xs font-semibold text-[#172A35] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) =>
                        setRuleDrafts((prev) => ({
                          ...prev,
                          [rule.id]: {
                            ...draft,
                            enabled: e.target.checked,
                          },
                        }))
                      }
                      className="w-4 h-4 accent-[#14566B]"
                    />
                    <span>مفعّلة</span>
                  </label>

                  <button
                    type="button"
                    data-testid={`save-rule-${rule.id}`}
                    disabled={savingRuleId === rule.id}
                    onClick={() => handleSaveRule(rule)}
                    className="min-h-[44px] px-3.5 py-2 bg-white hover:bg-[#E9F2F5] text-[#14566B] border border-[#14566B] rounded-[6px] text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {savingRuleId === rule.id ? 'جارٍ الحفظ...' : 'حفظ السياسة'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
