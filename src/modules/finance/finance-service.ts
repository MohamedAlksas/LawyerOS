import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getPrismaClient } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import {
  formatUtcDateToIsoDate,
  getCairoTodayDateString,
  parseCalendarDateToUtcDate,
} from '@/lib/cairo-date';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  resolveConcurrentIdempotency,
  runWithIdempotencyRetry,
} from '@/lib/idempotency';
import { normalizeArabicDigits, normalizeArabicText } from '@/lib/normalization';
import { assertLinkableDocument } from '@/modules/documents/document-service';
import { assertAuthorized } from '@/modules/identity/authorize';
import type { Actor, Permission } from '@/modules/identity/types';
import { getCairoYear } from '@/modules/matters/file-code-allocator';
import { allocateReceiptNumber } from './receipt-allocator';
import {
  ADMINISTRATIVE_RECEIPT_NOTICE_AR,
  AlreadyPostedError,
  ConcurrencyConflictError,
  DOCUMENTED_FUTURE_TRANSACTION_KINDS,
  EGP_CURRENCY,
  ExcessAllocationError,
  FinanceValidationError,
  ImmutablePostedRecordError,
  MatterArchivedError,
  NotFoundError,
  ScopeMismatchError,
  UnauthorizedError,
  UnsupportedTransactionKindError,
  UnsupportedTransitionError,
  approveFeeAgreementSchema,
  formatEgpPiastres,
  getClientStatementSchema,
  listFinanceOverviewSchema,
  postTransactionSchema,
  saveFeeAgreementDraftSchema,
  type ApproveFeeAgreementInput,
  type ApproveFeeAgreementResult,
  type ClientMatterBalanceDTO,
  type ClientStatementDTO,
  type FeeAgreementDTO,
  type FeeChargeDTO,
  type FinanceExecutionOptions,
  type FinanceOverviewDTO,
  type GetClientStatementParams,
  type ListFinanceOverviewParams,
  type MatterFinanceSummaryDTO,
  type MoneyAccountType,
  type MoneyAllocationDTO,
  type MoneyLineDTO,
  type PaymentMethod,
  type PostTransactionInput,
  type PostTransactionResult,
  type ReceiptDTO,
  type ReceiptHeaderSnapshot,
  type SaveFeeAgreementDraftInput,
  type SelectableFinanceMatterDTO,
  type TransactionDTO,
} from './finance-types';

function getDb(options?: FinanceExecutionOptions): PrismaClient {
  return options?.prismaOverride ?? getPrismaClient();
}

function assertActorAuthorized(actor: Actor | undefined | null, permission: Permission): Actor {
  if (!actor || !actor.id || !actor.role) {
    throw new UnauthorizedError('غير مصرح. يرجى تسجيل الدخول أولاً.');
  }
  assertAuthorized(actor, permission);
  return actor;
}

function assertValidUuid(value: string | undefined | null, label: string): string {
  const parsed = z
    .string()
    .uuid()
    .safeParse(typeof value === 'string' ? value.trim() : value);
  if (!parsed.success) {
    throw new FinanceValidationError(`معرف ${label} غير صالح.`);
  }
  return parsed.data;
}

function formatZodIssues(err: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join('.') || 'input';
    if (!fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

async function runFinanceCommand<T>(
  prisma: PrismaClient,
  params: { actorId: string; commandType: string; key: string; payload: unknown },
  executeTx: (tx: Prisma.TransactionClient, idempotencyRecordId: string) => Promise<{
    value: T;
    resultType: string;
    resultId: string;
    resultPayload: Record<string, unknown>;
  }>,
  loadReplay: (tx: Prisma.TransactionClient, resultId: string, resultPayload: unknown) => Promise<T>
): Promise<T> {
  const runOnce = () =>
    prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, params);
      if (claim.isReplay) {
        if (!claim.resultId) {
          throw new FinanceValidationError('تعذر استرجاع نتيجة العملية المكررة.');
        }
        return loadReplay(tx, claim.resultId, claim.resultPayload);
      }

      const idempRow = await tx.idempotencyRecord.findUniqueOrThrow({
        where: {
          actorId_commandType_key: {
            actorId: params.actorId,
            commandType: params.commandType,
            key: params.key,
          },
        },
        select: { id: true },
      });

      const outcome = await executeTx(tx, idempRow.id);

      await completeIdempotencyKey(tx, {
        actorId: params.actorId,
        commandType: params.commandType,
        key: params.key,
        resultType: outcome.resultType,
        resultId: outcome.resultId,
        resultPayload: outcome.resultPayload,
      });

      return outcome.value;
    });

  return runWithIdempotencyRetry(runOnce, async () => {
    const resolved = await resolveConcurrentIdempotency(prisma, params);
    if (!resolved?.resultId) return { resolved: false };
    const value = await prisma.$transaction((tx) =>
      loadReplay(tx, resolved.resultId!, resolved.resultPayload)
    );
    return { resolved: true, value };
  });
}

async function ensureMatterClientAccount(
  tx: Prisma.TransactionClient,
  type: 'FEE_RECEIVABLE' | 'FEE_BASIS' | 'EXPENSE_RECEIVABLE' | 'CLIENT_ADVANCE',
  matterId: string,
  clientMatterPartyId: string
): Promise<string> {
  const existing = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "money_account"
    WHERE "type" = ${type}::"MoneyAccountType"
      AND "matter_id" = ${matterId}
      AND "client_matter_party_id" = ${clientMatterPartyId}
  `;
  if (existing.length > 0) {
    return existing[0].id;
  }

  const candidateId = crypto.randomUUID();
  await tx.$executeRaw`
    INSERT INTO "money_account" ("id", "type", "matter_id", "client_matter_party_id", "cash_method", "currency", "created_at")
    VALUES (${candidateId}, ${type}::"MoneyAccountType", ${matterId}, ${clientMatterPartyId}, NULL, 'EGP', NOW())
    ON CONFLICT ("type", "matter_id", "client_matter_party_id")
    WHERE "type" IN ('FEE_RECEIVABLE', 'FEE_BASIS', 'EXPENSE_RECEIVABLE', 'CLIENT_ADVANCE')
      AND "matter_id" IS NOT NULL
      AND "client_matter_party_id" IS NOT NULL
    DO NOTHING
  `;

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "money_account"
    WHERE "type" = ${type}::"MoneyAccountType"
      AND "matter_id" = ${matterId}
      AND "client_matter_party_id" = ${clientMatterPartyId}
  `;

  if (!rows || rows.length === 0) {
    throw new Error(`Failed to resolve money account ${type} for matter ${matterId}`);
  }
  return rows[0].id;
}

async function ensureCashClearingAccount(
  tx: Prisma.TransactionClient,
  cashMethod: PaymentMethod
): Promise<string> {
  const existing = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "money_account"
    WHERE "type" = 'CASH_CLEARING'::"MoneyAccountType"
      AND "cash_method" = ${cashMethod}::"PaymentMethod"
  `;
  if (existing.length > 0) {
    return existing[0].id;
  }

  const candidateId = crypto.randomUUID();
  await tx.$executeRaw`
    INSERT INTO "money_account" ("id", "type", "matter_id", "client_matter_party_id", "cash_method", "currency", "created_at")
    VALUES (${candidateId}, 'CASH_CLEARING'::"MoneyAccountType", NULL, NULL, ${cashMethod}::"PaymentMethod", 'EGP', NOW())
    ON CONFLICT ("type", "cash_method")
    WHERE "type" = 'CASH_CLEARING' AND "cash_method" IS NOT NULL
    DO NOTHING
  `;

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "money_account"
    WHERE "type" = 'CASH_CLEARING'::"MoneyAccountType"
      AND "cash_method" = ${cashMethod}::"PaymentMethod"
  `;

  if (!rows || rows.length === 0) {
    throw new Error(`Failed to resolve CASH_CLEARING account for method ${cashMethod}`);
  }
  return rows[0].id;
}

async function computeNetAllocatedMap(
  tx: Prisma.TransactionClient | PrismaClient,
  receivableLineIds: string[]
): Promise<Map<string, bigint>> {
  const map = new Map<string, bigint>();
  if (receivableLineIds.length === 0) return map;

  const allocs = await tx.moneyAllocation.findMany({
    where: {
      receivableLineId: { in: receivableLineIds },
      settlementLine: { transaction: { status: 'POSTED' } },
      OR: [
        { adjustmentTransactionId: null },
        { adjustmentTransaction: { status: 'POSTED' } },
      ],
    },
    select: {
      receivableLineId: true,
      action: true,
      amountPiastres: true,
    },
  });

  for (const row of allocs) {
    const prev = map.get(row.receivableLineId) ?? 0n;
    const delta = row.action === 'APPLY' ? row.amountPiastres : -row.amountPiastres;
    map.set(row.receivableLineId, prev + delta);
  }
  return map;
}

