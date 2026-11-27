'use client';

import React, { useState, useId, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import NextLink from 'next/link';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { useRouter } from 'next/navigation';
import {
  addProceedingAction,
  updateProceedingAction,
  findSimilarProceedingsAction,
} from '@/modules/matters/matter-actions';
import {
  MatterDTO,
  ProceedingSummaryDTO,
  ProceedingPartySummaryDTO,
  ProceedingPartyInput,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
  AddProceedingInput,
  UpdateProceedingInput,
  SimilarProceedingCandidateDTO,
  hasCompleteProceedingRegistration,
} from '@/modules/matters/matter-types';
import {
  PROCEEDING_INSTANCE_LABELS,
  PROCEEDING_LEGAL_CAPACITY_LABELS,
  generateClientRequestId,
  isAuthRecoveryCode,
} from '../matters/matter-ui-types';

interface PartyCapacityState {
  legalCapacity: ProceedingLegalCapacity | '';
  capacityText: string;
}

interface CourtOption {
  id: string;
  name: string;
  isActive?: boolean;
}

interface ProceedingFormProps {
  ownerId: string;
  matter: MatterDTO;
  courts: CourtOption[];
  initialProceeding?: ProceedingSummaryDTO;
  lookupError?: boolean;
}

type ProceedingOperation = {
  key: string;
  kind: 'create' | 'update';
  payload: AddProceedingInput | UpdateProceedingInput;
};

interface ProceedingDraft {
  courtId: string;
  instance: ProceedingInstance;
  parentProceedingId: string;
  numberText: string;
  yearLabel: string;
  registerType: string;
  circuit: string;
  filingDate: string;
  claimAmount: string;
  status: ProceedingStatus;
  includedPartyIds: Set<string>;
  partyCapacities: Record<string, PartyCapacityState>;
  incompleteDraftAcknowledged: boolean;
  expectedVersion: number | undefined;
  idempotencyKey: string;
  isDirty: boolean;
  operation: ProceedingOperation | null;
}

export function ProceedingForm({
  ownerId,
  matter,
  courts,
  initialProceeding,
  lookupError,
}: ProceedingFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialProceeding);
  const draft = useFormDraft<ProceedingDraft>(
    ownerId, `/matters/${matter.id}/proceedings/${initialProceeding ? `${initialProceeding.id}/edit` : 'new'}`,
  );
  const restored = draft.restored;

  // Form State
  const [courtId, setCourtId] = useState(restored?.courtId ?? initialProceeding?.courtId ?? '');
  const [instance, setInstance] = useState<ProceedingInstance>(
    restored?.instance ?? initialProceeding?.instance ?? 'FIRST_INSTANCE'
  );
  const [parentProceedingId, setParentProceedingId] = useState<string>(
    restored?.parentProceedingId ?? initialProceeding?.parentProceedingId ?? ''
  );
  const [numberText, setNumberText] = useState(restored?.numberText ?? initialProceeding?.numberText ?? '');
  const [yearLabel, setYearLabel] = useState(restored?.yearLabel ?? initialProceeding?.yearLabel ?? '');
  const [registerType, setRegisterType] = useState(restored?.registerType ?? initialProceeding?.registerType ?? '');
  const [circuit, setCircuit] = useState(restored?.circuit ?? initialProceeding?.circuit ?? '');
  const [filingDate, setFilingDate] = useState(restored?.filingDate ?? initialProceeding?.filingDate ?? '');
  const [claimAmount, setClaimAmount] = useState(restored?.claimAmount ?? initialProceeding?.claimAmount ?? '');
  const [status, setStatus] = useState<ProceedingStatus>(
    restored?.status ?? initialProceeding?.status ?? 'DRAFT'
  );
  const [expectedVersion, setExpectedVersion] = useState(restored?.expectedVersion ?? initialProceeding?.version);

  // Track which matter parties are explicitly included in this proceeding (C12/U2).
  // A new proceeding starts with no inferred membership: every unlinked party is
  // a candidate that requires a deliberate inclusion decision.
  const [includedPartyIds, setIncludedPartyIds] = useState<Set<string>>(() => {
    if (restored) return restored.includedPartyIds;
    if (initialProceeding?.parties) {
      return new Set(initialProceeding.parties.map((p) => p.matterPartyId));
    }
    return new Set();
  });

  // Legal Capacities per matter party (storing both legalCapacity and capacityText).
  // Only existing links carry a saved capacity; candidates start unselected ('')
  // requiring an explicit capacity decision upon inclusion (P2/U2).
  const [partyCapacities, setPartyCapacities] = useState<Record<string, PartyCapacityState>>(() => {
    if (restored) return restored.partyCapacities;
    const initial: Record<string, PartyCapacityState> = {};
    const existingPartiesMap = new Map<string, ProceedingPartySummaryDTO>();
    if (initialProceeding?.parties) {
      for (const p of initialProceeding.parties) {
        existingPartiesMap.set(p.matterPartyId, p);
      }
    }

    for (const mp of matter.parties || []) {
      const existing = existingPartiesMap.get(mp.id);
      initial[mp.id] = existing
        ? {
            legalCapacity: existing.legalCapacity ?? 'OTHER',
            capacityText: existing.capacityText ?? '',
          }
        : {
            legalCapacity: '',
            capacityText: '',
          };
    }
    return initial;
  });

  const [isDirty, setIsDirty] = useState(restored?.isDirty ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [operationPending, setOperationPending] = useState(Boolean(restored?.operation));

  // Synchronize clean forms and explicit conflict reloads with the latest server version.
  const [prevProceeding, setPrevProceeding] = useState(initialProceeding);
  if (initialProceeding && initialProceeding !== prevProceeding && !isDirty && !isSaving && !operationPending) {
    setPrevProceeding(initialProceeding);
    setExpectedVersion(initialProceeding.version);
    setCourtId(initialProceeding.courtId || '');
    setInstance(initialProceeding.instance || 'FIRST_INSTANCE');
    setParentProceedingId(initialProceeding.parentProceedingId || '');
    setNumberText(initialProceeding.numberText || '');
    setYearLabel(initialProceeding.yearLabel || '');
    setRegisterType(initialProceeding.registerType || '');
    setCircuit(initialProceeding.circuit || '');
    setFilingDate(initialProceeding.filingDate || '');
    setClaimAmount(initialProceeding.claimAmount || '');
    setStatus(initialProceeding.status || 'ACTIVE');

    const existingPartiesMap = new Map<string, ProceedingPartySummaryDTO>();
    for (const p of initialProceeding.parties || []) {
      existingPartiesMap.set(p.matterPartyId, p);
    }
    const newIncluded = new Set<string>();
    const newCapacities: Record<string, PartyCapacityState> = {};
    for (const mp of matter.parties || []) {
      const existing = existingPartiesMap.get(mp.id);
      if (existing) {
        newIncluded.add(mp.id);
        newCapacities[mp.id] = {
          legalCapacity: existing.legalCapacity ?? 'OTHER',
          capacityText: existing.capacityText ?? '',
        };
      } else {
        newCapacities[mp.id] = {
          legalCapacity: '',
          capacityText: '',
        };
      }
    }
    setIncludedPartyIds(newIncluded);
    setPartyCapacities(newCapacities);
  }

  // UI States
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [incompleteDraftAcknowledged, setIncompleteDraftAcknowledged] = useState(restored?.incompleteDraftAcknowledged ?? false);

  // In-memory Idempotency Key plus the frozen semantic payload for the original
  // operation. A retry after an uncertain outcome must reuse both.
  const [idempotencyKey, setIdempotencyKey] = useState(() => restored?.idempotencyKey ?? generateClientRequestId('proc'));
  const pendingOperationRef = useRef<ProceedingOperation | null>(restored?.operation ?? null);

  const fields = {
    courtId, instance, parentProceedingId, numberText, yearLabel, registerType, circuit,
    filingDate, claimAmount, status, includedPartyIds, partyCapacities, incompleteDraftAcknowledged,
    expectedVersion, idempotencyKey, isDirty,
  };
  useLayoutEffect(() => {
    if (!draft.isCurrent()) return;
    const operation = pendingOperationRef.current;
    if (isDirty || operation) draft.keep({ ...fields, operation });
    else draft.clear();
  });

  const formId = useId();
  const formDomId = `${formId}-form`;

  // U9: bind server field errors to their controls for assistive technology.
  const fieldErrorProps = (field: string) =>
    fieldErrors[field]
      ? {
          'aria-invalid': true as const,
          'aria-describedby': `${formId}-${field}-error`,
        }
      : {};
  const renderFieldError = (field: string) =>
    fieldErrors[field] ? (
      <p
        id={`${formId}-${field}-error`}
        role="alert"
        data-testid={`proceeding-field-error-${field}`}
        className="text-[11px] font-semibold text-[#A4262C]"
      >
        {fieldErrors[field]}
      </p>
    ) : null;

  // Potential Parent Proceedings (must be in the same matter, and not self)
  const candidateParents = useMemo(() => {
    return (matter.proceedings || []).filter(
      (p) => !initialProceeding || p.id !== initialProceeding.id
    );
  }, [matter.proceedings, initialProceeding]);

  // Docket Incomplete Check
  const isDocketIncomplete = !hasCompleteProceedingRegistration({ numberText, yearLabel, registerType, courtId });

  // Confirmation is scoped to the full docket identity and the displayed candidates.
  const [similarCandidates, setSimilarCandidates] = useState<SimilarProceedingCandidateDTO[]>([]);
  const [hasDirectMatch, setHasDirectMatch] = useState(false);
  const [similarLookupError, setSimilarLookupError] = useState<string | null>(null);
  const [isLookingUpSimilar, setIsLookingUpSimilar] = useState(false);
  const [similarRetryNonce, setSimilarRetryNonce] = useState(0);

  const currentSnapshotKey = JSON.stringify([courtId, numberText.trim(), yearLabel.trim(), registerType.trim(), circuit.trim()]);
  const [candidateSnapshotKey, setCandidateSnapshotKey] = useState<string | null>(null);
  const [confirmedSnapshotKey, setConfirmedSnapshotKey] = useState<string | null>(null);
  const [confirmedCandidateSetKey, setConfirmedCandidateSetKey] = useState<string | null>(null);

  const currentCandidateSetKey = similarCandidates.map((c) => c.id).sort().join(',');
  const isConfirmedForCurrentSnapshot =
    confirmedSnapshotKey !== null &&
    confirmedSnapshotKey === currentSnapshotKey &&
    candidateSnapshotKey === currentSnapshotKey &&
    confirmedCandidateSetKey !== null &&
    confirmedCandidateSetKey === currentCandidateSetKey;

  const similarGenRef = useRef(0);

  useEffect(() => {
    const trimmedNumber = numberText.trim();
    const gen = ++similarGenRef.current;
    const targetSnapshot = currentSnapshotKey;

    const timer = window.setTimeout(async () => {
      if (gen !== similarGenRef.current) return;
      if (!courtId || !trimmedNumber) {
        setSimilarCandidates([]);
        setCandidateSnapshotKey(targetSnapshot);
        setSimilarLookupError(null);
        setIsLookingUpSimilar(false);
        return;
      }

      setIsLookingUpSimilar(true);
      try {
        const res = await findSimilarProceedingsAction({
          courtId,
          numberText: trimmedNumber,
          yearLabel: yearLabel.trim() || null,
          registerType: registerType.trim() || null,
          circuit: circuit.trim() || null,
          excludeProceedingId: initialProceeding?.id ?? null,
          limit: 10,
        });
        if (gen !== similarGenRef.current) return;
        if (res.success) {
          setSimilarCandidates(res.data.candidates);
          setHasDirectMatch(res.data.hasDirectMatch);
          setCandidateSnapshotKey(targetSnapshot);
          setSimilarLookupError(null);
        } else {
          setSimilarLookupError(res.error || 'تعذر تنفيذ فحص التشابه.');
        }
      } catch {
        if (gen === similarGenRef.current) {
          setSimilarLookupError('حدث خطأ في الاتصال أثناء فحص التشابه.');
        }
      } finally {
        if (gen === similarGenRef.current) setIsLookingUpSimilar(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [courtId, numberText, yearLabel, registerType, circuit, currentSnapshotKey, initialProceeding?.id, similarRetryNonce]);

  const togglePartyInclusion = (partyId: string, included: boolean) => {
    setIncludedPartyIds((prev) => {
      const next = new Set(prev);
      if (included) {
        next.add(partyId);
      } else {
        next.delete(partyId);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || !draft.isCurrent()) return;
    setIsSaving(true);
    setGeneralError(null);
    setFieldErrors({});
    setConcurrencyConflict(false);
    setSessionExpired(false);

    let operation = pendingOperationRef.current;
    if (!operation) {
      // U7: Resolve similarity lookup before creation decision so advisory cannot arrive after record creation
      if (!isEdit && courtId && numberText.trim()) {
        const snapshotKey = currentSnapshotKey;
        let currentCandidates = similarCandidates;
        let directMatch = hasDirectMatch;

        // If lookup for this exact snapshot was never performed or is in-flight:
        if (candidateSnapshotKey !== snapshotKey || isLookingUpSimilar) {
          const submitGen = ++similarGenRef.current;
          try {
            setIsLookingUpSimilar(true);
            const simRes = await findSimilarProceedingsAction({
              courtId,
              numberText: numberText.trim(),
              yearLabel: yearLabel.trim() || null,
              registerType: registerType.trim() || null,
              circuit: circuit.trim() || null,
              excludeProceedingId: initialProceeding?.id ?? null,
              limit: 10,
            });
            if (submitGen !== similarGenRef.current || !draft.isCurrent()) {
              setIsSaving(false);
              return;
            }
            if (simRes.success) {
              currentCandidates = simRes.data.candidates;
              directMatch = simRes.data.hasDirectMatch;
              setSimilarCandidates(currentCandidates);
              setHasDirectMatch(directMatch);
              setCandidateSnapshotKey(snapshotKey);
              setSimilarLookupError(null);
            } else {
              const errMsg = simRes.error || 'تعذر تنفيذ فحص التشابه.';
              setSimilarLookupError(errMsg);
              setGeneralError(errMsg);
              setIsSaving(false);
              return;
            }
          } catch {
            if (submitGen === similarGenRef.current) {
              const netErr = 'حدث خطأ في الاتصال أثناء فحص تشابه القيود القضائية.';
              setSimilarLookupError(netErr);
              setGeneralError(netErr);
            }
            setIsSaving(false);
            return;
          } finally {
            if (submitGen === similarGenRef.current) {
              setIsLookingUpSimilar(false);
            }
          }
        }

        const displayedCandidatesKey = currentCandidates.map((c) => c.id).sort().join(',');
        const isCurrentlyConfirmed =
          confirmedSnapshotKey === snapshotKey &&
          candidateSnapshotKey === snapshotKey &&
          confirmedCandidateSetKey === displayedCandidatesKey;

        if (currentCandidates.length > 0 && !isCurrentlyConfirmed) {
          const match = directMatch ? 'مطابقة' : 'مشابهة';
          setGeneralError(
            `عُثر على قيود قضائية ${match} في نفس المحكمة. راجع النتائج أدناه، أو اضغط "متابعة الحفظ كقيد منفصل" لتأكيد تسجيل قيد جديد.`
          );
          setIsSaving(false);
          return;
        }
      }

      // U2: Require explicit legal capacity on all included candidate parties
      const includedPartiesList = (matter.parties || []).filter((mp) => includedPartyIds.has(mp.id));
      for (const mp of includedPartiesList) {
        const capState = partyCapacities[mp.id];
        if (!capState || !capState.legalCapacity) {
          setGeneralError('يجب تحديد الصفة القانونية صراحةً لكل طرف تم ضمه إلى القيد القضائي.');
          setFieldErrors((prev) => ({
            ...prev,
            [`capacity_${mp.id}`]: 'يرجى تحديد الصفة القانونية لهذا الطرف صراحةً.',
          }));
          setIsSaving(false);
          return;
        }
      }

      // U5: never silently downgrade an existing or explicitly requested non-draft state,
      // and never override an explicitly chosen DRAFT status to ACTIVE.
      if (isDocketIncomplete && status !== 'DRAFT') {
        if (!incompleteDraftAcknowledged) {
          setGeneralError(
            'بيانات القيد غير مكتملة (رقم الدعوى/السنة/نوع الجدول). اختر حفظ القيد كمسودة صراحةً، أو استكمل البيانات للحفظ بالحالة المطلوبة.'
          );
          setFieldErrors({ status: 'الحالة المطلوبة تتطلب استكمال بيانات القيد أو تأكيد الحفظ كمسودة.' });
          setIsSaving(false);
          return;
        }
      }

      const finalStatus: ProceedingStatus = (isDocketIncomplete && incompleteDraftAcknowledged) ? 'DRAFT' : status;

      // Assemble party capacities ONLY for explicitly included parties (C12)
      const assembledParties: ProceedingPartyInput[] = includedPartiesList.map((mp) => {
        const capState = partyCapacities[mp.id];
        return {
          matterPartyId: mp.id,
          legalCapacity: (capState?.legalCapacity || 'OTHER') as ProceedingLegalCapacity,
          capacityText: capState?.capacityText.trim() || undefined,
        };
      });

      if (isEdit && initialProceeding) {
        operation = {
          key: idempotencyKey,
          kind: 'update',
          payload: {
            id: initialProceeding.id,
            matterId: matter.id,
            expectedVersion: expectedVersion ?? initialProceeding.version,
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
            parties: assembledParties,
            idempotencyKey,
          } satisfies UpdateProceedingInput,
        };
      } else {
        operation = {
          key: idempotencyKey,
          kind: 'create',
          payload: {
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
            parties: assembledParties,
            idempotencyKey,
          } satisfies AddProceedingInput,
        };
      }
      pendingOperationRef.current = operation;
    }
    draft.keep({ ...fields, operation });

    try {
      const res =
        operation.kind === 'update'
          ? await updateProceedingAction(operation.payload as UpdateProceedingInput)
          : await addProceedingAction(operation.payload as AddProceedingInput);

      if (!draft.isCurrent()) {
        setOperationPending(true);
        setIsSaving(false);
        return;
      }

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setSessionExpired(true);
          setOperationPending(true);
          setGeneralError(
            'انتهت صلاحية الجلسة أو يلزم استكمال التحقق أثناء تحرير القيد. تم تجميد العملية الأصلية والحفاظ على البيانات في الذاكرة؛ سجّل الدخول في نافذة جديدة ثم أعد محاولة الحفظ الأصلية.'
          );
        } else if (res.code === 'CONCURRENCY_CONFLICT') {
          pendingOperationRef.current = null;
          setOperationPending(false);
          setIdempotencyKey(generateClientRequestId('proc'));
          setConcurrencyConflict(true);
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setOperationPending(true);
          setGeneralError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error ||
                'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية الأصلية مجمّدة؛ أعد المحاولة أو ابدأ تعديلاً جديداً بعد التحقق من النتيجة.'
          );
        } else {
          pendingOperationRef.current = null;
          setOperationPending(false);
          setIdempotencyKey(generateClientRequestId('proc'));
          setGeneralError(res.error || 'تعذر حفظ القيد القضائي.');
          if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        }
        setIsSaving(false);
        return;
      }

      pendingOperationRef.current = null;
      draft.clear();
      setOperationPending(false);
      setIsDirty(false);
      router.replace(`/matters/${matter.id}`);
    } catch {
      setOperationPending(true);
      setGeneralError(
        'حدث خطأ في الاتصال أثناء حفظ البيانات. العملية الأصلية محفوظة ويمكنك إعادة المحاولة بأمان.'
      );
      setIsSaving(false);
    }
  };

  const handleStartNewEdit = () => {
    // P1/U1: Block dropping an unconfirmed creation to prevent duplicate row creation
    if (!isEdit && operationPending) {
      setGeneralError('يلزم التحقق من نتيجة إنشاء السجل الأصلي أو إعادة المحاولة لتفادي تكرار الإنشاء قبل بدء عملية جديدة.');
      return;
    }
    pendingOperationRef.current = null;
    setOperationPending(false);
    setSessionExpired(false);
    setGeneralError(null);
    setIdempotencyKey(generateClientRequestId('proc'));
    setIsDirty(true);
  };

  useLeaveGuard(isDirty || operationPending, isSaving);

  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0) {
      document.getElementById(formDomId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [fieldErrors, formDomId]);

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
            {matter.title} (<bdi dir="ltr" className="font-mono">{matter.fileCode}</bdi>)
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

      {/* Lookup read failure alert (U8) */}
      {lookupError && (
        <div
          role="alert"
          data-testid="lookup-read-error-banner"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-950 space-y-2 text-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>تعذر تحميل قائمة المحاكم بالكامل</span>
          </div>
          <p className="leading-relaxed">
            حدث خطأ أثناء استرجاع بيانات المحاكم من الخادم. يمكنك إعادة تحميل الصفحة.
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex items-center justify-center px-3 py-1.5 bg-[#14566B] text-white rounded font-semibold text-xs min-h-[44px]"
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      )}

      {/* Concurrency Alert */}
      {concurrencyConflict && (
        <div
          role="alert"
          data-testid="concurrency-conflict-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-2 text-xs"
        >
          <span className="font-bold block text-sm">تعارض في التعديل المتزامن</span>
          <p>تم تعديل هذا القيد من مستخدم آخر أثناء تحريرك. تم الاحتفاظ ببياناتك المدخلة في الذاكرة. يرجى تحديث الصفحة للحصول على أحدث إصدار ثم إعادة الحفظ.</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                draft.clear();
                setIsDirty(false);
                setIdempotencyKey(generateClientRequestId('proc'));
                setConcurrencyConflict(false);
                router.refresh();
              }}
              data-testid="conflict-reload-button"
              className="px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-semibold rounded-[6px] transition-colors min-h-[44px]"
            >
              تحديث الصفحة واسترجاع أحدث نسخة
            </button>
            <button
              type="button"
              onClick={() => {
                setIdempotencyKey(generateClientRequestId('proc'));
                setConcurrencyConflict(false);
              }}
              data-testid="conflict-dismiss-button"
              className="px-3 py-1.5 bg-white border border-amber-400 text-amber-900 font-semibold rounded-[6px] hover:bg-amber-100 transition-colors min-h-[44px]"
            >
              متابعة المحاولة بالبيانات الحالية
            </button>
          </div>
        </div>
      )}

      {/* Session Expired Recovery Alert */}
      {sessionExpired && (
        <div
          role="alert"
          data-testid="session-expired-recovery-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3 text-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>انتهت صلاحية الجلسة أو يلزم استكمال التحقق أثناء تحرير القيد</span>
          </div>
          <p className="leading-relaxed">
            تم الحفاظ على كافة البيانات والتعديلات المدخلة في ذاكرة الصفحة دون فقدان. يرجى تسجيل الدخول
            أو إكمال التحقق (MFA) في نافذة جديدة لتجديد الجلسة ثم العودة هنا والضغط على زر
            &quot;إعادة محاولة الحفظ&quot; لإتمام العملية الأصلية بنفس المفتاح والبيانات المجمّدة.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <a
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="session-recovery-login-link"
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-flex items-center min-h-[44px]"
            >
              فتح شاشة تسجيل الدخول في نافذة جديدة ↗
            </a>
            <button
              type="submit"
              form={formDomId}
              data-testid="session-recovery-retry-button"
              className="px-3 py-1.5 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors min-h-[44px]"
            >
              إعادة محاولة الحفظ
            </button>
          </div>
        </div>
      )}

      {/* Frozen original operation (uncertain outcome) */}
      {operationPending && (
        <div
          role="alert"
          data-testid="operation-pending-banner"
          className="p-4 bg-sky-50 border border-sky-300 rounded-[6px] text-sky-950 space-y-3"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>العملية الأصلية معلّقة بانتظار نتيجة مؤكدة</span>
          </div>
          <p className="text-xs leading-relaxed">
            أُبقيت العملية الأصلية بنفس المفتاح ونفس البيانات المجمّدة. الحقول معطّلة حتى تتأكد النتيجة؛
            إعادة المحاولة لا تنشئ عملية مكررة. إذا كنت تريد اعتماد تعديلات جديدة بدلاً منها، ابدأ
            تعديلاً جديداً صراحةً.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              form={formDomId}
              data-testid="operation-retry-button"
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px]"
            >
              إعادة محاولة العملية الأصلية
            </button>
            <button
              type="button"
              onClick={handleStartNewEdit}
              data-testid="operation-start-new-button"
              className="px-3 py-1.5 bg-white border border-[#14566B] text-[#14566B] text-xs font-semibold rounded-[6px] min-h-[44px]"
            >
              بدء تعديل جديد (يتخلى عن العملية المعلّقة)
            </button>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {generalError && (
        <div
          role="alert"
          data-testid="proceeding-error-banner"
          className="p-4 bg-red-50 border border-red-200 rounded-[6px] text-[#A4262C] space-y-1 text-xs"
        >
          <span className="font-bold block text-sm">تعذر حفظ القيد القضائي</span>
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

      {/* Similarity preflight (C18/U7): server-backed, court-scoped and
          normalized, so cross-matter and post-load records are visible. */}
      {similarLookupError && (
        <div
          role="alert"
          data-testid="similarity-lookup-error"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-1 text-xs"
        >
          <span className="font-bold block text-sm">تعذر إكمال فحص التشابه</span>
          <p className="leading-relaxed">
            {similarLookupError} يمكنك متابعة الحفظ، لكن يُنصح بإعادة المحاولة قبل اعتماد رقم القيد.
          </p>
          <button
            type="button"
            onClick={() => setSimilarRetryNonce((n) => n + 1)}
            data-testid="similarity-retry-button"
            className="px-3 py-1.5 bg-white border border-amber-400 text-amber-900 font-semibold rounded-[6px] min-h-[44px]"
          >
            إعادة محاولة الفحص
          </button>
        </div>
      )}

      {isLookingUpSimilar && !similarLookupError && (
        <p
          role="status"
          data-testid="similarity-lookup-pending"
          className="text-xs text-[#4D606A]"
        >
          جارٍ فحص أرقام القيد المتشابهة في نفس المحكمة...
        </p>
      )}

      {!isLookingUpSimilar && candidateSnapshotKey === currentSnapshotKey && similarCandidates.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          data-testid="similarity-warning-banner"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-2 text-xs shadow-xs"
        >
          <span className="font-bold block text-sm">أرقام قيد متشابهة في نفس المحكمة</span>
          <p className="leading-relaxed">
            عُثر على قيود قضائية {hasDirectMatch ? 'مطابقة' : 'مشابهة'} بعد التطبيع. راجعها قبل الحفظ؛ ويمكنك متابعة تسجيل قيد جديد
            إذا كانت هذه دعوى منفصلة (مثل دعوى فرعية أو متقابلة).
          </p>
          <ul className="space-y-1.5">
            {similarCandidates.map((candidate) => (
              <li key={candidate.id} data-testid={`similarity-candidate-${candidate.id}`}>
                <NextLink
                  href={`/matters/${candidate.matterId}/proceedings/${candidate.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#14566B] font-bold underline inline-flex items-center min-h-[44px]"
                >
                  <span className="font-mono">
                    <bdi dir="ltr">{candidate.numberText || '—'}</bdi> لسنة <bdi dir="ltr">{candidate.yearLabel || '—'}</bdi>
                  </span>
                  {' '}— <bdi dir="ltr" className="font-mono">{candidate.matterFileCode}</bdi> ({candidate.matterTitle}) ↗
                </NextLink>
                <span className="block text-[11px] text-amber-800">
                  {candidate.courtName} — {candidate.similarityReason}
                </span>
              </li>
            ))}
          </ul>
          <div className="pt-2 flex flex-wrap items-center gap-2">
            {!isConfirmedForCurrentSnapshot ? (
              <button
                type="button"
                onClick={() => {
                  if (candidateSnapshotKey === currentSnapshotKey) {
                    setConfirmedSnapshotKey(currentSnapshotKey);
                    setConfirmedCandidateSetKey(currentCandidateSetKey);
                  }
                }}
                disabled={candidateSnapshotKey !== currentSnapshotKey}
                data-testid="confirm-distinct-save-button"
                className="px-3 py-1.5 bg-[#14566B] hover:bg-[#114252] text-white font-semibold rounded-[6px] transition-colors disabled:opacity-50 min-h-[44px]"
              >
                متابعة الحفظ كقيد منفصل (تأكيد التشابه)
              </button>
            ) : (
              <span className="text-emerald-800 font-bold" data-testid="distinct-save-confirmed-message">
                ✓ تم تأكيد الحفظ كقيد منفصل. يمكنك الآن الضغط على زر الحفظ أدناه.
              </span>
            )}
          </div>
        </div>
      )}

      <form
        id={formDomId}
        onSubmit={handleSubmit}
        onChange={() => setIsDirty(true)}
        className="space-y-6"
      >
      <fieldset disabled={operationPending || isSaving} className="space-y-6 border-0 p-0 m-0 min-w-0">
        {/* Section 1: Court & Instance */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
            المحكمة والدرجة القضائية
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Court (C19) */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-court`} className="block text-xs font-bold text-[#172A35]">
                المحكمة أو الجهة القضائية <span className="text-red-600">*</span>
              </label>
              <select
                id={`${formId}-court`}
                required
                value={courtId}
                onChange={(e) => {
                  setCourtId(e.target.value);
                  setConfirmedSnapshotKey(null);
                  setConfirmedCandidateSetKey(null);
                  setCandidateSnapshotKey(null);
                  setSimilarCandidates([]);
                  setIncompleteDraftAcknowledged(false);
                }}
                data-testid="proceeding-court-select"
                {...fieldErrorProps('courtId')}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="">— اختر المحكمة —</option>
                {courts.map((c) => {
                  const isInactive = c.isActive === false;
                  const isSelected = c.id === courtId;
                  if (isInactive && !isSelected) {
                    return (
                      <option key={c.id} value={c.id} disabled>
                        {c.name} (معطلة)
                      </option>
                    );
                  }
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} {isInactive ? '(معطلة - محتفظ بها تاريخياً)' : ''}
                    </option>
                  );
                })}
              </select>
              {renderFieldError('courtId')}
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
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {isDocketIncomplete && (
                <span
                  data-testid="incomplete-docket-badge"
                  className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded border border-amber-300 self-start sm:self-auto"
                >
                  الرقم غير مستكمل (مسودة قيد)
                </span>
              )}
              {isEdit && (
                <div className="flex items-center gap-2">
                  <label htmlFor={`${formId}-status`} className="text-xs font-bold text-[#172A35]">
                    حالة القيد:
                  </label>
                  <select
                    id={`${formId}-status`}
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value as ProceedingStatus);
                      setIncompleteDraftAcknowledged(false);
                    }}
                    data-testid="proceeding-status-select"
                    className="px-2.5 py-1 text-xs font-semibold bg-white border border-[#D5DFE3] rounded-[6px] text-[#14566B] min-h-[44px] focus:outline-none focus:ring-1 focus:ring-[#14566B]"
                  >
                    <option value="ACTIVE">قيد نشط بالمحكمة</option>
                    <option value="AWAITING_JUDGMENT">حجز للحكم</option>
                    <option value="DECIDED">محكوم فيه</option>
                    <option value="CLOSED">منتهي ومغلق</option>
                    <option value="DRAFT">مسودة قيد</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {isDocketIncomplete && isEdit && status !== 'DRAFT' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] space-y-1">
              <label
                htmlFor={`${formId}-incompleteAck`}
                className="flex items-start gap-2 text-xs text-amber-950"
              >
                <input
                  id={`${formId}-incompleteAck`}
                  type="checkbox"
                  checked={incompleteDraftAcknowledged}
                  onChange={(e) => setIncompleteDraftAcknowledged(e.target.checked)}
                  data-testid="incomplete-draft-acknowledgement"
                  className="mt-0.5 h-4 w-4 accent-[#14566B]"
                />
                <span>
                  أوافق صراحةً على حفظ هذا القيد كمسودة لأن رقم الدعوى أو السنة أو نوع الجدول غير
                  مكتمل. لن تُستبدل الحالة المختارة بصمت: الحفظ بالحالة النشطة يتطلب استكمال بيانات
                  القيد أولاً.
                </span>
              </label>
              {renderFieldError('status')}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Number Text */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-numberText`} className="block text-xs font-bold text-[#172A35]">
                رقم الدعوى بالمحكمة
              </label>
              <input
                id={`${formId}-numberText`}
                type="text"
                dir="ltr"
                value={numberText}
                onChange={(e) => {
                  setNumberText(e.target.value);
                  setConfirmedSnapshotKey(null);
                  setConfirmedCandidateSetKey(null);
                  setCandidateSnapshotKey(null);
                  setSimilarCandidates([]);
                  setIncompleteDraftAcknowledged(false);
                }}
                placeholder="مثال: 1234 أو 0045/ب"
                data-testid="proceeding-number-input"
                {...fieldErrorProps('numberText')}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {renderFieldError('numberText')}
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
                dir="ltr"
                value={yearLabel}
                onChange={(e) => {
                  setYearLabel(e.target.value);
                  setConfirmedSnapshotKey(null);
                  setConfirmedCandidateSetKey(null);
                  setCandidateSnapshotKey(null);
                  setSimilarCandidates([]);
                  setIncompleteDraftAcknowledged(false);
                }}
                placeholder="مثال: 2026 أو 1447هـ"
                data-testid="proceeding-year-input"
                {...fieldErrorProps('yearLabel')}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {renderFieldError('yearLabel')}
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
                onChange={(e) => {
                  setRegisterType(e.target.value);
                  setIncompleteDraftAcknowledged(false);
                }}
                placeholder="مثال: مدني كلي، جنح، عمالي"
                data-testid="proceeding-register-type-input"
                {...fieldErrorProps('registerType')}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {renderFieldError('registerType')}
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
                {...fieldErrorProps('circuit')}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {renderFieldError('circuit')}
            </div>

            {/* Filing Date */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-filingDate`} className="block text-xs font-bold text-[#172A35]">
                تاريخ رفع الدعوى
              </label>
              <input
                id={`${formId}-filingDate`}
                type="date"
                dir="ltr"
                value={filingDate}
                onChange={(e) => setFilingDate(e.target.value)}
                data-testid="proceeding-filing-date-input"
                {...fieldErrorProps('filingDate')}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {renderFieldError('filingDate')}
            </div>

            {/* Claim Amount */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-claimAmount`} className="block text-xs font-bold text-[#172A35]">
                قيمة المطالبة (ج.م)
              </label>
              <input
                id={`${formId}-claimAmount`}
                type="text"
                dir="ltr"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder="مثال: 50000"
                data-testid="proceeding-claim-amount-input"
                {...fieldErrorProps('claimAmount')}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {renderFieldError('claimAmount')}
            </div>
          </div>
        </div>

        {/* Section 3: Legal Capacities in this Proceeding (C12) */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <div className="pb-2 border-b border-[#E8EEF1]">
            <h2 className="text-base font-bold text-[#172A35]">
              الصفات القانونية للأطراف في هذا القيد
            </h2>
            <p className="text-xs text-[#4D606A] mt-1 leading-relaxed">
              تحدد صفة كل طرف في هذه الدرجة القضائية (مثلاً: الموكل مدعي أو مستأنف ضده). يتم الحفاظ على الروابط القائمة، مع إمكانية إدراج أو استبعاد أي طرف بقرار صريح دون استنتاج تلقائي للصفة.
            </p>
          </div>

          {(matter.parties || []).length === 0 ? (
            <p className="text-xs text-[#4D606A] italic">
              لا توجد أطراف مسجلة في هذا الملف بعد لتعيين صفاتهم القضائية.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Included Parties */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-[#172A35] block">
                  الأطراف المقيدة بصفات إجرائية في هذا القيد:
                </span>
                {(matter.parties || []).filter((mp) => includedPartyIds.has(mp.id)).length === 0 ? (
                  <div className="p-3 bg-amber-50 rounded border border-amber-200 text-xs text-amber-900">
                    لم يتم إدراج أي طرف بصفة إجرائية في هذا القيد حتى الآن. يمكنك إدراج طرف من قائمة المرشحين أدناه.
                  </div>
                ) : (
                  (matter.parties || [])
                    .filter((mp) => includedPartyIds.has(mp.id))
                    .map((mp) => {
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

                          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-2.5 flex-1 max-w-lg">
                            <div className="space-y-1 sm:w-1/2">
                              <div className="flex items-center gap-1.5">
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
                                  {...fieldErrorProps(`capacity_${mp.id}`)}
                                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#D5DFE3] rounded-[6px] font-semibold text-[#14566B] min-h-[44px] focus:outline-none focus:ring-1 focus:ring-[#14566B]"
                                >
                                  <option value="">-- اختر الصفة القانونية صراحةً --</option>
                                  {(['PLAINTIFF', 'DEFENDANT', 'APPELLANT', 'APPELLEE', 'INTERVENOR', 'OTHER'] as ProceedingLegalCapacity[]).map((cap) => (
                                    <option key={cap} value={cap}>
                                      {PROCEEDING_LEGAL_CAPACITY_LABELS[cap]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {renderFieldError(`capacity_${mp.id}`)}
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
                                className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] min-h-[44px] focus:outline-none focus:ring-1 focus:ring-[#14566B]"
                              />
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center justify-end">
                            <button
                              type="button"
                              data-testid={`remove-party-${mp.id}`}
                              onClick={() => togglePartyInclusion(mp.id, false)}
                              className="px-2.5 py-1.5 text-xs text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-200 transition-colors min-h-[44px]"
                              title="استبعاد الطرف من هذا القيد"
                            >
                              ✕ استبعاد
                            </button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              {/* Unlinked Candidate Parties */}
              {(matter.parties || []).filter((mp) => !includedPartyIds.has(mp.id)).length > 0 && (
                <div className="pt-3 border-t border-[#E8EEF1] space-y-2">
                  <span className="text-xs font-bold text-[#4D606A] block">
                    أطراف القضية غير المدرجة في هذا القيد (مرشحون للإدراج):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(matter.parties || [])
                      .filter((mp) => !includedPartyIds.has(mp.id))
                      .map((mp) => (
                        <div
                          key={mp.id}
                          className="flex items-center justify-between p-2.5 bg-[#F4F6F7] rounded-[6px] border border-dashed border-[#D5DFE3] text-xs"
                        >
                          <div className="space-y-0.5">
                            <span className="font-semibold text-[#172A35] block">{mp.partyName}</span>
                            <span className="text-[11px] text-[#4D606A]">
                              {mp.role === 'CLIENT' ? 'موكل' : mp.role === 'OPPONENT' ? 'خصم' : 'طرف آخر'}
                            </span>
                          </div>
                          <button
                            type="button"
                            data-testid={`add-party-to-proceeding-${mp.id}`}
                            onClick={() => togglePartyInclusion(mp.id, true)}
                            className="px-3 py-1.5 bg-white hover:bg-[#E8EEF1] text-[#14566B] text-xs font-bold rounded border border-[#14566B]/30 transition-colors min-h-[44px]"
                          >
                            + إدراج بالدعوى
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        </fieldset>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <Link
            href={`/matters/${matter.id}`}
            replace
            onNavigate={() => {
              draft.clear();
              setIsDirty(false);
            }}
            className="w-full sm:w-auto px-5 py-2.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] text-center min-h-[44px] flex items-center justify-center transition-colors"
          >
            إلغاء والعودة للملف
          </Link>

          <button
            type="submit"
            disabled={isSaving || operationPending || !courtId}
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

