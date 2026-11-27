'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { renderModalPortal, useAccessibleModal } from '@/components/productivity/productivity-ui-types';
import {
  MatterDTO,
  MatterPartyRole,
  MatterPartySummaryDTO,
  MatterAuthorizationSummaryDTO,
  ProceedingSummaryDTO,
  MatterStatus,
  ProceedingStatus,
  hasCompleteProceedingRegistration,
} from '@/modules/matters/matter-types';
import {
  linkMatterPartyAction,
  updateMatterPartyAction,
  unlinkMatterPartyAction,
  linkMatterAuthorizationAction,
  unlinkMatterAuthorizationAction,
  archiveMatterAction,
  reopenMatterAction,
  archiveProceedingAction,
  reopenProceedingAction,
} from '@/modules/matters/matter-actions';
import { searchPartiesAction } from '@/modules/parties/actions';
import { listMatterAuthorizationOptionsAction } from '@/modules/matters/matter-actions';
import {
  MATTER_KIND_LABELS,
  MATTER_STATUS_LABELS,
  MATTER_STATUS_CLASSES,
  MATTER_PARTY_ROLE_LABELS,
  PROCEEDING_INSTANCE_LABELS,
  PROCEEDING_STATUS_LABELS,
  PROCEEDING_LEGAL_CAPACITY_LABELS,
  POA_REVIEW_STATUS_LABELS,
  POA_REVIEW_STATUS_CLASSES,
  formatCairoDateOnly,
  generateClientRequestId,
  isAuthRecoveryCode,
} from './matter-ui-types';
import { TasksView } from '@/components/productivity/tasks-view';
import { DeadlinesView } from '@/components/deadlines/deadlines-view';
import type { TaskItemDTO } from '@/modules/productivity/productivity-types';
import type { DeadlineDTO, LinkableDocumentSummary } from '@/modules/scheduling/deadline-types';

interface MatterDetailClientProps {
  ownerId: string;
  initialMatter: MatterDTO;
  initialTasks?: TaskItemDTO[];
  initialDeadlines?: DeadlineDTO[];
  initialDocuments?: LinkableDocumentSummary[];
  canReadDocuments?: boolean;
  documentsError?: string;
  tasksError?: string;
  deadlinesError?: string;
}

