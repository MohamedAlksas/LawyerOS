'use client';

import React, { useState, useEffect, useLayoutEffect, useId, useRef } from 'react';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { useRouter } from 'next/navigation';
import { openMatterAction, updateMatterAction } from '@/modules/matters/matter-actions';
import { searchPartiesAction } from '@/modules/parties/actions';
import {
  MatterDTO,
  MatterKind,
  MatterStatus,
  OpenMatterInput,
  UpdateMatterInput,
} from '@/modules/matters/matter-types';
import {
  MATTER_KIND_LABELS,
  MATTER_STATUS_LABELS,
  generateClientRequestId,
  getCairoTodayDate,
  isAuthRecoveryCode,
} from './matter-ui-types';

interface OptionItem {
  id: string;
  name: string;
  isActive?: boolean;
}

interface ClientOptionItem {
  id: string;
  name: string;
  primaryPhone?: string | null;
}

interface MatterFormProps {
  ownerId: string;
  initialMatter?: MatterDTO;
  practiceAreas: OptionItem[];
  storageLocations: OptionItem[];
  parties?: ClientOptionItem[];
  lookupError?: boolean;
}

type MatterOperation = {
  key: string;
  kind: 'create' | 'update';
  payload: OpenMatterInput | UpdateMatterInput;
};

interface MatterDraft {
  title: string;
  kind: MatterKind;
  status: MatterStatus;
  practiceAreaId: string;
  paperLocationId: string;
  openingDate: string;
  closingDate: string;
  summary: string;
  notes: string;
  expectedVersion: number | undefined;
  selectedClientId: string;
  selectedClientObj: ClientOptionItem | null;
  idempotencyKey: string;
  isDirty: boolean;
  operation: MatterOperation | null;
}

