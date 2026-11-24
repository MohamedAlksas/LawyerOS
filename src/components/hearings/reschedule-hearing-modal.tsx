'use client';

import React, { useState, useRef } from 'react';
import { rescheduleHearingAction } from '@/modules/scheduling/hearing-actions';
import type { RescheduleHearingInput } from '@/modules/scheduling/hearing-types';
import { useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import {
  hearingDraftOwner,
  isUncertainHearingOutcome,
  renderHearingModalPortal,
  useHearingModalEffects,
} from './hearing-recovery';
import { HearingDTO, formatHearingDateDisplay } from './hearing-ui-types';
import { generateClientRequestId, getCairoTodayDate, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';

interface RescheduleHearingModalProps {
  actorId: string;
  proceedingId: string;
  isOpen: boolean;
  onClose: () => void;
  hearing: HearingDTO;
  onSuccess: (newHearing: HearingDTO) => void;
}

export function RescheduleHearingModal({
  actorId,
  proceedingId,
  isOpen,
  onClose,
  hearing,
  onSuccess,
}: RescheduleHearingModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const draft = useFormDraft<RescheduleHearingInput>(hearingDraftOwner(actorId, 'reschedule', hearing.id), `/matters/${hearing.matterId}/proceedings/${proceedingId}`);
  const pending = useRef(draft.restored);
  const [initialDate] = useState(() => getCairoTodayDate());
  const [newHearingDate, setNewHearingDate] = useState(() => draft.restored?.newHearingDate ?? initialDate);
  const [hasSpecificTime, setHasSpecificTime] = useState(() => Boolean(draft.restored?.newHearingTime));
  const [newHearingTime, setNewHearingTime] = useState(() => draft.restored?.newHearingTime ?? '');
  const [reason, setReason] = useState(() => draft.restored?.reason ?? '');
  const [locationRoom, setLocationRoom] = useState(() => draft.restored?.locationRoom ?? hearing.locationRoom ?? '');

  const [taskChanges, setTaskChanges] = useState(() => draft.restored?.taskChanges ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isFrozenRetry, setIsFrozenRetry] = useState(Boolean(draft.restored));
  const [sessionExpired, setSessionExpired] = useState(false);
  const dirty = isOpen && Boolean(
    hasSpecificTime ||
    newHearingTime ||
    reason ||
    locationRoom !== (hearing.locationRoom ?? '') ||
    taskChanges.length > 0 ||
    newHearingDate !== initialDate
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

    if (!pending.current && !reason.trim()) {
      setFieldErrors({ reason: 'سبب تعديل الموعد مطلوب لتسجيل سجل التغيير' });
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
        newHearingDate,
        newHearingTime: hasSpecificTime && newHearingTime.trim() ? newHearingTime.trim() : null,
        reason: reason.trim(),
        taskChanges,
        locationRoom: locationRoom.trim() || null,
        idempotencyKey: generateClientRequestId('reschedule'),
      };
      pending.current = input;
      draft.keep(input);
      const res = await rescheduleHearingAction(input);

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
        setError(res.error || 'تعذر تعديل موعد الجلسة.');
        if (res.fieldErrors) {
          setFieldErrors(res.fieldErrors);
        }
        return;
      }

      setIsSubmitting(false);
      pending.current = undefined;
      draft.clear();
      onSuccess(res.data.newHearing || res.data.replacementHearing);
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
        aria-labelledby="reschedule-modal-title"
        className="bg-white rounded-[8px] border border-[#D5DFE3] shadow-lg w-full max-w-lg p-6 space-y-5 text-right my-8"
        dir="rtl"
        lang="ar-EG"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
          <div className="space-y-0.5">
            <h2 id="reschedule-modal-title" className="text-base sm:text-lg font-bold text-[#172A35]">
              تعديل موعد جلسة لم تنعقد
            </h2>
            <p className="text-xs text-[#4D606A]">
              تعديل الموعد المحدد مع الاحتفاظ بسجل الجلسة السابقة كـ &laquo;تم تعديل الموعد&raquo;
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

        {/* Current Hearing Context */}
        <div className="p-3 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[#4D606A]">الموعد الحالي المسجل:</span>
            <span className="font-bold text-[#172A35]">{formatHearingDateDisplay(hearing.hearingDate)}</span>
          </div>
          {hearing.purpose && (
            <div className="text-[11px] text-[#4D606A]">
              <span>الغرض: </span>
              <span>{hearing.purpose}</span>
            </div>
          )}
        </div>

        {sessionExpired && (
          <div
            role="alert"
            data-testid="hearing-modal-session-recovery-alert"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-2"
          >
            <p className="font-bold">انتهت صلاحية الجلسة أو يلزم استكمال التحقق</p>
            <p>أُبقيت بيانات تعديل الموعد ومفتاح الطلب مجمّدة لمنع التكرار. سجّل الدخول ثم أعد المحاولة.</p>
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
            data-testid="reschedule-hearing-retry-banner"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-bold">
              <span>تعذر استلام تأكيد الخادم (حالة عدم يقين)</span>
            </div>
            <p>
              مدخلاتك محفوظة في الذاكرة. يرجى الضغط على زر إعادة المحاولة لإعادة الإرسال بنفس مفتاح الطلب لتفادي التكرار.
            </p>
          </div>
        )}

        {/* Error Banner */}
        {error && !isFrozenRetry && (
          <div
            role="alert"
            data-testid="reschedule-hearing-error-banner"
            className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900"
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* New Hearing Date */}
          <div className="space-y-1">
            <label htmlFor="reschedule-new-date" className="block font-bold text-[#172A35]">
              الموعد الجديد للجلسة <span className="text-red-600">*</span>
            </label>
            <input
              ref={firstInputRef}
              id="reschedule-new-date"
              name="newHearingDate"
              type="date"
              dir="ltr"
              required
              value={newHearingDate}
              onChange={(e) => setNewHearingDate(e.target.value)}
              disabled={isSubmitting || isFrozenRetry}
              aria-invalid={Boolean(fieldErrors.newHearingDate)}
              aria-describedby={fieldErrors.newHearingDate ? 'reschedule-new-date-error' : undefined}
              data-testid="reschedule-new-date-input"
              className={`w-full p-2.5 bg-white border rounded-[6px] text-base sm:text-sm text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] ${
                fieldErrors.newHearingDate ? 'border-red-500' : 'border-[#D5DFE3]'
              }`}
            />
            {fieldErrors.newHearingDate && (
              <p id="reschedule-new-date-error" role="alert" className="text-red-600 text-[11px] font-semibold">
                {fieldErrors.newHearingDate}
              </p>
            )}
          </div>

          {/* Time (Optional with Unknown Time indication) */}
          <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-[6px]">
            <div className="flex items-center justify-between">
              {hasSpecificTime ? (
                <label htmlFor="reschedule-new-time" className="font-bold text-[#172A35]">
                  تحديد وقت الجلسة الجديدة (اختياري)
                </label>
              ) : (
                <span className="font-bold text-[#172A35]">
                  تحديد وقت الجلسة الجديدة (اختياري)
                </span>
              )}
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-[#14566B] font-semibold">
                <input
                  type="checkbox"
                  checked={hasSpecificTime}
                  onChange={(e) => {
                    setHasSpecificTime(e.target.checked);
                    if (!e.target.checked) setNewHearingTime('');
                  }}
                  disabled={isSubmitting || isFrozenRetry}
                  data-testid="reschedule-time-toggle"
                  className="rounded text-[#14566B] focus:ring-[#14566B]"
                />
                <span>تحديد ساعة</span>
              </label>
            </div>
            {hasSpecificTime ? (
              <div className="space-y-1">
                <input
                  id="reschedule-new-time"
                  name="newHearingTime"
                  type="time"
                  dir="ltr"
                  value={newHearingTime}
                  onChange={(e) => setNewHearingTime(e.target.value)}
                  disabled={isSubmitting || isFrozenRetry}
                  aria-invalid={Boolean(fieldErrors.newHearingTime)}
                  aria-describedby={fieldErrors.newHearingTime ? 'reschedule-new-time-error' : undefined}
                  data-testid="reschedule-new-time-input"
                  className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
                {fieldErrors.newHearingTime && (
                  <p id="reschedule-new-time-error" role="alert" className="text-red-600 text-[11px] font-semibold">
                    {fieldErrors.newHearingTime}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#4D606A] italic">
                الساعة غير محددة (سيتم عرضها &laquo;الساعة غير محددة&raquo; دون افتراض وقت عشوائي).
              </p>
            )}
          </div>

          {/* Location / Court Hall */}
          <div className="space-y-1">
            <label htmlFor="reschedule-location-room" className="block font-semibold text-[#172A35]">
              القاعة / الدور (اختياري)
            </label>
            <input
              id="reschedule-location-room"
              name="locationRoom"
              type="text"
              placeholder="مثال: قاعة 4"
              value={locationRoom}
              onChange={(e) => setLocationRoom(e.target.value)}
              disabled={isSubmitting || isFrozenRetry}
              data-testid="reschedule-location-room-input"
              className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            />
          </div>

          {/* Reason (Required for Audit Trail) */}
          <div className="space-y-1">
            <label htmlFor="reschedule-reason" className="block font-bold text-[#172A35]">
              سبب تعديل الموعد <span className="text-red-600">*</span>
            </label>
            <textarea
              id="reschedule-reason"
              name="reason"
              rows={2}
              required
              placeholder="مثال: عطلة رسمية طارئة، أو تقديم موعد نظر الدعوى بقرار من رئيس المحكمة"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting || isFrozenRetry}
              aria-invalid={Boolean(fieldErrors.reason)}
              aria-describedby={fieldErrors.reason ? 'reschedule-reason-error' : undefined}
              data-testid="reschedule-reason-input"
              className={`w-full p-2.5 bg-white border rounded-[6px] text-base sm:text-sm text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                fieldErrors.reason ? 'border-red-500' : 'border-[#D5DFE3]'
              }`}
            />
            {fieldErrors.reason && (
              <p id="reschedule-reason-error" role="alert" className="text-red-600 text-[11px] font-semibold">
                {fieldErrors.reason}
              </p>
            )}
          </div>

          {/* Actions */}
          {Boolean(hearing.followUpTasks?.length) && (
            <fieldset disabled={isSubmitting || isFrozenRetry} className="space-y-2 rounded border p-2 text-sm">
              <legend>مهام الجلسة المرتبطة</legend>
              {hearing.followUpTasks?.map((task) => {
                const selected = taskChanges.find(({ taskId }) => taskId === task.id);
                return (
                  <div key={task.id}>
                    <label className="flex gap-2">
                      <input type="checkbox" checked={Boolean(selected)} onChange={(event) => {
                        setTaskChanges(event.target.checked
                          ? [...taskChanges, { taskId: task.id, expectedVersion: task.version, dueDate: newHearingDate }]
                          : taskChanges.filter(({ taskId }) => taskId !== task.id));
                      }} />
                      نقل {task.title} (الموعد الحالي: {task.dueDate || 'غير محدد'})
                    </label>
                    {selected && (
                      <input
                        type="date"
                        dir="ltr"
                        aria-label={`الموعد الجديد لمهمة ${task.title}`}
                        value={selected.dueDate ?? ''}
                        onChange={(event) => {
                          setTaskChanges(taskChanges.map((change) => change.taskId === task.id
                            ? { ...change, dueDate: event.target.value || null } : change));
                        }}
                        className="mt-1.5 w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-[#E8EEF1]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="reschedule-cancel-button"
              className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="reschedule-submit-button"
              className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:bg-gray-400 text-white font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span>جارٍ الحفظ...</span>
                </>
              ) : isFrozenRetry ? (
                <>
                  <span>إعادة المحاولة بنفس المفتاح</span>
                </>
              ) : (
                <>
                  <span>تأكيد تعديل الموعد</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