async function loadFeeAgreementsDTO(
  tx: Prisma.TransactionClient | PrismaClient,
  where: Prisma.FeeAgreementWhereInput,
  pagination?: { skip?: number; take?: number }
): Promise<FeeAgreementDTO[]> {
  const rows = await tx.feeAgreement.findMany({
    where,
    include: {
      matter: { select: { fileCode: true, title: true } },
      clientMatterParty: {
        select: {
          partyId: true,
          party: { select: { name: true } },
        },
      },
      charges: {
        orderBy: { installmentNumber: 'asc' },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(pagination?.skip !== undefined ? { skip: pagination.skip } : {}),
    ...(pagination?.take !== undefined ? { take: pagination.take } : {}),
  });

  const receivableLineIds = rows.flatMap((ag) => ag.charges.map((c) => c.receivableLineId));
  const allocatedMap = await computeNetAllocatedMap(tx, receivableLineIds);

  return rows.map((ag) => ({
    id: ag.id,
    matterId: ag.matterId,
    matterFileCode: ag.matter.fileCode,
    matterTitle: ag.matter.title,
    clientMatterPartyId: ag.clientMatterPartyId,
    clientPartyId: ag.clientMatterParty.partyId,
    clientName: ag.clientMatterParty.party.name,
    description: ag.description,
    totalAmountPiastres: ag.totalAmountPiastres.toString(),
    currency: EGP_CURRENCY,
    agreementDate: formatUtcDateToIsoDate(ag.agreementDate) ?? '',
    chargingMethod: ag.chargingMethod,
    agreementDocumentId: ag.agreementDocumentId,
    status: ag.status,
    approvedTransactionId: ag.approvedTransactionId,
    approvedAt: ag.approvedAt ? ag.approvedAt.toISOString() : null,
    approvedById: ag.approvedById,
    notes: ag.notes,
    version: ag.version,
    createdAt: ag.createdAt.toISOString(),
    updatedAt: ag.updatedAt.toISOString(),
    charges: ag.charges.map((c) => {
      const allocated = allocatedMap.get(c.receivableLineId) ?? 0n;
      const remaining = c.amountPiastres - allocated;
      return {
        id: c.id,
        feeAgreementId: c.feeAgreementId,
        matterId: c.matterId,
        clientMatterPartyId: c.clientMatterPartyId,
        clientPartyId: ag.clientMatterParty.partyId,
        clientName: ag.clientMatterParty.party.name,
        installmentNumber: c.installmentNumber,
        description: c.description,
        dueDate: formatUtcDateToIsoDate(c.dueDate),
        amountPiastres: c.amountPiastres.toString(),
        allocatedPiastres: allocated.toString(),
        remainingPiastres: remaining.toString(),
        currency: EGP_CURRENCY,
        receivableLineId: c.receivableLineId,
        createdAt: c.createdAt.toISOString(),
      };
    }),
  }));
}

async function loadTransactionsDTO(
  tx: Prisma.TransactionClient | PrismaClient,
  where: Prisma.MoneyTransactionWhereInput,
  take?: number
): Promise<TransactionDTO[]> {
  const rows = await tx.moneyTransaction.findMany({
    where,
    include: {
      matter: { select: { fileCode: true, title: true } },
      payerParty: { select: { name: true } },
      receipt: { select: { id: true, receiptNumber: true } },
      lines: {
        include: {
          account: { select: { type: true } },
          settlementAllocations: {
            include: {
              receivableLine: {
                include: {
                  feeCharge: { select: { id: true, description: true } },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    ...(take ? { take } : {}),
  });

  return rows.map((row) => {
    const lines: MoneyLineDTO[] = row.lines.map((l) => ({
      id: l.id,
      transactionId: l.transactionId,
      accountId: l.accountId,
      accountType: l.account.type,
      side: l.side,
      amountPiastres: l.amountPiastres.toString(),
      currency: EGP_CURRENCY,
      matterId: l.matterId,
      clientMatterPartyId: l.clientMatterPartyId,
      description: l.description,
    }));

    const allocations: MoneyAllocationDTO[] = row.lines.flatMap((l) =>
      l.settlementAllocations.map((a) => {
        const feeCharge = a.receivableLine.feeCharge ?? null;
        return {
          id: a.id,
          settlementLineId: a.settlementLineId,
          receivableLineId: a.receivableLineId,
          feeChargeId: feeCharge?.id ?? null,
          feeChargeDescription: feeCharge?.description ?? null,
          amountPiastres: a.amountPiastres.toString(),
          currency: EGP_CURRENCY,
          action: a.action,
          createdAt: a.createdAt.toISOString(),
        };
      })
    );

    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      transactionDate: formatUtcDateToIsoDate(row.transactionDate) ?? '',
      currency: EGP_CURRENCY,
      totalAmountPiastres: row.totalAmountPiastres.toString(),
      paymentMethod: row.paymentMethod,
      reference: row.reference,
      description: row.description,
      matterId: row.matterId,
      matterFileCode: row.matter?.fileCode ?? null,
      matterTitle: row.matter?.title ?? null,
      payerPartyId: row.payerPartyId,
      payerName: row.payerParty?.name ?? null,
      postedById: row.postedById,
      postedAt: row.postedAt ? row.postedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      lines,
      allocations,
      receiptId: row.receipt?.id ?? null,
      receiptNumber: row.receipt?.receiptNumber ?? null,
    };
  });
}

function mapReceiptToDTO(row: {
  id: string;
  transactionId: string;
  receiptNumber: string;
  year: number;
  paymentMethod: PaymentMethod;
  payerName: string;
  amountPiastres: bigint;
  issuedAt: Date;
  issuedById: string;
  headerSnapshot: Prisma.JsonValue;
}): ReceiptDTO {
  const rawSnapshot =
    row.headerSnapshot && typeof row.headerSnapshot === 'object' && !Array.isArray(row.headerSnapshot)
      ? (row.headerSnapshot as Record<string, unknown>)
      : {};
  const headerSnapshot: ReceiptHeaderSnapshot = {
    ...(rawSnapshot as unknown as ReceiptHeaderSnapshot),
    allocations: Array.isArray(rawSnapshot.allocations)
      ? (rawSnapshot.allocations as ReceiptHeaderSnapshot['allocations'])
      : [],
  };

  return {
    id: row.id,
    transactionId: row.transactionId,
    receiptNumber: row.receiptNumber,
    year: row.year,
    paymentMethod: row.paymentMethod,
    payerName: row.payerName,
    amountPiastres: row.amountPiastres.toString(),
    currency: EGP_CURRENCY,
    issuedAt: row.issuedAt.toISOString(),
    issuedById: row.issuedById,
    headerSnapshot,
    administrativeNotice: ADMINISTRATIVE_RECEIPT_NOTICE_AR,
  };
}

interface AccountBucketTotals {
  feeReceivableDebit: bigint;
  feeReceivableCredit: bigint;
  expenseReceivableDebit: bigint;
  expenseReceivableCredit: bigint;
  clientAdvanceCredit: bigint;
  clientAdvanceDebit: bigint;
}

function emptyBucket(): AccountBucketTotals {
  return {
    feeReceivableDebit: 0n,
    feeReceivableCredit: 0n,
    expenseReceivableDebit: 0n,
    expenseReceivableCredit: 0n,
    clientAdvanceCredit: 0n,
    clientAdvanceDebit: 0n,
  };
}

function applyLineToBucket(
  bucket: AccountBucketTotals,
  accountType: MoneyAccountType,
  side: 'DEBIT' | 'CREDIT',
  amount: bigint
): void {
  if (accountType === 'FEE_RECEIVABLE') {
    if (side === 'DEBIT') bucket.feeReceivableDebit += amount;
    else bucket.feeReceivableCredit += amount;
  } else if (accountType === 'EXPENSE_RECEIVABLE') {
    if (side === 'DEBIT') bucket.expenseReceivableDebit += amount;
    else bucket.expenseReceivableCredit += amount;
  } else if (accountType === 'CLIENT_ADVANCE') {
    if (side === 'CREDIT') bucket.clientAdvanceCredit += amount;
    else bucket.clientAdvanceDebit += amount;
  }
}

async function computeMatterFinanceSummaryInternal(
  tx: Prisma.TransactionClient | PrismaClient,
  matterId: string
): Promise<MatterFinanceSummaryDTO> {
  const matter = await tx.matter.findUnique({
    where: { id: matterId },
    include: {
      parties: {
        where: { role: 'CLIENT' },
        include: { party: { select: { name: true } } },
        orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!matter) {
    throw new NotFoundError('ملف القضية المطلوب غير موجود.');
  }

  const postedLines = await tx.moneyLine.findMany({
    where: {
      matterId,
      transaction: { status: 'POSTED' },
    },
    include: {
      account: { select: { type: true } },
    },
  });

  const matterBucket = emptyBucket();
  const perClientBuckets = new Map<string, AccountBucketTotals>();

  for (const line of postedLines) {
    applyLineToBucket(matterBucket, line.account.type, line.side, line.amountPiastres);
    if (line.clientMatterPartyId) {
      const cb = perClientBuckets.get(line.clientMatterPartyId) ?? emptyBucket();
      applyLineToBucket(cb, line.account.type, line.side, line.amountPiastres);
      perClientBuckets.set(line.clientMatterPartyId, cb);
    }
  }

  const clients: ClientMatterBalanceDTO[] = matter.parties.map((mp) => {
    const b = perClientBuckets.get(mp.id) ?? emptyBucket();
    const feesDue = b.feeReceivableDebit - b.feeReceivableCredit;
    const expensesDue = b.expenseReceivableDebit - b.expenseReceivableCredit;
    const advanceAvail = b.clientAdvanceCredit - b.clientAdvanceDebit;
    return {
      clientMatterPartyId: mp.id,
      partyId: mp.partyId,
      partyName: mp.party.name,
      isPrimaryContact: mp.isPrimaryContact,
      billingEnabled: mp.billingEnabled,
      feesChargedPiastres: b.feeReceivableDebit.toString(),
      feesCollectedPiastres: b.feeReceivableCredit.toString(),
      feesDuePiastres: feesDue.toString(),
      expensesDuePiastres: expensesDue.toString(),
      advanceAvailablePiastres: advanceAvail.toString(),
    };
  });

  const agreements = await loadFeeAgreementsDTO(tx, { matterId });
  const charges = agreements
    .filter((ag) => ag.status === 'APPROVED')
    .flatMap((ag) => ag.charges);
  const transactions = await loadTransactionsDTO(tx, { matterId, status: 'POSTED' });

  return {
    matterId: matter.id,
    matterFileCode: matter.fileCode,
    matterTitle: matter.title,
    matterStatus: matter.status,
    currency: EGP_CURRENCY,
    feesChargedPiastres: matterBucket.feeReceivableDebit.toString(),
    feesCollectedPiastres: matterBucket.feeReceivableCredit.toString(),
    feesDuePiastres: (matterBucket.feeReceivableDebit - matterBucket.feeReceivableCredit).toString(),
    expensesDuePiastres: (
      matterBucket.expenseReceivableDebit - matterBucket.expenseReceivableCredit
    ).toString(),
    advanceAvailablePiastres: (
      matterBucket.clientAdvanceCredit - matterBucket.clientAdvanceDebit
    ).toString(),
    clients,
    agreements,
    charges,
    transactions,
  };
}
export async function saveFeeAgreementDraft(
  actor: Actor,
  rawInput: SaveFeeAgreementDraftInput,
  options?: FinanceExecutionOptions
): Promise<FeeAgreementDTO> {
  assertActorAuthorized(actor, 'WRITE_FINANCE');

  const parsed = saveFeeAgreementDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new FinanceValidationError('بيانات اتفاق الأتعاب غير صالحة.', formatZodIssues(parsed.error));
  }
  const input = parsed.data;
  const totalAmount = BigInt(input.totalAmountPiastres);
  const agreementDateUtc = parseCalendarDateToUtcDate(input.agreementDate);
  if (!agreementDateUtc) {
    throw new FinanceValidationError('تاريخ الاتفاق غير صالح.');
  }

  if (input.agreementDocumentId) {
    assertAuthorized(actor, 'READ_DOCUMENTS');
  }

  const intent = {
    feeAgreementId: input.feeAgreementId ?? null,
    expectedVersion: input.expectedVersion ?? null,
    matterId: input.matterId,
    clientMatterPartyId: input.clientMatterPartyId,
    description: input.description,
    totalAmountPiastres: input.totalAmountPiastres,
    agreementDate: input.agreementDate,
    chargingMethod: input.chargingMethod,
    agreementDocumentId: input.agreementDocumentId ?? null,
    notes: input.notes ?? null,
  };

  const prisma = getDb(options);

  return runFinanceCommand(
    prisma,
    {
      actorId: actor.id,
      commandType: 'saveFeeAgreementDraft',
      key: input.idempotencyKey,
      payload: intent,
    },
    async (tx) => {
      const matters = await tx.$queryRaw<Array<{ id: string; status: string; archivedAt: Date | null }>>`
        SELECT "id", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE
      `;
      const matter = matters[0];
      if (!matter) {
        throw new NotFoundError('ملف القضية المطلوب غير موجود.');
      }
      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError();
      }

      const clientLinks = await tx.$queryRaw<
        Array<{ id: string; matterId: string; partyId: string; role: string }>
      >`
        SELECT "id", "matterId", "partyId", "role"
        FROM "matter_party"
        WHERE "id" = ${input.clientMatterPartyId}
        FOR UPDATE
      `;
      const clientLink = clientLinks[0];
      if (!clientLink) {
        throw new NotFoundError('رابط الموكل بالملف غير موجود.');
      }
      if (clientLink.matterId !== input.matterId) {
        throw new ScopeMismatchError('الموكل المحدد لا يتبع ملف هذه القضية.');
      }
      if (clientLink.role !== 'CLIENT') {
        throw new FinanceValidationError('الطرف المحدد في اتفاق الأتعاب يجب أن يكون موكلاً في الملف.');
      }

      const partyRows = await tx.$queryRaw<Array<{ id: string; archivedAt: Date | null }>>`
        SELECT "id", "archivedAt"
        FROM "party"
        WHERE "id" = ${clientLink.partyId}
        FOR NO KEY UPDATE
      `;
      const party = partyRows[0];
      if (!party || party.archivedAt !== null) {
        throw new FinanceValidationError('الموكل المحدد مؤرشف ولا يمكن إنشاء أو تعديل اتفاق أتعاب له.');
      }

      let existing: {
        id: string;
        matter_id: string;
        status: string;
        version: number;
        agreement_document_id: string | null;
      } | null = null;

      if (input.feeAgreementId) {
        const existingRows = await tx.$queryRaw<
          Array<{
            id: string;
            matter_id: string;
            status: string;
            version: number;
            agreement_document_id: string | null;
          }>
        >`
          SELECT "id", "matter_id", "status"::text, "version", "agreement_document_id"
          FROM "fee_agreement"
          WHERE "id" = ${input.feeAgreementId}
          FOR UPDATE
        `;
        existing = existingRows[0] ?? null;
        if (!existing) {
          throw new NotFoundError('مسودة اتفاق الأتعاب غير موجودة.');
        }
        if (existing.matter_id !== input.matterId) {
          throw new ScopeMismatchError('اتفاق الأتعاب لا يتبع ملف القضية المحدد.');
        }
        if (existing.status === 'APPROVED') {
          throw new AlreadyPostedError();
        }
        if (existing.status !== 'DRAFT') {
          throw new UnsupportedTransitionError('لا يمكن تعديل اتفاق أتعاب ملغى.');
        }
        if (existing.version !== input.expectedVersion) {
          throw new ConcurrencyConflictError();
        }
      }

      if (input.agreementDocumentId) {
        await assertLinkableDocument(
          tx,
          input.agreementDocumentId,
          {
            kind: 'MATTER',
            matterId: input.matterId,
          },
          {
            allowExistingArchived:
              existing !== null && input.agreementDocumentId === existing.agreement_document_id,
          }
        );
      }

      let agreementId: string;
      let nextVersion = 1;

      if (existing) {
        nextVersion = existing.version + 1;
        await tx.feeAgreement.update({
          where: { id: existing.id },
          data: {
            clientMatterPartyId: input.clientMatterPartyId,
            description: input.description,
            totalAmountPiastres: totalAmount,
            agreementDate: agreementDateUtc,
            chargingMethod: input.chargingMethod,
            agreementDocumentId: input.agreementDocumentId ?? null,
            notes: input.notes ?? null,
            version: nextVersion,
            updatedById: actor.id,
          },
        });
        agreementId = existing.id;
      } else {
        const created = await tx.feeAgreement.create({
          data: {
            matterId: input.matterId,
            clientMatterPartyId: input.clientMatterPartyId,
            description: input.description,
            totalAmountPiastres: totalAmount,
            currency: EGP_CURRENCY,
            agreementDate: agreementDateUtc,
            chargingMethod: input.chargingMethod,
            agreementDocumentId: input.agreementDocumentId ?? null,
            status: 'DRAFT',
            notes: input.notes ?? null,
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        agreementId = created.id;
      }

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: input.feeAgreementId ? 'UPDATE_FEE_AGREEMENT_DRAFT' : 'CREATE_FEE_AGREEMENT_DRAFT',
          entityType: 'FeeAgreement',
          entityId: agreementId,
          changedFields: {
            matterId: input.matterId,
            clientMatterPartyId: input.clientMatterPartyId,
            totalAmountPiastres: totalAmount.toString(),
            chargingMethod: input.chargingMethod,
            agreementDocumentId: input.agreementDocumentId ?? null,
            status: 'DRAFT',
            version: nextVersion,
          },
        },
        { simulateFailure: options?.simulateFailure }
      );

      const [dto] = await loadFeeAgreementsDTO(tx, { id: agreementId });
      return {
        value: dto,
        resultType: 'FeeAgreement',
        resultId: dto.id,
        resultPayload: {
          feeAgreementId: dto.id,
          version: dto.version,
          status: dto.status,
        },
      };
    },
    async (tx, resultId) => {
      const [dto] = await loadFeeAgreementsDTO(tx, { id: resultId });
      if (!dto) throw new NotFoundError('اتفاق الأتعاب غير موجود.');
      return dto;
    }
  );
}

export async function approveFeeAgreement(
  actor: Actor,
  rawInput: ApproveFeeAgreementInput,
  options?: FinanceExecutionOptions
): Promise<ApproveFeeAgreementResult> {
  assertActorAuthorized(actor, 'WRITE_FINANCE');

  const parsed = approveFeeAgreementSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new FinanceValidationError('بيانات اعتماد اتفاق الأتعاب غير صالحة.', formatZodIssues(parsed.error));
  }
  const input = parsed.data;

  const intent = {
    feeAgreementId: input.feeAgreementId,
    expectedVersion: input.expectedVersion,
    transactionDate: input.transactionDate ?? null,
    installments: input.installments?.length ? input.installments : null,
  };

  const prisma = getDb(options);

  return runFinanceCommand(
    prisma,
    {
      actorId: actor.id,
      commandType: 'approveFeeAgreement',
      key: input.idempotencyKey,
      payload: intent,
    },
    async (tx, idempotencyRecordId) => {
      // Non-locking scope discovery first so locks strictly follow: matter -> matter_party -> fee_agreement
      const scopeRows = await tx.$queryRaw<
        Array<{ matter_id: string; client_matter_party_id: string }>
      >`
        SELECT "matter_id", "client_matter_party_id"
        FROM public."fee_agreement"
        WHERE "id" = ${input.feeAgreementId}
      `;
      const scope = scopeRows[0];
      if (!scope) {
        throw new NotFoundError('اتفاق الأتعاب المطلوب غير موجود.');
      }

      const matters = await tx.$queryRaw<Array<{ id: string; status: string; archivedAt: Date | null }>>`
        SELECT "id", "status", "archivedAt" FROM public."matter" WHERE "id" = ${scope.matter_id} FOR UPDATE
      `;
      const matter = matters[0];
      if (!matter) {
        throw new NotFoundError('ملف القضية غير موجود.');
      }
      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError();
      }

      const clientLinks = await tx.$queryRaw<Array<{ id: string; matterId: string; role: string }>>`
        SELECT "id", "matterId", "role"
        FROM public."matter_party"
        WHERE "id" = ${scope.client_matter_party_id}
        FOR UPDATE
      `;
      const clientLink = clientLinks[0];

      const agRows = await tx.$queryRaw<
        Array<{
          id: string;
          matter_id: string;
          client_matter_party_id: string;
          description: string;
          total_amount_piastres: bigint;
          agreement_date: Date;
          charging_method: string;
          status: string;
          version: number;
        }>
      >`
        SELECT "id", "matter_id", "client_matter_party_id", "description",
               "total_amount_piastres", "agreement_date", "charging_method"::text,
               "status"::text, "version"
        FROM public."fee_agreement"
        WHERE "id" = ${input.feeAgreementId}
        FOR UPDATE
      `;
      const ag = agRows[0];
      if (!ag) {
        throw new NotFoundError('اتفاق الأتعاب المطلوب غير موجود.');
      }
      if (ag.status === 'APPROVED') {
        throw new AlreadyPostedError();
      }
      if (ag.status !== 'DRAFT') {
        throw new UnsupportedTransitionError('لا يمكن اعتماد اتفاق أتعاب ملغى.');
      }
      if (ag.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }
      if (
        ag.matter_id !== scope.matter_id ||
        ag.client_matter_party_id !== scope.client_matter_party_id
      ) {
        throw new ConcurrencyConflictError();
      }
      if (!clientLink) {
        throw new ConcurrencyConflictError();
      }
      if (clientLink.matterId !== ag.matter_id || clientLink.role !== 'CLIENT') {
        throw new ScopeMismatchError('الموكل المسؤول لم يعد صالحاً في هذا الملف.');
      }

      const agreementTotal = BigInt(ag.total_amount_piastres);
      const installmentPlan =
        input.installments && input.installments.length > 0
          ? input.installments.map((inst, idx) => ({
              installmentNumber: idx + 1,
              description: inst.description,
              dueDate: inst.dueDate ?? null,
              amountPiastres: BigInt(inst.amountPiastres),
            }))
          : ag.charging_method === 'INSTALLMENTS'
            ? (() => {
                throw new FinanceValidationError(
                  'طريقة السداد بالأقساط تتطلب تحديد قسط واحد على الأقل عند الاعتماد.',
                  { installments: 'أدخل تفاصيل الأقساط بحيث يساوي مجموعها قيمة الاتفاق' }
                );
              })()
            : [
                {
                  installmentNumber: 1,
                  description: ag.description,
                  dueDate: null as string | null,
                  amountPiastres: agreementTotal,
                },
              ];

      const installmentSum = installmentPlan.reduce((sum, item) => sum + item.amountPiastres, 0n);
      if (installmentSum !== agreementTotal) {
        throw new FinanceValidationError(
          `مجموع مبالغ الأقساط (${formatEgpPiastres(installmentSum)}) لا يطابق إجمالي الاتفاق (${formatEgpPiastres(agreementTotal)}).`,
          { installments: 'يجب أن يساوي مجموع الأقساط إجمالي قيمة اتفاق الأتعاب' }
        );
      }

      const txDateStr =
        input.transactionDate ?? formatUtcDateToIsoDate(ag.agreement_date) ?? getCairoTodayDateString();
      const txDateUtc = parseCalendarDateToUtcDate(txDateStr);
      if (!txDateUtc) {
        throw new FinanceValidationError('تاريخ الترحيل غير صالح.');
      }

      const feeReceivableAccountId = await ensureMatterClientAccount(
        tx,
        'FEE_RECEIVABLE',
        ag.matter_id,
        ag.client_matter_party_id
      );
      const feeBasisAccountId = await ensureMatterClientAccount(
        tx,
        'FEE_BASIS',
        ag.matter_id,
        ag.client_matter_party_id
      );

      const postedAt = new Date();
      const moneyTx = await tx.moneyTransaction.create({
        data: {
          kind: 'FEE_CHARGE',
          status: 'POSTED',
          transactionDate: txDateUtc,
          currency: EGP_CURRENCY,
          totalAmountPiastres: agreementTotal,
          description: ag.description,
          matterId: ag.matter_id,
          idempotencyRecordId,
          postedById: actor.id,
          postedAt,
          createdById: actor.id,
        },
      });

      const moneyLineRows: Prisma.MoneyLineCreateManyInput[] = [];
      const feeChargeRows: Prisma.FeeChargeCreateManyInput[] = [];

      for (const item of installmentPlan) {
        const receivableLineId = crypto.randomUUID();
        moneyLineRows.push({
          id: receivableLineId,
          transactionId: moneyTx.id,
          accountId: feeReceivableAccountId,
          side: 'DEBIT',
          amountPiastres: item.amountPiastres,
          currency: EGP_CURRENCY,
          matterId: ag.matter_id,
          clientMatterPartyId: ag.client_matter_party_id,
          description: item.description,
        });

        feeChargeRows.push({
          id: crypto.randomUUID(),
          feeAgreementId: ag.id,
          matterId: ag.matter_id,
          clientMatterPartyId: ag.client_matter_party_id,
          installmentNumber: item.installmentNumber,
          description: item.description,
          dueDate: parseCalendarDateToUtcDate(item.dueDate),
          amountPiastres: item.amountPiastres,
          currency: EGP_CURRENCY,
          receivableLineId,
          createdById: actor.id,
        });
      }

      moneyLineRows.push({
        id: crypto.randomUUID(),
        transactionId: moneyTx.id,
        accountId: feeBasisAccountId,
        side: 'CREDIT',
        amountPiastres: agreementTotal,
        currency: EGP_CURRENCY,
        matterId: ag.matter_id,
        clientMatterPartyId: ag.client_matter_party_id,
        description: ag.description,
      });

      await tx.moneyLine.createMany({ data: moneyLineRows });
      await tx.feeCharge.createMany({ data: feeChargeRows });

      const nextVersion = ag.version + 1;
      await tx.feeAgreement.update({
        where: { id: ag.id },
        data: {
          status: 'APPROVED',
          approvedTransactionId: moneyTx.id,
          approvedAt: postedAt,
          approvedById: actor.id,
          version: nextVersion,
          updatedById: actor.id,
        },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'APPROVE_FEE_AGREEMENT',
          entityType: 'FeeAgreement',
          entityId: ag.id,
          changedFields: {
            matterId: ag.matter_id,
            clientMatterPartyId: ag.client_matter_party_id,
            totalAmountPiastres: agreementTotal.toString(),
            installmentCount: installmentPlan.length,
            approvedTransactionId: moneyTx.id,
            version: nextVersion,
          },
        },
        { simulateFailure: options?.simulateFailure }
      );

      const [feeAgreement] = await loadFeeAgreementsDTO(tx, { id: ag.id });
      const [transaction] = await loadTransactionsDTO(tx, { id: moneyTx.id });

      return {
        value: {
          feeAgreement,
          transaction,
          charges: feeAgreement.charges,
        },
        resultType: 'FeeAgreementApproval',
        resultId: ag.id,
        resultPayload: {
          feeAgreementId: ag.id,
          transactionId: moneyTx.id,
          version: nextVersion,
        },
      };
    },
    async (tx, resultId) => {
      const [feeAgreement] = await loadFeeAgreementsDTO(tx, { id: resultId });
      if (!feeAgreement || !feeAgreement.approvedTransactionId) {
        throw new NotFoundError('اتفاق الأتعاب المعتمد غير موجود.');
      }
      const [transaction] = await loadTransactionsDTO(tx, {
        id: feeAgreement.approvedTransactionId,
      });
      return {
        feeAgreement,
        transaction,
        charges: feeAgreement.charges,
      };
    }
  );
}
export async function postTransaction(
  actor: Actor,
  rawInput: PostTransactionInput,
  options?: FinanceExecutionOptions
): Promise<PostTransactionResult> {
  assertActorAuthorized(actor, 'WRITE_FINANCE');

  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new FinanceValidationError('بيانات الحركة المالية غير صالحة.');
  }

  const rawKind = (rawInput as Record<string, unknown>).kind;
  if (rawKind === 'OFFICE_EXPENSE') {
    throw new UnsupportedTransactionKindError(
      'مصاريف التشغيل الإدارية للمكتب (OFFICE_EXPENSE) مستبعدة من النظام وفق قرار ADR 0004 ولا يمكن تسجيلها.'
    );
  }
  if (rawKind !== 'FEE_PAYMENT') {
    if (
      typeof rawKind === 'string' &&
      (DOCUMENTED_FUTURE_TRANSACTION_KINDS as readonly string[]).includes(rawKind)
    ) {
      throw new UnsupportedTransactionKindError(
        `نوع الحركة المالية (${rawKind}) غير مفعل في هذه المرحلة (تحصيل الأتعاب فقط متاح حالياً).`
      );
    }
    throw new UnsupportedTransactionKindError('نوع الحركة المالية غير مدعوم أو غير صالح.');
  }

  const parsed = postTransactionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new FinanceValidationError('بيانات تحصيل الأتعاب غير صالحة.', formatZodIssues(parsed.error));
  }
  const input = parsed.data;
  const totalAmount = BigInt(input.totalAmountPiastres);

  if (input.lines !== undefined) {
    const allowedSidesOk =
      input.lines.length === 2 &&
      input.lines.some(
        (l) =>
          l.side === 'DEBIT' &&
          (!l.accountType || l.accountType === 'CASH_CLEARING') &&
          BigInt(l.amountPiastres) === totalAmount
      ) &&
      input.lines.some(
        (l) =>
          l.side === 'CREDIT' &&
          (!l.accountType || l.accountType === 'FEE_RECEIVABLE') &&
          BigInt(l.amountPiastres) === totalAmount
      );
    if (!allowedSidesOk) {
      throw new FinanceValidationError(
        'تركيب الحسابات المدخلة لا يطابق قيد تحصيل الأتعاب المتوازن.',
        { lines: 'تحصيل الأتعاب يتطلب مديناً في حساب الصندوق/التحصيل ودائناً في ذمم الأتعاب بنفس المبلغ' }
      );
    }
  }

  const txDateUtc = parseCalendarDateToUtcDate(input.transactionDate);
  if (!txDateUtc) {
    throw new FinanceValidationError('تاريخ الحركة المالية غير صالح.');
  }

  const resolvedDescription =
    input.description && input.description.length > 0
      ? input.description
      : 'تحصيل دفعة أتعاب';

  const intent = {
    kind: input.kind,
    matterId: input.matterId,
    clientMatterPartyId: input.clientMatterPartyId,
    payerPartyId: input.payerPartyId ?? null,
    transactionDate: input.transactionDate,
    paymentMethod: input.paymentMethod,
    totalAmountPiastres: input.totalAmountPiastres,
    reference: input.reference ?? null,
    description: resolvedDescription,
    allocations: [...input.allocations]
      .sort((a, b) => a.feeChargeId.localeCompare(b.feeChargeId))
      .map((a) => ({
        feeChargeId: a.feeChargeId,
        amountPiastres: a.amountPiastres,
      })),
    lines: input.lines ?? null,
  };

  const prisma = getDb(options);

  const posted = await runFinanceCommand<{
    transactionId: string;
    matterId: string;
    receipt: ReceiptDTO;
  }>(
    prisma,
    {
      actorId: actor.id,
      commandType: 'postTransaction',
      key: input.idempotencyKey,
      payload: intent,
    },
    async (tx, idempotencyRecordId) => {
      const matters = await tx.$queryRaw<
        Array<{ id: string; fileCode: string; title: string; status: string; archivedAt: Date | null }>
      >`
        SELECT "id", "fileCode", "title", "status", "archivedAt"
        FROM "matter"
        WHERE "id" = ${input.matterId}
        FOR UPDATE
      `;
      const matter = matters[0];
      if (!matter) {
        throw new NotFoundError('ملف القضية المطلوب غير موجود.');
      }
      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError();
      }

      const clientLinks = await tx.$queryRaw<
        Array<{ id: string; matterId: string; partyId: string; role: string }>
      >`
        SELECT "id", "matterId", "partyId", "role"
        FROM "matter_party"
        WHERE "id" = ${input.clientMatterPartyId}
        FOR UPDATE
      `;
      const clientLink = clientLinks[0];
      if (!clientLink) {
        throw new NotFoundError('رابط الموكل بالملف غير موجود.');
      }
      if (clientLink.matterId !== input.matterId) {
        throw new ScopeMismatchError('الموكل المحدد لا يتبع ملف هذه القضية.');
      }
      if (clientLink.role !== 'CLIENT') {
        throw new FinanceValidationError('الطرف المخصص له السداد يجب أن يكون موكلاً في الملف.');
      }

      const clientParty = await tx.party.findUniqueOrThrow({
        where: { id: clientLink.partyId },
        select: { id: true, name: true },
      });

      let payerParty: { id: string; name: string };
      if (input.payerPartyId) {
        const payerRows = await tx.$queryRaw<
          Array<{ id: string; name: string; archivedAt: Date | null }>
        >`
          SELECT "id", "name", "archivedAt"
          FROM "party"
          WHERE "id" = ${input.payerPartyId}
          FOR NO KEY UPDATE
        `;
        const foundPayer = payerRows[0];
        if (!foundPayer) {
          throw new NotFoundError('طرف الدافع المحدد غير موجود.');
        }
        if (foundPayer.archivedAt !== null) {
          throw new FinanceValidationError('طرف الدافع المحدد مؤرشف ولا يمكن تسجيل سداد باسمه.');
        }
        payerParty = { id: foundPayer.id, name: foundPayer.name };
      } else {
        payerParty = clientParty;
      }

      // Non-locking pre-check so foreign-matter or unknown charges fail fast before acquiring locks
      const requestedChargeIds = input.allocations.map((a) => a.feeChargeId).sort();
      const precheckCharges = await tx.$queryRaw<
        Array<{
          id: string;
          matter_id: string;
          client_matter_party_id: string;
          agreement_status: string;
        }>
      >`
        SELECT fc."id", fc."matter_id", fc."client_matter_party_id",
               fa."status"::text AS agreement_status
        FROM "fee_charge" fc
        JOIN "fee_agreement" fa ON fa."id" = fc."fee_agreement_id"
        WHERE fc."id" = ANY(${requestedChargeIds}::text[])
      `;
      if (precheckCharges.length !== requestedChargeIds.length) {
        throw new NotFoundError('أحد بنود الأتعاب المحددة غير موجود.');
      }
      for (const pre of precheckCharges) {
        if (
          pre.matter_id !== input.matterId ||
          pre.client_matter_party_id !== input.clientMatterPartyId
        ) {
          throw new ScopeMismatchError('بند الأتعاب المحدد لا يخص هذا الموكل أو ملف هذه القضية.');
        }
        if (pre.agreement_status !== 'APPROVED') {
          throw new UnsupportedTransitionError('لا يمكن التحصيل على اتفاق أتعاب غير معتمد.');
        }
      }

      // Lock scoped FeeCharge rows in deterministic ID order to serialize concurrent collections
      const lockedCharges = await tx.$queryRaw<
        Array<{
          id: string;
          fee_agreement_id: string;
          matter_id: string;
          client_matter_party_id: string;
          installment_number: number;
          description: string;
          amount_piastres: bigint;
          receivable_line_id: string;
          agreement_status: string;
        }>
      >`
        SELECT fc."id", fc."fee_agreement_id", fc."matter_id", fc."client_matter_party_id",
               fc."installment_number", fc."description", fc."amount_piastres", fc."receivable_line_id",
               fa."status"::text AS agreement_status
        FROM "fee_charge" fc
        JOIN "fee_agreement" fa ON fa."id" = fc."fee_agreement_id"
        WHERE fc."id" = ANY(${requestedChargeIds}::text[])
          AND fc."matter_id" = ${input.matterId}
          AND fc."client_matter_party_id" = ${input.clientMatterPartyId}
        ORDER BY fc."id" ASC
        FOR UPDATE OF fc
      `;

      if (lockedCharges.length !== requestedChargeIds.length) {
        throw new ConcurrencyConflictError();
      }

      const chargeById = new Map(lockedCharges.map((c) => [c.id, c]));
      const receivableLineIds = lockedCharges.map((c) => c.receivable_line_id);
      const allocatedMap = await computeNetAllocatedMap(tx, receivableLineIds);

      const snapshotAllocations: ReceiptHeaderSnapshot['allocations'] = [];

      for (const alloc of input.allocations) {
        const charge = chargeById.get(alloc.feeChargeId)!;
        if (
          charge.matter_id !== input.matterId ||
          charge.client_matter_party_id !== input.clientMatterPartyId
        ) {
          throw new ScopeMismatchError('بند الأتعاب المحدد لا يخص هذا الموكل أو ملف هذه القضية.');
        }
        if (charge.agreement_status !== 'APPROVED') {
          throw new UnsupportedTransitionError('لا يمكن التحصيل على اتفاق أتعاب غير معتمد.');
        }

        const chargeAmount = BigInt(charge.amount_piastres);
        const alreadyAllocated = allocatedMap.get(charge.receivable_line_id) ?? 0n;
        const remaining = chargeAmount - alreadyAllocated;
        const requested = BigInt(alloc.amountPiastres);

        if (requested > remaining) {
          throw new ExcessAllocationError(
            `المبلغ المطلوب تحصيله (${formatEgpPiastres(requested)}) يتجاوز الرصيد المستحق على البند (${formatEgpPiastres(remaining)}). لا يتم تحويل الفائض تلقائياً إلى دفعة مقدمة.`
          );
        }

        snapshotAllocations.push({
          feeChargeId: charge.id,
          installmentNumber: charge.installment_number,
          description: charge.description,
          amountPiastres: requested.toString(),
        });
      }

      const cashClearingAccountId = await ensureCashClearingAccount(tx, input.paymentMethod);
      const feeReceivableAccountId = await ensureMatterClientAccount(
        tx,
        'FEE_RECEIVABLE',
        input.matterId,
        input.clientMatterPartyId
      );

      const postedAt = new Date();
      const moneyTx = await tx.moneyTransaction.create({
        data: {
          kind: 'FEE_PAYMENT',
          status: 'POSTED',
          transactionDate: txDateUtc,
          currency: EGP_CURRENCY,
          totalAmountPiastres: totalAmount,
          paymentMethod: input.paymentMethod,
          reference: input.reference ?? null,
          description: resolvedDescription,
          matterId: input.matterId,
          payerPartyId: payerParty.id,
          idempotencyRecordId,
          postedById: actor.id,
          postedAt,
          createdById: actor.id,
        },
      });

      const debitLineId = crypto.randomUUID();
      const creditLineId = crypto.randomUUID();
      await tx.moneyLine.createMany({
        data: [
          {
            id: debitLineId,
            transactionId: moneyTx.id,
            accountId: cashClearingAccountId,
            side: 'DEBIT',
            amountPiastres: totalAmount,
            currency: EGP_CURRENCY,
            matterId: null,
            clientMatterPartyId: null,
            description: resolvedDescription,
          },
          {
            id: creditLineId,
            transactionId: moneyTx.id,
            accountId: feeReceivableAccountId,
            side: 'CREDIT',
            amountPiastres: totalAmount,
            currency: EGP_CURRENCY,
            matterId: input.matterId,
            clientMatterPartyId: input.clientMatterPartyId,
            description: resolvedDescription,
          },
        ],
      });

      await tx.moneyAllocation.createMany({
        data: input.allocations.map((alloc) => {
          const charge = chargeById.get(alloc.feeChargeId)!;
          return {
            settlementLineId: creditLineId,
            receivableLineId: charge.receivable_line_id,
            amountPiastres: BigInt(alloc.amountPiastres),
            currency: EGP_CURRENCY,
            action: 'APPLY',
            createdById: actor.id,
          };
        }),
      });

      const feeSumRows = await tx.$queryRaw<Array<{ fees_remaining: string }>>`
        SELECT (
          COALESCE(SUM(CASE WHEN ml."side" = 'DEBIT'::"MoneyLineSide" THEN ml."amount_piastres" ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN ml."side" = 'CREDIT'::"MoneyLineSide" THEN ml."amount_piastres" ELSE 0 END), 0)
        )::text AS fees_remaining
        FROM public."money_line" ml
        JOIN public."money_account" ma ON ma."id" = ml."account_id"
        JOIN public."money_transaction" mt ON mt."id" = ml."transaction_id"
        WHERE ml."matter_id" = ${input.matterId}
          AND ml."client_matter_party_id" = ${input.clientMatterPartyId}
          AND ma."type" = 'FEE_RECEIVABLE'::"MoneyAccountType"
          AND mt."status" = 'POSTED'::"MoneyTransactionStatus"
      `;
      const feesRemainingAfter = BigInt(feeSumRows[0]?.fees_remaining ?? '0');

      const officeSettings = await tx.officeSettings.findUnique({
        where: { id: 'singleton' },
      });

      const { year, receiptNumber } = await allocateReceiptNumber(tx, getCairoYear(postedAt));

      const headerSnapshot: ReceiptHeaderSnapshot = {
        officeName: officeSettings?.officeName ?? 'مكتب المحاماة',
        lawyerName: officeSettings?.lawyerName ?? null,
        phone: officeSettings?.phone ?? null,
        address: officeSettings?.address ?? null,
        matterId: matter.id,
        matterFileCode: matter.fileCode,
        matterTitle: matter.title,
        clientMatterPartyId: clientLink.id,
        clientName: clientParty.name,
        payerPartyId: payerParty.id,
        payerName: payerParty.name,
        paymentMethod: input.paymentMethod,
        transactionDate: input.transactionDate,
        reference: input.reference ?? null,
        description: resolvedDescription,
        allocations: snapshotAllocations,
        feesRemainingAfterPiastres: feesRemainingAfter.toString(),
        administrativeNotice: ADMINISTRATIVE_RECEIPT_NOTICE_AR,
      };

      const receipt = await tx.receipt.create({
        data: {
          transactionId: moneyTx.id,
          receiptNumber,
          year,
          paymentMethod: input.paymentMethod,
          payerName: payerParty.name,
          amountPiastres: totalAmount,
          currency: EGP_CURRENCY,
          issuedAt: postedAt,
          issuedById: actor.id,
          headerSnapshot: headerSnapshot as unknown as Prisma.InputJsonValue,
        },
      });

      // NOTE: Use receiptNumber (never a field literally named "number", which audit.ts masks)
      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'POST_FEE_PAYMENT',
          entityType: 'MoneyTransaction',
          entityId: moneyTx.id,
          changedFields: {
            kind: 'FEE_PAYMENT',
            matterId: input.matterId,
            clientMatterPartyId: input.clientMatterPartyId,
            payerPartyId: payerParty.id,
            totalAmountPiastres: totalAmount.toString(),
            paymentMethod: input.paymentMethod,
            receiptId: receipt.id,
            receiptNumber: receipt.receiptNumber,
          },
        },
        { simulateFailure: options?.simulateFailure }
      );

      return {
        value: {
          transactionId: moneyTx.id,
          matterId: input.matterId,
          receipt: mapReceiptToDTO(receipt),
        },
        resultType: 'MoneyTransaction',
        resultId: moneyTx.id,
        resultPayload: {
          transactionId: moneyTx.id,
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          matterId: input.matterId,
        },
      };
    },
    async (tx, resultId, resultPayload) => {
      const payloadObj =
        resultPayload && typeof resultPayload === 'object'
          ? (resultPayload as Record<string, unknown>)
          : {};
      const payloadMatterId =
        typeof payloadObj.matterId === 'string' ? payloadObj.matterId : null;
      const receipt = await tx.receipt.findUniqueOrThrow({
        where: { transactionId: resultId },
      });
      const resolvedMatterId =
        payloadMatterId ??
        (
          await tx.moneyTransaction.findUniqueOrThrow({
            where: { id: resultId },
            select: { matterId: true },
          })
        ).matterId;
      if (!resolvedMatterId) {
        throw new NotFoundError('الحركة المالية غير موجودة.');
      }
      return {
        transactionId: resultId,
        matterId: resolvedMatterId,
        receipt: mapReceiptToDTO(receipt),
      };
    }
  );

  return prisma.$transaction(
    async (tx) => {
      const [transaction] = await loadTransactionsDTO(tx, { id: posted.transactionId });
      if (!transaction) {
        throw new NotFoundError('الحركة المالية غير موجودة.');
      }
      const matterSummary = await computeMatterFinanceSummaryInternal(tx, posted.matterId);
      return {
        transaction,
        receipt: posted.receipt,
        matterSummary,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

export async function getMatterFinanceSummary(
  actor: Actor,
  matterId: string,
  options?: FinanceExecutionOptions
): Promise<MatterFinanceSummaryDTO> {
  assertActorAuthorized(actor, 'READ_FINANCE');
  const validMatterId = assertValidUuid(matterId, 'ملف القضية');
  const prisma = getDb(options);
  return prisma.$transaction(
    (tx) => computeMatterFinanceSummaryInternal(tx, validMatterId),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

export async function getClientStatement(
  actor: Actor,
  rawParams: GetClientStatementParams,
  options?: FinanceExecutionOptions
): Promise<ClientStatementDTO> {
  assertActorAuthorized(actor, 'READ_FINANCE');

  const parsed = getClientStatementSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new FinanceValidationError('معايير كشف الحساب غير صالحة.', formatZodIssues(parsed.error));
  }
  const params = parsed.data;
  const prisma = getDb(options);

  return prisma.$transaction(
    async (tx) => {
      let matterId = params.matterId ?? null;
      let clientMatterPartyId = params.clientMatterPartyId ?? null;
      let partyId = params.partyId ?? null;
      let matterFileCode: string | null = null;
      let matterTitle: string | null = null;
      let partyName: string | null = null;

      if (clientMatterPartyId) {
        const mp = await tx.matterParty.findUnique({
          where: { id: clientMatterPartyId },
          include: {
            matter: { select: { id: true, fileCode: true, title: true } },
            party: { select: { id: true, name: true } },
          },
        });
        if (!mp) {
          throw new NotFoundError('ارتباط الموكل بالملف غير موجود.');
        }
        if (mp.role !== 'CLIENT') {
          throw new ScopeMismatchError('الطرف المحدد لا يحمل صفة موكل في هذا الملف.');
        }
        if (matterId && mp.matterId !== matterId) {
          throw new ScopeMismatchError('الموكل المحدد لا يتبع ملف القضية المطلوب.');
        }
        if (partyId && mp.partyId !== partyId) {
          throw new ScopeMismatchError('معرف الطرف لا يطابق ارتباط الموكل بالملف.');
        }
        matterId = mp.matter.id;
        matterFileCode = mp.matter.fileCode;
        matterTitle = mp.matter.title;
        partyId = mp.party.id;
        partyName = mp.party.name;
      } else {
        if (matterId) {
          const m = await tx.matter.findUnique({
            where: { id: matterId },
            select: { id: true, fileCode: true, title: true },
          });
          if (!m) throw new NotFoundError('ملف القضية غير موجود.');
          matterFileCode = m.fileCode;
          matterTitle = m.title;
        }
        if (partyId) {
          const p = await tx.party.findUnique({
            where: { id: partyId },
            select: { id: true, name: true },
          });
          if (!p) throw new NotFoundError('الموكل المطلوب غير موجود.');
          partyName = p.name;
        }
        if (matterId && partyId) {
          const mp = await tx.matterParty.findUnique({
            where: {
              matterId_partyId_role: { matterId, partyId, role: 'CLIENT' },
            },
            select: { id: true },
          });
          if (!mp) {
            throw new ScopeMismatchError('هذا الطرف غير مسجل كموكل في ملف القضية المحدد.');
          }
          clientMatterPartyId = mp.id;
        }
      }

      let matchingMatterPartyIds: string[] | null = null;
      if (clientMatterPartyId) {
        matchingMatterPartyIds = [clientMatterPartyId];
      } else if (partyId) {
        const links = await tx.matterParty.findMany({
          where: {
            partyId,
            role: 'CLIENT',
            ...(matterId ? { matterId } : {}),
          },
          select: { id: true },
        });
        matchingMatterPartyIds = links.map((l) => l.id);
      }

      const lineWhere: Prisma.MoneyLineWhereInput = {
        transaction: { status: 'POSTED' },
        ...(matterId ? { matterId } : {}),
        ...(matchingMatterPartyIds !== null
          ? { clientMatterPartyId: { in: matchingMatterPartyIds } }
          : {}),
      };

      const postedLines = await tx.moneyLine.findMany({
        where: lineWhere,
        include: { account: { select: { type: true } } },
      });

      const bucket = emptyBucket();
      const txIds = new Set<string>();
      for (const l of postedLines) {
        txIds.add(l.transactionId);
        applyLineToBucket(bucket, l.account.type, l.side, l.amountPiastres);
      }

      const chargeWhere: Prisma.FeeChargeWhereInput = {
        feeAgreement: { status: 'APPROVED' },
        ...(matterId ? { matterId } : {}),
        ...(matchingMatterPartyIds !== null
          ? { clientMatterPartyId: { in: matchingMatterPartyIds } }
          : {}),
      };

      const chargeRows = await tx.feeCharge.findMany({
        where: chargeWhere,
        include: {
          clientMatterParty: {
            select: { partyId: true, party: { select: { name: true } } },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { installmentNumber: 'asc' }],
      });

      const allocatedMap = await computeNetAllocatedMap(
        tx,
        chargeRows.map((c) => c.receivableLineId)
      );

      const charges: FeeChargeDTO[] = chargeRows.map((c) => {
        const allocated = allocatedMap.get(c.receivableLineId) ?? 0n;
        const remaining = c.amountPiastres - allocated;
        return {
          id: c.id,
          feeAgreementId: c.feeAgreementId,
          matterId: c.matterId,
          clientMatterPartyId: c.clientMatterPartyId,
          clientPartyId: c.clientMatterParty.partyId,
          clientName: c.clientMatterParty.party.name,
          installmentNumber: c.installmentNumber,
          description: c.description,
          dueDate: formatUtcDateToIsoDate(c.dueDate),
          amountPiastres: c.amountPiastres.toString(),
          allocatedPiastres: allocated.toString(),
          remainingPiastres: remaining.toString(),
          currency: EGP_CURRENCY,
          receivableLineId: c.receivableLineId,
          createdAt: c.createdAt.toISOString(),
        };
      });

      const transactions =
        txIds.size > 0
          ? await loadTransactionsDTO(tx, { id: { in: Array.from(txIds) }, status: 'POSTED' })
          : [];

      const feesDue = bucket.feeReceivableDebit - bucket.feeReceivableCredit;
      const chargesRemainingSum = charges.reduce((s, c) => s + BigInt(c.remainingPiastres), 0n);

      return {
        scope: {
          matterId,
          matterFileCode,
          matterTitle,
          partyId,
          partyName,
          clientMatterPartyId,
        },
        currency: EGP_CURRENCY,
        feesChargedPiastres: bucket.feeReceivableDebit.toString(),
        feesCollectedPiastres: bucket.feeReceivableCredit.toString(),
        feesDuePiastres: feesDue.toString(),
        expensesDuePiastres: (bucket.expenseReceivableDebit - bucket.expenseReceivableCredit).toString(),
        advanceAvailablePiastres: (bucket.clientAdvanceCredit - bucket.clientAdvanceDebit).toString(),
        charges,
        transactions,
        reconciled: chargesRemainingSum === feesDue,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

function escapeSqlLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

export async function listFinanceOverview(
  actor: Actor,
  rawParams: ListFinanceOverviewParams = {},
  options?: FinanceExecutionOptions
): Promise<FinanceOverviewDTO> {
  assertActorAuthorized(actor, 'READ_FINANCE');

  const parsed = listFinanceOverviewSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new FinanceValidationError('معايير عرض الحسابات غير صالحة.', formatZodIssues(parsed.error));
  }
  const params = parsed.data;
  const prisma = getDb(options);

  return prisma.$transaction(
    async (tx) => {
      const selectedMatterSummary = params.matterId
        ? await computeMatterFinanceSummaryInternal(tx, params.matterId)
        : null;

      let totals: FinanceOverviewDTO['totals'];
      if (selectedMatterSummary) {
        totals = {
          feesChargedPiastres: selectedMatterSummary.feesChargedPiastres,
          feesCollectedPiastres: selectedMatterSummary.feesCollectedPiastres,
          feesDuePiastres: selectedMatterSummary.feesDuePiastres,
          expensesDuePiastres: selectedMatterSummary.expensesDuePiastres,
          advanceAvailablePiastres: selectedMatterSummary.advanceAvailablePiastres,
        };
      } else {
        const groupedTotals = await tx.$queryRaw<
          Array<{
            account_type: MoneyAccountType;
            side: 'DEBIT' | 'CREDIT';
            total_piastres: string;
          }>
        >`
          SELECT ma."type"::text AS account_type,
                 ml."side"::text AS side,
                 COALESCE(SUM(ml."amount_piastres"), 0)::text AS total_piastres
          FROM public."money_line" ml
          JOIN public."money_account" ma ON ma."id" = ml."account_id"
          JOIN public."money_transaction" mt ON mt."id" = ml."transaction_id"
          WHERE mt."status" = 'POSTED'::"MoneyTransactionStatus"
          GROUP BY ma."type"::text, ml."side"::text
        `;
        const bucket = emptyBucket();
        for (const row of groupedTotals) {
          applyLineToBucket(bucket, row.account_type, row.side, BigInt(row.total_piastres));
        }
        totals = {
          feesChargedPiastres: bucket.feeReceivableDebit.toString(),
          feesCollectedPiastres: bucket.feeReceivableCredit.toString(),
          feesDuePiastres: (bucket.feeReceivableDebit - bucket.feeReceivableCredit).toString(),
          expensesDuePiastres: (bucket.expenseReceivableDebit - bucket.expenseReceivableCredit).toString(),
          advanceAvailablePiastres: (bucket.clientAdvanceCredit - bucket.clientAdvanceDebit).toString(),
        };
      }

      const selectableMatterSelect = {
        id: true,
        fileCode: true,
        title: true,
        status: true,
        parties: {
          where: { role: 'CLIENT' },
          select: {
            id: true,
            partyId: true,
            isPrimaryContact: true,
            billingEnabled: true,
            party: { select: { name: true } },
          },
          orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
        },
      } satisfies Prisma.MatterSelect;

      const matterRows = await tx.matter.findMany({
        where: {
          archivedAt: null,
          status: { not: 'ARCHIVED' },
          parties: { some: { role: 'CLIENT' } },
        },
        select: selectableMatterSelect,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      });

      if (params.matterId && !matterRows.some((m) => m.id === params.matterId)) {
        const requestedMatter = await tx.matter.findFirst({
          where: {
            id: params.matterId,
            archivedAt: null,
            status: { not: 'ARCHIVED' },
            parties: { some: { role: 'CLIENT' } },
          },
          select: selectableMatterSelect,
        });
        if (requestedMatter) {
          matterRows.unshift(requestedMatter);
        }
      }

      const selectableMatters: SelectableFinanceMatterDTO[] = matterRows.map((m) => ({
        matterId: m.id,
        fileCode: m.fileCode,
        title: m.title,
        status: m.status,
        clients: m.parties.map((p) => ({
          clientMatterPartyId: p.id,
          partyId: p.partyId,
          partyName: p.party.name,
          isPrimaryContact: p.isPrimaryContact,
          billingEnabled: p.billingEnabled,
        })),
      }));

      const qRaw = params.q?.trim() ?? '';
      const qDigits = qRaw ? normalizeArabicDigits(qRaw) : '';
      const qNorm = qRaw ? normalizeArabicText(qRaw) : '';

      const qOrConditions: Prisma.FeeAgreementWhereInput[] = [];
      if (qRaw) {
        qOrConditions.push({ description: { contains: qRaw, mode: 'insensitive' } });
        if (qDigits && qDigits !== qRaw) {
          qOrConditions.push({ description: { contains: qDigits, mode: 'insensitive' } });
        }
        if (qDigits) {
          qOrConditions.push({ matter: { fileCode: { contains: qDigits, mode: 'insensitive' } } });
        }
        if (qNorm) {
          qOrConditions.push({
            matter: { titleNormalized: { contains: qNorm, mode: 'insensitive' } },
          });
          qOrConditions.push({
            clientMatterParty: {
              party: { nameNormalized: { contains: qNorm, mode: 'insensitive' } },
            },
          });
        }
      }

      const agreementWhere: Prisma.FeeAgreementWhereInput = {
        ...(params.matterId ? { matterId: params.matterId } : {}),
        ...(qOrConditions.length > 0 ? { OR: qOrConditions } : {}),
      };

      const skip = (params.page - 1) * params.limit;
      let totalAgreements: number;
      let agreements: FeeAgreementDTO[];
      let openCharges: FeeChargeDTO[];

      if (selectedMatterSummary && !qRaw) {
        totalAgreements = selectedMatterSummary.agreements.length;
        agreements = selectedMatterSummary.agreements.slice(skip, skip + params.limit);
        openCharges = selectedMatterSummary.charges.filter((c) => BigInt(c.remainingPiastres) > 0n);
      } else {
        const sqlConditions: Prisma.Sql[] = [
          Prisma.sql`fa."status" = 'APPROVED'::"FeeAgreementStatus"`,
        ];
        if (params.matterId) {
          sqlConditions.push(Prisma.sql`fc."matter_id" = ${params.matterId}`);
        }
        if (qRaw) {
          const likeRaw = `%${escapeSqlLike(qRaw)}%`;
          const sqlOrClauses: Prisma.Sql[] = [
            Prisma.sql`fa."description" ILIKE ${likeRaw} ESCAPE '\\'`,
            Prisma.sql`fc."description" ILIKE ${likeRaw} ESCAPE '\\'`,
          ];
          if (qDigits) {
            const likeDigits = `%${escapeSqlLike(qDigits)}%`;
            if (qDigits !== qRaw) {
              sqlOrClauses.push(Prisma.sql`fa."description" ILIKE ${likeDigits} ESCAPE '\\'`);
              sqlOrClauses.push(Prisma.sql`fc."description" ILIKE ${likeDigits} ESCAPE '\\'`);
            }
            sqlOrClauses.push(Prisma.sql`m."fileCode" ILIKE ${likeDigits} ESCAPE '\\'`);
          }
          if (qNorm) {
            const likeNorm = `%${escapeSqlLike(qNorm)}%`;
            sqlOrClauses.push(Prisma.sql`m."titleNormalized" ILIKE ${likeNorm} ESCAPE '\\'`);
            sqlOrClauses.push(Prisma.sql`p."nameNormalized" ILIKE ${likeNorm} ESCAPE '\\'`);
          }
          sqlConditions.push(Prisma.sql`(${Prisma.join(sqlOrClauses, ' OR ')})`);
        }

        const whereSql = Prisma.join(sqlConditions, ' AND ');

        const [count, pagedAgreements, openChargeRows] = await Promise.all([
          tx.feeAgreement.count({ where: agreementWhere }),
          loadFeeAgreementsDTO(tx, agreementWhere, { skip, take: params.limit }),
          tx.$queryRaw<
            Array<{
              id: string;
              fee_agreement_id: string;
              matter_id: string;
              client_matter_party_id: string;
              client_party_id: string;
              client_name: string;
              installment_number: number;
              description: string;
              due_date: Date | null;
              amount_piastres: bigint;
              allocated_piastres: string;
              receivable_line_id: string;
              created_at: Date;
            }>
          >`
            SELECT
              fc."id",
              fc."fee_agreement_id",
              fc."matter_id",
              fc."client_matter_party_id",
              mp."partyId" AS client_party_id,
              p."name" AS client_name,
              fc."installment_number",
              fc."description",
              fc."due_date",
              fc."amount_piastres",
              COALESCE(
                SUM(
                  CASE
                    WHEN mt."status" = 'POSTED'::"MoneyTransactionStatus"
                      AND (ma."adjustment_transaction_id" IS NULL OR adj."status" = 'POSTED'::"MoneyTransactionStatus")
                    THEN CASE
                      WHEN ma."action" = 'APPLY'::"MoneyAllocationAction" THEN ma."amount_piastres"
                      ELSE -ma."amount_piastres"
                    END
                    ELSE 0
                  END
                ),
                0
              )::text AS allocated_piastres,
              fc."receivable_line_id",
              fc."created_at"
            FROM public."fee_charge" fc
            JOIN public."fee_agreement" fa ON fa."id" = fc."fee_agreement_id"
            JOIN public."matter" m ON m."id" = fc."matter_id"
            JOIN public."matter_party" mp ON mp."id" = fc."client_matter_party_id"
            JOIN public."party" p ON p."id" = mp."partyId"
            LEFT JOIN public."money_allocation" ma ON ma."receivable_line_id" = fc."receivable_line_id"
            LEFT JOIN public."money_line" ml ON ml."id" = ma."settlement_line_id"
            LEFT JOIN public."money_transaction" mt ON mt."id" = ml."transaction_id"
            LEFT JOIN public."money_transaction" adj ON adj."id" = ma."adjustment_transaction_id"
            WHERE ${whereSql}
            GROUP BY fc."id", mp."partyId", p."name"
            HAVING fc."amount_piastres" > COALESCE(
              SUM(
                CASE
                  WHEN mt."status" = 'POSTED'::"MoneyTransactionStatus"
                    AND (ma."adjustment_transaction_id" IS NULL OR adj."status" = 'POSTED'::"MoneyTransactionStatus")
                  THEN CASE
                    WHEN ma."action" = 'APPLY'::"MoneyAllocationAction" THEN ma."amount_piastres"
                    ELSE -ma."amount_piastres"
                  END
                  ELSE 0
                END
              ),
              0
            )
            ORDER BY fc."due_date" ASC NULLS LAST, fc."created_at" DESC, fc."id" ASC
            LIMIT 200
          `,
        ]);
        totalAgreements = count;
        agreements = pagedAgreements;
        openCharges = openChargeRows.map((c) => {
          const amount = BigInt(c.amount_piastres);
          const allocated = BigInt(c.allocated_piastres);
          const remaining = amount - allocated;
          return {
            id: c.id,
            feeAgreementId: c.fee_agreement_id,
            matterId: c.matter_id,
            clientMatterPartyId: c.client_matter_party_id,
            clientPartyId: c.client_party_id,
            clientName: c.client_name,
            installmentNumber: c.installment_number,
            description: c.description,
            dueDate: formatUtcDateToIsoDate(c.due_date),
            amountPiastres: amount.toString(),
            allocatedPiastres: allocated.toString(),
            remainingPiastres: remaining.toString(),
            currency: EGP_CURRENCY,
            receivableLineId: c.receivable_line_id,
            createdAt: c.created_at.toISOString(),
          };
        });
      }

      const recentTransactions = selectedMatterSummary
        ? selectedMatterSummary.transactions.slice(0, 30)
        : await loadTransactionsDTO(tx, { status: 'POSTED' }, 30);

      return {
        currency: EGP_CURRENCY,
        totals,
        selectableMatters,
        agreements,
        openCharges,
        recentTransactions,
        selectedMatterSummary,
        page: params.page,
        limit: params.limit,
        totalAgreements,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

export async function getReceipt(
  actor: Actor,
  receiptId: string,
  options?: FinanceExecutionOptions
): Promise<ReceiptDTO> {
  assertActorAuthorized(actor, 'READ_FINANCE');
  const validId = assertValidUuid(receiptId, 'الإيصال');
  const prisma = getDb(options);

  const receipt = await prisma.receipt.findUnique({
    where: { id: validId },
  });
  if (!receipt) {
    throw new NotFoundError('إيصال التحصيل المطلوب غير موجود.');
  }

  return mapReceiptToDTO(receipt);
}

export async function reprintReceipt(
  actor: Actor,
  receiptId: string,
  options?: FinanceExecutionOptions
): Promise<ReceiptDTO> {
  return getReceipt(actor, receiptId, options);
}

export async function updatePostedTransaction(
  actor: Actor,
  input?: unknown
): Promise<never> {
  void input;
  assertActorAuthorized(actor, 'WRITE_FINANCE');
  throw new ImmutablePostedRecordError();
}

export async function deletePostedTransaction(
  actor: Actor,
  input?: unknown
): Promise<never> {
  void input;
  assertActorAuthorized(actor, 'WRITE_FINANCE');
  throw new ImmutablePostedRecordError();
}