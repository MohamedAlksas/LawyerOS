'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { isUncertainHearingOutcome } from '@/components/hearings/hearing-recovery';
import type { ActionResult, CorrectHearingResultInput, HearingResultDTO, LinkableDocumentSummary, RecordHearingResultInput, RecordHearingResultResult } from '@/modules/scheduling/hearing-types';
import { DOCUMENT_TYPE_LABELS_AR, type DocumentDTO } from '@/modules/documents/document-types';
import { getLinkableDocumentScanBadgeClass } from '@/components/documents/document-ui-helpers';
import {
  HearingStatus,
  NextDateDisposition,
  TaskPriority,
  HEARING_STATUS_LABELS,
  formatRecordResultSummary,
} from '@/components/hearings/hearing-ui-types';
import { generateClientRequestId, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';

interface FollowUpTaskItem {
  id: string;
  title: string;
  dueDate: string;
  priority: TaskPriority;
}

interface HearingResultClientProps {
  actorId: string;
  history: { revision: number; decisionText: string; correctionReason: string | null }[];
  nextHearing?: { id: string; date: string; status: HearingStatus };
  hearingId: string;
  initialVersion: number;
  hearingDate: string; // YYYY-MM-DD
  hearingTime: string | null;
  status: HearingStatus;
  purpose: string | null;
  courtName: string;
  circuit: string | null;
  matterId: string;
  matterFileCode: string;
  proceedingId: string;
  canReadDocuments?: boolean;
  availableDocuments?: LinkableDocumentSummary[];
  documentsLoadError?: string;
  latestResult: {
    id: string;
    decisionText: string;
    revision: number;
    correctionReason: string | null;
    recordedAt: string;
    decisionDocumentId?: string | null;
    decisionDocument?: LinkableDocumentSummary | null;
  } | null;
}

async function saveHearing<T>(url: string, payload: unknown): Promise<ActionResult<T>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  return response.json();
}

