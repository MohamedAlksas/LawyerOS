'use client';

import React, { useLayoutEffect, useState, useRef } from 'react';
import { useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { generateClientRequestId, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';
import { addCommunicationNoteAction } from '@/modules/parties/actions';
import {
  CommunicationChannel,
  CommunicationNoteSummaryDTO,
  AddCommunicationNoteInput,
} from '@/modules/parties/types';
import {
  COMMUNICATION_CHANNEL_LABELS,
  formatCairoDateTime,
  formatCairoDateOnly,
  getCairoCurrentWallTime,
  cairoWallTimeToUtcIso,
} from './party-types';

interface CommunicationNotesSectionProps {
  ownerId: string;
  partyId: string;
  initialNotes: CommunicationNoteSummaryDTO[];
  readOnly?: boolean;
}

type PendingNote = { wallTime: string; payload: AddCommunicationNoteInput };

export function CommunicationNotesSection({
  ownerId,
  partyId,
  initialNotes,
  readOnly = false,
}: CommunicationNotesSectionProps) {
  const draft = useFormDraft<PendingNote>(`${ownerId}:communication`, `/parties/${partyId}`);
  const editable = useFormDraft<PendingNote>(`${ownerId}:communication-editable`, `/parties/${partyId}`);
  const restored = readOnly ? undefined : draft.restored ?? editable.restored;
  const [pending, setPending] = useState<PendingNote | null>((readOnly ? undefined : draft.restored) ?? null);
  const [notes, setNotes] = useState<CommunicationNoteSummaryDTO[]>(initialNotes);
  const [isFormOpen, setIsFormOpen] = useState(Boolean(restored));

  // Form inputs — initialized to current Cairo office wall-clock time
  const [communicationAt, setCommunicationAt] = useState<string>(() => {
    return restored?.wallTime ?? getCairoCurrentWallTime();
  });
  const [channel, setChannel] = useState<CommunicationChannel>(restored?.payload.channel ?? 'PHONE');
  const [summary, setSummary] = useState(restored?.payload.summary ?? '');
  const [followUpRequired, setFollowUpRequired] = useState(restored?.payload.followUpRequired ?? false);
  const [followUpDate, setFollowUpDate] = useState(restored?.payload.followUpDate ?? '');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const savingRef = useRef(false);
  const [communicationAtEdited, setCommunicationAtEdited] = useState(Boolean(editable.restored));
  const dirty = !readOnly && isFormOpen && Boolean(communicationAtEdited || summary || followUpRequired || followUpDate || channel !== 'PHONE');
  useLeaveGuard(dirty, isSubmitting || Boolean(pending));
  useLayoutEffect(() => {
    if (readOnly || !draft.isCurrent()) return;
    if (!dirty) editable.clear();
    else if (!pending) editable.keep({ wallTime: communicationAt, payload: {
      partyId, communicationAt: '', channel, summary, followUpRequired, followUpDate, idempotencyKey: '',
    } });
  });

  const closeForm = () => {
    if (dirty && !window.confirm('هل تريد تجاهل الملاحظة غير المحفوظة؟')) return;
    setSummary('');
    setChannel('PHONE');
    setFollowUpRequired(false);
    setFollowUpDate('');
    setCommunicationAtEdited(false);
    setError(null);
    setSessionExpired(false);
    setIsFormOpen(false);
    editable.clear();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current || !draft.isCurrent()) return;
    setError(null);
    setSessionExpired(false);

    let operation = pending;
    if (!operation) {
      if (!summary.trim() || !communicationAt) {
        setError(summary.trim() ? 'تاريخ وتوقيت التواصل مطلوب.' : 'ملخص التواصل مطلوب.');
        return;
      }
      try {
        operation = {
          wallTime: communicationAt,
          payload: {
            partyId,
            communicationAt: cairoWallTimeToUtcIso(communicationAt),
            channel,
            summary: summary.trim(),
            followUpRequired,
            followUpDate: followUpRequired && followUpDate ? followUpDate : null,
            idempotencyKey: generateClientRequestId('note'),
          },
        };
      } catch (error) {
        setError(error instanceof Error ? error.message : 'صيغة تاريخ أو وقت التواصل غير صالحة.');
        return;
      }
    }

    savingRef.current = true;
    setIsSubmitting(true);
    setPending(operation);
    draft.keep(operation);
    try {
      const result = await addCommunicationNoteAction(operation.payload);
      if (!draft.isCurrent()) return;

      if (!result.success) {
        if (['VALIDATION_ERROR', 'CONCURRENCY_CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'IDEMPOTENCY_PAYLOAD_MISMATCH'].includes(result.code ?? '')) {
          setPending(null);
          draft.clear();
        }
        const expired = isAuthRecoveryCode(result.code);
        setSessionExpired(expired);
        setError(expired
          ? 'انتهت الجلسة أو يلزم استكمال التحقق. سجّل الدخول في نافذة جديدة ثم أعد محاولة الحفظ الأصلي.'
          : result.error || 'تعذر حفظ ملاحظة التواصل.');
        return;
      }

      setNotes((prev) => [result.data, ...prev.filter((note) => note.id !== result.data.id)]);
      setSessionExpired(false);

      setCommunicationAt(getCairoCurrentWallTime());
      setCommunicationAtEdited(false);
      setSummary('');
      setChannel('PHONE');
      setFollowUpRequired(false);
      setFollowUpDate('');
      setIsFormOpen(false);
      setPending(null);
      draft.clear();
    } catch {
      if (draft.isCurrent()) setError('تعذر تأكيد الحفظ. يمكنك إعادة محاولة الحفظ الأصلي.');
    } finally {
      savingRef.current = false;
      if (draft.isCurrent()) setIsSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="communication-notes-heading"
      data-testid="communication-notes-section"
      className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 space-y-4 shadow-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#E8EEF1]">
        <div>
          <h2 id="communication-notes-heading" className="text-lg font-bold text-[#172A35]">
            سجل التواصل والملاحظات
          </h2>
          <p className="text-xs text-[#4D606A] mt-0.5">
            توثيق الاتصالات الهاتفية، والمقابلات، والمتابعات القضائية بتوقيت القاهرة
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            data-testid="add-note-button"
            disabled={isSubmitting || Boolean(pending)}
            onClick={() => {
              if (isFormOpen) {
                closeForm();
              } else {
                setCommunicationAt(getCairoCurrentWallTime());
                setIsFormOpen(true);
              }
            }}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#E8EEF1] hover:bg-[#D5DFE3] text-[#14566B] rounded-[6px] transition-colors min-h-[44px]"
          >
            <span>{isFormOpen ? 'إلغاء الإضافة' : '＋ إضافة ملاحظة تواصل'}</span>
          </button>
        )}
      </div>

      {/* Add Note Form */}
      {!readOnly && isFormOpen && (
        <form
          onSubmit={handleSubmit}
          data-testid="add-note-form"
          className="p-4 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] space-y-4"
        >
          <h3 className="text-sm font-bold text-[#172A35]">تسجيل تواصل جديد</h3>

          {error && (
            <div
              role="alert"
              data-testid="note-form-error"
              className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-[#A4262C]"
            >
              {error}
            </div>
          )}

          <fieldset disabled={isSubmitting || Boolean(pending)} className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="communicationAt" className="block text-xs font-semibold text-[#172A35] mb-1">
                تاريخ وتوقيت التواصل <span className="text-red-600">*</span>
              </label>
              <input
                id="communicationAt"
                data-testid="note-date-input"
                type="datetime-local"
                required
                value={communicationAt}
                onChange={(e) => {
                  setCommunicationAt(e.target.value);
                  setCommunicationAtEdited(true);
                }}
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-xs bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>

            <div>
              <label htmlFor="channel" className="block text-xs font-semibold text-[#172A35] mb-1">
                قناة التواصل <span className="text-red-600">*</span>
              </label>
              <select
                id="channel"
                data-testid="note-channel-select"
                value={channel}
                onChange={(e) => setChannel(e.target.value as CommunicationChannel)}
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-xs bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="PHONE">{COMMUNICATION_CHANNEL_LABELS.PHONE}</option>
                <option value="IN_PERSON">{COMMUNICATION_CHANNEL_LABELS.IN_PERSON}</option>
                <option value="WHATSAPP">{COMMUNICATION_CHANNEL_LABELS.WHATSAPP}</option>
                <option value="EMAIL">{COMMUNICATION_CHANNEL_LABELS.EMAIL}</option>
                <option value="OTHER">{COMMUNICATION_CHANNEL_LABELS.OTHER}</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="summary" className="block text-xs font-semibold text-[#172A35] mb-1">
              ملخص المحادثة / الإجراء <span className="text-red-600">*</span>
            </label>
            <textarea
              id="summary"
              data-testid="note-summary-input"
              rows={3}
              required
              maxLength={1000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="اكتب تفاصيل الاتصال، ما تم الاتفاق عليه، أو التوجيهات القانونية..."
              className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-xs bg-white text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            />
          </div>

          <div className="space-y-2 pt-1 border-t border-[#D5DFE3]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="note-follow-up-checkbox"
                checked={followUpRequired}
                onChange={(e) => setFollowUpRequired(e.target.checked)}
                className="w-4 h-4 text-[#14566B] focus:ring-[#14566B] rounded"
              />
              <span className="text-xs font-medium text-[#172A35]">
                يتطلب هذا التواصل متابعة لاحقة في تاريخ محدد
              </span>
            </label>

            {followUpRequired && (
              <div className="pt-1">
                <label htmlFor="followUpDate" className="block text-xs font-semibold text-[#172A35] mb-1">
                  تاريخ المتابعة المطلوب
                </label>
                <input
                  id="followUpDate"
                  data-testid="note-follow-up-date-input"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="px-3 py-1.5 rounded-[6px] border border-[#A7B9C1] text-xs bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
              </div>
            )}
          </div>
          </fieldset>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {sessionExpired && pending && !isSubmitting && (
              <a
                href="/login"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="note-session-login-link"
                className="min-h-[44px] inline-flex items-center px-3 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252]"
              >
                فتح شاشة تسجيل الدخول في نافذة جديدة ↗
              </a>
            )}
            <button
              type="button"
              onClick={closeForm}
              disabled={isSubmitting || Boolean(pending)}
              className="px-4 py-2 text-xs font-medium text-[#4D606A] hover:bg-slate-200 rounded min-h-[44px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              data-testid="save-note-button"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-xs font-bold rounded min-h-[44px]"
            >
              {isSubmitting ? 'جارٍ الحفظ...' : pending ? 'إعادة محاولة الحفظ الأصلي' : 'حفظ الملاحظة'}
            </button>
          </div>
        </form>
      )}

      {/* Notes Timeline List */}
      <div data-testid="communication-notes-list" className="space-y-3 pt-1">
        {notes.length === 0 ? (
          <p className="text-xs text-[#4D606A] text-center py-6 bg-[#F9FBFC] rounded border border-dashed border-[#D5DFE3]">
            لا توجد ملاحظات تواصل مسجلة لهذا الطرف حتى الآن.
          </p>
        ) : (
          notes.map((note) => (
            <article
              key={note.id}
              data-testid="communication-note-item"
              className="p-3.5 bg-[#F9FBFC] hover:bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] space-y-2 transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-[#E8EEF1] text-[#14566B]">
                    {COMMUNICATION_CHANNEL_LABELS[note.channel]}
                  </span>
                  {note.followUpRequired && (
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                      مطلوب متابعة
                      {note.followUpDate ? ` في ${formatCairoDateOnly(note.followUpDate)}` : ''}
                    </span>
                  )}
                </div>

                <time
                  dateTime={note.communicationAt}
                  data-testid="note-cairo-timestamp"
                  className="text-xs text-[#4D606A]"
                >
                  {formatCairoDateTime(note.communicationAt)}
                </time>
              </div>

              <p className="text-sm text-[#172A35] leading-relaxed whitespace-pre-wrap">
                {note.summary}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