export function MatterForm({
  ownerId,
  initialMatter,
  practiceAreas,
  storageLocations,
  parties = [],
  lookupError,
}: MatterFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialMatter);
  const draft = useFormDraft<MatterDraft>(
    ownerId, initialMatter ? `/matters/${initialMatter.id}/edit` : '/matters/new',
  );
  const restored = draft.restored;

  // Form State
  const [title, setTitle] = useState(restored?.title ?? initialMatter?.title ?? '');
  const [kind, setKind] = useState<MatterKind>(restored?.kind ?? initialMatter?.kind ?? 'LITIGATION');
  const [status, setStatus] = useState<MatterStatus>(restored?.status ?? initialMatter?.status ?? 'ACTIVE');
  const [practiceAreaId, setPracticeAreaId] = useState(restored?.practiceAreaId ?? initialMatter?.practiceAreaId ?? '');
  const [paperLocationId, setPaperLocationId] = useState(restored?.paperLocationId ?? initialMatter?.paperLocationId ?? '');
  const [openingDate, setOpeningDate] = useState<string>(
    restored?.openingDate ?? (initialMatter ? initialMatter.openingDate ?? '' : getCairoTodayDate())
  );
  const [closingDate, setClosingDate] = useState(restored?.closingDate ?? initialMatter?.closingDate ?? '');
  const [summary, setSummary] = useState(restored?.summary ?? initialMatter?.summary ?? '');
  const [notes, setNotes] = useState(restored?.notes ?? initialMatter?.notes ?? '');
  const [expectedVersion, setExpectedVersion] = useState(restored?.expectedVersion ?? initialMatter?.version);

  // UI States
  const [isSaving, setIsSaving] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // In-memory Idempotency Key (frozen across transport retries, regenerated only
  // after the original operation has a definitive committed/rolled-back outcome)
  const [idempotencyKey, setIdempotencyKey] = useState(() => restored?.idempotencyKey ?? generateClientRequestId('mform'));
  const pendingOperationRef = useRef<MatterOperation | null>(restored?.operation ?? null);
  const [operationPending, setOperationPending] = useState(Boolean(restored?.operation));
  const [isDirty, setIsDirty] = useState(restored?.isDirty ?? false);

  // C17: Client Selection with Server-Backed Normalized Search
  const [selectedClientId, setSelectedClientId] = useState(restored?.selectedClientId ?? '');
  const [selectedClientObj, setSelectedClientObj] = useState<ClientOptionItem | null>(restored?.selectedClientObj ?? null);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [partiesList, setPartiesList] = useState<ClientOptionItem[]>(parties);
  const [isSearchingClient, setIsSearchingClient] = useState(false);
  const [clientSearchError, setClientSearchError] = useState<string | null>(null);
  const [clientSearchPage, setClientSearchPage] = useState(1);
  const [clientSearchTotalCount, setClientSearchTotalCount] = useState(parties.length);
  const [clientSearchTotalPages, setClientSearchTotalPages] = useState(1);
  const searchGenRef = useRef(0);
  const prevMatterRef = useRef(initialMatter);

  const fields = {
    title, kind, status, practiceAreaId, paperLocationId, openingDate, closingDate, summary,
    notes, expectedVersion, selectedClientId, selectedClientObj, idempotencyKey, isDirty,
  };
  useLayoutEffect(() => {
    if (!draft.isCurrent()) return;
    const operation = pendingOperationRef.current;
    if (isDirty || operation) draft.keep({ ...fields, operation });
    else draft.clear();
  });

  // Keep a restored edit on its original version until the user reloads after a conflict.
  useEffect(() => {
    if (initialMatter && prevMatterRef.current !== initialMatter && !isDirty && !isSaving && !operationPending) {
      prevMatterRef.current = initialMatter;
      setExpectedVersion(initialMatter.version);
      setTitle(initialMatter.title || '');
      setKind(initialMatter.kind || 'LITIGATION');
      setStatus(initialMatter.status || 'ACTIVE');
      setPracticeAreaId(initialMatter.practiceAreaId || '');
      setPaperLocationId(initialMatter.paperLocationId || '');
      setOpeningDate(initialMatter.openingDate || '');
      setClosingDate(initialMatter.closingDate || '');
      setSummary(initialMatter.summary || '');
      setNotes(initialMatter.notes || '');
      setConcurrencyConflict(false);
      setGeneralError(null);
    }
  }, [initialMatter, isDirty, isSaving, operationPending]);

  const formId = useId();
  const formDomId = `${formId}-form`;

  const runClientSearch = async (queryText: string, page: number) => {
    const gen = ++searchGenRef.current;
    if (!queryText.trim()) {
      setPartiesList(parties);
      setClientSearchError(null);
      setIsSearchingClient(false);
      setClientSearchPage(1);
      setClientSearchTotalCount(parties.length);
      setClientSearchTotalPages(1);
      return;
    }
    setIsSearchingClient(true);
    setClientSearchError(null);
    try {
      const res = await searchPartiesAction({ query: queryText.trim(), page, limit: 20 });
      if (gen !== searchGenRef.current) return;
      if (res.success) {
        setPartiesList(
          res.data.parties.map((p) => ({
            id: p.id,
            name: p.name,
            primaryPhone: p.primaryPhone,
          }))
        );
        setClientSearchPage(res.data.page);
        setClientSearchTotalCount(res.data.totalCount);
        setClientSearchTotalPages(res.data.totalPages);
      } else {
        setClientSearchError(res.error || 'تعذر البحث في دليل الأطراف.');
      }
    } catch {
      if (gen === searchGenRef.current) {
        setClientSearchError('حدث خطأ أثناء الاتصال بالخادم للبحث عن الأطراف.');
      }
    } finally {
      if (gen === searchGenRef.current) {
        setIsSearchingClient(false);
      }
    }
  };

  const handleClientSearchChange = async (queryText: string) => {
    setClientSearchQuery(queryText);
    // Hide old results immediately so a stale row cannot be selected while the
    // next query is still in flight.
    setPartiesList([]);
    setClientSearchPage(1);
    await runClientSearch(queryText, 1);
  };

  const selectedClient = selectedClientObj || partiesList.find((p) => p.id === selectedClientId) || parties.find((p) => p.id === selectedClientId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || !draft.isCurrent()) return;
    setIsSaving(true);
    setGeneralError(null);
    setFieldErrors({});
    setConcurrencyConflict(false);
    setSessionExpired(false);

    // Freeze the exact semantic payload with its key before the first attempt.
    // Every retry after an uncertain outcome resubmits this snapshot, so a
    // locally edited form cannot become a second operation under the same key.
    let operation = pendingOperationRef.current;
    if (!operation) {
      if (isEdit && initialMatter) {
        const payload: UpdateMatterInput = {
          id: initialMatter.id,
          expectedVersion: expectedVersion ?? initialMatter.version,
          title: title.trim(),
          kind,
          status,
          practiceAreaId: practiceAreaId || null,
          paperLocationId: paperLocationId || null,
          openingDate: openingDate || null,
          closingDate: closingDate || null,
          summary: summary.trim() || null,
          notes: notes.trim() || null,
          idempotencyKey,
        };
        operation = { key: idempotencyKey, kind: 'update', payload };
      } else {
        const payload: OpenMatterInput = {
          title: title.trim(),
          kind,
          practiceAreaId: practiceAreaId || null,
          paperLocationId: paperLocationId || null,
          openingDate: openingDate || null,
          summary: summary.trim() || null,
          notes: notes.trim() || null,
          initialClientId: selectedClientId || null,
          status: selectedClientId ? 'ACTIVE' : 'DRAFT',
          idempotencyKey,
        };
        operation = { key: idempotencyKey, kind: 'create', payload };
      }
      pendingOperationRef.current = operation;
    }
    draft.keep({ ...fields, operation });

    try {
      const res =
        operation.kind === 'update'
          ? await updateMatterAction(operation.payload as UpdateMatterInput)
          : await openMatterAction(operation.payload as OpenMatterInput);

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
            'انتهت صلاحية الجلسة أو يلزم استكمال التحقق أثناء تحرير النموذج. تم تجميد العملية الأصلية والحفاظ على البيانات في الذاكرة؛ سجّل الدخول في نافذة جديدة ثم أعد محاولة الحفظ الأصلية.'
          );
        } else if (res.code === 'CONCURRENCY_CONFLICT') {
          // The server definitively rejected the operation: a newer version exists.
          pendingOperationRef.current = null;
          setOperationPending(false);
          setIdempotencyKey(generateClientRequestId('mform'));
          setConcurrencyConflict(true);
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          // Outcome is uncertain: keep the frozen key/payload and never rotate.
          setOperationPending(true);
          setGeneralError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error ||
                'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية الأصلية مجمّدة؛ أعد المحاولة أو ابدأ تعديلاً جديداً بعد التحقق من النتيجة.'
          );
        } else {
          // Definitive validation rejection: the transaction rolled back.
          pendingOperationRef.current = null;
          setOperationPending(false);
          setIdempotencyKey(generateClientRequestId('mform'));
          setGeneralError(res.error || 'تعذر حفظ بيانات الملف.');
          if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        }
        setIsSaving(false);
        return;
      }

      pendingOperationRef.current = null;
      draft.clear();
      setOperationPending(false);
      setIsDirty(false);
      router.replace(`/matters/${res.data.matter.id}`);
    } catch {
      // C09: transport failure leaves the committed outcome unknown. Keep the
      // original key AND payload frozen; do not create a new operation.
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
      setGeneralError('يلزم التحقق من نتيجة إنشاء الملف الأصلي أو إعادة المحاولة لتفادي تكرار الإنشاء قبل بدء عملية جديدة.');
      return;
    }
    pendingOperationRef.current = null;
    setOperationPending(false);
    setSessionExpired(false);
    setGeneralError(null);
    setIdempotencyKey(generateClientRequestId('mform'));
    setIsDirty(true);
  };

  useLeaveGuard(isDirty, isSaving || operationPending);

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    const form = document.getElementById(formDomId);
    (form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form?.querySelector<HTMLElement>('[role="alert"]'))?.focus();
  }, [fieldErrors, formDomId]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Lookup read failure alert (U8) */}
      {lookupError && (
        <div
          role="alert"
          data-testid="lookup-read-error-banner"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-950 space-y-2 text-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⚠️</span>
            <span>تعذر تحميل بعض البيانات المرجعية بالكامل</span>
          </div>
          <p className="leading-relaxed">
            حدث خطأ أثناء استرجاع دوائر التخصص أو أماكن الحفظ من الخادم. يمكنك إعادة تحميل الصفحة.
          </p>
          <Link
            href={isEdit && initialMatter ? `/matters/${initialMatter.id}/edit` : '/matters/new'}
            className="inline-block px-3 py-1.5 bg-[#14566B] text-white rounded font-semibold text-xs"
          >
            إعادة تحميل الصفحة
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="pb-4 border-b border-[#D5DFE3] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] mb-1">
            <Link href="/matters" className="hover:text-[#14566B] hover:underline">
              ملفات القضايا
            </Link>
            <span aria-hidden="true" className="mx-1.5">/</span>
            <span>{isEdit ? 'تعديل الملف' : 'فتح ملف جديد'}</span>
          </nav>
          <h1 className="text-2xl font-bold text-[#172A35] [overflow-wrap:anywhere]">
            {isEdit ? `تعديل الملف: ${initialMatter?.title}` : 'فتح ملف قضية جديد'}
          </h1>
        </div>

        {isEdit && initialMatter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#4D606A]">كود الملف:</span>
            <bdi dir="ltr" className="font-mono text-sm font-bold bg-slate-100 text-[#14566B] px-2.5 py-1 rounded border border-slate-300">
              {initialMatter.fileCode}
            </bdi>
          </div>
        )}
      </div>

      {/* Concurrency Conflict Alert */}
      {concurrencyConflict && (
        <div
          role="alert"
          data-testid="concurrency-conflict-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⚠️</span>
            <span>تعارض في التعديل المتزامن (تحديث أحدث متوفر)</span>
          </div>
          <p className="text-xs leading-relaxed">
            تم تعديل بيانات هذا الملف من نافذة أخرى أو مستخدم آخر أثناء تحريرك للبيانات. للحفاظ على سلامة القيود، يرجى تحديث الصفحة لمراجعة أحدث التعديلات ثم إعادة الحفظ.
          </p>
          <div>
            <button
              type="button"
              onClick={() => {
                draft.clear();
                setIsDirty(false);
                router.refresh();
              }}
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px]"
            >
              تحديث الصفحة وتحميل أحدث البيانات
            </button>
          </div>
        </div>
      )}

      {/* Session Expired Recovery Alert */}
      {sessionExpired && (
        <div
          role="alert"
          data-testid="session-expired-recovery-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>🔒</span>
            <span>انتهت صلاحية الجلسة أو تم إلغاؤها أثناء تحرير النموذج</span>
          </div>
          <p className="text-xs leading-relaxed">
            تم الحفاظ على كافة البيانات والتعديلات المدخلة في ذاكرة الصفحة دون فقدان. يرجى تسجيل الدخول في نافذة جديدة لتجديد الجلسة ثم العودة هنا والضغط على زر &quot;إعادة محاولة الحفظ&quot; لإتمام العملية الأصلية.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <a
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="session-recovery-login-link"
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-block"
            >
              فتح شاشة تسجيل الدخول في نافذة جديدة ↗
            </a>
            <button
              type="submit"
              form={formDomId}
              data-testid="session-recovery-retry-button"
              className="px-3 py-1.5 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors"
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
            <span>⏳</span>
            <span>العملية الأصلية معلّقة بانتظار نتيجة مؤكدة</span>
          </div>
          <p className="text-xs leading-relaxed">
            أُبقيت العملية الأصلية بنفس المفتاح ونفس البيانات المجمّدة. الحقول معطّلة حتى تتأكد النتيجة؛
            إعادة المحاولة لا تنشئ عملية مكررة. إذا كنت تريد اعتماد تعديلات جديدة بدلاً منها، ابدأ تعديلاً جديداً صراحةً.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              form={formDomId}
              data-testid="operation-retry-button"
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[36px]"
            >
              إعادة محاولة العملية الأصلية
            </button>
            <button
              type="button"
              onClick={handleStartNewEdit}
              data-testid="operation-start-new-button"
              className="px-3 py-1.5 bg-white border border-[#14566B] text-[#14566B] text-xs font-semibold rounded-[6px] min-h-[36px]"
            >
              بدء تعديل جديد (يتخلى عن العملية المعلّقة)
            </button>
          </div>
        </div>
      )}

      {/* General Error Banner */}
      {generalError && (
        <div
          role="alert"
          data-testid="form-error-banner"
          className="p-4 bg-red-50 border border-red-200 rounded-[6px] text-[#A4262C] space-y-1"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⚠️</span>
            <span>تعذر إتمام العملية</span>
          </div>
          <p className="text-xs leading-relaxed">{generalError}</p>
        </div>
      )}

      <form
        id={formDomId}
        onSubmit={handleSubmit}
        onChange={() => setIsDirty(true)}
        className="space-y-6"
      >
        <fieldset disabled={operationPending || isSaving} className="space-y-6 border-0 p-0 m-0 min-w-0">
        {/* Section 1: Basic Information */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
            البيانات الأساسية للملف
          </h2>

          {/* Title */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-title`} className="block text-xs font-bold text-[#172A35]">
              عنوان الملف أو موضوعه <span className="text-red-600">*</span>
            </label>
            <input
              id={`${formId}-title`}
              type="text"
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: دعوى تعويض عن حادث سيارة ضد شركة التأمين"
              data-testid="matter-title-input"
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? `${formId}-title-error` : undefined}
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            />
            {fieldErrors.title && (
              <p id={`${formId}-title-error`} className="text-xs text-red-600 font-medium">
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Kind */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-kind`} className="block text-xs font-bold text-[#172A35]">
                طبيعة العمل القانوني <span className="text-red-600">*</span>
              </label>
              <select
                id={`${formId}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as MatterKind)}
                data-testid="matter-kind-select"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                {(['LITIGATION', 'CONSULTATION', 'CONTRACT', 'OTHER'] as MatterKind[]).map((k) => (
                  <option key={k} value={k}>
                    {MATTER_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            {/* Practice Area */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-practiceArea`} className="block text-xs font-bold text-[#172A35]">
                دائرة التخصص القانوني (اختياري)
              </label>
              <select
                id={`${formId}-practiceArea`}
                value={practiceAreaId}
                onChange={(e) => setPracticeAreaId(e.target.value)}
                data-testid="matter-practice-area-select"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="">— غير محدد —</option>
                {practiceAreas.map((pa) => {
                  const isCurrent = pa.id === practiceAreaId;
                  if (pa.isActive === false && !isCurrent) {
                    return (
                      <option key={pa.id} value={pa.id} disabled>
                        {pa.name} (معطل)
                      </option>
                    );
                  }
                  return (
                    <option key={pa.id} value={pa.id}>
                      {pa.name} {pa.isActive === false ? ' (معطل - تاريخي)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Opening Date */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-openingDate`} className="block text-xs font-bold text-[#172A35]">
                تاريخ فتح الملف بالمكتب
              </label>
              <input
                id={`${formId}-openingDate`}
                type="date"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
                data-testid="matter-opening-date-input"
                aria-invalid={Boolean(fieldErrors.openingDate)}
                aria-describedby={fieldErrors.openingDate ? `${formId}-openingDate-error` : undefined}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {fieldErrors.openingDate && <p id={`${formId}-openingDate-error`} className="text-xs text-red-700">{fieldErrors.openingDate}</p>}
            </div>

            {/* Status (Edit mode only - C14: excludes ARCHIVED in T06) */}
            {isEdit && (
              <div className="space-y-1">
                <label htmlFor={`${formId}-status`} className="block text-xs font-bold text-[#172A35]">
                  حالة الملف <span className="text-red-600">*</span>
                </label>
                <select
                  id={`${formId}-status`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as MatterStatus)}
                  data-testid="matter-status-select"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                >
                  <option value="ACTIVE">{MATTER_STATUS_LABELS.ACTIVE}</option>
                  <option value="DRAFT">{MATTER_STATUS_LABELS.DRAFT}</option>
                  <option value="ON_HOLD">{MATTER_STATUS_LABELS.ON_HOLD}</option>
                  <option value="CLOSED">{MATTER_STATUS_LABELS.CLOSED}</option>
                </select>
              </div>
            )}
          </div>

          {/* Closing Date if Closed */}
          {isEdit && status === 'CLOSED' && (
            <div className="space-y-1 pt-2">
              <label htmlFor={`${formId}-closingDate`} className="block text-xs font-bold text-[#172A35]">
                تاريخ إغلاق الملف
              </label>
              <input
                id={`${formId}-closingDate`}
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                data-testid="matter-closing-date-input"
                aria-invalid={Boolean(fieldErrors.closingDate)}
                aria-describedby={fieldErrors.closingDate ? `${formId}-closingDate-error` : undefined}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
              {fieldErrors.closingDate && <p id={`${formId}-closingDate-error`} className="text-xs text-red-700">{fieldErrors.closingDate}</p>}
            </div>
          )}
        </div>

        {/* Section 2: Initial Client Selection (Create Mode only - C17 Normalized Bounded Search) */}
        {!isEdit && (
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h2 className="text-base font-bold text-[#172A35]">
                الموكل الأساسي (اختياري عند الفتح)
              </h2>
              <span className="text-xs text-[#4D606A]">
                {selectedClientId ? 'سيتم فتح الملف كملف نشط' : 'سيتم فتح الملف كمسودة'}
              </span>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              يمكنك فتح الملف الآن كمسودة بدون موكل، ولكن لتنشيط الملف وبدء ربط التوكيلات والقيود القضائية يجب ربط موكل واحد على الأقل.
            </p>

            {selectedClient ? (
              <div
                data-testid="selected-client-card"
                className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-[6px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">👤</span>
                  <div>
                    <span className="text-sm font-bold text-emerald-900 block">
                      {selectedClient.name}
                    </span>
                    {selectedClient.primaryPhone && (
                      <bdi dir="ltr" className="text-xs text-emerald-700 font-mono">
                        {selectedClient.primaryPhone}
                      </bdi>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="remove-selected-client-button"
                  onClick={() => {
                    setSelectedClientId('');
                    setSelectedClientObj(null);
                    setIsDirty(true);
                  }}
                  className="text-xs font-semibold text-red-700 hover:text-red-900 p-1 rounded"
                >
                  إزالة واختيار موكل آخر
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  value={clientSearchQuery}
                  onChange={(e) => handleClientSearchChange(e.target.value)}
                  placeholder="ابحث عن موكل بالاسم (يدعم التوحيد اللغوي للألف والهمزة)..."
                  aria-label="البحث عن موكل في دليل الأطراف"
                  data-testid="client-search-input"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />

                {isSearchingClient ? (
                  <p className="text-xs text-[#4D606A] italic">جارٍ البحث في دليل الأطراف...</p>
                ) : clientSearchError ? (
                  <p className="text-xs text-red-600 font-medium">{clientSearchError}</p>
                ) : partiesList.length === 0 ? (
                  <p className="text-xs text-[#4D606A] italic">
                    لم يتم العثور على أطراف مطابقة للبحث. يمكنك حفظ الملف كمسودة أو{' '}
                    <Link
                      href="/parties/new?returnTo=/matters/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#14566B] underline font-bold"
                    >
                      إضافة طرف جديد في نافذة جديدة ↗
                    </Link>
                    {' '}ثم العودة لهذه الصفحة لاختياره (تبقى المسودة الحالية في الذاكرة).
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto divide-y divide-[#E8EEF1] border border-[#D5DFE3] rounded-[6px]">
                    {partiesList.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-testid={`select-client-option-${p.id}`}
                        onClick={() => {
                          setSelectedClientId(p.id);
                          setSelectedClientObj(p);
                          setIsDirty(true);
                        }}
                        className="w-full text-right p-2.5 text-xs hover:bg-[#F4F6F7] flex items-center justify-between transition-colors min-h-[40px]"
                      >
                        <span className="font-bold text-[#172A35]">{p.name}</span>
                        {p.primaryPhone ? (
                          <bdi dir="ltr" className="font-mono text-[#4D606A]">
                            {p.primaryPhone}
                          </bdi>
                        ) : (
                          <span className="text-[#4D606A]">بدون هاتف</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {clientSearchQuery.trim() && clientSearchTotalCount > 0 && (
                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-[#4D606A]">
                    <span data-testid="client-search-count">
                      عرض {partiesList.length} من {clientSearchTotalCount} — صفحة {clientSearchPage} من{' '}
                      {clientSearchTotalPages}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={clientSearchPage <= 1 || isSearchingClient}
                        onClick={() => runClientSearch(clientSearchQuery, clientSearchPage - 1)}
                        className="px-2 py-1 rounded border border-[#D5DFE3] bg-white disabled:opacity-40 min-h-[32px]"
                      >
                        السابق
                      </button>
                      <button
                        type="button"
                        disabled={clientSearchPage >= clientSearchTotalPages || isSearchingClient}
                        onClick={() => runClientSearch(clientSearchQuery, clientSearchPage + 1)}
                        className="px-2 py-1 rounded border border-[#D5DFE3] bg-white disabled:opacity-40 min-h-[32px]"
                      >
                        التالي
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section 3: Paper Location & Summary */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
            مكان الحفظ الورقي وملاحظات الملف
          </h2>

          {/* Paper Location */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-paperLocation`} className="block text-xs font-bold text-[#172A35]">
              مكان الحفظ الورقي بالمكتب (اختياري)
            </label>
            <select
              id={`${formId}-paperLocation`}
              value={paperLocationId}
              onChange={(e) => setPaperLocationId(e.target.value)}
              data-testid="matter-paper-location-select"
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            >
              <option value="">— غير محدد —</option>
              {storageLocations.map((loc) => {
                const isCurrent = loc.id === paperLocationId;
                if (loc.isActive === false && !isCurrent) {
                  return (
                    <option key={loc.id} value={loc.id} disabled>
                      {loc.name} (معطل)
                    </option>
                  );
                }
                return (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} {loc.isActive === false ? ' (معطل - تاريخي)' : ''}
                  </option>
                );
              })}
            </select>
            {!paperLocationId && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 mt-1">
                ⚠️ ترك مكان الحفظ فارغاً مسموح به، ولكن يفضل تحديده لتسهيل الرجوع للأوراق والمستندات الورقية في المكتب.
              </p>
            )}
          </div>

          {/* Summary */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-summary`} className="block text-xs font-bold text-[#172A35]">
              ملخص وقائع وموضوع الملف (اختياري)
            </label>
            <textarea
              id={`${formId}-summary`}
              rows={3}
              maxLength={2000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="اكتب نبذة مختصرة عن موضوع النزاع أو الاستشارة القانونية..."
              data-testid="matter-summary-textarea"
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-notes`} className="block text-xs font-bold text-[#172A35]">
              ملاحظات وتوجيهات داخلية (اختياري)
            </label>
            <textarea
              id={`${formId}-notes`}
              rows={2}
              maxLength={5000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات خاصة بمكتب المحاماة..."
              data-testid="matter-notes-textarea"
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed"
            />
          </div>
        </div>

        </fieldset>

        {/* Submit Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <Link
            href={isEdit && initialMatter ? `/matters/${initialMatter.id}` : '/matters'}
            replace
            onNavigate={() => {
              draft.clear();
              setIsDirty(false);
            }}
            className="w-full sm:w-auto px-5 py-2.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] text-center min-h-[44px] flex items-center justify-center transition-colors"
          >
            إلغاء والعودة
          </Link>

          <button
            type="submit"
            disabled={isSaving || operationPending}
            data-testid="matter-submit-button"
            className="w-full sm:w-auto px-8 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-sm font-bold rounded-[6px] shadow-xs min-h-[44px] flex items-center justify-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            {isSaving ? (
              <span>جارٍ الحفظ...</span>
            ) : isEdit ? (
              <span>حفظ التعديلات</span>
            ) : selectedClientId ? (
              <span>فتح الملف (نشط)</span>
            ) : (
              <span>حفظ كمسودة</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
