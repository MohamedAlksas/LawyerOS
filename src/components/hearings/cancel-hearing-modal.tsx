'use client';

import React, { useState, useRef } from 'react';
import { cancelHearingAction } from '@/modules/scheduling/hearing-actions';
import type { CancelHearingInput } from '@/modules/scheduling/hearing-types';
import { useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import {
  hearingDraftOwner,
  isUncertainHearingOutcome,
  renderHearingModalPortal,
  useHearingModalEffects,
} from './hearing-recovery';
import { HearingDTO, formatHearingDateDisplay } from './hearing-ui-types';
import { generateClientRequestId, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';

interface CancelHearingModalProps {
  actorId: string;
  proceedingId: string;
  isOpen: boolean;
  onClose: () => void;
  hearing: HearingDTO;
  onSuccess: (cancelledHearing: HearingDTO) => void;
}

export function CancelHearingModal({
  actorId,
  proceedingId,
  isOpen,
  onClose,
  hearing,
  onSuccess,
}: CancelHearingModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLTextAreaElement>(null);

  const draft = useFormDraft<CancelHearingInput>(hearingDraftOwner(actorId, 'cancel', hearing.id), `/matters/${hearing.matterId}/proceedings/${proceedingId}`);
  const pending = useRef(draft.restored);
  const [reason, setReason] = useState(() => draft.restored?.reason ?? '');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isFrozenRetry, setIsFrozenRetry] = useState(Boolean(draft.restored));
  const [sessionExpired, setSessionExpired] = useState(false);
  useLeaveGuard((isOpen && Boolean(reason.trim())) || isFrozenRetry, isSubmitting);

  useHearingModalEffects({
    isOpen,
    isSubmitting,
    hasPending: isFrozenRetry,
    onClose,
    dialogRef,
    initialFocusRef: firstInputRef,
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!pending.current && !reason.trim()) {
      setFieldErrors({ reason: 'سبب إلغاء الجلسة مطلوب للتوثيق القضائي والإداري' });
      return;
    }

    setError(null);
    setSessionExpired(false);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const input = pending.current ?? {
        hearingId: hearing.id,
        expectedVersion: hearing.version,
        reason: reason.trim(),
        idempotencyKey: generateClientRequestId('cancel'),
      };
      pending.current = input;
      draft.keep(input);
      const res = await cancelHearingAction(input);

      if (!res.success) {
        setIsSubmitting(false);
        if (isAuthRecoveryCode(res.code)) {
          setSessionExpired(true);
          setIsFrozenRetry(true);
          setError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
          return;
        }
        const uncertain = isUncertainHearingOutcome(res.code);
        setIsFrozenRetry(uncertain);
        if (!uncertain) { pending.current = undefined; draft.clear(); }
        setError(res.error || 'تعذر إلغاء الجلسة.');
        if (res.fieldErrors) {
          setFieldErrors(res.fieldErrors);
        }
        return;
      }

      setIsSubmitting(false);
      pending.current = undefined;
      draft.clear();
      onSuccess(res.data);
      onClose();
    } catch {
      setIsSubmitting(false);
      setIsFrozenRetry(true);
      setError('تعذر تأكيد الحفظ. يمكنك إعادة محاولة نفس الطلب.');
    }
  };

  return renderHearingModalPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-hearing-modal-title"
        className="bg-white rounded-[8px] border border-red-200 shadow-lg w-full max-w-lg p-6 space-y-5 text-right my-8"
        dir="rtl"
        lang="ar-EG"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
          <div className="space-y-0.5">
            <h2 id="cancel-hearing-modal-title" className="text-base sm:text-lg font-bold text-red-900">
              إلغاء موعد الجلسة
            </h2>
            <p className="text-xs text-[#4D606A]">
              إلغاء جلسة لم تنعقد مع تعطيل التذكيرات المرتبطة وتوثيق السبب
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

        {/* Warning Note */}
        <div className="p-3 bg-red-50 border border-red-200 rounded-[6px] text-xs text-red-900 space-y-1">
          <p className="font-bold">
            جلسة يوم {formatHearingDateDisplay(hearing.hearingDate)}
          </p>
          <p className="leading-relaxed">
            سيتم تحويل حالة الجلسة إلى &laquo;ملغاة&raquo; وإلغاء أي تذكيرات مجدولة لها. لا يتم تسجيل منطوق نتيجة لجلسة تم إلغاؤها قبل انعقادها.
          </p>
        </div>

        {sessionExpired && (
          <div
            role="alert"
            data-testid="hearing-modal-session-recovery-alert"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-2"
          >
            <p className="font-bold">انتهت صلاحية الجلسة أو يلزم استكمال التحقق</p>
            <p>أُبقيت بيانات إلغاء الجلسة ومفتاح الطلب مجمّدة لمنع التكرار. سجّل الدخول ثم أعد المحاولة.</p>
            <a
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-1.5 bg-[#14566B] text-white font-semibold rounded-[6px] hover:bg-[#114252] min-h-[44px]"
            >
              فتح شاشة تسجيل الدخول في نافذة جديدة ↗
            </a>
          </div>
        )}

        {/* Frozen Retry Banner */}
        {isFrozenRetry && !sessionExpired && (
          <div
            role="alert"
            data-testid="cancel-hearing-retry-banner"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-bold">
              <span>تعذر استلام تأكيد الخادم</span>
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
            data-testid="cancel-hearing-error-banner"
            className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900"
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label htmlFor="cancel-hearing-reason" className="block font-bold text-[#172A35]">
              سبب إلغاء الجلسة <span className="text-red-600">*</span>
            </label>
            <textarea
              ref={firstInputRef}
              id="cancel-hearing-reason"
              name="reason"
              rows={3}
              required
              placeholder="مثال: شطب الدعوى، ترك الخصومة، أو تسوية النزاع ودياً..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting || isFrozenRetry}
              aria-invalid={Boolean(fieldErrors.reason)}
              aria-describedby={fieldErrors.reason ? 'cancel-hearing-reason-error' : undefined}
              data-testid="cancel-hearing-reason-input"
              className={`w-full p-2.5 bg-white border rounded-[6px] text-base sm:text-sm text-[#172A35] focus:outline-none focus:ring-2 focus:ring-red-500 ${
                fieldErrors.reason ? 'border-red-500' : 'border-[#D5DFE3]'
              }`}
            />
            {fieldErrors.reason && (
              <p id="cancel-hearing-reason-error" role="alert" className="text-red-600 text-[11px] font-semibold">
                {fieldErrors.reason}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-[#E8EEF1]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="cancel-hearing-back-button"
              className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
            >
              رجوع
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="cancel-hearing-confirm-button"
              className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span>جارٍ الإلغاء...</span>
                </>
              ) : isFrozenRetry ? (
                <>
                  <span>إعادة المحاولة بنفس المفتاح</span>
                </>
              ) : (
                <>
                  <span>تأكيد إلغاء الجلسة</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
