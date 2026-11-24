'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GuardedLink } from '@/components/navigation-guard';
import { IconBell, IconCheck, IconClock, IconRefresh, IconWarning } from '@/components/stitch-icons';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';
import { formatCairoDateArabic } from '@/lib/cairo-date';
import { markReminderReadAction } from '@/modules/reminders/reminder-actions';
import type {
  ActionResult,
  InboxItemDTO,
  InboxOverviewDTO,
  WorkerHealthState,
} from '@/modules/reminders/reminder-types';

interface HeaderNotificationsMenuProps {
  enabled: boolean;
}

const SOURCE_SHORT_LABELS: Record<string, string> = {
  Hearing: 'جلسة',
  Deadline: 'موعد',
  Task: 'مهمة',
};

const WORKER_WARNING_COPY: Partial<
  Record<WorkerHealthState, { label: string; className: string }>
> = {
  FAILED: {
    label: 'تنبيه تشغيلي: تعثّر عامل التذكيرات — افتح الإعدادات لمراجعة المهام المتعثرة.',
    className: 'bg-red-50 border-red-200 text-[#A4262C]',
  },
  RESTORE_MODE: {
    label: 'وضع الاستعادة نشط: إرسال التذكيرات متوقف مؤقتاً.',
    className: 'bg-[#FFF7E6] border-[#E0B46A] text-[#7A4A00]',
  },
  STALE: {
    label: 'تأخر نبضة عامل التذكيرات خلال الدقائق الأخيرة.',
    className: 'bg-[#FFF7E6] border-[#E0B46A] text-[#7A4A00]',
  },
};

async function fetchInboxPreview(signal: AbortSignal): Promise<InboxOverviewDTO> {
  const res = await fetch('/api/reminders/inbox?limit=15', {
    cache: 'no-store',
    signal,
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('lawoffice:recheck-session'));
  }
  const body = (await res.json().catch(() => null)) as ActionResult<InboxOverviewDTO> | null;
  if (!res.ok || !body || !body.success) {
    throw new Error(body && !body.success ? body.error : 'تعذر تحميل التنبيهات من الخادم.');
  }
  return body.data;
}

