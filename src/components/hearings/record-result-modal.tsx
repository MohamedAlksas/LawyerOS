'use client';

import React, { useState, useEffect, useRef } from 'react';
import { recordHearingResultAction } from '@/modules/scheduling/hearing-actions';
import {
  HearingDTO,
  NextDateDisposition,
  TaskPriority,
  formatHearingDateDisplay,
  formatRecordResultSummary,
} from './hearing-ui-types';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';

interface FollowUpTaskFormItem {
  id: string;
  title: string;
  dueDate: string;
  priority: TaskPriority;
}

interface RecordResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  hearing: HearingDTO;
  proceedingCourtName?: string | null;
  proceedingCircuit?: string | null;
  onSuccess: (updatedHearing: HearingDTO) => void;
}

export function RecordResultModal({
  isOpen,
  onClose,
  hearing,
  proceedingCourtName,
  proceedingCircuit,
  onSuccess,
}: RecordResultModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLTextAreaElement>(null);

  const [idempotencyKey] = useState(() => generateClientRequestId('res'));
  const [decision, setDecision] = useState('');
  const [summary, setSummary] = useState('');
  const [attendance, setAttendance] = useState('');
  const [nextDateDisposition, setNextDateDisposition] = useState<NextDateDisposition>('KNOWN');

  // Next hearing fields (if KNOWN)
  const [nextHearingDate, setNextHearingDate] = useState('');
  const [hasNextHearingTime, setHasNextHearingTime] = useState(false);
  const [nextHearingTime, setNextHearingTime] = useState('');
  const [nextHearingPurpose, setNextHearingPurpose] = useState('');
  const [nextHearingCourtHall, setNextHearingCourtHall] = useState('');

  // Follow-up tasks
  const [tasks, setTasks] = useState<FollowUpTaskFormItem[]>([]);

  // Confirmation step state
  const [showPreSaveConfirmation, setShowPreSaveConfirmation] = useState(false);

  // Submitting / Retry states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isFrozenRetry, setIsFrozenRetry] = useState(false);

  // Auto-focus on open
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        firstInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Focus trap and Escape listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmitting) {
          e.preventDefault();
          if (showPreSaveConfirmation) {
            setShowPreSaveConfirmation(false);
          } else {
            onClose();
          }
        }
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, showPreSaveConfirmation, onClose]);

  if (!isOpen) return null;

  const handleAddTask = () => {
    const newTask: FollowUpTaskFormItem = {
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

  const handleUpdateTask = (taskId: string, field: keyof FollowUpTaskFormItem, value: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, [field]: value } : t))
    );
  };

  const handleProceedToConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision.trim()) {
      setFieldErrors({ decision: 'منطوق القرار أو نتيجة الجلسة مطلوب' });
      return;
    }
    if (nextDateDisposition === 'KNOWN' && !nextHearingDate.trim()) {
      setFieldErrors({ nextHearingDate: 'تاريخ الجلسة القادمة مطلوب عند تحديد تأجيل لتاريخ محدد' });
      return;
    }
    setFieldErrors({});
    setError(null);
    setShowPreSaveConfirmation(true);
  };

  const handleExecuteSave = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const formattedTasks = tasks
      .filter((t) => t.title.trim().length > 0)
      .map((t) => ({
        title: t.title.trim(),
        dueDate: t.dueDate.trim() || null,
        priority: t.priority,
      }));

    const nextHearingInput =
      nextDateDisposition === 'KNOWN' && nextHearingDate.trim()
        ? {
            hearingDate: nextHearingDate.trim(),
            hearingTime: hasNextHearingTime && nextHearingTime.trim() ? nextHearingTime.trim() : null,
            purpose: nextHearingPurpose.trim() || null,
            locationRoom: nextHearingCourtHall.trim() || null,
            courtName: proceedingCourtName || null,
            circuit: proceedingCircuit || null,
          }
        : null;

    try {
      const res = await recordHearingResultAction({
        hearingId: hearing.id,
        expectedVersion: hearing.version,
        decision: decision.trim(),
        decisionText: decision.trim(),
        summary: summary.trim() || null,
        attendance: attendance.trim() || null,
        nextDateDisposition,
        nextHearing: nextHearingInput,
        tasks: formattedTasks.length > 0 ? formattedTasks : undefined,
        idempotencyKey,
      });

      if (!res.success) {
        setIsSubmitting(false);
        setIsFrozenRetry(true);
        setError(res.error || 'تعذر تسجيل نتيجة الجلسة.');
        if (res.fieldErrors) {
          setFieldErrors(res.fieldErrors);
        }
        setShowPreSaveConfirmation(false);
        return;
      }

      setIsSubmitting(false);
      onSuccess(res.data.hearing);
      onClose();
    } catch (err: unknown) {
      // In case of network timeout / disconnected transport: retain all inputs, keep key, enable frozen retry
      setIsSubmitting(false);
      setIsFrozenRetry(true);
      setShowPreSaveConfirmation(false);
      setError(
        err instanceof Error
          ? err.message
          : 'انقطع الاتصال أثناء حفظ النتيجة. مدخلاتك محفوظة في الذاكرة ويمكنك إعادة المحاولة بأمان.'
      );
    }
  };

  const summaryText = formatRecordResultSummary({
    nextDate: nextDateDisposition === 'KNOWN' ? nextHearingDate : null,
    taskCount: tasks.filter((t) => t.title.trim()).length,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-result-modal-title"
        className="bg-white rounded-[8px] border border-[#D5DFE3] shadow-lg w-full max-w-2xl p-6 space-y-5 text-right my-8"
        dir="rtl"
        lang="ar-EG"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
          <div className="space-y-0.5">
            <h2 id="record-result-modal-title" className="text-base sm:text-lg font-bold text-[#172A35]">
              ⚖️ تسجيل قرار ونتيجة الجلسة
            </h2>
            <p className="text-xs text-[#4D606A]">
              جلسة يوم {formatHearingDateDisplay(hearing.hearingDate)} {hearing.rollNumber ? `• رول ${hearing.rollNumber}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="إغلاق النافذة"
            className="p-1.5 text-[#4D606A] hover:text-[#172A35] hover:bg-gray-100 rounded-[6px] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Frozen Retry Banner */}
        {isFrozenRetry && (
          <div
            role="alert"
            data-testid="record-result-retry-banner"
            className="p-3.5 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-2"
          >
            <div className="flex items-center gap-1.5 font-bold">
              <span>⚠️</span>
              <span>تعذر استلام تأكيد الخادم (حالة عدم يقين في الشبكة)</span>
            </div>
            <p className="leading-relaxed">
              تم الاحتفاظ ببيانات القرار والمهام المحددة في الذاكرة بالكامل. يرجى الضغط على زر &laquo;إعادة المحاولة&raquo; لإعادة الإرسال بنفس مفتاح عدم التكرار لتفادي ازدواج السجلات.
            </p>
            <div className="pt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleExecuteSave}
                disabled={isSubmitting}
                data-testid="record-result-retry-button"
                className="px-4 py-2 bg-[#14566B] text-white font-bold rounded-[6px] hover:bg-[#0F4354] transition-colors min-h-[40px] flex items-center gap-1.5"
              >
                <span>🔄</span>
                <span>إعادة المحاولة بنفس المفتاح والبيانات</span>
              </button>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && !isFrozenRetry && (
          <div
            role="alert"
            data-testid="record-result-error-banner"
            className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900"
          >
            {error}
          </div>
        )}

        {/* Pre-Save Confirmation Step (Mandatory T08-TC-02 & T08-TC-07) */}
        {showPreSaveConfirmation ? (
          <div className="space-y-5" data-testid="record-result-confirmation-step">
            <div
              role="region"
              aria-label="ملخص ما قبل الحفظ"
              data-testid="record-result-presave-summary"
              className="p-4 bg-teal-50 border-2 border-[#14566B]/30 rounded-[8px] text-[#14566B] space-y-2 shadow-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>📋</span>
                <span data-testid="record-result-literal-summary" className="text-base text-[#172A35]">
                  «{summaryText}»
                </span>
              </div>
              <p className="text-xs text-[#4D606A] leading-relaxed">
                سيتم إتمام هذه المعاملة في عملية ذرية واحدة (تحديث حالة الجلسة الحالية، إضافة الجلسة المؤجل إليها، وإنشاء مهام المتابعة إن وجدت).
              </p>
            </div>

            <div className="p-3 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] text-xs space-y-2">
              <div>
                <span className="font-bold text-[#172A35]">القرار المدخل: </span>
                <span className="text-[#14566B] font-semibold">{decision}</span>
              </div>
              {attendance && (
                <div>
                  <span className="font-bold text-[#172A35]">حضور الجلسة: </span>
                  <span>{attendance}</span>
                </div>
              )}
              {nextDateDisposition === 'KNOWN' && nextHearingDate && (
                <div>
                  <span className="font-bold text-[#172A35]">تاريخ الجلسة القادمة: </span>
                  <span className="font-mono font-bold text-[#14566B]">{nextHearingDate}</span>
                </div>
              )}
              {tasks.length > 0 && (
                <div>
                  <span className="font-bold text-[#172A35]">مهام المتابعة ({tasks.length}):</span>
                  <ul className="list-disc list-inside space-y-0.5 mt-1 text-[#4D606A]">
                    {tasks.map((t) => (
                      <li key={t.id}>
                        <span className="font-semibold text-[#172A35]">{t.title}</span>
                        {t.dueDate && <span className="text-[11px] text-[#14566B]"> (الاستحقاق: {t.dueDate})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[#E8EEF1]">
              <button
                type="button"
                onClick={() => setShowPreSaveConfirmation(false)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
              >
                تعديل البيانات
              </button>
              <button
                type="button"
                onClick={handleExecuteSave}
                disabled={isSubmitting}
                data-testid="confirm-record-result-button"
                className="px-6 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:bg-gray-400 text-white font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="inline-block animate-spin">⏳</span>
                    <span>جارٍ الحفظ الذري...</span>
                  </>
                ) : (
                  <>
                    <span>✅</span>
                    <span>تأكيد وتسجيل النتيجة</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Main Input Form */
          <form onSubmit={handleProceedToConfirmation} className="space-y-4 text-xs">
            {/* Decision / Result (Required) */}
            <div className="space-y-1">
              <label htmlFor="record-result-decision" className="block font-bold text-[#172A35]">
                منطوق القرار أو نتيجة الجلسة <span className="text-red-600">*</span>
              </label>
              <textarea
                ref={firstInputRef}
                id="record-result-decision"
                name="decision"
                rows={3}
                required
                placeholder="مثال: تأجيل لتقديم مذكرة ومستندات، أو حجز للحكم لجلسة..."
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                disabled={isSubmitting}
                data-testid="record-result-decision-input"
                className={`w-full p-2.5 bg-white border rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed ${
                  fieldErrors.decision ? 'border-red-500' : 'border-[#D5DFE3]'
                }`}
              />
              {fieldErrors.decision && (
                <p className="text-red-600 text-[11px] font-semibold">{fieldErrors.decision}</p>
              )}
            </div>

            {/* Attendance & Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="record-result-attendance" className="block font-semibold text-[#172A35]">
                  حضور الجلسة (اختياري)
                </label>
                <input
                  id="record-result-attendance"
                  name="attendance"
                  type="text"
                  placeholder="مثال: حضر الأستاذ... عن المدعي، وتغيب الخصم"
                  value={attendance}
                  onChange={(e) => setAttendance(e.target.value)}
                  disabled={isSubmitting}
                  data-testid="record-result-attendance-input"
                  className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="record-result-summary" className="block font-semibold text-[#172A35]">
                  ملخص ما تم بالجلسة (اختياري)
                </label>
                <input
                  id="record-result-summary"
                  name="summary"
                  type="text"
                  placeholder="مثال: قررت المحكمة التأجيل والتكليف بالإعلان"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  disabled={isSubmitting}
                  data-testid="record-result-summary-input"
                  className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
              </div>
            </div>

            {/* Next Date Disposition Options */}
            <div className="space-y-2 p-3.5 bg-slate-50 border border-slate-200 rounded-[6px]">
              <label className="block font-bold text-[#172A35]">
                الموقف من الجلسة القادمة <span className="text-red-600">*</span>
              </label>
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
                    data-testid="disposition-known-radio"
                  />
                  <span>📅 تأجيل لتاريخ محدد</span>
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
                    data-testid="disposition-undetermined-radio"
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
                    data-testid="disposition-none-radio"
                  />
                  <span>🏁 لا توجد جلسة أخرى</span>
                </label>
              </div>

              {/* Next Hearing Details Form (when KNOWN) */}
              {nextDateDisposition === 'KNOWN' && (
                <div className="pt-3 border-t border-slate-200 space-y-3" data-testid="next-hearing-details-section">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="record-result-next-date" className="block font-bold text-[#172A35]">
                        تاريخ الجلسة القادمة <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="record-result-next-date"
                        name="nextHearingDate"
                        type="date"
                        required
                        value={nextHearingDate}
                        onChange={(e) => setNextHearingDate(e.target.value)}
                        disabled={isSubmitting}
                        data-testid="record-result-next-date-input"
                        className={`w-full p-2.5 bg-white border rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] ${
                          fieldErrors.nextHearingDate ? 'border-red-500' : 'border-[#D5DFE3]'
                        }`}
                      />
                      {fieldErrors.nextHearingDate && (
                        <p className="text-red-600 text-[11px] font-semibold">{fieldErrors.nextHearingDate}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="record-result-next-purpose" className="block font-semibold text-[#172A35]">
                        الغرض من الجلسة القادمة (اختياري)
                      </label>
                      <input
                        id="record-result-next-purpose"
                        name="nextHearingPurpose"
                        type="text"
                        placeholder="مثال: لتقديم المذكرات وحافظة المستندات"
                        value={nextHearingPurpose}
                        onChange={(e) => setNextHearingPurpose(e.target.value)}
                        disabled={isSubmitting}
                        data-testid="record-result-next-purpose-input"
                        className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                      />
                    </div>

                    <div className="space-y-1 sm:col-span-2">
                      <label htmlFor="record-result-next-hall" className="block font-semibold text-[#172A35]">
                        القاعة / الدور (اختياري)
                      </label>
                      <input
                        id="record-result-next-hall"
                        name="nextHearingCourtHall"
                        type="text"
                        placeholder="مثال: قاعة 4 بالدور الثاني"
                        value={nextHearingCourtHall}
                        onChange={(e) => setNextHearingCourtHall(e.target.value)}
                        disabled={isSubmitting}
                        data-testid="record-result-next-hall-input"
                        className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                      />
                    </div>
                  </div>

                  {/* Optional Time for Next Hearing */}
                  <div className="p-2.5 bg-white rounded-[6px] border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#172A35]">وقت الجلسة القادمة:</span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-[#14566B] font-semibold">
                        <input
                          type="checkbox"
                          checked={hasNextHearingTime}
                          onChange={(e) => {
                            setHasNextHearingTime(e.target.checked);
                            if (!e.target.checked) setNextHearingTime('');
                          }}
                          disabled={isSubmitting}
                          data-testid="record-result-next-time-toggle"
                          className="rounded text-[#14566B] focus:ring-[#14566B]"
                        />
                        <span>تحديد ساعة</span>
                      </label>
                    </div>
                    {hasNextHearingTime ? (
                      <input
                        id="record-result-next-time"
                        name="nextHearingTime"
                        type="time"
                        value={nextHearingTime}
                        onChange={(e) => setNextHearingTime(e.target.value)}
                        disabled={isSubmitting}
                        data-testid="record-result-next-time-input"
                        className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                      />
                    ) : (
                      <p className="text-xs text-[#4D606A] italic">
                        الساعة غير محددة (سيتم حفظها «الساعة غير محددة» دون افتراض وقت عشوائي).
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Atomic Follow-up Tasks */}
            <div className="space-y-3 p-3.5 bg-slate-50 border border-slate-200 rounded-[6px]">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="font-bold text-[#172A35]">مهام المتابعة الناتجة عن الجلسة (اختياري)</h3>
                  <p className="text-xs text-[#4D606A]">
                    مهام عمل سيتم إنشاؤها وتكليفها ذرياً مع حفظ نتيجة الجلسة
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddTask}
                  disabled={isSubmitting}
                  data-testid="add-task-row-button"
                  className="px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded-[6px] text-xs transition-colors min-h-[36px] flex items-center gap-1"
                >
                  <span>➕</span>
                  <span>إضافة مهمة</span>
                </button>
              </div>

              {tasks.length > 0 ? (
                <div className="space-y-2 pt-1" data-testid="record-result-tasks-container">
                  {tasks.map((task, idx) => (
                    <div
                      key={task.id}
                      data-testid={`task-row-${idx}`}
                      className="p-3 bg-white rounded-[6px] border border-[#D5DFE3] space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#14566B]">مهمة #{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveTask(task.id)}
                          disabled={isSubmitting}
                          data-testid={`remove-task-${idx}`}
                          className="text-red-600 hover:text-red-800 text-xs font-semibold p-1 min-h-[32px] flex items-center"
                        >
                          ✕ حذف المهمة
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="block text-[11px] font-semibold text-[#172A35]">
                            عنوان المهمة المطلوبة <span className="text-red-600">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="مثال: استخراج صورة رسمية من المحضر"
                            value={task.title}
                            onChange={(e) => handleUpdateTask(task.id, 'title', e.target.value)}
                            disabled={isSubmitting}
                            data-testid={`task-title-input-${idx}`}
                            className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[40px]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[11px] font-semibold text-[#172A35]">
                            تاريخ الاستحقاق (اختياري)
                          </label>
                          <input
                            type="date"
                            value={task.dueDate}
                            onChange={(e) => handleUpdateTask(task.id, 'dueDate', e.target.value)}
                            disabled={isSubmitting}
                            data-testid={`task-duedate-input-${idx}`}
                            className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[40px]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#4D606A] italic py-1">
                  لم يتم إضافة مهام متابعة. يمكنك إضافة مهام لإلزام المكتب بإجراءات محددة قبل الجلسة القادمة.
                </p>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-[#E8EEF1]">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                data-testid="record-result-cancel-button"
                className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                data-testid="record-result-proceed-button"
                className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:bg-gray-400 text-white font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
              >
                <span>مراجعة وتأكيد الحفظ ←</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
