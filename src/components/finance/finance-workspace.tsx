'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import NextLink from 'next/link';
import type {
  ClientStatementDTO,
  FeeAgreementDTO,
  FeeChargingMethod,
  FeeChargeDTO,
  FinanceOverviewDTO,
  PaymentMethod,
  ReceiptDTO,
  TransactionDTO,
} from '@/modules/finance/finance-types';
import {
  formatCairoDateArabic,
  formatCairoInstantArabic,
  getCairoTodayDateString,
} from '@/lib/cairo-date';
import { normalizeArabicDigits } from '@/lib/normalization';
import {
  isUncertainMutationOutcome,
  renderModalPortal,
  useAccessibleModal,
} from '@/components/productivity/productivity-ui-types';
import { useLeaveGuard } from '@/components/navigation-guard';
import {
  IconCheck,
  IconDocument,
  IconPlus,
  IconPrint,
  IconRefresh,
  IconWallet,
  IconWarning,
} from '@/components/stitch-icons';

const CHARGING_METHOD_LABELS: Record<FeeChargingMethod, string> = {
  FIXED: 'أتعاب مقطوعة',
  INSTALLMENTS: 'دفعات / أقساط محددة',
  HOURLY_ESTIMATE: 'تقدير بالساعات',
  OTHER: 'طريقة أخرى',
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'نقداً',
  BANK_TRANSFER: 'تحويل بنكي',
  INSTAPAY: 'إنستاباي',
  CHEQUE: 'شيك',
  WALLET: 'محفظة إلكترونية',
  OTHER: 'أخرى',
};

const AGREEMENT_STATUS_LABELS: Record<FeeAgreementDTO['status'], string> = {
  DRAFT: 'مسودة (بلا أثر مالي)',
  APPROVED: 'معتمد ومرحّل',
  CANCELLED: 'ملغى',
};

const TRANSACTION_KIND_LABELS: Record<string, string> = {
  FEE_CHARGE: 'قيد إثبات استحقاق أتعاب',
  FEE_PAYMENT: 'سند تحصيل أتعاب',
};

const ADMINISTRATIVE_NOTICE =
  'إيصال تحصيل إداري — للاستخدام الداخلي بالمكتب وليس مستنداً ضريبياً.';

const MAX_AMOUNT_INPUT_LENGTH = 32;
const MAX_PIASTRE_AMOUNT = 10_000_000_000_000_000n;

function createClientIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pure BigInt parser matching server parseEgpToPiastres without floats. */
function tryParseEgpToPiastres(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_AMOUNT_INPUT_LENGTH) return null;
  let normalized = normalizeArabicDigits(trimmed)
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, ',');

  if (/^[1-9]\d{0,2}(,\d{3})+(\.\d{1,2})?$/.test(normalized)) {
    normalized = normalized.replace(/,/g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [whole, frac = ''] = normalized.split('.');
  const piastres = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return piastres > 0n && piastres <= MAX_PIASTRE_AMOUNT ? piastres : null;
}

function formatPiastresToInputEgp(piastresStr: string): string {
  const val = BigInt(piastresStr || '0');
  const whole = val / 100n;
  const frac = val % 100n;
  return frac === 0n ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

function formatEgpNumber(piastresInput: bigint | string): string {
  const val = typeof piastresInput === 'bigint' ? piastresInput : BigInt(piastresInput || '0');
  const neg = val < 0n;
  const abs = neg ? -val : val;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = frac > 0n ? `.${frac.toString().padStart(2, '0')}` : '';
  return `${neg ? '-' : ''}${grouped}${fracStr}`;
}

function formatEgp(piastresInput: bigint | string): string {
  return `${formatEgpNumber(piastresInput)} ج.م.`;
}

function EgpAmount({ piastres }: { piastres: bigint | string }) {
  return (
    <span className="whitespace-nowrap">
      <bdi dir="ltr">{formatEgpNumber(piastres)}</bdi> <span>ج.م.</span>
    </span>
  );
}

function isAuthErrorResponse(status: number, code?: string): boolean {
  return (
    status === 401 ||
    code === 'UNAUTHENTICATED' ||
    code === 'SESSION_EXPIRED' ||
    code === 'MFA_REQUIRED'
  );
}

interface DraftInstallmentRow {
  key: string;
  description: string;
  dueDate: string;
  amountEgp: string;
}

interface FinanceWorkspaceProps {
  initialOverview: FinanceOverviewDTO;
  lockedMatterId?: string;
  isReadOnly?: boolean;
  canWriteFinance: boolean;
  headingLevel?: 'h2' | 'h3';
  onDataChanged?: () => void;
}

export function FinanceWorkspace({
  initialOverview,
  lockedMatterId,
  isReadOnly = false,
  canWriteFinance,
  headingLevel = 'h2',
  onDataChanged,
}: FinanceWorkspaceProps) {
  const SectionHeading = headingLevel;
  const SubHeading = headingLevel === 'h2' ? 'h3' : 'h4';
  const defaultDate = getCairoTodayDateString();

  const [overview, setOverview] = useState<FinanceOverviewDTO>(initialOverview);
  const prevInitialOverviewRef = useRef(initialOverview);
  useEffect(() => {
    if (initialOverview !== prevInitialOverviewRef.current) {
      prevInitialOverviewRef.current = initialOverview;
      setOverview(initialOverview);
    }
  }, [initialOverview]);

  const [selectedMatterId, setSelectedMatterId] = useState<string>(
    lockedMatterId || initialOverview.selectedMatterSummary?.matterId || ''
  );
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sessionExpired, setSessionExpired] = useState(false);

  // Draft fee agreement form (supports create & DRAFT update)
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [editingAgreementId, setEditingAgreementId] = useState<string | null>(null);
  const [editingAgreementVersion, setEditingAgreementVersion] = useState<number | null>(null);
  const [draftMatterId, setDraftMatterId] = useState<string>(
    lockedMatterId || initialOverview.selectedMatterSummary?.matterId || initialOverview.selectableMatters[0]?.matterId || ''
  );
  const [draftClientId, setDraftClientId] = useState<string>(
    initialOverview.selectableMatters.find(
      (m) =>
        m.matterId ===
        (lockedMatterId || initialOverview.selectedMatterSummary?.matterId || initialOverview.selectableMatters[0]?.matterId)
    )?.clients[0]?.clientMatterPartyId ||
      initialOverview.selectedMatterSummary?.clients[0]?.clientMatterPartyId ||
      ''
  );
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTotalEgp, setDraftTotalEgp] = useState('');
  const [draftDate, setDraftDate] = useState(defaultDate);
  const [draftMethod, setDraftMethod] = useState<FeeChargingMethod>('INSTALLMENTS');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftIdempotencyKey, setDraftIdempotencyKey] = useState(() => createClientIdempotencyKey());
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Approve agreement state
  const [approvingAgreementId, setApprovingAgreementId] = useState<string | null>(null);
  const [approveDate, setApproveDate] = useState(defaultDate);
  const [approveInstallments, setApproveInstallments] = useState<DraftInstallmentRow[]>([]);
  const [approveIdempotencyKey, setApproveIdempotencyKey] = useState(() => createClientIdempotencyKey());
  const [isApproving, setIsApproving] = useState(false);

  // Collect fee payment state
  const firstCharge = initialOverview.openCharges[0] ?? null;
  const [payMatterId, setPayMatterId] = useState<string>(
    lockedMatterId ||
      initialOverview.selectedMatterSummary?.matterId ||
      firstCharge?.matterId ||
      initialOverview.selectableMatters[0]?.matterId ||
      ''
  );
  const [payClientId, setPayClientId] = useState<string>(
    firstCharge?.clientMatterPartyId ||
      initialOverview.selectedMatterSummary?.clients[0]?.clientMatterPartyId ||
      ''
  );
  const [payDate, setPayDate] = useState(defaultDate);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [payAmountEgp, setPayAmountEgp] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payDescription, setPayDescription] = useState('');
  const [chargeAllocations, setChargeAllocations] = useState<Record<string, string>>({});
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => createClientIdempotencyKey());
  const [frozenPaymentPayload, setFrozenPaymentPayload] = useState<Record<string, unknown> | null>(null);
  const [isPostingPayment, setIsPostingPayment] = useState(false);

  // Statement & Receipt modal state
  const [statementClientKey, setStatementClientKey] = useState<string>('');
  const [loadedStatement, setLoadedStatement] = useState<ClientStatementDTO | null>(null);
  const [isLoadingStatement, setIsLoadingStatement] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptDTO | null>(null);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);

  const errorBannerRef = useRef<HTMLDivElement>(null);
  const receiptModalRef = useRef<HTMLDivElement>(null);
  const closeReceiptBtnRef = useRef<HTMLButtonElement>(null);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const overviewGenRef = useRef(0);
  const statementGenRef = useRef(0);
  const receiptGenRef = useRef(0);

  const summary = overview.selectedMatterSummary;
  const effectiveReadOnly = isReadOnly || summary?.matterStatus === 'ARCHIVED';

  const hasUnsavedInput = Boolean(
    (showDraftForm &&
      (draftDescription.trim() || draftTotalEgp.trim() || draftNotes.trim() || editingAgreementId !== null)) ||
      approvingAgreementId !== null ||
      payAmountEgp.trim() ||
      payReference.trim() ||
      payDescription.trim() ||
      Object.values(chargeAllocations).some((v) => v.trim() !== '') ||
      frozenPaymentPayload !== null
  );

  useLeaveGuard(
    hasUnsavedInput,
    isPostingPayment || isApproving || isSavingDraft || Boolean(frozenPaymentPayload)
  );

  useAccessibleModal({
    isOpen: Boolean(activeReceipt),
    hasPending: false,
    onClose: () => {
      setActiveReceipt(null);
    },
    dialogRef: receiptModalRef,
    initialFocusRef: closeReceiptBtnRef,
    returnFocusRef: lastFocusRef,
  });

  const focusFirstErrorTarget = (errors: Record<string, string>) => {
    requestAnimationFrame(() => {
      for (const key of Object.keys(errors)) {
        const directEl = document.getElementById(key);
        if (directEl) {
          directEl.scrollIntoView({ block: 'nearest' });
          directEl.focus();
          return;
        }
      }
      errorBannerRef.current?.scrollIntoView({ block: 'nearest' });
      errorBannerRef.current?.focus();
    });
  };

  const refreshOverview = async (
    matterFilter: string,
    activeStatementClientId: string | null = loadedStatement?.scope.clientMatterPartyId ?? null
  ) => {
    const gen = ++overviewGenRef.current;
    setIsLoadingOverview(true);
    setActionError(null);
    try {
      const qs = matterFilter ? `?matterId=${encodeURIComponent(matterFilter)}` : '';
      const res = await fetch(`/api/finance${qs}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (gen !== overviewGenRef.current) return;

      if (isAuthErrorResponse(res.status, json?.code)) {
        setSessionExpired(true);
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
        setActionError('انتهت الجلسة. يرجى تسجيل الدخول في نافذة جديدة ثم إعادة المحاولة.');
        return;
      }
      if (!res.ok || !json?.success) {
        setActionError(json?.error || 'تعذر تحديث البيانات المالية.');
        return;
      }
      const next = json.data as FinanceOverviewDTO;
      setOverview(next);
      setSessionExpired(false);
      if (!lockedMatterId && next.openCharges.length > 0 && !payMatterId) {
        setPayMatterId(next.openCharges[0].matterId);
        setPayClientId(next.openCharges[0].clientMatterPartyId);
      }
      if (activeStatementClientId) {
        const stmtGen = ++statementGenRef.current;
        const stmtRes = await fetch(
          `/api/finance/statement?clientMatterPartyId=${encodeURIComponent(activeStatementClientId)}`,
          { cache: 'no-store' }
        );
        const stmtJson = await stmtRes.json().catch(() => null);
        if (gen !== overviewGenRef.current || stmtGen !== statementGenRef.current) return;

        if (isAuthErrorResponse(stmtRes.status, stmtJson?.code)) {
          setSessionExpired(true);
          setLoadedStatement(null);
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
          setActionError('انتهت الجلسة أثناء تحديث كشف الحساب. يرجى تسجيل الدخول في نافذة جديدة.');
          return;
        }
        if (stmtRes.ok && stmtJson?.success) {
          setLoadedStatement(stmtJson.data as ClientStatementDTO);
        } else {
          setLoadedStatement(null);
          setActionError(stmtJson?.error || 'تعذر تحديث كشف حساب الموكل.');
        }
      }
    } catch {
      if (gen === overviewGenRef.current) {
        setActionError('تعذر الاتصال بالخادم لتحديث البيانات المالية.');
      }
    } finally {
      if (gen === overviewGenRef.current) {
        setIsLoadingOverview(false);
      }
    }
  };

  const matterOptions = useMemo(() => {
    if (!summary || overview.selectableMatters.some((m) => m.matterId === summary.matterId)) {
      return overview.selectableMatters;
    }
    return [
      {
        matterId: summary.matterId,
        fileCode: summary.matterFileCode,
        title: summary.matterTitle,
        status: summary.matterStatus,
        clients: summary.clients,
      },
      ...overview.selectableMatters,
    ];
  }, [overview.selectableMatters, summary]);

  const activeTotals = summary
    ? {
        feesChargedPiastres: summary.feesChargedPiastres,
        feesCollectedPiastres: summary.feesCollectedPiastres,
        feesDuePiastres: summary.feesDuePiastres,
        expensesDuePiastres: summary.expensesDuePiastres,
        advanceAvailablePiastres: summary.advanceAvailablePiastres,
      }
    : overview.totals;

  const agreements = summary ? summary.agreements : overview.agreements;
  const allOpenCharges: FeeChargeDTO[] = summary
    ? summary.charges.filter((c) => BigInt(c.remainingPiastres) > 0n)
    : overview.openCharges;
  const transactions: TransactionDTO[] = summary ? summary.transactions : overview.recentTransactions;

  const effectivePayMatterId = lockedMatterId || payMatterId;
  const payMatterOption = matterOptions.find((m) => m.matterId === effectivePayMatterId);
  const payMatterClients =
    payMatterOption?.clients ??
    (summary && summary.matterId === effectivePayMatterId ? summary.clients : []);
  const payEligibleCharges = allOpenCharges.filter(
    (c) =>
      (!effectivePayMatterId || c.matterId === effectivePayMatterId) &&
      (!payClientId || c.clientMatterPartyId === payClientId)
  );

  const editingAgreement = editingAgreementId
    ? agreements.find((a) => a.id === editingAgreementId) ?? null
    : null;
  const draftMatterClients = useMemo(() => {
    const fromOption = matterOptions.find((m) => m.matterId === draftMatterId)?.clients;
    if (fromOption && fromOption.length > 0) return fromOption;
    if (summary && summary.matterId === draftMatterId && summary.clients.length > 0) {
      return summary.clients;
    }
    if (editingAgreement && editingAgreement.matterId === draftMatterId) {
      return [
        {
          clientMatterPartyId: editingAgreement.clientMatterPartyId,
          partyId: editingAgreement.clientPartyId,
          partyName: editingAgreement.clientName,
          isPrimaryContact: true,
          billingEnabled: true,
        },
      ];
    }
    return [];
  }, [matterOptions, draftMatterId, summary, editingAgreement]);

  const resetDraftFormState = () => {
    setShowDraftForm(false);
    setEditingAgreementId(null);
    setEditingAgreementVersion(null);
    setDraftDescription('');
    setDraftTotalEgp('');
    setDraftDate(getCairoTodayDateString());
    setDraftNotes('');
    setDraftIdempotencyKey(createClientIdempotencyKey());
  };

  const openEditDraftForm = (ag: FeeAgreementDTO) => {
    setEditingAgreementId(ag.id);
    setEditingAgreementVersion(ag.version);
    setDraftMatterId(ag.matterId);
    setDraftClientId(ag.clientMatterPartyId);
    setDraftDescription(ag.description);
    setDraftTotalEgp(formatPiastresToInputEgp(ag.totalAmountPiastres));
    setDraftDate(ag.agreementDate);
    setDraftMethod(ag.chargingMethod);
    setDraftNotes(ag.notes || '');
    setDraftIdempotencyKey(createClientIdempotencyKey());
    setShowDraftForm(true);
    setFieldErrors({});
    setActionError(null);
    setActionNotice(null);
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFinance || effectiveReadOnly || isSavingDraft) return;
    setActionError(null);
    setActionNotice(null);
    setFieldErrors({});

    const nextErrors: Record<string, string> = {};
    if (!draftMatterId) {
      nextErrors['draft-matter-select'] = 'يرجى اختيار ملف القضية.';
    }
    if (!draftClientId) {
      nextErrors['draft-client-select'] = 'يرجى اختيار الموكل المسؤول.';
    }
    if (!draftDescription.trim()) {
      nextErrors['draft-description-input'] = 'يرجى إدخال بيان أو وصف اتفاق الأتعاب.';
    }
    const parsedTotal = tryParseEgpToPiastres(draftTotalEgp);
    if (!parsedTotal) {
      nextErrors['draft-total-egp-input'] = 'يرجى إدخال مبلغ أتعاب صحيح وموجب بالجنيه المصري.';
    }
    if (!draftDate.trim()) {
      nextErrors['draft-date-input'] = 'يرجى تحديد تاريخ الاتفاق.';
    }
    if (Object.keys(nextErrors).length > 0 || !parsedTotal) {
      setFieldErrors(nextErrors);
      setActionError('يرجى مراجعة الحقول المطلوبة في نموذج اتفاق الأتعاب.');
      focusFirstErrorTarget(nextErrors);
      return;
    }

    setIsSavingDraft(true);
    try {
      const res = await fetch('/api/finance/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingAgreementId !== null && editingAgreementVersion !== null
            ? {
                feeAgreementId: editingAgreementId,
                expectedVersion: editingAgreementVersion,
              }
            : {}),
          matterId: draftMatterId,
          clientMatterPartyId: draftClientId,
          description: draftDescription.trim(),
          totalAmountPiastres: parsedTotal.toString(),
          agreementDate: draftDate,
          chargingMethod: draftMethod,
          notes: draftNotes.trim() || null,
          idempotencyKey: draftIdempotencyKey,
        }),
      });
      const json = await res.json().catch(() => null);
      if (isAuthErrorResponse(res.status, json?.code)) {
        setSessionExpired(true);
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
        setActionError('انتهت الجلسة. افتح صفحة تسجيل الدخول وأعد المحاولة دون فقدان البيانات.');
        return;
      }
      if (!res.ok || !json?.success) {
        if (res.status < 500 && !isUncertainMutationOutcome(json?.code)) {
          setDraftIdempotencyKey(createClientIdempotencyKey());
        }
        const mappedErrors: Record<string, string> = {};
        const srvErrors = json?.fieldErrors as Record<string, string> | undefined;
        if (srvErrors) {
          if (srvErrors.matterId) mappedErrors['draft-matter-select'] = srvErrors.matterId;
          if (srvErrors.clientMatterPartyId) mappedErrors['draft-client-select'] = srvErrors.clientMatterPartyId;
          if (srvErrors.description) mappedErrors['draft-description-input'] = srvErrors.description;
          if (srvErrors.totalAmountPiastres) mappedErrors['draft-total-egp-input'] = srvErrors.totalAmountPiastres;
          if (srvErrors.agreementDate) mappedErrors['draft-date-input'] = srvErrors.agreementDate;
          if (srvErrors.chargingMethod) mappedErrors['draft-method-select'] = srvErrors.chargingMethod;
          if (srvErrors.notes) mappedErrors['draft-notes-input'] = srvErrors.notes;
        }
        setFieldErrors(mappedErrors);
        setActionError(json?.error || 'تعذر حفظ مسودة اتفاق الأتعاب.');
        focusFirstErrorTarget(mappedErrors);
        return;
      }
      setSessionExpired(false);
      setActionNotice(
        editingAgreementId !== null
          ? 'تم تحديث مسودة اتفاق الأتعاب بنجاح (بلا أثر مالي حتى الاعتماد).'
          : 'تم حفظ مسودة اتفاق الأتعاب بنجاح (بلا أثر مالي حتى الاعتماد).'
      );
      resetDraftFormState();
      await refreshOverview(selectedMatterId);
      onDataChanged?.();
    } catch {
      setActionError('انقطع الاتصال أثناء حفظ مسودة الاتفاق. أعد المحاولة بنفس البيانات دون تكرار.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const openApprovePanel = (ag: FeeAgreementDTO) => {
    setApprovingAgreementId(ag.id);
    setApproveDate(getCairoTodayDateString());
    setApproveIdempotencyKey(createClientIdempotencyKey());
    setApproveInstallments([
      {
        key: createClientIdempotencyKey(),
        description: ag.description,
        dueDate: ag.agreementDate,
        amountEgp: formatPiastresToInputEgp(ag.totalAmountPiastres),
      },
    ]);
    setFieldErrors({});
    setActionError(null);
    setActionNotice(null);
  };

  const approveInstallmentsLive = useMemo(() => {
    let sum = 0n;
    let hasInvalid = false;
    for (const row of approveInstallments) {
      if (!row.amountEgp.trim()) {
        hasInvalid = true;
        continue;
      }
      const parsed = tryParseEgpToPiastres(row.amountEgp);
      if (!parsed) {
        hasInvalid = true;
      } else {
        sum += parsed;
      }
    }
    return { sum, hasInvalid };
  }, [approveInstallments]);

  const handleApproveAgreement = async (ag: FeeAgreementDTO) => {
    if (!canWriteFinance || effectiveReadOnly || isApproving) return;
    setActionError(null);
    setActionNotice(null);
    setFieldErrors({});

    const parsedRows: Array<{ description: string; dueDate: string | null; amountPiastres: string }> = [];
    const nextErrors: Record<string, string> = {};
    let sum = 0n;
    for (const row of approveInstallments) {
      if (!row.description.trim()) {
        nextErrors[`inst-desc-${row.key}`] = 'وصف البند مطلوب';
      }
      const amt = tryParseEgpToPiastres(row.amountEgp);
      if (!amt) {
        nextErrors[`inst-amt-${row.key}`] = 'أدخل مبلغاً صحيحاً وموجباً';
      }
      if (amt && row.description.trim()) {
        sum += amt;
        parsedRows.push({
          description: row.description.trim(),
          dueDate: row.dueDate.trim() || null,
          amountPiastres: amt.toString(),
        });
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setActionError('يجب أن يحتوي كل قسط على وصف صحيح ومبلغ موجب.');
      focusFirstErrorTarget(nextErrors);
      return;
    }

    if (sum !== BigInt(ag.totalAmountPiastres)) {
      setActionError(
        `مجموع الأقساط (${formatEgp(sum)}) يجب أن يساوي إجمالي الاتفاق (${formatEgp(ag.totalAmountPiastres)}).`
      );
      focusFirstErrorTarget({});
      return;
    }

    setIsApproving(true);
    try {
      const res = await fetch(`/api/finance/agreements/${ag.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeAgreementId: ag.id,
          expectedVersion: ag.version,
          transactionDate: approveDate,
          installments: parsedRows,
          idempotencyKey: approveIdempotencyKey,
        }),
      });
      const json = await res.json().catch(() => null);
      if (isAuthErrorResponse(res.status, json?.code)) {
        setSessionExpired(true);
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
        setActionError('انتهت الجلسة أثناء اعتماد الاتفاق. سجل الدخول وأعد المحاولة بنفس الطلب.');
        return;
      }
      if (!res.ok || !json?.success) {
        if (res.status < 500 && !isUncertainMutationOutcome(json?.code)) {
          setApproveIdempotencyKey(createClientIdempotencyKey());
        }
        const mappedErrors: Record<string, string> = {};
        if (json?.fieldErrors?.transactionDate) {
          mappedErrors['approve-tx-date'] = json.fieldErrors.transactionDate;
        }
        setFieldErrors(mappedErrors);
        setActionError(json?.error || 'تعذر اعتماد اتفاق الأتعاب.');
        focusFirstErrorTarget(mappedErrors);
        return;
      }
      setSessionExpired(false);
      setActionNotice(`تم اعتماد اتفاق الأتعاب وترحيل ${parsedRows.length} استحقاق مالي متوازن.`);
      setApprovingAgreementId(null);
      setPayMatterId(ag.matterId);
      setPayClientId(ag.clientMatterPartyId);
      setChargeAllocations({});
      await refreshOverview(selectedMatterId);
      onDataChanged?.();
    } catch {
      setActionError('انقطع الاتصال أثناء اعتماد الاتفاق. يمكنك إعادة المحاولة بنفس الطلب دون تكرار.');
    } finally {
      setIsApproving(false);
    }
  };

  // Compute current payment & live pre-save preview using BigInt only
  const parsedPaymentAmount = tryParseEgpToPiastres(payAmountEgp);
  const invalidAllocationChargeIds: string[] = [];
  const overAllocatedChargeIds: string[] = [];
  const resolvedAllocations: Array<{ feeChargeId: string; amountPiastres: bigint }> = [];
  let hasExplicitAllocationInput = false;

  for (const ch of payEligibleCharges) {
    const rawAlloc = chargeAllocations[ch.id];
    if (rawAlloc !== undefined && rawAlloc.trim() !== '') {
      hasExplicitAllocationInput = true;
      const parsedAlloc = tryParseEgpToPiastres(rawAlloc);
      if (!parsedAlloc) {
        invalidAllocationChargeIds.push(ch.id);
      } else {
        resolvedAllocations.push({ feeChargeId: ch.id, amountPiastres: parsedAlloc });
        if (parsedAlloc > BigInt(ch.remainingPiastres)) {
          overAllocatedChargeIds.push(ch.id);
        }
      }
    }
  }

  if (
    payEligibleCharges.length === 1 &&
    !(payEligibleCharges[0].id in chargeAllocations) &&
    parsedPaymentAmount !== null
  ) {
    const singleCh = payEligibleCharges[0];
    resolvedAllocations.push({
      feeChargeId: singleCh.id,
      amountPiastres: parsedPaymentAmount,
    });
    if (parsedPaymentAmount > BigInt(singleCh.remainingPiastres)) {
      overAllocatedChargeIds.push(singleCh.id);
    }
  }

  const effectiveAllocTotal = resolvedAllocations.reduce((acc, a) => acc + a.amountPiastres, 0n);
  const totalEligibleDue = payEligibleCharges.reduce(
    (acc, ch) => acc + BigInt(ch.remainingPiastres),
    0n
  );
  const previewRemainingAfter =
    parsedPaymentAmount !== null ? totalEligibleDue - parsedPaymentAmount : null;

  const submitPaymentRequest = async (payload: Record<string, unknown>) => {
    setIsPostingPayment(true);
    setActionError(null);
    setActionNotice(null);
    setFieldErrors({});
    try {
      const res = await fetch('/api/finance/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (isAuthErrorResponse(res.status, json?.code)) {
        setSessionExpired(true);
        setFrozenPaymentPayload(payload);
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
        setActionError('انتهت الجلسة. يرجى تسجيل الدخول في نافذة جديدة ثم إعادة المحاولة بنفس المفتاح.');
        return;
      }
      if (!res.ok || !json?.success) {
        if (res.status >= 500 || isUncertainMutationOutcome(json?.code)) {
          setFrozenPaymentPayload(payload);
        } else {
          // Validation / over-allocation error: release frozen payload so user can fix input with a fresh key
          setFrozenPaymentPayload(null);
          setPaymentIdempotencyKey(createClientIdempotencyKey());
          const mappedErrors: Record<string, string> = {};
          const srvErrors = json?.fieldErrors as Record<string, string> | undefined;
          if (srvErrors) {
            if (srvErrors.matterId) mappedErrors['pay-matter-select'] = srvErrors.matterId;
            if (srvErrors.clientMatterPartyId) mappedErrors['pay-client-select'] = srvErrors.clientMatterPartyId;
            if (srvErrors.totalAmountPiastres) mappedErrors['pay-amount-egp-input'] = srvErrors.totalAmountPiastres;
            if (srvErrors.paymentMethod) mappedErrors['pay-method-select'] = srvErrors.paymentMethod;
            if (srvErrors.transactionDate) mappedErrors['pay-date-input'] = srvErrors.transactionDate;
            if (srvErrors.reference) mappedErrors['pay-reference-input'] = srvErrors.reference;
            if (srvErrors.description) mappedErrors['pay-description-input'] = srvErrors.description;
          }
          setFieldErrors(mappedErrors);
          focusFirstErrorTarget(mappedErrors);
        }
        setActionError(json?.error || 'تعذر تسجيل الدفعة المالية.');
        return;
      }

      const data = json.data as { receipt: ReceiptDTO; matterSummary: { feesDuePiastres: string } };
      setSessionExpired(false);
      setFrozenPaymentPayload(null);
      setPaymentIdempotencyKey(createClientIdempotencyKey());
      setPayAmountEgp('');
      setPayReference('');
      setPayDescription('');
      setPayDate(getCairoTodayDateString());
      setChargeAllocations({});
      setActionNotice(
        `تم تحصيل ${formatEgp(data.receipt.amountPiastres)} وإصدار الإيصال رقم ${data.receipt.receiptNumber}. باقي الأتعاب: ${formatEgp(data.matterSummary.feesDuePiastres)}.`
      );
      receiptGenRef.current += 1;
      setActiveReceipt(data.receipt);
      await refreshOverview(selectedMatterId);
      onDataChanged?.();
    } catch {
      setFrozenPaymentPayload(payload);
      setActionError('انقطع الاتصال قبل تأكيد الحفظ. اضغط "إعادة المحاولة بنفس الطلب" لضمان عدم التكرار.');
    } finally {
      setIsPostingPayment(false);
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFinance || effectiveReadOnly || isPostingPayment) return;

    if (frozenPaymentPayload) {
      await submitPaymentRequest(frozenPaymentPayload);
      return;
    }

    const nextErrors: Record<string, string> = {};
    if (!effectivePayMatterId) {
      nextErrors['pay-matter-select'] = 'يرجى تحديد الملف.';
    }
    if (!payClientId) {
      nextErrors['pay-client-select'] = 'يرجى تحديد الموكل المسؤول.';
    }
    if (!parsedPaymentAmount) {
      nextErrors['pay-amount-egp-input'] = 'يرجى إدخال مبلغ تحصيل صحيح وموجب بالجنيه المصري.';
    }
    if (!payDate.trim()) {
      nextErrors['pay-date-input'] = 'يرجى تحديد تاريخ التحصيل.';
    }
    for (const chId of invalidAllocationChargeIds) {
      nextErrors[`alloc-${chId}`] = 'قيمة توزيع غير صالحة';
    }
    for (const chId of overAllocatedChargeIds) {
      nextErrors[`alloc-${chId}`] = 'تتجاوز الرصيد المتبقي للبند';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setActionError(
        invalidAllocationChargeIds.length > 0
          ? 'يرجى تصحيح قيم التوزيع غير الصالحة على البنود.'
          : overAllocatedChargeIds.length > 0
          ? 'المبلغ الموزع على أحد البنود يتجاوز الرصيد المتبقي المستحق عليه.'
          : 'يرجى استكمال وتصحيح بيانات الدفعة المالية.'
      );
      focusFirstErrorTarget(nextErrors);
      return;
    }

    if (payEligibleCharges.length === 0 || resolvedAllocations.length === 0) {
      setActionError('يرجى تحديد البند أو القسط المخصص له هذه الدفعة.');
      focusFirstErrorTarget({});
      return;
    }
    if (!parsedPaymentAmount || effectiveAllocTotal !== parsedPaymentAmount) {
      setFieldErrors({ 'pay-amount-egp-input': 'لا يطابق مجموع التوزيعات' });
      setActionError(
        `مجموع التوزيع على البنود (${formatEgp(effectiveAllocTotal)}) يجب أن يطابق مبلغ الدفعة (${formatEgp(parsedPaymentAmount ?? 0n)}).`
      );
      focusFirstErrorTarget({ 'pay-amount-egp-input': 'لا يطابق مجموع التوزيعات' });
      return;
    }

    const payload = {
      kind: 'FEE_PAYMENT',
      matterId: effectivePayMatterId,
      clientMatterPartyId: payClientId,
      transactionDate: payDate,
      paymentMethod: payMethod,
      totalAmountPiastres: parsedPaymentAmount.toString(),
      reference: payReference.trim() || null,
      description: payDescription.trim() || 'تحصيل دفعة أتعاب محاماة',
      allocations: resolvedAllocations.map((a) => ({
        feeChargeId: a.feeChargeId,
        amountPiastres: a.amountPiastres.toString(),
      })),
      idempotencyKey: paymentIdempotencyKey,
    };

    lastFocusRef.current = submitBtnRef.current ?? (document.activeElement as HTMLElement | null);
    await submitPaymentRequest(payload);
  };

  const handleOpenReceipt = async (receiptId: string, triggerEl: HTMLElement) => {
    const gen = ++receiptGenRef.current;
    lastFocusRef.current = triggerEl;
    setIsLoadingReceipt(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/finance/receipts/${encodeURIComponent(receiptId)}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (gen !== receiptGenRef.current) return;

      if (isAuthErrorResponse(res.status, json?.code)) {
        setSessionExpired(true);
        setActiveReceipt(null);
        setLoadedStatement(null);
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
        setActionError('انتهت الجلسة. يرجى تسجيل الدخول في نافذة جديدة ثم إعادة المحاولة.');
        return;
      }
      if (!res.ok || !json?.success) {
        setActionError(json?.error || 'تعذر تحميل بيانات الإيصال.');
        return;
      }
      setSessionExpired(false);
      setActiveReceipt(json.data as ReceiptDTO);
    } catch {
      if (gen === receiptGenRef.current) {
        setActionError('تعذر الاتصال بالخادم لعرض الإيصال.');
      }
    } finally {
      if (gen === receiptGenRef.current) {
        setIsLoadingReceipt(false);
      }
    }
  };

  const handleLoadClientStatement = async (clientMatterPartyId: string) => {
    const gen = ++statementGenRef.current;
    setStatementClientKey(clientMatterPartyId);
    if (!clientMatterPartyId) {
      setLoadedStatement(null);
      setIsLoadingStatement(false);
      return;
    }
    setIsLoadingStatement(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/finance/statement?clientMatterPartyId=${encodeURIComponent(clientMatterPartyId)}`,
        { cache: 'no-store' }
      );
      const json = await res.json().catch(() => null);
      if (gen !== statementGenRef.current) return;

      if (isAuthErrorResponse(res.status, json?.code)) {
        setSessionExpired(true);
        setLoadedStatement(null);
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
        setActionError('انتهت الجلسة. يرجى تسجيل الدخول في نافذة جديدة ثم إعادة المحاولة.');
        return;
      }
      if (!res.ok || !json?.success) {
        setLoadedStatement(null);
        setActionError(json?.error || 'تعذر تحميل كشف حساب الموكل.');
        return;
      }
      setSessionExpired(false);
      setLoadedStatement(json.data as ClientStatementDTO);
    } catch {
      if (gen === statementGenRef.current) {
        setActionError('تعذر الاتصال لتحميل كشف حساب الموكل.');
      }
    } finally {
      if (gen === statementGenRef.current) {
        setIsLoadingStatement(false);
      }
    }
  };

  return (
    <div className="space-y-6" data-testid="finance-workspace">
      {/* Scope Filter Bar */}
      {!lockedMatterId && (
        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full flex-1">
            <label htmlFor="finance-matter-filter" className="text-sm font-bold text-[#172A35]">
              تصفية حسب ملف القضية:
            </label>
            <select
              id="finance-matter-filter"
              data-testid="finance-matter-filter"
              value={selectedMatterId}
              onChange={(e) => {
                if (frozenPaymentPayload !== null) {
                  window.alert(
                    'توجد دفعة معلقة لم تتأكد نتيجتها بعد. يرجى إعادة المحاولة أو إلغاء وتعديل الدفعة أولاً.'
                  );
                  return;
                }
                const nextId = e.target.value;
                setSelectedMatterId(nextId);
                setStatementClientKey('');
                setLoadedStatement(null);
                setChargeAllocations({});
                setApprovingAgreementId(null);
                if (nextId) {
                  setPayMatterId(nextId);
                  if (editingAgreementId === null) {
                    setDraftMatterId(nextId);
                  }
                  const m = matterOptions.find((item) => item.matterId === nextId);
                  const firstCid = m?.clients[0]?.clientMatterPartyId || '';
                  setPayClientId(firstCid);
                  if (editingAgreementId === null) {
                    setDraftClientId(firstCid);
                  }
                }
                void refreshOverview(nextId, null);
              }}
              className="w-full sm:w-auto max-w-full min-w-0 px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            >
              <option value="">كل الملفات النشطة</option>
              {matterOptions.map((m) => (
                <option key={m.matterId} value={m.matterId}>
                  {m.fileCode} — {m.title}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void refreshOverview(selectedMatterId)}
            disabled={isLoadingOverview}
            aria-busy={isLoadingOverview}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-[#14566B] bg-[#F4F6F7] hover:bg-[#E8EEF1] border border-[#D5DFE3] rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <IconRefresh className="w-4 h-4" />
            <span>{isLoadingOverview ? 'جارٍ التحديث...' : 'تحديث الحسابات'}</span>
          </button>
        </div>
      )}

      {/* Alerts */}
      {actionError && (
        <div
          ref={errorBannerRef}
          tabIndex={-1}
          role="alert"
          data-testid="finance-error-banner"
          className="p-3.5 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-sm font-semibold flex flex-wrap items-center justify-between gap-2 print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
        >
          <span>{actionError}</span>
          <div className="flex flex-wrap items-center gap-2">
            {sessionExpired && (
              <NextLink
                href="/login"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 bg-[#14566B] text-white rounded-[6px] min-h-[44px] inline-flex items-center text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
              >
                تسجيل الدخول في نافذة جديدة
              </NextLink>
            )}
            {frozenPaymentPayload && (
              <>
                <button
                  type="button"
                  data-testid="retry-payment-button"
                  disabled={isPostingPayment}
                  aria-busy={isPostingPayment}
                  onClick={(e) => {
                    lastFocusRef.current = e.currentTarget;
                    void submitPaymentRequest(frozenPaymentPayload);
                  }}
                  className="px-3 py-2 bg-amber-700 hover:bg-amber-800 text-white text-sm font-bold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  إعادة المحاولة بنفس الطلب (دون تكرار)
                </button>
                <button
                  type="button"
                  data-testid="cancel-frozen-payment-button"
                  disabled={isPostingPayment}
                  onClick={() => {
                    if (
                      window.confirm(
                        'قد تكون الدفعة السابقة قيد المعالجة أو نُفذت على الخادم. هل تريد فعلاً إلغاء إعادة المحاولة وتعديل البيانات بمفتاح طلب جديد؟'
                      )
                    ) {
                      setFrozenPaymentPayload(null);
                      setPaymentIdempotencyKey(createClientIdempotencyKey());
                      setActionError(null);
                    }
                  }}
                  className="px-3 py-2 bg-white hover:bg-red-100 border border-red-300 text-[#A4262C] text-sm font-bold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  إلغاء وتعديل الدفعة
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {actionNotice && (
        <div
          role="status"
          data-testid="finance-success-banner"
          className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-sm font-semibold flex items-center gap-2 print:hidden"
        >
          <IconCheck className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* 1. S11 Three Separate Financial Sections */}
      <section aria-label="ملخص الأرصدة المالية" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          data-testid="finance-card-fees"
          className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 shadow-xs space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <SectionHeading className="text-base font-bold text-[#14566B] flex items-center gap-1.5">
              <IconWallet className="w-4 h-4" />
              <span>الأتعاب</span>
            </SectionHeading>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#E9F2F5] text-[#14566B]">
              مفعّل
            </span>
          </div>
          <dl className="space-y-1.5 text-sm pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2 [overflow-wrap:anywhere]">
              <dt className="text-[#4D606A]">المتفق عليه المعتمد:</dt>
              <dd className="font-bold text-[#172A35]" data-testid="fees-charged-value">
                <EgpAmount piastres={activeTotals.feesChargedPiastres} />
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 [overflow-wrap:anywhere]">
              <dt className="text-[#4D606A]">المحصل من الأتعاب:</dt>
              <dd className="font-bold text-emerald-800" data-testid="fees-collected-value">
                <EgpAmount piastres={activeTotals.feesCollectedPiastres} />
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 [overflow-wrap:anywhere] pt-1.5 border-t border-[#E8EEF1]">
              <dt className="font-bold text-[#172A35]">باقي الأتعاب المستحق:</dt>
              <dd className="text-base font-bold text-[#14566B]" data-testid="fees-due-value">
                <EgpAmount piastres={activeTotals.feesDuePiastres} />
              </dd>
            </div>
          </dl>
        </div>

        <div
          data-testid="finance-card-expenses"
          className="bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] p-4 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <SectionHeading className="text-base font-bold text-[#172A35]">
              مصاريف القضايا
            </SectionHeading>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 text-[#172A35]">
              قيد التفعيل لاحقاً
            </span>
          </div>
          <p className="text-base font-bold text-[#172A35]" data-testid="expenses-due-value">
            <EgpAmount piastres={activeTotals.expensesDuePiastres} />
          </p>
          <p className="text-sm text-[#4D606A] leading-relaxed">
            مصاريف القضايا القابلة للاسترداد منفصلة تماماً عن الأتعاب وسيتم تفعيل تسجيلها في مرحلة لاحقة (مصروفات تشغيل المكتب غير مشمولة بالنظام).
          </p>
        </div>

        <div
          data-testid="finance-card-advances"
          className="bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] p-4 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <SectionHeading className="text-base font-bold text-[#172A35]">
              أموال الموكل (العُهد)
            </SectionHeading>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 text-[#172A35]">
              قيد التفعيل لاحقاً
            </span>
          </div>
          <p className="text-base font-bold text-[#172A35]" data-testid="advances-available-value">
            <EgpAmount piastres={activeTotals.advanceAvailablePiastres} />
          </p>
          <p className="text-sm text-[#4D606A] leading-relaxed">
            أمانات الصرف المخصصة للقضايا تبقى منفصلة ولا تُحتسب إيراداً أو أتعاباً، وسيتم تفعيلها في مرحلة لاحقة.
          </p>
        </div>
      </section>

      {/* 2. Fee Agreements Section */}
      <section className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E8EEF1]">
          <div>
            <SectionHeading className="text-base font-bold text-[#172A35]">
              اتفاقات الأتعاب والأقساط المعتمدة
            </SectionHeading>
            <p className="text-sm text-[#4D606A]">
              حفظ الاتفاق كمسودة لا ينشئ مديونية؛ اعتماد الاتفاق يرحّل استحقاقات متوازنة على حساب الموكل.
            </p>
          </div>
          {canWriteFinance && !effectiveReadOnly && (
            <button
              type="button"
              data-testid="toggle-draft-agreement-button"
              aria-expanded={showDraftForm}
              onClick={() => {
                if (showDraftForm) {
                  resetDraftFormState();
                } else {
                  setEditingAgreementId(null);
                  setEditingAgreementVersion(null);
                  setDraftDescription('');
                  setDraftTotalEgp('');
                  setDraftNotes('');
                  setDraftDate(getCairoTodayDateString());
                  setDraftIdempotencyKey(createClientIdempotencyKey());
                  setFieldErrors({});
                  setShowDraftForm(true);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
            >
              <IconPlus className="w-4 h-4" />
              <span>{showDraftForm ? 'إخفاء نموذج الاتفاق' : 'اتفاق أتعاب جديد (مسودة)'}</span>
            </button>
          )}
        </div>

        {showDraftForm && canWriteFinance && !effectiveReadOnly && (
          <form
            onSubmit={handleSaveDraft}
            data-testid="draft-agreement-form"
            className="p-4 bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] space-y-4 print:hidden"
          >
            <SubHeading className="text-sm font-bold text-[#14566B]">
              {editingAgreementId !== null ? 'تعديل مسودة اتفاق الأتعاب' : 'إضافة مسودة اتفاق أتعاب جديدة'}
            </SubHeading>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!lockedMatterId && (
                <div className="space-y-1">
                  <label htmlFor="draft-matter-select" className="block text-sm font-bold text-[#172A35]">
                    ملف القضية
                  </label>
                  <select
                    id="draft-matter-select"
                    data-testid="draft-matter-select"
                    required
                    value={draftMatterId}
                    aria-invalid={Boolean(fieldErrors['draft-matter-select'])}
                    aria-describedby={fieldErrors['draft-matter-select'] ? 'draft-matter-select-error' : undefined}
                    onChange={(e) => {
                      const nextM = e.target.value;
                      setDraftMatterId(nextM);
                      const m = matterOptions.find((item) => item.matterId === nextM);
                      setDraftClientId(m?.clients[0]?.clientMatterPartyId || '');
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  >
                    <option value="">-- اختر ملف القضية --</option>
                    {matterOptions.map((m) => (
                      <option key={m.matterId} value={m.matterId}>
                        {m.fileCode} — {m.title}
                      </option>
                    ))}
                  </select>
                  {fieldErrors['draft-matter-select'] && (
                    <p id="draft-matter-select-error" role="alert" className="text-xs text-[#A4262C]">
                      {fieldErrors['draft-matter-select']}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="draft-client-select" className="block text-sm font-bold text-[#172A35]">
                  الموكل المسؤول عن السداد
                </label>
                <select
                  id="draft-client-select"
                  data-testid="draft-client-select"
                  required
                  value={draftClientId}
                  aria-invalid={Boolean(fieldErrors['draft-client-select'])}
                  aria-describedby={fieldErrors['draft-client-select'] ? 'draft-client-select-error' : undefined}
                  onChange={(e) => setDraftClientId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                >
                  <option value="">-- اختر الموكل --</option>
                  {draftMatterClients.map((cl) => (
                    <option key={cl.clientMatterPartyId} value={cl.clientMatterPartyId}>
                      {cl.partyName}
                    </option>
                  ))}
                </select>
                {fieldErrors['draft-client-select'] && (
                  <p id="draft-client-select-error" role="alert" className="text-xs text-[#A4262C]">
                    {fieldErrors['draft-client-select']}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1 sm:col-span-1">
                <label htmlFor="draft-description-input" className="block text-sm font-bold text-[#172A35]">
                  بيان / وصف الأتعاب
                </label>
                <input
                  id="draft-description-input"
                  data-testid="draft-description-input"
                  type="text"
                  required
                  value={draftDescription}
                  aria-invalid={Boolean(fieldErrors['draft-description-input'])}
                  aria-describedby={
                    fieldErrors['draft-description-input'] ? 'draft-description-input-error' : undefined
                  }
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="مثال: أتعاب الدعوى الابتدائية والاستئناف"
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                />
                {fieldErrors['draft-description-input'] && (
                  <p id="draft-description-input-error" role="alert" className="text-xs text-[#A4262C]">
                    {fieldErrors['draft-description-input']}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="draft-total-egp-input" className="block text-sm font-bold text-[#172A35]">
                  إجمالي الأتعاب المتفق عليها (ج.م.)
                </label>
                <input
                  id="draft-total-egp-input"
                  data-testid="draft-total-egp-input"
                  type="text"
                  dir="ltr"
                  inputMode="decimal"
                  required
                  value={draftTotalEgp}
                  aria-invalid={Boolean(fieldErrors['draft-total-egp-input'])}
                  aria-describedby={
                    fieldErrors['draft-total-egp-input'] ? 'draft-total-egp-input-error' : undefined
                  }
                  onChange={(e) => setDraftTotalEgp(e.target.value)}
                  placeholder="15000"
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                />
                {fieldErrors['draft-total-egp-input'] && (
                  <p id="draft-total-egp-input-error" role="alert" className="text-xs text-[#A4262C]">
                    {fieldErrors['draft-total-egp-input']}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="draft-date-input" className="block text-sm font-bold text-[#172A35]">
                  تاريخ الاتفاق
                </label>
                <input
                  id="draft-date-input"
                  data-testid="draft-date-input"
                  type="date"
                  dir="ltr"
                  required
                  value={draftDate}
                  aria-invalid={Boolean(fieldErrors['draft-date-input'])}
                  aria-describedby={fieldErrors['draft-date-input'] ? 'draft-date-input-error' : undefined}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                />
                {fieldErrors['draft-date-input'] && (
                  <p id="draft-date-input-error" role="alert" className="text-xs text-[#A4262C]">
                    {fieldErrors['draft-date-input']}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="draft-method-select" className="block text-sm font-bold text-[#172A35]">
                  طريقة احتساب الأتعاب
                </label>
                <select
                  id="draft-method-select"
                  value={draftMethod}
                  aria-invalid={Boolean(fieldErrors['draft-method-select'])}
                  aria-describedby={fieldErrors['draft-method-select'] ? 'draft-method-select-error' : undefined}
                  onChange={(e) => setDraftMethod(e.target.value as FeeChargingMethod)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                >
                  {(Object.keys(CHARGING_METHOD_LABELS) as FeeChargingMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {CHARGING_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
                {fieldErrors['draft-method-select'] && (
                  <p id="draft-method-select-error" role="alert" className="text-xs text-[#A4262C]">
                    {fieldErrors['draft-method-select']}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="draft-notes-input" className="block text-sm font-bold text-[#172A35]">
                  ملاحظات (اختياري)
                </label>
                <input
                  id="draft-notes-input"
                  type="text"
                  value={draftNotes}
                  aria-invalid={Boolean(fieldErrors['draft-notes-input'])}
                  aria-describedby={fieldErrors['draft-notes-input'] ? 'draft-notes-input-error' : undefined}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                />
                {fieldErrors['draft-notes-input'] && (
                  <p id="draft-notes-input-error" role="alert" className="text-xs text-[#A4262C]">
                    {fieldErrors['draft-notes-input']}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {editingAgreementId !== null && (
                <button
                  type="button"
                  data-testid="cancel-edit-draft-button"
                  disabled={isSavingDraft}
                  onClick={resetDraftFormState}
                  className="px-4 py-2 bg-white hover:bg-[#F4F6F7] border border-[#D5DFE3] text-[#172A35] text-sm font-bold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  إلغاء التعديل
                </button>
              )}
              <button
                type="submit"
                data-testid="save-draft-agreement-button"
                disabled={isSavingDraft}
                aria-busy={isSavingDraft}
                className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
              >
                {isSavingDraft
                  ? 'جارٍ الحفظ...'
                  : editingAgreementId !== null
                  ? 'حفظ تعديلات المسودة'
                  : 'حفظ الاتفاق كمسودة'}
              </button>
            </div>
          </form>
        )}

        {agreements.length === 0 ? (
          <p className="text-sm text-[#4D606A] py-2" data-testid="finance-agreements-empty">
            لا توجد اتفاقات أتعاب مسجلة ضمن النطاق الحالي بعد.
          </p>
        ) : (
          <div className="space-y-3">
            {agreements.map((ag) => (
              <div
                key={ag.id}
                data-testid={`fee-agreement-card-${ag.id}`}
                className="p-4 rounded-[6px] border border-[#D5DFE3] bg-[#F9FBFC] space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-base text-[#172A35] [overflow-wrap:anywhere]">
                        {ag.description}
                      </span>
                      <span
                        data-testid={`agreement-status-${ag.id}`}
                        className={`text-xs font-bold px-2 py-0.5 rounded border ${
                          ag.status === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : ag.status === 'DRAFT'
                            ? 'bg-amber-50 text-[#7A4A00] border-amber-200'
                            : 'bg-slate-100 text-[#4D606A] border-slate-300'
                        }`}
                      >
                        {AGREEMENT_STATUS_LABELS[ag.status]}
                      </span>
                    </div>
                    <p className="text-sm text-[#4D606A] [overflow-wrap:anywhere]">
                      <span>الملف: <bdi dir="ltr">{ag.matterFileCode}</bdi></span>
                      <span aria-hidden="true"> • </span>
                      <span>الموكل: {ag.clientName}</span>
                      <span aria-hidden="true"> • </span>
                      <span>التاريخ: <bdi dir="ltr">{ag.agreementDate}</bdi></span>
                      <span aria-hidden="true"> • </span>
                      <span>{CHARGING_METHOD_LABELS[ag.chargingMethod]}</span>
                    </p>
                    {ag.notes && (
                      <p className="text-sm text-[#4D606A] [overflow-wrap:anywhere]">
                        ملاحظات: {ag.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-[#14566B]">
                      <EgpAmount piastres={ag.totalAmountPiastres} />
                    </span>
                    {ag.status === 'DRAFT' && canWriteFinance && !effectiveReadOnly && (
                      <>
                        <button
                          type="button"
                          data-testid={`edit-draft-agreement-${ag.id}`}
                          onClick={() => openEditDraftForm(ag)}
                          className="px-3 py-2 bg-white hover:bg-[#E9F2F5] border border-[#14566B]/40 text-[#14566B] text-sm font-bold rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                        >
                          تعديل المسودة
                        </button>
                        <button
                          type="button"
                          data-testid={`open-approve-agreement-${ag.id}`}
                          aria-expanded={approvingAgreementId === ag.id}
                          onClick={() =>
                            approvingAgreementId === ag.id
                              ? setApprovingAgreementId(null)
                              : openApprovePanel(ag)
                          }
                          className="px-3 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-bold rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                        >
                          {approvingAgreementId === ag.id ? 'إلغاء الاعتماد' : 'اعتماد وترحيل'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Approve Installments Builder */}
                {approvingAgreementId === ag.id && canWriteFinance && !effectiveReadOnly && (
                  <div
                    data-testid={`approve-agreement-panel-${ag.id}`}
                    className="p-3.5 bg-white border border-[#14566B]/30 rounded-[6px] space-y-3 print:hidden"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SubHeading className="text-sm font-bold text-[#14566B]">
                        تحديد استحقاقات / أقساط الاتفاق قبل الاعتماد النهائي
                      </SubHeading>
                      <button
                        type="button"
                        data-testid="add-installment-row-button"
                        onClick={() =>
                          setApproveInstallments((rows) => [
                            ...rows,
                            {
                              key: createClientIdempotencyKey(),
                              description: `قسط #${rows.length + 1}`,
                              dueDate: ag.agreementDate,
                              amountEgp: '',
                            },
                          ])
                        }
                        className="px-3 py-1.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] border border-[#D5DFE3] text-[#172A35] text-sm font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                      >
                        <span aria-hidden="true">+</span> إضافة قسط
                      </button>
                    </div>

                    <div className="space-y-3">
                      {approveInstallments.map((row, idx) => (
                        <div key={row.key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                          <div className="md:col-span-5 space-y-1">
                            <label htmlFor={`inst-desc-${row.key}`} className="block text-sm font-semibold text-[#172A35]">
                              وصف البند #{idx + 1}
                            </label>
                            <input
                              id={`inst-desc-${row.key}`}
                              data-testid={`installment-desc-${idx}`}
                              type="text"
                              value={row.description}
                              aria-invalid={Boolean(fieldErrors[`inst-desc-${row.key}`])}
                              aria-describedby={
                                fieldErrors[`inst-desc-${row.key}`] ? `inst-desc-${row.key}-error` : undefined
                              }
                              onChange={(e) =>
                                setApproveInstallments((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, description: e.target.value } : r))
                                )
                              }
                              className="w-full px-2.5 py-2 border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                            />
                            {fieldErrors[`inst-desc-${row.key}`] && (
                              <p id={`inst-desc-${row.key}-error`} role="alert" className="text-xs text-[#A4262C]">
                                {fieldErrors[`inst-desc-${row.key}`]}
                              </p>
                            )}
                          </div>
                          <div className="md:col-span-3 space-y-1">
                            <label htmlFor={`inst-amt-${row.key}`} className="block text-sm font-semibold text-[#172A35]">
                              المبلغ (ج.م.)
                            </label>
                            <input
                              id={`inst-amt-${row.key}`}
                              data-testid={`installment-amount-${idx}`}
                              type="text"
                              dir="ltr"
                              inputMode="decimal"
                              value={row.amountEgp}
                              aria-invalid={Boolean(fieldErrors[`inst-amt-${row.key}`])}
                              aria-describedby={
                                fieldErrors[`inst-amt-${row.key}`] ? `inst-amt-${row.key}-error` : undefined
                              }
                              onChange={(e) =>
                                setApproveInstallments((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, amountEgp: e.target.value } : r))
                                )
                              }
                              className="w-full px-2.5 py-2 border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                            />
                            {fieldErrors[`inst-amt-${row.key}`] && (
                              <p id={`inst-amt-${row.key}-error`} role="alert" className="text-xs text-[#A4262C]">
                                {fieldErrors[`inst-amt-${row.key}`]}
                              </p>
                            )}
                          </div>
                          <div className="md:col-span-3 space-y-1">
                            <label htmlFor={`inst-due-${row.key}`} className="block text-sm font-semibold text-[#172A35]">
                              تاريخ الاستحقاق
                            </label>
                            <input
                              id={`inst-due-${row.key}`}
                              type="date"
                              dir="ltr"
                              value={row.dueDate}
                              onChange={(e) =>
                                setApproveInstallments((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, dueDate: e.target.value } : r))
                                )
                              }
                              className="w-full px-2.5 py-2 border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                            />
                          </div>
                          <div className="md:col-span-1 flex justify-end">
                            {approveInstallments.length > 1 && (
                              <button
                                type="button"
                                aria-label={`حذف القسط رقم ${idx + 1}`}
                                onClick={() =>
                                  setApproveInstallments((prev) => prev.filter((r) => r.key !== row.key))
                                }
                                className="px-2.5 py-2 text-sm text-[#A4262C] border border-red-200 rounded-[6px] min-h-[44px] min-w-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                              >
                                حذف
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div
                      aria-live="polite"
                      className={`p-2.5 rounded-[6px] border text-sm font-semibold ${
                        !approveInstallmentsLive.hasInvalid &&
                        approveInstallmentsLive.sum === BigInt(ag.totalAmountPiastres)
                          ? 'bg-emerald-50 border-emerald-200 text-[#176449]'
                          : 'bg-amber-50 border-amber-200 text-[#7A4A00]'
                      }`}
                    >
                      مجموع الأقساط المدخل: <EgpAmount piastres={approveInstallmentsLive.sum} /> — المطلوب:{' '}
                      <EgpAmount piastres={ag.totalAmountPiastres} />
                      {approveInstallmentsLive.hasInvalid && ' (أكمل مبالغ الأقساط بقيم موجبة صالحة)'}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E8EEF1]">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <label htmlFor="approve-tx-date" className="font-semibold text-[#172A35]">
                          تاريخ القيد:
                        </label>
                        <input
                          id="approve-tx-date"
                          type="date"
                          dir="ltr"
                          value={approveDate}
                          aria-invalid={Boolean(fieldErrors['approve-tx-date'])}
                          aria-describedby={fieldErrors['approve-tx-date'] ? 'approve-tx-date-error' : undefined}
                          onChange={(e) => setApproveDate(e.target.value)}
                          className="px-2.5 py-1.5 border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                        />
                        {fieldErrors['approve-tx-date'] && (
                          <p id="approve-tx-date-error" role="alert" className="text-xs text-[#A4262C]">
                            {fieldErrors['approve-tx-date']}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        data-testid={`confirm-approve-agreement-${ag.id}`}
                        disabled={isApproving}
                        aria-busy={isApproving}
                        onClick={() => void handleApproveAgreement(ag)}
                        className="px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                      >
                        {isApproving ? 'جارٍ الاعتماد...' : 'تأكيد الاعتماد وترحيل الاستحقاق'}
                      </button>
                    </div>
                  </div>
                )}

                {ag.charges.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {ag.charges.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white rounded border border-[#E8EEF1] text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-[#172A35]">
                            قسط #{ch.installmentNumber}: {ch.description}
                          </span>
                          {ch.dueDate && (
                            <span className="text-[#4D606A] mr-2">
                              (استحقاق: <bdi dir="ltr">{ch.dueDate}</bdi>)
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-[#4D606A]">
                          <span>الأصل: <EgpAmount piastres={ch.amountPiastres} /></span>
                          <span>المسدد: <EgpAmount piastres={ch.allocatedPiastres} /></span>
                          <span className="font-bold text-[#14566B]">
                            المتبقي: <EgpAmount piastres={ch.remainingPiastres} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. Collect Fee Payment Form */}
      {canWriteFinance && !effectiveReadOnly && (
        <section className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 shadow-xs space-y-4 print:hidden">
          <div className="pb-2 border-b border-[#E8EEF1]">
            <SectionHeading className="text-base font-bold text-[#172A35]">
              تسجيل دفعة أتعاب وإصدار إيصال تحصيل
            </SectionHeading>
            <p className="text-sm text-[#4D606A]">
              تُخصص كل دفعة صراحةً لبنود الأتعاب المستحقة للموكل دون تجاوز المديونية.
            </p>
          </div>

          {allOpenCharges.length === 0 ? (
            <p className="text-sm text-[#4D606A]">
              لا توجد بنود أتعاب مستحقة مفتوحة للتحصيل حالياً. اعتمد اتفاق أتعاب أولاً.
            </p>
          ) : (
            <form onSubmit={handleSubmitPayment} data-testid="fee-payment-form" className="space-y-4">
              {frozenPaymentPayload && (
                <div
                  role="status"
                  className="p-3 bg-amber-50 border border-amber-200 text-[#7A4A00] rounded-[6px] text-sm font-semibold flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    الحقول مقفلة مؤقتاً لحماية الطلب المعلق من التكرار. يمكنك إعادة المحاولة أو إلغاء وتعديل الدفعة.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {!lockedMatterId && (
                  <div className="space-y-1">
                    <label htmlFor="pay-matter-select" className="block text-sm font-bold text-[#172A35]">
                      الملف
                    </label>
                    <select
                      id="pay-matter-select"
                      data-testid="pay-matter-select"
                      disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                      value={effectivePayMatterId}
                      aria-invalid={Boolean(fieldErrors['pay-matter-select'])}
                      aria-describedby={fieldErrors['pay-matter-select'] ? 'pay-matter-select-error' : undefined}
                      onChange={(e) => {
                        const nextM = e.target.value;
                        setPayMatterId(nextM);
                        const m = matterOptions.find((item) => item.matterId === nextM);
                        setPayClientId(m?.clients[0]?.clientMatterPartyId || '');
                        setChargeAllocations({});
                        setFrozenPaymentPayload(null);
                      }}
                      className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                    >
                      <option value="">-- اختر الملف --</option>
                      {matterOptions.map((m) => (
                        <option key={m.matterId} value={m.matterId}>
                          {m.fileCode} — {m.title}
                        </option>
                      ))}
                    </select>
                    {fieldErrors['pay-matter-select'] && (
                      <p id="pay-matter-select-error" role="alert" className="text-xs text-[#A4262C]">
                        {fieldErrors['pay-matter-select']}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <label htmlFor="pay-client-select" className="block text-sm font-bold text-[#172A35]">
                    الموكل المدين
                  </label>
                  <select
                    id="pay-client-select"
                    data-testid="pay-client-select"
                    required
                    disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                    value={payClientId}
                    aria-invalid={Boolean(fieldErrors['pay-client-select'])}
                    aria-describedby={fieldErrors['pay-client-select'] ? 'pay-client-select-error' : undefined}
                    onChange={(e) => {
                      setPayClientId(e.target.value);
                      setChargeAllocations({});
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                  >
                    <option value="">-- اختر الموكل --</option>
                    {payMatterClients.map((cl) => (
                      <option key={cl.clientMatterPartyId} value={cl.clientMatterPartyId}>
                        {cl.partyName}
                      </option>
                    ))}
                  </select>
                  {fieldErrors['pay-client-select'] && (
                    <p id="pay-client-select-error" role="alert" className="text-xs text-[#A4262C]">
                      {fieldErrors['pay-client-select']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="pay-amount-egp-input" className="block text-sm font-bold text-[#172A35]">
                    المبلغ المحصل (ج.م.)
                  </label>
                  <input
                    id="pay-amount-egp-input"
                    data-testid="pay-amount-egp-input"
                    type="text"
                    dir="ltr"
                    inputMode="decimal"
                    required
                    disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                    value={payAmountEgp}
                    aria-invalid={Boolean(fieldErrors['pay-amount-egp-input'])}
                    aria-describedby={
                      fieldErrors['pay-amount-egp-input'] ? 'pay-amount-egp-input-error' : undefined
                    }
                    onChange={(e) => {
                      setPayAmountEgp(e.target.value);
                      setFrozenPaymentPayload(null);
                    }}
                    placeholder="5000"
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                  />
                  {fieldErrors['pay-amount-egp-input'] && (
                    <p id="pay-amount-egp-input-error" role="alert" className="text-xs text-[#A4262C]">
                      {fieldErrors['pay-amount-egp-input']}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label htmlFor="pay-method-select" className="block text-sm font-bold text-[#172A35]">
                    طريقة السداد
                  </label>
                  <select
                    id="pay-method-select"
                    data-testid="pay-method-select"
                    disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                    value={payMethod}
                    aria-invalid={Boolean(fieldErrors['pay-method-select'])}
                    aria-describedby={fieldErrors['pay-method-select'] ? 'pay-method-select-error' : undefined}
                    onChange={(e) => {
                      setPayMethod(e.target.value as PaymentMethod);
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                  >
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                  {fieldErrors['pay-method-select'] && (
                    <p id="pay-method-select-error" role="alert" className="text-xs text-[#A4262C]">
                      {fieldErrors['pay-method-select']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="pay-date-input" className="block text-sm font-bold text-[#172A35]">
                    تاريخ التحصيل
                  </label>
                  <input
                    id="pay-date-input"
                    data-testid="pay-date-input"
                    type="date"
                    dir="ltr"
                    required
                    disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                    value={payDate}
                    aria-invalid={Boolean(fieldErrors['pay-date-input'])}
                    aria-describedby={fieldErrors['pay-date-input'] ? 'pay-date-input-error' : undefined}
                    onChange={(e) => {
                      setPayDate(e.target.value);
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                  />
                  {fieldErrors['pay-date-input'] && (
                    <p id="pay-date-input-error" role="alert" className="text-xs text-[#A4262C]">
                      {fieldErrors['pay-date-input']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="pay-reference-input" className="block text-sm font-bold text-[#172A35]">
                    مرجع التحويل / الشيك (اختياري)
                  </label>
                  <input
                    id="pay-reference-input"
                    type="text"
                    disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                    value={payReference}
                    aria-invalid={Boolean(fieldErrors['pay-reference-input'])}
                    aria-describedby={
                      fieldErrors['pay-reference-input'] ? 'pay-reference-input-error' : undefined
                    }
                    onChange={(e) => {
                      setPayReference(e.target.value);
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                  />
                  {fieldErrors['pay-reference-input'] && (
                    <p id="pay-reference-input-error" role="alert" className="text-xs text-[#A4262C]">
                      {fieldErrors['pay-reference-input']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="pay-description-input" className="block text-sm font-bold text-[#172A35]">
                    وصف الدفعة (اختياري)
                  </label>
                  <input
                    id="pay-description-input"
                    data-testid="pay-description-input"
                    type="text"
                    disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                    value={payDescription}
                    aria-invalid={Boolean(fieldErrors['pay-description-input'])}
                    aria-describedby={
                      fieldErrors['pay-description-input'] ? 'pay-description-input-error' : undefined
                    }
                    onChange={(e) => {
                      setPayDescription(e.target.value);
                      setFrozenPaymentPayload(null);
                    }}
                    placeholder="تحصيل دفعة أتعاب محاماة"
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                  />
                  {fieldErrors['pay-description-input'] && (
                    <p id="pay-description-input-error" role="alert" className="text-xs text-[#A4262C]">
                      {fieldErrors['pay-description-input']}
                    </p>
                  )}
                </div>
              </div>

              {/* Explicit Per-Charge Allocation Table */}
              <div className="space-y-2 p-3 bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px]">
                <span className="block text-sm font-bold text-[#172A35]">
                  توزيع الدفعة على بنود الأتعاب المستحقة (إجمالي المفتوح للموكل:{' '}
                  <EgpAmount piastres={totalEligibleDue} />):
                </span>
                {payEligibleCharges.length === 0 ? (
                  <p className="text-sm text-[#4D606A] py-1" data-testid="pay-eligible-charges-empty">
                    لا توجد بنود أتعاب مستحقة مفتوحة للملف والموكل المحددين.
                  </p>
                ) : (
                  payEligibleCharges.map((ch, idx) => (
                    <div
                      key={ch.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white rounded border border-[#E8EEF1] text-sm"
                    >
                      <div className="min-w-0 max-w-full">
                        <span className="font-semibold text-[#172A35] block [overflow-wrap:anywhere]">
                          قسط #{ch.installmentNumber}: {ch.description}
                        </span>
                        <span className="text-[#4D606A]">
                          المتبقي: <EgpAmount piastres={ch.remainingPiastres} />
                          {ch.dueDate && (
                            <>
                              <span aria-hidden="true"> • </span>
                              <span>استحقاق: <bdi dir="ltr">{ch.dueDate}</bdi></span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="flex flex-col items-stretch sm:items-end gap-1 w-full sm:w-auto min-w-0 max-w-full">
                        <label htmlFor={`alloc-${ch.id}`} className="sr-only">
                          مبلغ التوزيع للبند {ch.description}
                        </label>
                        <input
                          id={`alloc-${ch.id}`}
                          data-testid={`allocation-amount-${idx}`}
                          type="text"
                          dir="ltr"
                          inputMode="decimal"
                          disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                          value={
                            ch.id in chargeAllocations
                              ? chargeAllocations[ch.id]
                              : payEligibleCharges.length === 1
                              ? payAmountEgp
                              : ''
                          }
                          aria-invalid={Boolean(fieldErrors[`alloc-${ch.id}`])}
                          aria-describedby={fieldErrors[`alloc-${ch.id}`] ? `alloc-${ch.id}-error` : undefined}
                          onChange={(e) => {
                            const val = e.target.value;
                            setChargeAllocations((prev) => ({ ...prev, [ch.id]: val }));
                            setFrozenPaymentPayload(null);
                          }}
                          placeholder="0"
                          className="w-full sm:w-36 max-w-full min-w-0 px-2.5 py-1.5 border border-[#D5DFE3] rounded-[6px] text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:opacity-60"
                        />
                        {fieldErrors[`alloc-${ch.id}`] && (
                          <p id={`alloc-${ch.id}-error`} role="alert" className="text-xs text-[#A4262C]">
                            {fieldErrors[`alloc-${ch.id}`]}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Mandatory Live Arabic Pre-Save Confirmation Preview */}
              {(parsedPaymentAmount !== null ||
                payEligibleCharges.length === 0 ||
                invalidAllocationChargeIds.length > 0 ||
                overAllocatedChargeIds.length > 0 ||
                hasExplicitAllocationInput) && (
                <div
                  role="region"
                  aria-live="polite"
                  aria-label="معاينة الأثر المالي قبل الحفظ"
                  data-testid="finance-presave-preview"
                  className="p-3.5 bg-teal-50 border border-[#14566B]/30 rounded-[6px] text-sm font-bold text-[#14566B]"
                >
                  {payEligibleCharges.length === 0 ? (
                    <span className="text-[#7A4A00]">
                      تنبيه: لا توجد بنود أتعاب مفتوحة للتوزيع للملف والموكل المحددين.
                    </span>
                  ) : invalidAllocationChargeIds.length > 0 ? (
                    <span className="text-[#A4262C]">
                      تنبيه: توجد قيمة توزيع غير صالحة في أحد بنود الأتعاب أعلاه.
                    </span>
                  ) : overAllocatedChargeIds.length > 0 ? (
                    <span className="text-[#A4262C]">
                      تنبيه: المبلغ الموزع على أحد البنود يتجاوز الرصيد المتبقي المستحق عليه.
                    </span>
                  ) : parsedPaymentAmount !== null && previewRemainingAfter !== null ? (
                    previewRemainingAfter < 0n ? (
                      <span className="text-[#A4262C]">
                        تنبيه: المبلغ المدخل يتجاوز إجمالي الأتعاب المستحقة على الموكل المحدد (
                        <EgpAmount piastres={totalEligibleDue} />) ولن يتم ترحيله كدفعة مقدمة تلقائياً.
                      </span>
                    ) : resolvedAllocations.length > 0 && effectiveAllocTotal !== parsedPaymentAmount ? (
                      <span className="text-[#7A4A00]">
                        تنبيه: مجموع التوزيع على البنود (<EgpAmount piastres={effectiveAllocTotal} />) لا يطابق
                        مبلغ الدفعة (<EgpAmount piastres={parsedPaymentAmount} />).
                      </span>
                    ) : resolvedAllocations.length === 0 ? (
                      <span className="text-[#7A4A00]">
                        يرجى تحديد توزيع المبلغ على بنود الأتعاب المستحقة أعلاه.
                      </span>
                    ) : (
                      <span>
                        معاينة التأكيد: أتعاب <EgpAmount piastres={parsedPaymentAmount} /> — باقي الأتعاب بعد العملية{' '}
                        <EgpAmount piastres={previewRemainingAfter} />
                      </span>
                    )
                  ) : (
                    <span className="text-[#7A4A00]">
                      أدخل مبلغ التحصيل الإجمالي ليتم مطابقته مع توزيعات البنود.
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  ref={submitBtnRef}
                  type="submit"
                  data-testid="submit-payment-button"
                  disabled={isPostingPayment || Boolean(frozenPaymentPayload)}
                  aria-busy={isPostingPayment}
                  className="px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                >
                  {isPostingPayment ? 'جارٍ الترحيل...' : 'حفظ وتسجيل الدفعة وإصدار الإيصال'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* 4. Single-Client Statement View */}
      <section className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E8EEF1]">
          <SectionHeading className="text-base font-bold text-[#172A35]">
            كشف حساب الموكل (الأتعاب)
          </SectionHeading>
          {summary && summary.clients.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full print:hidden">
              <label htmlFor="statement-client-select" className="text-sm font-semibold text-[#4D606A]">
                اختر الموكل:
              </label>
              <select
                id="statement-client-select"
                data-testid="statement-client-select"
                value={statementClientKey}
                onChange={(e) => void handleLoadClientStatement(e.target.value)}
                className="w-full sm:w-auto max-w-full min-w-0 px-2.5 py-1.5 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                <option value="">-- عرض كشف موكل محدد --</option>
                {summary.clients.map((cl) => (
                  <option key={cl.clientMatterPartyId} value={cl.clientMatterPartyId}>
                    {cl.partyName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isLoadingStatement && (
          <p role="status" className="text-sm text-[#4D606A]">
            جارٍ تحميل كشف حساب الموكل...
          </p>
        )}

        {loadedStatement ? (
          <div
            data-testid="client-statement-summary"
            className="p-4 bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] space-y-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-[#172A35]">
              <div className="flex flex-wrap items-center gap-2">
                <span>الموكل: {loadedStatement.scope.partyName || '—'}</span>
                <span className={loadedStatement.reconciled ? 'text-emerald-800' : 'text-[#A4262C]'}>
                  {loadedStatement.reconciled ? 'مطابق حسابياً مع القيود المرحلة' : 'يحتاج مراجعة مطابقة'}
                </span>
              </div>
              <button
                type="button"
                data-testid="close-client-statement-button"
                onClick={() => {
                  setLoadedStatement(null);
                  setStatementClientKey('');
                }}
                className="px-3 py-1.5 bg-white hover:bg-[#E8EEF1] border border-[#D5DFE3] text-[#14566B] text-sm font-semibold rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
              >
                العودة لملخص الموكلين
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                إجمالي الأتعاب: <strong><EgpAmount piastres={loadedStatement.feesChargedPiastres} /></strong>
              </div>
              <div>
                المحصل: <strong><EgpAmount piastres={loadedStatement.feesCollectedPiastres} /></strong>
              </div>
              <div>
                المتبقي المستحق: <strong><EgpAmount piastres={loadedStatement.feesDuePiastres} /></strong>
              </div>
            </div>

            {loadedStatement.charges.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[#E8EEF1]">
                <SubHeading className="text-sm font-bold text-[#172A35]">بنود الأتعاب المستحقة</SubHeading>
                {loadedStatement.charges.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white rounded border border-[#E8EEF1]"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-[#172A35]">
                        قسط #{ch.installmentNumber}: {ch.description}
                      </span>
                      {ch.dueDate && (
                        <span className="text-[#4D606A] mr-2">
                          (استحقاق: <bdi dir="ltr">{ch.dueDate}</bdi>)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[#4D606A]">
                      <span>الأصل: <EgpAmount piastres={ch.amountPiastres} /></span>
                      <span>المسدد: <EgpAmount piastres={ch.allocatedPiastres} /></span>
                      <span className="font-bold text-[#14566B]">
                        المتبقي: <EgpAmount piastres={ch.remainingPiastres} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loadedStatement.transactions.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[#E8EEF1]">
                <SubHeading className="text-sm font-bold text-[#172A35]">حركات وقيود الموكل</SubHeading>
                {loadedStatement.transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white rounded border border-[#E8EEF1]"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#172A35]">
                          {TRANSACTION_KIND_LABELS[tx.kind] || tx.kind}
                        </span>
                        {tx.receiptNumber && (
                          <bdi dir="ltr" className="font-mono text-xs text-[#14566B] bg-[#E9F2F5] px-2 py-0.5 rounded font-bold">
                            {tx.receiptNumber}
                          </bdi>
                        )}
                      </div>
                      <p className="text-[#4D606A] [overflow-wrap:anywhere]">
                        <span>{tx.description}</span>
                        <span aria-hidden="true"> • </span>
                        <span>التاريخ: <bdi dir="ltr">{tx.transactionDate}</bdi></span>
                        {tx.paymentMethod && (
                          <>
                            <span aria-hidden="true"> • </span>
                            <span>{PAYMENT_METHOD_LABELS[tx.paymentMethod]}</span>
                          </>
                        )}
                        {tx.reference && (
                          <>
                            <span aria-hidden="true"> • </span>
                            <span>مرجع: <bdi dir="ltr">{tx.reference}</bdi></span>
                          </>
                        )}
                      </p>
                    </div>
                    <strong className="text-[#14566B]">
                      <EgpAmount piastres={tx.totalAmountPiastres} />
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : summary && summary.clients.length > 0 ? (
          <div className="space-y-2">
            {summary.clients.map((cl) => (
              <div
                key={cl.clientMatterPartyId}
                data-testid={`client-balance-row-${cl.clientMatterPartyId}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#F9FBFC] rounded border border-[#E8EEF1] text-sm"
              >
                <span className="font-bold text-[#172A35]">{cl.partyName}</span>
                <div className="flex flex-wrap items-center gap-3 text-[#4D606A]">
                  <span>المعتمد: <EgpAmount piastres={cl.feesChargedPiastres} /></span>
                  <span>المحصل: <EgpAmount piastres={cl.feesCollectedPiastres} /></span>
                  <span className="font-bold text-[#14566B]">
                    المتبقي: <EgpAmount piastres={cl.feesDuePiastres} />
                  </span>
                  <button
                    type="button"
                    aria-label={`عرض الكشف المفصل للموكل ${cl.partyName}`}
                    onClick={() => void handleLoadClientStatement(cl.clientMatterPartyId)}
                    className="px-2.5 py-1 text-[#14566B] border border-[#14566B]/30 rounded-[6px] font-semibold min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                  >
                    عرض الكشف المفصل
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#4D606A]">
            اختر ملف قضية أعلاه لعرض أرصدة وكشوف الموكلين المشتقة من القيود المرحلة.
          </p>
        )}
      </section>

      {/* 5. Posted Immutable Ledger History */}
      <section className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 shadow-xs space-y-3">
        <SectionHeading className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
          سجل القيود والعمليات المرحلة (غير قابل للتعديل)
        </SectionHeading>

        {transactions.length === 0 ? (
          <p className="text-sm text-[#4D606A]">لا توجد قيود مالية مرحلة بعد.</p>
        ) : (
          <div className="space-y-2.5">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                data-testid={`posted-tx-row-${tx.id}`}
                className="p-3.5 rounded-[6px] border border-[#D5DFE3] bg-[#F9FBFC] space-y-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[#172A35]">
                        {TRANSACTION_KIND_LABELS[tx.kind] || tx.kind}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 text-[#172A35] text-xs font-semibold">
                        مرحّل ومغلق
                      </span>
                      {tx.receiptNumber && (
                        <bdi dir="ltr" className="font-mono text-xs text-[#14566B] bg-[#E9F2F5] px-2 py-0.5 rounded font-bold">
                          {tx.receiptNumber}
                        </bdi>
                      )}
                    </div>
                    <p className="text-[#4D606A] [overflow-wrap:anywhere]">
                      <span>{tx.description}</span>
                      {tx.matterFileCode && (
                        <>
                          <span aria-hidden="true"> • </span>
                          <span>الملف: <bdi dir="ltr">{tx.matterFileCode}</bdi></span>
                        </>
                      )}
                      {tx.payerName && (
                        <>
                          <span aria-hidden="true"> • </span>
                          <span>الدافع: {tx.payerName}</span>
                        </>
                      )}
                      <span aria-hidden="true"> • </span>
                      <span>التاريخ: <bdi dir="ltr">{tx.transactionDate}</bdi></span>
                      {tx.paymentMethod && (
                        <>
                          <span aria-hidden="true"> • </span>
                          <span>{PAYMENT_METHOD_LABELS[tx.paymentMethod]}</span>
                        </>
                      )}
                      {tx.reference && (
                        <>
                          <span aria-hidden="true"> • </span>
                          <span>مرجع: <bdi dir="ltr">{tx.reference}</bdi></span>
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-[#14566B]">
                      <EgpAmount piastres={tx.totalAmountPiastres} />
                    </span>
                    {tx.receiptId && (
                      <button
                        type="button"
                        data-testid={`reprint-receipt-button-${tx.receiptId}`}
                        disabled={isLoadingReceipt}
                        aria-busy={isLoadingReceipt}
                        aria-label={`إعادة طباعة الإيصال رقم ${tx.receiptNumber ?? tx.receiptId}`}
                        onClick={(e) => void handleOpenReceipt(tx.receiptId!, e.currentTarget)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#E9F2F5] border border-[#14566B]/40 text-[#14566B] text-sm font-bold rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        <IconPrint className="w-4 h-4" />
                        <span>إعادة طباعة الإيصال</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Administrative Receipt Modal */}
      {activeReceipt &&
        renderModalPortal(
          <div
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setActiveReceipt(null);
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto print:static print:inset-auto print:bg-transparent print:p-0 print:block print:backdrop-blur-none print:overflow-visible"
          >
            <div
              ref={receiptModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="finance-receipt-dialog-title"
              data-testid="finance-receipt-dialog"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-lg w-full p-6 shadow-xl space-y-4 my-auto print:shadow-none print:border-0 print:max-w-none print:p-0"
            >
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E8EEF1]">
                <div className="space-y-0.5 min-w-0">
                  <h2 id="finance-receipt-dialog-title" className="text-base font-bold text-[#172A35]">
                    {activeReceipt.headerSnapshot.officeName}
                  </h2>
                  {(activeReceipt.headerSnapshot.lawyerName ||
                    activeReceipt.headerSnapshot.phone ||
                    activeReceipt.headerSnapshot.address) && (
                    <p className="text-sm text-[#4D606A] [overflow-wrap:anywhere]">
                      {activeReceipt.headerSnapshot.lawyerName && (
                        <span>{activeReceipt.headerSnapshot.lawyerName}</span>
                      )}
                      {activeReceipt.headerSnapshot.phone && (
                        <>
                          {activeReceipt.headerSnapshot.lawyerName && <span aria-hidden="true"> • </span>}
                          <bdi dir="ltr">{activeReceipt.headerSnapshot.phone}</bdi>
                        </>
                      )}
                      {activeReceipt.headerSnapshot.address && (
                        <>
                          {(activeReceipt.headerSnapshot.lawyerName || activeReceipt.headerSnapshot.phone) && (
                            <span aria-hidden="true"> • </span>
                          )}
                          <span>{activeReceipt.headerSnapshot.address}</span>
                        </>
                      )}
                    </p>
                  )}
                  <p className="text-sm text-[#4D606A]">
                    إيصال تحصيل إداري رقم:{' '}
                    <bdi dir="ltr" data-testid="receipt-number" className="font-mono font-bold text-[#14566B]">
                      {activeReceipt.receiptNumber}
                    </bdi>
                  </p>
                </div>
                <button
                  ref={closeReceiptBtnRef}
                  type="button"
                  data-testid="close-receipt-dialog-button"
                  onClick={() => {
                    setActiveReceipt(null);
                  }}
                  className="px-3 py-2 text-sm text-[#4D606A] hover:text-[#172A35] border border-[#D5DFE3] rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                >
                  <span aria-hidden="true">✕</span> إغلاق
                </button>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere]">
                  <dt className="text-[#4D606A]">ملف القضية:</dt>
                  <dd className="font-bold text-[#172A35]">
                    <bdi dir="ltr">{activeReceipt.headerSnapshot.matterFileCode}</bdi> —{' '}
                    {activeReceipt.headerSnapshot.matterTitle}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere]">
                  <dt className="text-[#4D606A]">الموكل المسؤول:</dt>
                  <dd className="font-semibold text-[#172A35]">{activeReceipt.headerSnapshot.clientName}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere]">
                  <dt className="text-[#4D606A]">الدافع الفعلي:</dt>
                  <dd className="font-semibold text-[#172A35]">{activeReceipt.payerName}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere]">
                  <dt className="text-[#4D606A]">طريقة السداد وتاريخ العملية:</dt>
                  <dd className="font-semibold text-[#172A35]">
                    {PAYMENT_METHOD_LABELS[activeReceipt.paymentMethod]} —{' '}
                    {formatCairoDateArabic(activeReceipt.headerSnapshot.transactionDate)}
                  </dd>
                </div>
                {activeReceipt.headerSnapshot.reference && (
                  <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere]">
                    <dt className="text-[#4D606A]">مرجع التحويل / الشيك:</dt>
                    <dd className="font-semibold text-[#172A35]">
                      <bdi dir="ltr">{activeReceipt.headerSnapshot.reference}</bdi>
                    </dd>
                  </div>
                )}
                <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere]">
                  <dt className="text-[#4D606A]">وقت الإصدار (القاهرة):</dt>
                  <dd className="font-semibold text-[#172A35]">
                    {formatCairoInstantArabic(activeReceipt.issuedAt)}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere] pt-2 border-t border-[#E8EEF1]">
                  <dt className="font-bold text-[#172A35]">المبلغ المحصل:</dt>
                  <dd className="text-base font-bold text-emerald-800" data-testid="receipt-amount">
                    <EgpAmount piastres={activeReceipt.amountPiastres} />
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 [overflow-wrap:anywhere]">
                  <dt className="font-bold text-[#172A35]">باقي الأتعاب بعد العملية:</dt>
                  <dd className="font-bold text-[#14566B]" data-testid="receipt-remaining-after">
                    <EgpAmount piastres={activeReceipt.headerSnapshot.feesRemainingAfterPiastres} />
                  </dd>
                </div>
              </dl>

              <div className="p-2.5 bg-[#F9FBFC] border border-[#E8EEF1] rounded text-sm space-y-1">
                <span className="font-bold text-[#172A35] block">تفصيل التوزيع:</span>
                {activeReceipt.headerSnapshot.allocations.map((al) => (
                  <div key={al.feeChargeId} className="flex flex-wrap justify-between gap-2 text-[#4D606A]">
                    <span>قسط #{al.installmentNumber}: {al.description}</span>
                    <strong className="text-[#172A35]">
                      <EgpAmount piastres={al.amountPiastres} />
                    </strong>
                  </div>
                ))}
              </div>

              <div
                data-testid="receipt-administrative-notice"
                className="p-2.5 bg-amber-50 border border-amber-200 text-[#7A4A00] rounded text-sm font-semibold flex items-center gap-2"
              >
                <IconWarning className="w-4 h-4 shrink-0" />
                <span>{activeReceipt.administrativeNotice || ADMINISTRATIVE_NOTICE}</span>
              </div>

              <div className="flex justify-end gap-2 print:hidden">
                <button
                  type="button"
                  data-testid="print-receipt-button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
                >
                  <IconDocument className="w-4 h-4" />
                  <span>طباعة الإيصال</span>
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
