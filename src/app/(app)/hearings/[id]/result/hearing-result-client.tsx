'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
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

export function HearingResultClient({
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
  const [currentStatus, setCurrentStatus] = useState<HearingStatus>(initialStatus);
  const [latestResult, setLatestResult] = useState(initialLatestResult);

  // Form state
  const [decision, setDecision] = useState('');
  const [nextDateDisposition, setNextDateDisposition] = useState<NextDateDisposition>('KNOWN');
  const [nextHearingDate, setNextHearingDate] = useState('');
  const [tasks, setTasks] = useState<FollowUpTaskItem[]>([]);

  // Persistent idempotency key across retries
  const idempotencyKeyRef = useRef(generateClientRequestId('res'));

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFrozenRetry, setIsFrozenRetry] = useState(false);
  const [uncertaintyError, setUncertaintyError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [savedDecision, setSavedDecision] = useState('');

  // Correction Mode states
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctedDecision, setCorrectedDecision] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionSuccess, setCorrectionSuccess] = useState(false);

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

    if (!decision.trim()) {
      setValidationError('منطوق القرار أو نتيجة الجلسة مطلوب');
      return;
    }

    setValidationError(null);
    setUncertaintyError(null);
    setConflictError(null);
    setIsSubmitting(true);

    const effectiveDisposition: NextDateDisposition =
      nextDateDisposition === 'NONE'
        ? 'NONE'
        : nextHearingDate.trim()
        ? 'KNOWN'
        : 'UNDETERMINED';

    const payload = {
      hearingId,
      expectedVersion: initialVersion,
      decision: decision.trim(),
      decisionText: decision.trim(),
      nextDateDisposition: effectiveDisposition,
      nextHearing:
        effectiveDisposition === 'KNOWN' && nextHearingDate.trim()
          ? {
              hearingDate: nextHearingDate.trim(),
              courtName,
              circuit,
            }
          : null,
      tasks: tasks
        .filter((t) => t.title.trim().length > 0)
        .map((t) => ({
          title: t.title.trim(),
          dueDate: t.dueDate.trim() || null,
          priority: t.priority,
        })),
      idempotencyKey: idempotencyKeyRef.current,
    };

    try {
      const res = await fetch(`/api/scheduling/hearings/${hearingId}/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setIsSubmitting(false);
        setConflictError(
          data.error || 'تم تعديل هذا السجل بواسطة مستخدم آخر، يرجى تحديث الصفحة'
        );
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setIsSubmitting(false);
        setIsFrozenRetry(true);
        setUncertaintyError(
          data.error || 'تعذر الاتصال بالخادم. الاتصال انقطع، البيانات لسه ما اتحفظتش.'
        );
        return;
      }

      const data = await res.json();
      setIsSubmitting(false);
      setSavedSuccess(true);
      setSavedDecision(decision.trim());
      setCurrentStatus('COMPLETED');
      setLatestResult({
        id: data.data?.result?.id || 'res-saved',
        decisionText: decision.trim(),
        revision: data.data?.result?.revision || 1,
        correctionReason: null,
        recordedAt: new Date().toISOString(),
      });
    } catch {
      // Disconnection / Offline / Fetch Abort
      setIsSubmitting(false);
      setIsFrozenRetry(true);
      setUncertaintyError(
        'الاتصال انقطع، البيانات لسه ما اتحفظتش. مدخلاتك محفوظة في الذاكرة بالكامل.'
      );
    }
  };

  const handleSaveCorrection = async () => {
    if (correctionSubmitting) return;

    if (!correctionReason.trim()) {
      setCorrectionError('سبب التصحيح مطلوب');
      return;
    }
    if (!correctedDecision.trim()) {
      setCorrectionError('المنطوق المصحح مطلوب');
      return;
    }

    setCorrectionError(null);
    setCorrectionSubmitting(true);

    try {
      const res = await fetch(`/api/scheduling/hearings/${hearingId}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hearingId,
          decision: correctedDecision.trim(),
          reason: correctionReason.trim(),
          idempotencyKey: generateClientRequestId('corr'),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setCorrectionSubmitting(false);
        setCorrectionError(errData.error || 'تعذر حفظ التصحيح');
        return;
      }

      const data = await res.json();
      setCorrectionSubmitting(false);
      setCorrectionSuccess(true);
      setIsCorrecting(false);
      setLatestResult({
        id: data.data?.id || 'res-corrected',
        decisionText: correctedDecision.trim(),
        revision: (latestResult?.revision || 1) + 1,
        correctionReason: correctionReason.trim(),
        recordedAt: new Date().toISOString(),
      });
    } catch {
      setCorrectionSubmitting(false);
      setCorrectionError('انقطع الاتصال أثناء حفظ التصحيح.');
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
            {!isCorrecting && (
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
                <p className="text-xs text-red-600 font-semibold">{correctionError}</p>
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
                  disabled={correctionSubmitting}
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
                  disabled={correctionSubmitting}
                  className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs focus:ring-2 focus:ring-[#14566B]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCorrecting(false)}
                  disabled={correctionSubmitting}
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
                  {correctionSubmitting ? 'جارٍ حفظ التصحيح...' : 'حفظ التصحيح'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Result Entry Form (When not yet completed or submitting) */}
      {!savedSuccess && currentStatus !== 'COMPLETED' && !latestResult && (
        <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-5">
          {validationError && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900 font-semibold">
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
              disabled={isSubmitting}
              data-testid="hearing-decision-textarea"
              className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed"
            />
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
                  disabled={isSubmitting}
                  data-testid="next-hearing-date-input"
                  className="w-full sm:w-64 p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
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
                disabled={isSubmitting}
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
                        disabled={isSubmitting}
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
                          disabled={isSubmitting}
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
                          disabled={isSubmitting}
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
              disabled={isSubmitting}
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
