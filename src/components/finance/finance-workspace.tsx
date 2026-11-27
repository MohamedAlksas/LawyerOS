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
import { getCairoTodayDateString, formatCairoDateArabic } from '@/lib/cairo-date';
import { normalizeArabicDigits } from '@/lib/normalization';
import { renderModalPortal, useAccessibleModal } from '@/components/productivity/productivity-ui-types';
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

function createClientIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pure BigInt parser matching server parseEgpToPiastres without floats. */
function tryParseEgpToPiastres(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let normalized = normalizeArabicDigits(trimmed)
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, ',')
    .replace(/\s+/g, '');

  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(normalized)) {
    normalized = normalized.replace(/,/g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [whole, frac = ''] = normalized.split('.');
  const piastres = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return piastres > 0n ? piastres : null;
}

function formatPiastresToInputEgp(piastresStr: string): string {
  const val = BigInt(piastresStr || '0');
  const whole = val / 100n;
  const frac = val % 100n;
  return frac === 0n ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

function formatEgp(piastresInput: bigint | string): string {
  const val = typeof piastresInput === 'bigint' ? piastresInput : BigInt(piastresInput || '0');
  const neg = val < 0n;
  const abs = neg ? -val : val;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = frac > 0n ? `.${frac.toString().padStart(2, '0')}` : '';
  return `${neg ? '-' : ''}${grouped}${fracStr} ج.م.`;
}

function formatCairoTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
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
  const defaultDate = useMemo(() => getCairoTodayDateString(), []);

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
  const [sessionExpired, setSessionExpired] = useState(false);

  // Draft fee agreement form
  const [showDraftForm, setShowDraftForm] = useState(false);
  const [draftMatterId, setDraftMatterId] = useState<string>(
    lockedMatterId || initialOverview.selectableMatters[0]?.matterId || ''
  );
  const [draftClientId, setDraftClientId] = useState<string>(
    initialOverview.selectableMatters.find(
      (m) => m.matterId === (lockedMatterId || initialOverview.selectableMatters[0]?.matterId)
    )?.clients[0]?.clientMatterPartyId || ''
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
    lockedMatterId || firstCharge?.matterId || initialOverview.selectableMatters[0]?.matterId || ''
  );
  const [payClientId, setPayClientId] = useState<string>(firstCharge?.clientMatterPartyId || '');
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
  const [statementClientKey, setStatementClientKey] = useState<string>(
    initialOverview.selectedMatterSummary?.clients[0]?.clientMatterPartyId || ''
  );
  const [loadedStatement, setLoadedStatement] = useState<ClientStatementDTO | null>(null);
  const [isLoadingStatement, setIsLoadingStatement] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptDTO | null>(null);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);
  const receiptModalRef = useRef<HTMLDivElement>(null);
  const closeReceiptBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useAccessibleModal({
    isOpen: Boolean(activeReceipt),
    hasPending: false,
    onClose: () => {
      setActiveReceipt(null);
      lastFocusRef.current?.focus();
    },
    dialogRef: receiptModalRef,
    initialFocusRef: closeReceiptBtnRef,
  });

  const refreshOverview = async (
    matterFilter: string,
    activeStatementClientId: string | null = loadedStatement?.scope.clientMatterPartyId ?? null
  ) => {
    setIsLoadingOverview(true);
    setActionError(null);
    try {
      const qs = matterFilter ? `?matterId=${encodeURIComponent(matterFilter)}` : '';
      const res = await fetch(`/api/finance${qs}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (res.status === 401 || json?.code === 'UNAUTHENTICATED' || json?.code === 'SESSION_EXPIRED' || json?.code === 'MFA_REQUIRED') {
        setSessionExpired(true);
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
        const stmtRes = await fetch(
          `/api/finance/statement?clientMatterPartyId=${encodeURIComponent(activeStatementClientId)}`,
          { cache: 'no-store' }
        );
        const stmtJson = await stmtRes.json().catch(() => null);
        if (stmtRes.ok && stmtJson?.success) {
          setLoadedStatement(stmtJson.data as ClientStatementDTO);
        }
      }
    } catch {
      setActionError('تعذر الاتصال بالخادم لتحديث البيانات المالية.');
    } finally {
      setIsLoadingOverview(false);
    }
  };

  const summary = overview.selectedMatterSummary;
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

  const effectivePayMatterId = lockedMatterId || payMatterId || selectedMatterId;
  const payMatterOption = overview.selectableMatters.find((m) => m.matterId === effectivePayMatterId);
  const payEligibleCharges = allOpenCharges.filter(
    (c) =>
      (!effectivePayMatterId || c.matterId === effectivePayMatterId) &&
      (!payClientId || c.clientMatterPartyId === payClientId)
  );
  const draftMatterClients =
    overview.selectableMatters.find((m) => m.matterId === draftMatterId)?.clients || [];

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteFinance || isReadOnly || isSavingDraft) return;
    setActionError(null);
    setActionNotice(null);

    const parsedTotal = tryParseEgpToPiastres(draftTotalEgp);
    if (!parsedTotal) {
      setActionError('يرجى إدخال مبلغ أتعاب صحيح وموجب بالجنيه المصري.');
      return;
    }

    setIsSavingDraft(true);
    try {
      const res = await fetch('/api/finance/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      if (res.status === 401) {
        setSessionExpired(true);
        setActionError('انتهت الجلسة. افتح صفحة تسجيل الدخول وأعد المحاولة دون فقدان البيانات.');
        return;
      }
      if (!res.ok || !json?.success) {
        if (res.status < 500) {
          setDraftIdempotencyKey(createClientIdempotencyKey());
        }
        setActionError(json?.error || 'تعذر حفظ مسودة اتفاق الأتعاب.');
        return;
      }
      setActionNotice('تم حفظ مسودة اتفاق الأتعاب بنجاح (بلا أثر مالي حتى الاعتماد).');
      setShowDraftForm(false);
      setDraftDescription('');
      setDraftTotalEgp('');
      setDraftNotes('');
      setDraftIdempotencyKey(createClientIdempotencyKey());
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
    setApproveDate(defaultDate);
    setApproveIdempotencyKey(createClientIdempotencyKey());
    setApproveInstallments([
      {
        key: createClientIdempotencyKey(),
        description: ag.description,
        dueDate: ag.agreementDate,
        amountEgp: formatPiastresToInputEgp(ag.totalAmountPiastres),
      },
    ]);
    setActionError(null);
    setActionNotice(null);
  };

  const handleApproveAgreement = async (ag: FeeAgreementDTO) => {
    if (!canWriteFinance || isReadOnly || isApproving) return;
    setActionError(null);
    setActionNotice(null);

    const parsedRows: Array<{ description: string; dueDate: string | null; amountPiastres: string }> = [];
    let sum = 0n;
    for (const row of approveInstallments) {
      const amt = tryParseEgpToPiastres(row.amountEgp);
      if (!amt || !row.description.trim()) {
        setActionError('يجب أن يحتوي كل قسط على وصف صحيح ومبلغ موجب.');
        return;
      }
      sum += amt;
      parsedRows.push({
        description: row.description.trim(),
        dueDate: row.dueDate.trim() || null,
        amountPiastres: amt.toString(),
      });
    }

    if (sum !== BigInt(ag.totalAmountPiastres)) {
      setActionError(
        `مجموع الأقساط (${formatEgp(sum)}) يجب أن يساوي إجمالي الاتفاق (${formatEgp(ag.totalAmountPiastres)}).`
      );
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
      if (res.status === 401) {
        setSessionExpired(true);
        setActionError('انتهت الجلسة أثناء اعتماد الاتفاق. سجل الدخول وأعد المحاولة بنفس الطلب.');
        return;
      }
      if (!res.ok || !json?.success) {
        if (res.status < 500) {
          setApproveIdempotencyKey(createClientIdempotencyKey());
        }
        setActionError(json?.error || 'تعذر اعتماد اتفاق الأتعاب.');
        return;
      }
      setActionNotice(`تم اعتماد اتفاق الأتعاب وترحيل ${parsedRows.length} استحقاق مالي متوازن.`);
      setApprovingAgreementId(null);
      setPayMatterId(ag.matterId);
      setPayClientId(ag.clientMatterPartyId);
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
  const resolvedAllocations: Array<{ feeChargeId: string; amountPiastres: bigint }> = [];
  for (const ch of payEligibleCharges) {
    const rawAlloc = chargeAllocations[ch.id];
    const parsedAlloc = rawAlloc ? tryParseEgpToPiastres(rawAlloc) : null;
    if (parsedAlloc) {
      resolvedAllocations.push({ feeChargeId: ch.id, amountPiastres: parsedAlloc });
    }
  }
  if (
    resolvedAllocations.length === 0 &&
    parsedPaymentAmount !== null &&
    payEligibleCharges.length === 1
  ) {
    resolvedAllocations.push({
      feeChargeId: payEligibleCharges[0].id,
      amountPiastres: parsedPaymentAmount,
    });
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
    try {
      const res = await fetch('/api/finance/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) {
        setSessionExpired(true);
        setFrozenPaymentPayload(payload);
        setActionError('انتهت الجلسة. يرجى تسجيل الدخول في نافذة جديدة ثم إعادة المحاولة بنفس المفتاح.');
        return;
      }
      if (!res.ok || !json?.success) {
        if (res.status >= 500) {
          setFrozenPaymentPayload(payload);
        } else {
          // Validation / over-allocation error: release frozen payload so user can fix input with a fresh key
          setFrozenPaymentPayload(null);
          setPaymentIdempotencyKey(createClientIdempotencyKey());
        }
        setActionError(json?.error || 'تعذر تسجيل الدفعة المالية.');
        return;
      }

      const data = json.data as { receipt: ReceiptDTO; matterSummary: { feesDuePiastres: string } };
      setFrozenPaymentPayload(null);
      setPaymentIdempotencyKey(createClientIdempotencyKey());
      setPayAmountEgp('');
      setPayReference('');
      setPayDescription('');
      setChargeAllocations({});
      setActionNotice(
        `تم تحصيل ${formatEgp(data.receipt.amountPiastres)} وإصدار الإيصال رقم ${data.receipt.receiptNumber}. باقي الأتعاب: ${formatEgp(data.matterSummary.feesDuePiastres)}.`
      );
      lastFocusRef.current = document.activeElement as HTMLElement | null;
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
    if (!canWriteFinance || isReadOnly || isPostingPayment) return;

    if (frozenPaymentPayload) {
      await submitPaymentRequest(frozenPaymentPayload);
      return;
    }

    if (!parsedPaymentAmount) {
      setActionError('يرجى إدخال مبلغ تحصيل صحيح وموجب بالجنيه المصري.');
      return;
    }
    if (!effectivePayMatterId || !payClientId) {
      setActionError('يرجى تحديد الملف والموكل المسؤول قبل تسجيل الدفعة.');
      return;
    }
    if (resolvedAllocations.length === 0) {
      setActionError('يرجى تحديد البند أو القسط المخصص له هذه الدفعة.');
      return;
    }
    if (effectiveAllocTotal !== parsedPaymentAmount) {
      setActionError(
        `مجموع التوزيع على البنود (${formatEgp(effectiveAllocTotal)}) يجب أن يطابق مبلغ الدفعة (${formatEgp(parsedPaymentAmount)}).`
      );
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

    await submitPaymentRequest(payload);
  };

  const handleOpenReceipt = async (receiptId: string, triggerEl: HTMLElement) => {
    lastFocusRef.current = triggerEl;
    setIsLoadingReceipt(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/finance/receipts/${encodeURIComponent(receiptId)}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setActionError(json?.error || 'تعذر تحميل بيانات الإيصال.');
        return;
      }
      setActiveReceipt(json.data as ReceiptDTO);
    } catch {
      setActionError('تعذر الاتصال بالخادم لعرض الإيصال.');
    } finally {
      setIsLoadingReceipt(false);
    }
  };

  const handleLoadClientStatement = async (clientMatterPartyId: string) => {
    setStatementClientKey(clientMatterPartyId);
    if (!clientMatterPartyId) {
      setLoadedStatement(null);
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
      if (!res.ok || !json?.success) {
        setActionError(json?.error || 'تعذر تحميل كشف حساب الموكل.');
        return;
      }
      setLoadedStatement(json.data as ClientStatementDTO);
    } catch {
      setActionError('تعذر الاتصال لتحميل كشف حساب الموكل.');
    } finally {
      setIsLoadingStatement(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="finance-workspace">
      {/* Scope Filter Bar */}
      {!lockedMatterId && (
        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="finance-matter-filter" className="text-xs font-bold text-[#172A35]">
              تصفية حسب ملف القضية:
            </label>
            <select
              id="finance-matter-filter"
              data-testid="finance-matter-filter"
              value={selectedMatterId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedMatterId(nextId);
                if (nextId) {
                  setPayMatterId(nextId);
                  setDraftMatterId(nextId);
                  const m = overview.selectableMatters.find((item) => item.matterId === nextId);
                  const firstCid = m?.clients[0]?.clientMatterPartyId || '';
                  setPayClientId(firstCid);
                  setDraftClientId(firstCid);
                }
                setLoadedStatement(null);
                void refreshOverview(nextId, null);
              }}
              className="px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            >
              <option value="">كل الملفات النشطة</option>
              {overview.selectableMatters.map((m) => (
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
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#14566B] bg-[#F4F6F7] hover:bg-[#E8EEF1] border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
          >
            <IconRefresh className="w-4 h-4" />
            <span>{isLoadingOverview ? 'جارٍ التحديث...' : 'تحديث الحسابات'}</span>
          </button>
        </div>
      )}

      {/* Alerts */}
      {actionError && (
        <div
          role="alert"
          data-testid="finance-error-banner"
          className="p-3.5 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
        >
          <span>{actionError}</span>
          <div className="flex flex-wrap items-center gap-2">
            {sessionExpired && (
              <NextLink
                href="/login"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 bg-[#14566B] text-white rounded-[6px] min-h-[44px] inline-flex items-center"
              >
                تسجيل الدخول في نافذة جديدة
              </NextLink>
            )}
            {frozenPaymentPayload && (
              <button
                type="button"
                data-testid="retry-payment-button"
                disabled={isPostingPayment}
                onClick={() => void submitPaymentRequest(frozenPaymentPayload)}
                className="px-3 py-2 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded-[6px] min-h-[44px]"
              >
                إعادة المحاولة بنفس الطلب (دون تكرار)
              </button>
            )}
          </div>
        </div>
      )}

      {actionNotice && (
        <div
          role="status"
          data-testid="finance-success-banner"
          className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-xs font-semibold flex items-center gap-2"
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
          <div className="flex items-center justify-between">
            <SectionHeading className="text-sm font-bold text-[#14566B] flex items-center gap-1.5">
              <IconWallet className="w-4 h-4" />
              <span>الأتعاب</span>
            </SectionHeading>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#E9F2F5] text-[#14566B]">
              مفعّل
            </span>
          </div>
          <dl className="space-y-1.5 text-xs pt-1">
            <div className="flex items-center justify-between">
              <dt className="text-[#4D606A]">المتفق عليه المعتمد:</dt>
              <dd className="font-bold text-[#172A35]" data-testid="fees-charged-value">
                <bdi dir="ltr">{formatEgp(activeTotals.feesChargedPiastres)}</bdi>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[#4D606A]">المحصل من الأتعاب:</dt>
              <dd className="font-bold text-emerald-800" data-testid="fees-collected-value">
                <bdi dir="ltr">{formatEgp(activeTotals.feesCollectedPiastres)}</bdi>
              </dd>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-[#E8EEF1]">
              <dt className="font-bold text-[#172A35]">باقي الأتعاب المستحق:</dt>
              <dd className="text-base font-bold text-[#14566B]" data-testid="fees-due-value">
                <bdi dir="ltr">{formatEgp(activeTotals.feesDuePiastres)}</bdi>
              </dd>
            </div>
          </dl>
        </div>

        <div
          data-testid="finance-card-expenses"
          className="bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] p-4 space-y-2"
        >
          <div className="flex items-center justify-between">
            <SectionHeading className="text-sm font-bold text-[#172A35]">
              مصاريف القضايا
            </SectionHeading>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-[#172A35]">
              قيد التفعيل لاحقاً
            </span>
          </div>
          <p className="text-sm font-bold text-[#172A35]" data-testid="expenses-due-value">
            <bdi dir="ltr">{formatEgp(activeTotals.expensesDuePiastres)}</bdi>
          </p>
          <p className="text-xs text-[#4D606A] leading-relaxed">
            مصاريف القضايا القابلة للاسترداد منفصلة تماماً عن الأتعاب وسيتم تفعيل تسجيلها في مرحلة لاحقة (مصروفات تشغيل المكتب غير مشمولة بالنظام).
          </p>
        </div>

        <div
          data-testid="finance-card-advances"
          className="bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] p-4 space-y-2"
        >
          <div className="flex items-center justify-between">
            <SectionHeading className="text-sm font-bold text-[#172A35]">
              أموال الموكل (العُهد)
            </SectionHeading>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-[#172A35]">
              قيد التفعيل لاحقاً
            </span>
          </div>
          <p className="text-sm font-bold text-[#172A35]" data-testid="advances-available-value">
            <bdi dir="ltr">{formatEgp(activeTotals.advanceAvailablePiastres)}</bdi>
          </p>
          <p className="text-xs text-[#4D606A] leading-relaxed">
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
            <p className="text-xs text-[#4D606A]">
              حفظ الاتفاق كمسودة لا ينشئ مديونية؛ اعتماد الاتفاق يرحّل استحقاقات متوازنة على حساب الموكل.
            </p>
          </div>
          {canWriteFinance && !isReadOnly && (
            <button
              type="button"
              data-testid="toggle-draft-agreement-button"
              onClick={() => {
                setShowDraftForm((v) => !v);
                setDraftIdempotencyKey(createClientIdempotencyKey());
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] print:hidden"
            >
              <IconPlus className="w-4 h-4" />
              <span>{showDraftForm ? 'إخفاء نموذج الاتفاق' : 'اتفاق أتعاب جديد (مسودة)'}</span>
            </button>
          )}
        </div>

        {showDraftForm && canWriteFinance && !isReadOnly && (
          <form
            onSubmit={handleSaveDraft}
            data-testid="draft-agreement-form"
            className="p-4 bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] space-y-4 print:hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!lockedMatterId && (
                <div className="space-y-1">
                  <label htmlFor="draft-matter-select" className="block text-xs font-bold text-[#172A35]">
                    ملف القضية
                  </label>
                  <select
                    id="draft-matter-select"
                    data-testid="draft-matter-select"
                    required
                    value={draftMatterId}
                    onChange={(e) => {
                      const nextM = e.target.value;
                      setDraftMatterId(nextM);
                      const m = overview.selectableMatters.find((item) => item.matterId === nextM);
                      setDraftClientId(m?.clients[0]?.clientMatterPartyId || '');
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px]"
                  >
                    <option value="">-- اختر ملف القضية --</option>
                    {overview.selectableMatters.map((m) => (
                      <option key={m.matterId} value={m.matterId}>
                        {m.fileCode} — {m.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="draft-client-select" className="block text-xs font-bold text-[#172A35]">
                  الموكل المسؤول عن السداد
                </label>
                <select
                  id="draft-client-select"
                  data-testid="draft-client-select"
                  required
                  value={draftClientId}
                  onChange={(e) => setDraftClientId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px]"
                >
                  <option value="">-- اختر الموكل --</option>
                  {draftMatterClients.map((cl) => (
                    <option key={cl.clientMatterPartyId} value={cl.clientMatterPartyId}>
                      {cl.partyName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1 sm:col-span-1">
                <label htmlFor="draft-description-input" className="block text-xs font-bold text-[#172A35]">
                  بيان / وصف الأتعاب
                </label>
                <input
                  id="draft-description-input"
                  data-testid="draft-description-input"
                  type="text"
                  required
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="مثال: أتعاب الدعوى الابتدائية والاستئناف"
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="draft-total-egp-input" className="block text-xs font-bold text-[#172A35]">
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
                  onChange={(e) => setDraftTotalEgp(e.target.value)}
                  placeholder="15000"
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="draft-date-input" className="block text-xs font-bold text-[#172A35]">
                  تاريخ الاتفاق
                </label>
                <input
                  id="draft-date-input"
                  data-testid="draft-date-input"
                  type="date"
                  dir="ltr"
                  required
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="draft-method-select" className="block text-xs font-bold text-[#172A35]">
                  طريقة احتساب الأتعاب
                </label>
                <select
                  id="draft-method-select"
                  value={draftMethod}
                  onChange={(e) => setDraftMethod(e.target.value as FeeChargingMethod)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px]"
                >
                  {(Object.keys(CHARGING_METHOD_LABELS) as FeeChargingMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {CHARGING_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="draft-notes-input" className="block text-xs font-bold text-[#172A35]">
                  ملاحظات (اختياري)
                </label>
                <input
                  id="draft-notes-input"
                  type="text"
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs text-[#172A35] min-h-[44px]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                data-testid="save-draft-agreement-button"
                disabled={isSavingDraft}
                className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
              >
                {isSavingDraft ? 'جارٍ الحفظ...' : 'حفظ الاتفاق كمسودة'}
              </button>
            </div>
          </form>
        )}

        {agreements.length === 0 ? (
          <p className="text-xs text-[#4D606A] py-2" data-testid="finance-agreements-empty">
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
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-[#172A35]">{ag.description}</span>
                      <span
                        data-testid={`agreement-status-${ag.id}`}
                        className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                          ag.status === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : ag.status === 'DRAFT'
                            ? 'bg-amber-50 text-[#7A4100] border-amber-200'
                            : 'bg-slate-100 text-[#4D606A] border-slate-300'
                        }`}
                      >
                        {AGREEMENT_STATUS_LABELS[ag.status]}
                      </span>
                    </div>
                    <p className="text-xs text-[#4D606A]">
                      <span>الملف: <bdi dir="ltr">{ag.matterFileCode}</bdi></span>
                      <span aria-hidden="true"> • </span>
                      <span>الموكل: {ag.clientName}</span>
                      <span aria-hidden="true"> • </span>
                      <span>التاريخ: <bdi dir="ltr">{ag.agreementDate}</bdi></span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#14566B]">
                      <bdi dir="ltr">{formatEgp(ag.totalAmountPiastres)}</bdi>
                    </span>
                    {ag.status === 'DRAFT' && canWriteFinance && !isReadOnly && (
                      <button
                        type="button"
                        data-testid={`open-approve-agreement-${ag.id}`}
                        onClick={() =>
                          approvingAgreementId === ag.id
                            ? setApprovingAgreementId(null)
                            : openApprovePanel(ag)
                        }
                        className="px-3 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-[6px] min-h-[44px] print:hidden"
                      >
                        {approvingAgreementId === ag.id ? 'إلغاء الاعتماد' : 'اعتماد وترحيل'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Approve Installments Builder */}
                {approvingAgreementId === ag.id && (
                  <div
                    data-testid={`approve-agreement-panel-${ag.id}`}
                    className="p-3.5 bg-white border border-[#14566B]/30 rounded-[6px] space-y-3 print:hidden"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SubHeading className="text-xs font-bold text-[#14566B]">
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
                        className="px-3 py-1.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] border border-[#D5DFE3] text-[#172A35] text-xs font-semibold rounded-[6px] min-h-[44px]"
                      >
                        + إضافة قسط
                      </button>
                    </div>

                    <div className="space-y-2">
                      {approveInstallments.map((row, idx) => (
                        <div key={row.key} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                          <div className="sm:col-span-2 space-y-1">
                            <label htmlFor={`inst-desc-${row.key}`} className="block text-[11px] font-semibold text-[#172A35]">
                              وصف البند #{idx + 1}
                            </label>
                            <input
                              id={`inst-desc-${row.key}`}
                              data-testid={`installment-desc-${idx}`}
                              type="text"
                              value={row.description}
                              onChange={(e) =>
                                setApproveInstallments((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, description: e.target.value } : r))
                                )
                              }
                              className="w-full px-2.5 py-2 border border-[#D5DFE3] rounded-[6px] text-base sm:text-xs min-h-[44px]"
                            />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor={`inst-amt-${row.key}`} className="block text-[11px] font-semibold text-[#172A35]">
                              المبلغ (ج.م.)
                            </label>
                            <input
                              id={`inst-amt-${row.key}`}
                              data-testid={`installment-amount-${idx}`}
                              type="text"
                              dir="ltr"
                              value={row.amountEgp}
                              onChange={(e) =>
                                setApproveInstallments((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, amountEgp: e.target.value } : r))
                                )
                              }
                              className="w-full px-2.5 py-2 border border-[#D5DFE3] rounded-[6px] text-base sm:text-xs min-h-[44px]"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              aria-label={`تاريخ استحقاق البند ${idx + 1}`}
                              type="date"
                              dir="ltr"
                              value={row.dueDate}
                              onChange={(e) =>
                                setApproveInstallments((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, dueDate: e.target.value } : r))
                                )
                              }
                              className="w-full px-2.5 py-2 border border-[#D5DFE3] rounded-[6px] text-base sm:text-xs min-h-[44px]"
                            />
                            {approveInstallments.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setApproveInstallments((prev) => prev.filter((r) => r.key !== row.key))
                                }
                                className="px-2.5 py-2 text-xs text-[#A4262C] border border-red-200 rounded-[6px] min-h-[44px]"
                              >
                                حذف
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E8EEF1]">
                      <div className="flex items-center gap-2 text-xs">
                        <label htmlFor="approve-tx-date" className="font-semibold text-[#172A35]">
                          تاريخ القيد:
                        </label>
                        <input
                          id="approve-tx-date"
                          type="date"
                          dir="ltr"
                          value={approveDate}
                          onChange={(e) => setApproveDate(e.target.value)}
                          className="px-2.5 py-1.5 border border-[#D5DFE3] rounded-[6px] text-base sm:text-xs min-h-[44px]"
                        />
                      </div>
                      <button
                        type="button"
                        data-testid={`confirm-approve-agreement-${ag.id}`}
                        disabled={isApproving}
                        onClick={() => void handleApproveAgreement(ag)}
                        className="px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
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
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white rounded border border-[#E8EEF1] text-xs"
                      >
                        <span className="font-semibold text-[#172A35]">
                          قسط #{ch.installmentNumber}: {ch.description}
                        </span>
                        <div className="flex flex-wrap items-center gap-3 text-[#4D606A]">
                          <span>الأصل: <bdi dir="ltr">{formatEgp(ch.amountPiastres)}</bdi></span>
                          <span>المسدد: <bdi dir="ltr">{formatEgp(ch.allocatedPiastres)}</bdi></span>
                          <span className="font-bold text-[#14566B]">
                            المتبقي: <bdi dir="ltr">{formatEgp(ch.remainingPiastres)}</bdi>
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
      {canWriteFinance && !isReadOnly && (
        <section className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 shadow-xs space-y-4 print:hidden">
          <div className="pb-2 border-b border-[#E8EEF1]">
            <SectionHeading className="text-base font-bold text-[#172A35]">
              تسجيل دفعة أتعاب وإصدار إيصال تحصيل
            </SectionHeading>
            <p className="text-xs text-[#4D606A]">
              تُخصص كل دفعة صراحةً لبنود الأتعاب المستحقة للموكل دون تجاوز المديونية.
            </p>
          </div>

          {allOpenCharges.length === 0 ? (
            <p className="text-xs text-[#4D606A]">
              لا توجد بنود أتعاب مستحقة مفتوحة للتحصيل حالياً. اعتمد اتفاق أتعاب أولاً.
            </p>
          ) : (
            <form onSubmit={handleSubmitPayment} data-testid="fee-payment-form" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {!lockedMatterId && (
                  <div className="space-y-1">
                    <label htmlFor="pay-matter-select" className="block text-xs font-bold text-[#172A35]">
                      الملف
                    </label>
                    <select
                      id="pay-matter-select"
                      data-testid="pay-matter-select"
                      value={effectivePayMatterId}
                      onChange={(e) => {
                        const nextM = e.target.value;
                        setPayMatterId(nextM);
                        const m = overview.selectableMatters.find((item) => item.matterId === nextM);
                        setPayClientId(m?.clients[0]?.clientMatterPartyId || '');
                        setChargeAllocations({});
                        setFrozenPaymentPayload(null);
                      }}
                      className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs min-h-[44px]"
                    >
                      {overview.selectableMatters.map((m) => (
                        <option key={m.matterId} value={m.matterId}>
                          {m.fileCode} — {m.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1">
                  <label htmlFor="pay-client-select" className="block text-xs font-bold text-[#172A35]">
                    الموكل المدين
                  </label>
                  <select
                    id="pay-client-select"
                    data-testid="pay-client-select"
                    required
                    value={payClientId}
                    onChange={(e) => {
                      setPayClientId(e.target.value);
                      setChargeAllocations({});
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs min-h-[44px]"
                  >
                    <option value="">-- اختر الموكل --</option>
                    {(payMatterOption?.clients || []).map((cl) => (
                      <option key={cl.clientMatterPartyId} value={cl.clientMatterPartyId}>
                        {cl.partyName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="pay-amount-egp-input" className="block text-xs font-bold text-[#172A35]">
                    المبلغ المحصل (ج.م.)
                  </label>
                  <input
                    id="pay-amount-egp-input"
                    data-testid="pay-amount-egp-input"
                    type="text"
                    dir="ltr"
                    inputMode="decimal"
                    required
                    value={payAmountEgp}
                    onChange={(e) => {
                      setPayAmountEgp(e.target.value);
                      setFrozenPaymentPayload(null);
                    }}
                    placeholder="5000"
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs min-h-[44px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label htmlFor="pay-method-select" className="block text-xs font-bold text-[#172A35]">
                    طريقة السداد
                  </label>
                  <select
                    id="pay-method-select"
                    data-testid="pay-method-select"
                    value={payMethod}
                    onChange={(e) => {
                      setPayMethod(e.target.value as PaymentMethod);
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs min-h-[44px]"
                  >
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="pay-date-input" className="block text-xs font-bold text-[#172A35]">
                    تاريخ التحصيل
                  </label>
                  <input
                    id="pay-date-input"
                    data-testid="pay-date-input"
                    type="date"
                    dir="ltr"
                    required
                    value={payDate}
                    onChange={(e) => {
                      setPayDate(e.target.value);
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs min-h-[44px]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="pay-reference-input" className="block text-xs font-bold text-[#172A35]">
                    مرجع التحويل / الشيك (اختياري)
                  </label>
                  <input
                    id="pay-reference-input"
                    type="text"
                    value={payReference}
                    onChange={(e) => {
                      setPayReference(e.target.value);
                      setFrozenPaymentPayload(null);
                    }}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs min-h-[44px]"
                  />
                </div>
              </div>

              {/* Explicit Per-Charge Allocation Table */}
              <div className="space-y-2 p-3 bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px]">
                <span className="block text-xs font-bold text-[#172A35]">
                  توزيع الدفعة على بنود الأتعاب المستحقة (إجمالي المفتوح للموكل: <bdi dir="ltr">{formatEgp(totalEligibleDue)}</bdi>):
                </span>
                {payEligibleCharges.map((ch, idx) => (
                  <div
                    key={ch.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white rounded border border-[#E8EEF1] text-xs"
                  >
                    <div>
                      <span className="font-semibold text-[#172A35] block">
                        قسط #{ch.installmentNumber}: {ch.description}
                      </span>
                      <span className="text-[#4D606A]">
                        المتبقي: <bdi dir="ltr">{formatEgp(ch.remainingPiastres)}</bdi>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor={`alloc-${ch.id}`} className="sr-only">
                        مبلغ التوزيع للبند {ch.description}
                      </label>
                      <input
                        id={`alloc-${ch.id}`}
                        data-testid={`allocation-amount-${idx}`}
                        type="text"
                        dir="ltr"
                        inputMode="decimal"
                        value={
                          chargeAllocations[ch.id] ??
                          (payEligibleCharges.length === 1 ? payAmountEgp : '')
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setChargeAllocations((prev) => ({ ...prev, [ch.id]: val }));
                          setFrozenPaymentPayload(null);
                        }}
                        placeholder="0"
                        className="w-36 px-2.5 py-1.5 border border-[#D5DFE3] rounded-[6px] text-base sm:text-xs min-h-[44px]"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Mandatory Live Arabic Pre-Save Confirmation Preview */}
              {parsedPaymentAmount !== null && previewRemainingAfter !== null && (
                <div
                  role="region"
                  aria-label="معاينة الأثر المالي قبل الحفظ"
                  data-testid="finance-presave-preview"
                  className="p-3.5 bg-teal-50 border border-[#14566B]/30 rounded-[6px] text-xs font-bold text-[#14566B]"
                >
                  {previewRemainingAfter < 0n ? (
                    <span className="text-[#A4262C]">
                      تنبيه: المبلغ المدخل يتجاوز إجمالي الأتعاب المستحقة على الموكل المحدد ({formatEgp(totalEligibleDue)}) ولن يتم ترحيله كدفعة مقدمة تلقائياً.
                    </span>
                  ) : (
                    <span>
                      معاينة التأكيد: أتعاب {formatEgp(parsedPaymentAmount)} — باقي الأتعاب بعد العملية {formatEgp(previewRemainingAfter)}
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  data-testid="submit-payment-button"
                  disabled={isPostingPayment}
                  className="px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
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
            <div className="flex items-center gap-2 print:hidden">
              <label htmlFor="statement-client-select" className="text-xs font-semibold text-[#4D606A]">
                اختر الموكل:
              </label>
              <select
                id="statement-client-select"
                data-testid="statement-client-select"
                value={statementClientKey}
                onChange={(e) => void handleLoadClientStatement(e.target.value)}
                className="px-2.5 py-1.5 border border-[#D5DFE3] rounded-[6px] bg-white text-base sm:text-xs min-h-[44px]"
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
          <p className="text-xs text-[#4D606A]">جارٍ تحميل كشف حساب الموكل...</p>
        )}

        {loadedStatement ? (
          <div data-testid="client-statement-summary" className="p-3.5 bg-[#F9FBFC] border border-[#D5DFE3] rounded-[6px] space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-[#172A35]">
              <span>الموكل: {loadedStatement.scope.partyName || '—'}</span>
              <span className={loadedStatement.reconciled ? 'text-emerald-800' : 'text-[#A4262C]'}>
                {loadedStatement.reconciled ? 'مطابق حسابياً مع القيود المرحلة' : 'يحتاج مراجعة مطابقة'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>إجمالي الأتعاب: <strong dir="ltr">{formatEgp(loadedStatement.feesChargedPiastres)}</strong></div>
              <div>المحصل: <strong dir="ltr">{formatEgp(loadedStatement.feesCollectedPiastres)}</strong></div>
              <div>المتبقي المستحق: <strong dir="ltr">{formatEgp(loadedStatement.feesDuePiastres)}</strong></div>
            </div>
          </div>
        ) : summary && summary.clients.length > 0 ? (
          <div className="space-y-2">
            {summary.clients.map((cl) => (
              <div
                key={cl.clientMatterPartyId}
                data-testid={`client-balance-row-${cl.clientMatterPartyId}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#F9FBFC] rounded border border-[#E8EEF1] text-xs"
              >
                <span className="font-bold text-[#172A35]">{cl.partyName}</span>
                <div className="flex flex-wrap items-center gap-3 text-[#4D606A]">
                  <span>المعتمد: <bdi dir="ltr">{formatEgp(cl.feesChargedPiastres)}</bdi></span>
                  <span>المحصل: <bdi dir="ltr">{formatEgp(cl.feesCollectedPiastres)}</bdi></span>
                  <span className="font-bold text-[#14566B]">
                    المتبقي: <bdi dir="ltr">{formatEgp(cl.feesDuePiastres)}</bdi>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleLoadClientStatement(cl.clientMatterPartyId)}
                    className="px-2.5 py-1 text-[#14566B] border border-[#14566B]/30 rounded-[6px] font-semibold min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
                  >
                    عرض الكشف المفصل
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#4D606A]">
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
          <p className="text-xs text-[#4D606A]">لا توجد قيود مالية مرحلة بعد.</p>
        ) : (
          <div className="space-y-2.5">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                data-testid={`posted-tx-row-${tx.id}`}
                className="p-3.5 rounded-[6px] border border-[#D5DFE3] bg-[#F9FBFC] space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[#172A35]">
                        {TRANSACTION_KIND_LABELS[tx.kind] || tx.kind}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 text-[#172A35] text-[11px] font-semibold">
                        مرحّل ومغلق
                      </span>
                      {tx.receiptNumber && (
                        <bdi dir="ltr" className="font-mono text-[#14566B] bg-[#E9F2F5] px-2 py-0.5 rounded font-bold">
                          {tx.receiptNumber}
                        </bdi>
                      )}
                    </div>
                    <p className="text-[#4D606A]">
                      <span>{tx.description}</span>
                      <span aria-hidden="true"> • </span>
                      <span>التاريخ: <bdi dir="ltr">{tx.transactionDate}</bdi></span>
                      {tx.paymentMethod && (
                        <>
                          <span aria-hidden="true"> • </span>
                          <span>{PAYMENT_METHOD_LABELS[tx.paymentMethod]}</span>
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#14566B]">
                      <bdi dir="ltr">{formatEgp(tx.totalAmountPiastres)}</bdi>
                    </span>
                    {tx.receiptId && (
                      <button
                        type="button"
                        data-testid={`reprint-receipt-button-${tx.receiptId}`}
                        disabled={isLoadingReceipt}
                        onClick={(e) => void handleOpenReceipt(tx.receiptId!, e.currentTarget)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#E9F2F5] border border-[#14566B]/40 text-[#14566B] font-bold rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
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
                lastFocusRef.current?.focus();
              }
            }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto print:static print:inset-auto print:bg-transparent print:p-0 print:block"
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
                <div>
                  <h2 id="finance-receipt-dialog-title" className="text-base font-bold text-[#172A35]">
                    {activeReceipt.headerSnapshot.officeName}
                  </h2>
                  <p className="text-xs text-[#4D606A]">
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
                    lastFocusRef.current?.focus();
                  }}
                  className="px-3 py-2 text-xs text-[#4D606A] hover:text-[#172A35] border border-[#D5DFE3] rounded-[6px] min-h-[44px] print:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
                >
                  ✕ إغلاق
                </button>
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-[#4D606A]">ملف القضية:</dt>
                  <dd className="font-bold text-[#172A35]">
                    <bdi dir="ltr">{activeReceipt.headerSnapshot.matterFileCode}</bdi> — {activeReceipt.headerSnapshot.matterTitle}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#4D606A]">الموكل المسؤول:</dt>
                  <dd className="font-semibold text-[#172A35]">{activeReceipt.headerSnapshot.clientName}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#4D606A]">الدافع الفعلي:</dt>
                  <dd className="font-semibold text-[#172A35]">{activeReceipt.payerName}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#4D606A]">طريقة السداد وتاريخ العملية:</dt>
                  <dd className="font-semibold text-[#172A35]">
                    {PAYMENT_METHOD_LABELS[activeReceipt.paymentMethod]} — <bdi dir="ltr">{formatCairoDateArabic(activeReceipt.headerSnapshot.transactionDate)}</bdi>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#4D606A]">وقت الإصدار (القاهرة):</dt>
                  <dd className="font-semibold text-[#172A35]">
                    <bdi dir="rtl">{formatCairoTimestamp(activeReceipt.issuedAt)}</bdi>
                  </dd>
                </div>
                <div className="flex justify-between gap-2 pt-2 border-t border-[#E8EEF1]">
                  <dt className="font-bold text-[#172A35]">المبلغ المحصل:</dt>
                  <dd className="text-base font-bold text-emerald-800" data-testid="receipt-amount">
                    <bdi dir="ltr">{formatEgp(activeReceipt.amountPiastres)}</bdi>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-bold text-[#172A35]">باقي الأتعاب بعد العملية:</dt>
                  <dd className="font-bold text-[#14566B]" data-testid="receipt-remaining-after">
                    <bdi dir="ltr">{formatEgp(activeReceipt.headerSnapshot.feesRemainingAfterPiastres)}</bdi>
                  </dd>
                </div>
              </dl>

              <div className="p-2.5 bg-[#F9FBFC] border border-[#E8EEF1] rounded text-xs space-y-1">
                <span className="font-bold text-[#172A35] block">تفصيل التوزيع:</span>
                {activeReceipt.headerSnapshot.allocations.map((al) => (
                  <div key={al.feeChargeId} className="flex justify-between gap-2 text-[#4D606A]">
                    <span>قسط #{al.installmentNumber}: {al.description}</span>
                    <strong dir="ltr" className="text-[#172A35]">{formatEgp(al.amountPiastres)}</strong>
                  </div>
                ))}
              </div>

              <div
                data-testid="receipt-administrative-notice"
                className="p-2.5 bg-amber-50 border border-amber-200 text-[#7A4100] rounded text-xs font-semibold flex items-center gap-2"
              >
                <IconWarning className="w-4 h-4 shrink-0" />
                <span>{activeReceipt.administrativeNotice || ADMINISTRATIVE_NOTICE}</span>
              </div>

              <div className="flex justify-end gap-2 print:hidden">
                <button
                  type="button"
                  data-testid="print-receipt-button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B] focus-visible:ring-offset-2"
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
