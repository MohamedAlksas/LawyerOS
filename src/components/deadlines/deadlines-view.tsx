'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  createDeadlineAction,
  updateDeadlineDraftAction,
  confirmDeadlineAction,
  changeDeadlineDateAction,
  completeDeadlineAction,
  cancelDeadlineAction,
} from '@/modules/scheduling/deadline-actions';
import type {
  ActionResult,
  ChangeDeadlineDateInput,
  CompleteDeadlineInput,
  ConfirmDeadlineInput,
  CreateDeadlineInput,
  DeadlineDTO,
  LinkableDocumentSummary,
  UpdateDeadlineDraftInput,
} from '@/modules/scheduling/deadline-types';
import { DOCUMENT_TYPE_LABELS_AR, type DocumentDTO } from '@/modules/documents/document-types';
import type { SelectableMatterOptionDTO } from '@/modules/productivity/productivity-types';
import { formatCairoDateArabic, getCairoTodayDateString } from '@/lib/cairo-date';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { LoadingIndicator, ErrorContainer, EmptyStateContainer } from '@/components/presentation-state';
import { generateClientRequestId, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';
import {
  DEADLINE_STATUS_CLASSES,
  DEADLINE_STATUS_LABELS,
  formatCairoInstantArabic,
  isUncertainMutationOutcome,
  renderModalPortal,
  useAccessibleModal,
} from '@/components/productivity/productivity-ui-types';

interface DeadlinesViewProps {
  actorId: string;
  initialDeadlines: DeadlineDTO[];
  selectableMatters: SelectableMatterOptionDTO[];
  matterDocuments?: LinkableDocumentSummary[];
  initialDocumentsByMatter?: Record<string, LinkableDocumentSummary[]>;
  initialError?: string;
  initialReviewDeadlineId?: string;
  lockedMatterId?: string;
  lockedMatterProceedings?: Array<{ id: string; label: string; courtId: string; courtName: string }>;
  isReadOnly?: boolean;
  onDataChanged?: () => void;
}

type PendingDeadlineDraftOp =
  | { kind: 'createDraft'; payload: CreateDeadlineInput }
  | { kind: 'updateDraft'; payload: UpdateDeadlineDraftInput }
  | { kind: 'confirm'; payload: ConfirmDeadlineInput }
  | {
      kind: 'createAndConfirm';
      createPayload: CreateDeadlineInput;
      confirmIdempotencyKey: string;
    }
  | {
      kind: 'updateAndConfirm';
      updatePayload: UpdateDeadlineDraftInput;
      confirmPayload: Omit<ConfirmDeadlineInput, 'expectedVersion'>;
    };

type PendingChangeDateOp = ChangeDeadlineDateInput;
type PendingCompleteOp = CompleteDeadlineInput;

export function DeadlinesView({
  actorId,
  initialDeadlines,
  selectableMatters,
  matterDocuments,
  initialDocumentsByMatter,
  initialError,
  initialReviewDeadlineId,
  lockedMatterId,
  lockedMatterProceedings,
  isReadOnly = false,
  onDataChanged,
}: DeadlinesViewProps) {
  const router = useRouter();
  const scopePath = lockedMatterId ? `/matters/${lockedMatterId}` : '/deadlines';

  const draftModalDraft = useFormDraft<PendingDeadlineDraftOp>(
    `${actorId}:deadline-draft-op:${lockedMatterId ?? 'all'}`,
    scopePath
  );
  const changeDateDraft = useFormDraft<PendingChangeDateOp>(
    `${actorId}:deadline-date-op:${lockedMatterId ?? 'all'}`,
    scopePath
  );
  const completeDraft = useFormDraft<PendingCompleteOp>(
    `${actorId}:deadline-complete-op:${lockedMatterId ?? 'all'}`,
    scopePath
  );

  const [deadlines, setDeadlines] = useState<DeadlineDTO[]>(initialDeadlines);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const initialReviewTarget = initialReviewDeadlineId
    ? initialDeadlines.find((d) => d.id === initialReviewDeadlineId && d.status === 'DRAFT') ?? null
    : null;

  const restoredDraftOp = draftModalDraft.restored;
  const restoredTargetId =
    restoredDraftOp?.kind === 'updateDraft'
      ? restoredDraftOp.payload.deadlineId
      : restoredDraftOp?.kind === 'confirm'
      ? restoredDraftOp.payload.deadlineId
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.updatePayload.deadlineId
      : undefined;
  const initialDraftTarget = restoredTargetId
    ? initialDeadlines.find((d) => d.id === restoredTargetId) ?? initialReviewTarget
    : restoredDraftOp
    ? null
    : initialReviewTarget;

  // Draft / Confirm Modal State
  const [isDraftModalOpen, setIsDraftModalOpen] = useState(
    Boolean(restoredDraftOp || initialReviewTarget)
  );
  const [editingDeadline, setEditingDeadline] = useState<DeadlineDTO | null>(initialDraftTarget);
  const [title, setTitle] = useState(
    restoredDraftOp?.kind === 'createDraft'
      ? restoredDraftOp.payload.title
      : restoredDraftOp?.kind === 'createAndConfirm'
      ? restoredDraftOp.createPayload.title
      : restoredDraftOp?.kind === 'updateDraft'
      ? restoredDraftOp.payload.title ?? initialDraftTarget?.title ?? ''
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.updatePayload.title ?? initialDraftTarget?.title ?? ''
      : initialDraftTarget?.title ?? ''
  );
  const [matterId, setMatterId] = useState(
    lockedMatterId ??
      (restoredDraftOp?.kind === 'createDraft'
        ? restoredDraftOp.payload.matterId
        : restoredDraftOp?.kind === 'createAndConfirm'
        ? restoredDraftOp.createPayload.matterId
        : initialDraftTarget?.matterId) ??
      ''
  );
  const [proceedingId, setProceedingId] = useState(
    restoredDraftOp?.kind === 'createDraft'
      ? restoredDraftOp.payload.proceedingId ?? ''
      : restoredDraftOp?.kind === 'createAndConfirm'
      ? restoredDraftOp.createPayload.proceedingId ?? ''
      : restoredDraftOp?.kind === 'updateDraft'
      ? restoredDraftOp.payload.proceedingId ?? initialDraftTarget?.proceedingId ?? ''
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.updatePayload.proceedingId ?? initialDraftTarget?.proceedingId ?? ''
      : initialDraftTarget?.proceedingId ?? ''
  );
  const [dueDate, setDueDate] = useState(
    restoredDraftOp?.kind === 'createDraft' || restoredDraftOp?.kind === 'updateDraft' || restoredDraftOp?.kind === 'confirm'
      ? restoredDraftOp.payload.dueDate ?? initialDraftTarget?.dueDate ?? ''
      : restoredDraftOp?.kind === 'createAndConfirm'
      ? restoredDraftOp.createPayload.dueDate ?? ''
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.confirmPayload.dueDate ?? initialDraftTarget?.dueDate ?? ''
      : initialDraftTarget?.dueDate ?? ''
  );
  const [dueTime, setDueTime] = useState(
    restoredDraftOp?.kind === 'createDraft' || restoredDraftOp?.kind === 'updateDraft' || restoredDraftOp?.kind === 'confirm'
      ? restoredDraftOp.payload.dueTime ?? initialDraftTarget?.dueTime ?? ''
      : restoredDraftOp?.kind === 'createAndConfirm'
      ? restoredDraftOp.createPayload.dueTime ?? ''
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.confirmPayload.dueTime ?? initialDraftTarget?.dueTime ?? ''
      : initialDraftTarget?.dueTime ?? ''
  );
  const [source, setSource] = useState(
    restoredDraftOp?.kind === 'createDraft' || restoredDraftOp?.kind === 'updateDraft' || restoredDraftOp?.kind === 'confirm'
      ? restoredDraftOp.payload.source ?? initialDraftTarget?.source ?? ''
      : restoredDraftOp?.kind === 'createAndConfirm'
      ? restoredDraftOp.createPayload.source ?? ''
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.confirmPayload.source ?? initialDraftTarget?.source ?? ''
      : initialDraftTarget?.source ?? ''
  );
  const [basisNotes, setBasisNotes] = useState(
    restoredDraftOp?.kind === 'createDraft' || restoredDraftOp?.kind === 'updateDraft' || restoredDraftOp?.kind === 'confirm'
      ? restoredDraftOp.payload.basisNotes ?? initialDraftTarget?.basisNotes ?? ''
      : restoredDraftOp?.kind === 'createAndConfirm'
      ? restoredDraftOp.createPayload.basisNotes ?? ''
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.confirmPayload.basisNotes ?? initialDraftTarget?.basisNotes ?? ''
      : initialDraftTarget?.basisNotes ?? ''
  );
  const [sourceDocumentId, setSourceDocumentId] = useState(
    restoredDraftOp?.kind === 'createDraft' || restoredDraftOp?.kind === 'updateDraft' || restoredDraftOp?.kind === 'confirm'
      ? restoredDraftOp.payload.sourceDocumentId ?? initialDraftTarget?.sourceDocumentId ?? ''
      : restoredDraftOp?.kind === 'createAndConfirm'
      ? restoredDraftOp.createPayload.sourceDocumentId ?? ''
      : restoredDraftOp?.kind === 'updateAndConfirm'
      ? restoredDraftOp.confirmPayload.sourceDocumentId ?? initialDraftTarget?.sourceDocumentId ?? ''
      : initialDraftTarget?.sourceDocumentId ?? ''
  );
  const [fetchedDocsByMatter, setFetchedDocsByMatter] = useState<Record<string, LinkableDocumentSummary[]>>({});
  const [lawyerReviewed, setLawyerReviewed] = useState(
    restoredDraftOp?.kind === 'confirm' ||
      restoredDraftOp?.kind === 'createAndConfirm' ||
      restoredDraftOp?.kind === 'updateAndConfirm'
  );
  const [isSubmittingDraftModal, setIsSubmittingDraftModal] = useState(false);
  const [isFrozenDraftRetry, setIsFrozenDraftRetry] = useState(Boolean(draftModalDraft.restored));
  const [draftSessionExpired, setDraftSessionExpired] = useState(false);
  const [draftFormError, setDraftFormError] = useState<string | null>(
    draftModalDraft.restored ? 'تعذر تأكيد العملية السابقة على الخادم. يمكنك إعادة المحاولة بنفس المفتاح.' : null
  );
  const [draftConflictError, setDraftConflictError] = useState<string | null>(null);
  const [draftFieldErrors, setDraftFieldErrors] = useState<Record<string, string>>({});
  const pendingDraftOpRef = useRef<PendingDeadlineDraftOp | undefined>(draftModalDraft.restored);

  // Change Date Modal State
  const [changeDateTarget, setChangeDateTarget] = useState<DeadlineDTO | null>(() => {
    const restoredId = changeDateDraft.restored?.deadlineId;
    return restoredId ? initialDeadlines.find((d) => d.id === restoredId) ?? null : null;
  });
  const [newDueDate, setNewDueDate] = useState(changeDateDraft.restored?.dueDate ?? '');
  const [newDueTime, setNewDueTime] = useState(changeDateDraft.restored?.dueTime ?? '');
  const [dateChangeReason, setDateChangeReason] = useState(changeDateDraft.restored?.reason ?? '');
  const [isSubmittingDateChange, setIsSubmittingDateChange] = useState(false);
  const [isFrozenDateRetry, setIsFrozenDateRetry] = useState(Boolean(changeDateDraft.restored));
  const [dateChangeSessionExpired, setDateChangeSessionExpired] = useState(false);
  const [dateChangeError, setDateChangeError] = useState<string | null>(
    changeDateDraft.restored ? 'تعذر تأكيد تعديل التاريخ على الخادم. يمكنك إعادة المحاولة بنفس المفتاح.' : null
  );
  const [dateChangeConflict, setDateChangeConflict] = useState<string | null>(null);
  const pendingDateOpRef = useRef<PendingChangeDateOp | undefined>(changeDateDraft.restored);

  // Complete Modal State
  const [completeTarget, setCompleteTarget] = useState<DeadlineDTO | null>(() => {
    const restoredId = completeDraft.restored?.deadlineId;
    return restoredId ? initialDeadlines.find((d) => d.id === restoredId) ?? null : null;
  });
  const [completionDate, setCompletionDate] = useState(
    () => completeDraft.restored?.completionDate ?? getCairoTodayDateString()
  );
  const [completionNotes, setCompletionNotes] = useState(
    completeDraft.restored?.completionDescription ?? ''
  );
  const [isSubmittingComplete, setIsSubmittingComplete] = useState(false);
  const [isFrozenCompleteRetry, setIsFrozenCompleteRetry] = useState(Boolean(completeDraft.restored));
  const [completeSessionExpired, setCompleteSessionExpired] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(
    completeDraft.restored ? 'تعذر تأكيد تسجيل الإتمام على الخادم. يمكنك إعادة المحاولة بنفس المفتاح.' : null
  );
  const [completeConflict, setCompleteConflict] = useState<string | null>(null);
  const pendingCompleteOpRef = useRef<PendingCompleteOp | undefined>(completeDraft.restored);

  // Cancel Modal State
  const [cancelTarget, setCancelTarget] = useState<DeadlineDTO | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelConflict, setCancelConflict] = useState<string | null>(null);
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);
  const pendingCancelKeysRef = useRef<Map<string, string>>(new Map());

  // Refs for accessibility
  const draftDialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const basisInputRef = useRef<HTMLTextAreaElement>(null);
  const reviewCheckboxRef = useRef<HTMLInputElement>(null);

  const changeDateDialogRef = useRef<HTMLDivElement>(null);
  const changeDateInputRef = useRef<HTMLInputElement>(null);
  const changeReasonInputRef = useRef<HTMLTextAreaElement>(null);

  const completeDialogRef = useRef<HTMLDivElement>(null);
  const completionDateInputRef = useRef<HTMLInputElement>(null);
  const completionNotesInputRef = useRef<HTMLTextAreaElement>(null);

  const cancelDialogRef = useRef<HTMLDivElement>(null);
  const cancelReasonInputRef = useRef<HTMLTextAreaElement>(null);

  const anyBusy =
    isSubmittingDraftModal ||
    isSubmittingDateChange ||
    isSubmittingComplete ||
    isSubmittingCancel;

  const anyDirty =
    isFrozenDraftRetry ||
    isFrozenDateRetry ||
    isFrozenCompleteRetry ||
    (isDraftModalOpen && Boolean(title || dueDate || dueTime || source || basisNotes || sourceDocumentId)) ||
    (Boolean(changeDateTarget) && Boolean(dateChangeReason)) ||
    (Boolean(completeTarget) && Boolean(completionNotes));

  useLeaveGuard(anyDirty, anyBusy);

  const closeDraftModal = useCallback(() => {
    if (isSubmittingDraftModal) return;
    setIsDraftModalOpen(false);
    setDraftFormError(null);
    setDraftConflictError(null);
    setDraftFieldErrors({});
  }, [isSubmittingDraftModal]);

  const closeChangeDateModal = useCallback(() => {
    if (isSubmittingDateChange) return;
    setChangeDateTarget(null);
    setDateChangeError(null);
    setDateChangeConflict(null);
  }, [isSubmittingDateChange]);

  const closeCompleteModal = useCallback(() => {
    if (isSubmittingComplete) return;
    setCompleteTarget(null);
    setCompleteError(null);
    setCompleteConflict(null);
  }, [isSubmittingComplete]);

  const closeCancelModal = useCallback(() => {
    if (isSubmittingCancel) return;
    setCancelTarget(null);
    setCancelReason('');
    setCancelError(null);
    setCancelConflict(null);
  }, [isSubmittingCancel]);

  useAccessibleModal({
    isOpen: isDraftModalOpen,
    isSubmitting: isSubmittingDraftModal,
    hasPending: isFrozenDraftRetry,
    onClose: closeDraftModal,
    dialogRef: draftDialogRef,
    initialFocusRef: titleInputRef,
  });

  useAccessibleModal({
    isOpen: Boolean(changeDateTarget),
    isSubmitting: isSubmittingDateChange,
    hasPending: isFrozenDateRetry,
    onClose: closeChangeDateModal,
    dialogRef: changeDateDialogRef,
    initialFocusRef: changeDateInputRef,
  });

  useAccessibleModal({
    isOpen: Boolean(completeTarget),
    isSubmitting: isSubmittingComplete,
    hasPending: isFrozenCompleteRetry,
    onClose: closeCompleteModal,
    dialogRef: completeDialogRef,
    initialFocusRef: completionNotesInputRef,
  });

  useAccessibleModal({
    isOpen: Boolean(cancelTarget),
    isSubmitting: isSubmittingCancel,
    hasPending: false,
    onClose: closeCancelModal,
    dialogRef: cancelDialogRef,
    initialFocusRef: cancelReasonInputRef,
  });

  const upsertDeadline = (updated: DeadlineDTO) => {
    setDeadlines((prev) => {
      const exists = prev.some((d) => d.id === updated.id);
      return exists ? prev.map((d) => (d.id === updated.id ? updated : d)) : [updated, ...prev];
    });
  };

  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

  const refreshDeadlines = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const seq = ++refreshSeqRef.current;

    setIsLoading(true);
    setLoadError(null);
    try {
      const sp = new URLSearchParams({ includeClosed: 'true' });
      if (lockedMatterId) sp.set('matterId', lockedMatterId);
      const res = await fetch(`/api/deadlines?${sp.toString()}`, { cache: 'no-store', signal: controller.signal });
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
      }
      const body = (await res.json().catch(() => null)) as ActionResult<DeadlineDTO[]> | null;
      if (seq !== refreshSeqRef.current) return;
      if (!res.ok || !body || !body.success) {
        throw new Error(body && !body.success ? body.error : 'تعذر تحميل قائمة المواعيد القانونية.');
      }
      setDeadlines(body.data);
      setDraftConflictError(null);
      setDateChangeConflict(null);
      setCompleteConflict(null);
      setCancelConflict(null);
    } catch (err) {
      if (controller.signal.aborted || seq !== refreshSeqRef.current) return;
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المواعيد القانونية.');
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      if (seq === refreshSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [lockedMatterId]);

  useEffect(() => {
    const activeMatterId = lockedMatterId || matterId;
    if (!isDraftModalOpen || !activeMatterId) return;
    if (lockedMatterId && matterDocuments !== undefined) return;
    if (initialDocumentsByMatter && activeMatterId in initialDocumentsByMatter) return;
    if (activeMatterId in fetchedDocsByMatter) return;

    const controller = new AbortController();
    fetch(`/api/documents?matterId=${encodeURIComponent(activeMatterId)}&limit=100`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }
        const body = (await res.json().catch(() => null)) as
          | { success: true; data: { documents: DocumentDTO[] } }
          | { success: false }
          | null;
        if (controller.signal.aborted) return;
        const docs: LinkableDocumentSummary[] =
          res.ok && body && body.success
            ? body.data.documents
                .filter((d) => !d.archivedAt && d.currentVersionId && d.currentVersion?.isReady)
                .map((d) => ({
                  id: d.id,
                  title: d.title,
                  documentType: d.documentType,
                  currentVersionId: d.currentVersionId,
                  scanStatusLabel: d.currentVersion!.scanStatusLabel,
                }))
            : [];
        setFetchedDocsByMatter((prev) => ({ ...prev, [activeMatterId]: docs }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFetchedDocsByMatter((prev) => ({ ...prev, [activeMatterId]: [] }));
      });

    return () => {
      controller.abort();
    };
  }, [isDraftModalOpen, lockedMatterId, matterId, matterDocuments, initialDocumentsByMatter, fetchedDocsByMatter]);

  const openNewDeadlineModal = () => {
    setStatusNotice(null);
    const pending = pendingDraftOpRef.current;
    if (pending && (pending.kind === 'createDraft' || pending.kind === 'createAndConfirm')) {
      setIsDraftModalOpen(true);
      return;
    }
    setEditingDeadline(null);
    pendingDraftOpRef.current = undefined;
    draftModalDraft.clear();
    setIsFrozenDraftRetry(false);
    setDraftSessionExpired(false);
    setDraftFormError(null);
    setDraftConflictError(null);
    setDraftFieldErrors({});
    setTitle('');
    setMatterId(lockedMatterId ?? '');
    setProceedingId('');
    setDueDate('');
    setDueTime('');
    setSource('');
    setBasisNotes('');
    setSourceDocumentId('');
    setLawyerReviewed(false);
    setIsDraftModalOpen(true);
  };

  const openExistingDraftModal = (deadline: DeadlineDTO) => {
    setStatusNotice(null);
    const pending = pendingDraftOpRef.current;
    const pendingId =
      pending?.kind === 'updateDraft' || pending?.kind === 'confirm'
        ? pending.payload.deadlineId
        : pending?.kind === 'updateAndConfirm'
        ? pending.updatePayload.deadlineId
        : undefined;
    if (pending && pendingId === deadline.id) {
      setIsDraftModalOpen(true);
      return;
    }
    setEditingDeadline(deadline);
    pendingDraftOpRef.current = undefined;
    draftModalDraft.clear();
    setIsFrozenDraftRetry(false);
    setDraftSessionExpired(false);
    setDraftFormError(null);
    setDraftConflictError(null);
    setDraftFieldErrors({});
    setTitle(deadline.title);
    setMatterId(deadline.matterId);
    setProceedingId(deadline.proceedingId ?? '');
    setDueDate(deadline.dueDate ?? '');
    setDueTime(deadline.dueTime ?? '');
    setSource(deadline.source ?? '');
    setBasisNotes(deadline.basisNotes ?? '');
    setSourceDocumentId(deadline.sourceDocumentId ?? '');
    setLawyerReviewed(false);
    setIsDraftModalOpen(true);
  };

  const selectedMatterProceedings = lockedMatterId
    ? (lockedMatterProceedings ?? [])
    : (selectableMatters.find((m) => m.id === matterId)?.proceedings ?? []);

  const activeDocsMatterId = lockedMatterId || matterId;
  const hasPreloadedDocs =
    (Boolean(lockedMatterId) && matterDocuments !== undefined) ||
    Boolean(initialDocumentsByMatter && activeDocsMatterId in initialDocumentsByMatter);
  const isLoadingMatterDocs =
    isDraftModalOpen &&
    Boolean(activeDocsMatterId) &&
    !hasPreloadedDocs &&
    !(activeDocsMatterId in fetchedDocsByMatter);
  const rawMatterDocs =
    lockedMatterId && matterDocuments !== undefined
      ? matterDocuments
      : activeDocsMatterId
      ? (initialDocumentsByMatter?.[activeDocsMatterId] ?? fetchedDocsByMatter[activeDocsMatterId] ?? [])
      : [];
  const availableSourceDocs =
    editingDeadline?.sourceDocument &&
    !rawMatterDocs.some((doc) => doc.id === editingDeadline.sourceDocument?.id)
      ? [editingDeadline.sourceDocument, ...rawMatterDocs]
      : rawMatterDocs;

  const executePendingDraftOp = async (op: PendingDeadlineDraftOp) => {
    setIsSubmittingDraftModal(true);
    try {
      let activeOp: PendingDeadlineDraftOp = op;
      let res: ActionResult<DeadlineDTO>;

      if (activeOp.kind === 'createAndConfirm') {
        const createdRes = await createDeadlineAction(activeOp.createPayload);
        if (!createdRes.success) {
          res = createdRes;
        } else {
          setEditingDeadline(createdRes.data);
          upsertDeadline(createdRes.data);
          const nextConfirmOp: PendingDeadlineDraftOp = {
            kind: 'confirm',
            payload: {
              deadlineId: createdRes.data.id,
              expectedVersion: createdRes.data.version,
              dueDate: activeOp.createPayload.dueDate!,
              dueTime: activeOp.createPayload.dueTime ?? null,
              source: activeOp.createPayload.source!,
              basisNotes: activeOp.createPayload.basisNotes!,
              sourceDocumentId: activeOp.createPayload.sourceDocumentId ?? null,
              lawyerReviewed: true,
              confirmationAccepted: true,
              idempotencyKey: activeOp.confirmIdempotencyKey,
            },
          };
          activeOp = nextConfirmOp;
          pendingDraftOpRef.current = nextConfirmOp;
          draftModalDraft.keep(nextConfirmOp);
          res = await confirmDeadlineAction(nextConfirmOp.payload);
        }
      } else if (activeOp.kind === 'updateAndConfirm') {
        const updatedRes = await updateDeadlineDraftAction(activeOp.updatePayload);
        if (!updatedRes.success) {
          res = updatedRes;
        } else {
          setEditingDeadline(updatedRes.data);
          upsertDeadline(updatedRes.data);
          const nextConfirmOp: PendingDeadlineDraftOp = {
            kind: 'confirm',
            payload: {
              ...activeOp.confirmPayload,
              expectedVersion: updatedRes.data.version,
            },
          };
          activeOp = nextConfirmOp;
          pendingDraftOpRef.current = nextConfirmOp;
          draftModalDraft.keep(nextConfirmOp);
          res = await confirmDeadlineAction(nextConfirmOp.payload);
        }
      } else if (activeOp.kind === 'createDraft') {
        res = await createDeadlineAction(activeOp.payload);
      } else if (activeOp.kind === 'updateDraft') {
        res = await updateDeadlineDraftAction(activeOp.payload);
      } else {
        res = await confirmDeadlineAction(activeOp.payload);
      }

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setDraftSessionExpired(true);
          setIsFrozenDraftRetry(true);
          setDraftFormError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة بنفس المفتاح.');
          return;
        }
        const uncertain = isUncertainMutationOutcome(res.code);
        setIsFrozenDraftRetry(uncertain);
        if (!uncertain) {
          pendingDraftOpRef.current = undefined;
          draftModalDraft.clear();
        }
        if (res.code === 'CONCURRENCY_CONFLICT') {
          setDraftConflictError('تم تعديل البيانات من شاشة أخرى. يرجى تحديث القائمة ومراجعة أحدث نسخة قبل الحفظ.');
        } else {
          setDraftFormError(res.error || 'تعذر تنفيذ العملية.');
          if (res.fieldErrors) setDraftFieldErrors(res.fieldErrors);
        }
        return;
      }

      pendingDraftOpRef.current = undefined;
      draftModalDraft.clear();
      setIsFrozenDraftRetry(false);
      setDraftSessionExpired(false);
      upsertDeadline(res.data);
      setIsDraftModalOpen(false);
      setEditingDeadline(null);
      setStatusNotice(
        activeOp.kind === 'confirm'
          ? 'تمت مراجعة الموعد القانوني واعتماده وتسجيله في سجل التدقيق.'
          : 'تم حفظ مسودة الموعد القانوني (تحتاج مراجعة واعتماداً قبل التأكيد).'
      );
      onDataChanged?.();
      router.refresh();
    } catch {
      setIsFrozenDraftRetry(true);
      setDraftFormError('تعذر تأكيد الحفظ من الخادم. يمكنك إعادة المحاولة بنفس المفتاح.');
    } finally {
      setIsSubmittingDraftModal(false);
    }
  };

  const handleSaveDraft = async () => {
    if (isSubmittingDraftModal) return;
    setDraftFormError(null);
    setDraftConflictError(null);
    setDraftSessionExpired(false);
    setDraftFieldErrors({});

    if (pendingDraftOpRef.current) {
      await executePendingDraftOp(pendingDraftOpRef.current);
      return;
    }

    const trimmedTitle = title.trim();
    const targetMatterId = lockedMatterId || matterId;
    const trimmedDate = dueDate.trim();
    const trimmedTime = dueTime.trim();

    if (!trimmedTitle) {
      setDraftFieldErrors({ title: 'عنوان الموعد القانوني مطلوب.' });
      setDraftFormError('عنوان الموعد القانوني مطلوب.');
      titleInputRef.current?.focus();
      return;
    }
    if (!targetMatterId) {
      setDraftFieldErrors({ matterId: 'يجب اختيار ملف القضية للموعد القانوني.' });
      setDraftFormError('يجب اختيار ملف القضية للموعد القانوني.');
      return;
    }
    if (trimmedTime && !trimmedDate) {
      setDraftFieldErrors({ dueTime: 'لا يمكن تحديد وقت بدون تحديد التاريخ.' });
      setDraftFormError('لا يمكن تحديد وقت بدون تحديد التاريخ.');
      dateInputRef.current?.focus();
      return;
    }

    const op: PendingDeadlineDraftOp = editingDeadline
      ? {
          kind: 'updateDraft',
          payload: {
            deadlineId: editingDeadline.id,
            expectedVersion: editingDeadline.version,
            proceedingId: proceedingId ? proceedingId : null,
            title: trimmedTitle,
            dueDate: trimmedDate || null,
            dueTime: trimmedTime || null,
            source: source.trim() || null,
            basisNotes: basisNotes.trim() || null,
            sourceDocumentId: sourceDocumentId || null,
            idempotencyKey: generateClientRequestId('dl-draft'),
          },
        }
      : {
          kind: 'createDraft',
          payload: {
            matterId: targetMatterId,
            proceedingId: proceedingId ? proceedingId : null,
            title: trimmedTitle,
            dueDate: trimmedDate || null,
            dueTime: trimmedTime || null,
            source: source.trim() || null,
            basisNotes: basisNotes.trim() || null,
            sourceDocumentId: sourceDocumentId || null,
            idempotencyKey: generateClientRequestId('dl-create'),
          },
        };

    pendingDraftOpRef.current = op;
    draftModalDraft.keep(op);
    await executePendingDraftOp(op);
  };

  const handleConfirmDeadline = async () => {
    if (isSubmittingDraftModal) return;
    setDraftFormError(null);
    setDraftConflictError(null);
    setDraftSessionExpired(false);
    setDraftFieldErrors({});

    if (pendingDraftOpRef.current) {
      await executePendingDraftOp(pendingDraftOpRef.current);
      return;
    }

    const trimmedTitle = title.trim();
    const targetMatterId = lockedMatterId || matterId;
    const trimmedDate = dueDate.trim();
    const trimmedTime = dueTime.trim();
    const trimmedSource = source.trim();
    const trimmedBasis = basisNotes.trim();

    if (!trimmedTitle) {
      setDraftFieldErrors({ title: 'عنوان الموعد القانوني مطلوب.' });
      setDraftFormError('عنوان الموعد القانوني مطلوب.');
      titleInputRef.current?.focus();
      return;
    }
    if (!targetMatterId) {
      setDraftFieldErrors({ matterId: 'يجب اختيار ملف القضية للموعد القانوني.' });
      setDraftFormError('يجب اختيار ملف القضية للموعد القانوني.');
      return;
    }
    if (!trimmedDate) {
      setDraftFieldErrors({ dueDate: 'التاريخ النهائي للموعد القانوني مطلوب للاعتماد.' });
      setDraftFormError('التاريخ النهائي للموعد القانوني مطلوب للاعتماد.');
      dateInputRef.current?.focus();
      return;
    }
    if (!trimmedSource) {
      setDraftFieldErrors({ source: 'مصدر الموعد القانوني مطلوب للاعتماد.' });
      setDraftFormError('مصدر الموعد القانوني مطلوب للاعتماد.');
      sourceInputRef.current?.focus();
      return;
    }
    if (!trimmedBasis) {
      setDraftFieldErrors({ basisNotes: 'سند الاحتساب وملاحظات المراجعة مطلوبة للاعتماد.' });
      setDraftFormError('سند الاحتساب وملاحظات المراجعة مطلوبة للاعتماد.');
      basisInputRef.current?.focus();
      return;
    }
    if (!lawyerReviewed) {
      setDraftFieldErrors({ confirmationAccepted: 'يلزم تأكيد الإقرار «راجعت الموعد واعتمدته» قبل الاعتماد.' });
      setDraftFormError('يلزم تأكيد الإقرار «راجعت الموعد واعتمدته» قبل الاعتماد.');
      reviewCheckboxRef.current?.focus();
      return;
    }

    let op: PendingDeadlineDraftOp;
    if (!editingDeadline) {
      op = {
        kind: 'createAndConfirm',
        createPayload: {
          matterId: targetMatterId,
          proceedingId: proceedingId ? proceedingId : null,
          title: trimmedTitle,
          dueDate: trimmedDate,
          dueTime: trimmedTime || null,
          source: trimmedSource,
          basisNotes: trimmedBasis,
          sourceDocumentId: sourceDocumentId || null,
          idempotencyKey: generateClientRequestId('dl-create-pre'),
        },
        confirmIdempotencyKey: generateClientRequestId('dl-confirm'),
      };
    } else if (
      trimmedTitle !== editingDeadline.title ||
      (proceedingId || null) !== (editingDeadline.proceedingId ?? null)
    ) {
      op = {
        kind: 'updateAndConfirm',
        updatePayload: {
          deadlineId: editingDeadline.id,
          expectedVersion: editingDeadline.version,
          title: trimmedTitle,
          proceedingId: proceedingId ? proceedingId : null,
          idempotencyKey: generateClientRequestId('dl-upd-pre'),
        },
        confirmPayload: {
          deadlineId: editingDeadline.id,
          dueDate: trimmedDate,
          dueTime: trimmedTime || null,
          source: trimmedSource,
          basisNotes: trimmedBasis,
          sourceDocumentId: sourceDocumentId || null,
          lawyerReviewed: true,
          confirmationAccepted: true,
          idempotencyKey: generateClientRequestId('dl-confirm'),
        },
      };
    } else {
      op = {
        kind: 'confirm',
        payload: {
          deadlineId: editingDeadline.id,
          expectedVersion: editingDeadline.version,
          dueDate: trimmedDate,
          dueTime: trimmedTime || null,
          source: trimmedSource,
          basisNotes: trimmedBasis,
          sourceDocumentId: sourceDocumentId || null,
          lawyerReviewed: true,
          confirmationAccepted: true,
          idempotencyKey: generateClientRequestId('dl-confirm'),
        },
      };
    }

    pendingDraftOpRef.current = op;
    draftModalDraft.keep(op);
    await executePendingDraftOp(op);
  };

  const openChangeDateModal = (deadline: DeadlineDTO) => {
    setStatusNotice(null);
    setChangeDateTarget(deadline);
    setNewDueDate(deadline.dueDate ?? '');
    setNewDueTime(deadline.dueTime ?? '');
    setDateChangeReason('');
    setDateChangeError(null);
    setDateChangeConflict(null);
    setDateChangeSessionExpired(false);
    setIsFrozenDateRetry(false);
    pendingDateOpRef.current = undefined;
    changeDateDraft.clear();
  };

  const handleSubmitDateChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeDateTarget || isSubmittingDateChange) return;

    setDateChangeError(null);
    setDateChangeConflict(null);
    setDateChangeSessionExpired(false);

    if (!pendingDateOpRef.current) {
      const trimmedDate = newDueDate.trim();
      const trimmedTime = newDueTime.trim();
      const trimmedReason = dateChangeReason.trim();

      if (trimmedTime && !trimmedDate) {
        setDateChangeError('لا يمكن تحديد وقت بدون تحديد التاريخ.');
        changeDateInputRef.current?.focus();
        return;
      }
      if (changeDateTarget.status === 'CONFIRMED' && !trimmedReason) {
        setDateChangeError('يجب كتابة سبب تعديل تاريخ الموعد القانوني المؤكد لإعادته للمراجعة.');
        changeReasonInputRef.current?.focus();
        return;
      }

      const op: PendingChangeDateOp = {
        deadlineId: changeDateTarget.id,
        expectedVersion: changeDateTarget.version,
        dueDate: trimmedDate || null,
        dueTime: trimmedTime || null,
        reason: trimmedReason || null,
        idempotencyKey: generateClientRequestId('dl-date'),
      };
      pendingDateOpRef.current = op;
      changeDateDraft.keep(op);
    }

    setIsSubmittingDateChange(true);
    try {
      const res = await changeDeadlineDateAction(pendingDateOpRef.current);
      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setDateChangeSessionExpired(true);
          setIsFrozenDateRetry(true);
          setDateChangeError('انتهت صلاحية الجلسة أو يلزم التحقق. أُبقي طلب تعديل التاريخ مجمّداً بنفس المفتاح.');
          return;
        }
        const uncertain = isUncertainMutationOutcome(res.code);
        setIsFrozenDateRetry(uncertain);
        if (!uncertain) {
          pendingDateOpRef.current = undefined;
          changeDateDraft.clear();
        }
        if (res.code === 'CONCURRENCY_CONFLICT') {
          setDateChangeConflict('تم تعديل البيانات من شاشة أخرى. يرجى تحديث البيانات ومراجعة النسخة الأحدث.');
        } else {
          setDateChangeError(res.error || 'تعذر تعديل تاريخ الموعد.');
        }
        return;
      }

      pendingDateOpRef.current = undefined;
      changeDateDraft.clear();
      setIsFrozenDateRetry(false);
      upsertDeadline(res.data);
      setChangeDateTarget(null);
      setStatusNotice('تم تعديل التاريخ وإعادة الموعد إلى حالة «مسودة تحتاج مراجعة» مع إلغاء التذكيرات السابقة.');
      onDataChanged?.();
      router.refresh();
    } catch {
      setIsFrozenDateRetry(true);
      setDateChangeError('تعذر استلام تأكيد التعديل من الخادم. يمكنك إعادة المحاولة بنفس المفتاح.');
    } finally {
      setIsSubmittingDateChange(false);
    }
  };

  const openCompleteModal = (deadline: DeadlineDTO) => {
    setStatusNotice(null);
    setCompleteTarget(deadline);
    setCompletionDate(getCairoTodayDateString());
    setCompletionNotes('');
    setCompleteError(null);
    setCompleteConflict(null);
    setCompleteSessionExpired(false);
    setIsFrozenCompleteRetry(false);
    pendingCompleteOpRef.current = undefined;
    completeDraft.clear();
  };

  const handleSubmitComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeTarget || isSubmittingComplete) return;

    setCompleteError(null);
    setCompleteConflict(null);
    setCompleteSessionExpired(false);

    if (!pendingCompleteOpRef.current) {
      const trimmedDate = completionDate.trim();
      const trimmedNotes = completionNotes.trim();
      if (!trimmedDate) {
        setCompleteError('تاريخ تنفيذ الإجراء القانوني مطلوب.');
        completionDateInputRef.current?.focus();
        return;
      }
      if (!trimmedNotes) {
        setCompleteError('وصف الإجراء التنفيذي الذي تم لإتمام الموعد القانوني إلزامي.');
        completionNotesInputRef.current?.focus();
        return;
      }

      const op: PendingCompleteOp = {
        deadlineId: completeTarget.id,
        expectedVersion: completeTarget.version,
        completionDescription: trimmedNotes,
        completionDate: trimmedDate,
        idempotencyKey: generateClientRequestId('dl-done'),
      };
      pendingCompleteOpRef.current = op;
      completeDraft.keep(op);
    }

    setIsSubmittingComplete(true);
    try {
      const res = await completeDeadlineAction(pendingCompleteOpRef.current);
      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setCompleteSessionExpired(true);
          setIsFrozenCompleteRetry(true);
          setCompleteError('انتهت صلاحية الجلسة أو يلزم التحقق. أُبقي طلب الإتمام مجمّداً بنفس المفتاح.');
          return;
        }
        const uncertain = isUncertainMutationOutcome(res.code);
        setIsFrozenCompleteRetry(uncertain);
        if (!uncertain) {
          pendingCompleteOpRef.current = undefined;
          completeDraft.clear();
        }
        if (res.code === 'CONCURRENCY_CONFLICT') {
          setCompleteConflict('تم تعديل البيانات من شاشة أخرى. يرجى تحديث القائمة والمحاولة بعد المراجعة.');
        } else {
          setCompleteError(res.error || 'تعذر تسجيل إتمام الموعد القانوني.');
        }
        return;
      }

      pendingCompleteOpRef.current = undefined;
      completeDraft.clear();
      setIsFrozenCompleteRetry(false);
      upsertDeadline(res.data);
      setCompleteTarget(null);
      setStatusNotice('تم توثيق إتمام الموعد القانوني وإغلاق تذكيراته المجدولة.');
      onDataChanged?.();
      router.refresh();
    } catch {
      setIsFrozenCompleteRetry(true);
      setCompleteError('تعذر استلام تأكيد الإتمام من الخادم. يمكنك إعادة المحاولة بنفس المفتاح.');
    } finally {
      setIsSubmittingComplete(false);
    }
  };

  const handleConfirmCancelDeadline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget || isSubmittingCancel) return;

    setCancelError(null);
    setCancelConflict(null);
    const trimmedReason = cancelReason.trim();
    if (!trimmedReason) {
      setCancelError('سبب إلغاء الموعد القانوني مطلوب.');
      cancelReasonInputRef.current?.focus();
      return;
    }

    const opKey = `cancel:${cancelTarget.id}:${cancelTarget.version}`;
    const idempotencyKey = pendingCancelKeysRef.current.get(opKey) ?? generateClientRequestId('dl-cancel');
    pendingCancelKeysRef.current.set(opKey, idempotencyKey);

    setIsSubmittingCancel(true);
    try {
      const res = await cancelDeadlineAction({
        deadlineId: cancelTarget.id,
        expectedVersion: cancelTarget.version,
        reason: trimmedReason,
        idempotencyKey,
      });
      if (!res.success) {
        if (!isUncertainMutationOutcome(res.code)) {
          pendingCancelKeysRef.current.delete(opKey);
        }
        if (res.code === 'CONCURRENCY_CONFLICT') {
          setCancelConflict('تم تعديل البيانات من شاشة أخرى. يرجى تحديث البيانات أولاً.');
        } else {
          setCancelError(res.error || 'تعذر إلغاء الموعد القانوني.');
        }
        return;
      }

      pendingCancelKeysRef.current.delete(opKey);
      upsertDeadline(res.data);
      setCancelTarget(null);
      setCancelReason('');
      setStatusNotice('تم إلغاء الموعد القانوني وإلغاء تذكيراته المجدولة.');
      onDataChanged?.();
      router.refresh();
    } catch {
      setCancelError('تعذر تأكيد الإلغاء بسبب انقطاع الاتصال. يمكنك إعادة المحاولة.');
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  const draftList = deadlines.filter((d) => d.status === 'DRAFT');
  const confirmedList = deadlines.filter((d) => d.status === 'CONFIRMED');
  const closedList = deadlines.filter((d) => d.status === 'COMPLETED' || d.status === 'CANCELLED');

  const renderDeadlineCard = (d: DeadlineDTO) => (
    <article
      key={d.id}
      data-testid={`deadline-card-${d.id}`}
      className={`bg-white rounded-[6px] border p-4 sm:p-5 shadow-xs space-y-3 ${
        d.isOverdue
          ? 'border-[#A4262C]/60'
          : d.status === 'DRAFT'
          ? 'border-amber-300'
          : 'border-[#D5DFE3]'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-2 border-b border-[#E8EEF1]">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-[#172A35] [overflow-wrap:anywhere]">{d.title}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#4D606A]">
            <Link href={`/matters/${d.matterId}`} className="text-[#14566B] font-semibold hover:underline">
              ملف <bdi dir="ltr">{d.matterFileCode}</bdi> — {d.matterTitle}
            </Link>
            {d.proceedingLabel && <span>• {d.proceedingLabel}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span
            data-testid={`deadline-status-badge-${d.id}`}
            className={`text-sm font-bold px-2.5 py-0.5 rounded border ${DEADLINE_STATUS_CLASSES[d.status]}`}
          >
            {DEADLINE_STATUS_LABELS[d.status]}
          </span>
          {d.isOverdue && (
            <span
              data-testid={`deadline-overdue-badge-${d.id}`}
              className="text-sm font-bold px-2.5 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300"
            >
              متأخر
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <span className="font-semibold text-[#4D606A]">التاريخ والوقت: </span>
          {d.dueDate ? (
            <span className="font-bold text-[#172A35]">
              {formatCairoDateArabic(d.dueDate)} (<bdi dir="ltr">{d.dueDate}</bdi>) — {d.timeLabel}
            </span>
          ) : (
            <span className="font-semibold text-[#7A4A00]">لم يُحدد التاريخ بعد</span>
          )}
        </div>

        <div>
          <span className="font-semibold text-[#4D606A]">المصدر: </span>
          <span className="text-[#172A35]">{d.source || 'غير محدد بعد'}</span>
        </div>
      </div>

      {d.sourceDocumentId && (
        <div className="flex flex-wrap items-center gap-2 text-sm bg-[#F9FBFC] px-3 py-2 rounded-[6px] border border-[#E8EEF1]">
          <span className="font-semibold text-[#4D606A]">المستند المصدري:</span>
          <Link
            href={`/documents/${d.sourceDocumentId}`}
            data-testid={`deadline-source-document-link-${d.id}`}
            className="inline-flex flex-wrap items-center gap-2 px-2.5 py-1 rounded-[6px] bg-white border border-[#D5DFE3] text-[#14566B] hover:bg-[#E8EEF1] font-semibold min-h-[44px]"
          >
            <bdi className="[overflow-wrap:anywhere]">
              {d.sourceDocument?.title ?? 'عرض المستند المصدري'}
            </bdi>
            {d.sourceDocument && (
              <span className="text-xs text-[#4D606A]">
                ({DOCUMENT_TYPE_LABELS_AR[d.sourceDocument.documentType]})
              </span>
            )}
            {d.sourceDocument?.scanStatusLabel && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200">
                {d.sourceDocument.scanStatusLabel}
              </span>
            )}
          </Link>
        </div>
      )}

      {d.basisNotes && (
        <div className="text-sm bg-[#F9FBFC] p-3 rounded-[6px] border border-[#E8EEF1]">
          <span className="font-semibold text-[#4D606A]">سند الاحتساب / ملاحظات المراجعة: </span>
          <span className="text-[#172A35] whitespace-pre-wrap">{d.basisNotes}</span>
        </div>
      )}

      {d.status === 'DRAFT' && (
        <p className="text-sm text-[#7A4A00] bg-amber-50/70 px-3 py-2 rounded-[6px] border border-amber-200">
          مسودة تحتاج مراجعة واعتماد المحامي — لا توجد تذكيرات مؤكدة قبل الاعتماد.
        </p>
      )}

      {d.confirmedByName && d.confirmedAt && (
        <div
          data-testid={`deadline-reviewer-meta-${d.id}`}
          className="text-sm text-[#176449] bg-emerald-50/60 px-3 py-2 rounded-[6px] border border-emerald-200 flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            ✓ راجعه واعتمده: <strong>{d.confirmedByName}</strong> بتاريخ{' '}
            {formatCairoInstantArabic(d.confirmedAt)}
          </span>
          {d.pendingReminderCount > 0 && (
            <span className="text-sm font-semibold text-[#14566B]">
              تذكيرات مجدولة في الانتظار: {d.pendingReminderCount}
            </span>
          )}
        </div>
      )}

      {d.dateChangeReason && (
        <div className="text-sm text-[#7A4A00] bg-amber-50 px-3 py-2 rounded-[6px] border border-amber-200">
          <span className="font-bold">سبب تعديل التاريخ السابق: </span>
          <span>{d.dateChangeReason}</span>
        </div>
      )}

      {d.status === 'COMPLETED' && (
        <div className="text-sm text-[#176449] bg-emerald-50 px-3 py-2 rounded-[6px] border border-emerald-200 space-y-1">
          <div>
            <strong>تاريخ التنفيذ:</strong> {d.completedDate ? formatCairoDateArabic(d.completedDate) : '—'}
          </div>
          {d.completionDescription && (
            <div>
              <strong>ما تم تنفيذه:</strong> {d.completionDescription}
            </div>
          )}
        </div>
      )}

      {d.status === 'CANCELLED' && d.cancellationReason && (
        <div className="text-sm text-stone-800 bg-stone-100 px-3 py-2 rounded-[6px] border border-stone-300">
          <strong>سبب الإلغاء:</strong> {d.cancellationReason}
        </div>
      )}

      {!isReadOnly && (d.status === 'DRAFT' || d.status === 'CONFIRMED') && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E8EEF1]">
          {d.status === 'DRAFT' && (
            <button
              type="button"
              data-testid={`open-deadline-button-${d.id}`}
              onClick={() => openExistingDraftModal(d)}
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
            >
              ✓ مراجعة واعتماد الموعد
            </button>
          )}

          {d.status === 'CONFIRMED' && (
            <button
              type="button"
              data-testid={`complete-deadline-button-${d.id}`}
              onClick={() => openCompleteModal(d)}
              className="px-4 py-2 bg-[#176449] hover:bg-[#114D38] text-white text-sm font-bold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#176449] focus:ring-offset-2"
            >
              ✓ تسجيل تمام الإجراء
            </button>
          )}

          <button
            type="button"
            data-testid={`change-deadline-date-button-${d.id}`}
            onClick={() => openChangeDateModal(d)}
            className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
          >
            تعديل التاريخ
          </button>

          <button
            type="button"
            data-testid={`cancel-deadline-button-${d.id}`}
            onClick={() => {
              setCancelTarget(d);
              setCancelReason('');
              setCancelError(null);
              setCancelConflict(null);
            }}
            className="px-4 py-2 bg-white hover:bg-red-50 text-[#A4262C] text-sm font-semibold rounded-[6px] border border-red-200 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#A4262C]"
          >
            إلغاء الموعد
          </button>
        </div>
      )}
    </article>
  );

  return (
    <div className="space-y-6" data-testid="deadlines-view">
      {/* Stitch S08b Header Card */}
      <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#7A4A00] bg-[#FFF7E6] px-2.5 py-0.5 rounded-[4px] border border-[#E0B46A]">
              بروتوكول التحقق البشري الإلزامي
            </span>
          </div>
          {lockedMatterId ? (
            <h2 className="text-lg font-bold text-[#172A35]">
              المواعيد القانونية الحرجة
            </h2>
          ) : (
            <h1 className="text-2xl font-bold text-[#172A35]">
              المواعيد القانونية الحرجة
            </h1>
          )}
          <p className="text-sm text-[#4D606A]">
            المواعيد القانونية تُحسب وتُعتمد يدوياً بواسطة المحامي ولا يُنشئها النظام أو يغلقها تلقائياً.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="deadlines-refresh-button"
            onClick={refreshDeadlines}
            disabled={isLoading}
            className="px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] disabled:opacity-50"
          >
            تحديث
          </button>
          {!isReadOnly && (
            <button
              type="button"
              data-testid="new-deadline-button"
              onClick={openNewDeadlineModal}
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] shadow-xs min-h-[44px] flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
            >
              <span>موعد قانوني جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Stitch S08b Strict Procedural Rule Banner */}
      <div className="bg-white border-r-4 border-r-[#14566B] border border-[#D5DFE3] rounded-[6px] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[#14566B]">الضابط الإجرائي المُلزم للمكتب</h2>
            <span className="bg-red-50 text-[#A4262C] border border-red-200 px-2 py-0.5 rounded text-xs font-semibold">
              مبدأ حتمي
            </span>
          </div>
          <p className="text-xs text-[#172A35] leading-relaxed">
            «لا يوجد احتساب تلقائي للمواعيد القانونية؛ يتطلب كل ميعاد إجرائي تدقيقاً بشرياً واعتماداً رسمياً من المحامي بناءً على إعلان رسمي أو حكم قضائي».
          </p>
        </div>
      </div>

      {/* Stitch S08b Metric Summary Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold text-[#7A4A00] block">مسودات مقترحة تحتاج مراجعة</span>
            <div className="flex items-baseline gap-2 mt-1">
              <strong className="text-2xl font-bold text-[#7A4A00]">{draftList.length}</strong>
              <span className="text-xs text-[#4D606A]">معلقة الاعتماد</span>
            </div>
          </div>
          <span className="w-10 h-10 rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] flex items-center justify-center text-[#7A4A00] font-bold text-sm">
            {draftList.length}
          </span>
        </div>

        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold text-[#14566B] block">مواعيد معتمدة رسمياً</span>
            <div className="flex items-baseline gap-2 mt-1">
              <strong className="text-2xl font-bold text-[#14566B]">{confirmedList.length}</strong>
              <span className="text-xs text-[#4D606A]">مواعيد حاسمة قيد السريان</span>
            </div>
          </div>
          <span className="w-10 h-10 rounded-[6px] bg-[#E9F2F5] border border-[#C2D9E2] flex items-center justify-center text-[#14566B] font-bold text-sm">
            {confirmedList.length}
          </span>
        </div>

        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold text-[#176449] block">مواعيد موثقة ومنتهية</span>
            <div className="flex items-baseline gap-2 mt-1">
              <strong className="text-2xl font-bold text-[#176449]">{closedList.length}</strong>
              <span className="text-xs text-[#4D606A]">مقيدة بمحاضر التنفيذ</span>
            </div>
          </div>
          <span className="w-10 h-10 rounded-[6px] bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#176449] font-bold text-sm">
            {closedList.length}
          </span>
        </div>
      </div>

      {statusNotice && (
        <div
          role="status"
          data-testid="deadline-status-notice"
          className="p-3 bg-emerald-50 border border-emerald-200 text-[#176449] rounded-[6px] text-sm font-medium flex items-center justify-between gap-2"
        >
          <span>✓ {statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            aria-label="إغلاق التنبيه"
            className="px-2 py-1 font-bold min-h-[36px]"
          >
            ✕
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-8">
          <LoadingIndicator label="جارٍ تحميل المواعيد القانونية..." />
        </div>
      ) : loadError ? (
        <ErrorContainer
          title="تعذر تحميل المواعيد القانونية"
          message={loadError}
          onRetry={refreshDeadlines}
          isRetrying={isLoading}
        />
      ) : deadlines.length === 0 ? (
        <EmptyStateContainer
          title="لا توجد مواعيد قانونية مسجلة"
          description="أضف موعداً قانونياً كمسودة للمراجعة أو اعتمد موعداً بعد التحقق من مصدره القانوني."
          action={
            !isReadOnly ? (
              <button
                type="button"
                onClick={openNewDeadlineModal}
                className="px-4 py-2 bg-[#14566B] text-white text-sm font-semibold rounded-[6px] min-h-[44px]"
              >
                إضافة موعد قانوني
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {/* Draft Section */}
          <section data-testid="deadlines-draft-section" className="space-y-3" aria-labelledby="draft-deadlines-heading">
            <h2 id="draft-deadlines-heading" className="text-lg font-bold text-[#7A4A00] flex items-center gap-2">
              <span>مواعيد تحتاج مراجعة واعتماد ({draftList.length})</span>
            </h2>
            {draftList.length === 0 ? (
              <p className="text-sm text-[#4D606A] bg-white p-4 rounded-[6px] border border-[#D5DFE3]">
                لا توجد مسودات مواعيد بانتظار المراجعة.
              </p>
            ) : (
              <div className="space-y-3">{draftList.map(renderDeadlineCard)}</div>
            )}
          </section>

          {/* Confirmed Section */}
          <section data-testid="deadlines-confirmed-section" className="space-y-3" aria-labelledby="confirmed-deadlines-heading">
            <h2 id="confirmed-deadlines-heading" className="text-lg font-bold text-[#14566B] flex items-center gap-2">
              <span>✓</span>
              <span>مواعيد قانونية مؤكدة ({confirmedList.length})</span>
            </h2>
            {confirmedList.length === 0 ? (
              <p className="text-sm text-[#4D606A] bg-white p-4 rounded-[6px] border border-[#D5DFE3]">
                لا توجد مواعيد قانونية مؤكدة مفتوحة حالياً.
              </p>
            ) : (
              <div className="space-y-3">{confirmedList.map(renderDeadlineCard)}</div>
            )}
          </section>

          {/* Completed / Cancelled Section */}
          <section data-testid="deadlines-completed-section" className="space-y-3" aria-labelledby="closed-deadlines-heading">
            <h2 id="closed-deadlines-heading" className="text-lg font-bold text-[#172A35] flex items-center gap-2">
              <span>مواعيد منتهية أو ملغاة ({closedList.length})</span>
            </h2>
            {closedList.length === 0 ? (
              <p className="text-sm text-[#4D606A] bg-white p-4 rounded-[6px] border border-[#D5DFE3]">
                لا توجد مواعيد منتهية أو ملغاة مسجلة.
              </p>
            ) : (
              <div className="space-y-3">{closedList.map(renderDeadlineCard)}</div>
            )}
          </section>
        </div>
      )}

      {/* Draft / Review & Confirm Modal */}
      {isDraftModalOpen &&
        renderModalPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmittingDraftModal) {
                closeDraftModal();
              }
            }}
          >
            <div
              ref={draftDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="deadline-modal-title"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4 text-right my-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
                <h2 id="deadline-modal-title" className="text-lg font-bold text-[#172A35]">
                  {editingDeadline ? 'مراجعة واعتماد الموعد القانوني' : 'تسجيل موعد قانوني جديد'}
                </h2>
                <button
                  type="button"
                  onClick={closeDraftModal}
                  disabled={isSubmittingDraftModal}
                  aria-label="إغلاق النافذة"
                  className="p-2 text-[#4D606A] hover:text-[#172A35] rounded-[6px] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              {draftSessionExpired && (
                <div role="alert" className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] space-y-2">
                  <p className="font-bold">انتهت صلاحية الجلسة أو يلزم استكمال التحقق</p>
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-[#14566B] text-white font-semibold rounded-[6px] min-h-[44px]"
                  >
                    فتح تسجيل الدخول في نافذة جديدة ↗
                  </a>
                </div>
              )}

              {draftConflictError && (
                <div
                  role="alert"
                  data-testid="deadline-conflict-banner"
                  className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <span>{draftConflictError}</span>
                  <button
                    type="button"
                    onClick={() => {
                      closeDraftModal();
                      refreshDeadlines();
                    }}
                    className="px-3 py-2 bg-[#14566B] text-white font-bold rounded-[6px] min-h-[44px] shrink-0"
                  >
                    تحديث البيانات
                  </button>
                </div>
              )}

              {draftFormError && (
                <div
                  role="alert"
                  data-testid="deadline-form-error"
                  className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-sm text-[#A4262C] font-semibold"
                >
                  {draftFormError}
                </div>
              )}

              <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="deadline-title-input" className="block text-sm font-bold text-[#172A35]">
                    وصف الإجراء / الموعد القانوني <span className="text-[#A4262C]">*</span>
                  </label>
                  <input
                    ref={titleInputRef}
                    id="deadline-title-input"
                    data-testid="deadline-title-input"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                    aria-invalid={Boolean(draftFieldErrors.title)}
                    placeholder="مثال: آخر ميعاد لإيداع صحيفة الاستئناف"
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                {!lockedMatterId && (
                  <div className="space-y-1">
                    <label htmlFor="deadline-matter-select" className="block text-sm font-bold text-[#172A35]">
                      ملف القضية <span className="text-[#A4262C]">*</span>
                    </label>
                    <select
                      id="deadline-matter-select"
                      data-testid="deadline-matter-select"
                      value={matterId}
                      onChange={(e) => {
                        setMatterId(e.target.value);
                        setProceedingId('');
                        setSourceDocumentId('');
                      }}
                      disabled={Boolean(editingDeadline) || isSubmittingDraftModal || isFrozenDraftRetry}
                      aria-invalid={Boolean(draftFieldErrors.matterId)}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    >
                      <option value="">— اختر ملف القضية —</option>
                      {selectableMatters.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fileCode} — {m.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {selectedMatterProceedings.length > 0 && (
                  <div className="space-y-1">
                    <label htmlFor="deadline-proceeding-select" className="block text-sm font-bold text-[#172A35]">
                      القيد القضائي المرتبط (اختياري)
                    </label>
                    <select
                      id="deadline-proceeding-select"
                      data-testid="deadline-proceeding-select"
                      value={proceedingId}
                      onChange={(e) => setProceedingId(e.target.value)}
                      disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    >
                      <option value="">غير مرتبط بقيد محدد</option>
                      {selectedMatterProceedings.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="deadline-date-input" className="block text-sm font-bold text-[#172A35]">
                      التاريخ النهائي للموعد (مطلوب للاعتماد)
                    </label>
                    <input
                      ref={dateInputRef}
                      id="deadline-date-input"
                      data-testid="deadline-date-input"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                      aria-invalid={Boolean(draftFieldErrors.dueDate)}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="deadline-time-input" className="block text-sm font-bold text-[#172A35]">
                      الوقت (اختياري)
                    </label>
                    <input
                      id="deadline-time-input"
                      data-testid="deadline-time-input"
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                      aria-invalid={Boolean(draftFieldErrors.dueTime)}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="deadline-source-input" className="block text-sm font-bold text-[#172A35]">
                    مصدر الموعد القانوني (مطلوب للاعتماد)
                  </label>
                  <input
                    ref={sourceInputRef}
                    id="deadline-source-input"
                    data-testid="deadline-source-input"
                    type="text"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                    aria-invalid={Boolean(draftFieldErrors.source)}
                    placeholder="مثال: إعلان الحكم الصادر بجلسة ... / مادة 227 مرافعات"
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="deadline-source-document-select" className="block text-sm font-bold text-[#172A35]">
                    المستند المصدري المرتبط (اختياري)
                  </label>
                  <select
                    id="deadline-source-document-select"
                    data-testid="deadline-source-document-select"
                    value={sourceDocumentId}
                    onChange={(e) => setSourceDocumentId(e.target.value)}
                    disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  >
                    <option value="">بدون مستند مصدري مرتبط (اختياري)</option>
                    {availableSourceDocs.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title} — {DOCUMENT_TYPE_LABELS_AR[doc.documentType]}
                      </option>
                    ))}
                  </select>
                  {isLoadingMatterDocs && (
                    <p className="text-xs text-[#4D606A]">جارٍ تحميل مستندات الملف الجاهزة...</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="deadline-basis-input" className="block text-sm font-bold text-[#172A35]">
                    سند الاحتساب وملاحظات المراجعة (مطلوب للاعتماد)
                  </label>
                  <textarea
                    ref={basisInputRef}
                    id="deadline-basis-input"
                    data-testid="deadline-basis-input"
                    rows={3}
                    value={basisNotes}
                    onChange={(e) => setBasisNotes(e.target.value)}
                    disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                    aria-invalid={Boolean(draftFieldErrors.basisNotes)}
                    placeholder="مثال: 40 يوماً من تاريخ صدور الحكم الحضوري مضافاً إليها مسافة..."
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                <div className="p-3 bg-sky-50 border border-sky-200 rounded-[6px]">
                  <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                    <input
                      ref={reviewCheckboxRef}
                      type="checkbox"
                      data-testid="deadline-review-checkbox"
                      checked={lawyerReviewed}
                      onChange={(e) => setLawyerReviewed(e.target.checked)}
                      disabled={isSubmittingDraftModal || isFrozenDraftRetry}
                      className="w-5 h-5 text-[#14566B] rounded border-[#7B909B] focus:ring-[#14566B]"
                    />
                    <span className="text-sm font-bold text-[#172A35]">
                      راجعت الموعد واعتمدته يدوياً بعد التحقق من أوراق الدعوى
                    </span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[#E8EEF1]">
                  <button
                    type="button"
                    onClick={closeDraftModal}
                    disabled={isSubmittingDraftModal}
                    className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    data-testid="save-deadline-draft-button"
                    disabled={isSubmittingDraftModal}
                    onClick={handleSaveDraft}
                    className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-[#7A4A00] text-sm font-bold rounded-[6px] border border-amber-300 min-h-[44px] disabled:opacity-50"
                  >
                    {isSubmittingDraftModal
                      ? 'جارٍ الحفظ...'
                      : 'حفظ كمسودة تحتاج مراجعة'}
                  </button>
                  <button
                    type="button"
                    data-testid="confirm-deadline-button"
                    data-modal-retry={isFrozenDraftRetry ? 'true' : undefined}
                    disabled={isSubmittingDraftModal}
                    onClick={handleConfirmDeadline}
                    className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
                  >
                    {isSubmittingDraftModal
                      ? 'جارٍ الاعتماد...'
                      : isFrozenDraftRetry
                      ? 'إعادة المحاولة بنفس المفتاح'
                      : 'راجعت الموعد واعتمدته'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Change Date Modal */}
      {changeDateTarget &&
        renderModalPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmittingDateChange) {
                closeChangeDateModal();
              }
            }}
          >
            <div
              ref={changeDateDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="change-deadline-date-title"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] shadow-xl w-full max-w-md p-6 space-y-4 text-right"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h2 id="change-deadline-date-title" className="text-lg font-bold text-[#172A35]">
                  تعديل تاريخ الموعد القانوني
                </h2>
                <button
                  type="button"
                  onClick={closeChangeDateModal}
                  disabled={isSubmittingDateChange}
                  aria-label="إغلاق النافذة"
                  className="p-2 text-[#4D606A] hover:text-[#172A35] rounded-[6px] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              {changeDateTarget.status === 'CONFIRMED' && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00]">
                  تغيير تاريخ الموعد المؤكد سيعيده تلقائياً إلى <strong>«مسودة تحتاج مراجعة»</strong> ويلغي الاعتماد والتذكيرات السابقة لحين إعادة الاعتماد.
                </div>
              )}

              {dateChangeSessionExpired && (
                <div role="alert" className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] space-y-2">
                  <p className="font-bold">انتهت صلاحية الجلسة أو يلزم التحقق</p>
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-[#14566B] text-white font-semibold rounded-[6px] min-h-[44px]"
                  >
                    فتح تسجيل الدخول في نافذة جديدة ↗
                  </a>
                </div>
              )}

              {dateChangeConflict && (
                <div
                  role="alert"
                  data-testid="deadline-conflict-banner"
                  className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] flex flex-col gap-2"
                >
                  <span>{dateChangeConflict}</span>
                  <button
                    type="button"
                    onClick={() => {
                      closeChangeDateModal();
                      refreshDeadlines();
                    }}
                    className="px-3 py-2 bg-[#14566B] text-white font-bold rounded-[6px] min-h-[44px] self-start"
                  >
                    تحديث البيانات
                  </button>
                </div>
              )}

              {dateChangeError && (
                <div
                  role="alert"
                  data-testid="deadline-form-error"
                  className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-sm text-[#A4262C] font-semibold"
                >
                  {dateChangeError}
                </div>
              )}

              <form onSubmit={handleSubmitDateChange} noValidate className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="change-dl-date" className="block text-sm font-bold text-[#172A35]">
                      التاريخ الجديد
                    </label>
                    <input
                      ref={changeDateInputRef}
                      id="change-dl-date"
                      data-testid="deadline-date-input"
                      type="date"
                      value={newDueDate}
                      onChange={(e) => setNewDueDate(e.target.value)}
                      disabled={isSubmittingDateChange || isFrozenDateRetry}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="change-dl-time" className="block text-sm font-bold text-[#172A35]">
                      الوقت (اختياري)
                    </label>
                    <input
                      id="change-dl-time"
                      data-testid="deadline-time-input"
                      type="time"
                      value={newDueTime}
                      onChange={(e) => setNewDueTime(e.target.value)}
                      disabled={isSubmittingDateChange || isFrozenDateRetry}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="deadline-date-change-reason-input" className="block text-sm font-bold text-[#172A35]">
                    سبب تعديل التاريخ {changeDateTarget.status === 'CONFIRMED' && <span className="text-[#A4262C]">*</span>}
                  </label>
                  <textarea
                    ref={changeReasonInputRef}
                    id="deadline-date-change-reason-input"
                    data-testid="deadline-date-change-reason-input"
                    rows={3}
                    value={dateChangeReason}
                    onChange={(e) => setDateChangeReason(e.target.value)}
                    disabled={isSubmittingDateChange || isFrozenDateRetry}
                    placeholder="اكتب سبب تعديل التاريخ..."
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeChangeDateModal}
                    disabled={isSubmittingDateChange}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    data-testid="save-deadline-date-change-button"
                    disabled={isSubmittingDateChange}
                    className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
                  >
                    {isSubmittingDateChange
                      ? 'جارٍ الحفظ...'
                      : isFrozenDateRetry
                      ? 'إعادة المحاولة بنفس المفتاح'
                      : 'حفظ تعديل التاريخ'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Complete Deadline Modal */}
      {completeTarget &&
        renderModalPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmittingComplete) {
                closeCompleteModal();
              }
            }}
          >
            <div
              ref={completeDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="complete-deadline-title"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] shadow-xl w-full max-w-md p-6 space-y-4 text-right"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h2 id="complete-deadline-title" className="text-lg font-bold text-[#172A35]">
                  ✓ تسجيل تمام تنفيذ الموعد القانوني
                </h2>
                <button
                  type="button"
                  onClick={closeCompleteModal}
                  disabled={isSubmittingComplete}
                  aria-label="إغلاق النافذة"
                  className="p-2 text-[#4D606A] hover:text-[#172A35] rounded-[6px] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              <p className="text-sm text-[#4D606A]">
                الموعد: <strong className="text-[#172A35]">{completeTarget.title}</strong>
              </p>

              {completeSessionExpired && (
                <div role="alert" className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] space-y-2">
                  <p className="font-bold">انتهت صلاحية الجلسة أو يلزم التحقق</p>
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-[#14566B] text-white font-semibold rounded-[6px] min-h-[44px]"
                  >
                    فتح تسجيل الدخول في نافذة جديدة ↗
                  </a>
                </div>
              )}

              {completeConflict && (
                <div
                  role="alert"
                  data-testid="deadline-conflict-banner"
                  className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] flex flex-col gap-2"
                >
                  <span>{completeConflict}</span>
                  <button
                    type="button"
                    onClick={() => {
                      closeCompleteModal();
                      refreshDeadlines();
                    }}
                    className="px-3 py-2 bg-[#14566B] text-white font-bold rounded-[6px] min-h-[44px] self-start"
                  >
                    تحديث البيانات
                  </button>
                </div>
              )}

              {completeError && (
                <div
                  role="alert"
                  data-testid="deadline-completion-error"
                  className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-sm text-[#A4262C] font-semibold"
                >
                  {completeError}
                </div>
              )}

              <form onSubmit={handleSubmitComplete} noValidate className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="deadline-completion-date-input" className="block text-sm font-bold text-[#172A35]">
                    تاريخ التنفيذ الفعلي <span className="text-[#A4262C]">*</span>
                  </label>
                  <input
                    ref={completionDateInputRef}
                    id="deadline-completion-date-input"
                    data-testid="deadline-completion-date-input"
                    type="date"
                    value={completionDate}
                    onChange={(e) => setCompletionDate(e.target.value)}
                    disabled={isSubmittingComplete || isFrozenCompleteRetry}
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="deadline-completion-notes-input" className="block text-sm font-bold text-[#172A35]">
                    وصف ما تم تنفيذه <span className="text-[#A4262C]">*</span>
                  </label>
                  <textarea
                    ref={completionNotesInputRef}
                    id="deadline-completion-notes-input"
                    data-testid="deadline-completion-notes-input"
                    rows={3}
                    value={completionNotes}
                    onChange={(e) => setCompletionNotes(e.target.value)}
                    disabled={isSubmittingComplete || isFrozenCompleteRetry}
                    placeholder="مثال: تم إيداع صحيفة الاستئناف بقلم المحكمة برقم ..."
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeCompleteModal}
                    disabled={isSubmittingComplete}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    data-testid="deadline-completion-submit-button"
                    disabled={isSubmittingComplete}
                    className="px-5 py-2 bg-[#176449] hover:bg-[#114D38] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
                  >
                    {isSubmittingComplete
                      ? 'جارٍ الحفظ...'
                      : isFrozenCompleteRetry
                      ? 'إعادة المحاولة بنفس المفتاح'
                      : 'توثيق تمام الإجراء'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Cancel Deadline Modal */}
      {cancelTarget &&
        renderModalPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmittingCancel) {
                closeCancelModal();
              }
            }}
          >
            <div
              ref={cancelDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-deadline-title"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] shadow-xl w-full max-w-md p-6 space-y-4 text-right"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h2 id="cancel-deadline-title" className="text-lg font-bold text-[#172A35]">
                  إلغاء الموعد القانوني
                </h2>
                <button
                  type="button"
                  onClick={closeCancelModal}
                  disabled={isSubmittingCancel}
                  aria-label="إغلاق النافذة"
                  className="p-2 text-[#4D606A] hover:text-[#172A35] rounded-[6px] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              <p className="text-sm text-[#4D606A]">
                إلغاء الموعد: <strong className="text-[#172A35]">{cancelTarget.title}</strong>
              </p>

              {cancelConflict && (
                <div
                  role="alert"
                  data-testid="deadline-conflict-banner"
                  className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] flex flex-col gap-2"
                >
                  <span>{cancelConflict}</span>
                  <button
                    type="button"
                    onClick={() => {
                      closeCancelModal();
                      refreshDeadlines();
                    }}
                    className="px-3 py-2 bg-[#14566B] text-white font-bold rounded-[6px] min-h-[44px] self-start"
                  >
                    تحديث البيانات
                  </button>
                </div>
              )}

              {cancelError && (
                <div role="alert" data-testid="deadline-form-error" className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-sm text-[#A4262C]">
                  {cancelError}
                </div>
              )}

              <form onSubmit={handleConfirmCancelDeadline} noValidate className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="deadline-cancel-reason-input" className="block text-sm font-bold text-[#172A35]">
                    سبب الإلغاء <span className="text-[#A4262C]">*</span>
                  </label>
                  <textarea
                    ref={cancelReasonInputRef}
                    id="deadline-cancel-reason-input"
                    data-testid="deadline-cancel-reason-input"
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    disabled={isSubmittingCancel}
                    placeholder="اكتب سبب إلغاء الموعد القانوني..."
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeCancelModal}
                    disabled={isSubmittingCancel}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    رجوع
                  </button>
                  <button
                    type="submit"
                    data-testid="confirm-cancel-deadline-button"
                    disabled={isSubmittingCancel}
                    className="px-5 py-2 bg-[#A4262C] hover:bg-[#881D22] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
                  >
                    {isSubmittingCancel ? 'جارٍ الإلغاء...' : 'تأكيد إلغاء الموعد'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
    </div>
  );
}
