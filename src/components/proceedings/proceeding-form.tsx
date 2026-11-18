'use client';

import React, { useState, useId, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addProceedingAction,
  updateProceedingAction,
  linkProceedingPartyAction,
} from '@/modules/matters/matter-actions';
import {
  MatterDTO,
  ProceedingSummaryDTO,
  ProceedingPartySummaryDTO,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
  AddProceedingInput,
  UpdateProceedingInput,
} from '@/modules/matters/matter-types';
import {
  PROCEEDING_INSTANCE_LABELS,
  PROCEEDING_LEGAL_CAPACITY_LABELS,
  generateClientRequestId,
} from '../matters/matter-ui-types';

interface PartyCapacityState {
  legalCapacity: ProceedingLegalCapacity;
  capacityText: string;
}

interface CourtOption {
  id: string;
  name: string;
}

interface ProceedingFormProps {
  matter: MatterDTO;
  courts: CourtOption[];
  initialProceeding?: ProceedingSummaryDTO;
}

export function ProceedingForm({
  matter,
  courts,
  initialProceeding,
}: ProceedingFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialProceeding);

  // Form State
  const [courtId, setCourtId] = useState(initialProceeding?.courtId || '');
  const [instance, setInstance] = useState<ProceedingInstance>(
    initialProceeding?.instance || 'FIRST_INSTANCE'
  );
  const [parentProceedingId, setParentProceedingId] = useState<string>(
    initialProceeding?.parentProceedingId || ''
  );
  const [numberText, setNumberText] = useState(initialProceeding?.numberText || '');
  const [yearLabel, setYearLabel] = useState(
    initialProceeding?.yearLabel || new Date().getFullYear().toString()
  );
  const [registerType, setRegisterType] = useState(initialProceeding?.registerType || '');
  const [circuit, setCircuit] = useState(initialProceeding?.circuit || '');
  const [filingDate, setFilingDate] = useState(initialProceeding?.filingDate || '');
  const [claimAmount, setClaimAmount] = useState(initialProceeding?.claimAmount || '');
  const [status, setStatus] = useState<ProceedingStatus>(
    initialProceeding?.status || 'ACTIVE'
  );

  // Legal Capacities per matter party (storing both legalCapacity and capacityText)
  const [partyCapacities, setPartyCapacities] = useState<Record<string, PartyCapacityState>>(() => {
    const initial: Record<string, PartyCapacityState> = {};
    const existingPartiesMap = new Map<string, ProceedingPartySummaryDTO>();
    if (initialProceeding?.parties) {
      for (const p of initialProceeding.parties) {
        existingPartiesMap.set(p.matterPartyId, p);
      }
    }

    for (const mp of matter.parties || []) {
      const existing = existingPartiesMap.get(mp.id);
      if (existing) {
        initial[mp.id] = {
          legalCapacity: existing.legalCapacity ?? 'OTHER',
          capacityText: existing.capacityText ?? '',
        };
      } else {
        // Sensible defaults with notice to verify
        const defaultLegalCapacity: ProceedingLegalCapacity =
          mp.role === 'CLIENT'
            ? instance === 'APPEAL'
              ? 'APPELLEE'
              : 'PLAINTIFF'
            : mp.role === 'OPPONENT'
              ? instance === 'APPEAL'
                ? 'APPELLANT'
                : 'DEFENDANT'
              : 'OTHER';
        const defaultCapacityText =
          defaultLegalCapacity === 'PLAINTIFF'
            ? 'مدعي'
            : defaultLegalCapacity === 'DEFENDANT'
              ? 'مدعى عليه'
              : defaultLegalCapacity === 'APPELLEE'
                ? 'مستأنف ضده'
                : defaultLegalCapacity === 'APPELLANT'
                  ? 'مستأنف'
                  : 'طرف آخر';
        initial[mp.id] = {
          legalCapacity: defaultLegalCapacity,
          capacityText: defaultCapacityText,
        };
      }
    }
    return initial;
  });

  // UI States
  const [isSaving, setIsSaving] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);

  // Stable in-memory Idempotency Key
  const [idempotencyKey] = useState(() => generateClientRequestId('proc'));

  const formId = useId();

  // Potential Parent Proceedings (must be in the same matter, and not self)
  const candidateParents = useMemo(() => {
    return (matter.proceedings || []).filter(
      (p) => !initialProceeding || p.id !== initialProceeding.id
    );
  }, [matter.proceedings, initialProceeding]);

  // Docket Incomplete Check
  const isDocketIncomplete = !numberText.trim() || !yearLabel.trim() || !registerType.trim();

  // Similarity Check: Check if another proceeding in the same matter has the same number & year
  const similarProceeding = useMemo(() => {
    if (!numberText.trim() || !yearLabel.trim()) return null;
    return (matter.proceedings || []).find(
      (p) =>
        (!initialProceeding || p.id !== initialProceeding.id) &&
        p.numberText?.trim() === numberText.trim() &&
        p.yearLabel?.trim() === yearLabel.trim() &&
        (!courtId || p.courtId === courtId)
    );
  }, [matter.proceedings, initialProceeding, numberText, yearLabel, courtId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setGeneralError(null);
    setFieldErrors({});
    setConcurrencyConflict(false);

    // If docket is incomplete, force status to DRAFT
    const finalStatus: ProceedingStatus = isDocketIncomplete ? 'DRAFT' : status;

    try {
      if (isEdit && initialProceeding) {
        const payload: UpdateProceedingInput = {
          id: initialProceeding.id,
          matterId: matter.id,
          expectedVersion: initialProceeding.version,
          courtId,
          instance,
          parentProceedingId: parentProceedingId || null,
          registerType: registerType.trim() || null,
          circuit: circuit.trim() || null,
          numberText: numberText.trim() || null,
          yearLabel: yearLabel.trim() || null,
          filingDate: filingDate || null,
          claimAmount: claimAmount.trim() || null,
          status: finalStatus,
          idempotencyKey,
        };

        const res = await updateProceedingAction(payload);
        if (!res.success) {
          if (res.code === 'CONCURRENCY_CONFLICT') {
            setConcurrencyConflict(true);
          } else {
            setGeneralError(res.error || 'تعذر تعديل بيانات القيد القضائي.');
            if (res.fieldErrors) setFieldErrors(res.fieldErrors);
          }
          setIsSaving(false);
          return;
        }

        // Link / update capacities for all parties
        for (const [matterPartyId, capState] of Object.entries(partyCapacities)) {
          const capRes = await linkProceedingPartyAction({
            proceedingId: initialProceeding.id,
            matterPartyId,
            legalCapacity: capState.legalCapacity,
            capacityText: capState.capacityText.trim() || undefined,
            idempotencyKey: `${idempotencyKey}_cap_${matterPartyId}`,
          });
          if (!capRes.success) {
            setGeneralError(capRes.error || 'تعذر حفظ الصفات القضائية للأطراف.');
            setIsSaving(false);
            return;
          }
        }

        router.push(`/matters/${matter.id}`);
      } else {
        const payload: AddProceedingInput = {
          matterId: matter.id,
          courtId,
          instance,
          parentProceedingId: parentProceedingId || null,
          registerType: registerType.trim() || null,
          circuit: circuit.trim() || null,
          numberText: numberText.trim() || null,
          yearLabel: yearLabel.trim() || null,
          filingDate: filingDate || null,
          claimAmount: claimAmount.trim() || null,
          status: finalStatus,
          idempotencyKey,
        };

        const res = await addProceedingAction(payload);
        if (!res.success) {
          setGeneralError(res.error || 'تعذر تسجيل القيد القضائي.');
          if (res.fieldErrors) setFieldErrors(res.fieldErrors);
          setIsSaving(false);
          return;
        }

        // Link capacities for all parties
        const newProceedingId = res.data.id;
        for (const [matterPartyId, capState] of Object.entries(partyCapacities)) {
          const capRes = await linkProceedingPartyAction({
            proceedingId: newProceedingId,
            matterPartyId,
            legalCapacity: capState.legalCapacity,
            capacityText: capState.capacityText.trim() || undefined,
            idempotencyKey: `${idempotencyKey}_cap_${matterPartyId}`,
          });
          if (!capRes.success) {
            setGeneralError(capRes.error || 'تعذر حفظ الصفات القضائية للأطراف.');
            setIsSaving(false);
            return;
          }
        }

        router.push(`/matters/${matter.id}`);
      }
    } catch (err: unknown) {
      setGeneralError(
        err instanceof Error ? err.message : 'حدث خطأ في الاتصال أثناء حفظ البيانات.'
      );
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-[#D5DFE3]">
        <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] mb-1">
          <Link href="/matters" className="hover:text-[#14566B] hover:underline">
            ملفات القضايا
          </Link>
          <span aria-hidden="true" className="mx-1.5">/</span>
          <Link href={`/matters/${matter.id}`} className="hover:text-[#14566B] hover:underline">
            {matter.title} ({matter.fileCode})
          </Link>
          <span aria-hidden="true" className="mx-1.5">/</span>
          <span>{isEdit ? 'تعديل القيد القضائي' : 'إضافة قيد قضائي جديد'}</span>
        </nav>
        <h1 className="text-2xl font-bold text-[#172A35]">
          {isEdit ? 'تعديل بيانات القيد القضائي' : 'تسجيل قيد قضائي جديد'}
        </h1>
        <p className="text-xs text-[#4D606A] mt-1">
          الملف التابع له: <span className="font-bold text-[#172A35]">{matter.title}</span> (
          <bdi dir="ltr" className="font-mono">{matter.fileCode}</bdi>)
        </p>
      </div>

      {/* Concurrency Alert */}
      {concurrencyConflict && (
        <div
          role="alert"
          data-testid="concurrency-conflict-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-2 text-xs"
        >
          <span className="font-bold block text-sm">⚠️ تعارض في التعديل المتزامن</span>
          <p>تم تعديل هذا القيد من مستخدم آخر أثناء تحريرك. يرجى تحديث الصفحة وإعادة المحاولة.</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="px-3 py-1.5 bg-[#14566B] text-white font-semibold rounded-[6px]"
          >
            تحديث الصفحة
          </button>
        </div>
      )}

      {/* Error Alert */}
      {generalError && (
        <div
          role="alert"
          data-testid="proceeding-error-banner"
          className="p-4 bg-red-50 border border-red-200 rounded-[6px] text-[#A4262C] space-y-1 text-xs"
        >
          <span className="font-bold block text-sm">⚠️ تعذر حفظ القيد القضائي</span>
          <p>{generalError}</p>
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="list-disc list-inside space-y-0.5 mt-2">
              {Object.entries(fieldErrors).map(([field, msg]) => (
                <li key={field}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Similarity Alert (Non-blocking) */}
      {similarProceeding && (
        <div
          role="alert"
          data-testid="similarity-warning-banner"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-1 text-xs shadow-xs"
        >
          <span className="font-bold block text-sm">⚠️ تنبيه تشابه في أرقام القيد القضائي</span>
          <p className="leading-relaxed">
            يوجد بالفعل قيد قضائي مسجل في هذا الملف بنفس رقم الدعوى (
            <bdi dir="ltr" className="font-mono font-bold">{similarProceeding.numberText} لسنة {similarProceeding.yearLabel}</bdi> — {similarProceeding.courtName}
            ). يمكنك متابعة الحفظ بشكل طبيعي إذا كانت هذه دعوى منفصلة (مثل دعوى فرعية أو متقابلة).
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Court & Instance */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
            المحكمة والدرجة القضائية
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Court */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-court`} className="block text-xs font-bold text-[#172A35]">
                المحكمة أو الجهة القضائية <span className="text-red-600">*</span>
              </label>
              <select
                id={`${formId}-court`}
                required
                value={courtId}
                onChange={(e) => setCourtId(e.target.value)}
                data-testid="proceeding-court-select"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="">— اختر المحكمة —</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#4D606A]">
                المحكمة إلزامية حتى في المسودات لتحديد مقر انعقاد الجلسة.
              </p>
            </div>

            {/* Instance */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-instance`} className="block text-xs font-bold text-[#172A35]">
                درجة التقاضي <span className="text-red-600">*</span>
              </label>
              <select
                id={`${formId}-instance`}
                value={instance}
                onChange={(e) => setInstance(e.target.value as ProceedingInstance)}
                data-testid="proceeding-instance-select"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                {(['FIRST_INSTANCE', 'APPEAL', 'CASSATION', 'OTHER'] as ProceedingInstance[]).map((inst) => (
                  <option key={inst} value={inst}>
                    {PROCEEDING_INSTANCE_LABELS[inst]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Parent Proceeding (Appeal linkage) */}
          <div className="space-y-1 pt-2">
            <label htmlFor={`${formId}-parent`} className="block text-xs font-bold text-[#172A35]">
              الدعوى الابتدائية أو القيد السابق المرتبط (اختياري)
            </label>
            <select
              id={`${formId}-parent`}
              value={parentProceedingId}
              onChange={(e) => setParentProceedingId(e.target.value)}
              data-testid="proceeding-parent-select"
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            >
              <option value="">— بدون ارتباط (دعوى مستقلة) —</option>
              {candidateParents.map((cp) => (
                <option key={cp.id} value={cp.id}>
                  {cp.courtName} — {cp.numberText ? `${cp.numberText} لسنة ${cp.yearLabel}` : '(مسودة قيد)'} ({PROCEEDING_INSTANCE_LABELS[cp.instance]})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#4D606A]">
              عند استئناف دعوى، اختر الحكم الابتدائي السابق لربط التسلسل القضائي ومنع الحلقات الدائرية.
            </p>
          </div>
        </div>

        {/* Section 2: Docket Registration Details */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-[#E8EEF1]">
            <h2 className="text-base font-bold text-[#172A35]">
              بيانات القيد ورقم الدعوى
            </h2>
            {isDocketIncomplete ? (
              <span
                data-testid="incomplete-docket-badge"
                className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded border border-amber-300 self-start sm:self-auto"
              >
                الرقم غير مستكمل (مسودة قيد)
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <label htmlFor={`${formId}-status`} className="text-xs font-bold text-[#172A35]">
                  حالة القيد:
                </label>
                <select
                  id={`${formId}-status`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProceedingStatus)}
                  data-testid="proceeding-status-select"
                  className="px-2.5 py-1 text-xs font-semibold bg-white border border-[#D5DFE3] rounded-[6px] text-[#14566B] min-h-[36px] focus:outline-none focus:ring-1 focus:ring-[#14566B]"
                >
                  <option value="ACTIVE">قيد نشط بالمحكمة</option>
                  <option value="DRAFT">مسودة قيد</option>
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Number Text */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-numberText`} className="block text-xs font-bold text-[#172A35]">
                رقم الدعوى بالمحكمة
              </label>
              <input
                id={`${formId}-numberText`}
                type="text"
                value={numberText}
                onChange={(e) => setNumberText(e.target.value)}
                placeholder="مثال: 1234 أو 0045/ب"
                data-testid="proceeding-number-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              <p className="text-[10px] text-[#4D606A]">يحتفظ بالأصفار والحروف</p>
            </div>

            {/* Year Label */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-yearLabel`} className="block text-xs font-bold text-[#172A35]">
                سنة الدعوى القضائية
              </label>
              <input
                id={`${formId}-yearLabel`}
                type="text"
                value={yearLabel}
                onChange={(e) => setYearLabel(e.target.value)}
                placeholder="مثال: 2026 أو 1447هـ"
                data-testid="proceeding-year-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>

            {/* Register / Docket Type */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-registerType`} className="block text-xs font-bold text-[#172A35]">
                نوع الجدول / القيد
              </label>
              <input
                id={`${formId}-registerType`}
                type="text"
                value={registerType}
                onChange={(e) => setRegisterType(e.target.value)}
                placeholder="مثال: مدني كلي، جنح، عمالي"
                data-testid="proceeding-register-type-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Circuit */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-circuit`} className="block text-xs font-bold text-[#172A35]">
                الدائرة القضائية
              </label>
              <input
                id={`${formId}-circuit`}
                type="text"
                value={circuit}
                onChange={(e) => setCircuit(e.target.value)}
                placeholder="مثال: الدائرة 7 إيجارات"
                data-testid="proceeding-circuit-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>

            {/* Filing Date */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-filingDate`} className="block text-xs font-bold text-[#172A35]">
                تاريخ رفع الدعوى
              </label>
              <input
                id={`${formId}-filingDate`}
                type="date"
                value={filingDate}
                onChange={(e) => setFilingDate(e.target.value)}
                data-testid="proceeding-filing-date-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>

            {/* Claim Amount */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-claimAmount`} className="block text-xs font-bold text-[#172A35]">
                قيمة المطالبة (ج.م)
              </label>
              <input
                id={`${formId}-claimAmount`}
                type="text"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder="مثال: 50000"
                data-testid="proceeding-claim-amount-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Legal Capacities in this Proceeding */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <div className="pb-2 border-b border-[#E8EEF1]">
            <h2 className="text-base font-bold text-[#172A35]">
              الصفات القانونية للأطراف في هذا القيد
            </h2>
            <p className="text-xs text-[#4D606A] mt-1 leading-relaxed">
              تحدد صفة كل طرف في هذه الدرجة القضائية (مثلاً: الموكل مدعي أو مستأنف ضده). يجب مراجعة وتأكيد الصفة والمسمى الإجرائي لكل طرف في هذا القيد القضائي قبل الحفظ (لا يتم الاعتماد التلقائي دون مراجعة).
            </p>
          </div>

          {(matter.parties || []).length === 0 ? (
            <p className="text-xs text-[#4D606A] italic">
              لا توجد أطراف مسجلة في هذا الملف بعد لتعيين صفاتهم القضائية.
            </p>
          ) : (
            <div className="space-y-3">
              {(matter.parties || []).map((mp) => {
                const currentCap = partyCapacities[mp.id] || {
                  legalCapacity: 'OTHER' as ProceedingLegalCapacity,
                  capacityText: '',
                };

                return (
                  <div
                    key={mp.id}
                    className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3.5 bg-[#F9FBFC] rounded-[6px] border border-[#E8EEF1] text-xs"
                  >
                    <div className="space-y-0.5 min-w-[140px]">
                      <span className="font-bold text-sm text-[#172A35] block">
                        {mp.partyName}
                      </span>
                      <span className="text-[#4D606A]">
                        صفته بالملف: {mp.role === 'CLIENT' ? 'موكل' : mp.role === 'OPPONENT' ? 'خصم' : 'طرف آخر'}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-lg">
                      <div className="flex items-center gap-1.5 sm:w-1/2">
                        <label htmlFor={`capacity-${mp.id}`} className="font-semibold text-[#172A35] shrink-0">
                          الصفة القانونية:
                        </label>
                        <select
                          id={`capacity-${mp.id}`}
                          value={currentCap.legalCapacity}
                          onChange={(e) =>
                            setPartyCapacities((prev) => ({
                              ...prev,
                              [mp.id]: {
                                ...prev[mp.id],
                                legalCapacity: e.target.value as ProceedingLegalCapacity,
                              },
                            }))
                          }
                          data-testid={`capacity-select-${mp.id}`}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#D5DFE3] rounded-[6px] font-semibold text-[#14566B] min-h-[38px] focus:outline-none focus:ring-1 focus:ring-[#14566B]"
                        >
                          {(['PLAINTIFF', 'DEFENDANT', 'APPELLANT', 'APPELLEE', 'INTERVENOR', 'OTHER'] as ProceedingLegalCapacity[]).map((cap) => (
                            <option key={cap} value={cap}>
                              {PROCEEDING_LEGAL_CAPACITY_LABELS[cap]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1.5 sm:w-1/2">
                        <label htmlFor={`capacity-text-${mp.id}`} className="font-semibold text-[#172A35] shrink-0">
                          المسمى الإجرائي:
                        </label>
                        <input
                          id={`capacity-text-${mp.id}`}
                          type="text"
                          maxLength={100}
                          value={currentCap.capacityText}
                          onChange={(e) =>
                            setPartyCapacities((prev) => ({
                              ...prev,
                              [mp.id]: {
                                ...prev[mp.id],
                                capacityText: e.target.value,
                              },
                            }))
                          }
                          placeholder="مثال: مدعي، بصفته..."
                          data-testid={`capacity-text-${mp.id}`}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] min-h-[38px] focus:outline-none focus:ring-1 focus:ring-[#14566B]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <Link
            href={`/matters/${matter.id}`}
            className="w-full sm:w-auto px-5 py-2.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] text-center min-h-[44px] flex items-center justify-center transition-colors"
          >
            إلغاء والعودة للملف
          </Link>

          <button
            type="submit"
            disabled={isSaving || !courtId}
            data-testid="proceeding-submit-button"
            className="w-full sm:w-auto px-8 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-sm font-bold rounded-[6px] shadow-xs min-h-[44px] flex items-center justify-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            {isSaving ? (
              <span>جارٍ الحفظ...</span>
            ) : isEdit ? (
              <span>حفظ تعديلات القيد</span>
            ) : (
              <span>تسجيل القيد القضائي</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

