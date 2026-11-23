'use client';

import React, { useState, useRef } from 'react';
import { scheduleHearingAction } from '@/modules/scheduling/hearing-actions';
import type { ScheduleHearingInput } from '@/modules/scheduling/hearing-types';
import { useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import {
  isUncertainHearingOutcome,
  renderHearingModalPortal,
  useHearingModalEffects,
} from './hearing-recovery';
import { HearingDTO } from './hearing-ui-types';
import { generateClientRequestId, getCairoTodayDate, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';

interface ScheduleHearingModalProps {
  actorId: string;
  isOpen: boolean;
  onClose: () => void;
  proceedingId: string;
  matterId: string;
  defaultCourtName?: string | null;
  defaultCircuit?: string | null;
  onSuccess: (hearing: HearingDTO) => void;
}

export function ScheduleHearingModal({
  actorId,
  isOpen,
  onClose,
  proceedingId,
  matterId,
  defaultCourtName,
  defaultCircuit,
  onSuccess,
}: ScheduleHearingModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const draft = useFormDraft<ScheduleHearingInput>(`${actorId}:schedule-hearing`, `/matters/${matterId}/proceedings/${proceedingId}`);
  const pending = useRef(draft.restored);
  const [initialDate] = useState(() => getCairoTodayDate());
  const [hearingDate, setHearingDate] = useState(() => draft.restored?.hearingDate ?? initialDate);
  const [hasSpecificTime, setHasSpecificTime] = useState(() => Boolean(draft.restored?.hearingTime));
  const [hearingTime, setHearingTime] = useState(() => draft.restored?.hearingTime ?? '');
  const [locationRoom, setLocationRoom] = useState(() => draft.restored?.locationRoom ?? '');
  const [rollNumber, setRollNumber] = useState(() => draft.restored?.rollNumber ?? '');
  const [purpose, setPurpose] = useState(() => draft.restored?.purpose ?? '');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isFrozenRetry, setIsFrozenRetry] = useState(Boolean(draft.restored));
  const [sessionExpired, setSessionExpired] = useState(false);
  const dirty = isOpen && Boolean(
    hasSpecificTime || hearingTime || locationRoom || rollNumber || purpose || hearingDate !== initialDate
  );
  useLeaveGuard(dirty, isSubmitting || isFrozenRetry);

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

    setError(null);
    setSessionExpired(false);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const input = pending.current ?? {
        proceedingId,
        hearingDate,
        hearingTime: hasSpecificTime && hearingTime.trim() ? hearingTime.trim() : null,
        locationRoom: locationRoom.trim() || null,
        rollNumber: rollNumber.trim() || null,
        purpose: purpose.trim() || null,
        idempotencyKey: generateClientRequestId('schedule'),
      };
      pending.current = input;
      draft.keep(input);
      const res = await scheduleHearingAction(input);

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
        setError(res.error || 'تعذر جدولة الجلسة.');
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
      // Network timeout / unexpected crash: retain input in memory, keep key, enable frozen retry
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
        aria-labelledby="schedule-hearing-modal-title"
        className="bg-white rounded-[8px] border border-[#D5DFE3] shadow-lg w-full max-w-lg p-6 space-y-5 text-right my-8"
        dir="rtl"
        lang="ar-EG"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
          <div className="space-y-0.5">
            <h2 id="schedule-hearing-modal-title" className="text-base sm:text-lg font-bold text-[#172A35]">
              📅 إضافة وتحديد موعد جلسة جديدة
            </h2>
            <p className="text-xs text-[#4D606A]">
              تحديد موعد جلسة مرافعة أو إدارية في هذا القيد القضائي
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

        {sessionExpired && (
          <div
            role="alert"
            data-testid="hearing-modal-session-recovery-alert"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-2"
          >
            <p className="font-bold">🔒 انتهت صلاحية الجلسة أو يلزم استكمال التحقق</p>
            <p>أُبقيت بيانات الجلسة ومفتاح الطلب مجمّدة لمنع التكرار. سجّل الدخول ثم أعد المحاولة.</p>
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

        {/* Frozen Retry Banner on Network Failure */}
        {isFrozenRetry && !sessionExpired && (
          <div
            role="alert"
            data-testid="schedule-hearing-retry-banner"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-bold">
              <span>⚠️</span>
              <span>تعذر تأكيد حفظ الجلسة على الخادم</span>
            </div>
            <p>
              تم الاحتفاظ بجميع مدخلاتك في الذاكرة لتفادي فقد البيانات. يمكنك مراجعة البيانات والضغط على &laquo;إعادة المحاولة&raquo; باستخدام نفس المفتاح التعريفي للطلب.
            </p>
          </div>
        )}

        {/* General Error Message */}
        {error && !isFrozenRetry && (
          <div
            role="alert"
            data-testid="schedule-hearing-error-banner"
            className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900"
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Proceeding details (read-only reference) */}
          {(defaultCourtName || defaultCircuit) && (
            <div className="p-2.5 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] text-[#4D606A] space-y-0.5">
              <span className="font-semibold text-[#172A35]">المحكمة المحددة للقيد: </span>
              <span>{defaultCourtName || '—'}</span>
              {defaultCircuit && <span> • دائرة {defaultCircuit}</span>}
            </div>
          )}

          {/* Hearing Date */}
          <div className="space-y-1">
            <label htmlFor="schedule-hearing-date" className="block font-bold text-[#172A35]">
              تاريخ الجلسة <span className="text-red-600">*</span>
            </label>
            <input
              ref={firstInputRef}
              id="schedule-hearing-date"
              name="hearingDate"
              type="date"
              required
              value={hearingDate}
              onChange={(e) => setHearingDate(e.target.value)}
              disabled={isSubmitting || isFrozenRetry}
              data-testid="schedule-hearing-date-input"
              className={`w-full p-2.5 bg-white border rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] ${
                fieldErrors.hearingDate ? 'border-red-500' : 'border-[#D5DFE3]'
              }`}
            />
            {fieldErrors.hearingDate && (
              <p className="text-red-600 text-[11px] font-semibold">{fieldErrors.hearingDate}</p>
            )}
          </div>

          {/* Hearing Time (Optional with explicit Unknown Time toggle) */}
          <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-[6px]">
            <div className="flex items-center justify-between">
              {hasSpecificTime ? (
                <label htmlFor="schedule-hearing-time" className="font-bold text-[#172A35]">
                  وقت الجلسة (اختياري)
                </label>
              ) : (
                <span className="font-bold text-[#172A35]">
                  وقت الجلسة (اختياري)
                </span>
              )}
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-[#14566B] font-semibold">
                <input
                  type="checkbox"
                  checked={hasSpecificTime}
                  onChange={(e) => {
                    setHasSpecificTime(e.target.checked);
                    if (!e.target.checked) setHearingTime('');
                  }}
                  disabled={isSubmitting || isFrozenRetry}
                  data-testid="schedule-hearing-time-toggle"
                  className="rounded text-[#14566B] focus:ring-[#14566B]"
                />
                <span>تحديد ساعة معينة</span>
              </label>
            </div>

            {hasSpecificTime ? (
              <div className="space-y-1 pt-1">
                <input
                  id="schedule-hearing-time"
                  name="hearingTime"
                  type="time"
                  value={hearingTime}
                  onChange={(e) => setHearingTime(e.target.value)}
                  disabled={isSubmitting || isFrozenRetry}
                  data-testid="schedule-hearing-time-input"
                  className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
                {fieldErrors.hearingTime && (
                  <p className="text-red-600 text-[11px] font-semibold">{fieldErrors.hearingTime}</p>
                )}
              </div>
            ) : (
              <div className="text-xs text-[#4D606A] italic flex items-center gap-1 pt-1" data-testid="schedule-hearing-unknown-time-indicator">
                <span>🕒</span>
                <span>الساعة غير محددة (سيتم عرضها &laquo;الساعة غير محددة&raquo; دون افتراض وقت عشوائي)</span>
              </div>
            )}
          </div>

          {/* Location / Court Hall & Roll Number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="schedule-hearing-room" className="block font-semibold text-[#172A35]">
                القاعة / الدور (اختياري)
              </label>
              <input
                id="schedule-hearing-room"
                name="locationRoom"
                type="text"
                placeholder="مثال: قاعة 4 بالدور الثاني"
                value={locationRoom}
                onChange={(e) => setLocationRoom(e.target.value)}
                disabled={isSubmitting || isFrozenRetry}
                data-testid="schedule-hearing-room-input"
                className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="schedule-hearing-roll" className="block font-semibold text-[#172A35]">
                رقم الرول (اختياري)
              </label>
              <input
                id="schedule-hearing-roll"
                name="rollNumber"
                type="text"
                placeholder="مثال: رول 12"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                disabled={isSubmitting || isFrozenRetry}
                data-testid="schedule-hearing-roll-input"
                className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>
          </div>

          {/* Purpose / Required Work */}
          <div className="space-y-1">
            <label htmlFor="schedule-hearing-purpose" className="block font-semibold text-[#172A35]">
              الغرض من الجلسة أو المطلوب تجهيزه (اختياري)
            </label>
            <input
              id="schedule-hearing-purpose"
              name="purpose"
              type="text"
              placeholder="مثال: مرافعة وتقديم أصل الصحيفة والمستندات"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              disabled={isSubmitting || isFrozenRetry}
              data-testid="schedule-hearing-purpose-input"
              className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-[#E8EEF1]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="schedule-hearing-cancel-button"
              className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="schedule-hearing-submit-button"
              className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:bg-gray-400 text-white font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="inline-block animate-spin">⏳</span>
                  <span>جارٍ الحفظ...</span>
                </>
              ) : isFrozenRetry ? (
                <>
                  <span>🔄</span>
                  <span>إعادة المحاولة (بنفس المفتاح)</span>
                </>
              ) : (
                <>
                  <span>💾</span>
                  <span>حفظ موعد الجلسة</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
