'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  HearingDTO,
  HEARING_STATUS_LABELS,
  HEARING_STATUS_CLASSES,
  formatHearingDateDisplay,
  formatHearingTimeDisplay,
} from './hearing-ui-types';
import { ScheduleHearingModal } from './schedule-hearing-modal';
import { RecordResultModal } from './record-result-modal';
import { RescheduleHearingModal } from './reschedule-hearing-modal';
import { CancelHearingModal } from './cancel-hearing-modal';
import { CorrectResultModal } from './correct-result-modal';

interface HearingListProps {
  proceedingId: string;
  matterId?: string;
  initialHearings: HearingDTO[];
  courtName?: string | null;
  circuit?: string | null;
  isReadOnly?: boolean;
}

export function HearingList({
  proceedingId,
  initialHearings,
  courtName,
  circuit,
  isReadOnly = false,
}: HearingListProps) {
  const router = useRouter();
  const [hearings, setHearings] = useState<HearingDTO[]>(initialHearings);

  // Modal active states
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedHearingForRecord, setSelectedHearingForRecord] = useState<HearingDTO | null>(null);
  const [selectedHearingForReschedule, setSelectedHearingForReschedule] = useState<HearingDTO | null>(null);
  const [selectedHearingForCancel, setSelectedHearingForCancel] = useState<HearingDTO | null>(null);
  const [selectedHearingForCorrect, setSelectedHearingForCorrect] = useState<HearingDTO | null>(null);

  // Trigger element reference to restore focus on close
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const openWithFocus = (triggerEl?: HTMLElement | null) => {
    lastTriggerRef.current = triggerEl || (document.activeElement as HTMLElement | null);
  };

  const closeAndRestoreFocus = (callback: () => void) => {
    callback();
    if (lastTriggerRef.current && typeof lastTriggerRef.current.focus === 'function') {
      requestAnimationFrame(() => {
        lastTriggerRef.current?.focus();
      });
    }
  };

  // Handlers for modal callbacks
  const handleScheduleSuccess = (newHearing: HearingDTO) => {
    setHearings((prev) => [...prev, newHearing]);
    router.refresh();
  };

  const handleUpdateHearingSuccess = (updatedHearing: HearingDTO) => {
    setHearings((prev) =>
      prev.map((h) => (h.id === updatedHearing.id ? updatedHearing : h))
    );
    router.refresh();
  };

  const handleRescheduleSuccess = (newHearing: HearingDTO) => {
    setHearings((prev) => {
      // Mark the old hearing as RESCHEDULED if present
      const updated = prev.map((h) =>
        h.id === selectedHearingForReschedule?.id ? { ...h, status: 'RESCHEDULED' as const } : h
      );
      return [...updated, newHearing];
    });
    router.refresh();
  };

  return (
    <div className="space-y-4" data-testid="hearings-list-section">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8EEF1]">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[#172A35]" data-testid="hearings-section-heading">
              ⚖️ رول وجدول الجلسات القضائية
            </h2>
            <span
              data-testid="hearings-count-badge"
              className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-[#14566B]"
            >
              {hearings.length}
            </span>
          </div>
          <p className="text-xs text-[#4D606A]">
            سجل مواعيد الجلسات، القرارات والنتائج المسجلة، والتأجيلات الإجرائية
          </p>
        </div>

        {!isReadOnly && (
          <button
            type="button"
            onClick={(e) => {
              openWithFocus(e.currentTarget);
              setShowScheduleModal(true);
            }}
            data-testid="schedule-hearing-button"
            className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>➕</span>
            <span>إضافة وتحديد موعد جلسة</span>
          </button>
        )}
      </div>

      {/* Empty State */}
      {hearings.length === 0 ? (
        <div
          data-testid="empty-hearings-container"
          className="bg-white rounded-[6px] border border-dashed border-[#D5DFE3] p-8 text-center space-y-3"
        >
          <div className="text-3xl" aria-hidden="true">
            📅
          </div>
          <div className="space-y-1">
            <p className="font-bold text-sm text-[#172A35]">
              لا توجد جلسات مسجلة لهذا القيد القضائي بعد
            </p>
            <p className="text-xs text-[#4D606A] max-w-md mx-auto">
              يمكنك تحديد موعد الجلسة الأولى لمتابعة رول المرافعة والقرارات القضائية المرتبطة بهذا القيد.
            </p>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              onClick={(e) => {
                openWithFocus(e.currentTarget);
                setShowScheduleModal(true);
              }}
              data-testid="empty-schedule-hearing-button"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[44px]"
            >
              <span>➕</span>
              <span>تحديد موعد الجلسة الأولى</span>
            </button>
          )}
        </div>
      ) : (
        /* Hearings List */
        <div className="space-y-3" data-testid="hearings-items-container">
          {hearings.map((hearing) => {
            const isScheduled = hearing.status === 'SCHEDULED';
            const isCompleted = hearing.status === 'COMPLETED';
            const isCancelled = hearing.status === 'CANCELLED';
            const isRescheduled = hearing.status === 'RESCHEDULED';

            const latestResult = hearing.latestResult;
            const timeDisplay = formatHearingTimeDisplay(hearing.hearingTime);
            const isUnknownTime = !hearing.hearingTime || !hearing.hearingTime.trim();

            return (
              <div
                key={hearing.id}
                data-testid={`hearing-card-${hearing.id}`}
                className={`bg-white rounded-[6px] border p-4 sm:p-5 shadow-xs transition-shadow space-y-3 ${
                  isScheduled
                    ? 'border-[#14566B]/30 hover:border-[#14566B]'
                    : isCompleted
                    ? 'border-emerald-200'
                    : 'border-[#D5DFE3] bg-[#FAFBFB]'
                }`}
              >
                {/* Header row: Date, Time, Status badge */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#E8EEF1]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#172A35]" data-testid={`hearing-date-${hearing.id}`}>
                      {formatHearingDateDisplay(hearing.hearingDate)}
                    </span>
                    <span className="text-[#D5DFE3]">|</span>
                    <span
                      data-testid={`hearing-time-${hearing.id}`}
                      className={`text-xs px-2 py-0.5 rounded font-medium ${
                        isUnknownTime
                          ? 'bg-stone-100 text-[#4D606A] italic'
                          : 'bg-blue-50 text-blue-900 font-mono'
                      }`}
                    >
                      {timeDisplay}
                    </span>
                    {hearing.rollNumber && (
                      <span className="text-xs bg-slate-100 text-[#172A35] px-2 py-0.5 rounded border border-slate-200 font-semibold">
                        رول {hearing.rollNumber}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      data-testid={`hearing-status-badge-${hearing.id}`}
                      className={`text-xs font-bold px-2.5 py-0.5 rounded border ${
                        HEARING_STATUS_CLASSES[hearing.status]
                      }`}
                    >
                      {HEARING_STATUS_LABELS[hearing.status]}
                    </span>
                  </div>
                </div>

                {/* Hearing Purpose and Court Location */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {hearing.purpose && (
                    <div className="text-[#172A35]">
                      <span className="font-semibold text-[#4D606A]">الغرض / المطلوب: </span>
                      <span>{hearing.purpose}</span>
                    </div>
                  )}
                  {hearing.locationRoom && (
                    <div className="text-[#172A35]">
                      <span className="font-semibold text-[#4D606A]">القاعة / الدور: </span>
                      <span>{hearing.locationRoom}</span>
                    </div>
                  )}
                </div>

                {/* Result Section (for completed hearings) */}
                {isCompleted && latestResult && (
                  <div
                    data-testid={`hearing-result-section-${hearing.id}`}
                    className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-[6px] text-xs space-y-2 text-emerald-950"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-900 flex items-center gap-1">
                        <span>⚖️</span>
                        <span>قرار المحكمة (الإصدار {latestResult.revision}):</span>
                      </span>
                      {latestResult.correctionReason && (
                        <span className="text-[11px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300 font-semibold">
                          مصحح: {latestResult.correctionReason}
                        </span>
                      )}
                    </div>
                    <p className="font-bold text-[#172A35] bg-white p-2.5 rounded border border-emerald-200 leading-relaxed">
                      {latestResult.courtDecision || latestResult.decisionText}
                    </p>
                    {latestResult.attendance && (
                      <div className="text-emerald-900">
                        <span className="font-semibold">حضور الجلسة: </span>
                        <span>{latestResult.attendance}</span>
                      </div>
                    )}
                    {latestResult.summary && (
                      <div className="text-emerald-900">
                        <span className="font-semibold">ملخص ما تم: </span>
                        <span>{latestResult.summary}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Reschedule Reason */}
                {isRescheduled && hearing.rescheduleReason && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
                    <span className="font-bold">سبب تعديل الموعد: </span>
                    <span>{hearing.rescheduleReason}</span>
                  </div>
                )}

                {/* Cancellation Reason */}
                {isCancelled && hearing.cancellationReason && (
                  <div className="p-3 bg-stone-100 border border-stone-300 rounded-[6px] text-xs text-stone-800">
                    <span className="font-bold">سبب الإلغاء: </span>
                    <span>{hearing.cancellationReason}</span>
                  </div>
                )}

                {/* Action Buttons */}
                {!isReadOnly && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E8EEF1]">
                    {isScheduled && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            openWithFocus(e.currentTarget);
                            setSelectedHearingForRecord(hearing);
                          }}
                          data-testid={`record-result-button-${hearing.id}`}
                          className="px-3.5 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[38px] flex items-center gap-1.5"
                        >
                          <span>⚖️</span>
                          <span>تسجيل النتيجة</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            openWithFocus(e.currentTarget);
                            setSelectedHearingForReschedule(hearing);
                          }}
                          data-testid={`reschedule-hearing-button-${hearing.id}`}
                          className="px-3 py-1.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[38px] flex items-center gap-1"
                        >
                          <span>🔄</span>
                          <span>تعديل الموعد</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            openWithFocus(e.currentTarget);
                            setSelectedHearingForCancel(hearing);
                          }}
                          data-testid={`cancel-hearing-button-${hearing.id}`}
                          className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold rounded-[6px] border border-red-200 transition-colors min-h-[38px] flex items-center gap-1"
                        >
                          <span>🚫</span>
                          <span>إلغاء</span>
                        </button>
                      </>
                    )}

                    {isCompleted && (
                      <button
                        type="button"
                        onClick={(e) => {
                          openWithFocus(e.currentTarget);
                          setSelectedHearingForCorrect(hearing);
                        }}
                        data-testid={`correct-result-button-${hearing.id}`}
                        className="px-3 py-1.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[38px] flex items-center gap-1"
                      >
                        <span>✏️</span>
                        <span>تصحيح منطوق القرار</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showScheduleModal && (
        <ScheduleHearingModal
          isOpen={showScheduleModal}
          onClose={() => closeAndRestoreFocus(() => setShowScheduleModal(false))}
          proceedingId={proceedingId}
          defaultCourtName={courtName}
          defaultCircuit={circuit}
          onSuccess={handleScheduleSuccess}
        />
      )}

      {selectedHearingForRecord && (
        <RecordResultModal
          isOpen={Boolean(selectedHearingForRecord)}
          onClose={() => closeAndRestoreFocus(() => setSelectedHearingForRecord(null))}
          hearing={selectedHearingForRecord}
          proceedingCourtName={courtName}
          proceedingCircuit={circuit}
          onSuccess={handleUpdateHearingSuccess}
        />
      )}

      {selectedHearingForReschedule && (
        <RescheduleHearingModal
          isOpen={Boolean(selectedHearingForReschedule)}
          onClose={() => closeAndRestoreFocus(() => setSelectedHearingForReschedule(null))}
          hearing={selectedHearingForReschedule}
          onSuccess={handleRescheduleSuccess}
        />
      )}

      {selectedHearingForCancel && (
        <CancelHearingModal
          isOpen={Boolean(selectedHearingForCancel)}
          onClose={() => closeAndRestoreFocus(() => setSelectedHearingForCancel(null))}
          hearing={selectedHearingForCancel}
          onSuccess={handleUpdateHearingSuccess}
        />
      )}

      {selectedHearingForCorrect && (
        <CorrectResultModal
          isOpen={Boolean(selectedHearingForCorrect)}
          onClose={() => closeAndRestoreFocus(() => setSelectedHearingForCorrect(null))}
          hearing={selectedHearingForCorrect}
          onSuccess={handleUpdateHearingSuccess}
        />
      )}
    </div>
  );
}
