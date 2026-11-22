'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { isUncertainHearingOutcome } from '@/components/hearings/hearing-recovery';
import type { ActionResult, CorrectHearingResultInput, HearingResultDTO, RecordHearingResultInput, RecordHearingResultResult } from '@/modules/scheduling/hearing-types';
import {
  HearingStatus,
  NextDateDisposition,
  TaskPriority,
  formatRecordResultSummary,
} from '@/components/hearings/hearing-ui-types';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';

interface FollowUpTaskItem {
  id: string;
  title: string;
  dueDate: string;
  priority: TaskPriority;
}

interface HearingResultClientProps {
  actorId: string;
  history: { revision: number; decisionText: string; correctionReason: string | null }[];
  nextHearing?: { id: string; date: string };
  hearingId: string;
  initialVersion: number;
  hearingDate: string; // YYYY-MM-DD
  hearingTime: string | null;
  status: HearingStatus;
  purpose: string | null;
  courtName: string;
  circuit: string | null;
  matterId: string;
  matterFileCode: string;
  proceedingId: string;
  latestResult: {
    id: string;
    decisionText: string;
    revision: number;
    correctionReason: string | null;
    recordedAt: string;
  } | null;
}

async function saveHearing<T>(url: string, payload: unknown): Promise<ActionResult<T>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  return response.json();
}

