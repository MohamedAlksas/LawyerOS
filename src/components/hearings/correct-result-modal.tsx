'use client';

import React, { useState, useEffect, useRef } from 'react';
import { correctHearingResultAction } from '@/modules/scheduling/hearing-actions';
import { HearingDTO, formatHearingDateDisplay } from './hearing-ui-types';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';

interface CorrectResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  hearing: HearingDTO;
  onSuccess: (updatedHearing: HearingDTO) => void;
}

export function CorrectResultModal({
  isOpen,
  onClose,
  hearing,
  onSuccess,
}: CorrectResultModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLTextAreaElement>(null);

  const priorDecision =
    hearing.latestResult?.courtDecision || hearing.latestResult?.decisionText || '';
  const priorSummary = hearing.latestResult?.summary || '';
  const priorRevision = hearing.latestResult?.revision ?? 1;

  const [idempotencyKey] = useState(() => generateClientRequestId('cor'));
  const [decision, setDecision] = useState(() => priorDecision);
  const [summary, setSummary] = useState(() => priorSummary);
  const [reason, setReason] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isFrozenRetry, setIsFrozenRetry] = useState(false);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        firstInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmitting) {
          e.preventDefault();
          onClose();
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
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!decision.trim()) {
      setFieldErrors({ decision: 'منطوق القرار المصحح مطلوب' });
      return;
    }

    if (!reason.trim()) {
      setFieldErrors({ reason: 'سبب التصحيح مطلوب لتوثيق سجل التعديل والرقابة القضائية' });
      return;
    }

    setError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const res = await correctHearingResultAction({
        hearingId: hearing.id,
        expectedVersion: hearing.version,
        currentResultId: hearing.latestResult?.id,
        decision: decision.trim(),
        decisionText: decision.trim(),
        summary: summary.trim() || null,
        reason: reason.trim(),
        correctionReason: reason.trim(),
        idempotencyKey,
      });

      if (!res.success) {
        setIsSubmitting(false);
        setIsFrozenRetry(true);
        setError(res.error || 'تعذر تصحيح نتيجة الجلسة.');
        if (res.fieldErrors) {
          setFieldErrors(res.fieldErrors);
        }
        return;
      }

      setIsSubmitting(false);
      // Construct updated hearing object with latest result
      const updated: HearingDTO = {
        ...hearing,
        latestResult: {
          id: res.data.id,
          courtDecision: res.data.courtDecision || res.data.decisionText,
          decisionText: res.data.courtDecision || res.data.decisionText,
          summary: res.data.summary,
          attendance: res.data.attendance,
          notes: res.data.notes,
          correctionReason: reason.trim(),
          nextDateDisposition: res.data.nextDateDisposition,
          recordedAt: res.data.recordedAt,
          revision: res.data.revision,
        },
      };

      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setIsSubmitting(false);
      setIsFrozenRetry(true);
      setError(
        err instanceof Error
          ? err.message
          : 'انقطع الاتصال بالخادم أثناء تصحيح النتيجة. مدخلاتك محفوظة في الذاكرة ويمكنك إعادة المحاولة بأمان.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="correct-result-modal-title"
        className="bg-white rounded-[8px] border border-[#D5DFE3] shadow-lg w-full max-w-lg p-6 space-y-5 text-right my-8"
        dir="rtl"
        lang="ar-EG"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
          <div className="space-y-0.5">
            <h2 id="correct-result-modal-title" className="text-base sm:text-lg font-bold text-[#172A35]">
              ✏️ تصحيح منطوق قرار الجلسة
            </h2>
            <p className="text-xs text-[#4D606A]">
              جلسة يوم {formatHearingDateDisplay(hearing.hearingDate)} (إصدار النتيجة رقم {priorRevision})
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

        {/* Prior Immutable Decision Reference */}
        <div
          data-testid="prior-decision-reference"
          className="p-3 bg-amber-50/60 border border-amber-200 rounded-[6px] text-xs space-y-1 text-amber-950"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold">المنطوق المسجل سابقاً (الإصدار {priorRevision}):</span>
          </div>
          <p className="font-semibold text-stone-900 bg-white p-2 rounded border border-amber-200 leading-relaxed">
            {priorDecision || '—'}
          </p>
          <p className="text-[11px] text-amber-800">
            وفقاً لضوابط النظام، يتم حفظ القرار السابق كنسخة تاريخية غير قابلة للمسح مع توثيق سبب التصحيح.
          </p>
        </div>

        {/* Frozen Retry Banner */}
        {isFrozenRetry && (
          <div
            role="alert"
            data-testid="correct-result-retry-banner"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-bold">
              <span>⚠️</span>
              <span>تعذر استلام تأكيد الخادم (حالة عدم يقين)</span>
            </div>
            <p>
              مدخلاتك محفوظة في الذاكرة. يرجى الضغط على زر إعادة المحاولة لإعادة الإرسال بنفس مفتاح الطلب.
            </p>
          </div>
        )}

        {/* Error message */}
        {error && !isFrozenRetry && (
          <div
            role="alert"
            data-testid="correct-result-error-banner"
            className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900"
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label htmlFor="correct-result-decision" className="block font-bold text-[#172A35]">
              منطوق القرار المصحح <span className="text-red-600">*</span>
            </label>
            <textarea
              ref={firstInputRef}
              id="correct-result-decision"
              name="decision"
              rows={3}
              required
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              disabled={isSubmitting}
              data-testid="correct-result-decision-input"
              className={`w-full p-2.5 bg-white border rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                fieldErrors.decision ? 'border-red-500' : 'border-[#D5DFE3]'
              }`}
            />
            {fieldErrors.decision && (
              <p className="text-red-600 text-[11px] font-semibold">{fieldErrors.decision}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="correct-result-reason" className="block font-bold text-[#172A35]">
              سبب التصحيح <span className="text-red-600">*</span>
            </label>
            <textarea
              id="correct-result-reason"
              name="reason"
              rows={2}
              required
              placeholder="مثال: تصحيح خطأ مادي في تدوين منطوق القرار، أو إضافة طلبات الدفاع الناقصة"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
              data-testid="correct-result-reason-input"
              className={`w-full p-2.5 bg-white border rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                fieldErrors.reason ? 'border-red-500' : 'border-[#D5DFE3]'
              }`}
            />
            {fieldErrors.reason && (
              <p className="text-red-600 text-[11px] font-semibold">{fieldErrors.reason}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="correct-result-summary" className="block font-semibold text-[#172A35]">
              ملخص إضافي (اختياري)
            </label>
            <input
              id="correct-result-summary"
              name="summary"
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              disabled={isSubmitting}
              data-testid="correct-result-summary-input"
              className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-[#E8EEF1]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="correct-result-cancel-button"
              className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="correct-result-submit-button"
              className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:bg-gray-400 text-white font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="inline-block animate-spin">⏳</span>
                  <span>جارٍ حفظ التصحيح...</span>
                </>
              ) : isFrozenRetry ? (
                <>
                  <span>🔄</span>
                  <span>إعادة المحاولة بنفس المفتاح</span>
                </>
              ) : (
                <>
                  <span>💾</span>
                  <span>حفظ القرار المصحح</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
