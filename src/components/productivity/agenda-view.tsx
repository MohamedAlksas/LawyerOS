'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type {
  ActionResult,
  AgendaDTO,
  AgendaDeadlineItemDTO,
  AgendaHearingItemDTO,
  AgendaItemType,
  AgendaTaskItemDTO,
  AgendaView as AgendaViewMode,
} from '@/modules/productivity/productivity-types';
import { addCairoDays, formatCairoDateArabic } from '@/lib/cairo-date';
import { LoadingIndicator, EmptyStateContainer } from '@/components/presentation-state';
import {
  IconCalendar,
  IconClock,
  IconDeadline,
  IconGavel,
  IconPrint,
  IconRefresh,
  IconTask,
  IconWarning,
} from '@/components/stitch-icons';
import {
  DEADLINE_STATUS_CLASSES,
  DEADLINE_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  formatCairoInstantArabic,
  getCairoWeekdayIndexSatFirst,
  listCairoDateRange,
  shiftCairoMonth,
} from './productivity-ui-types';

interface AgendaViewProps {
  initialAgenda: AgendaDTO | null;
  initialError?: string;
  initialGeneratedAtIso: string;
  initialFilters: {
    view: AgendaViewMode;
    anchorDate: string;
    courtId: string;
    itemType: 'ALL' | AgendaItemType;
    includeCompleted: boolean;
  };
}

type RenderableAgendaItem =
  | { kind: 'HEARING'; sortTime: string | null; data: AgendaHearingItemDTO }
  | { kind: 'DEADLINE'; sortTime: string | null; data: AgendaDeadlineItemDTO }
  | { kind: 'TASK'; sortTime: string | null; data: AgendaTaskItemDTO };

const WEEKDAY_NAMES_SAT_FIRST = [
  'السبت',
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
];