export function HearingResultClient({
  actorId,
  history,
  nextHearing,
  hearingId,
  initialVersion,
  hearingDate,
  hearingTime,
  status: initialStatus,
  purpose,
  courtName,
  circuit,
  matterId,
  matterFileCode,
  proceedingId,
  latestResult: initialLatestResult,
}: HearingResultClientProps) {
  const router = useRouter();
  const path = `/hearings/${hearingId}/result`;
  const endpoint = `/api/scheduling/hearings/${hearingId}`;
  const resultDraft = useFormDraft<RecordHearingResultInput>(`${actorId}:hearing-result`, path);
  const correctionDraft = useFormDraft<CorrectHearingResultInput>(`${actorId}:hearing-correction`, path);
  const pendingResult = useRef(resultDraft.restored);
  const pendingCorrection = useRef(correctionDraft.restored);
  const [linkedNext, setLinkedNext] = useState(nextHearing);
  const [currentStatus, setCurrentStatus] = useState<HearingStatus>(initialStatus);
  const [latestResult, setLatestResult] = useState(initialLatestResult);

  // Form state
  const [decision, setDecision] = useState(resultDraft.restored?.decision ?? '');
  const [summary, setSummary] = useState(resultDraft.restored?.summary ?? '');
  const [attendance, setAttendance] = useState(resultDraft.restored?.attendance ?? '');
  const [nextDateDisposition, setNextDateDisposition] = useState<NextDateDisposition>(resultDraft.restored?.nextDateDisposition ?? 'UNDETERMINED');
  const [nextHearingDate, setNextHearingDate] = useState(resultDraft.restored?.nextHearing?.hearingDate ?? '');
  const [nextHearingTime, setNextHearingTime] = useState(resultDraft.restored?.nextHearing?.hearingTime ?? '');
  const [tasks, setTasks] = useState<FollowUpTaskItem[]>(() =>
    (resultDraft.restored?.tasks ?? []).map((task, index) => ({
      id: String(index), title: task.title, dueDate: task.dueDate ?? '', priority: task.priority ?? 'NORMAL',
    })),
  );

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFrozenRetry, setIsFrozenRetry] = useState(Boolean(resultDraft.restored));
  const unknownOutcome = 'تعذر استلام تأكيد الحفظ. يمكنك إعادة محاولة نفس الطلب.';
  const [uncertaintyError, setUncertaintyError] = useState<string | null>(resultDraft.restored ? unknownOutcome : null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [savedDecision, setSavedDecision] = useState('');

  // Correction Mode states
  const [isCorrecting, setIsCorrecting] = useState(Boolean(correctionDraft.restored));
  const [correctionReason, setCorrectionReason] = useState(correctionDraft.restored?.reason ?? '');
  const [correctedDecision, setCorrectedDecision] = useState(correctionDraft.restored?.decision ?? '');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionFrozen, setCorrectionFrozen] = useState(Boolean(correctionDraft.restored));
  const [correctionError, setCorrectionError] = useState<string | null>(correctionDraft.restored ? unknownOutcome : null);
  const [correctionSuccess, setCorrectionSuccess] = useState(false);

  const resultFieldsDisabled = isSubmitting || isFrozenRetry;
  const correctionFieldsDisabled = correctionSubmitting || correctionFrozen;
  const resultDirty = currentStatus === 'SCHEDULED' && !isFrozenRetry &&
    Boolean(decision || summary || attendance || nextDateDisposition !== 'UNDETERMINED' || tasks.length);
  useLeaveGuard(resultDirty || (isCorrecting && !correctionFrozen), isSubmitting || correctionSubmitting);

  const handleAddTask = () => {
    const newTask: FollowUpTaskItem = {
      id: generateClientRequestId('task'),
      title: '',
      dueDate: '',
      priority: 'NORMAL',
    };
    setTasks((prev) => [...prev, newTask]);
  };

  const handleRemoveTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const handleUpdateTaskTitle = (taskId: string, title: string) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, title } : t)));
  };

  const handleUpdateTaskDue = (taskId: string, dueDate: string) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)));
  };

  const handleSaveResult = async () => {
    if (isSubmitting) return;
    if (!pendingResult.current) {
      if (!decision.trim()) {
        setValidationError('منطوق القرار أو نتيجة الجلسة مطلوب');
        return;
      }
      if (nextDateDisposition === 'KNOWN' && (!nextHearingDate || nextHearingDate < hearingDate)) {
        setValidationError('حدد تاريخ الجلسة القادمة بحيث لا يسبق تاريخ الجلسة الحالية');
        return;
      }
      if (tasks.some((task) => !task.title.trim())) {
        setValidationError('أدخل عنوانًا لكل مهمة متابعة أو احذف المهمة الفارغة');
        return;
      }
      pendingResult.current = {
        hearingId,
        expectedVersion: initialVersion,
        decision: decision.trim(),
        summary: summary.trim() || null,
        attendance: attendance.trim() || null,
        nextDateDisposition,
        nextHearing: nextDateDisposition === 'KNOWN'
          ? { hearingDate: nextHearingDate, hearingTime: nextHearingTime || null, courtName, circuit }
          : null,
        tasks: tasks.map(({ title, dueDate, priority }) => ({ title: title.trim(), dueDate: dueDate || null, priority })),
        idempotencyKey: generateClientRequestId('res'),
      };
      resultDraft.keep(pendingResult.current);
    }
    setValidationError(null);
    setUncertaintyError(null);
    setConflictError(null);
    setIsSubmitting(true);
    try {
      const response = await saveHearing<RecordHearingResultResult>(`${endpoint}/result`, pendingResult.current);
      if (!response.success) {
        if (isUncertainHearingOutcome(response.code)) throw new Error(unknownOutcome);
        pendingResult.current = undefined;
        resultDraft.clear();
        setIsFrozenRetry(false);
        if (response.code === 'CONCURRENCY_CONFLICT' || response.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
          setConflictError(response.error);
        } else {
          setValidationError(response.error);
        }
        return;
      }
      const { hearing, result, nextHearing: savedNext } = response.data;
      pendingResult.current = undefined;
      resultDraft.clear();
      setIsFrozenRetry(false);
      setSavedSuccess(true);
      setSavedDecision(result.decisionText);
      setCurrentStatus(hearing.status);
      setLatestResult({ ...result, correctionReason: result.correctionReason ?? null });
      if (savedNext) setLinkedNext({ id: savedNext.id, date: savedNext.hearingDate });
      router.refresh();
    } catch {
      setIsFrozenRetry(true);
      setUncertaintyError(unknownOutcome);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveCorrection = async () => {
    if (correctionSubmitting) return;
    if (!pendingCorrection.current) {
      if (!latestResult || !correctionReason.trim() || !correctedDecision.trim()) {
        setCorrectionError('سبب التصحيح والمنطوق المصحح مطلوبان');
        return;
      }
      pendingCorrection.current = {
        hearingId,
        expectedVersion: latestResult.revision,
        currentResultId: latestResult.id,
        decision: correctedDecision.trim(),
        reason: correctionReason.trim(),
        idempotencyKey: generateClientRequestId('corr'),
      };
      correctionDraft.keep(pendingCorrection.current);
    }
    setCorrectionError(null);
    setCorrectionSubmitting(true);
    try {
      const response = await saveHearing<HearingResultDTO>(`${endpoint}/correct`, pendingCorrection.current);
      if (!response.success) {
        if (isUncertainHearingOutcome(response.code)) throw new Error(unknownOutcome);
        pendingCorrection.current = undefined;
        correctionDraft.clear();
        setCorrectionFrozen(false);
        setCorrectionError(response.error);
        if (response.code === 'CONCURRENCY_CONFLICT') setConflictError(response.error);
        return;
      }
      pendingCorrection.current = undefined;
      correctionDraft.clear();
      setCorrectionFrozen(false);
      setCorrectionSuccess(true);
      setIsCorrecting(false);
      setLatestResult({ ...response.data, correctionReason: response.data.correctionReason ?? null });
      router.refresh();
    } catch {
      setCorrectionFrozen(true);
      setCorrectionError(unknownOutcome);
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const summaryText = formatRecordResultSummary({
    nextDate: nextDateDisposition === 'KNOWN' && nextHearingDate.trim() ? nextHearingDate.trim() : null,
    taskCount: tasks.filter((t) => t.title.trim().length > 0).length,
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12" dir="rtl" lang="ar-EG">
      {/* Navigation Breadcrumb */}
      <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] flex items-center gap-1.5 flex-wrap">
        <Link href={`/matters/${matterId}`} className="hover:text-[#14566B] hover:underline font-mono">
          {matterFileCode}
        </Link>
        <span>/</span>
        <Link
          href={`/matters/${matterId}/proceedings/${proceedingId}`}
          className="hover:text-[#14566B] hover:underline"
        >
          القيد القضائي
        </Link>
        <span>/</span>
        <Link href={`/hearings/${hearingId}`} className="hover:text-[#14566B] hover:underline">
          جلسة {hearingDate}
        </Link>
        <span>/</span>
        <span className="text-[#172A35] font-semibold">تسجيل النتيجة</span>
      </nav>

      {/* Header Card */}
      <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8EEF1] pb-3">
          <div className="space-y-0.5">
            <h1 className="text-lg sm:text-xl font-bold text-[#172A35] flex items-center gap-2">
              <span>⚖️</span>
              <span>تسجيل قرار ونتيجة الجلسة</span>
            </h1>
            <p className="text-xs text-[#4D606A]">
              جلسة يوم <span className="font-semibold text-[#172A35] font-mono">{hearingDate}</span>
              {' • '}
              {hearingTime ? (
                <span className="font-mono">{hearingTime}</span>
              ) : (
                <span data-testid="hearing-unknown-time" className="italic text-[#64748B]">
                  الساعة غير محددة
                </span>
              )}
            </p>
          </div>
          <div className="text-xs text-[#4D606A]">
            <span className="font-semibold">{courtName}</span>
            {circuit && <span> — {circuit}</span>}
          </div>
        </div>
        {purpose && (
          <p className="text-xs text-[#4D606A]">
            <span className="font-semibold">الغرض الأساسي:</span> {purpose}
          </p>
        )}
      </div>

      {/* Concurrency Conflict Banner (T08-TC-05) */}
      {conflictError && (
        <div
          role="alert"
          data-testid="conflict-error-banner"
          className="p-4 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⚠️</span>
            <span>تضارب في تحديث السجل</span>
          </div>
          <p className="leading-relaxed">
            {conflictError}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-700 text-white font-bold rounded-[6px] hover:bg-red-800 transition-colors min-h-[44px]"
            >
              تحديث الصفحة الآن
            </button>
          </div>
        </div>
      )}

      {/* Uncertainty / Network Disconnection Banner (T08-TC-03 & T08-TC-07) */}
      {(uncertaintyError || isFrozenRetry) && (
        <div
          role="alert"
          data-testid="uncertainty-error-banner"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>📡</span>
            <span>تعذر استلام تأكيد الخادم (حالة عدم يقين في الشبكة)</span>
          </div>
          <p className="leading-relaxed">
            {uncertaintyError}
          </p>
          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveResult}
              disabled={isSubmitting}
              data-testid="record-result-retry-btn"
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5"
            >
              <span>🔄</span>
              <span>إعادة المحاولة وحفظ النتيجة</span>
            </button>
          </div>
        </div>
      )}

      {/* Success Banner */}
      {savedSuccess && (
        <div
          role="alert"
          data-testid="save-success-banner"
          className="p-4 bg-emerald-50 border border-emerald-300 rounded-[6px] text-xs text-emerald-900 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>✅</span>
            <span>تم حفظ النتيجة بنجاح!</span>
          </div>
          <p className="font-semibold text-emerald-800">{savedDecision}</p>
          <div className="pt-1 flex gap-2">
            <Link
              href={`/hearings/${hearingId}`}
              className="px-3 py-1.5 bg-emerald-700 text-white rounded-[4px] text-xs font-bold"
            >
              عرض تفاصيل الجلسة
            </Link>
          </div>
        </div>
      )}
      {linkedNext && (
        <div className="rounded-[8px] border border-[#D5DFE3] bg-white p-4 text-sm">
          <Link href={`/hearings/${linkedNext.id}`} data-testid="linked-next-hearing" className="font-bold text-[#14566B] underline">
            الجلسة القادمة {linkedNext.date}
          </Link>
          {' · '}
          <Link href={`/matters/${matterId}/proceedings/${proceedingId}`} className="text-[#14566B] underline">
            عرض الموعد أو تغييره من القيد
          </Link>
        </div>
      )}

      {/* Correction Success Banner */}
      {correctionSuccess && (
        <div
          role="alert"
          className="p-3 bg-emerald-50 border border-emerald-300 rounded-[6px] text-xs text-emerald-900 font-bold"
        >
          ✅ تم حفظ التصحيح بنجاح!
        </div>
      )}

      {/* When Hearing Already Has a Persisted Result -> Display Result & Correction Option */}
      {(currentStatus === 'COMPLETED' || latestResult) && !savedSuccess && (
        <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[#E8EEF1] pb-3">
            <div className="space-y-0.5">
              <h2 className="text-base font-bold text-[#172A35] flex items-center gap-2">
                <span>📜</span>
                <span>النتيجة المسجلة الحالية</span>
              </h2>
              <span className="text-xs text-[#4D606A]">
                المراجعة #{latestResult?.revision || 1}
              </span>
            </div>
            {!isCorrecting && !isFrozenRetry && latestResult && (
              <button
                type="button"
                onClick={() => {
                  setIsCorrecting(true);
                  setCorrectedDecision(latestResult?.decisionText || '');
                }}
                data-testid="correct-result-button"
                className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[44px]"
              >
                ✏️ تصحيح نتيجة الجلسة
              </button>
            )}
          </div>

          <div className="p-4 bg-teal-50 border border-teal-200 rounded-[6px] space-y-1">
            <span className="text-xs font-bold text-[#14566B] block">قرار المحكمة:</span>
            <p
              data-testid="persisted-decision-text"
              className="text-sm font-bold text-[#172A35] whitespace-pre-wrap leading-relaxed"
            >
              {latestResult?.decisionText}
            </p>
          </div>

          {history.some((result) => result.revision < (latestResult?.revision ?? 0)) && (
            <details className="rounded-[6px] border border-[#D5DFE3] p-3 text-xs">
              <summary className="cursor-pointer font-bold">مراجعات النتيجة السابقة</summary>
              {history.filter((result) => result.revision < (latestResult?.revision ?? 0)).map((result) => (
                <div key={result.revision} className="border-t border-[#E8EEF1] py-2">
                  <p className="font-semibold">مراجعة {result.revision}</p>
                  <p className="whitespace-pre-wrap">{result.decisionText}</p>
                  {result.correctionReason && <p>{result.correctionReason}</p>}
                </div>
              ))}
            </details>
          )}
          {latestResult?.correctionReason && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
              <span className="font-bold">سبب التصحيح السابق: </span>
              <span>{latestResult.correctionReason}</span>
            </div>
          )}

          {/* Inline Result Correction Form (T08-TC-05) */}
          {isCorrecting && (
            <div className="pt-4 border-t border-[#E8EEF1] space-y-4">
              <h3 className="font-bold text-sm text-[#172A35]">إجراء تصحيح رسمي على النتيجة</h3>
              {correctionError && (
                <p role="alert" className="text-xs text-red-600 font-semibold">{correctionError}</p>
              )}
              <div className="space-y-1 text-xs">
                <label htmlFor="correction-reason" className="block font-bold text-[#172A35]">
                  سبب التصحيح <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="correction-reason"
                  name="correctionReason"
                  rows={2}
                  required
                  placeholder="أدخل سبب تصحيح نتيجة الجلسة (إلزامي للتوثيق)"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  disabled={correctionFieldsDisabled}
                  className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs focus:ring-2 focus:ring-[#14566B]"
                />
              </div>

              <div className="space-y-1 text-xs">
                <label htmlFor="corrected-decision" className="block font-bold text-[#172A35]">
                  المنطوق المصحح <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="corrected-decision"
                  name="correctedDecision"
                  rows={3}
                  required
                  placeholder="أدخل منطوق القرار أو النتيجة المصححة"
                  value={correctedDecision}
                  onChange={(e) => setCorrectedDecision(e.target.value)}
                  disabled={correctionFieldsDisabled}
                  className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs focus:ring-2 focus:ring-[#14566B]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCorrecting(false)}
                  disabled={correctionFieldsDisabled}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-xs font-semibold rounded-[6px] min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveCorrection}
                  disabled={correctionSubmitting}
                  data-testid="save-correction-btn"
                  className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px]"
                >
                  {correctionSubmitting ? 'جارٍ حفظ التصحيح...' : correctionFrozen ? 'إعادة محاولة حفظ التصحيح' : 'حفظ التصحيح'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Result Entry Form (When not yet completed or submitting) */}
      {!savedSuccess && (currentStatus === 'SCHEDULED' || isFrozenRetry) && (
        <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-5">
          {validationError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900 font-semibold">
              {validationError}
            </div>
          )}

          {/* Decision / Ruling Input (Required) */}
          <div className="space-y-1 text-xs">
            <label htmlFor="hearing-decision-input" className="block font-bold text-[#172A35]">
              منطوق القرار أو نتيجة الجلسة <span className="text-red-600">*</span>
            </label>
            <textarea
              id="hearing-decision-input"
              name="decision"
              rows={3}
              required
              placeholder="مثال: تأجيل لتقديم مذكرة ومستندات، أو حجز للحكم لجلسة..."
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              disabled={resultFieldsDisabled}
              data-testid="hearing-decision-textarea"
              className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <label className="space-y-1 font-semibold">
              <span>ملخص الجلسة (اختياري)</span>
              <textarea value={summary} maxLength={1000} disabled={resultFieldsDisabled} onChange={(event) => setSummary(event.target.value)} className="w-full rounded-[6px] border border-[#D5DFE3] p-2" />
            </label>
            <label className="space-y-1 font-semibold">
              <span>الحضور (اختياري)</span>
              <input value={attendance} maxLength={500} disabled={resultFieldsDisabled} onChange={(event) => setAttendance(event.target.value)} className="w-full rounded-[6px] border border-[#D5DFE3] p-2" />
            </label>
          </div>
          {/* Next Date Radio Group */}
          <div className="space-y-2 p-3.5 bg-slate-50 border border-slate-200 rounded-[6px] text-xs">
            <span className="block font-bold text-[#172A35]">
              هل تقرر تأجيل الجلسة لموعد قادم؟ <span className="text-red-600">*</span>
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label
                className={`p-2.5 rounded-[6px] border text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                  nextDateDisposition === 'KNOWN'
                    ? 'bg-[#14566B] text-white border-[#14566B] font-bold'
                    : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="nextDateDisposition"
                  value="KNOWN"
                  checked={nextDateDisposition === 'KNOWN'}
                  disabled={resultFieldsDisabled}
                  onChange={() => setNextDateDisposition('KNOWN')}
                  className="sr-only"
                />
                <span>📅 نعم، يوجد موعد قادم (تأجيل لتاريخ محدد)</span>
              </label>

              <label
                className={`p-2.5 rounded-[6px] border text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                  nextDateDisposition === 'UNDETERMINED'
                    ? 'bg-[#14566B] text-white border-[#14566B] font-bold'
                    : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="nextDateDisposition"
                  value="UNDETERMINED"
                  checked={nextDateDisposition === 'UNDETERMINED'}
                  disabled={resultFieldsDisabled}
                  onChange={() => setNextDateDisposition('UNDETERMINED')}
                  className="sr-only"
                />
                <span>⏳ لم يحدد موعد بعد</span>
              </label>

              <label
                className={`p-2.5 rounded-[6px] border text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                  nextDateDisposition === 'NONE'
                    ? 'bg-[#14566B] text-white border-[#14566B] font-bold'
                    : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="nextDateDisposition"
                  value="NONE"
                  checked={nextDateDisposition === 'NONE'}
                  disabled={resultFieldsDisabled}
                  onChange={() => setNextDateDisposition('NONE')}
                  className="sr-only"
                />
                <span>🏁 لا توجد جلسة أخرى (حكم منهي للخصومة)</span>
              </label>
            </div>

            {/* Next Date Input */}
            {nextDateDisposition === 'KNOWN' && (
              <div className="pt-2">
                <label htmlFor="next-hearing-date-input" className="block font-bold text-[#172A35] mb-1">
                  تاريخ الجلسة القادمة <span className="text-red-600">*</span>
                </label>
                <input
                  id="next-hearing-date-input"
                  name="nextHearingDate"
                  type="date"
                  required
                  value={nextHearingDate}
                  onChange={(e) => setNextHearingDate(e.target.value)}
                  disabled={resultFieldsDisabled}
                  min={hearingDate}
                  data-testid="next-hearing-date-input"
                  className="w-full sm:w-64 p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
                <label className="mt-2 block font-bold text-[#172A35]">
                  وقت الجلسة القادمة (اختياري)
                  <input type="time" value={nextHearingTime} disabled={resultFieldsDisabled} onChange={(event) => setNextHearingTime(event.target.value)} className="mt-1 block min-h-[44px] w-full rounded-[6px] border border-[#D5DFE3] p-2 sm:w-64" />
                </label>
              </div>
            )}
          </div>

          {/* Follow-up Tasks Section */}
          <div className="space-y-3 p-3.5 bg-slate-50 border border-slate-200 rounded-[6px] text-xs">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="font-bold text-[#172A35]">مهام المتابعة الناتجة عن الجلسة (اختياري)</h3>
                <p className="text-xs text-[#4D606A]">
                  مهام عمل تنشأ ذرياً وتكلف للمكتب لمتابعة إجراءات الجلسة
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddTask}
                disabled={resultFieldsDisabled}
                data-testid="add-task-button"
                className="px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded-[6px] transition-colors min-h-[36px] flex items-center gap-1"
              >
                <span>➕</span>
                <span>إضافة مهمة عمل مطلوبة</span>
              </button>
            </div>

            {tasks.length > 0 && (
              <div className="space-y-2 pt-1">
                {tasks.map((task, idx) => (
                  <div
                    key={task.id}
                    data-testid={`task-item-${idx}`}
                    className="p-3 bg-white rounded-[6px] border border-[#D5DFE3] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#14566B]">مهمة #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTask(task.id)}
                        disabled={resultFieldsDisabled}
                        className="text-red-600 hover:text-red-800 text-xs font-semibold p-1 min-h-[32px] flex items-center"
                      >
                        ✕ حذف
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-[#172A35]">
                          عنوان المهمة <span className="text-red-600">*</span>
                        </label>
                        <input
                          type="text"
                          name={`task_title_${idx}`}
                          required
                          placeholder="مثال: إعداد مذكرة الدفاع بالدفوع الشكلية"
                          value={task.title}
                          onChange={(e) => handleUpdateTaskTitle(task.id, e.target.value)}
                          disabled={resultFieldsDisabled}
                          data-testid={`task-title-${idx}`}
                          className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:ring-2 focus:ring-[#14566B] min-h-[40px]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-[#172A35]">
                          تاريخ الاستحقاق (اختياري)
                        </label>
                        <input
                          type="date"
                          name={`task_due_${idx}`}
                          value={task.dueDate}
                          onChange={(e) => handleUpdateTaskDue(task.id, e.target.value)}
                          disabled={resultFieldsDisabled}
                          data-testid={`task-due-${idx}`}
                          className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:ring-2 focus:ring-[#14566B] min-h-[40px]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Pre-Save Confirmation Banner (Mandatory T08-TC-02 & T08-TC-07) */}
          <div
            role="region"
            aria-label="ملخص ما قبل الحفظ"
            data-testid="presave-summary-banner"
            className="p-4 bg-teal-50 border-2 border-[#14566B]/30 rounded-[8px] text-[#14566B] space-y-1 shadow-xs"
          >
            <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
              <span>📋</span>
              <span className="text-sm sm:text-base text-[#172A35] font-bold">
                «{summaryText}»
              </span>
            </div>
            <p className="text-[11px] text-[#4D606A] leading-relaxed">
              عملية ذرية واحدة تضمن تحديث حالة الجلسة وإضافة الجلسة القادمة والمهام المقترنة معاً.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[#E8EEF1]">
            <Link
              href={`/hearings/${hearingId}`}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-[#172A35] text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
            >
              إلغاء
            </Link>
            <button
              type="button"
              onClick={handleSaveResult}
              disabled={resultFieldsDisabled}
              data-testid="save-hearing-result-btn"
              className="px-6 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:bg-gray-400 text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="inline-block animate-spin">⏳</span>
                  <span>جارٍ الحفظ الذري...</span>
                </>
              ) : (
                <>
                  <span>✅</span>
                  <span>تأكيد وحفظ النتيجة</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
