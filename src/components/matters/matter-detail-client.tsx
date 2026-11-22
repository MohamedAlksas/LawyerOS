'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MatterDTO,
  MatterPartyRole,
  MatterPartySummaryDTO,
  MatterAuthorizationSummaryDTO,
  ProceedingSummaryDTO,
  MatterStatus,
  ProceedingStatus,
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getMatterAction,
} from '@/modules/matters/matter-actions';
import { searchPartiesAction, getClientProfileAction } from '@/modules/parties/actions';
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

interface MatterDetailClientProps {
  initialMatter: MatterDTO;
}

export function MatterDetailClient({ initialMatter }: MatterDetailClientProps) {
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
  const [activeTab, setActiveTab] = useState<'parties' | 'proceedings' | 'authorizations' | 'summary' | 'audit'>('parties');

  // Party Linking Modal / Form State (C11 guarded async lifecycle)
  const [showAddPartyModal, setShowAddPartyModal] = useState(false);
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [searchedParties, setSearchedParties] = useState<{ id: string; name: string }[]>([]);
  const [isSearchingParty, setIsSearchingParty] = useState(false);
  const [partySearchError, setPartySearchError] = useState<string | null>(null);
  const partySearchGenRef = useRef(0);

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

  // Matter Archive/Reopen State
  const [showArchiveMatterModal, setShowArchiveMatterModal] = useState(false);
  const [showReopenMatterModal, setShowReopenMatterModal] = useState(false);
  const [matterLifecycleReason, setMatterLifecycleReason] = useState('');
  const [isLifecycleSubmitting, setIsLifecycleSubmitting] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

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

  const pendingLifecycleOpRef = useRef<LifecycleOp | null>(null);
  const [pendingLifecycleOp, setPendingLifecycleOp] = useState<LifecycleOp | null>(null);

  // Standards 5: Modal Focus Management
  const lastLifecycleTriggerRef = useRef<HTMLElement | null>(null);
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
    setPartyActionError(null);
    setPartySearchError(null);
    partySearchGenRef.current++;
    setSearchedParties([]);
    setShowAddPartyModal(true);
  };

  const closePartyModal = () => {
    // U4: invalidate any in-flight search so a late response cannot repopulate
    // the panel after it was closed.
    partySearchGenRef.current++;
    setSearchedParties([]);
    setIsSearchingParty(false);
    setShowAddPartyModal(false);
  };

  const openArchiveMatterModal = (triggerEl?: HTMLElement | null) => {
    if (pendingLifecycleOpRef.current && pendingLifecycleOpRef.current.kind !== 'archiveMatter') {
      setActionMessage(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}). يرجى حسمها أولاً.`);
      return;
    }
    lastLifecycleTriggerRef.current = triggerEl || (document.activeElement as HTMLElement | null);
    setLifecycleError(null);
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
    const trigger = lastLifecycleTriggerRef.current;
    if (trigger && typeof trigger.focus === 'function') {
      requestAnimationFrame(() => trigger.focus());
    }
  }, [isLifecycleSubmitting]);

  const openReopenMatterModal = (triggerEl?: HTMLElement | null) => {
    if (pendingLifecycleOpRef.current && pendingLifecycleOpRef.current.kind !== 'reopenMatter') {
      setActionMessage(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}). يرجى حسمها أولاً.`);
      return;
    }
    lastLifecycleTriggerRef.current = triggerEl || (document.activeElement as HTMLElement | null);
    setLifecycleError(null);
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
    const trigger = lastLifecycleTriggerRef.current;
    if (trigger && typeof trigger.focus === 'function') {
      requestAnimationFrame(() => trigger.focus());
    }
  }, [isLifecycleSubmitting]);

  const openProceedingLifecycleModal = (
    proc: ProceedingSummaryDTO,
    action: 'archive' | 'reopen',
    triggerEl?: HTMLElement | null
  ) => {
    if (
      pendingLifecycleOpRef.current &&
      !(
        ((action === 'archive' && pendingLifecycleOpRef.current.kind === 'archiveProceeding') ||
          (action === 'reopen' && pendingLifecycleOpRef.current.kind === 'reopenProceeding')) &&
        pendingLifecycleOpRef.current.proceedingId === proc.id
      )
    ) {
      setActionMessage(`توجد عملية مجمّدة أخرى لم تُحسم بعد (${pendingLifecycleOpRef.current.description}). يرجى حسمها أولاً.`);
      return;
    }
    lastLifecycleTriggerRef.current = triggerEl || (document.activeElement as HTMLElement | null);
    setSelectedProceedingForLifecycle(proc);
    setProceedingLifecycleAction(action);
    setProceedingLifecycleError(null);
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
    const trigger = lastLifecycleTriggerRef.current;
    if (trigger && typeof trigger.focus === 'function') {
      requestAnimationFrame(() => trigger.focus());
    }
  }, [isProceedingLifecycleSubmitting]);

  // Focus trap and initial focus for Archive Matter Modal
  useEffect(() => {
    if (showArchiveMatterModal) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (!isLifecycleSubmitting) {
            e.preventDefault();
            closeArchiveMatterModal();
          }
          return;
        }
        if (e.key === 'Tab' && archiveMatterModalRef.current) {
          const focusables = archiveMatterModalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      requestAnimationFrame(() => {
        archiveMatterReasonInputRef.current?.focus();
      });
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showArchiveMatterModal, isLifecycleSubmitting, closeArchiveMatterModal]);

  // Focus trap and initial focus for Reopen Matter Modal
  useEffect(() => {
    if (showReopenMatterModal) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (!isLifecycleSubmitting) {
            e.preventDefault();
            closeReopenMatterModal();
          }
          return;
        }
        if (e.key === 'Tab' && reopenMatterModalRef.current) {
          const focusables = reopenMatterModalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      requestAnimationFrame(() => {
        reopenMatterReasonInputRef.current?.focus();
      });
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showReopenMatterModal, isLifecycleSubmitting, closeReopenMatterModal]);

  // Focus trap and initial focus for Proceeding Lifecycle Modal
  useEffect(() => {
    if (selectedProceedingForLifecycle && proceedingLifecycleAction) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (!isProceedingLifecycleSubmitting) {
            e.preventDefault();
            closeProceedingLifecycleModal();
          }
          return;
        }
        if (e.key === 'Tab' && procLifecycleModalRef.current) {
          const focusables = procLifecycleModalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      requestAnimationFrame(() => {
        procLifecycleReasonInputRef.current?.focus();
      });
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [selectedProceedingForLifecycle, proceedingLifecycleAction, isProceedingLifecycleSubmitting, closeProceedingLifecycleModal]);

  // Search Parties for Linking (C11/U4: separate query from selection, clear
  // stale rows on query change, and invalidate generations on selection/close)
  const handleSearchParties = async (q: string) => {
    setPartySearchQuery(q);
    setSelectedPartyId('');
    setSearchedParties([]);
    const gen = ++partySearchGenRef.current;

    if (!q.trim()) {
      setIsSearchingParty(false);
      setPartySearchError(null);
      return;
    }

    setIsSearchingParty(true);
    setPartySearchError(null);

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
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
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
          isPrimaryContact,
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
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
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
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
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
    setAvailablePoas([]);
    setSelectedPoaId('');
    setShowAddPoaModal(true);
    setIsLoadingPoas(true);
    setPoaActionError(null);
    const poaList: { id: string; poaNumberText: string; poaYearLabel: string; notarizationOffice: string; partyName: string }[] = [];

    try {
      let failedClients = 0;
      for (const client of clients) {
        const res = await getClientProfileAction(client.partyId);
        if (gen !== poaLoadGenRef.current) return;
        if (res.success && res.data.powersOfAttorney) {
          for (const poa of res.data.powersOfAttorney) {
            if (!authorizations.some((a) => a.powerOfAttorneyId === poa.id)) {
              poaList.push({
                id: poa.id,
                poaNumberText: poa.poaNumberText,
                poaYearLabel: poa.poaYearLabel,
                notarizationOffice: poa.notarizationOffice,
                partyName: client.partyName,
              });
            }
          }
        } else if (!res.success) {
          failedClients++;
        }
      }
      if (gen !== poaLoadGenRef.current) return;
      setAvailablePoas(poaList);
      // U8: a partial failure is not an empty result. Report both the confirmed
      // list and the clients whose POAs could not be read.
      if (failedClients > 0) {
        setPoaActionError(
          `تعذر تحميل توكيلات ${failedClients} من الموكلين. المعروض ${poaList.length} توكيلاً فقط وليس قائمة كاملة؛ يمكنك إعادة المحاولة.`
        );
      }
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
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
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
      setPartyActionError(
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
          setActionMessage('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          if (!pendingAssocOpRef.current || pendingAssocOpRef.current.key === op.key) {
            setPendingAssocOp(op);
          }
          setActionMessage(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          if (pendingAssocOpRef.current?.key === op.key) {
            pendingAssocOpRef.current = null;
            setPendingAssocOp(null);
          }
          setActionMessage(`تعذر إلغاء الربط: ${res.error}`);
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
      setActionMessage('حدث خطأ أثناء إلغاء الربط.');
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
      setPartyActionError(
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
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          pendingLifecycleOpRef.current = null;
          setPendingLifecycleOp(null);
          setLifecycleError(res.error || 'تعذر أرشفة الملف.');
        }
        return;
      }

      pendingLifecycleOpRef.current = null;
      setPendingLifecycleOp(null);
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
      pendingLifecycleOpRef.current = op;
      setPendingLifecycleOp(op);
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
    pendingLifecycleOpRef.current = op;
    setPendingLifecycleOp(op);
    await executeArchiveMatter(op);
  };

  const executeReopenMatter = async (op: Extract<LifecycleOp, { kind: 'reopenMatter' }>) => {
    setIsLifecycleSubmitting(true);
    setLifecycleError(null);
    try {
      const res = await reopenMatterAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          pendingLifecycleOpRef.current = null;
          setPendingLifecycleOp(null);
          setLifecycleError(res.error || 'تعذر إعادة فتح الملف.');
        }
        return;
      }

      pendingLifecycleOpRef.current = null;
      setPendingLifecycleOp(null);
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
      pendingLifecycleOpRef.current = op;
      setPendingLifecycleOp(op);
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
    pendingLifecycleOpRef.current = op;
    setPendingLifecycleOp(op);
    await executeReopenMatter(op);
  };

  const executeArchiveProceeding = async (op: Extract<LifecycleOp, { kind: 'archiveProceeding' }>) => {
    setIsProceedingLifecycleSubmitting(true);
    setProceedingLifecycleError(null);
    try {
      const res = await archiveProceedingAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setProceedingLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setProceedingLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          pendingLifecycleOpRef.current = null;
          setPendingLifecycleOp(null);
          setProceedingLifecycleError(res.error || 'تعذر أرشفة القيد القضائي.');
        }
        return;
      }

      pendingLifecycleOpRef.current = null;
      setPendingLifecycleOp(null);
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
      pendingLifecycleOpRef.current = op;
      setPendingLifecycleOp(op);
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
    pendingLifecycleOpRef.current = op;
    setPendingLifecycleOp(op);
    await executeArchiveProceeding(op);
  };

  const executeReopenProceeding = async (op: Extract<LifecycleOp, { kind: 'reopenProceeding' }>) => {
    setIsProceedingLifecycleSubmitting(true);
    setProceedingLifecycleError(null);
    try {
      const res = await reopenProceedingAction({
        ...op.payload,
        idempotencyKey: op.key,
      });

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setProceedingLifecycleError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة بنفس المفتاح.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          pendingLifecycleOpRef.current = op;
          setPendingLifecycleOp(op);
          setProceedingLifecycleError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ يمكنك إعادة المحاولة.'
          );
        } else {
          pendingLifecycleOpRef.current = null;
          setPendingLifecycleOp(null);
          setProceedingLifecycleError(res.error || 'تعذر إعادة فتح القيد القضائي.');
        }
        return;
      }

      pendingLifecycleOpRef.current = null;
      setPendingLifecycleOp(null);
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
      pendingLifecycleOpRef.current = op;
      setPendingLifecycleOp(op);
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
    pendingLifecycleOpRef.current = op;
    setPendingLifecycleOp(op);
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
            <span aria-hidden="true">&gt;</span>
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
                onClick={(e) => {
                  openArchiveMatterModal(e.currentTarget);
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold rounded-[6px] border border-amber-300 transition-colors min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>📦</span>
                <span>أرشفة الملف</span>
              </button>
              <Link
                href={`/matters/${matter.id}/edit`}
                data-testid="edit-matter-button"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
              >
                <span>✏️</span>
                <span>تعديل بيانات الملف</span>
              </Link>
              <Link
                href={`/matters/${matter.id}/proceedings/new`}
                data-testid="add-proceeding-button"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px]"
              >
                <span>⚖️</span>
                <span>+ إضافة قيد قضائي</span>
              </Link>
            </>
          ) : (
            <button
              type="button"
              data-testid="reopen-matter-button"
              disabled={Boolean(pendingLifecycleOp && pendingLifecycleOp.kind !== 'reopenMatter')}
              onClick={(e) => {
                openReopenMatterModal(e.currentTarget);
              }}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>📂</span>
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
              <span aria-hidden="true">⚠️</span>
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
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-[6px] transition-colors whitespace-nowrap min-h-[36px]"
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
            <span aria-hidden="true" className="text-lg">📁</span>
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
            className="text-emerald-700 hover:text-emerald-900 font-bold px-2 py-0.5"
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
          <span>⚠️ {partyActionError}</span>
          <button
            type="button"
            onClick={() => setPartyActionError(null)}
            className="text-red-700 hover:text-red-900 font-bold px-2 py-0.5"
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
            <span>🔒</span>
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
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-block"
            >
              فتح شاشة تسجيل الدخول في نافذة جديدة ↗
            </a>
            <button
              type="button"
              onClick={handleRetryPendingAssoc}
              data-testid="assoc-session-retry-button"
              className="px-3 py-1.5 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors min-h-[36px]"
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
            <span>⏳</span>
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
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[36px]"
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
            <span className="text-xl select-none" aria-hidden="true">⚠️</span>
            <div className="text-xs leading-relaxed">
              <span className="font-bold block text-sm mb-0.5">الملف نشط بدون مكان حفظ ورقي محدد</span>
              <span>
                لم يتم تحديد دولاب أو رف الحفظ الورقي لهذا الملف بعد. يرجى تحديد مكان الحفظ لتجنب ضياع أو تأخر الأوراق والمستندات.
              </span>
            </div>
          </div>
          <Link
            href={`/matters/${matter.id}/edit`}
            className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold rounded-[6px] shrink-0 self-start sm:self-center transition-colors min-h-[36px] flex items-center justify-center"
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
            <span className="text-base">📁</span>
            <span className="font-semibold text-[#4D606A]">مكان الحفظ الورقي بالمكتب:</span>
            <span className="font-bold text-[#14566B]">{matter.paperLocationName}</span>
          </div>
          <Link
            href={`/matters/${matter.id}/edit`}
            className="text-[#14566B] hover:underline font-medium"
          >
            تغيير
          </Link>
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
        <nav className="flex space-x-1 sm:space-x-4 space-x-reverse" aria-label="أقسام ملف القضية">
          <button
            type="button"
            data-testid="tab-parties"
            onClick={() => setActiveTab('parties')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'parties'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            👥 الأطراف والصفات ({parties.length})
          </button>

          <button
            type="button"
            data-testid="tab-proceedings"
            onClick={() => setActiveTab('proceedings')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'proceedings'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            ⚖️ القيود والدعاوى القضائية ({proceedings.length})
          </button>

          <button
            type="button"
            data-testid="tab-authorizations"
            onClick={() => setActiveTab('authorizations')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'authorizations'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            📜 سندات الوكالة والتوكيلات ({authorizations.length})
          </button>

          <button
            type="button"
            data-testid="tab-summary"
            onClick={() => setActiveTab('summary')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'summary'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            📝 الملخص والملاحظات
          </button>
        </nav>
      </div>

      {/* Tab 1: Parties Section */}
      {activeTab === 'parties' && (
        <div className="space-y-6">
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
                className={`px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[40px] flex items-center gap-1.5 transition-colors ${
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
                  className="text-xs text-[#4D606A] hover:text-[#172A35] p-1"
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
                  {!isSearchingParty && !partySearchError && partySearchQuery.trim() && searchedParties.length === 0 && (
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
                            partySearchGenRef.current++;
                            setSelectedPartyId(p.id);
                            setPartySearchQuery(p.name);
                            setSearchedParties([]);
                          }}
                          className={`w-full text-right p-2 hover:bg-[#F4F6F7] text-xs font-medium ${
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
                      onChange={(e) => setSelectedPartyRole(e.target.value as MatterPartyRole)}
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
                      <label className="inline-flex items-center gap-2 cursor-pointer">
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
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closePartyModal}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3]"
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
                {matter.status === 'ACTIVE' ? 'الملف نشط ويتطلب موكلاً واحداً على الأقل دائماً' : 'مسودة'}
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
                            className={`text-xs text-[#4D606A] hover:text-amber-700 p-1 rounded ${
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
                            className={`text-xs text-red-600 hover:text-red-800 p-1 rounded ${
                              isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                            title="إزالة الطرف من الملف"
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
                          className={`text-xs text-red-600 hover:text-red-800 p-1 rounded ${
                            isAssocSubmitting || !!pendingAssocOp ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          title="إزالة الخصم"
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
                      <span className="font-bold text-sm text-[#172A35]">{oth.partyName}</span>
                      {!isMatterArchived && (
                        <button
                          type="button"
                          onClick={() => handleUnlinkParty(oth)}
                          disabled={isAssocSubmitting || !!pendingAssocOp}
                          className={`text-xs text-red-600 hover:text-red-800 p-1 ${
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
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#172A35]">
              القيود والدعاوى القضائية المسجلة
            </h2>
            {!isMatterArchived && (
              <Link
                href={`/matters/${matter.id}/proceedings/new`}
                data-testid="add-proceeding-tab-button"
                className="px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[40px] flex items-center gap-1.5 transition-colors"
              >
                <span>⚖️</span>
                <span>+ تسجيل قيد قضائي جديد</span>
              </Link>
            )}
          </div>

          {proceedings.length === 0 ? (
            <div
              data-testid="empty-proceedings-container"
              className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 text-center space-y-3 shadow-xs"
            >
              <div className="text-3xl">⚖️</div>
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
                const isDraft = proc.status === 'DRAFT' || !proc.numberText || !proc.yearLabel;
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
                              <span>📁</span>
                              <span>مؤرشف</span>
                            </span>
                          ) : isDraft ? (
                            <span
                              data-testid="proceeding-draft-badge"
                              className="text-xs font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 inline-flex items-center gap-1"
                            >
                              <span>⚠️</span>
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
                              <bdi dir="ltr" className="font-mono text-sm font-bold text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                {proc.numberText} لسنة {proc.yearLabel}
                              </bdi>
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

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/matters/${matter.id}/proceedings/${proc.id}`}
                          data-testid={`view-proceeding-${proc.id}`}
                          className="px-3 py-1.5 bg-white hover:bg-[#F4F6F7] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#14566B]/30 transition-colors min-h-[36px] flex items-center"
                        >
                          عرض تفاصيل القيد
                        </Link>
                        {!isMatterArchived && !isProcArchived && (
                          <Link
                            href={`/matters/${matter.id}/proceedings/${proc.id}/edit`}
                            data-testid={`edit-proceeding-${proc.id}`}
                            className="px-3 py-1.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[36px] flex items-center"
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
                              onClick={(e) => {
                                openProceedingLifecycleModal(proc, 'archive', e.currentTarget);
                              }}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-medium rounded-[6px] border border-amber-300 transition-colors min-h-[36px] flex items-center disabled:opacity-40 disabled:cursor-not-allowed"
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
                              onClick={(e) => {
                                openProceedingLifecycleModal(proc, 'reopen', e.currentTarget);
                              }}
                              className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-medium rounded-[6px] border border-emerald-300 transition-colors min-h-[36px] flex items-center disabled:opacity-40 disabled:cursor-not-allowed"
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
                        <span aria-hidden="true">🔗</span>
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
        <div className="space-y-6">
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
                className={`px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[40px] flex items-center gap-1.5 transition-colors ${
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
                  className="text-xs text-[#4D606A] hover:text-[#172A35] p-1"
                >
                  ✕ إغلاق
                </button>
              </div>

              {poaActionError && (
                <p
                  role="alert"
                  data-testid="poa-load-error"
                  className="text-xs text-red-600 font-bold bg-red-50 p-2 rounded"
                >
                  ⚠️ {poaActionError}
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
                        className="px-3 py-1.5 bg-white border border-red-300 text-red-900 font-semibold rounded-[6px] min-h-[32px]"
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
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3]"
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
              <div className="text-3xl">📜</div>
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
                        <bdi dir="ltr" className="font-mono font-bold text-[#14566B]">
                          {auth.poaNumberText} لسنة {auth.poaYearLabel}
                        </bdi>
                      </div>
                    </div>

                    {!isMatterArchived && (
                      <button
                        type="button"
                        data-testid={`unlink-poa-${auth.id}`}
                        onClick={() => handleUnlinkPoa(auth)}
                        disabled={isAssocSubmitting || !!pendingAssocOp}
                        className={`text-xs text-red-600 hover:text-red-800 p-1 ${
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

      {/* Tab 4: Summary & Notes */}
      {activeTab === 'summary' && (
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-6 space-y-6 shadow-xs">
          <div>
            <h3 className="text-sm font-bold text-[#172A35] mb-2 pb-1 border-b border-[#E8EEF1]">
              ملخص وقائع وموضوع الملف
            </h3>
            {matter.summary ? (
              <p className="text-xs text-[#172A35] whitespace-pre-wrap leading-relaxed">
                {matter.summary}
              </p>
            ) : (
              <p className="text-xs text-[#4D606A] italic">لا يوجد ملخص مسجل لهذا الملف.</p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold text-[#172A35] mb-2 pb-1 border-b border-[#E8EEF1]">
              ملاحظات وتوجيهات داخلية للمكتب
            </h3>
            {matter.notes ? (
              <p className="text-xs text-[#172A35] whitespace-pre-wrap leading-relaxed bg-[#F9FBFC] p-3 rounded border border-[#E8EEF1]">
                {matter.notes}
              </p>
            ) : (
              <p className="text-xs text-[#4D606A] italic">لا توجد ملاحظات داخلية مدونة.</p>
            )}
          </div>
        </div>
      )}

      {/* Future Modules Notice */}
      <div className="p-4 bg-[#F4F6F7] rounded-[6px] border border-dashed border-[#D5DFE3] text-xs text-[#4D606A] space-y-1">
        <span className="font-bold text-[#172A35] block">
          📅 الجلسات والأجندة والمستندات والحسابات
        </span>
        <p>
          وحدات إدارة الجلسات وقرارات المحكمة (T08) وحفظ المستندات الرقمية (T11) وحسابات الأتعاب والمصروفات (T09/T10)
          سيتم ربطها تلقائياً بهذا الملف فور إطلاقها في المراحل القادمة.
        </p>
      </div>

      {/* Archive Matter Modal */}
      {showArchiveMatterModal && (
        <div
          ref={archiveMatterModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-matter-title"
          data-testid="archive-matter-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isLifecycleSubmitting) {
              closeArchiveMatterModal();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h3 id="archive-matter-title" className="text-base font-bold text-[#172A35]">
                📦 أرشفة ملف القضية
              </h3>
              <button
                type="button"
                data-testid="cancel-archive-matter-button"
                disabled={isLifecycleSubmitting}
                onClick={closeArchiveMatterModal}
                className="text-xs text-[#4D606A] hover:text-[#172A35] p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✕ إغلاق
              </button>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              عند أرشفة الملف، سيتحول إلى وضع القراءة فقط ولن تتمكن من تعديل بياناته أو إضافة قيود جديدة أو ربط أطراف إلا بعد إلغاء الأرشفة.
            </p>

            {lifecycleError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs">
                ⚠️ {lifecycleError}
              </div>
            )}

            {pendingLifecycleOp?.kind === 'archiveMatter' && (
              <div className="space-y-2">
                <div
                  data-testid="frozen-reason-notice"
                  className="p-2.5 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 font-medium"
                >
                  العملية مجمّدة بنفس مفتاح الطلب والسبب الأصلي لضمان عدم التكرار. لا يمكن تعديل السبب أثناء إعادة المحاولة.
                </div>
                <div className="flex items-center justify-between p-2.5 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
                  <span>العملية مجمّدة بمفتاح الطلب نفسه لضمان عدم التكرار.</span>
                  <button
                    type="button"
                    data-testid="retry-archive-matter-button"
                    disabled={isLifecycleSubmitting}
                    onClick={() => executeArchiveMatter(pendingLifecycleOp)}
                    className="px-3 py-1 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded min-h-[32px] disabled:opacity-50 whitespace-nowrap"
                  >
                    {isLifecycleSubmitting ? 'جارٍ إعادة المحاولة...' : 'إعادة المحاولة'}
                  </button>
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
                  readOnly={pendingLifecycleOp?.kind === 'archiveMatter'}
                  placeholder="اكتب سبب أرشفة هذا الملف (مثال: انتهاء الإجراءات وحفظ الأوراق)..."
                  rows={3}
                  minLength={3}
                  required
                  disabled={isLifecycleSubmitting}
                  className={`w-full p-2 text-xs border rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60 ${
                    pendingLifecycleOp?.kind === 'archiveMatter' ? 'bg-[#F4F6F7] text-[#4D606A] border-amber-300 cursor-not-allowed' : 'border-[#D5DFE3]'
                  }`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isLifecycleSubmitting}
                  onClick={closeArchiveMatterModal}
                  className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isLifecycleSubmitting || (pendingLifecycleOp?.kind === 'archiveMatter' ? false : matterLifecycleReason.trim().length < 3)}
                  data-testid="confirm-archive-matter-button"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-[6px] disabled:opacity-50 min-h-[40px]"
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
      {showReopenMatterModal && (
        <div
          ref={reopenMatterModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reopen-matter-title"
          data-testid="reopen-matter-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isLifecycleSubmitting) {
              closeReopenMatterModal();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h3 id="reopen-matter-title" className="text-base font-bold text-[#172A35]">
                📂 إعادة فتح ملف القضية
              </h3>
              <button
                type="button"
                data-testid="cancel-reopen-matter-button"
                disabled={isLifecycleSubmitting}
                onClick={closeReopenMatterModal}
                className="text-xs text-[#4D606A] hover:text-[#172A35] p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✕ إغلاق
              </button>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              إعادة فتح الملف سيعيده إلى الحالة النشطة ويسمح باستئناف التعديل وإضافة القيود القضائية وربط التوكيلات.
            </p>

            {lifecycleError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs">
                ⚠️ {lifecycleError}
              </div>
            )}

            {pendingLifecycleOp?.kind === 'reopenMatter' && (
              <div className="space-y-2">
                <div
                  data-testid="frozen-reason-notice"
                  className="p-2.5 bg-sky-50 border border-sky-300 rounded-[6px] text-xs text-sky-900 font-medium"
                >
                  العملية مجمّدة بنفس مفتاح الطلب والسبب الأصلي لضمان عدم التكرار. لا يمكن تعديل السبب أثناء إعادة المحاولة.
                </div>
                <div className="flex items-center justify-between p-2.5 bg-sky-50 border border-sky-200 rounded-[6px] text-xs text-sky-900">
                  <span>العملية مجمّدة بمفتاح الطلب نفسه لضمان عدم التكرار.</span>
                  <button
                    type="button"
                    data-testid="retry-reopen-matter-button"
                    disabled={isLifecycleSubmitting}
                    onClick={() => executeReopenMatter(pendingLifecycleOp)}
                    className="px-3 py-1 bg-[#14566B] hover:bg-[#0F4354] text-white font-bold rounded min-h-[32px] disabled:opacity-50 whitespace-nowrap"
                  >
                    {isLifecycleSubmitting ? 'جارٍ إعادة المحاولة...' : 'إعادة المحاولة'}
                  </button>
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
                  readOnly={pendingLifecycleOp?.kind === 'reopenMatter'}
                  placeholder="اكتب سبب إعادة فتح الملف (مثال: ظهور مستندات جديدة أو استئناف النزاع)..."
                  rows={3}
                  minLength={3}
                  required
                  disabled={isLifecycleSubmitting}
                  className={`w-full p-2 text-xs border rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60 ${
                    pendingLifecycleOp?.kind === 'reopenMatter' ? 'bg-[#F4F6F7] text-[#4D606A] border-sky-300 cursor-not-allowed' : 'border-[#D5DFE3]'
                  }`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isLifecycleSubmitting}
                  onClick={closeReopenMatterModal}
                  className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isLifecycleSubmitting || (pendingLifecycleOp?.kind === 'reopenMatter' ? false : matterLifecycleReason.trim().length < 3)}
                  data-testid="confirm-reopen-matter-button"
                  className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] disabled:opacity-50 min-h-[40px]"
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
      {selectedProceedingForLifecycle && proceedingLifecycleAction && (
        <div
          ref={procLifecycleModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="proceeding-lifecycle-title"
          data-testid="proceeding-lifecycle-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isProceedingLifecycleSubmitting) {
              closeProceedingLifecycleModal();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
        >
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h3 id="proceeding-lifecycle-title" className="text-base font-bold text-[#172A35]">
                {proceedingLifecycleAction === 'archive' ? '📦 أرشفة القيد القضائي' : '📂 إعادة فتح القيد القضائي'}
              </h3>
              <button
                type="button"
                data-testid="cancel-proceeding-lifecycle-button"
                disabled={isProceedingLifecycleSubmitting}
                onClick={closeProceedingLifecycleModal}
                className="text-xs text-[#4D606A] hover:text-[#172A35] p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ✕ إغلاق
              </button>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              {proceedingLifecycleAction === 'archive'
                ? `هل ترغب في أرشفة القيد القضائي (${selectedProceedingForLifecycle.courtName})؟ سيتحول إلى قراءة فقط.`
                : `إعادة فتح القيد القضائي (${selectedProceedingForLifecycle.courtName}) سيعيده للحالة النشطة ويسمح بالتعديل.`}
            </p>

            {proceedingLifecycleError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs">
                ⚠️ {proceedingLifecycleError}
              </div>
            )}

            {pendingLifecycleOp &&
              (pendingLifecycleOp.kind === 'archiveProceeding' || pendingLifecycleOp.kind === 'reopenProceeding') &&
              pendingLifecycleOp.proceedingId === selectedProceedingForLifecycle.id && (
                <div className="space-y-2">
                  <div
                    data-testid="frozen-reason-notice"
                    className="p-2.5 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 font-medium"
                  >
                    العملية مجمّدة بنفس مفتاح الطلب والسبب الأصلي لضمان عدم التكرار. لا يمكن تعديل السبب أثناء إعادة المحاولة.
                  </div>
                  <div className="flex items-center justify-between p-2.5 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
                    <span>العملية مجمّدة بمفتاح الطلب نفسه لضمان عدم التكرار.</span>
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
                      className="px-3 py-1 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded min-h-[32px] disabled:opacity-50 whitespace-nowrap"
                    >
                      {isProceedingLifecycleSubmitting ? 'جارٍ إعادة المحاولة...' : 'إعادة المحاولة'}
                    </button>
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
                  className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className={`px-4 py-2 text-white text-xs font-bold rounded-[6px] disabled:opacity-50 min-h-[40px] ${
                    proceedingLifecycleAction === 'archive'
                      ? 'bg-amber-600 hover:bg-amber-700'
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