export function AgendaView({
  initialAgenda,
  initialError,
  initialGeneratedAtIso,
  initialFilters,
}: AgendaViewProps) {
  const [agenda, setAgenda] = useState<AgendaDTO | null>(initialAgenda);
  const [view, setView] = useState<AgendaViewMode>(initialFilters.view);
  const [anchorDate, setAnchorDate] = useState<string>(
    initialAgenda?.anchorDate ?? initialFilters.anchorDate
  );
  const [courtId, setCourtId] = useState<string>(initialFilters.courtId);
  const [itemType, setItemType] = useState<'ALL' | AgendaItemType>(initialFilters.itemType);
  const [includeCompleted, setIncludeCompleted] = useState<boolean>(initialFilters.includeCompleted);
  const [generatedAtIso, setGeneratedAtIso] = useState<string>(initialGeneratedAtIso);

  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchAgenda = useCallback(
    async (params: {
      nextView: AgendaViewMode;
      nextAnchorDate: string;
      nextCourtId: string;
      nextItemType: 'ALL' | AgendaItemType;
      nextIncludeCompleted: boolean;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeqRef.current;

      setIsLoading(true);
      setLoadError(null);

      try {
        const sp = new URLSearchParams();
        sp.set('view', params.nextView);
        if (params.nextAnchorDate) sp.set('anchorDate', params.nextAnchorDate);
        if (params.nextCourtId) sp.set('courtId', params.nextCourtId);
        if (params.nextItemType !== 'ALL') sp.set('types', params.nextItemType);
        if (params.nextIncludeCompleted) sp.set('includeCompleted', 'true');

        const res = await fetch(`/api/agenda?${sp.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (res.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }
        const body = (await res.json().catch(() => null)) as ActionResult<AgendaDTO> | null;
        if (seq !== requestSeqRef.current) return;

        if (!res.ok || !body || !body.success) {
          throw new Error(body && !body.success ? body.error : 'تعذر تحميل الأجندة من الخادم.');
        }

        setAgenda(body.data);
        setAnchorDate(body.data.anchorDate);
        setGeneratedAtIso(new Date().toISOString());
      } catch (err) {
        if (controller.signal.aborted || seq !== requestSeqRef.current) return;
        setLoadError(err instanceof Error ? err.message : 'تعذر تحميل الأجندة من الخادم.');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (seq === requestSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  const applyFilterChange = (patch: Partial<{
    view: AgendaViewMode;
    anchorDate: string;
    courtId: string;
    itemType: 'ALL' | AgendaItemType;
    includeCompleted: boolean;
  }>) => {
    const nextView = patch.view ?? view;
    const nextAnchorDate = patch.anchorDate ?? anchorDate;
    const nextCourtId = patch.courtId ?? courtId;
    const nextItemType = patch.itemType ?? itemType;
    const nextIncludeCompleted = patch.includeCompleted ?? includeCompleted;

    setView(nextView);
    setAnchorDate(nextAnchorDate);
    setCourtId(nextCourtId);
    setItemType(nextItemType);
    setIncludeCompleted(nextIncludeCompleted);

    void fetchAgenda({
      nextView,
      nextAnchorDate,
      nextCourtId,
      nextItemType,
      nextIncludeCompleted,
    });
  };

  const stepPeriod = (direction: -1 | 1) => {
    let nextDate = anchorDate;
    if (view === 'day' || view === 'today') {
      nextDate = addCairoDays(anchorDate, direction);
    } else if (view === 'week') {
      nextDate = addCairoDays(anchorDate, direction * 7);
    } else if (view === 'month') {
      nextDate = shiftCairoMonth(anchorDate, direction);
    } else {
      nextDate = addCairoDays(anchorDate, direction * 7);
    }
    applyFilterChange({ anchorDate: nextDate });
  };

  const handleRetry = () => {
    void fetchAgenda({
      nextView: view,
      nextAnchorDate: anchorDate,
      nextCourtId: courtId,
      nextItemType: itemType,
      nextIncludeCompleted: includeCompleted,
    });
  };

  const renderAgendaItemCard = (item: RenderableAgendaItem) => {
    if (item.kind === 'HEARING') {
      const h = item.data;
      return (
        <article
          key={`hearing-${h.id}`}
          data-testid={`agenda-item-hearing-${h.id}`}
          className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded bg-[#E9F2F5] text-[#14566B] border border-[#C2D9E2]">
                <IconGavel className="w-3.5 h-3.5" />
                <span>جلسة قضائية</span>
              </span>
              <Link
                href={`/matters/${h.matterId}`}
                className="text-base font-bold text-[#172A35] hover:text-[#14566B] hover:underline [overflow-wrap:anywhere]"
              >
                {h.matterTitle}
              </Link>
              <bdi dir="ltr" className="text-xs font-mono text-[#14566B] bg-[#F8FAFB] px-2 py-0.5 rounded border border-[#D5DFE3]">
                {h.matterFileCode}
              </bdi>
            </div>

            {h.hearingTime ? (
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-[#E9F2F5] text-[#14566B] border border-[#C2D9E2]">
                <bdi dir="ltr">{h.timeLabel}</bdi>
              </span>
            ) : (
              <span
                data-testid={`hearing-unknown-time-${h.id}`}
                className="text-xs font-semibold px-2.5 py-1 rounded bg-[#FFF7E6] text-[#7A4A00] border border-[#E0B46A]"
              >
                {h.timeLabel}
              </span>
            )}
          </div>

          <div className="text-sm text-[#4D606A] flex flex-wrap items-center gap-2">
            <span>{h.courtName}</span>
            {h.circuit && <span>• {h.circuit}</span>}
            <span>• {h.proceedingLabel}</span>
            {h.purpose && <span>• المطلوب: {h.purpose}</span>}
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            <Link
              href={`/hearings/${h.id}/result`}
              className="text-sm font-bold text-[#14566B] hover:underline"
            >
              تسجيل النتيجة ←
            </Link>
          </div>
        </article>
      );
    }

    if (item.kind === 'DEADLINE') {
      const d = item.data;
      return (
        <article
          key={`deadline-${d.id}`}
          data-testid={`agenda-item-deadline-${d.id}`}
          className={`bg-white rounded-[6px] border p-4 shadow-xs space-y-2 ${
            d.isOverdue ? 'border-[#A4262C]' : d.status === 'DRAFT' ? 'border-[#E0B46A]' : 'border-[#D5DFE3]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded border ${DEADLINE_STATUS_CLASSES[d.status]}`}>
                <IconDeadline className="w-3.5 h-3.5" />
                <span>موعد قانوني — {DEADLINE_STATUS_LABELS[d.status]}</span>
              </span>
              {d.isOverdue && (
                <span
                  data-testid={`deadline-overdue-badge-${d.id}`}
                  className="text-xs font-bold px-2 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300"
                >
                  متأخر
                </span>
              )}
              <span className="text-base font-bold text-[#172A35] [overflow-wrap:anywhere]">{d.title}</span>
            </div>
            <span className="text-xs font-medium text-[#4D606A]">{d.timeLabel}</span>
          </div>

          <div className="text-sm text-[#4D606A] flex flex-wrap items-center gap-2">
            <Link href={`/matters/${d.matterId}`} className="text-[#14566B] font-semibold hover:underline">
              ملف <bdi dir="ltr">{d.matterFileCode}</bdi> — {d.matterTitle}
            </Link>
            {d.dueDate && (
              <span>
                • {formatCairoDateArabic(d.dueDate)} (<bdi dir="ltr">{d.dueDate}</bdi>)
              </span>
            )}
            {d.source && <span>• المصدر: {d.source}</span>}
          </div>

          <div className="print:hidden">
            <Link href="/deadlines" className="text-sm font-bold text-[#14566B] hover:underline">
              فتح شاشة المواعيد القانونية ←
            </Link>
          </div>
        </article>
      );
    }

    const t = item.data;
    return (
      <article
        key={`task-${t.id}`}
        data-testid={`agenda-item-task-${t.id}`}
        className={`bg-white rounded-[6px] border p-4 shadow-xs space-y-2 ${
          t.isOverdue ? 'border-[#A4262C]/60' : 'border-[#D5DFE3]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded border bg-[#F8FAFB] text-[#172A35] border-[#D5DFE3]">
              <IconTask className="w-3.5 h-3.5 text-[#14566B]" />
              <span>مهمة إجرائية • {TASK_STATUS_LABELS[t.status]}</span>
            </span>
            {t.isOverdue && (
              <span className="text-xs font-bold px-2 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300">
                متأخرة
              </span>
            )}
            <span className="text-base font-bold text-[#172A35] [overflow-wrap:anywhere]">{t.title}</span>
          </div>
          <span className="text-xs text-[#4D606A]">
            {t.dueDate ? t.timeLabel : 'بدون تاريخ'} • {TASK_PRIORITY_LABELS[t.priority]}
          </span>
        </div>

        <div className="text-sm text-[#4D606A] flex flex-wrap items-center gap-2">
          {t.matterId && t.matterTitle ? (
            <Link href={`/matters/${t.matterId}`} className="text-[#14566B] font-semibold hover:underline">
              ملف <bdi dir="ltr">{t.matterFileCode}</bdi> — {t.matterTitle}
            </Link>
          ) : (
            <span>مهمة عامة</span>
          )}
          {t.dueDate && (
            <span>
              • {formatCairoDateArabic(t.dueDate)} (<bdi dir="ltr">{t.dueDate}</bdi>)
            </span>
          )}
        </div>
      </article>
    );
  };

  const buildGroupedByDate = (dto: AgendaDTO) => {
    const byDate = new Map<string, { timed: RenderableAgendaItem[]; untimed: RenderableAgendaItem[] }>();
    const renderedIds = {
      hearings: new Set<string>(),
      deadlines: new Set<string>(),
      tasks: new Set<string>(),
    };

    const ensureDay = (dateStr: string) => {
      let bucket = byDate.get(dateStr);
      if (!bucket) {
        bucket = { timed: [], untimed: [] };
        byDate.set(dateStr, bucket);
      }
      return bucket;
    };

    for (const h of dto.hearings) {
      renderedIds.hearings.add(h.id);
      const bucket = ensureDay(h.hearingDate);
      const item: RenderableAgendaItem = { kind: 'HEARING', sortTime: h.hearingTime, data: h };
      if (h.hearingTime) bucket.timed.push(item);
      else bucket.untimed.push(item);
    }

    for (const d of dto.confirmedDeadlines) {
      if (!d.dueDate) continue;
      renderedIds.deadlines.add(d.id);
      const bucket = ensureDay(d.dueDate);
      const item: RenderableAgendaItem = { kind: 'DEADLINE', sortTime: d.dueTime, data: d };
      if (d.dueTime) bucket.timed.push(item);
      else bucket.untimed.push(item);
    }

    for (const t of dto.datedTasks) {
      if (!t.dueDate) continue;
      renderedIds.tasks.add(t.id);
      const bucket = ensureDay(t.dueDate);
      const item: RenderableAgendaItem = { kind: 'TASK', sortTime: t.dueTime, data: t };
      if (t.dueTime) bucket.timed.push(item);
      else bucket.untimed.push(item);
    }

    for (const bucket of byDate.values()) {
      bucket.timed.sort((a, b) => (a.sortTime ?? '').localeCompare(b.sortTime ?? ''));
    }

    return { byDate, renderedIds };
  };

  const renderDayBucketContent = (
    dateStr: string,
    bucket: { timed: RenderableAgendaItem[]; untimed: RenderableAgendaItem[] },
    useUnknownGroupTestId: boolean
  ) => (
    <div className="space-y-3">
      {bucket.timed.length > 0 && (
        <div className="space-y-2.5">{bucket.timed.map(renderAgendaItemCard)}</div>
      )}
      {bucket.untimed.length > 0 && (
        <div
          data-testid={useUnknownGroupTestId ? 'agenda-unknown-time-group' : undefined}
          className="space-y-2.5 bg-[#FAFBFD] p-3.5 rounded-[6px] border border-[#D5DFE3]"
        >
          <h3 className="text-sm font-bold text-[#172A35] flex items-center gap-2">
            <IconClock className="w-4 h-4 text-[#7A4A00]" />
            <span>مواعيد وجلسات بدون ساعة محددة — {formatCairoDateArabic(dateStr)} ({bucket.untimed.length})</span>
          </h3>
          <div className="space-y-2.5">{bucket.untimed.map(renderAgendaItemCard)}</div>
        </div>
      )}
    </div>
  );

  const hasAnyAgendaData = (dto: AgendaDTO) =>
    dto.hearings.length > 0 ||
    dto.confirmedDeadlines.length > 0 ||
    dto.draftDeadlines.length > 0 ||
    dto.overdueDeadlines.length > 0 ||
    dto.datedTasks.length > 0 ||
    dto.overdueTasks.length > 0 ||
    dto.undatedTasks.length > 0;

  // Deduplicated lists for the formal Word-style print roll
  const getPrintDeadlines = (dto: AgendaDTO) => {
    const map = new Map<string, AgendaDeadlineItemDTO>();
    for (const d of dto.overdueDeadlines) map.set(d.id, d);
    for (const d of dto.confirmedDeadlines) if (!map.has(d.id)) map.set(d.id, d);
    for (const d of dto.draftDeadlines) if (!map.has(d.id)) map.set(d.id, d);
    return Array.from(map.values());
  };

  const getPrintTasks = (dto: AgendaDTO) => {
    const map = new Map<string, AgendaTaskItemDTO>();
    for (const t of dto.overdueTasks) map.set(t.id, t);
    for (const t of dto.datedTasks) if (!map.has(t.id)) map.set(t.id, t);
    for (const t of dto.undatedTasks) if (!map.has(t.id)) map.set(t.id, t);
    return Array.from(map.values());
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto" data-testid="agenda-view">
      {/* Print-only A4 Word-document styling */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 14mm;
          }
          body, html {
            background: #FFFFFF !important;
            color: #000000 !important;
          }
          [data-testid="desktop-sidebar"],
          [data-testid="app-header"],
          [data-testid="mobile-bottom-nav"],
          [data-testid="connectivity-banner"] {
            display: none !important;
          }
          #main-content {
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>

      {/* Formal Word-Style Black & White Print Document */}
      {agenda && (
        <div className="hidden print:block text-black bg-white space-y-6">
          {/* Formal Letterhead Header */}
          <div className="border-b-2 border-black pb-3 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-black">مكتب المحامي — أجندة العمل اليومية</h1>
              <p className="text-sm font-semibold text-black">
                كشف رسمي برول الجلسات القضائية والمواعيد القانونية والمهام الإجرائية
              </p>
              <p className="text-xs text-black">
                الفترة (بتوقيت القاهرة): من {formatCairoDateArabic(agenda.rangeStart)} (
                <bdi dir="ltr">{agenda.rangeStart}</bdi>) إلى {formatCairoDateArabic(agenda.rangeEnd)} (
                <bdi dir="ltr">{agenda.rangeEnd}</bdi>)
              </p>
            </div>
            <div className="text-left text-xs text-black space-y-1 border border-black px-3 py-2">
              <div>
                <strong>تاريخ الإصدار:</strong> {formatCairoInstantArabic(generatedAtIso)}
              </div>
              <div>
                <strong>إجمالي الجلسات:</strong> {agenda.hearings.length} |{' '}
                <strong>المواعيد:</strong> {getPrintDeadlines(agenda).length} |{' '}
                <strong>المهام:</strong> {getPrintTasks(agenda).length}
              </div>
            </div>
          </div>

          {/* Table 1: Judicial Hearings Roll */}
          <section className="space-y-2">
            <h2 className="text-base font-bold text-black border-b border-black pb-1">
              أولاً: كشف رول الجلسات القضائية ({agenda.hearings.length})
            </h2>
            {agenda.hearings.length === 0 ? (
              <p className="text-xs text-black border border-black p-2.5">
                لا توجد جلسات قضائية مدرجة خلال هذه الفترة.
              </p>
            ) : (
              <table className="w-full border-collapse border border-black text-xs text-black">
                <thead>
                  <tr className="bg-[#EFEFEF]">
                    <th className="border border-black px-2 py-1.5 text-right font-bold w-8">م</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">التاريخ والوقت</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">المحكمة والدائرة</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">رقم القيد</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">ملف القضية والموكل</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">الحفظ الورقي</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">المطلوب / القرار</th>
                  </tr>
                </thead>
                <tbody>
                  {agenda.hearings.map((h, idx) => (
                    <tr key={`print-h-${h.id}`} className="break-inside-avoid">
                      <td className="border border-black px-2 py-1.5 text-center font-mono">{idx + 1}</td>
                      <td className="border border-black px-2 py-1.5">
                        <div>{formatCairoDateArabic(h.hearingDate)}</div>
                        <div className="font-semibold">{h.timeLabel}</div>
                      </td>
                      <td className="border border-black px-2 py-1.5">
                        <div className="font-semibold">{h.courtName}</div>
                        {h.circuit && <div>{h.circuit}</div>}
                      </td>
                      <td className="border border-black px-2 py-1.5">{h.proceedingLabel}</td>
                      <td className="border border-black px-2 py-1.5">
                        <div className="font-semibold">
                          <bdi dir="ltr">{h.matterFileCode}</bdi> — {h.matterTitle}
                        </div>
                        {h.clientNames.length > 0 && <div>الموكل: {h.clientNames.join('، ')}</div>}
                      </td>
                      <td className="border border-black px-2 py-1.5">{h.paperLocationName || '—'}</td>
                      <td className="border border-black px-2 py-1.5">{h.purpose || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Table 2: Legal Deadlines */}
          <section className="space-y-2">
            <h2 className="text-base font-bold text-black border-b border-black pb-1">
              ثانياً: كشف المواعيد القانونية ({getPrintDeadlines(agenda).length})
            </h2>
            {getPrintDeadlines(agenda).length === 0 ? (
              <p className="text-xs text-black border border-black p-2.5">
                لا توجد مواعيد قانونية مدرجة خلال هذه الفترة.
              </p>
            ) : (
              <table className="w-full border-collapse border border-black text-xs text-black">
                <thead>
                  <tr className="bg-[#EFEFEF]">
                    <th className="border border-black px-2 py-1.5 text-right font-bold w-8">م</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">تاريخ الاستحقاق</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">الحالة</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">البيان والإجراء القانوني</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">ملف القضية</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">المصدر وسند الاحتساب</th>
                  </tr>
                </thead>
                <tbody>
                  {getPrintDeadlines(agenda).map((d, idx) => (
                    <tr key={`print-d-${d.id}`} className="break-inside-avoid">
                      <td className="border border-black px-2 py-1.5 text-center font-mono">{idx + 1}</td>
                      <td className="border border-black px-2 py-1.5">
                        {d.dueDate ? (
                          <>
                            <div>{formatCairoDateArabic(d.dueDate)}</div>
                            <div>{d.timeLabel}</div>
                          </>
                        ) : (
                          'غير محدد'
                        )}
                      </td>
                      <td className="border border-black px-2 py-1.5 font-semibold">
                        {DEADLINE_STATUS_LABELS[d.status]}
                        {d.isOverdue ? ' (متأخر)' : ''}
                      </td>
                      <td className="border border-black px-2 py-1.5 font-semibold">{d.title}</td>
                      <td className="border border-black px-2 py-1.5">
                        <bdi dir="ltr">{d.matterFileCode}</bdi> — {d.matterTitle}
                      </td>
                      <td className="border border-black px-2 py-1.5">
                        <div>{d.source || '—'}</div>
                        {d.basisNotes && <div>{d.basisNotes}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Table 3: Procedural Tasks */}
          <section className="space-y-2">
            <h2 className="text-base font-bold text-black border-b border-black pb-1">
              ثالثاً: كشف المهام الإجرائية ({getPrintTasks(agenda).length})
            </h2>
            {getPrintTasks(agenda).length === 0 ? (
              <p className="text-xs text-black border border-black p-2.5">
                لا توجد مهام إجرائية مدرجة خلال هذه الفترة.
              </p>
            ) : (
              <table className="w-full border-collapse border border-black text-xs text-black">
                <thead>
                  <tr className="bg-[#EFEFEF]">
                    <th className="border border-black px-2 py-1.5 text-right font-bold w-8">م</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">تاريخ الاستحقاق</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">الأولوية والحالة</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">بيان المهمة</th>
                    <th className="border border-black px-2 py-1.5 text-right font-bold">ملف القضية</th>
                  </tr>
                </thead>
                <tbody>
                  {getPrintTasks(agenda).map((t, idx) => (
                    <tr key={`print-t-${t.id}`} className="break-inside-avoid">
                      <td className="border border-black px-2 py-1.5 text-center font-mono">{idx + 1}</td>
                      <td className="border border-black px-2 py-1.5">
                        {t.dueDate ? `${formatCairoDateArabic(t.dueDate)} (${t.timeLabel})` : 'بدون تاريخ محدد'}
                      </td>
                      <td className="border border-black px-2 py-1.5">
                        {TASK_PRIORITY_LABELS[t.priority]} — {TASK_STATUS_LABELS[t.status]}
                        {t.isOverdue ? ' (متأخرة)' : ''}
                      </td>
                      <td className="border border-black px-2 py-1.5 font-semibold">{t.title}</td>
                      <td className="border border-black px-2 py-1.5">
                        {t.matterTitle ? (
                          <>
                            <bdi dir="ltr">{t.matterFileCode}</bdi> — {t.matterTitle}
                          </>
                        ) : (
                          'مهمة عامة للمكتب'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Formal Document Footer */}
          <div className="pt-6 border-t border-black flex items-center justify-between text-xs text-black">
            <span>مراجعة واعتماد المحامي المسؤول: ........................................</span>
            <span>التوقيع: ........................................</span>
          </div>
        </div>
      )}

      {/* Stitch S07 Screen Header */}
      <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 flex flex-wrap items-center justify-between gap-4 shadow-xs print:hidden">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#14566B] bg-[#E9F2F5] px-2.5 py-0.5 rounded-[4px] border border-[#C2D9E2]">
              رول الجلسات والأجندة الموحدة
            </span>
            <span className="text-xs font-medium text-[#176449] bg-emerald-50 px-2.5 py-0.5 rounded-[4px] border border-emerald-200">
              توقيت القاهرة الرسمي
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[#172A35]">جدول الجلسات والمواعيد الإجرائية</h1>
          <p className="text-sm text-[#4D606A]">
            جميع الأيام محسوبة بتوقيت القاهرة (<bdi dir="ltr">Africa/Cairo</bdi>) — الجلسات والمواعيد القانونية والمهام مفصولة بوضوح.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 max-w-full">
          <button
            type="button"
            data-testid="agenda-refresh-button"
            onClick={handleRetry}
            disabled={isLoading}
            className="px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            <IconRefresh className="w-4 h-4 text-[#14566B]" />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            data-testid="agenda-print-button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] inline-flex items-center gap-1.5 transition-colors"
          >
            <IconPrint className="w-4 h-4" />
            <span>طباعة كشف الأجندة</span>
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="طريقة عرض الأجندة">
            {(
              [
                { id: 'list', label: 'قائمة', testId: 'agenda-view-list' },
                { id: 'day', label: 'يوم', testId: 'agenda-view-day' },
                { id: 'week', label: 'أسبوع', testId: 'agenda-view-week' },
                { id: 'month', label: 'شهر', testId: 'agenda-view-month' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={opt.testId}
                aria-pressed={view === opt.id}
                onClick={() => applyFilterChange({ view: opt.id })}
                className={`px-4 py-2 rounded-[6px] text-sm font-bold border transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                  view === opt.id
                    ? 'bg-[#14566B] text-white border-[#14566B]'
                    : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-[#F4F6F7]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="agenda-prev-period"
              onClick={() => stepPeriod(-1)}
              className="px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
            >
              → السابق
            </button>
            <label htmlFor="agenda-date-input" className="sr-only">
              تاريخ الأجندة المرجعي
            </label>
            <input
              id="agenda-date-input"
              data-testid="agenda-date-input"
              type="date"
              dir="ltr"
              value={anchorDate}
              onChange={(e) => {
                if (e.target.value) applyFilterChange({ anchorDate: e.target.value });
              }}
              className="px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            />
            <button
              type="button"
              data-testid="agenda-next-period"
              onClick={() => stepPeriod(1)}
              className="px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
            >
              التالي ←
            </button>
            {agenda && (
              <button
                type="button"
                onClick={() => applyFilterChange({ anchorDate: agenda.cairoToday })}
                className="px-3.5 py-2 bg-white hover:bg-[#F4F6F7] text-[#14566B] text-sm font-bold rounded-[6px] border border-[#14566B]/40 min-h-[44px]"
              >
                اليوم
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-[#E8EEF1]">
          <div className="space-y-1">
            <label htmlFor="agenda-filter-court" className="block text-sm font-bold text-[#172A35]">
              المحكمة
            </label>
            <select
              id="agenda-filter-court"
              data-testid="agenda-filter-court"
              value={courtId}
              onChange={(e) => applyFilterChange({ courtId: e.target.value })}
              className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px]"
            >
              <option value="">كل المحاكم</option>
              {(agenda?.availableCourts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="agenda-filter-type" className="block text-sm font-bold text-[#172A35]">
              النوع
            </label>
            <select
              id="agenda-filter-type"
              data-testid="agenda-filter-type"
              value={itemType}
              onChange={(e) =>
                applyFilterChange({ itemType: e.target.value as 'ALL' | AgendaItemType })
              }
              className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px]"
            >
              <option value="ALL">الكل (جلسات ومواعيد ومهام)</option>
              <option value="HEARING">الجلسات فقط</option>
              <option value="DEADLINE">المواعيد القانونية فقط</option>
              <option value="TASK">المهام فقط</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2.5 cursor-pointer min-h-[44px] px-2">
              <input
                type="checkbox"
                checked={includeCompleted}
                onChange={(e) => applyFilterChange({ includeCompleted: e.target.checked })}
                className="w-5 h-5 text-[#14566B] rounded border-[#7B909B]"
              />
              <span className="text-sm font-semibold text-[#172A35]">إظهار العناصر المنتهية</span>
            </label>
          </div>
        </div>
      </div>

      {/* Body States (Screen-only; print uses the dedicated Word-style roll above) */}
      <div className="print:hidden">
        {isLoading ? (
          <div data-testid="agenda-loading-state" className="bg-white rounded-[6px] border border-[#D5DFE3] p-8">
            <LoadingIndicator label="جارٍ تحميل الأجندة..." />
          </div>
        ) : loadError || !agenda ? (
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
                <h2 className="text-base font-bold text-[#172A35]">تعذر تحميل الأجندة</h2>
                <p className="text-sm text-[#4D606A] max-w-md mx-auto leading-relaxed">
                  {loadError || 'حدث خطأ أثناء الاتصال بالخادم. يرجى المحاولة مجدداً.'}
                </p>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  data-testid="agenda-error-retry-button"
                  onClick={handleRetry}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px]"
                >
                  إعادة المحاولة
                </button>
              </div>
            </div>
          </div>
        ) : !hasAnyAgendaData(agenda) ? (
          <div data-testid="agenda-empty-state">
            <EmptyStateContainer
              title="لا توجد بنود في هذه الفترة"
              description="لا توجد جلسات أو مواعيد قانونية أو مهام مطابقة للفترة أو الفلاتر المحددة."
              action={
                courtId || itemType !== 'ALL' || includeCompleted ? (
                  <button
                    type="button"
                    onClick={() =>
                      applyFilterChange({ courtId: '', itemType: 'ALL', includeCompleted: false })
                    }
                    className="px-4 py-2 bg-[#14566B] text-white text-sm font-bold rounded-[6px] min-h-[44px]"
                  >
                    غيّر الفلاتر
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <AgendaResultsSection
            agenda={agenda}
            view={view}
            onSelectDay={(dateStr) => applyFilterChange({ view: 'day', anchorDate: dateStr })}
            buildGroupedByDate={buildGroupedByDate}
            renderDayBucketContent={renderDayBucketContent}
            renderAgendaItemCard={renderAgendaItemCard}
          />
        )}
      </div>
    </div>
  );
}

function AgendaResultsSection({
  agenda,
  view,
  onSelectDay,
  buildGroupedByDate,
  renderDayBucketContent,
  renderAgendaItemCard,
}: {
  agenda: AgendaDTO;
  view: AgendaViewMode;
  onSelectDay: (dateStr: string) => void;
  buildGroupedByDate: (dto: AgendaDTO) => {
    byDate: Map<string, { timed: RenderableAgendaItem[]; untimed: RenderableAgendaItem[] }>;
    renderedIds: { hearings: Set<string>; deadlines: Set<string>; tasks: Set<string> };
  };
  renderDayBucketContent: (
    dateStr: string,
    bucket: { timed: RenderableAgendaItem[]; untimed: RenderableAgendaItem[] },
    useUnknownGroupTestId: boolean
  ) => React.ReactNode;
  renderAgendaItemCard: (item: RenderableAgendaItem) => React.ReactNode;
}) {
  const { byDate, renderedIds } = buildGroupedByDate(agenda);

  const outsideOverdueDeadlines = agenda.overdueDeadlines.filter(
    (d) => !renderedIds.deadlines.has(d.id)
  );
  const outsideOverdueTasks = agenda.overdueTasks.filter(
    (t) => !renderedIds.tasks.has(t.id)
  );

  const sortedListDates = Array.from(byDate.keys()).sort();
  const weekDates = listCairoDateRange(agenda.rangeStart, agenda.rangeEnd);
  const monthDates = listCairoDateRange(agenda.rangeStart, agenda.rangeEnd);
  const monthLeadingPad =
    monthDates.length > 0 ? getCairoWeekdayIndexSatFirst(monthDates[0]) : 0;
  const dayBucket = byDate.get(agenda.anchorDate);

  return (
    <div className="space-y-6">
      {agenda.sameDayCourtConflicts.length > 0 && (
        <div className="space-y-2" role="region" aria-label="تعارضات المحاكم">
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
        </div>
      )}

      <div className="text-sm font-semibold text-[#4D606A] flex flex-wrap items-center gap-2 bg-white px-4 py-2.5 rounded-[6px] border border-[#D5DFE3]">
        <IconCalendar className="w-4 h-4 text-[#14566B]" />
        <span>{view === 'list' ? 'النطاق المعروض (قائمة الأعمال القادمة):' : 'النطاق المعروض:'}</span>
        <span className="text-[#172A35]">
          {view === 'list' ? 'بدايةً من ' : ''}
          {formatCairoDateArabic(agenda.rangeStart)} (<bdi dir="ltr">{agenda.rangeStart}</bdi>)
        </span>
        {agenda.rangeEnd !== agenda.rangeStart && (
          <>
            <span>—</span>
            <span className="text-[#172A35]">
              {formatCairoDateArabic(agenda.rangeEnd)} (<bdi dir="ltr">{agenda.rangeEnd}</bdi>)
            </span>
          </>
        )}
      </div>

      {(outsideOverdueDeadlines.length > 0 || outsideOverdueTasks.length > 0) && (
        <section
          aria-label="أعمال متأخرة عن تاريخها"
          className="bg-red-50/60 border border-[#A4262C]/40 rounded-[6px] p-4 space-y-3"
        >
          <h2 className="text-lg font-bold text-[#A4262C] flex items-center gap-2">
            <IconWarning className="w-5 h-5" />
            <span>مواعيد ومهام متأخرة مفتوحة ({outsideOverdueDeadlines.length + outsideOverdueTasks.length})</span>
          </h2>
          <div className="space-y-2.5">
            {outsideOverdueDeadlines.map((d) =>
              renderAgendaItemCard({ kind: 'DEADLINE', sortTime: d.dueTime, data: d })
            )}
            {outsideOverdueTasks.map((t) =>
              renderAgendaItemCard({ kind: 'TASK', sortTime: t.dueTime, data: t })
            )}
          </div>
        </section>
      )}

      {(view === 'day' || view === 'today') && (
        <section className="space-y-4" aria-label="عرض اليوم">
          <h2 className="text-lg font-bold text-[#172A35] pb-2 border-b border-[#D5DFE3]">
            {formatCairoDateArabic(agenda.anchorDate)} (<bdi dir="ltr">{agenda.anchorDate}</bdi>)
          </h2>
          {!dayBucket || (dayBucket.timed.length === 0 && dayBucket.untimed.length === 0) ? (
            <p className="text-sm text-[#4D606A] bg-white p-5 rounded-[6px] border border-[#D5DFE3]">
              لا توجد جلسات أو بنود مؤرخة في هذا اليوم.
            </p>
          ) : (
            renderDayBucketContent(agenda.anchorDate, dayBucket, true)
          )}
        </section>
      )}

      {view === 'list' && (
        <section className="space-y-6" aria-label="عرض القائمة">
          {sortedListDates.length === 0 ? (
            <p className="text-sm text-[#4D606A] bg-white p-5 rounded-[6px] border border-[#D5DFE3]">
              لا توجد بنود مؤرخة في القائمة القادمة.
            </p>
          ) : (
            sortedListDates.map((dateStr) => {
              const bucket = byDate.get(dateStr)!;
              const isToday = dateStr === agenda.cairoToday;
              return (
                <section
                  key={dateStr}
                  data-testid={`agenda-day-group-${dateStr}`}
                  className="space-y-3"
                >
                  <h2 className="text-lg font-bold text-[#172A35] pb-1.5 border-b border-[#D5DFE3] flex flex-wrap items-center gap-2">
                    <span>{formatCairoDateArabic(dateStr)}</span>
                    <bdi dir="ltr" className="text-sm font-mono text-[#4D606A]">
                      ({dateStr})
                    </bdi>
                    {isToday && (
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-[#14566B] text-white">
                        اليوم
                      </span>
                    )}
                  </h2>
                  {renderDayBucketContent(dateStr, bucket, true)}
                </section>
              );
            })
          )}
        </section>
      )}

      {view === 'week' && (
        <section className="space-y-4" aria-label="عرض الأسبوع">
          <div className="grid grid-cols-1 gap-4">
            {weekDates.map((dateStr) => {
              const bucket = byDate.get(dateStr) ?? { timed: [], untimed: [] };
              const isToday = dateStr === agenda.cairoToday;
              return (
                <section
                  key={dateStr}
                  data-testid={`agenda-week-day-${dateStr}`}
                  className={`bg-white rounded-[6px] border p-4 space-y-3 ${
                    isToday ? 'border-[#14566B] ring-1 ring-[#14566B]/30' : 'border-[#D5DFE3]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E8EEF1]">
                    <h2 className="text-base font-bold text-[#172A35] flex items-center gap-2">
                      <span>{formatCairoDateArabic(dateStr)}</span>
                      <bdi dir="ltr" className="text-sm font-mono text-[#4D606A]">
                        ({dateStr})
                      </bdi>
                    </h2>
                    {isToday && (
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-[#14566B] text-white">
                        اليوم
                      </span>
                    )}
                  </div>
                  {bucket.timed.length === 0 && bucket.untimed.length === 0 ? (
                    <p className="text-sm text-[#4D606A]">لا توجد بنود مجدولة في هذا اليوم.</p>
                  ) : (
                    renderDayBucketContent(dateStr, bucket, true)
                  )}
                </section>
              );
            })}
          </div>
        </section>
      )}

      {view === 'month' && (
        <section className="space-y-4" aria-label="عرض الشهر">
          <div className="hidden md:grid md:grid-cols-7 gap-2 text-center text-sm font-bold text-[#4D606A]">
            {WEEKDAY_NAMES_SAT_FIRST.map((dayName) => (
              <div key={dayName} className="py-1.5 bg-[#E8EEF1] rounded-[6px]">
                {dayName}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            {Array.from({ length: monthLeadingPad }).map((_, idx) => (
              <div key={`pad-${idx}`} className="hidden md:block bg-slate-50/60 rounded-[6px] border border-dashed border-[#D5DFE3] min-h-[96px]" aria-hidden="true" />
            ))}

            {monthDates.map((dateStr) => {
              const bucket = byDate.get(dateStr) ?? { timed: [], untimed: [] };
              const allDayItems = [...bucket.timed, ...bucket.untimed];
              const dayNum = parseInt(dateStr.slice(-2), 10);
              const isToday = dateStr === agenda.cairoToday;

              return (
                <div
                  key={dateStr}
                  data-testid={`agenda-month-day-${dateStr}`}
                  className={`bg-white rounded-[6px] border p-2.5 space-y-2 min-h-[96px] ${
                    isToday ? 'border-[#14566B] ring-1 ring-[#14566B]/30' : 'border-[#D5DFE3]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      aria-label={formatCairoDateArabic(dateStr)}
                      onClick={() => onSelectDay(dateStr)}
                      className={`text-sm font-bold px-2 py-1 rounded-[6px] min-h-[36px] hover:bg-[#E8EEF1] focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                        isToday ? 'bg-[#14566B] text-white hover:bg-[#0F4354]' : 'text-[#172A35]'
                      }`}
                    >
                      <span className="md:hidden">{formatCairoDateArabic(dateStr)}</span>
                      <span className="hidden md:inline">{dayNum}</span>
                    </button>
                    {allDayItems.length > 0 && (
                      <span className="text-xs font-bold text-[#14566B] bg-[#E9F2F5] px-1.5 py-0.5 rounded">
                        {allDayItems.length}
                      </span>
                    )}
                  </div>

                  {allDayItems.length > 0 && (
                    <div className="space-y-1.5">
                      {allDayItems.map((item) => {
                        if (item.kind === 'HEARING') {
                          const h = item.data;
                          return (
                            <div
                              key={`m-h-${h.id}`}
                              data-testid={`agenda-item-hearing-${h.id}`}
                              className="text-xs p-1.5 rounded bg-[#E9F2F5] border border-[#C2D9E2] text-[#172A35] space-y-0.5"
                            >
                              <div className="font-bold [overflow-wrap:anywhere]">جلسة: {h.matterTitle}</div>
                              <div className="text-[#4D606A]">
                                {h.hearingTime ? (
                                  h.timeLabel
                                ) : (
                                  <span data-testid={`hearing-unknown-time-${h.id}`}>
                                    {h.timeLabel}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        if (item.kind === 'DEADLINE') {
                          const d = item.data;
                          return (
                            <div
                              key={`m-d-${d.id}`}
                              data-testid={`agenda-item-deadline-${d.id}`}
                              className="text-xs p-1.5 rounded bg-[#FFF7E6] border border-[#E0B46A] text-[#172A35] space-y-0.5"
                            >
                              <div className="font-bold [overflow-wrap:anywhere]">موعد: {d.title}</div>
                              {d.isOverdue && (
                                <span
                                  data-testid={`deadline-overdue-badge-${d.id}`}
                                  className="inline-block text-xs font-bold text-[#A4262C]"
                                >
                                  متأخر
                                </span>
                              )}
                            </div>
                          );
                        }
                        const t = item.data;
                        return (
                          <div
                            key={`m-t-${t.id}`}
                            data-testid={`agenda-item-task-${t.id}`}
                            className="text-xs p-1.5 rounded bg-[#F8FAFB] border border-[#D5DFE3] text-[#172A35] [overflow-wrap:anywhere]"
                          >
                            مهمة: {t.title}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {agenda.draftDeadlines.length > 0 && (
        <section
          aria-label="مواعيد قانونية مسودة تحتاج مراجعة"
          className="bg-[#FFFDF9] border border-[#E0B46A] rounded-[6px] p-4 space-y-3"
        >
          <h2 className="text-lg font-bold text-[#7A4A00] flex items-center gap-2">
            <IconWarning className="w-5 h-5" />
            <span>مواعيد قانونية مسودة تحتاج مراجعة واعتماد ({agenda.draftDeadlines.length})</span>
          </h2>
          <div className="space-y-2.5">
            {agenda.draftDeadlines.map((d) =>
              renderAgendaItemCard({ kind: 'DEADLINE', sortTime: d.dueTime, data: d })
            )}
          </div>
        </section>
      )}

      {agenda.undatedTasks.length > 0 && (
        <section
          data-testid="agenda-undated-tasks-group"
          aria-label="مهام بدون تاريخ محدد"
          className="bg-[#F8FAFB] border border-[#D5DFE3] rounded-[6px] p-4 space-y-3"
        >
          <h2 className="text-lg font-bold text-[#172A35] flex items-center gap-2">
            <IconTask className="w-5 h-5 text-[#14566B]" />
            <span>مهام بدون تاريخ محدد ({agenda.undatedTasks.length})</span>
          </h2>
          <div className="space-y-2.5">
            {agenda.undatedTasks.map((t) =>
              renderAgendaItemCard({ kind: 'TASK', sortTime: null, data: t })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
