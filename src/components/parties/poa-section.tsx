'use client';

import React, { useState, useLayoutEffect, useRef } from 'react';
import { savePowerOfAttorneyAction } from '@/modules/parties/actions';
import { useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { isAuthRecoveryCode } from '@/components/matters/matter-ui-types';
import {
  PoAType,
  PoAReviewStatus,
  PoASummaryDTO,
  SavePowerOfAttorneyInput,
} from '@/modules/parties/types';
import {
  POA_TYPE_LABELS,
  POA_REVIEW_STATUS_CONFIG,
  formatCairoDateOnly,
} from './party-types';

interface PoaSectionProps {
  ownerId: string;
  partyId: string;
  initialPoas: PoASummaryDTO[];
  readOnly?: boolean;
}

interface PoaDraft {
  editing: Pick<PoASummaryDTO, 'id' | 'version'> | null;
  poaNumberText: string;
  poaYearLabel: string;
  notarizationOffice: string;
  poaType: PoAType;
  issueDate: string;
  humanReviewStatus: PoAReviewStatus;
  notes: string;
  pending: SavePowerOfAttorneyInput | null;
}

export function PoaSection({ ownerId, partyId, initialPoas, readOnly = false }: PoaSectionProps) {
  const draft = useFormDraft<PoaDraft>(ownerId, `/parties/${partyId}`);
  const restored = readOnly ? undefined : draft.restored;
  const [poas, setPoas] = useState<PoASummaryDTO[]>(initialPoas);
  const [isFormOpen, setIsFormOpen] = useState(Boolean(restored));
  const [isDirty, setIsDirty] = useState(Boolean(restored));
  const [editing, setEditing] = useState<PoaDraft['editing']>(restored?.editing ?? null);

  // Form inputs
  const [poaNumberText, setPoaNumberText] = useState(restored?.poaNumberText ?? '');
  const [poaYearLabel, setPoaYearLabel] = useState(restored?.poaYearLabel ?? '');
  const [notarizationOffice, setNotarizationOffice] = useState(restored?.notarizationOffice ?? '');
  const [poaType, setPoaType] = useState<PoAType>(restored?.poaType ?? 'LITIGATION');
  const [issueDate, setIssueDate] = useState(restored?.issueDate ?? '');
  const [humanReviewStatus, setHumanReviewStatus] = useState<PoAReviewStatus>(restored?.humanReviewStatus ?? 'UNREVIEWED');
  const [notes, setNotes] = useState(restored?.notes ?? '');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const idempotencyKeyRef = useRef<string | null>(null);
  const [pending, setPending] = useState<SavePowerOfAttorneyInput | null>(restored?.pending ?? null);
  const fields = { editing, poaNumberText, poaYearLabel, notarizationOffice, poaType, issueDate, humanReviewStatus, notes };
  useLayoutEffect(() => {
    if (readOnly || !draft.isCurrent()) return;
    if (isFormOpen && (isDirty || pending)) draft.keep({ ...fields, pending });
    else draft.clear();
  });
  useLeaveGuard(!readOnly && isFormOpen && isDirty, !readOnly && (isSubmitting || Boolean(pending)));

  const getIdempotencyKey = (): string => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `poa-idemp-${Date.now()}`;
    }
    return idempotencyKeyRef.current;
  };

  const openForm = (record: PoASummaryDTO | null) => {
    setEditing(record ? { id: record.id, version: record.version } : null);
    setIsDirty(false);
    setPoaNumberText(record?.poaNumberText ?? '');
    setPoaYearLabel(record?.poaYearLabel ?? new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Africa/Cairo' }).format());
    setNotarizationOffice(record?.notarizationOffice ?? '');
    setPoaType(record?.poaType ?? 'LITIGATION');
    setIssueDate(record?.issueDate ?? '');
    setHumanReviewStatus(record?.humanReviewStatus ?? 'UNREVIEWED');
    setNotes(record?.notes ?? '');
    setError(null);
    setSessionExpired(false);
    idempotencyKeyRef.current = null;
    setPending(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSubmitting || pending) return;
    if (isDirty && !window.confirm('لديك تغييرات غير محفوظة على التوكيل. هل تريد الإغلاق وفقدانها؟')) {
      return;
    }
    setEditing(null);
    setIsDirty(false);
    setPoaNumberText('');
    setPoaYearLabel('');
    setNotarizationOffice('');
    setPoaType('LITIGATION');
    setIssueDate('');
    setHumanReviewStatus('UNREVIEWED');
    setNotes('');
    setError(null);
    setSessionExpired(false);
    idempotencyKeyRef.current = null;
    setPending(null);
    setIsFormOpen(false);
    draft.clear();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !draft.isCurrent()) return;
    setError(null);
    setSessionExpired(false);

    if (!poaNumberText.trim()) {
      setError('رقم التوكيل مطلوب.');
      return;
    }

    if (!poaYearLabel.trim()) {
      setError('سنة التوكيل مطلوبة.');
      return;
    }

    if (!notarizationOffice.trim()) {
      setError('مكتب التوثيق (الشهر العقاري) مطلوب.');
      return;
    }

    setIsSubmitting(true);

    const payload: SavePowerOfAttorneyInput = pending ?? {
      partyId,
      ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}),
      poaNumberText: poaNumberText.trim(),
      poaYearLabel: poaYearLabel.trim(),
      notarizationOffice: notarizationOffice.trim(),
      poaType,
      issueDate: issueDate ? issueDate : null,
      humanReviewStatus,
      notes: notes.trim() || null,
      idempotencyKey: getIdempotencyKey(),
    };
    setPending(payload);
    draft.keep({ ...fields, pending: payload });

    try {
      const result = await savePowerOfAttorneyAction(payload);

      if (!draft.isCurrent()) {
        setIsSubmitting(false);
        return;
      }

      if (!result.success) {
        if (isAuthRecoveryCode(result.code)) {
          setPending(payload);
          setSessionExpired(true);
          setError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. يرجى تسجيل الدخول في نافذة جديدة ثم إعادة محاولة الحفظ الأصلي.');
        } else {
          setError(result.error || 'تعذر حفظ التوكيل.');
          if (!result.code || result.code === 'INTERNAL_ERROR' || result.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT') {
            setPending(payload);
          } else {
            setPending(null);
            idempotencyKeyRef.current = null;
          }
        }
        setIsSubmitting(false);
        return;
      }

      setSessionExpired(false);

      setPoas((prev) => {
        if (prev.some((record) => record.id === result.data.id)) {
          return prev.map((record) => record.id === result.data.id ? result.data : record);
        }
        return [result.data, ...prev];
      });
      setPending(null);
      draft.clear();

      // Reset form and clear idempotency key
      setEditing(null);
      setIsDirty(false);
      setPoaNumberText('');
      setNotarizationOffice('');
      setPoaType('LITIGATION');
      setNotes('');
      setIssueDate('');
      setHumanReviewStatus('UNREVIEWED');
      setIsFormOpen(false);
      idempotencyKeyRef.current = null;
      setIsSubmitting(false);
    } catch {
      setPending(payload);
      setError('تعذر تأكيد الحفظ. أعد المحاولة بنفس البيانات.');
      setIsSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="poa-heading"
      data-testid="poa-section"
      className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 space-y-4 shadow-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#E8EEF1]">
        <div>
          <h2 id="poa-heading" className="text-lg font-bold text-[#172A35]">
            سجلات التوكيلات الرسمية
          </h2>
          <p className="text-xs text-[#4D606A] mt-0.5">
            توثيق أرقام وسنوات ومكاتب الشهر العقاري وحالات المراجعة البشرية المعتمدة
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            data-testid="add-poa-button"
            onClick={() => (isFormOpen ? closeForm() : openForm(null))}
            disabled={isSubmitting || !!pending}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#E8EEF1] hover:bg-[#D5DFE3] text-[#14566B] rounded-[6px] transition-colors min-h-[44px]"
          >
            <span>{isFormOpen ? 'إلغاء' : '＋ إضافة توكيل رسمي'}</span>
          </button>
        )}
      </div>

      {/* Add POA Form */}
      {!readOnly && isFormOpen && (
        <form
          onSubmit={handleSubmit}
          onChange={() => setIsDirty(true)}
          data-testid="add-poa-form"
          className="p-4 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] space-y-4"
        >
          <h3 className="text-sm font-bold text-[#172A35]">{editing ? 'تعديل بيانات التوكيل ومراجعته' : 'تسجيل توكيل رسمي جديد'}</h3>

          <fieldset disabled={isSubmitting || !!pending} className="min-w-0 space-y-4">
          {error && (
            <div
              role="alert"
              data-testid="poa-form-error"
              className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-[#A4262C]"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="poaNumberText" className="block text-xs font-semibold text-[#172A35] mb-1">
                رقم التوكيل (مع الأصفار) <span className="text-red-600">*</span>
              </label>
              <input
                id="poaNumberText"
                data-testid="poa-number-input"
                type="text"
                required
                value={poaNumberText}
                onChange={(e) => setPoaNumberText(e.target.value)}
                placeholder="0045"
                dir="ltr"
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-base sm:text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right font-mono"
              />
            </div>

            <div>
              <label htmlFor="poaYearLabel" className="block text-xs font-semibold text-[#172A35] mb-1">
                سنة التوكيل <span className="text-red-600">*</span>
              </label>
              <input
                id="poaYearLabel"
                data-testid="poa-year-input"
                type="text"
                required
                value={poaYearLabel}
                onChange={(e) => setPoaYearLabel(e.target.value)}
                placeholder="2026"
                dir="ltr"
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-base sm:text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right font-mono"
              />
            </div>

            <div>
              <label htmlFor="poaType" className="block text-xs font-semibold text-[#172A35] mb-1">
                نوع التوكيل <span className="text-red-600">*</span>
              </label>
              <select
                id="poaType"
                data-testid="poa-type-select"
                value={poaType}
                onChange={(e) => setPoaType(e.target.value as PoAType)}
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-base sm:text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="GENERAL">{POA_TYPE_LABELS.GENERAL}</option>
                <option value="SPECIAL">{POA_TYPE_LABELS.SPECIAL}</option>
                <option value="LITIGATION">{POA_TYPE_LABELS.LITIGATION}</option>
                <option value="COMMERCIAL">{POA_TYPE_LABELS.COMMERCIAL}</option>
                <option value="OTHER">{POA_TYPE_LABELS.OTHER}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="notarizationOffice" className="block text-xs font-semibold text-[#172A35] mb-1">
                مكتب التوثيق (الشهر العقاري) <span className="text-red-600">*</span>
              </label>
              <input
                id="notarizationOffice"
                data-testid="poa-office-input"
                type="text"
                required
                value={notarizationOffice}
                onChange={(e) => setNotarizationOffice(e.target.value)}
                placeholder="مثال: مكتب توثيق الأهرام النموذجي"
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-base sm:text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>

            <div>
              <label htmlFor="issueDate" className="block text-xs font-semibold text-[#172A35] mb-1">
                تاريخ الإصدار (اختياري)
              </label>
              <input
                id="issueDate"
                data-testid="poa-date-input"
                type="date"
                dir="ltr"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-base sm:text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="humanReviewStatus" className="block text-xs font-semibold text-[#172A35] mb-1">
                حالة الفحص والمراجعة البشرية <span className="text-red-600">*</span>
              </label>
              <select
                id="humanReviewStatus"
                data-testid="poa-status-select"
                value={humanReviewStatus}
                onChange={(e) => setHumanReviewStatus(e.target.value as PoAReviewStatus)}
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-base sm:text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="UNREVIEWED">{POA_REVIEW_STATUS_CONFIG.UNREVIEWED.label}</option>
                <option value="VALID">{POA_REVIEW_STATUS_CONFIG.VALID.label}</option>
                <option value="EXPIRED">{POA_REVIEW_STATUS_CONFIG.EXPIRED.label}</option>
                <option value="REVOKED">{POA_REVIEW_STATUS_CONFIG.REVOKED.label}</option>
                <option value="DEFECTIVE">{POA_REVIEW_STATUS_CONFIG.DEFECTIVE.label}</option>
              </select>
              <p className="text-[11px] text-[#4D606A] mt-1">
                {POA_REVIEW_STATUS_CONFIG[humanReviewStatus].description}
              </p>
            </div>

            <div>
              <label htmlFor="poaNotes" className="block text-xs font-semibold text-[#172A35] mb-1">
                ملاحظات حول التوكيل (اختياري)
              </label>
              <input
                id="poaNotes"
                data-testid="poa-notes-input"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="حدود الوكالة، أية شروط خاصة، رقم الحفظ..."
                className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-base sm:text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#D5DFE3]">
            <button
              type="button"
              disabled={isSubmitting || !!pending}
              onClick={closeForm}
              className="px-4 py-2 text-xs font-medium text-[#4D606A] hover:bg-slate-200 rounded min-h-[44px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              data-testid="save-poa-button"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-xs font-bold rounded min-h-[44px]"
            >
              {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ بيانات التوكيل'}
            </button>
          </div>
          </fieldset>
          {pending && !isSubmitting && (
            <div className="flex flex-wrap items-center gap-3">
              {sessionExpired && (
                <a
                  href="/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="poa-session-login-link"
                  className="min-h-[44px] inline-flex items-center px-3 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252]"
                >
                  فتح شاشة تسجيل الدخول في نافذة جديدة ↗
                </a>
              )}
              <button type="submit" className="min-h-[44px] px-3 font-semibold text-[#14566B]">إعادة محاولة الحفظ</button>
            </div>
          )}
        </form>
      )}

      {/* POAs List */}
      <div data-testid="poa-list" className="space-y-3 pt-1">
        {poas.length === 0 ? (
          <p className="text-xs text-[#4D606A] text-center py-6 bg-[#F9FBFC] rounded border border-dashed border-[#D5DFE3]">
            لا توجد توكيلات رسمية مسجلة لهذا الطرف حتى الآن.
          </p>
        ) : (
          poas.map((poa) => {
            const statusConfig = POA_REVIEW_STATUS_CONFIG[poa.humanReviewStatus];
            return (
              <article
                key={poa.id}
                data-testid="poa-item"
                className="p-4 bg-[#F9FBFC] hover:bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] space-y-2 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#172A35]">
                        توكيل رقم <bdi dir="ltr" className="font-mono">{poa.poaNumberText}</bdi> لسنة{' '}
                        <bdi dir="ltr" className="font-mono">{poa.poaYearLabel}</bdi>
                      </span>
                      <span className="text-xs text-[#4D606A]">({POA_TYPE_LABELS[poa.poaType]})</span>
                    </div>

                    <div className="text-xs text-[#4D606A] mt-1">
                      <span>مكتب التوثيق: </span>
                      <span className="font-medium text-[#172A35]">{poa.notarizationOffice}</span>
                      {poa.issueDate && (
                        <span className="mr-3">
                          تاريخ الإصدار: {formatCairoDateOnly(poa.issueDate)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span
                      data-testid="poa-review-status-badge"
                      className={`inline-block px-2.5 py-1 rounded text-xs font-bold border ${statusConfig.badgeClass}`}
                    >
                      {statusConfig.label}
                    </span>
                    {!readOnly && (
                      <button type="button" onClick={() => openForm(poa)} disabled={isFormOpen}
                        className="mr-2 min-h-[44px] px-2 text-sm font-semibold text-[#14566B] disabled:opacity-50">
                        تعديل التوكيل
                      </button>
                    )}
                  </div>
                </div>

                {poa.notes && (
                  <p className="text-xs text-[#4D606A] pt-1 border-t border-[#E8EEF1] leading-relaxed">
                    ملاحظات: {poa.notes}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
