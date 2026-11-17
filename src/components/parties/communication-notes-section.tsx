'use client';

import React, { useState, useRef } from 'react';
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
  partyId: string;
  initialNotes: CommunicationNoteSummaryDTO[];
}

export function CommunicationNotesSection({
  partyId,
  initialNotes,
}: CommunicationNotesSectionProps) {
  const [notes, setNotes] = useState<CommunicationNoteSummaryDTO[]>(initialNotes);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Form inputs — initialized to current Cairo office wall-clock time
  const [communicationAt, setCommunicationAt] = useState<string>(() => {
    return getCairoCurrentWallTime();
  });
  const [channel, setChannel] = useState<CommunicationChannel>('PHONE');
  const [summary, setSummary] = useState('');
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);

  const getIdempotencyKey = (): string => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `note-idemp-${Date.now()}`;
    }
    return idempotencyKeyRef.current;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!summary.trim()) {
      setError('ملخص التواصل مطلوب.');
      return;
    }

    if (!communicationAt) {
      setError('تاريخ وتوقيت التواصل مطلوب.');
      return;
    }

    setIsSubmitting(true);

    let isoInstant: string;
    try {
      // Explicitly convert Cairo wall-clock time to UTC ISO instant
      isoInstant = cairoWallTimeToUtcIso(communicationAt);
    } catch {
      setError('صيغة تاريخ أو وقت التواصل غير صالحة.');
      setIsSubmitting(false);
      return;
    }

    const payload: AddCommunicationNoteInput = {
      partyId,
      communicationAt: isoInstant,
      channel,
      summary: summary.trim(),
      followUpRequired,
      followUpDate: followUpRequired && followUpDate ? followUpDate : null,
      idempotencyKey: getIdempotencyKey(),
    };

    try {
      const result = await addCommunicationNoteAction(payload);

      if (!result.success) {
        setError(result.error || 'تعذر حفظ ملاحظة التواصل.');
        setIsSubmitting(false);
        return;
      }

      // Prepend to notes list
      setNotes((prev) => [result.data, ...prev]);

      // Reset form and clear idempotency key for next note
      setCommunicationAt(getCairoCurrentWallTime());
      setSummary('');
      setFollowUpRequired(false);
      setFollowUpDate('');
      setIsFormOpen(false);
      idempotencyKeyRef.current = null;
      setIsSubmitting(false);
    } catch {
      setError('حدث خطأ في الاتصال أثناء حفظ الملاحظة.');
      setIsSubmitting(false);
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

        <button
          type="button"
          data-testid="add-note-button"
          onClick={() => {
            setIsFormOpen((prev) => {
              if (!prev) {
                setCommunicationAt(getCairoCurrentWallTime());
              }
              return !prev;
            });
          }}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#E8EEF1] hover:bg-[#D5DFE3] text-[#14566B] rounded-[6px] transition-colors min-h-[44px]"
        >
          <span>{isFormOpen ? 'إلغاء الإضافة' : '＋ إضافة ملاحظة تواصل'}</span>
        </button>
      </div>

      {/* Add Note Form */}
      {isFormOpen && (
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
                onChange={(e) => setCommunicationAt(e.target.value)}
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

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
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
              {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ الملاحظة'}
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