export function MatterDetailClient({
  ownerId,
  initialMatter,
  initialTasks = [],
  initialDeadlines = [],
  initialDocuments,
  canReadDocuments = false,
  documentsError,
  tasksError,
  deadlinesError,
}: MatterDetailClientProps) {
  const router = useRouter();
  const [matter, setMatter] = useState<MatterDTO>(initialMatter);
  // U8: router.refresh() supplies a newly confirmed aggregate. Replace the
  // optimistic local copy with it instead of keeping the first server render.
  const prevInitialMatterRef = useRef(initialMatter);
  useEffect(() => {
    if (initialMatter !== prevInitialMatterRef.current) {
      prevInitialMatterRef.current = initialMatter;
      setMatter(initialMatter);
    }
  }, [initialMatter]);
  const [activeTab, setActiveTab] = useState<
    'parties' | 'proceedings' | 'authorizations' | 'tasksDeadlines' | 'summary'
  >('parties');
  const tabRefs = useRef<Partial<Record<'parties' | 'proceedings' | 'authorizations' | 'tasksDeadlines' | 'summary', HTMLButtonElement | null>>>({});

  const handleMatterTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: 'parties' | 'proceedings' | 'authorizations' | 'tasksDeadlines' | 'summary'
  ) => {
    const tabs = ['parties', 'proceedings', 'authorizations', 'tasksDeadlines', 'summary'] as const;
    const idx = tabs.indexOf(currentTab);
    let nextIdx = -1;
    if (e.key === 'ArrowLeft') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowRight') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    if (nextIdx === -1) return;
    e.preventDefault();
    const nextTab = tabs[nextIdx];
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  // Party Linking Modal / Form State (C11 guarded async lifecycle)
  const [showAddPartyModal, setShowAddPartyModal] = useState(false);
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [searchedParties, setSearchedParties] = useState<{ id: string; name: string }[]>([]);
  const [isSearchingParty, setIsSearchingParty] = useState(false);
  const [partySearchError, setPartySearchError] = useState<string | null>(null);
  const partySearchGenRef = useRef(0);
  const partySearchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (partySearchTimerRef.current) clearTimeout(partySearchTimerRef.current);
    };
  }, []);

  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [selectedPartyRole, setSelectedPartyRole] = useState<MatterPartyRole>('CLIENT');
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);
  const [partyNotes, setPartyNotes] = useState('');
  const [isSubmittingParty, setIsSubmittingParty] = useState(false);
  const [partyActionError, setPartyActionError] = useState<string | null>(null);

  // POA Linking State
  const [showAddPoaModal, setShowAddPoaModal] = useState(false);
  const [availablePoas, setAvailablePoas] = useState<
    { id: string; poaNumberText: string; poaYearLabel: string; notarizationOffice: string; partyName: string }[]
  >([]);
  const [selectedPoaId, setSelectedPoaId] = useState('');
  const [isLoadingPoas, setIsLoadingPoas] = useState(false);
  const [isSubmittingPoa, setIsSubmittingPoa] = useState(false);
  const [poaActionError, setPoaActionError] = useState<string | null>(null);
  const poaLoadGenRef = useRef(0);

  // General Notification / Error
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Matter Archive/Reopen State
  const [showArchiveMatterModal, setShowArchiveMatterModal] = useState(false);
  const [showReopenMatterModal, setShowReopenMatterModal] = useState(false);
  const [matterLifecycleReason, setMatterLifecycleReason] = useState('');
  const [isLifecycleSubmitting, setIsLifecycleSubmitting] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleSessionExpired, setLifecycleSessionExpired] = useState(false);

  // Proceeding Archive/Reopen State
  const [selectedProceedingForLifecycle, setSelectedProceedingForLifecycle] = useState<ProceedingSummaryDTO | null>(null);
  const [proceedingLifecycleAction, setProceedingLifecycleAction] = useState<'archive' | 'reopen' | null>(null);
  const [proceedingLifecycleReason, setProceedingLifecycleReason] = useState('');
  const [isProceedingLifecycleSubmitting, setIsProceedingLifecycleSubmitting] = useState(false);
  const [proceedingLifecycleError, setProceedingLifecycleError] = useState<string | null>(null);

  // Lifecycle Operations Recovery & Frozen Key (Standards 3)
  type LifecycleOp =
    | {
        kind: 'archiveMatter';
        key: string;
        payload: {
          matterId: string;
          reason: string;
          expectedVersion: number;
        };
        description: string;
      }
    | {
        kind: 'reopenMatter';
        key: string;
        payload: {
          matterId: string;
          reason: string;
          expectedVersion: number;
        };
        description: string;
      }
    | {
        kind: 'archiveProceeding';
        key: string;
        proceedingId: string;
        payload: {
          proceedingId: string;
          matterId: string;
          reason: string;
          expectedVersion: number;
        };
        description: string;
      }
    | {
        kind: 'reopenProceeding';
        key: string;
        proceedingId: string;
        payload: {
          proceedingId: string;
          matterId: string;
          reason: string;
          expectedVersion: number;
        };
        description: string;
      };

  const lifecycleDraft = useFormDraft<LifecycleOp>(ownerId, `/matters/${initialMatter.id}`);
  const pendingLifecycleOpRef = useRef<LifecycleOp | null>(lifecycleDraft.restored ?? null);
  const [pendingLifecycleOp, setPendingLifecycleOp] = useState<LifecycleOp | null>(lifecycleDraft.restored ?? null);

  function updatePendingLifecycleOp(operation: LifecycleOp | null) {
    if (!lifecycleDraft.isCurrent()) return;
    pendingLifecycleOpRef.current = operation;
    if (operation) {
      lifecycleDraft.keep(operation);
    } else {
      lifecycleDraft.clear();
    }
    setPendingLifecycleOp(operation);
  }

  // Standards 5: Modal Focus Management
  const archiveMatterModalRef = useRef<HTMLDivElement>(null);
  const archiveMatterReasonInputRef = useRef<HTMLTextAreaElement>(null);
  const reopenMatterModalRef = useRef<HTMLDivElement>(null);
  const reopenMatterReasonInputRef = useRef<HTMLTextAreaElement>(null);
  const procLifecycleModalRef = useRef<HTMLDivElement>(null);
  const procLifecycleReasonInputRef = useRef<HTMLTextAreaElement>(null);

  // Association Operations Recovery & Frozen Key (U1/U3)
  type AssociationOp =
    | {
        kind: 'linkParty';
        key: string;
        targetId: string;
        payload: {
          matterId: string;
          partyId: string;
          role: MatterPartyRole;
          isPrimaryContact: boolean;
          billingEnabled: boolean;
          notes: string | null;
        };
        description: string;
      }
    | {
        kind: 'unlinkParty';
        key: string;
        targetId: string;
        partyName: string;
        payload: {
          id: string;
          matterId: string;
          expectedVersion: number;
        };
        description: string;
      }
    | {
        kind: 'togglePrimary';
        key: string;
        targetId: string;
        payload: {
          id: string;
          matterId: string;
          expectedVersion: number;
          role: MatterPartyRole;
          isPrimaryContact: boolean;
          billingEnabled?: boolean;
          notes?: string | null;
        };
        description: string;
      }
    | {
        kind: 'linkPoa';
        key: string;
        targetId: string;
        payload: {
          matterId: string;
          powerOfAttorneyId: string;
        };
        description: string;
      }
    | {
        kind: 'unlinkPoa';
        key: string;
        targetId: string;
        payload: {
          id: string;
          matterId: string;
        };
        description: string;
      };

  const pendingAssocOpRef = useRef<AssociationOp | null>(null);
  const [pendingAssocOp, setPendingAssocOp] = useState<AssociationOp | null>(null);
  const [assocSessionExpired, setAssocSessionExpired] = useState(false);
  const [isAssocSubmitting, setIsAssocSubmitting] = useState(false);

  const parties = matter.parties || [];
  const proceedings = matter.proceedings || [];
  const authorizations = matter.authorizations || [];

  const clients = parties.filter((p) => p.role === 'CLIENT');
  const opponents = parties.filter((p) => p.role === 'OPPONENT');
  const otherParties = parties.filter((p) => p.role === 'OTHER');

  const hasMissingPaperLocation = !matter.paperLocationId && matter.status === 'ACTIVE';

  const handleOpenPartyModal = () => {
    setActionMessage(null);
    setActionError(null);
    setPartyActionError(null);
    setPartySearchError(null);
    if (partySearchTimerRef.current) clearTimeout(partySearchTimerRef.current);
    partySearchGenRef.current++;
    setSearchedParties([]);
    setShowAddPartyModal(true);
  };

  const closePartyModal = () => {
    // U4: invalidate any in-flight search so a late response cannot repopulate
    // the panel after it was closed.
    if (partySearchTimerRef.current) clearTimeout(partySearchTimerRef.current);
    partySearchGenRef.current++;
    setSearchedParties([]);
    setIsSearchingParty(false);
    setShowAddPartyModal(false);
  };

  const hasUnsavedModalInput = Boolean(
    pendingAssocOp ||
      ((showArchiveMatterModal || showReopenMatterModal) && matterLifecycleReason.trim()) ||
      (selectedProceedingForLifecycle && proceedingLifecycleReason.trim()) ||
      (showAddPartyModal && (selectedPartyId || partyNotes.trim())) ||
      (showAddPoaModal && selectedPoaId)
  );
  const hasPendingOperations = Boolean(
    isLifecycleSubmitting ||
      isProceedingLifecycleSubmitting ||
      isAssocSubmitting ||
      isSubmittingParty ||
      isSubmittingPoa
  );
  useLeaveGuard(hasUnsavedModalInput, hasPendingOperations);

  const openArchiveMatterModal = () => {
    if (pendingLifecycleOpRef.current && pendingLifecycleOpRef.current.kind !== 'archiveMatter') {
      setActionMessage(null);
      setActionError(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}). يرجى حسمها أولاً.`);
      return;
    }
    setActionError(null);
    setLifecycleError(null);
    setLifecycleSessionExpired(false);
    setMatterLifecycleReason(
      pendingLifecycleOpRef.current?.kind === 'archiveMatter'
        ? pendingLifecycleOpRef.current.payload.reason
        : ''
    );
    setShowArchiveMatterModal(true);
  };

  const closeArchiveMatterModal = useCallback(() => {
    if (isLifecycleSubmitting) return;
    setShowArchiveMatterModal(false);
  }, [isLifecycleSubmitting]);

  const openReopenMatterModal = () => {
    if (pendingLifecycleOpRef.current && pendingLifecycleOpRef.current.kind !== 'reopenMatter') {
      setActionMessage(null);
      setActionError(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}). يرجى حسمها أولاً.`);
      return;
    }
    setActionError(null);
    setLifecycleError(null);
    setLifecycleSessionExpired(false);
    setMatterLifecycleReason(
      pendingLifecycleOpRef.current?.kind === 'reopenMatter'
        ? pendingLifecycleOpRef.current.payload.reason
        : ''
    );
    setShowReopenMatterModal(true);
  };

  const closeReopenMatterModal = useCallback(() => {
    if (isLifecycleSubmitting) return;
    setShowReopenMatterModal(false);
  }, [isLifecycleSubmitting]);

  const openProceedingLifecycleModal = (
    proc: ProceedingSummaryDTO,
    action: 'archive' | 'reopen'
  ) => {
    if (
      pendingLifecycleOpRef.current &&
      !(
        ((action === 'archive' && pendingLifecycleOpRef.current.kind === 'archiveProceeding') ||
          (action === 'reopen' && pendingLifecycleOpRef.current.kind === 'reopenProceeding')) &&
        pendingLifecycleOpRef.current.proceedingId === proc.id
      )
    ) {
      setActionMessage(null);
      setActionError(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}). يرجى حسمها أولاً.`);
      return;
    }
    setActionError(null);
    setSelectedProceedingForLifecycle(proc);
    setProceedingLifecycleAction(action);
    setProceedingLifecycleError(null);
    setLifecycleSessionExpired(false);
    const isFrozenMatching =
      pendingLifecycleOpRef.current &&
      ((action === 'archive' && pendingLifecycleOpRef.current.kind === 'archiveProceeding') ||
        (action === 'reopen' && pendingLifecycleOpRef.current.kind === 'reopenProceeding')) &&
      pendingLifecycleOpRef.current.proceedingId === proc.id;
    setProceedingLifecycleReason(
      isFrozenMatching && pendingLifecycleOpRef.current
        ? pendingLifecycleOpRef.current.payload.reason
        : ''
    );
  };

  const closeProceedingLifecycleModal = useCallback(() => {
    if (isProceedingLifecycleSubmitting) return;
    setSelectedProceedingForLifecycle(null);
    setProceedingLifecycleAction(null);
  }, [isProceedingLifecycleSubmitting]);

  useAccessibleModal({
    isOpen: showArchiveMatterModal,
    isSubmitting: isLifecycleSubmitting,
    hasPending: pendingLifecycleOp?.kind === 'archiveMatter',
    onClose: closeArchiveMatterModal,
    dialogRef: archiveMatterModalRef,
    initialFocusRef: archiveMatterReasonInputRef,
  });

  useAccessibleModal({
    isOpen: showReopenMatterModal,
    isSubmitting: isLifecycleSubmitting,
    hasPending: pendingLifecycleOp?.kind === 'reopenMatter',
    onClose: closeReopenMatterModal,
    dialogRef: reopenMatterModalRef,
    initialFocusRef: reopenMatterReasonInputRef,
  });

  useAccessibleModal({
    isOpen: Boolean(selectedProceedingForLifecycle && proceedingLifecycleAction),
    isSubmitting: isProceedingLifecycleSubmitting,
    hasPending: Boolean(
      selectedProceedingForLifecycle &&
        (pendingLifecycleOp?.kind === 'archiveProceeding' || pendingLifecycleOp?.kind === 'reopenProceeding') &&
        pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id
    ),
    onClose: closeProceedingLifecycleModal,
    dialogRef: procLifecycleModalRef,
    initialFocusRef: procLifecycleReasonInputRef,
  });

  // Search Parties for Linking (C11/U4: separate query from selection, clear
  // stale rows on query change, and invalidate generations on selection/close)
  const handleSearchParties = (q: string) => {
    setPartySearchQuery(q);
    setSelectedPartyId('');
    setSearchedParties([]);
    if (partySearchTimerRef.current) clearTimeout(partySearchTimerRef.current);
    const gen = ++partySearchGenRef.current;

    if (!q.trim()) {
      setIsSearchingParty(false);
      setPartySearchError(null);
      return;
    }

    setIsSearchingParty(true);
    setPartySearchError(null);

    partySearchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchPartiesAction({ query: q.trim(), limit: 10 });
        if (gen !== partySearchGenRef.current) return; // Stale delayed response, discard
        if (res.success) {
          setSearchedParties(res.data.parties.map((p) => ({ id: p.id, name: p.name })));
        } else {
          setPartySearchError(res.error || 'تعذر البحث عن الأطراف.');
        }
      } catch {
        if (gen === partySearchGenRef.current) {
          setPartySearchError('حدث خطأ في الاتصال أثناء البحث.');
        }
      } finally {
        if (gen === partySearchGenRef.current) {
          setIsSearchingParty(false);
        }
      }
    }, 250);
  };

  // Execute Link Party (U1/U3 frozen recovery)
  const executeLinkParty = async (op: Extract<AssociationOp, { kind: 'linkParty' }>) => {
    if (isAssocSubmitting) return;
    setIsAssocSubmitting(true);
    setIsSubmittingParty(true);
    setPartyActionError(null);
    try {
      const res = await linkMatterPartyAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setAssocSessionExpired(true);
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPartyActionError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPartyActionError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          if (pendingAssocOpRef.current?.key === op.key) {
            pendingAssocOpRef.current = null;
            setPendingAssocOp(null);
          }
          setPartyActionError(res.error || 'تعذر ربط الطرف بالملف.');
        }
        return;
      }

      if (pendingAssocOpRef.current?.key === op.key) {
        pendingAssocOpRef.current = null;
        setPendingAssocOp(null);
        setAssocSessionExpired(false);
      }
      setShowAddPartyModal(false);
      partySearchGenRef.current++;
      setSearchedParties([]);
      setSelectedPartyId('');
      setPartySearchQuery('');
      setPartyNotes('');
      setIsPrimaryContact(false);
      router.refresh();
      setMatter((prev) => ({
        ...prev,
        parties: [...(prev.parties || []), res.data],
      }));
      setActionMessage('تم ربط الطرف بالملف بنجاح.');
    } catch (err: unknown) {
      if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
        pendingAssocOpRef.current = op;
        setPendingAssocOp(op);
      }
      setPartyActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
    } finally {
      setIsSubmittingParty(false);
      setIsAssocSubmitting(false);
    }
  };

  const handleLinkParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyId || isAssocSubmitting) return;

    if (
      pendingAssocOpRef.current &&
      (pendingAssocOpRef.current.kind !== 'linkParty' ||
        pendingAssocOpRef.current.targetId !== selectedPartyId)
    ) {
      setPartyActionError(
        'توجد عملية سابقة قيد الانتظار أو لم يتأكد اكتمالها بعد. يرجى إعادة محاولة أو حسم العملية العالقة أولاً قبل بدء عملية جديدة.'
      );
      return;
    }

    let op = pendingAssocOpRef.current;
    if (!op || op.kind !== 'linkParty') {
      op = {
        kind: 'linkParty',
        key: generateClientRequestId('lp'),
        targetId: selectedPartyId,
        payload: {
          matterId: matter.id,
          partyId: selectedPartyId,
          role: selectedPartyRole,
          isPrimaryContact: selectedPartyRole === 'CLIENT' && isPrimaryContact,
          billingEnabled: false,
          notes: partyNotes.trim() || null,
        },
        description: 'ربط طرف بالملف',
      };
      pendingAssocOpRef.current = op;
    }
    await executeLinkParty(op as Extract<AssociationOp, { kind: 'linkParty' }>);
  };

  // Execute Unlink Party (U1/U3 frozen recovery)
  const executeUnlinkParty = async (op: Extract<AssociationOp, { kind: 'unlinkParty' }>) => {
    if (isAssocSubmitting) return;
    setIsAssocSubmitting(true);
    setPartyActionError(null);
    try {
      const res = await unlinkMatterPartyAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setAssocSessionExpired(true);
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPartyActionError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPartyActionError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          if (pendingAssocOpRef.current?.key === op.key) {
            pendingAssocOpRef.current = null;
            setPendingAssocOp(null);
          }
          setPartyActionError(res.error || 'تعذر إزالة الطرف.');
        }
        return;
      }

      if (pendingAssocOpRef.current?.key === op.key) {
        pendingAssocOpRef.current = null;
        setPendingAssocOp(null);
        setAssocSessionExpired(false);
      }
      setMatter((prev) => ({
        ...prev,
        parties: prev.parties?.filter((p) => p.id !== op.targetId),
      }));
      router.refresh();
      setActionMessage('تمت إزالة الطرف من الملف بنجاح.');
    } catch (err: unknown) {
      if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
        setPendingAssocOp(op);
      }
      setPartyActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
    } finally {
      setIsAssocSubmitting(false);
    }
  };

  const handleUnlinkParty = async (partyLink: MatterPartySummaryDTO) => {
    if (isAssocSubmitting) return;

    if (
      pendingAssocOpRef.current &&
      (pendingAssocOpRef.current.kind !== 'unlinkParty' ||
        pendingAssocOpRef.current.targetId !== partyLink.id)
    ) {
      setPartyActionError(
        'توجد عملية سابقة قيد الانتظار أو لم يتأكد اكتمالها بعد. يرجى إعادة محاولة أو حسم العملية العالقة أولاً قبل بدء عملية جديدة.'
      );
      return;
    }

    if (!confirm(`هل أنت متأكد من إزالة الطرف "${partyLink.partyName}" من هذا الملف؟`)) {
      return;
    }

    let op = pendingAssocOpRef.current;
    if (!op || op.kind !== 'unlinkParty' || op.targetId !== partyLink.id) {
      op = {
        kind: 'unlinkParty',
        key: generateClientRequestId('up'),
        targetId: partyLink.id,
        partyName: partyLink.partyName,
        payload: {
          id: partyLink.id,
          matterId: matter.id,
          expectedVersion: partyLink.version,
        },
        description: `إزالة الطرف "${partyLink.partyName}"`,
      };
      pendingAssocOpRef.current = op;
    }
    await executeUnlinkParty(op as Extract<AssociationOp, { kind: 'unlinkParty' }>);
  };

  // Execute Toggle Primary Contact (U1/U3 frozen recovery)
  const executeTogglePrimary = async (op: Extract<AssociationOp, { kind: 'togglePrimary' }>) => {
    if (isAssocSubmitting) return;
    setIsAssocSubmitting(true);
    setPartyActionError(null);
    try {
      const res = await updateMatterPartyAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setAssocSessionExpired(true);
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPartyActionError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPartyActionError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          if (pendingAssocOpRef.current?.key === op.key) {
            pendingAssocOpRef.current = null;
            setPendingAssocOp(null);
          }
          setPartyActionError(res.error || 'تعذر تعديل جهة الاتصال الأساسية.');
        }
        return;
      }

      if (pendingAssocOpRef.current?.key === op.key) {
        pendingAssocOpRef.current = null;
        setPendingAssocOp(null);
        setAssocSessionExpired(false);
      }
      setMatter((prev) => ({
        ...prev,
        parties: prev.parties?.map((p) => (p.id === op.targetId ? res.data : p)),
      }));
      router.refresh();
      setActionMessage('تم تحديث جهة الاتصال الأساسية بنجاح.');
    } catch (err: unknown) {
      if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
        setPendingAssocOp(op);
      }
      setPartyActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
    } finally {
      setIsAssocSubmitting(false);
    }
  };

  const handleTogglePrimary = async (partyLink: MatterPartySummaryDTO) => {
    if (isAssocSubmitting) return;

    if (
      pendingAssocOpRef.current &&
      (pendingAssocOpRef.current.kind !== 'togglePrimary' ||
        pendingAssocOpRef.current.targetId !== partyLink.id)
    ) {
      setPartyActionError(
        'توجد عملية سابقة قيد الانتظار أو لم يتأكد اكتمالها بعد. يرجى إعادة محاولة أو حسم العملية العالقة أولاً قبل بدء عملية جديدة.'
      );
      return;
    }

    let op = pendingAssocOpRef.current;
    if (!op || op.kind !== 'togglePrimary' || op.targetId !== partyLink.id) {
      op = {
        kind: 'togglePrimary',
        key: generateClientRequestId('tp'),
        targetId: partyLink.id,
        payload: {
          id: partyLink.id,
          matterId: matter.id,
          expectedVersion: partyLink.version,
          role: partyLink.role,
          isPrimaryContact: !partyLink.isPrimaryContact,
          billingEnabled: partyLink.billingEnabled,
          notes: partyLink.notes,
        },
        description: `تعديل جهة الاتصال الأساسية للطرف "${partyLink.partyName}"`,
      };
      pendingAssocOpRef.current = op;
    }
    await executeTogglePrimary(op as Extract<AssociationOp, { kind: 'togglePrimary' }>);
  };

  // Load POAs for linking
  const handleOpenPoaModal = async () => {
    const gen = ++poaLoadGenRef.current;
    setActionMessage(null);
    setActionError(null);
    setAvailablePoas([]);
    setSelectedPoaId('');
    setShowAddPoaModal(true);
    setIsLoadingPoas(true);
    setPoaActionError(null);
    try {
      const res = await listMatterAuthorizationOptionsAction(matter.id);
      if (gen !== poaLoadGenRef.current) return;
      if (res.success) setAvailablePoas(res.data);
      else setPoaActionError(res.error || 'تعذر تحميل التوكيلات. يمكنك إعادة المحاولة.');
      setIsLoadingPoas(false);
    } catch {
      if (gen !== poaLoadGenRef.current) return;
      setPoaActionError('حدث خطأ في الاتصال أثناء جلب التوكيلات. القائمة المعروضة غير كاملة.');
      setIsLoadingPoas(false);
    }
  };

  const closePoaModal = () => {
    poaLoadGenRef.current++;
    setIsLoadingPoas(false);
    setShowAddPoaModal(false);
  };

  // Execute Link POA (U1/U3 frozen recovery)
  const executeLinkPoa = async (op: Extract<AssociationOp, { kind: 'linkPoa' }>) => {
    if (isAssocSubmitting) return;
    setIsAssocSubmitting(true);
    setIsSubmittingPoa(true);
    setPoaActionError(null);
    try {
      const res = await linkMatterAuthorizationAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setAssocSessionExpired(true);
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPoaActionError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setPoaActionError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          if (pendingAssocOpRef.current?.key === op.key) {
            pendingAssocOpRef.current = null;
            setPendingAssocOp(null);
          }
          setPoaActionError(res.error || 'تعذر ربط التوكيل بالملف.');
        }
        return;
      }

      if (pendingAssocOpRef.current?.key === op.key) {
        pendingAssocOpRef.current = null;
        setPendingAssocOp(null);
        setAssocSessionExpired(false);
      }
      setShowAddPoaModal(false);
      poaLoadGenRef.current++;
      setSelectedPoaId('');
      router.refresh();
      setMatter((prev) => ({
        ...prev,
        authorizations: [...(prev.authorizations || []), res.data],
      }));
      setActionMessage('تم ربط التوكيل بالملف بنجاح.');
    } catch (err: unknown) {
      if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
        setPendingAssocOp(op);
      }
      setPoaActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
    } finally {
      setIsSubmittingPoa(false);
      setIsAssocSubmitting(false);
    }
  };

  const handleLinkPoa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPoaId || isAssocSubmitting) return;

    if (
      pendingAssocOpRef.current &&
      (pendingAssocOpRef.current.kind !== 'linkPoa' ||
        pendingAssocOpRef.current.targetId !== selectedPoaId)
    ) {
      setPoaActionError(
        'توجد عملية سابقة قيد الانتظار أو لم يتأكد اكتمالها بعد. يرجى إعادة محاولة أو حسم العملية العالقة أولاً قبل بدء عملية جديدة.'
      );
      return;
    }

    let op = pendingAssocOpRef.current;
    if (!op || op.kind !== 'linkPoa') {
      op = {
        kind: 'linkPoa',
        key: generateClientRequestId('lpoa'),
        targetId: selectedPoaId,
        payload: {
          matterId: matter.id,
          powerOfAttorneyId: selectedPoaId,
        },
        description: 'ربط توكيل بالملف',
      };
      pendingAssocOpRef.current = op;
    }
    await executeLinkPoa(op as Extract<AssociationOp, { kind: 'linkPoa' }>);
  };

  // Execute Unlink POA (U1/U3 frozen recovery)
  const executeUnlinkPoa = async (op: Extract<AssociationOp, { kind: 'unlinkPoa' }>) => {
    if (isAssocSubmitting) return;
    setIsAssocSubmitting(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await unlinkMatterAuthorizationAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setAssocSessionExpired(true);
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setActionError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setActionError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          if (pendingAssocOpRef.current?.key === op.key) {
            pendingAssocOpRef.current = null;
            setPendingAssocOp(null);
          }
          setActionError(`تعذر إلغاء الربط: ${res.error}`);
        }
        return;
      }

      if (pendingAssocOpRef.current?.key === op.key) {
        pendingAssocOpRef.current = null;
        setPendingAssocOp(null);
        setAssocSessionExpired(false);
      }
      setMatter((prev) => ({
        ...prev,
        authorizations: prev.authorizations?.filter((a) => a.id !== op.targetId),
      }));
      router.refresh();
      setActionMessage('تم إلغاء ربط التوكيل بنجاح.');
    } catch {
      if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
        setPendingAssocOp(op);
      }
      setActionError('حدث خطأ أثناء إلغاء الربط.');
    } finally {
      setIsAssocSubmitting(false);
    }
  };

  const handleUnlinkPoa = async (auth: MatterAuthorizationSummaryDTO) => {
    if (isAssocSubmitting) return;

    if (
      pendingAssocOpRef.current &&
      (pendingAssocOpRef.current.kind !== 'unlinkPoa' ||
        pendingAssocOpRef.current.targetId !== auth.id)
    ) {
      setActionError(
        'توجد عملية سابقة قيد الانتظار أو لم يتأكد اكتمالها بعد. يرجى إعادة محاولة أو حسم العملية العالقة أولاً قبل بدء عملية جديدة.'
      );
      return;
    }

    if (!confirm('هل ترغب في إلغاء ربط هذا التوكيل من هذا الملف؟')) return;

    let op = pendingAssocOpRef.current;
    if (!op || op.kind !== 'unlinkPoa' || op.targetId !== auth.id) {
      op = {
        kind: 'unlinkPoa',
        key: generateClientRequestId('upoa'),
        targetId: auth.id,
        payload: {
          id: auth.id,
          matterId: matter.id,
        },
        description: 'إلغاء ربط توكيل',
      };
      pendingAssocOpRef.current = op;
    }
    await executeUnlinkPoa(op as Extract<AssociationOp, { kind: 'unlinkPoa' }>);
  };

  const handleRetryPendingAssoc = async () => {
    const op = pendingAssocOpRef.current;
    if (!op) return;
    if (op.kind === 'linkParty') {
      await executeLinkParty(op);
    } else if (op.kind === 'unlinkParty') {
      await executeUnlinkParty(op);
    } else if (op.kind === 'togglePrimary') {
      await executeTogglePrimary(op);
    } else if (op.kind === 'linkPoa') {
      await executeLinkPoa(op);
    } else if (op.kind === 'unlinkPoa') {
      await executeUnlinkPoa(op);
    }
  };

  const isMatterArchived = matter.status === 'ARCHIVED' || Boolean(matter.archivedAt);

  const executeArchiveMatter = async (op: Extract<LifecycleOp, { kind: 'archiveMatter' }>) => {
    setIsLifecycleSubmitting(true);
    setLifecycleError(null);
    try {
      const res = await archiveMatterAction({
        ...op.payload,
        idempotencyKey: op.key,
      }, ownerId);

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          updatePendingLifecycleOp(op);
          setLifecycleSessionExpired(true);
          setLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(op);
          setLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(null);
          setLifecycleError(res.error || 'تعذر أرشفة الملف.');
        }
        return;
      }

      setLifecycleSessionExpired(false);
      updatePendingLifecycleOp(null);
      setMatter((prev) => ({
        ...prev,
        status: 'ARCHIVED',
        archivedAt: res.data.archivedAt,
        version: res.data.version,
      }));
      setShowArchiveMatterModal(false);
      setMatterLifecycleReason('');
      setActionMessage('تمت أرشفة ملف القضية بنجاح.');
      router.refresh();
    } catch (err: unknown) {
      updatePendingLifecycleOp(op);
      setLifecycleError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.');
    } finally {
      setIsLifecycleSubmitting(false);
    }
  };

  const handleArchiveMatter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLifecycleSubmitting) return;

    if (pendingLifecycleOpRef.current) {
      if (pendingLifecycleOpRef.current.kind === 'archiveMatter') {
        await executeArchiveMatter(pendingLifecycleOpRef.current as Extract<LifecycleOp, { kind: 'archiveMatter' }>);
        return;
      }
      setLifecycleError(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}).`);
      return;
    }

    if (matterLifecycleReason.trim().length < 3) {
      setLifecycleError('سبب الأرشفة مطلوب ويجب ألا يقل عن 3 أحرف.');
      return;
    }

    const op: Extract<LifecycleOp, { kind: 'archiveMatter' }> = {
      kind: 'archiveMatter',
      key: generateClientRequestId('arch-m'),
      payload: {
        matterId: matter.id,
        reason: matterLifecycleReason.trim(),
        expectedVersion: matter.version,
      },
      description: 'أرشفة ملف القضية',
    };
    updatePendingLifecycleOp(op);
    await executeArchiveMatter(op);
  };

  const executeReopenMatter = async (op: Extract<LifecycleOp, { kind: 'reopenMatter' }>) => {
    setIsLifecycleSubmitting(true);
    setLifecycleError(null);
    try {
      const res = await reopenMatterAction({
        ...op.payload,
        idempotencyKey: op.key,
      }, ownerId);

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          updatePendingLifecycleOp(op);
          setLifecycleSessionExpired(true);
          setLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(op);
          setLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(null);
          setLifecycleError(res.error || 'تعذر إعادة فتح الملف.');
        }
        return;
      }

      setLifecycleSessionExpired(false);
      updatePendingLifecycleOp(null);
      setMatter((prev) => ({
        ...prev,
        status: (res.data.status as MatterStatus) || 'ACTIVE',
        archivedAt: null,
        version: res.data.version,
      }));
      setShowReopenMatterModal(false);
      setMatterLifecycleReason('');
      setActionMessage('تمت إعادة فتح ملف القضية بنجاح.');
      router.refresh();
    } catch (err: unknown) {
      updatePendingLifecycleOp(op);
      setLifecycleError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.');
    } finally {
      setIsLifecycleSubmitting(false);
    }
  };

  const handleReopenMatter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLifecycleSubmitting) return;

    if (pendingLifecycleOpRef.current) {
      if (pendingLifecycleOpRef.current.kind === 'reopenMatter') {
        await executeReopenMatter(pendingLifecycleOpRef.current as Extract<LifecycleOp, { kind: 'reopenMatter' }>);
        return;
      }
      setLifecycleError(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}).`);
      return;
    }

    if (matterLifecycleReason.trim().length < 3) {
      setLifecycleError('سبب إعادة الفتح مطلوب ويجب ألا يقل عن 3 أحرف.');
      return;
    }

    const op: Extract<LifecycleOp, { kind: 'reopenMatter' }> = {
      kind: 'reopenMatter',
      key: generateClientRequestId('reop-m'),
      payload: {
        matterId: matter.id,
        reason: matterLifecycleReason.trim(),
        expectedVersion: matter.version,
      },
      description: 'إعادة فتح ملف القضية',
    };
    updatePendingLifecycleOp(op);
    await executeReopenMatter(op);
  };

  const executeArchiveProceeding = async (op: Extract<LifecycleOp, { kind: 'archiveProceeding' }>) => {
    setIsProceedingLifecycleSubmitting(true);
    setProceedingLifecycleError(null);
    try {
      const res = await archiveProceedingAction({
        ...op.payload,
        idempotencyKey: op.key,
      }, ownerId);

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          updatePendingLifecycleOp(op);
          setLifecycleSessionExpired(true);
          setProceedingLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(op);
          setProceedingLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(null);
          setProceedingLifecycleError(res.error || 'تعذر أرشفة القيد القضائي.');
        }
        return;
      }

      setLifecycleSessionExpired(false);
      updatePendingLifecycleOp(null);
      // NOTE (Spec 4): Closed Proceeding must not be presented as archived, and archiving keeps existing status
      setMatter((prev) => ({
        ...prev,
        proceedings: prev.proceedings?.map((p) =>
          p.id === op.proceedingId
            ? { ...p, archivedAt: res.data.archivedAt, version: res.data.version }
            : p
        ),
      }));
      setSelectedProceedingForLifecycle(null);
      setProceedingLifecycleAction(null);
      setProceedingLifecycleReason('');
      setActionMessage('تمت أرشفة القيد القضائي بنجاح.');
      router.refresh();
    } catch (err: unknown) {
      updatePendingLifecycleOp(op);
      setProceedingLifecycleError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.');
    } finally {
      setIsProceedingLifecycleSubmitting(false);
    }
  };

  const handleArchiveProceeding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProceedingForLifecycle || isProceedingLifecycleSubmitting) return;

    if (pendingLifecycleOpRef.current) {
      if (
        pendingLifecycleOpRef.current.kind === 'archiveProceeding' &&
        pendingLifecycleOpRef.current.proceedingId === selectedProceedingForLifecycle.id
      ) {
        await executeArchiveProceeding(pendingLifecycleOpRef.current as Extract<LifecycleOp, { kind: 'archiveProceeding' }>);
        return;
      }
      setProceedingLifecycleError(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}).`);
      return;
    }

    if (proceedingLifecycleReason.trim().length < 3) {
      setProceedingLifecycleError('سبب الأرشفة مطلوب ويجب ألا يقل عن 3 أحرف.');
      return;
    }

    const op: Extract<LifecycleOp, { kind: 'archiveProceeding' }> = {
      kind: 'archiveProceeding',
      key: generateClientRequestId('arch-p'),
      proceedingId: selectedProceedingForLifecycle.id,
      payload: {
        proceedingId: selectedProceedingForLifecycle.id,
        matterId: matter.id,
        reason: proceedingLifecycleReason.trim(),
        expectedVersion: selectedProceedingForLifecycle.version ?? 1,
      },
      description: 'أرشفة القيد القضائي',
    };
    updatePendingLifecycleOp(op);
    await executeArchiveProceeding(op);
  };

  const executeReopenProceeding = async (op: Extract<LifecycleOp, { kind: 'reopenProceeding' }>) => {
    setIsProceedingLifecycleSubmitting(true);
    setProceedingLifecycleError(null);
    try {
      const res = await reopenProceedingAction({
        ...op.payload,
        idempotencyKey: op.key,
      }, ownerId);

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          updatePendingLifecycleOp(op);
          setLifecycleSessionExpired(true);
          setProceedingLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(op);
          setProceedingLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          setLifecycleSessionExpired(false);
          updatePendingLifecycleOp(null);
          setProceedingLifecycleError(res.error || 'تعذر إعادة فتح القيد القضائي.');
        }
        return;
      }

      setLifecycleSessionExpired(false);
      updatePendingLifecycleOp(null);
      setMatter((prev) => ({
        ...prev,
        proceedings: prev.proceedings?.map((p) =>
          p.id === op.proceedingId
            ? { ...p, status: (res.data.status as ProceedingStatus) || p.status, archivedAt: null, version: res.data.version }
            : p
        ),
      }));
      setSelectedProceedingForLifecycle(null);
      setProceedingLifecycleAction(null);
      setProceedingLifecycleReason('');
      setActionMessage('تمت إعادة فتح القيد القضائي بنجاح.');
      router.refresh();
    } catch (err: unknown) {
      updatePendingLifecycleOp(op);
      setProceedingLifecycleError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.');
    } finally {
      setIsProceedingLifecycleSubmitting(false);
    }
  };

  const handleReopenProceeding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProceedingForLifecycle || isProceedingLifecycleSubmitting) return;

    if (pendingLifecycleOpRef.current) {
      if (
        pendingLifecycleOpRef.current.kind === 'reopenProceeding' &&
        pendingLifecycleOpRef.current.proceedingId === selectedProceedingForLifecycle.id
      ) {
        await executeReopenProceeding(pendingLifecycleOpRef.current as Extract<LifecycleOp, { kind: 'reopenProceeding' }>);
        return;
      }
      setProceedingLifecycleError(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}).`);
      return;
    }

    if (proceedingLifecycleReason.trim().length < 3) {
      setProceedingLifecycleError('سبب إعادة الفتح مطلوب ويجب ألا يقل عن 3 أحرف.');
      return;
    }

    const op: Extract<LifecycleOp, { kind: 'reopenProceeding' }> = {
      kind: 'reopenProceeding',
      key: generateClientRequestId('reop-p'),
      proceedingId: selectedProceedingForLifecycle.id,
      payload: {
        proceedingId: selectedProceedingForLifecycle.id,
        matterId: matter.id,
        reason: proceedingLifecycleReason.trim(),
        expectedVersion: selectedProceedingForLifecycle.version ?? 1,
      },
      description: 'إعادة فتح القيد القضائي',
    };
    updatePendingLifecycleOp(op);
    await executeReopenProceeding(op);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* 1. Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#D5DFE3]">
        <div className="space-y-1">
          <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] flex items-center gap-1.5">
            <Link href="/matters" className="hover:text-[#14566B] hover:underline">
              ملفات القضايا
            </Link>
            <span aria-hidden="true">/</span>
            <bdi dir="ltr" className="font-mono text-[#14566B] font-bold">
              {matter.fileCode}
            </bdi>
          </nav>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="min-w-0 max-w-full text-2xl font-bold text-[#172A35] tracking-tight [overflow-wrap:anywhere]">
              {matter.title}
            </h1>
            {isMatterArchived ? (
              <span
                data-testid="matter-status-badge"
                className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold border bg-stone-100 text-stone-700 border-stone-300"
              >
                مؤرشف
              </span>
            ) : (
              <span
                data-testid="matter-status-badge"
                className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold border ${
                  MATTER_STATUS_CLASSES[matter.status]
                }`}
              >
                {MATTER_STATUS_LABELS[matter.status]}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isMatterArchived ? (
            <>
              <button
                type="button"
                data-testid="archive-matter-button"
                disabled={Boolean(pendingLifecycleOp && pendingLifecycleOp.kind !== 'archiveMatter')}
                onClick={openArchiveMatterModal}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold rounded-[6px] border border-amber-300 transition-colors min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>أرشفة الملف</span>
              </button>
              <Link
                href={`/matters/${matter.id}/edit`}
                data-testid="edit-matter-button"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
              >
                <span>تعديل بيانات الملف</span>
              </Link>
              <Link
                href={`/matters/${matter.id}/proceedings/new`}
                data-testid="add-proceeding-button"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px]"
              >
                <span>+ إضافة قيد قضائي</span>
              </Link>
            </>
          ) : (
            <button
              type="button"
              data-testid="reopen-matter-button"
              disabled={Boolean(pendingLifecycleOp && pendingLifecycleOp.kind !== 'reopenMatter')}
              onClick={openReopenMatterModal}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>إعادة فتح الملف</span>
            </button>
          )}
        </div>
      </div>

      {/* Unresolved Lifecycle Banner */}
      {pendingLifecycleOp && !showArchiveMatterModal && !showReopenMatterModal && !selectedProceedingForLifecycle && (
        <div
          role="alert"
          data-testid="unresolved-lifecycle-banner"
          className="p-3.5 bg-amber-50 border-2 border-amber-300 rounded-[6px] text-amber-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs shadow-xs"
        >
          <div className="space-y-0.5">
            <div className="font-bold flex items-center gap-1.5 text-amber-900 text-sm">
              <span>عملية غير محسومة قيد الانتظار: {pendingLifecycleOp.description}</span>
            </div>
            <p className="text-amber-800">
              لم يتأكد اكتمال العملية على الخادم. أُبقيت العملية مجمّدة بنفس المفتاح والسبب الأصلي.
            </p>
          </div>
          <button
            type="button"
            data-testid="reopen-unresolved-lifecycle-button"
            onClick={() => {
              if (pendingLifecycleOp.kind === 'archiveMatter') {
                setShowArchiveMatterModal(true);
              } else if (pendingLifecycleOp.kind === 'reopenMatter') {
                setShowReopenMatterModal(true);
              } else if (
                pendingLifecycleOp.kind === 'archiveProceeding' ||
                pendingLifecycleOp.kind === 'reopenProceeding'
              ) {
                const proc = matter.proceedings?.find((p) => p.id === pendingLifecycleOp.proceedingId);
                if (proc) {
                  setSelectedProceedingForLifecycle(proc);
                  setProceedingLifecycleAction(
                    pendingLifecycleOp.kind === 'archiveProceeding' ? 'archive' : 'reopen'
                  );
                }
              }
            }}
            className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded-[6px] transition-colors whitespace-nowrap min-h-[44px]"
          >
            متابعة وإعادة المحاولة
          </button>
        </div>
      )}

      {/* Read-Only Banner for Archived Matter */}
      {isMatterArchived && (
        <div
          role="alert"
          data-testid="matter-archived-banner"
          className="p-4 bg-stone-100 border-2 border-stone-300 rounded-[6px] text-stone-900 space-y-1 shadow-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-stone-900">
            <span>ملف القضية مؤرشف — وضع القراءة فقط</span>
          </div>
          <p className="text-xs text-stone-700 leading-relaxed">
            تمت أرشفة هذا الملف وهو في حالة قراءة فقط. تم تعطيل عمليات التعديل وإضافة القيود وربط الأطراف والتوكيلات. لإجراء أي تعديل، يجب إعادة فتح الملف أولاً.
          </p>
        </div>
      )}

      {/* Notifications */}
      {actionMessage && (
        <div
          role="status"
          data-testid="detail-action-message"
          className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-xs flex items-center justify-between"
        >
          <span>✓ {actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            aria-label="إغلاق رسالة التأكيد"
            className="text-emerald-700 hover:text-emerald-900 font-bold px-2 py-0.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded"
          >
            ✕
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          data-testid="detail-action-error"
          className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs flex items-center justify-between"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="إغلاق رسالة الخطأ"
            className="text-red-700 hover:text-red-900 font-bold px-2 py-0.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded"
          >
            ✕
          </button>
        </div>
      )}

      {partyActionError && (
        <div
          role="alert"
          data-testid="party-action-error"
          className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs flex items-center justify-between"
        >
          <span>{partyActionError}</span>
          <button
            type="button"
            onClick={() => setPartyActionError(null)}
            aria-label="إغلاق رسالة خطأ الأطراف"
            className="text-red-700 hover:text-red-900 font-bold px-2 py-0.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded"
          >
            ✕
          </button>
        </div>
      )}

      {/* Session Recovery Banner for Association Mutations (U1/U3) */}
      {assocSessionExpired && (
        <div
          role="alert"
          data-testid="assoc-session-recovery-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3 text-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>انتهت صلاحية الجلسة أو يلزم استكمال التحقق أثناء تعديل العلاقات</span>
          </div>
          <p className="leading-relaxed">
            تم الحفاظ على العملية الأصلية ({pendingAssocOp?.description || 'العملية'}) مجمّدة بنفس المفتاح. سجّل الدخول في نافذة جديدة ثم اضغط على زر إعادة المحاولة لإتمام العملية دون تكرار.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <a
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="assoc-session-login-link"
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-flex items-center min-h-[44px]"
            >
              فتح شاشة تسجيل الدخول في نافذة جديدة ↗
            </a>
            <button
              type="button"
              onClick={handleRetryPendingAssoc}
              data-testid="assoc-session-retry-button"
              className="px-3 py-1.5 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors min-h-[44px]"
            >
              إعادة محاولة العملية
            </button>
          </div>
        </div>
      )}

      {/* Frozen Association Operation Banner (U1) */}
      {pendingAssocOp && !assocSessionExpired && (
        <div
          role="alert"
          data-testid="assoc-operation-pending-banner"
          className="p-4 bg-sky-50 border border-sky-300 rounded-[6px] text-sky-950 space-y-3 text-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>عملية ({pendingAssocOp.description}) معلّقة بانتظار نتيجة مؤكدة</span>
          </div>
          <p className="leading-relaxed">
            أُبقيت العملية بنفس المفتاح الأصلي لمنع التكرار. أعد المحاولة للتأكد من النتيجة.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRetryPendingAssoc}
              data-testid="assoc-operation-retry-button"
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px]"
            >
              إعادة محاولة العملية الأصلية
            </button>
          </div>
        </div>
      )}

      {/* 2. Paper Location Banner / Missing Location Warning */}
      {hasMissingPaperLocation ? (
        <div
          role="alert"
          data-testid="missing-paper-location-warning"
          className="bg-amber-50 border border-amber-300 rounded-[6px] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-amber-900 shadow-xs"
        >
          <div className="flex items-start sm:items-center gap-2.5">
            <div className="text-xs leading-relaxed">
              <span className="font-bold block text-sm mb-0.5">الملف نشط بدون مكان حفظ ورقي محدد</span>
              <span>
                لم يتم تحديد دولاب أو رف الحفظ الورقي لهذا الملف بعد. يرجى تحديد مكان الحفظ لتجنب ضياع أو تأخر الأوراق والمستندات.
              </span>
            </div>
          </div>
          <Link
            href={`/matters/${matter.id}/edit`}
            className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold rounded-[6px] shrink-0 self-start sm:self-center transition-colors min-h-[44px] flex items-center justify-center"
          >
            تحديد مكان الحفظ
          </Link>
        </div>
      ) : matter.paperLocationName ? (
        <div
          data-testid="paper-location-card"
          className="bg-white rounded-[6px] border border-[#D5DFE3] px-4 py-3 flex items-center justify-between text-xs text-[#172A35]"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#4D606A]">مكان الحفظ الورقي بالمكتب:</span>
            <span className="font-bold text-[#14566B]">{matter.paperLocationName}</span>
          </div>
          {!isMatterArchived && (
            <Link
              href={`/matters/${matter.id}/edit`}
              className="text-[#14566B] hover:underline font-medium min-h-[44px] inline-flex items-center"
            >
              تغيير
            </Link>
          )}
        </div>
      ) : null}

      {/* 3. Core Meta Summary Card */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">كود الملف الداخلي:</span>
          <bdi dir="ltr" className="font-mono text-sm font-bold text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200 inline-block">
            {matter.fileCode}
          </bdi>
        </div>

        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">طبيعة العمل:</span>
          <span className="font-bold text-[#172A35] text-sm">
            {MATTER_KIND_LABELS[matter.kind]}
          </span>
        </div>

        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">دائرة التخصص:</span>
          <span className="font-bold text-[#172A35] text-sm">
            {matter.practiceAreaName || '—'}
          </span>
        </div>

        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">تاريخ الفتح:</span>
          <span className="font-bold text-[#172A35] text-sm">
            {formatCairoDateOnly(matter.openingDate)}
          </span>
        </div>
      </div>

      {/* 4. Navigation Tabs */}
      <div className="border-b border-[#D5DFE3]">
        <div className="flex flex-wrap gap-1 sm:gap-2" aria-label="أقسام ملف القضية" role="tablist">
          <button
            ref={(el) => {
              tabRefs.current.parties = el;
            }}
            id="matter-tab-parties"
            type="button"
            role="tab"
            aria-selected={activeTab === 'parties'}
            aria-controls={activeTab === 'parties' ? 'matter-tabpanel-parties' : undefined}
            tabIndex={activeTab === 'parties' ? 0 : -1}
            data-testid="tab-parties"
            onClick={() => setActiveTab('parties')}
            onKeyDown={(e) => handleMatterTabKeyDown(e, 'parties')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'parties'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            الأطراف والصفات ({parties.length})
          </button>

          <button
            ref={(el) => {
              tabRefs.current.proceedings = el;
            }}
            id="matter-tab-proceedings"
            type="button"
            role="tab"
            aria-selected={activeTab === 'proceedings'}
            aria-controls={activeTab === 'proceedings' ? 'matter-tabpanel-proceedings' : undefined}
            tabIndex={activeTab === 'proceedings' ? 0 : -1}
            data-testid="tab-proceedings"
            onClick={() => setActiveTab('proceedings')}
            onKeyDown={(e) => handleMatterTabKeyDown(e, 'proceedings')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'proceedings'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            القيود والدعاوى القضائية ({proceedings.length})
          </button>

          <button
            ref={(el) => {
              tabRefs.current.authorizations = el;
            }}
            id="matter-tab-authorizations"
            type="button"
            role="tab"
            aria-selected={activeTab === 'authorizations'}
            aria-controls={activeTab === 'authorizations' ? 'matter-tabpanel-authorizations' : undefined}
            tabIndex={activeTab === 'authorizations' ? 0 : -1}
            data-testid="tab-authorizations"
            onClick={() => setActiveTab('authorizations')}
            onKeyDown={(e) => handleMatterTabKeyDown(e, 'authorizations')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'authorizations'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            سندات الوكالة والتوكيلات ({authorizations.length})
          </button>

          <button
            ref={(el) => {
              tabRefs.current.tasksDeadlines = el;
            }}
            id="matter-tab-tasksDeadlines"
            type="button"
            role="tab"
            aria-selected={activeTab === 'tasksDeadlines'}
            aria-controls={activeTab === 'tasksDeadlines' ? 'matter-tabpanel-tasksDeadlines' : undefined}
            tabIndex={activeTab === 'tasksDeadlines' ? 0 : -1}
            data-testid="tab-tasks-deadlines"
            onClick={() => setActiveTab('tasksDeadlines')}
            onKeyDown={(e) => handleMatterTabKeyDown(e, 'tasksDeadlines')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'tasksDeadlines'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            المهام والمواعيد ({tasksError || deadlinesError ? '—' : initialTasks.length + initialDeadlines.length})
          </button>

          <button
            ref={(el) => {
              tabRefs.current.summary = el;
            }}
            id="matter-tab-summary"
            type="button"
            role="tab"
            aria-selected={activeTab === 'summary'}
            aria-controls={activeTab === 'summary' ? 'matter-tabpanel-summary' : undefined}
            tabIndex={activeTab === 'summary' ? 0 : -1}
            data-testid="tab-summary"
            onClick={() => setActiveTab('summary')}
            onKeyDown={(e) => handleMatterTabKeyDown(e, 'summary')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'summary'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            الملخص والملاحظات
          </button>
        </div>
      </div>

      {/* Tab 1: Parties Section */}
      {activeTab === 'parties' && (
        <div id="matter-tabpanel-parties" role="tabpanel" aria-labelledby="matter-tab-parties" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#172A35]">
              أطراف الملف (الموكلون والخصوم)
            </h2>
            {!isMatterArchived && (
              <button
                type="button"
                data-testid="open-add-party-modal"
                onClick={handleOpenPartyModal}
                disabled={isAssocSubmitting || !!pendingAssocOp}
                className={`px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] flex items-center gap-1.5 transition-colors ${
                  isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <span>+</span>
                <span>ربط طرف جديد بالملف</span>
              </button>
            )}
          </div>

          {/* Add Party Modal / Panel */}
          {showAddPartyModal && (
            <div
              data-testid="add-party-panel"
              className="bg-white rounded-[6px] border-2 border-[#14566B] p-5 shadow-md space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h3 className="text-sm font-bold text-[#172A35]">
                  ربط طرف من دليل الأطراف بهذا الملف
                </h3>
                <button
                  type="button"
                  onClick={closePartyModal}
                  className="text-xs text-[#4D606A] hover:text-[#172A35] px-2 py-1 min-h-[44px] flex items-center"
                >
                  ✕ إغلاق
                </button>
              </div>

              <form onSubmit={handleLinkParty} className="space-y-4 text-xs">
                {/* Search / Select Party */}
                <div className="space-y-1">
                  <label htmlFor="link-party-search-input" className="block font-bold text-[#172A35]">
                    اختر الطرف من دليل الأطراف <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="link-party-search-input"
                    type="text"
                    value={partySearchQuery}
                    onChange={(e) => handleSearchParties(e.target.value)}
                    placeholder="اكتب اسم الطرف للبحث..."
                    data-testid="party-search-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />

                  {isSearchingParty && (
                    <p className="text-xs text-[#4D606A] italic pt-1">جارٍ البحث في دليل الأطراف...</p>
                  )}
                  {partySearchError && (
                    <p className="text-xs text-red-600 font-medium pt-1">{partySearchError}</p>
                  )}
                  {!isSearchingParty && !partySearchError && partySearchQuery.trim() && searchedParties.length === 0 && !selectedPartyId && (
                    <p className="text-xs text-[#4D606A] italic pt-1">لم يتم العثور على أطراف مطابقة.</p>
                  )}

                  {searchedParties.length > 0 && (
                    <div className="max-h-36 overflow-y-auto border border-[#D5DFE3] rounded-[6px] divide-y divide-[#E8EEF1] mt-1 bg-white">
                      {searchedParties.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          data-testid={`select-party-${p.id}`}
                          onClick={() => {
                            // Selection invalidates any in-flight query response.
                            if (partySearchTimerRef.current) clearTimeout(partySearchTimerRef.current);
                            partySearchGenRef.current++;
                            setSelectedPartyId(p.id);
                            setPartySearchQuery(p.name);
                            setSearchedParties([]);
                          }}
                          className={`w-full text-right p-2 hover:bg-[#F4F6F7] text-xs font-medium min-h-[44px] ${
                            selectedPartyId === p.id ? 'bg-[#E8EEF1] font-bold text-[#14566B]' : ''
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Role */}
                  <div className="space-y-1">
                    <label htmlFor="link-party-role-select" className="block font-bold text-[#172A35]">
                      صفة الطرف في هذا الملف <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="link-party-role-select"
                      value={selectedPartyRole}
                      onChange={(e) => {
                        const nextRole = e.target.value as MatterPartyRole;
                        setSelectedPartyRole(nextRole);
                        if (nextRole !== 'CLIENT') {
                          setIsPrimaryContact(false);
                        }
                      }}
                      data-testid="party-role-select"
                      className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                    >
                      <option value="CLIENT">{MATTER_PARTY_ROLE_LABELS.CLIENT}</option>
                      <option value="OPPONENT">{MATTER_PARTY_ROLE_LABELS.OPPONENT}</option>
                      <option value="OTHER">{MATTER_PARTY_ROLE_LABELS.OTHER}</option>
                    </select>
                  </div>

                  {/* Primary Contact Toggle */}
                  {selectedPartyRole === 'CLIENT' && (
                    <div className="space-y-1 flex items-center pt-5">
                      <label className="inline-flex items-center gap-2 cursor-pointer min-h-[44px]">
                        <input
                          type="checkbox"
                          checked={isPrimaryContact}
                          onChange={(e) => setIsPrimaryContact(e.target.checked)}
                          data-testid="primary-contact-checkbox"
                          className="w-4 h-4 text-[#14566B] rounded border-[#D5DFE3]"
                        />
                        <span className="font-bold text-[#172A35]">
                          تعيين كجهة اتصال أساسية لهذا الملف ⭐
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label htmlFor="link-party-notes-input" className="block font-bold text-[#172A35]">
                    ملاحظات الطرف بالملف (اختياري)
                  </label>
                  <input
                    id="link-party-notes-input"
                    type="text"
                    value={partyNotes}
                    onChange={(e) => setPartyNotes(e.target.value)}
                    placeholder="مثال: يتابع الملف بالنيابة عن باقي الورثة"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closePartyModal}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingParty || !selectedPartyId}
                    data-testid="submit-link-party"
                    className="px-5 py-2 bg-[#14566B] text-white font-bold rounded-[6px] disabled:opacity-50 min-h-[44px]"
                  >
                    {isSubmittingParty ? 'جارٍ الربط...' : 'ربط الطرف'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Clients Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-emerald-900 bg-emerald-50/70 p-2.5 rounded-[6px] border border-emerald-200 flex items-center justify-between">
              <span>الموكلون وأصحاب الشأن ({clients.length})</span>
              <span className="text-[11px] text-emerald-700 font-normal">
                {matter.status === 'ACTIVE' ? 'الملف نشط ويتطلب موكلاً واحداً على الأقل دائماً' : MATTER_STATUS_LABELS[matter.status]}
              </span>
            </h3>

            {clients.length === 0 ? (
              <p className="text-xs text-[#4D606A] italic p-4 bg-white rounded border border-[#D5DFE3]">
                لا يوجد موكلون مرتبطون بهذا الملف. (مسموح به كمسودة فقط).
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {clients.map((c) => (
                  <div
                    key={c.id}
                    data-testid={`client-card-${c.id}`}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-2 relative"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <Link
                          href={`/parties/${c.partyId}`}
                          className="font-bold text-sm text-[#14566B] hover:underline"
                        >
                          {c.partyName}
                        </Link>
                        {c.isPrimaryContact && (
                          <span
                            data-testid={`primary-badge-${c.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200"
                          >
                            <span>⭐</span>
                            <span>جهة الاتصال الأساسية</span>
                          </span>
                        )}
                      </div>

                      {!isMatterArchived && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            data-testid={`toggle-primary-${c.id}`}
                            onClick={() => handleTogglePrimary(c)}
                            disabled={isAssocSubmitting || !!pendingAssocOp}
                            title={c.isPrimaryContact ? 'إلغاء التعيين كأساسي' : 'تعيين كأساسي'}
                            aria-label={c.isPrimaryContact ? 'إلغاء التعيين كجهة اتصال أساسية' : 'تعيين كجهة اتصال أساسية'}
                            className={`text-xs text-[#4D606A] hover:text-amber-700 p-1 rounded min-h-[44px] min-w-[44px] inline-flex items-center justify-center ${
                              isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                          >
                            {c.isPrimaryContact ? '⭐' : '☆'}
                          </button>
                          <button
                            type="button"
                            data-testid={`unlink-party-${c.id}`}
                            onClick={() => handleUnlinkParty(c)}
                            disabled={isAssocSubmitting || !!pendingAssocOp}
                            className={`text-xs text-red-600 hover:text-red-800 p-1 rounded min-h-[44px] min-w-[44px] inline-flex items-center justify-center ${
                              isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                            title="إزالة الطرف من الملف"
                            aria-label="إزالة الطرف من الملف"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>

                    {c.notes && (
                      <p className="text-xs text-[#4D606A] leading-relaxed pt-1 border-t border-[#E8EEF1]">
                        {c.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Opponents Section */}
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-bold text-rose-900 bg-rose-50/70 p-2.5 rounded-[6px] border border-rose-200">
              الخصوم في النزاع ({opponents.length})
            </h3>

            {opponents.length === 0 ? (
              <p className="text-xs text-[#4D606A] italic p-4 bg-white rounded border border-[#D5DFE3]">
                لم يتم تسجيل خصوم في هذا الملف حتى الآن.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {opponents.map((op) => (
                  <div
                    key={op.id}
                    data-testid={`opponent-card-${op.id}`}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/parties/${op.partyId}`}
                        className="font-bold text-sm text-[#172A35] hover:text-[#14566B] hover:underline"
                      >
                        {op.partyName}
                      </Link>
                      {!isMatterArchived && (
                        <button
                          type="button"
                          data-testid={`unlink-opponent-${op.id}`}
                          onClick={() => handleUnlinkParty(op)}
                          disabled={isAssocSubmitting || !!pendingAssocOp}
                          className={`text-xs text-red-600 hover:text-red-800 p-1 rounded min-h-[44px] min-w-[44px] inline-flex items-center justify-center ${
                            isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          title="إزالة الخصم"
                          aria-label="إزالة الخصم من الملف"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {op.notes && (
                      <p className="text-xs text-[#4D606A] leading-relaxed pt-1 border-t border-[#E8EEF1]">
                        {op.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Other Parties */}
          {otherParties.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-bold text-slate-800 bg-slate-50 p-2.5 rounded-[6px] border border-slate-200">
                أطراف أخرى ({otherParties.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {otherParties.map((oth) => (
                  <div
                    key={oth.id}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/parties/${oth.partyId}`}
                        className="font-bold text-sm text-[#172A35] hover:text-[#14566B] hover:underline"
                      >
                        {oth.partyName}
                      </Link>
                      {!isMatterArchived && (
                        <button
                          type="button"
                          onClick={() => handleUnlinkParty(oth)}
                          disabled={isAssocSubmitting || !!pendingAssocOp}
                          title="إزالة الطرف"
                          aria-label="إزالة الطرف من الملف"
                          className={`text-xs text-red-600 hover:text-red-800 p-1 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded ${
                            isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Court Proceedings */}
      {activeTab === 'proceedings' && (
        <div id="matter-tabpanel-proceedings" role="tabpanel" aria-labelledby="matter-tab-proceedings" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#172A35]">
              القيود والدعاوى القضائية المسجلة
            </h2>
            {!isMatterArchived && (
              <Link
                href={`/matters/${matter.id}/proceedings/new`}
                data-testid="add-proceeding-tab-button"
                className="px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] flex items-center gap-1.5 transition-colors"
              >
                <span>+ تسجيل قيد قضائي جديد</span>
              </Link>
            )}
          </div>

          {proceedings.length === 0 ? (
            <div
              data-testid="empty-proceedings-container"
              className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 text-center space-y-3 shadow-xs"
            >
              <div className="text-3xl"></div>
              <h3 className="text-base font-bold text-[#172A35]">لا توجد قيود قضائية مسجلة</h3>
              <p className="text-xs text-[#4D606A] max-w-md mx-auto leading-relaxed">
                لم يتم قيد أي دعوى أو استئناف في المحاكم لهذا الملف حتى الآن. يمكنك تسجيل أول قيد قضائي بالمحكمة لتنظيم الجلسات.
              </p>
              {!isMatterArchived && (
                <div className="pt-2">
                  <Link
                    href={`/matters/${matter.id}/proceedings/new`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#14566B] text-white text-xs font-bold rounded-[6px] min-h-[44px]"
                  >
                    <span>تسجيل أول قيد قضائي</span>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {proceedings.map((proc) => {
                const isDraft = proc.status === 'DRAFT' || !hasCompleteProceedingRegistration(proc);
                const isProcArchived = Boolean(proc.archivedAt);

                return (
                  <div
                    key={proc.id}
                    data-testid={`proceeding-card-${proc.id}`}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs space-y-4 hover:border-[#14566B]/50 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3 border-b border-[#E8EEF1]">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-base text-[#172A35]">
                            {proc.courtName}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#E8EEF1] text-[#14566B]">
                            {PROCEEDING_INSTANCE_LABELS[proc.instance]}
                          </span>
                          {isProcArchived ? (
                            <span
                              data-testid="proceeding-archived-badge"
                              className="text-xs font-bold px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-300 inline-flex items-center gap-1"
                            >
                              <span>مؤرشف</span>
                            </span>
                          ) : isDraft ? (
                            <span
                              data-testid="proceeding-draft-badge"
                              className="text-xs font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 inline-flex items-center gap-1"
                            >
                              <span>الرقم غير مستكمل (مسودة قيد)</span>
                            </span>
                          ) : (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                              {PROCEEDING_STATUS_LABELS[proc.status]}
                            </span>
                          )}
                        </div>

                        {/* Docket identification */}
                        <div className="text-xs text-[#4D606A] flex flex-wrap items-center gap-2 pt-1">
                          {proc.numberText && proc.yearLabel ? (
                            <div className="flex items-center gap-1">
                              <span className="font-semibold text-[#172A35]">رقم الدعوى:</span>
                              <span className="font-mono text-sm font-bold text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200 inline-flex items-center gap-1">
                                <bdi dir="ltr">{proc.numberText}</bdi> لسنة <bdi dir="ltr">{proc.yearLabel}</bdi>
                              </span>
                              {proc.registerType && <span>({proc.registerType})</span>}
                            </div>
                          ) : (
                            <span className="text-amber-800 font-semibold italic">
                              لم يقيد برقم رسمي بعد بالمحكمة
                            </span>
                          )}

                          {proc.circuit && (
                            <span className="text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                              {proc.circuit}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Link
                          href={`/matters/${matter.id}/proceedings/${proc.id}`}
                          data-testid={`view-proceeding-${proc.id}`}
                          className="px-3 py-1.5 bg-white hover:bg-[#F4F6F7] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#14566B]/30 transition-colors min-h-[44px] flex items-center"
                        >
                          عرض تفاصيل القيد
                        </Link>
                        {!isMatterArchived && !isProcArchived && (
                          <Link
                            href={`/matters/${matter.id}/proceedings/${proc.id}/edit`}
                            data-testid={`edit-proceeding-${proc.id}`}
                            className="px-3 py-1.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px] flex items-center"
                          >
                            تعديل القيد
                          </Link>
                        )}
                        {!isMatterArchived && (
                          !isProcArchived ? (
                            <button
                              type="button"
                              data-testid={`archive-proceeding-${proc.id}`}
                              disabled={Boolean(
                                pendingLifecycleOp &&
                                  !(
                                    pendingLifecycleOp.kind === 'archiveProceeding' &&
                                    pendingLifecycleOp.proceedingId === proc.id
                                  )
                              )}
                              onClick={() => {
                                openProceedingLifecycleModal(proc, 'archive');
                              }}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-medium rounded-[6px] border border-amber-300 transition-colors min-h-[44px] flex items-center disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              أرشفة القيد
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-testid={`reopen-proceeding-${proc.id}`}
                              disabled={Boolean(
                                pendingLifecycleOp &&
                                  !(
                                    pendingLifecycleOp.kind === 'reopenProceeding' &&
                                    pendingLifecycleOp.proceedingId === proc.id
                                  )
                              )}
                              onClick={() => {
                                openProceedingLifecycleModal(proc, 'reopen');
                              }}
                              className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-medium rounded-[6px] border border-emerald-300 transition-colors min-h-[44px] flex items-center disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              إعادة فتح القيد
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    {/* Parent Proceeding linkage (Appeal -> First instance) */}
                    {proc.parentProceedingSummary && (
                      <div
                        data-testid="parent-proceeding-link"
                        className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-[6px] text-xs text-blue-900 flex items-center gap-2"
                      >
                        <span className="font-semibold">مرتبط بالدعوى السابقة:</span>
                        <span>{proc.parentProceedingSummary}</span>
                      </div>
                    )}

                    {/* Parties Legal Capacities in this proceeding */}
                    <div className="space-y-2 pt-1">
                      <span className="text-xs font-bold text-[#4D606A] block">
                        الصفات القانونية لأطراف النزاع في هذا القيد:
                      </span>
                      {proc.parties && proc.parties.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {proc.parties.map((pp) => (
                            <span
                              key={pp.id}
                              data-testid={`proceeding-party-capacity-${pp.id}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#F4F6F7] text-xs border border-[#D5DFE3]"
                            >
                              <span className="font-bold text-[#172A35]">{pp.partyName}:</span>
                              <span className="font-semibold text-[#14566B]">
                                {pp.capacityText || (pp.legalCapacity ? PROCEEDING_LEGAL_CAPACITY_LABELS[pp.legalCapacity] : '')}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[#4D606A] italic">
                          لم يتم تحديد صفات قانونية مخصصة لهذا القيد بعد (يمكن إضافتها عند تعديل القيد).
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Authorizations / POAs */}
      {activeTab === 'authorizations' && (
        <div id="matter-tabpanel-authorizations" role="tabpanel" aria-labelledby="matter-tab-authorizations" className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-base font-bold text-[#172A35]">
                سندات الوكالة والتوكيلات المرتبطة بالملف
              </h2>
              <p className="text-xs text-[#4D606A]">
                يجب أن يكون صاحب التوكيل موكلاً حالياً في هذا الملف لإثبات الصفة القانونية للتقاضي.
              </p>
            </div>

            {!isMatterArchived && (
              <button
                type="button"
                data-testid="open-add-poa-modal"
                onClick={handleOpenPoaModal}
                disabled={isAssocSubmitting || !!pendingAssocOp}
                className={`px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] flex items-center gap-1.5 transition-colors ${
                  isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <span>+</span>
                <span>ربط توكيل بالملف</span>
              </button>
            )}
          </div>

          {/* Add POA Modal */}
          {showAddPoaModal && (
            <div
              data-testid="add-poa-panel"
              className="bg-white rounded-[6px] border-2 border-[#14566B] p-5 shadow-md space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h3 className="text-sm font-bold text-[#172A35]">
                  ربط سند وكالة من توكيلات الموكلين المسجلين
                </h3>
                <button
                  type="button"
                  onClick={closePoaModal}
                  className="text-xs text-[#4D606A] hover:text-[#172A35] px-2 py-1 min-h-[44px] flex items-center"
                >
                  ✕ إغلاق
                </button>
              </div>

              {poaActionError && (
                <p
                  role="alert"
                  data-testid="poa-load-error"
                  className="text-xs text-[#A4262C] font-bold bg-red-50 p-2 rounded"
                >
                  {poaActionError}
                </p>
              )}

              <form onSubmit={handleLinkPoa} className="space-y-4 text-xs">
                {isLoadingPoas ? (
                  <p className="text-[#4D606A]">جارٍ تحميل التوكيلات المتاحة للموكلين...</p>
                ) : availablePoas.length === 0 ? (
                  poaActionError ? (
                    <div
                      data-testid="poa-load-failure"
                      className="p-3 bg-red-50 rounded border border-red-200 text-red-900 space-y-2"
                    >
                      <p className="font-bold">تعذر تحميل قائمة التوكيلات بالكامل.</p>
                      <p>هذا ليس فراغاً مؤكداً؛ لم نتمكن من قراءة بيانات كل الموكلين. أعد المحاولة.</p>
                      <button
                        type="button"
                        onClick={handleOpenPoaModal}
                        data-testid="retry-load-poas"
                        className="px-3 py-1.5 bg-white border border-red-300 text-red-900 font-semibold rounded-[6px] min-h-[44px]"
                      >
                        إعادة محاولة تحميل التوكيلات
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 rounded border border-amber-200 text-amber-900 space-y-1">
                      <p className="font-bold">لا توجد توكيلات متاحة لربطها حالياً.</p>
                      <p>
                        تأكد من إضافة موكل للملف أولاً، ثم تسجيل سند وكالة في صفحة ملف الموكل بدليل الأطراف.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="space-y-1">
                    <label htmlFor="poa-select-input" className="block font-bold text-[#172A35]">
                      اختر التوكيل <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="poa-select-input"
                      value={selectedPoaId}
                      onChange={(e) => setSelectedPoaId(e.target.value)}
                      data-testid="poa-select"
                      className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                    >
                      <option value="">— اختر التوكيل —</option>
                      {availablePoas.map((poa) => (
                        <option key={poa.id} value={poa.id}>
                          {poa.partyName} — رقم {poa.poaNumberText} لسنة {poa.poaYearLabel} ({poa.notarizationOffice})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closePoaModal}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingPoa || !selectedPoaId}
                    data-testid="submit-link-poa"
                    className="px-5 py-2 bg-[#14566B] text-white font-bold rounded-[6px] disabled:opacity-50 min-h-[44px]"
                  >
                    {isSubmittingPoa ? 'جارٍ الربط...' : 'ربط التوكيل'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {authorizations.length === 0 ? (
            <div
              data-testid="empty-authorizations-container"
              className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 text-center space-y-3 shadow-xs"
            >
              <div className="text-3xl"></div>
              <h3 className="text-base font-bold text-[#172A35]">لا توجد توكيلات مرتبطة بهذا الملف</h3>
              <p className="text-xs text-[#4D606A] max-w-md mx-auto leading-relaxed">
                لم يتم إسناد أي توكيل رسمي لهذا الملف بعد. يمكنك ربط توكيل موثق صادر من أحد الموكلين بالملف.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {authorizations.map((auth) => (
                <div
                  key={auth.id}
                  data-testid={`authorization-card-${auth.id}`}
                  className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <span className="font-bold text-sm text-[#172A35] block">
                        الموكل: {auth.partyName}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-[#4D606A]">
                        <span>رقم التوكيل:</span>
                        <span className="font-mono font-bold text-[#14566B]">
                          <bdi dir="ltr">{auth.poaNumberText}</bdi> لسنة <bdi dir="ltr">{auth.poaYearLabel}</bdi>
                        </span>
                      </div>
                    </div>

                    {!isMatterArchived && (
                      <button
                        type="button"
                        data-testid={`unlink-poa-${auth.id}`}
                        onClick={() => handleUnlinkPoa(auth)}
                        disabled={isAssocSubmitting || !!pendingAssocOp}
                        className={`text-xs text-red-600 hover:text-red-800 px-2 py-1 min-h-[44px] flex items-center ${
                          isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        title="إلغاء ربط التوكيل"
                      >
                        ✕ إلغاء الربط
                      </button>
                    )}
                  </div>

                  <div className="pt-2 border-t border-[#E8EEF1] flex items-center justify-between text-xs">
                    <span className="text-[#4D606A]">مكتب التوثيق: {auth.notarizationOffice}</span>
                    <span
                      data-testid="poa-review-badge"
                      className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                        POA_REVIEW_STATUS_CLASSES[auth.humanReviewStatus] || 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {POA_REVIEW_STATUS_LABELS[auth.humanReviewStatus] || auth.humanReviewStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Tasks & Legal Deadlines */}
      {activeTab === 'tasksDeadlines' && (
        <div id="matter-tabpanel-tasksDeadlines" aria-labelledby="matter-tab-tasksDeadlines" className="space-y-8" role="tabpanel" data-testid="matter-tasks-deadlines-panel">
          <DeadlinesView
            actorId={ownerId}
            initialDeadlines={initialDeadlines}
            canReadDocuments={canReadDocuments}
            matterDocuments={initialDocuments}
            documentsLoadError={documentsError}
            initialError={deadlinesError}
            selectableMatters={[]}
            lockedMatterId={matter.id}
            lockedMatterProceedings={(matter.proceedings || [])
              .filter((p) => !p.archivedAt)
              .map((p) => ({
                id: p.id,
                courtId: p.courtId,
                courtName: p.courtName,
                label: `${p.courtName}${p.numberText ? ` — ${p.numberText}${p.yearLabel ? `/${p.yearLabel}` : ''}` : ' (مسودة قيد)'}`,
              }))}
            isReadOnly={isMatterArchived}
            onDataChanged={() => router.refresh()}
          />

          <TasksView
            actorId={ownerId}
            initialTasks={initialTasks}
            initialError={tasksError}
            selectableMatters={[]}
            lockedMatterId={matter.id}
            lockedMatterProceedings={(matter.proceedings || [])
              .filter((p) => !p.archivedAt)
              .map((p) => ({
                id: p.id,
                courtId: p.courtId,
                courtName: p.courtName,
                label: `${p.courtName}${p.numberText ? ` — ${p.numberText}${p.yearLabel ? `/${p.yearLabel}` : ''}` : ' (مسودة قيد)'}`,
              }))}
            isReadOnly={isMatterArchived}
            onDataChanged={() => router.refresh()}
          />
        </div>
      )}

      {/* Tab 5: Summary & Notes */}
      {activeTab === 'summary' && (
        <div id="matter-tabpanel-summary" aria-labelledby="matter-tab-summary" className="bg-white rounded-[6px] border border-[#D5DFE3] p-6 space-y-6 shadow-xs" role="tabpanel">
          <div>
            <h2 className="text-sm font-bold text-[#172A35] mb-2 pb-1 border-b border-[#E8EEF1]">
              ملخص وقائع وموضوع الملف
            </h2>
            {matter.summary ? (
              <p className="text-xs text-[#172A35] whitespace-pre-wrap leading-relaxed">
                {matter.summary}
              </p>
            ) : (
              <p className="text-xs text-[#4D606A] italic">لا يوجد ملخص مسجل لهذا الملف.</p>
            )}
          </div>

          <div>
            <h2 className="text-sm font-bold text-[#172A35] mb-2 pb-1 border-b border-[#E8EEF1]">
              ملاحظات وتوجيهات داخلية للمكتب
            </h2>
            {matter.notes ? (
              <p className="text-xs text-[#172A35] whitespace-pre-wrap leading-relaxed bg-[#F9FBFC] p-3 rounded border border-[#E8EEF1]">
                {matter.notes}
              </p>
            ) : (
              <p className="text-xs text-[#4D606A] italic">لا توجد ملاحظات داخلية مدونة.</p>
            )}
            {Boolean(matter.noteRevisions?.length) && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-semibold">سجل تعديل الملاحظات</summary>
                <ol className="mt-2 space-y-2">
                  {matter.noteRevisions?.map((revision) => (
                    <li key={revision.version} className="rounded border border-[#E8EEF1] p-2">
                      <time dateTime={revision.createdAt}>{formatCairoDateOnly(revision.createdAt)}</time>
                      <p className="whitespace-pre-wrap">{revision.notes ?? 'تم حذف الملاحظة.'}</p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Future Modules Notice */}
      <div className="p-4 bg-[#F4F6F7] rounded-[6px] border border-dashed border-[#D5DFE3] text-xs text-[#4D606A] space-y-1">
        <span className="font-bold text-[#172A35] block">
          الحسابات المالية
        </span>
        <p>
          حسابات الأتعاب والمصروفات سيتم ربطها تلقائياً بهذا الملف عند إطلاقها في المراحل اللاحقة.
        </p>
      </div>

      {/* Archive Matter Modal */}
      {showArchiveMatterModal &&
        renderModalPortal(
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isLifecycleSubmitting) {
                closeArchiveMatterModal();
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
          >
            <div
              ref={archiveMatterModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="archive-matter-title"
              data-testid="archive-matter-modal"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-md w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto my-auto"
            >
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h3 id="archive-matter-title" className="text-base font-bold text-[#172A35]">
                أرشفة ملف القضية
              </h3>
              <button
                type="button"
                data-testid="cancel-archive-matter-button"
                disabled={isLifecycleSubmitting}
                onClick={closeArchiveMatterModal}
                className="text-xs text-[#4D606A] hover:text-[#172A35] px-2 py-1 min-h-[44px] flex items-center rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✕ إغلاق
              </button>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              عند أرشفة الملف، سيتحول إلى وضع القراءة فقط ولن تتمكن من تعديل بياناته أو إضافة قيود جديدة أو ربط أطراف إلا بعد إلغاء الأرشفة. لا يمكن الأرشفة مع وجود جلسات مجدولة أو مواعيد قانونية مؤكدة مفتوحة.
            </p>

            {lifecycleError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs">
                {lifecycleError}
              </div>
            )}

            {!isLifecycleSubmitting && pendingLifecycleOp?.kind === 'archiveMatter' && (
              <div className="space-y-2">
                <div
                  data-testid="frozen-reason-notice"
                  className="p-2.5 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 font-medium"
                >
                  العملية مجمّدة بنفس مفتاح الطلب والسبب الأصلي لضمان عدم التكرار. لا يمكن تعديل السبب أثناء إعادة المحاولة.
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
                  <span>العملية مجمّدة بمفتاح الطلب نفسه لضمان عدم التكرار.</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {lifecycleSessionExpired && (
                      <NextLink
                        href="/login"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-[#14566B] text-white font-semibold rounded-[6px] min-h-[44px] inline-flex items-center"
                      >
                        فتح شاشة تسجيل الدخول في نافذة جديدة ↗
                      </NextLink>
                    )}
                    <button
                      type="button"
                      data-testid="retry-archive-matter-button"
                      disabled={isLifecycleSubmitting}
                      onClick={() => executeArchiveMatter(pendingLifecycleOp)}
                      className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded min-h-[44px] disabled:opacity-50 whitespace-nowrap"
                    >
                      {isLifecycleSubmitting ? 'جارٍ إعادة المحاولة...' : 'إعادة المحاولة'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleArchiveMatter} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="archive-matter-reason" className="block text-xs font-bold text-[#172A35]">
                  سبب الأرشفة (مطلوب — 3 أحرف على الأقل) <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="archive-matter-reason"
                  ref={archiveMatterReasonInputRef}
                  data-testid="archive-matter-reason-input"
                  value={pendingLifecycleOp?.kind === 'archiveMatter' ? pendingLifecycleOp.payload.reason : matterLifecycleReason}
                  onChange={(e) => {
                    if (pendingLifecycleOp?.kind === 'archiveMatter') return;
                    setMatterLifecycleReason(e.target.value);
                  }}
                  readOnly={!isLifecycleSubmitting && pendingLifecycleOp?.kind === 'archiveMatter'}
                  placeholder="اكتب سبب أرشفة هذا الملف (مثال: انتهاء الإجراءات وحفظ الأوراق)..."
                  rows={3}
                  minLength={3}
                  required
                  disabled={isLifecycleSubmitting}
                  className={`w-full p-2 text-xs border rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60 ${
                    !isLifecycleSubmitting && pendingLifecycleOp?.kind === 'archiveMatter' ? 'bg-[#F4F6F7] text-[#4D606A] border-amber-300 cursor-not-allowed' : 'border-[#D5DFE3]'
                  }`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isLifecycleSubmitting}
                  onClick={closeArchiveMatterModal}
                  className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isLifecycleSubmitting || (pendingLifecycleOp?.kind === 'archiveMatter' ? false : matterLifecycleReason.trim().length < 3)}
                  data-testid="confirm-archive-matter-button"
                  className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded-[6px] disabled:opacity-50 min-h-[44px]"
                >
                  {isLifecycleSubmitting
                    ? 'جارٍ الأرشفة...'
                    : pendingLifecycleOp?.kind === 'archiveMatter'
                    ? 'إعادة المحاولة'
                    : 'تأكيد الأرشفة'}
                </button>
              </div>
            </form>
          </div>
        </div>
        )}

      {/* Reopen Matter Modal */}
      {showReopenMatterModal &&
        renderModalPortal(
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isLifecycleSubmitting) {
                closeReopenMatterModal();
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
          >
            <div
              ref={reopenMatterModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="reopen-matter-title"
              data-testid="reopen-matter-modal"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-md w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto my-auto"
            >
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h3 id="reopen-matter-title" className="text-base font-bold text-[#172A35]">
                إعادة فتح ملف القضية
              </h3>
              <button
                type="button"
                data-testid="cancel-reopen-matter-button"
                disabled={isLifecycleSubmitting}
                onClick={closeReopenMatterModal}
                className="text-xs text-[#4D606A] hover:text-[#172A35] px-2 py-1 min-h-[44px] flex items-center rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✕ إغلاق
              </button>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              بعد إلغاء الأرشفة، يعود الملف إلى الحالة النشطة إذا كان مرتبطًا بموكل، وإلا يعود إلى حالة مسودة. يمكنك بعدها استئناف التعديل.
            </p>

            {lifecycleError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs">
                {lifecycleError}
              </div>
            )}

            {!isLifecycleSubmitting && pendingLifecycleOp?.kind === 'reopenMatter' && (
              <div className="space-y-2">
                <div
                  data-testid="frozen-reason-notice"
                  className="p-2.5 bg-sky-50 border border-sky-300 rounded-[6px] text-xs text-sky-900 font-medium"
                >
                  العملية مجمّدة بنفس مفتاح الطلب والسبب الأصلي لضمان عدم التكرار. لا يمكن تعديل السبب أثناء إعادة المحاولة.
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-sky-50 border border-sky-200 rounded-[6px] text-xs text-sky-900">
                  <span>العملية مجمّدة بمفتاح الطلب نفسه لضمان عدم التكرار.</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {lifecycleSessionExpired && (
                      <NextLink
                        href="/login"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-[#14566B] text-white font-semibold rounded-[6px] min-h-[44px] inline-flex items-center"
                      >
                        فتح شاشة تسجيل الدخول في نافذة جديدة ↗
                      </NextLink>
                    )}
                    <button
                      type="button"
                      data-testid="retry-reopen-matter-button"
                      disabled={isLifecycleSubmitting}
                      onClick={() => executeReopenMatter(pendingLifecycleOp)}
                      className="px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded min-h-[44px] disabled:opacity-50 whitespace-nowrap"
                    >
                      {isLifecycleSubmitting ? 'جارٍ إعادة المحاولة...' : 'إعادة المحاولة'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleReopenMatter} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="reopen-matter-reason" className="block text-xs font-bold text-[#172A35]">
                  سبب إعادة الفتح (مطلوب — 3 أحرف على الأقل) <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="reopen-matter-reason"
                  ref={reopenMatterReasonInputRef}
                  data-testid="reopen-matter-reason-input"
                  value={pendingLifecycleOp?.kind === 'reopenMatter' ? pendingLifecycleOp.payload.reason : matterLifecycleReason}
                  onChange={(e) => {
                    if (pendingLifecycleOp?.kind === 'reopenMatter') return;
                    setMatterLifecycleReason(e.target.value);
                  }}
                  readOnly={!isLifecycleSubmitting && pendingLifecycleOp?.kind === 'reopenMatter'}
                  placeholder="اكتب سبب إعادة فتح الملف (مثال: ظهور مستندات جديدة أو استئناف النزاع)..."
                  rows={3}
                  minLength={3}
                  required
                  disabled={isLifecycleSubmitting}
                  className={`w-full p-2 text-xs border rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60 ${
                    !isLifecycleSubmitting && pendingLifecycleOp?.kind === 'reopenMatter' ? 'bg-[#F4F6F7] text-[#4D606A] border-sky-300 cursor-not-allowed' : 'border-[#D5DFE3]'
                  }`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isLifecycleSubmitting}
                  onClick={closeReopenMatterModal}
                  className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isLifecycleSubmitting || (pendingLifecycleOp?.kind === 'reopenMatter' ? false : matterLifecycleReason.trim().length < 3)}
                  data-testid="confirm-reopen-matter-button"
                  className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] disabled:opacity-50 min-h-[44px]"
                >
                  {isLifecycleSubmitting
                    ? 'جارٍ إعادة الفتح...'
                    : pendingLifecycleOp?.kind === 'reopenMatter'
                    ? 'إعادة المحاولة'
                    : 'تأكيد إعادة الفتح'}
                </button>
              </div>
            </form>
          </div>
        </div>
        )}

      {/* Proceeding Lifecycle Modal (Archive or Reopen) */}
      {selectedProceedingForLifecycle &&
        proceedingLifecycleAction &&
        renderModalPortal(
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isProceedingLifecycleSubmitting) {
                closeProceedingLifecycleModal();
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
          >
            <div
              ref={procLifecycleModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="proceeding-lifecycle-title"
              data-testid="proceeding-lifecycle-modal"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-md w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto my-auto"
            >
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h3 id="proceeding-lifecycle-title" className="text-base font-bold text-[#172A35]">
                {proceedingLifecycleAction === 'archive' ? 'أرشفة القيد القضائي' : 'إعادة فتح القيد القضائي'}
              </h3>
              <button
                type="button"
                data-testid="close-proceeding-lifecycle-modal-button"
                disabled={isProceedingLifecycleSubmitting}
                onClick={closeProceedingLifecycleModal}
                className="text-xs text-[#4D606A] hover:text-[#172A35] px-2 py-1 min-h-[44px] flex items-center rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✕ إغلاق
              </button>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              {proceedingLifecycleAction === 'archive'
                ? `هل ترغب في أرشفة القيد القضائي (${selectedProceedingForLifecycle.courtName})؟ سيتحول إلى قراءة فقط.`
                : `إلغاء أرشفة القيد القضائي (${selectedProceedingForLifecycle.courtName}) يبقي حالته «${PROCEEDING_STATUS_LABELS[selectedProceedingForLifecycle.status]}» ويتيح التعديل وفق هذه الحالة.`}
            </p>

            {proceedingLifecycleError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs">
                {proceedingLifecycleError}
              </div>
            )}

            {!isProceedingLifecycleSubmitting &&
              pendingLifecycleOp &&
              (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
              pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id && (
                <div className="space-y-2">
                  <div
                    data-testid="frozen-reason-notice"
                    className="p-2.5 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 font-medium"
                  >
                    العملية مجمّدة بنفس مفتاح الطلب والسبب الأصلي لضمان عدم التكرار. لا يمكن تعديل السبب أثناء إعادة المحاولة.
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
                    <span>العملية مجمّدة بمفتاح الطلب نفسه لضمان عدم التكرار.</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {lifecycleSessionExpired && (
                        <NextLink
                          href="/login"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-[#14566B] text-white font-semibold rounded-[6px] min-h-[44px] inline-flex items-center"
                        >
                          فتح شاشة تسجيل الدخول في نافذة جديدة ↗
                        </NextLink>
                      )}
                      <button
                        type="button"
                        data-testid="retry-proceeding-lifecycle-button"
                        disabled={isProceedingLifecycleSubmitting}
                        onClick={() => {
                          if (!pendingLifecycleOp) return;
                          if (pendingLifecycleOp.kind === 'archiveProceeding') {
                            executeArchiveProceeding(pendingLifecycleOp);
                          } else if (pendingLifecycleOp.kind === 'reopenProceeding') {
                            executeReopenProceeding(pendingLifecycleOp);
                          }
                        }}
                        className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded min-h-[44px] disabled:opacity-50 whitespace-nowrap"
                      >
                        {isProceedingLifecycleSubmitting ? 'جارٍ إعادة المحاولة...' : 'إعادة المحاولة'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

            <form
              onSubmit={proceedingLifecycleAction === 'archive' ? handleArchiveProceeding : handleReopenProceeding}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label htmlFor="proceeding-lifecycle-reason" className="block text-xs font-bold text-[#172A35]">
                  السبب (مطلوب — 3 أحرف على الأقل) <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="proceeding-lifecycle-reason"
                  ref={procLifecycleReasonInputRef}
                  data-testid="proceeding-lifecycle-reason-input"
                  value={
                    pendingLifecycleOp &&
                    (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
                    pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id
                      ? pendingLifecycleOp.payload.reason
                      : proceedingLifecycleReason
                  }
                  onChange={(e) => {
                    if (
                      pendingLifecycleOp &&
                      (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
                      pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id
                    ) {
                      return;
                    }
                    setProceedingLifecycleReason(e.target.value);
                  }}
                  readOnly={Boolean(
                    !isProceedingLifecycleSubmitting &&
                    pendingLifecycleOp &&
                    (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
                    pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id
                  )}
                  placeholder="اكتب سبب هذا الإجراء..."
                  rows={3}
                  minLength={3}
                  required
                  disabled={isProceedingLifecycleSubmitting}
                  className={`w-full p-2 text-xs border rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60 ${
                    !isProceedingLifecycleSubmitting &&
                    pendingLifecycleOp &&
                    (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
                    pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id
                      ? 'bg-[#F4F6F7] text-[#4D606A] border-amber-300 cursor-not-allowed'
                      : 'border-[#D5DFE3]'
                  }`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  data-testid="cancel-proceeding-lifecycle-button"
                  disabled={isProceedingLifecycleSubmitting}
                  onClick={closeProceedingLifecycleModal}
                  className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={
                    isProceedingLifecycleSubmitting ||
                    (pendingLifecycleOp &&
                    (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
                    pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id
                      ? false
                      : proceedingLifecycleReason.trim().length < 3)
                  }
                  data-testid="confirm-proceeding-lifecycle-button"
                  className={`px-4 py-2 text-white text-xs font-bold rounded-[6px] disabled:opacity-50 min-h-[44px] ${
                    proceedingLifecycleAction === 'archive'
                      ? 'bg-amber-700 hover:bg-amber-800'
                      : 'bg-[#14566B] hover:bg-[#0F4354]'
                  }`}
                >
                  {isProceedingLifecycleSubmitting
                    ? 'جارٍ التنفيذ...'
                    : pendingLifecycleOp &&
                      (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
                      pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id
                    ? 'إعادة المحاولة'
                    : proceedingLifecycleAction === 'archive'
                    ? 'تأكيد الأرشفة'
                    : 'تأكيد إعادة الفتح'}
                </button>
              </div>
            </form>
          </div>
        </div>
        )}
    </div>
  );
}