export function HearingResultClient({
  actorId,
  history,
  nextHearing,
  hearingId,
  initialVersion,
  hearingDate,
  hearingTime,
  status: initialStatus,
  purpose,
  courtName,
  circuit,
  matterId,
  matterFileCode,
  proceedingId,
  canReadDocuments = false,
  availableDocuments = [],
  documentsLoadError,
  latestResult: initialLatestResult,
}: HearingResultClientProps) {
  const router = useRouter();
  const path = `/hearings/${hearingId}/result`;
  const endpoint = `/api/scheduling/hearings/${hearingId}`;
  const resultDraft = useFormDraft<RecordHearingResultInput>(`${actorId}:hearing-result`, path);
  const correctionDraft = useFormDraft<CorrectHearingResultInput>(`${actorId}:hearing-correction`, path);
  const pendingResult = useRef(resultDraft.restored);
  const pendingCorrection = useRef(correctionDraft.restored);
  const [linkedNext, setLinkedNext] = useState(nextHearing);
  const [currentStatus, setCurrentStatus] = useState<HearingStatus>(initialStatus);
  const [latestResult, setLatestResult] = useState(initialLatestResult);
  const [docsList, setDocsList] = useState<LinkableDocumentSummary[]>(availableDocuments);
  const [docsError, setDocsError] = useState<string | null>(documentsLoadError ?? null);
  const [isRetryingDocs, setIsRetryingDocs] = useState(false);
  const retryDocsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      retryDocsAbortRef.current?.abort();
    };
  }, []);

  // Form state
  const [decision, setDecision] = useState(resultDraft.restored?.decision ?? '');
  const [summary, setSummary] = useState(resultDraft.restored?.summary ?? '');
  const [attendance, setAttendance] = useState(resultDraft.restored?.attendance ?? '');
  const [decisionDocumentId, setDecisionDocumentId] = useState(resultDraft.restored?.decisionDocumentId ?? '');
  const [nextDateDisposition, setNextDateDisposition] = useState<NextDateDisposition>(resultDraft.restored?.nextDateDisposition ?? 'UNDETERMINED');
  const [nextHearingDate, setNextHearingDate] = useState(resultDraft.restored?.nextHearing?.hearingDate ?? '');
  const [nextHearingTime, setNextHearingTime] = useState(resultDraft.restored?.nextHearing?.hearingTime ?? '');
  const [tasks, setTasks] = useState<FollowUpTaskItem[]>(() =>
    (resultDraft.restored?.tasks ?? []).map((task, index) => ({
      id: String(index), title: task.title, dueDate: task.dueDate ?? '', priority: task.priority ?? 'NORMAL',
    })),
  );

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFrozenRetry, setIsFrozenRetry] = useState(Boolean(resultDraft.restored));
  const [sessionExpiredFor, setSessionExpiredFor] = useState<'result' | 'correction' | null>(null);
  const unknownOutcome = 'تعذر استلام تأكيد الحفظ. يمكنك إعادة محاولة نفس الطلب.';
  const [uncertaintyError, setUncertaintyError] = useState<string | null>(resultDraft.restored ? unknownOutcome : null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [savedDecision, setSavedDecision] = useState('');

  // Correction Mode states
  const [isCorrecting, setIsCorrecting] = useState(Boolean(correctionDraft.restored));
  const [correctionReason, setCorrectionReason] = useState(correctionDraft.restored?.reason ?? '');
  const [correctedDecision, setCorrectedDecision] = useState(correctionDraft.restored?.decision ?? '');
  const [correctedDecisionDocumentId, setCorrectedDecisionDocumentId] = useState(
    correctionDraft.restored?.decisionDocumentId ?? initialLatestResult?.decisionDocumentId ?? ''
  );
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionFrozen, setCorrectionFrozen] = useState(Boolean(correctionDraft.restored));
  const [correctionError, setCorrectionError] = useState<string | null>(correctionDraft.restored ? unknownOutcome : null);
  const [correctionSuccess, setCorrectionSuccess] = useState(false);

  const resultFieldsDisabled = isSubmitting || isFrozenRetry;
  const correctionFieldsDisabled = correctionSubmitting || correctionFrozen;
  const resultDirty = currentStatus === 'SCHEDULED' && !isFrozenRetry &&
    Boolean(decision || summary || attendance || decisionDocumentId || nextDateDisposition !== 'UNDETERMINED' || tasks.length);
  useLeaveGuard(
    resultDirty || (isCorrecting && !correctionFrozen),
    isSubmitting || correctionSubmitting
  );

  const handleAddTask = () => {
    const newTask: FollowUpTaskItem = {
      id: generateClientRequestId('task'),
      title: '',
      dueDate: '',
      priority: 'NORMAL',
    };
    setTasks((prev) => [...prev, newTask]);
  };

  const handleRemoveTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const handleUpdateTaskTitle = (taskId: string, title: string) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, title } : t)));
  };

  const handleUpdateTaskDue = (taskId: string, dueDate: string) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)));
  };

  const handleSaveResult = async () => {
    if (isSubmitting) return;
    if (!pendingResult.current) {
      if (!decision.trim()) {
        setValidationError('منطوق القرار أو نتيجة الجلسة مطلوب');
        return;
      }
      if (nextDateDisposition === 'KNOWN' && (!nextHearingDate || nextHearingDate < hearingDate)) {
        setValidationError('حدد تاريخ الجلسة القادمة بحيث لا يسبق تاريخ الجلسة الحالية');
        return;
      }
      if (tasks.some((task) => !task.title.trim())) {
        setValidationError('أدخل عنوانًا لكل مهمة متابعة أو احذف المهمة الفارغة');
        return;
      }
      pendingResult.current = {
        hearingId,
        expectedVersion: initialVersion,
        decision: decision.trim(),
        summary: summary.trim() || null,
        attendance: attendance.trim() || null,
        ...(canReadDocuments ? { decisionDocumentId: decisionDocumentId || null } : {}),
        nextDateDisposition,
        nextHearing: nextDateDisposition === 'KNOWN'
          ? { hearingDate: nextHearingDate, hearingTime: nextHearingTime || null, courtName, circuit }
          : null,
        tasks: tasks.map(({ title, dueDate, priority }) => ({ title: title.trim(), dueDate: dueDate || null, priority })),
        idempotencyKey: generateClientRequestId('res'),
      };
      resultDraft.keep(pendingResult.current);
    }
    setValidationError(null);
    setUncertaintyError(null);
    setConflictError(null);
    setSessionExpiredFor(null);
    setIsSubmitting(true);
    try {
      const response = await saveHearing<RecordHearingResultResult>(`${endpoint}/result`, pendingResult.current);
      if (!response.success) {
        if (isAuthRecoveryCode(response.code)) {
          setIsFrozenRetry(true);
          setSessionExpiredFor('result');
          return;
        }
        if (isUncertainHearingOutcome(response.code)) throw new Error(unknownOutcome);
        pendingResult.current = undefined;
        resultDraft.clear();
        setIsFrozenRetry(false);
        if (response.code === 'CONCURRENCY_CONFLICT' || response.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
          setConflictError(response.error);
        } else {
          setValidationError(response.error);
        }
        return;
      }
      const { hearing, result, nextHearing: savedNext } = response.data;
      pendingResult.current = undefined;
      resultDraft.clear();
      setIsFrozenRetry(false);
      setSessionExpiredFor(null);
      setSavedSuccess(true);
      setSavedDecision(result.decisionText);
      setCurrentStatus(hearing.status);
      setLatestResult({
        ...result,
        correctionReason: result.correctionReason ?? null,
        decisionDocumentId: result.decisionDocumentId ?? null,
        decisionDocument: result.decisionDocument ?? null,
      });
      if (savedNext) setLinkedNext({ id: savedNext.id, date: savedNext.hearingDate, status: savedNext.status });
      router.refresh();
    } catch {
      setIsFrozenRetry(true);
      setUncertaintyError(unknownOutcome);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveCorrection = async () => {
    if (correctionSubmitting) return;
    if (!pendingCorrection.current) {
      if (!latestResult || !correctionReason.trim() || !correctedDecision.trim()) {
        setCorrectionError('سبب التصحيح والمنطوق المصحح مطلوبان');
        return;
      }
      pendingCorrection.current = {
        hearingId,
        expectedVersion: latestResult.revision,
        currentResultId: latestResult.id,
        decision: correctedDecision.trim(),
        reason: correctionReason.trim(),
        ...(canReadDocuments ? { decisionDocumentId: correctedDecisionDocumentId || null } : {}),
        idempotencyKey: generateClientRequestId('corr'),
      };
      correctionDraft.keep(pendingCorrection.current);
    }
    setCorrectionError(null);
    setSessionExpiredFor(null);
    setCorrectionSubmitting(true);
    try {
      const response = await saveHearing<HearingResultDTO>(`${endpoint}/correct`, pendingCorrection.current);
      if (!response.success) {
        if (isAuthRecoveryCode(response.code)) {
          setCorrectionFrozen(true);
          setSessionExpiredFor('correction');
          return;
        }
        if (isUncertainHearingOutcome(response.code)) throw new Error(unknownOutcome);
        pendingCorrection.current = undefined;
        correctionDraft.clear();
        setCorrectionFrozen(false);
        setCorrectionError(response.error);
        if (response.code === 'CONCURRENCY_CONFLICT') setConflictError(response.error);
        return;
      }
      pendingCorrection.current = undefined;
      correctionDraft.clear();
      setCorrectionFrozen(false);
      setSessionExpiredFor(null);
      setCorrectionReason('');
      setCorrectionSuccess(true);
      setIsCorrecting(false);
      setLatestResult({
        ...response.data,
        correctionReason: response.data.correctionReason ?? null,
        decisionDocumentId: canReadDocuments ? (response.data.decisionDocumentId ?? null) : null,
        decisionDocument: canReadDocuments ? (response.data.decisionDocument ?? null) : null,
      });
      router.refresh();
    } catch {
      setCorrectionFrozen(true);
      setCorrectionError(unknownOutcome);
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const retryLoadDocuments = async () => {
    if (!canReadDocuments || isRetryingDocs) return;
    setIsRetryingDocs(true);
    setDocsError(null);
    retryDocsAbortRef.current?.abort();
    const controller = new AbortController();
    retryDocsAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`/api/documents?matterId=${encodeURIComponent(matterId)}&limit=100`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
      }
      const body = (await res.json().catch(() => null)) as
        | { success: true; data: { documents: DocumentDTO[] } }
        | { success: false; error?: string }
        | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !body || !body.success) {
        setDocsError(
          (body && !body.success && body.error) || 'تعذر تحميل مستندات الملف الجاهزة من الخادم.'
        );
        return;
      }
      setDocsList(
        body.data.documents
          .filter(
            (d) =>
              !d.archivedAt &&
              d.currentVersionId &&
              d.currentVersion?.isReady &&
              (!d.proceedingId || d.proceedingId === proceedingId) &&
              (!d.hearingId || d.hearingId === hearingId)
          )
          .map((d) => ({
            id: d.id,
            title: d.title,
            documentType: d.documentType,
            currentVersionId: d.currentVersionId,
            scanStatus: d.currentVersion!.scanStatus,
            scanStatusLabel: d.currentVersion!.scanStatusLabel,
            proceedingId: d.proceedingId,
            hearingId: d.hearingId,
          }))
      );
      setDocsError(null);
    } catch {
      if (controller.signal.aborted) return;
      setDocsError('تعذر تحميل مستندات الملف بسبب انقطاع الاتصال.');
    } finally {
      clearTimeout(timeoutId);
      if (!controller.signal.aborted) {
        setIsRetryingDocs(false);
      }
    }
  };

  const summaryText = formatRecordResultSummary({
    nextDate: nextDateDisposition === 'KNOWN' && nextHearingDate.trim() ? nextHearingDate.trim() : null,
    taskCount: tasks.filter((t) => t.title.trim().length > 0).length,
  });

  const isPreservedDecisionDocExcluded =
    Boolean(latestResult?.decisionDocument) &&
    !docsError &&
    !docsList.some((doc) => doc.id === latestResult?.decisionDocument?.id);

  const correctionSelectableDocuments =
    latestResult?.decisionDocument &&
    !docsList.some((doc) => doc.id === latestResult.decisionDocument?.id)
      ? [latestResult.decisionDocument, ...docsList]
      : docsList;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12" dir="rtl" lang="ar-EG">
      {/* Navigation Breadcrumb */}
      <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] flex items-center gap-1.5 flex-wrap">
        <Link href={`/matters/${matterId}`} className="hover:text-[#14566B] hover:underline font-mono">
          <bdi dir="ltr">{matterFileCode}</bdi>
        </Link>
        <span>/</span>
        <Link
          href={`/matters/${matterId}/proceedings/${proceedingId}`}
          className="hover:text-[#14566B] hover:underline"
        >
          القيد القضائي
        </Link>
        <span>/</span>
        <Link href={`/hearings/${hearingId}`} className="hover:text-[#14566B] hover:underline">
          جلسة <bdi dir="ltr">{hearingDate}</bdi>
        </Link>
        <span>/</span>
        <span className="text-[#172A35] font-semibold">تسجيل النتيجة</span>
      </nav>

      {/* Header Card */}
      <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8EEF1] pb-3">
          <div className="space-y-0.5">
            <h1 className="text-lg sm:text-xl font-bold text-[#172A35] flex items-center gap-2">
              <span>تسجيل قرار ونتيجة الجلسة</span>
            </h1>
            <p className="text-xs text-[#4D606A]">
              جلسة يوم <bdi dir="ltr" className="font-semibold text-[#172A35] font-mono">{hearingDate}</bdi>
              {' • '}
              {hearingTime ? (
                <bdi dir="ltr" className="font-mono">{hearingTime}</bdi>
              ) : (
                <span data-testid="hearing-unknown-time" className="italic text-[#64748B]">
                  الساعة غير محددة
                </span>
              )}
            </p>
          </div>
          <div className="text-xs text-[#4D606A]">
            <span className="font-semibold">{courtName}</span>
            {circuit && <span> — {circuit}</span>}
          </div>
        </div>
        {purpose && (
          <p className="text-xs text-[#4D606A]">
            <span className="font-semibold">الغرض الأساسي:</span> {purpose}
          </p>
        )}
      </div>

      {/* Concurrency Conflict Banner (T08-TC-05) */}
      {conflictError && (
        <div
          role="alert"
          data-testid="conflict-error-banner"
          className="p-4 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>تضارب في تحديث السجل</span>
          </div>
          <p className="leading-relaxed">
            {conflictError}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-700 text-white font-bold rounded-[6px] hover:bg-red-800 transition-colors min-h-[44px]"
            >
              تحديث الصفحة الآن
            </button>
          </div>
        </div>
      )}

      {/* Session Expiry Recovery Banner */}
      {sessionExpiredFor && (
        <div
          role="alert"
          data-testid="hearing-session-recovery-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3 text-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>انتهت صلاحية الجلسة أو يلزم استكمال التحقق</span>
          </div>
          <p className="leading-relaxed">
            تم الاحتفاظ بالبيانات ومفتاح الطلب الأصلي لمنع التكرار. سجّل الدخول في نافذة جديدة ثم أعد المحاولة.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="hearing-session-login-link"
              className="px-3 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-flex items-center min-h-[44px]"
            >
              فتح شاشة تسجيل الدخول في نافذة جديدة ↗
            </a>
            <button
              type="button"
              onClick={sessionExpiredFor === 'correction' ? handleSaveCorrection : handleSaveResult}
              disabled={isSubmitting || correctionSubmitting}
              data-testid="hearing-session-retry-btn"
              className="px-3 py-2 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors min-h-[44px]"
            >
              إعادة المحاولة بنفس المفتاح
            </button>
          </div>
        </div>
      )}

      {/* Uncertainty / Network Disconnection Banner (T08-TC-03 & T08-TC-07) */}
      {!sessionExpiredFor && (uncertaintyError || isFrozenRetry) && (
        <div
          role="alert"
          data-testid="uncertainty-error-banner"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>تعذر استلام تأكيد الخادم (حالة عدم يقين في الشبكة)</span>
          </div>
          <p className="leading-relaxed">
            {uncertaintyError}
          </p>
          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveResult}
              disabled={isSubmitting}
              data-testid="record-result-retry-btn"
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5"
            >
              <span>إعادة المحاولة وحفظ النتيجة</span>
            </button>
          </div>
        </div>
      )}

      {/* Success Banner */}
      {savedSuccess && (
        <div
          role="status"
          aria-live="polite"
          data-testid="save-success-banner"
          className="p-4 bg-emerald-50 border border-emerald-300 rounded-[6px] text-xs text-emerald-900 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>تم حفظ النتيجة بنجاح!</span>
          </div>
          <p className="font-semibold text-emerald-800">{savedDecision}</p>
          {canReadDocuments && latestResult?.decisionDocumentId && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="font-semibold text-emerald-900">مستند القرار المرتبط:</span>
              <Link
                href={`/documents/${latestResult.decisionDocumentId}`}
                data-testid="hearing-decision-document-link"
                className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 bg-white border border-emerald-300 rounded-[6px] text-[#14566B] font-semibold hover:bg-emerald-100 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
              >
                <bdi className="[overflow-wrap:anywhere]">
                  {latestResult.decisionDocument?.title ?? 'عرض مستند القرار'}
                </bdi>
                {latestResult.decisionDocument && (
                  <span className="text-[11px] text-[#4D606A]">
                    ({DOCUMENT_TYPE_LABELS_AR[latestResult.decisionDocument.documentType]})
                  </span>
                )}
                {latestResult.decisionDocument?.scanStatusLabel && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-semibold border ${getLinkableDocumentScanBadgeClass(latestResult.decisionDocument)}`}
                  >
                    {latestResult.decisionDocument.scanStatusLabel}
                  </span>
                )}
              </Link>
            </div>
          )}
          <div className="pt-1 flex gap-2">
            <Link
              href={`/hearings/${hearingId}`}
              className="px-3 py-1.5 bg-emerald-700 text-white rounded-[4px] text-xs font-bold min-h-[44px] inline-flex items-center"
            >
              عرض تفاصيل الجلسة
            </Link>
          </div>
        </div>
      )}
      {linkedNext && (
        <div className="rounded-[8px] border border-[#D5DFE3] bg-white p-4 text-sm">
          <Link href={`/hearings/${linkedNext.id}`} data-testid="linked-next-hearing" className="font-bold text-[#14566B] underline">
            الجلسة المرتبطة <bdi dir="ltr">{linkedNext.date}</bdi> ({HEARING_STATUS_LABELS[linkedNext.status]})
          </Link>
          {' · '}
          <Link href={`/matters/${matterId}/proceedings/${proceedingId}`} className="text-[#14566B] underline">
            عرض الموعد أو تغييره من القيد
          </Link>
        </div>
      )}

      {/* Correction Success Banner */}
      {correctionSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-emerald-50 border border-emerald-300 rounded-[6px] text-xs text-emerald-900 font-bold"
        >
          تم حفظ التصحيح بنجاح!
        </div>
      )}

      {/* When Hearing Already Has a Persisted Result -> Display Result & Correction Option */}
      {(currentStatus === 'COMPLETED' || latestResult) && !savedSuccess && (
        <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[#E8EEF1] pb-3">
            <div className="space-y-0.5">
              <h2 className="text-base font-bold text-[#172A35] flex items-center gap-2">
                <span>النتيجة المسجلة الحالية</span>
              </h2>
              <span className="text-xs text-[#4D606A]">
                المراجعة #{latestResult?.revision || 1}
              </span>
            </div>
            {!isCorrecting && !isFrozenRetry && latestResult && (
              <button
                type="button"
                onClick={() => {
                  setIsCorrecting(true);
                  setCorrectionReason('');
                  setCorrectionSuccess(false);
                  setCorrectionError(null);
                  setCorrectedDecision(latestResult?.decisionText || '');
                  setCorrectedDecisionDocumentId(latestResult?.decisionDocumentId ?? '');
                }}
                data-testid="correct-result-button"
                className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
              >
                تصحيح نتيجة الجلسة
              </button>
            )}
          </div>

          <div className="p-4 bg-teal-50 border border-teal-200 rounded-[6px] space-y-1">
            <span className="text-xs font-bold text-[#14566B] block">قرار المحكمة:</span>
            <p
              data-testid="persisted-decision-text"
              className="text-sm font-bold text-[#172A35] whitespace-pre-wrap leading-relaxed"
            >
              {latestResult?.decisionText}
            </p>
          </div>

          {canReadDocuments && latestResult?.decisionDocumentId && (
            <div className="p-3 bg-[#F8FAFB] border border-[#D5DFE3] rounded-[6px] text-xs flex flex-wrap items-center gap-2">
              <span className="font-bold text-[#4D606A]">مستند القرار المرتبط:</span>
              <Link
                href={`/documents/${latestResult.decisionDocumentId}`}
                data-testid="hearing-decision-document-link"
                className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-[6px] bg-white border border-[#D5DFE3] text-[#14566B] hover:bg-[#E8EEF1] font-semibold min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
              >
                <bdi className="[overflow-wrap:anywhere]">
                  {latestResult.decisionDocument?.title ?? 'عرض مستند القرار'}
                </bdi>
                {latestResult.decisionDocument && (
                  <span className="text-[11px] text-[#4D606A]">
                    ({DOCUMENT_TYPE_LABELS_AR[latestResult.decisionDocument.documentType]})
                  </span>
                )}
                {latestResult.decisionDocument?.scanStatusLabel && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-semibold border ${getLinkableDocumentScanBadgeClass(latestResult.decisionDocument)}`}
                  >
                    {latestResult.decisionDocument.scanStatusLabel}
                  </span>
                )}
              </Link>
            </div>
          )}

          {history.some((result) => result.revision < (latestResult?.revision ?? 0)) && (
            <details className="rounded-[6px] border border-[#D5DFE3] p-3 text-xs">
              <summary className="cursor-pointer font-bold">مراجعات النتيجة السابقة</summary>
              {history.filter((result) => result.revision < (latestResult?.revision ?? 0)).map((result) => (
                <div key={result.revision} className="border-t border-[#E8EEF1] py-2">
                  <p className="font-semibold">مراجعة {result.revision}</p>
                  <p className="whitespace-pre-wrap">{result.decisionText}</p>
                  {result.correctionReason && <p>{result.correctionReason}</p>}
                </div>
              ))}
            </details>
          )}
          {latestResult?.correctionReason && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
              <span className="font-bold">سبب التصحيح السابق: </span>
              <span>{latestResult.correctionReason}</span>
            </div>
          )}

          {/* Inline Result Correction Form (T08-TC-05) */}
          {isCorrecting && (
            <div className="pt-4 border-t border-[#E8EEF1] space-y-4">
              <h3 className="font-bold text-sm text-[#172A35]">إجراء تصحيح رسمي على النتيجة</h3>
              {correctionError && (
                <p role="alert" className="text-xs text-red-600 font-semibold">{correctionError}</p>
              )}
              <div className="space-y-1 text-xs">
                <label htmlFor="correction-reason" className="block font-bold text-[#172A35]">
                  سبب التصحيح <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="correction-reason"
                  name="correctionReason"
                  rows={2}
                  required
                  placeholder="أدخل سبب تصحيح نتيجة الجلسة (إلزامي للتوثيق)"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  disabled={correctionFieldsDisabled}
                  className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs focus:ring-2 focus:ring-[#14566B]"
                />
              </div>

              <div className="space-y-1 text-xs">
                <label htmlFor="corrected-decision" className="block font-bold text-[#172A35]">
                  المنطوق المصحح <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="corrected-decision"
                  name="correctedDecision"
                  rows={3}
                  required
                  placeholder="أدخل منطوق القرار أو النتيجة المصححة"
                  value={correctedDecision}
                  onChange={(e) => setCorrectedDecision(e.target.value)}
                  disabled={correctionFieldsDisabled}
                  className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs focus:ring-2 focus:ring-[#14566B]"
                />
              </div>

              {canReadDocuments && (
                <div className="space-y-1 text-xs">
                  <label htmlFor="correction-decision-document-select" className="block font-bold text-[#172A35]">
                    مستند القرار المرتبط (اختياري)
                  </label>
                  <select
                    id="correction-decision-document-select"
                    data-testid="hearing-decision-document-select"
                    value={correctedDecisionDocumentId}
                    onChange={(e) => setCorrectedDecisionDocumentId(e.target.value)}
                    disabled={correctionFieldsDisabled}
                    className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-base sm:text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                  >
                    <option value="">بدون مستند قرار مرتبط (اختياري)</option>
                    {correctionSelectableDocuments.map((doc) => {
                      const isArchivedPreserved =
                        isPreservedDecisionDocExcluded &&
                        doc.id === latestResult?.decisionDocument?.id;
                      return (
                        <option key={doc.id} value={doc.id}>
                          {doc.title} — {DOCUMENT_TYPE_LABELS_AR[doc.documentType]}
                          {isArchivedPreserved ? ' (مؤرشف)' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {docsError && (
                    <div
                      role="alert"
                      data-testid="hearing-documents-load-error"
                      className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-[#A4262C]"
                    >
                      <span>{docsError}</span>
                      <button
                        type="button"
                        disabled={isRetryingDocs}
                        onClick={() => void retryLoadDocuments()}
                        className="px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-semibold rounded-[6px] min-h-[44px] shrink-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
                      >
                        {isRetryingDocs ? 'جارٍ التحميل...' : 'إعادة المحاولة'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCorrecting(false);
                    setCorrectionReason('');
                    setCorrectionError(null);
                  }}
                  disabled={correctionFieldsDisabled}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveCorrection}
                  disabled={correctionSubmitting}
                  data-testid="save-correction-btn"
                  className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
                >
                  {correctionSubmitting ? 'جارٍ حفظ التصحيح...' : correctionFrozen ? 'إعادة محاولة حفظ التصحيح' : 'حفظ التصحيح'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Unavailable Result Notice for Cancelled / Rescheduled Hearings */}
      {!savedSuccess && !latestResult && !isFrozenRetry && (currentStatus === 'CANCELLED' || currentStatus === 'RESCHEDULED') && (
        <div
          data-testid="hearing-result-unavailable-banner"
          className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-3 text-xs text-[#172A35]"
        >
          <p className="font-bold text-sm">
            لا يمكن تسجيل نتيجة لهذه الجلسة لأن حالتها «{HEARING_STATUS_LABELS[currentStatus]}».
          </p>
          <p className="text-[#4D606A] leading-relaxed">
            الجلسات الملغاة أو المعاد جدولتها لم تنعقد ولا يُسجل لها منطوق قرار.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href={`/hearings/${hearingId}`}
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded-[6px] min-h-[44px] inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
            >
              العودة لتفاصيل الجلسة
            </Link>
            <Link
              href={`/matters/${matterId}/proceedings/${proceedingId}`}
              className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
            >
              عرض القيد القضائي
            </Link>
          </div>
        </div>
      )}

      {/* Main Result Entry Form (When not yet completed or submitting) */}
      {!savedSuccess && (currentStatus === 'SCHEDULED' || isFrozenRetry) && (
        <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-5">
          {validationError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-xs text-red-900 font-semibold">
              {validationError}
            </div>
          )}

          {/* Decision / Ruling Input (Required) */}
          <div className="space-y-1 text-xs">
            <label htmlFor="hearing-decision-input" className="block font-bold text-[#172A35]">
              منطوق القرار أو نتيجة الجلسة <span className="text-red-600">*</span>
            </label>
            <textarea
              id="hearing-decision-input"
              name="decision"
              rows={3}
              required
              placeholder="مثال: تأجيل لتقديم مذكرة ومستندات، أو حجز للحكم لجلسة..."
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              disabled={resultFieldsDisabled}
              data-testid="hearing-decision-textarea"
              className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <label className="space-y-1 font-semibold">
              <span>ملخص الجلسة (اختياري)</span>
              <textarea value={summary} maxLength={1000} disabled={resultFieldsDisabled} onChange={(event) => setSummary(event.target.value)} className="w-full rounded-[6px] border border-[#D5DFE3] p-2" />
            </label>
            <label className="space-y-1 font-semibold">
              <span>الحضور (اختياري)</span>
              <input value={attendance} maxLength={500} disabled={resultFieldsDisabled} onChange={(event) => setAttendance(event.target.value)} className="w-full rounded-[6px] border border-[#D5DFE3] p-2" />
            </label>
          </div>

          {canReadDocuments && (
            <div className="space-y-1 text-xs">
              <label htmlFor="hearing-decision-document-select" className="block font-bold text-[#172A35]">
                مستند القرار المرتبط (اختياري)
              </label>
              <select
                id="hearing-decision-document-select"
                data-testid="hearing-decision-document-select"
                value={decisionDocumentId}
                onChange={(e) => setDecisionDocumentId(e.target.value)}
                disabled={resultFieldsDisabled}
                className="w-full p-2.5 bg-white border border-[#D5DFE3] rounded-[6px] text-base sm:text-xs text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="">بدون مستند قرار مرتبط (اختياري)</option>
                {docsList.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title} — {DOCUMENT_TYPE_LABELS_AR[doc.documentType]}
                  </option>
                ))}
              </select>
              {docsError && (
                <div
                  role="alert"
                  data-testid="hearing-documents-load-error"
                  className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-[#A4262C]"
                >
                  <span>{docsError}</span>
                  <button
                    type="button"
                    disabled={isRetryingDocs}
                    onClick={() => void retryLoadDocuments()}
                    className="px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-semibold rounded-[6px] min-h-[44px] shrink-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
                  >
                    {isRetryingDocs ? 'جارٍ التحميل...' : 'إعادة المحاولة'}
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Next Date Radio Group */}
          <div className="space-y-2 p-3.5 bg-slate-50 border border-slate-200 rounded-[6px] text-xs">
            <span className="block font-bold text-[#172A35]">
              هل تقرر تأجيل الجلسة لموعد قادم؟ <span className="text-red-600">*</span>
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label
                className={`p-2.5 rounded-[6px] border text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5 focus-within:ring-2 focus-within:ring-[#14566B] focus-within:ring-offset-1 ${
                  nextDateDisposition === 'KNOWN'
                    ? 'bg-[#14566B] text-white border-[#14566B] font-bold'
                    : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="nextDateDisposition"
                  value="KNOWN"
                  checked={nextDateDisposition === 'KNOWN'}
                  disabled={resultFieldsDisabled}
                  onChange={() => setNextDateDisposition('KNOWN')}
                  className="sr-only"
                />
                <span>نعم، يوجد موعد قادم (تأجيل لتاريخ محدد)</span>
              </label>

              <label
                className={`p-2.5 rounded-[6px] border text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5 focus-within:ring-2 focus-within:ring-[#14566B] focus-within:ring-offset-1 ${
                  nextDateDisposition === 'UNDETERMINED'
                    ? 'bg-[#14566B] text-white border-[#14566B] font-bold'
                    : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="nextDateDisposition"
                  value="UNDETERMINED"
                  checked={nextDateDisposition === 'UNDETERMINED'}
                  disabled={resultFieldsDisabled}
                  onChange={() => setNextDateDisposition('UNDETERMINED')}
                  className="sr-only"
                />
                <span>لم يحدد موعد بعد</span>
              </label>

              <label
                className={`p-2.5 rounded-[6px] border text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5 focus-within:ring-2 focus-within:ring-[#14566B] focus-within:ring-offset-1 ${
                  nextDateDisposition === 'NONE'
                    ? 'bg-[#14566B] text-white border-[#14566B] font-bold'
                    : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="nextDateDisposition"
                  value="NONE"
                  checked={nextDateDisposition === 'NONE'}
                  disabled={resultFieldsDisabled}
                  onChange={() => setNextDateDisposition('NONE')}
                  className="sr-only"
                />
                <span>لا توجد جلسة أخرى (حكم منهي للخصومة)</span>
              </label>
            </div>

            {/* Next Date Input */}
            {nextDateDisposition === 'KNOWN' && (
              <div className="pt-2">
                <label htmlFor="next-hearing-date-input" className="block font-bold text-[#172A35] mb-1">
                  تاريخ الجلسة القادمة <span className="text-red-600">*</span>
                </label>
                <input
                  id="next-hearing-date-input"
                  name="nextHearingDate"
                  type="date"
                  dir="ltr"
                  required
                  value={nextHearingDate}
                  onChange={(e) => setNextHearingDate(e.target.value)}
                  disabled={resultFieldsDisabled}
                  min={hearingDate}
                  data-testid="next-hearing-date-input"
                  className="w-full sm:w-64 p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />
                <label className="mt-2 block font-bold text-[#172A35]">
                  وقت الجلسة القادمة (اختياري)
                  <input type="time" dir="ltr" value={nextHearingTime} disabled={resultFieldsDisabled} onChange={(event) => setNextHearingTime(event.target.value)} className="mt-1 block min-h-[44px] w-full rounded-[6px] border border-[#D5DFE3] p-2 sm:w-64" />
                </label>
              </div>
            )}
          </div>

          {/* Follow-up Tasks Section */}
          <div className="space-y-3 p-3.5 bg-slate-50 border border-slate-200 rounded-[6px] text-xs">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="font-bold text-[#172A35]">مهام المتابعة الناتجة عن الجلسة (اختياري)</h3>
                <p className="text-xs text-[#4D606A]">
                  مهام عمل تنشأ ذرياً وتكلف للمكتب لمتابعة إجراءات الجلسة
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddTask}
                disabled={resultFieldsDisabled}
                data-testid="add-task-button"
                className="px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1"
              >
                <span>إضافة مهمة عمل مطلوبة</span>
              </button>
            </div>

            {tasks.length > 0 && (
              <div className="space-y-2 pt-1">
                {tasks.map((task, idx) => (
                  <div
                    key={task.id}
                    data-testid={`task-item-${idx}`}
                    className="p-3 bg-white rounded-[6px] border border-[#D5DFE3] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#14566B]">مهمة #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTask(task.id)}
                        disabled={resultFieldsDisabled}
                        className="text-red-600 hover:text-red-800 text-xs font-semibold p-1 min-h-[44px] flex items-center"
                      >
                        ✕ حذف
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label htmlFor={`task-title-${task.id}`} className="block text-[11px] font-semibold text-[#172A35]">
                          عنوان المهمة <span className="text-red-600">*</span>
                        </label>
                        <input
                          id={`task-title-${task.id}`}
                          type="text"
                          name={`task_title_${idx}`}
                          required
                          placeholder="مثال: إعداد مذكرة الدفاع بالدفوع الشكلية"
                          value={task.title}
                          onChange={(e) => handleUpdateTaskTitle(task.id, e.target.value)}
                          disabled={resultFieldsDisabled}
                          data-testid={`task-title-${idx}`}
                          className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor={`task-due-${task.id}`} className="block text-[11px] font-semibold text-[#172A35]">
                          تاريخ الاستحقاق (اختياري)
                        </label>
                        <input
                          id={`task-due-${task.id}`}
                          type="date"
                          dir="ltr"
                          name={`task_due_${idx}`}
                          value={task.dueDate}
                          onChange={(e) => handleUpdateTaskDue(task.id, e.target.value)}
                          disabled={resultFieldsDisabled}
                          data-testid={`task-due-${idx}`}
                          className="w-full p-2 bg-white border border-[#D5DFE3] rounded-[6px] text-xs text-[#172A35] focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Pre-Save Confirmation Banner (Mandatory T08-TC-02 & T08-TC-07) */}
          <div
            role="region"
            aria-label="ملخص ما قبل الحفظ"
            data-testid="presave-summary-banner"
            className="p-4 bg-teal-50 border-2 border-[#14566B]/30 rounded-[8px] text-[#14566B] space-y-1 shadow-xs"
          >
            <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
              <span className="text-sm sm:text-base text-[#172A35] font-bold">
                «{summaryText}»
              </span>
            </div>
            <p className="text-[11px] text-[#4D606A] leading-relaxed">
              عملية ذرية واحدة تضمن تحديث حالة الجلسة وإضافة الجلسة القادمة والمهام المقترنة معاً.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[#E8EEF1]">
            <Link
              href={`/hearings/${hearingId}`}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-[#172A35] text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
            >
              إلغاء
            </Link>
            <button
              type="button"
              onClick={handleSaveResult}
              disabled={resultFieldsDisabled}
              data-testid="save-hearing-result-btn"
              className="px-6 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:bg-gray-400 text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span>جارٍ الحفظ الذري...</span>
                </>
              ) : (
                <>
                  <span>تأكيد وحفظ النتيجة</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