export function HeaderNotificationsMenu({ enabled }: HeaderNotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<InboxOverviewDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [markingId, setMarkingId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  const runFetch = (controller: AbortController, seq: number) => {
    fetchInboxPreview(controller.signal)
      .then((data) => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setLoadError(null);
        setOverview(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setLoadError(err instanceof Error ? err.message : 'تعذر الاتصال بالخادم.');
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (seq === seqRef.current) {
          setLoading(false);
        }
      });
  };

  const triggerRefresh = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++seqRef.current;
    setLoading(true);
    setLoadError(null);
    runFetch(controller, seq);
  };

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++seqRef.current;

    fetchInboxPreview(controller.signal)
      .then((data) => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setLoadError(null);
        setOverview(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setLoadError(err instanceof Error ? err.message : 'تعذر الاتصال بالخادم.');
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (seq === seqRef.current) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [enabled]);

  const isOpen = enabled && open;

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!enabled) {
    return null;
  }

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setOpen(nextOpen);
    setMarkError(null);
    if (nextOpen) {
      triggerRefresh();
    }
  };

  const handleMarkRead = async (item: InboxItemDTO) => {
    if (markingId || item.isRead) return;
    setMarkError(null);
    setMarkingId(item.id);
    try {
      const res = await markReminderReadAction({
        deliveryId: item.id,
        idempotencyKey: generateClientRequestId('header-read'),
      });
      if (!res.success) {
        setMarkError(res.error || 'تعذر تأشير التنبيه كمقروء.');
        return;
      }
      setOverview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          unreadCount: Math.max(0, prev.unreadCount - 1),
          items: prev.items.map((it) =>
            it.id === item.id
              ? { ...it, isRead: true, readAt: res.data.readAt ?? new Date().toISOString() }
              : it
          ),
        };
      });
    } catch {
      setMarkError('تعذر الاتصال بالخادم لتأشير التنبيه كمقروء.');
    } finally {
      setMarkingId(null);
    }
  };

  const unreadCount = overview?.unreadCount ?? 0;
  const workerStatus = overview?.workerHealth.status;
  const hasWorkerAlertDot = workerStatus === 'FAILED' || workerStatus === 'RESTORE_MODE';
  const workerBanner = workerStatus ? WORKER_WARNING_COPY[workerStatus] : undefined;

  const visibleItems = (overview?.items ?? []).filter((item) =>
    filter === 'unread' ? !item.isRead : true
  );

  return (
    <div ref={containerRef} className="sm:relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        data-testid="header-notifications-button"
        aria-label={
          unreadCount > 0 ? `التنبيهات (${unreadCount} غير مقروءة)` : 'التنبيهات'
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={handleToggle}
        className="relative flex items-center justify-center min-h-[44px] min-w-[44px] rounded-[6px] border border-[#D5DFE3] bg-[#F8FAFB] hover:bg-[#E9F2F5] text-[#172A35] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
      >
        <IconBell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            data-testid="header-notifications-badge"
            className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#A4262C] text-white text-[10px] font-bold leading-[18px] text-center shadow-xs"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {hasWorkerAlertDot && (
          <span
            data-testid="header-notifications-worker-dot"
            aria-hidden="true"
            className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-[#D97706] ring-1 ring-white"
          />
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="قائمة التنبيهات"
          data-testid="header-notifications-popover"
          className="absolute left-3 sm:left-0 top-full mt-2 z-50 w-[min(22rem,calc(100vw-1.5rem))] bg-white border border-[#D5DFE3] rounded-[8px] shadow-xl overflow-hidden text-right"
        >
          {/* Header */}
          <div className="px-3.5 py-2.5 border-b border-[#D5DFE3] bg-[#F8FAFB] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold text-[#172A35]">التنبيهات</h2>
              {unreadCount > 0 && (
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#E9F2F5] text-[#14566B]">
                  {unreadCount} غير مقروء
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <div role="group" aria-label="تصفية التنبيهات" className="flex rounded-[6px] border border-[#D5DFE3] bg-white overflow-hidden">
                <button
                  type="button"
                  data-testid="header-notifications-filter-all"
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                  className={`px-2.5 py-1 text-[11px] font-semibold min-h-[44px] transition-colors ${
                    filter === 'all' ? 'bg-[#14566B] text-white' : 'text-[#4D606A] hover:bg-[#F4F6F7]'
                  }`}
                >
                  الكل
                </button>
                <button
                  type="button"
                  data-testid="header-notifications-filter-unread"
                  aria-pressed={filter === 'unread'}
                  onClick={() => setFilter('unread')}
                  className={`px-2.5 py-1 text-[11px] font-semibold min-h-[44px] transition-colors ${
                    filter === 'unread' ? 'bg-[#14566B] text-white' : 'text-[#4D606A] hover:bg-[#F4F6F7]'
                  }`}
                >
                  غير مقروء
                </button>
              </div>

              <button
                type="button"
                data-testid="header-notifications-refresh"
                aria-label="تحديث التنبيهات"
                disabled={loading}
                onClick={triggerRefresh}
                className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-[6px] border border-[#D5DFE3] bg-white hover:bg-[#F4F6F7] disabled:opacity-50 text-[#4D606A] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                <IconRefresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              </button>
            </div>
          </div>

          {/* Worker status strip */}
          {workerBanner && (
            <div
              role="status"
              data-testid="header-notifications-worker-alert"
              className={`px-3.5 py-2 border-b text-xs font-medium flex items-start gap-2 ${workerBanner.className}`}
            >
              <IconWarning className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{workerBanner.label}</span>
            </div>
          )}

          {markError && (
            <div
              role="alert"
              className="px-3.5 py-2 bg-red-50 border-b border-red-200 text-xs text-[#A4262C] font-medium"
            >
              {markError}
            </div>
          )}

          {/* Body */}
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-[#E5ECEE]">
            {!overview && !loadError ? (
              <div className="p-6 text-center text-xs text-[#4D606A]" role="status">
                جارٍ تحميل التنبيهات...
              </div>
            ) : loadError && !overview ? (
              <div className="p-4 text-center space-y-2.5" role="alert">
                <p className="text-xs text-[#A4262C] font-medium">{loadError}</p>
                <button
                  type="button"
                  onClick={triggerRefresh}
                  className="px-3 py-1.5 text-xs font-semibold rounded-[6px] bg-[#14566B] text-white hover:bg-[#0F4354] min-h-[44px]"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#4D606A]" data-testid="header-notifications-empty">
                {filter === 'unread' ? 'لا توجد تنبيهات غير مقروءة حالياً.' : 'لا توجد تنبيهات حالياً.'}
              </div>
            ) : (
              visibleItems.map((item) => {
                const sourceLabel = SOURCE_SHORT_LABELS[item.sourceType] ?? item.sourceType;
                return (
                  <div
                    key={item.id}
                    data-testid={`header-notification-item-${item.id}`}
                    className={`p-3 space-y-1.5 ${item.isRead ? 'bg-white' : 'bg-[#F8FBFD]'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#E9F2F5] text-[#14566B]">
                          {sourceLabel}
                        </span>
                        {item.isOverdue && (
                          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-[#A4262C] border border-red-200">
                            متأخر
                          </span>
                        )}
                        {!item.isRead && (
                          <span className="w-2 h-2 rounded-full bg-[#14566B]" aria-label="غير مقروء" />
                        )}
                      </div>
                      {item.eventDate && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#4D606A] shrink-0">
                          <IconClock className="w-3 h-3 text-[#14566B]" />
                          <span>{formatCairoDateArabic(item.eventDate)}</span>
                        </span>
                      )}
                    </div>

                    {item.targetHref ? (
                      <GuardedLink
                        href={item.targetHref}
                        onNavigate={() => setOpen(false)}
                        className="flex items-center min-h-[44px] py-1 text-xs font-bold text-[#172A35] hover:text-[#14566B] underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                      >
                        {item.title}
                      </GuardedLink>
                    ) : (
                      <p className="text-xs font-bold text-[#172A35] [overflow-wrap:anywhere]">{item.title}</p>
                    )}

                    <p className="text-[11px] text-[#4D606A] leading-snug line-clamp-2 [overflow-wrap:anywhere]">
                      {item.body}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      {item.matterFileCode ? (
                        <bdi dir="ltr" className="text-[10px] font-mono text-[#4D606A]">
                          {item.matterFileCode}
                        </bdi>
                      ) : (
                        <span />
                      )}

                      {!item.isRead && (
                        <button
                          type="button"
                          data-testid={`header-notification-read-${item.id}`}
                          disabled={markingId === item.id}
                          onClick={() => void handleMarkRead(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[5px] bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-[11px] font-semibold transition-colors min-h-[44px]"
                        >
                          <IconCheck className="w-3 h-3" />
                          <span>{markingId === item.id ? 'جارٍ...' : 'تمت القراءة'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-3.5 py-2.5 border-t border-[#D5DFE3] bg-[#F8FAFB] flex items-center justify-between">
            <GuardedLink
              href="/inbox"
              data-testid="header-notifications-settings-link"
              onNavigate={() => setOpen(false)}
              className="text-xs font-bold text-[#14566B] hover:text-[#0F4354] hover:underline focus:outline-none focus:ring-2 focus:ring-[#14566B] rounded px-2 py-1 min-h-[44px] inline-flex items-center"
            >
              إعدادات التنبيهات والمهام
            </GuardedLink>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-[#4D606A] hover:text-[#172A35] px-2.5 py-1 min-h-[44px] inline-flex items-center rounded"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
