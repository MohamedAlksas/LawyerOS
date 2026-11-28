import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAuth, getPrismaClient } from '@/lib/auth';
import { closeDbPool } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { openMatter, linkMatterParty, unlinkMatterParty, updateMatterParty } from '@/modules/matters/matter-service';
import { ActiveObligationError, CrossMatterLinkForbiddenError } from '@/modules/matters/matter-types';
import { DocumentValidationError } from '@/modules/documents/document-types';
import { IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import { financeError } from '@/modules/finance/finance-errors';
import {
  AlreadyPostedError,
  ConcurrencyConflictError,
  ExcessAllocationError,
  FinanceValidationError,
  ImmutablePostedRecordError,
  NotFoundError,
  ScopeMismatchError,
  UnsupportedTransactionKindError,
  approveFeeAgreement,
  deletePostedTransaction,
  getClientStatement,
  getMatterFinanceSummary,
  listFinanceOverview,
  postTransaction,
  reprintReceipt,
  saveFeeAgreementDraft,
  updatePostedTransaction,
} from '@/modules/finance';
import { GET as getFinanceOverviewRoute } from '@/app/api/finance/route';
import { GET as getStatementRoute } from '@/app/api/finance/statement/route';
import { POST as postAgreementDraftRoute } from '@/app/api/finance/agreements/route';
import { POST as postApproveAgreementRoute } from '@/app/api/finance/agreements/[id]/approve/route';
import { POST as postTransactionsRoute } from '@/app/api/finance/transactions/route';
import {
  DELETE as deleteTransactionRoute,
  PATCH as patchTransactionRoute,
} from '@/app/api/finance/transactions/[id]/route';
import { GET as getReceiptRoute } from '@/app/api/finance/receipts/[id]/route';
import {
  createSyntheticActor,
  createSyntheticMaintainer,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { createDedicatedTestDatabase } from '../helpers/test-db';

async function clearGlobalSingletons(): Promise<void> {
  await closeDbPool().catch(() => {});
  const g = globalThis as Record<string, unknown>;
  delete g.__lawoffice_pg_pool;
  delete g.__lawoffice_prisma;
  delete g.__lawoffice_auth;
}

function runPrismaMigrateDeploy(dbUrl: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'test' },
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`Prisma migrate deploy failed (${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
}

function signSessionTokenCookie(token: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
  return `better-auth.session_token=${encodeURIComponent(`${token}.${sig}`)}`;
}

describe('T13 Integration Tests: Balanced Ledger, Fee Agreements, Payments & Receipts (PG)', () => {
  let dedicated: Awaited<ReturnType<typeof createDedicatedTestDatabase>>;
  let prevTestDbUrl: string | undefined;
  let trustedOrigin: string;
  let ownerCookie: string;
  let maintainerCookie: string;

  const owner = createSyntheticActor({
    id: `t13-owner-${crypto.randomUUID().slice(0, 8)}`,
    name: 'الأستاذ أحمد المحامي T13',
    email: `t13.owner.${crypto.randomUUID().slice(0, 8)}@lawoffice.test`,
  });
  const maintainer = createSyntheticMaintainer({
    id: `t13-maint-${crypto.randomUUID().slice(0, 8)}`,
    email: `t13.maint.${crypto.randomUUID().slice(0, 8)}@lawoffice.test`,
  });

  let clientAPartyId: string;
  let clientBPartyId: string;
  let thirdPartyPayerId: string;
  let matter1Id: string;
  let matter1ClientAMpId: string;
  let matter1ClientBMpId: string;
  let matter2Id: string;
  let matter2ClientBMpId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();
    prevTestDbUrl = process.env.TEST_DATABASE_URL;
    dedicated = await createDedicatedTestDatabase();
    runPrismaMigrateDeploy(dedicated.url);

    await clearGlobalSingletons();
    process.env.TEST_DATABASE_URL = dedicated.url;
    getEnv(true);
    getAuth();

    const env = getEnv();
    trustedOrigin = new URL(env.BETTER_AUTH_URL).origin;
    const prisma = getPrismaClient();

    await prisma.officeSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        officeName: 'مكتب الأستاذ أحمد للمحاماة',
        lawyerName: owner.name,
        currency: 'EGP',
        timeZone: 'Africa/Cairo',
        version: 1,
        updatedById: owner.id,
      },
      update: {},
    });

    await prisma.user.createMany({
      data: [
        {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          emailVerified: true,
          role: 'OWNER',
          twoFactorEnabled: true,
          credentialVersion: 1,
        },
        {
          id: maintainer.id,
          name: maintainer.name,
          email: maintainer.email,
          emailVerified: true,
          role: 'MAINTAINER',
          twoFactorEnabled: false,
          credentialVersion: 1,
        },
      ],
    });

    await prisma.twoFactor.create({
      data: {
        id: crypto.randomUUID(),
        userId: owner.id,
        secret: 'SYNTHETIC_T13_TOTP_SECRET',
        backupCodes: '[]',
        verified: true,
      },
    });

    const ownerToken = crypto.randomBytes(24).toString('hex');
    const maintainerToken = crypto.randomBytes(24).toString('hex');
    const futureExp = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        {
          id: crypto.randomUUID(),
          userId: owner.id,
          token: ownerToken,
          expiresAt: futureExp,
          credentialVersion: 1,
        },
        {
          id: crypto.randomUUID(),
          userId: maintainer.id,
          token: maintainerToken,
          expiresAt: futureExp,
          credentialVersion: 1,
        },
      ],
    });

    ownerCookie = signSessionTokenCookie(ownerToken, env.BETTER_AUTH_SECRET);
    maintainerCookie = signSessionTokenCookie(maintainerToken, env.BETTER_AUTH_SECRET);

    const pA = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'أحمد علي منصور',
        nameNormalized: 'احمد علي منصور',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const pB = await prisma.party.create({
      data: {
        kind: 'ORGANIZATION',
        name: 'شركة النيل التجارية',
        nameNormalized: 'شركه النيل التجاريه',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const pPayer = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'سعيد حسن الدافع',
        nameNormalized: 'سعيد حسن الدافع',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    clientAPartyId = pA.id;
    clientBPartyId = pB.id;
    thirdPartyPayerId = pPayer.id;

    const m1 = await openMatter(owner, {
      title: 'دعوى تعويض مدني رقم 1',
      kind: 'LITIGATION',
      initialClientId: clientAPartyId,
      idempotencyKey: `t13-m1-${crypto.randomUUID()}`,
    });
    matter1Id = m1.matter.id;
    matter1ClientAMpId = m1.matter.parties!.find((p) => p.partyId === clientAPartyId)!.id;

    const m1ClientB = await linkMatterParty(owner, {
      matterId: matter1Id,
      partyId: clientBPartyId,
      role: 'CLIENT',
      billingEnabled: true,
      idempotencyKey: `t13-m1-cb-${crypto.randomUUID()}`,
    });
    matter1ClientBMpId = m1ClientB.id;

    const m2 = await openMatter(owner, {
      title: 'استشارة عقد توريد رقم 2',
      kind: 'CONSULTATION',
      initialClientId: clientBPartyId,
      idempotencyKey: `t13-m2-${crypto.randomUUID()}`,
    });
    matter2Id = m2.matter.id;
    matter2ClientBMpId = m2.matter.parties!.find((p) => p.partyId === clientBPartyId)!.id;
  }, 60000);

  afterAll(async () => {
    await clearGlobalSingletons();
    process.env.TEST_DATABASE_URL = prevTestDbUrl;
    getEnv(true);
    if (dedicated) {
      await dedicated.drop().catch(() => {});
    }
  }, 30000);
  it('T13-TC-01..03: 15,000 draft -> no balance -> 6,000+9,000 approval -> 5,000 payment (10,000 due) -> replay/mismatch/reprint', async () => {
    const prisma = getPrismaClient();

    // 1. Save 15,000 EGP draft via HTTP
    const draftReq = new NextRequest(`${trustedOrigin}/api/finance/agreements`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: trustedOrigin,
        cookie: ownerCookie,
      },
      body: JSON.stringify({
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientAMpId,
        description: 'أتعاب الدعوى المدنية الكاملة',
        totalAmountPiastres: '١٥٠٠٠٠٠',
        agreementDate: '2026-11-27',
        chargingMethod: 'INSTALLMENTS',
        notes: 'مسودة أولية',
        idempotencyKey: 'tc01-draft-create',
      }),
    });
    const draftRes = await postAgreementDraftRoute(draftReq);
    expect(draftRes.status).toBe(200);
    const draftJson = await draftRes.json();
    expect(draftJson.success).toBe(true);
    const agreementId = draftJson.data.id as string;
    expect(draftJson.data.status).toBe('DRAFT');
    expect(draftJson.data.totalAmountPiastres).toBe('1500000');

    // Draft changes NO balances and creates NO ledger entries
    const summaryBeforeApprove = await getMatterFinanceSummary(owner, matter1Id);
    expect(summaryBeforeApprove.feesChargedPiastres).toBe('0');
    expect(summaryBeforeApprove.feesDuePiastres).toBe('0');
    expect(summaryBeforeApprove.charges).toHaveLength(0);
    expect(summaryBeforeApprove.transactions).toHaveLength(0);

    // Update draft & check version conflict
    const updatedDraft = await saveFeeAgreementDraft(owner, {
      feeAgreementId: agreementId,
      expectedVersion: 1,
      matterId: matter1Id,
      clientMatterPartyId: matter1ClientAMpId,
      description: 'أتعاب الدعوى المدنية الكاملة',
      totalAmountPiastres: '1500000',
      agreementDate: '2026-11-27',
      chargingMethod: 'INSTALLMENTS',
      notes: 'مسودة محدثة',
      idempotencyKey: 'tc01-draft-update',
    });
    expect(updatedDraft.version).toBe(2);

    await expect(
      saveFeeAgreementDraft(owner, {
        feeAgreementId: agreementId,
        expectedVersion: 1,
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientAMpId,
        description: 'تعديل متعارض',
        totalAmountPiastres: '1500000',
        agreementDate: '2026-11-27',
        chargingMethod: 'INSTALLMENTS',
        idempotencyKey: 'tc01-draft-stale',
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Reject approval with mismatched installment sum
    await expect(
      approveFeeAgreement(owner, {
        feeAgreementId: agreementId,
        expectedVersion: 2,
        installments: [
          { description: 'قسط 1', amountPiastres: '500000' },
          { description: 'قسط 2', amountPiastres: '900000' },
        ],
        idempotencyKey: 'tc01-approve-bad-sum',
      })
    ).rejects.toThrow(FinanceValidationError);

    // 2. Approve as 6,000 + 9,000 installments via HTTP
    const approveReq = new NextRequest(
      `${trustedOrigin}/api/finance/agreements/${agreementId}/approve`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: trustedOrigin,
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          expectedVersion: 2,
          transactionDate: '2026-11-27',
          installments: [
            { description: 'القسط الأول عند القيد', dueDate: '2026-12-01', amountPiastres: '600000' },
            { description: 'القسط الثاني عند الحكم', dueDate: '2027-01-15', amountPiastres: '900000' },
          ],
          idempotencyKey: 'tc01-approve-ok',
        }),
      }
    );
    const approveRes = await postApproveAgreementRoute(approveReq, {
      params: Promise.resolve({ id: agreementId }),
    });
    expect(approveRes.status).toBe(200);
    const approveJson = await approveRes.json();
    expect(approveJson.success).toBe(true);
    expect(approveJson.data.feeAgreement.status).toBe('APPROVED');
    expect(approveJson.data.charges).toHaveLength(2);
    const charge1 = approveJson.data.charges[0];
    const charge2 = approveJson.data.charges[1];
    expect(BigInt(charge1.amountPiastres) + BigInt(charge2.amountPiastres)).toBe(1500000n);
    expect(approveJson.data.transaction.kind).toBe('FEE_CHARGE');
    expect(approveJson.data.transaction.lines).toHaveLength(3);

    // Verify independent client balances on same matter
    const afterApproveSummary = await getMatterFinanceSummary(owner, matter1Id);
    expect(afterApproveSummary.feesChargedPiastres).toBe('1500000');
    expect(afterApproveSummary.feesDuePiastres).toBe('1500000');
    const clientABal = afterApproveSummary.clients.find(
      (c) => c.clientMatterPartyId === matter1ClientAMpId
    )!;
    const clientBBal = afterApproveSummary.clients.find(
      (c) => c.clientMatterPartyId === matter1ClientBMpId
    )!;
    expect(clientABal.feesDuePiastres).toBe('1500000');
    expect(clientBBal.feesDuePiastres).toBe('0');

    // 3. Collect 5,000 EGP toward installment #1 via HTTP with third-party payer (T13-TC-02)
    const receiptCountBeforePay = await prisma.receipt.count();
    const payIdempKey = 'tc02-payment-5000';
    const payPayload = {
      kind: 'FEE_PAYMENT',
      matterId: matter1Id,
      clientMatterPartyId: matter1ClientAMpId,
      payerPartyId: thirdPartyPayerId,
      transactionDate: '2026-11-27',
      paymentMethod: 'INSTAPAY',
      totalAmountPiastres: '500000',
      reference: 'IPN-2026-991',
      description: 'تحصيل الدفعة الأولى من الأتعاب',
      allocations: [{ feeChargeId: charge1.id, amountPiastres: '500000' }],
      idempotencyKey: payIdempKey,
    };

    const payReq = new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: trustedOrigin,
        cookie: ownerCookie,
      },
      body: JSON.stringify(payPayload),
    });
    const payRes = await postTransactionsRoute(payReq);
    expect(payRes.status).toBe(200);
    const payJson = await payRes.json();
    expect(payJson.success).toBe(true);
    expect(payJson.data.matterSummary.feesChargedPiastres).toBe('1500000');
    expect(payJson.data.matterSummary.feesCollectedPiastres).toBe('500000');
    expect(payJson.data.matterSummary.feesDuePiastres).toBe('1000000');
    expect(payJson.data.matterSummary.expensesDuePiastres).toBe('0');
    expect(payJson.data.matterSummary.advanceAvailablePiastres).toBe('0');
    expect(payJson.data.receipt.receiptNumber).toMatch(/^RCP-\d{4}-\d{4,}$/);
    expect(payJson.data.receipt.payerName).toBe('سعيد حسن الدافع');
    expect(payJson.data.receipt.headerSnapshot.feesRemainingAfterPiastres).toBe('1000000');
    expect(await prisma.receipt.count()).toBe(receiptCountBeforePay + 1);

    const firstTxId = payJson.data.transaction.id as string;
    const firstReceiptId = payJson.data.receipt.id as string;
    const firstReceiptNumber = payJson.data.receipt.receiptNumber as string;

    // Verify audit event recorded unmasked receiptNumber
    const auditEvent = await prisma.auditEvent.findFirst({
      where: { entityType: 'MoneyTransaction', entityId: firstTxId, action: 'POST_FEE_PAYMENT' },
    });
    expect(auditEvent).not.toBeNull();
    expect((auditEvent!.changedFields as Record<string, unknown>).receiptNumber).toBe(
      firstReceiptNumber
    );

    // Statement & Overview HTTP checks
    const stmtReq = new NextRequest(
      `${trustedOrigin}/api/finance/statement?matterId=${matter1Id}&clientMatterPartyId=${matter1ClientAMpId}`,
      { headers: { cookie: ownerCookie } }
    );
    const stmtRes = await getStatementRoute(stmtReq);
    expect(stmtRes.status).toBe(200);
    const stmtJson = await stmtRes.json();
    expect(stmtJson.data.feesDuePiastres).toBe('1000000');
    expect(stmtJson.data.reconciled).toBe(true);

    const ovReq = new NextRequest(`${trustedOrigin}/api/finance?matterId=${matter1Id}`, {
      headers: { cookie: ownerCookie },
    });
    const ovRes = await getFinanceOverviewRoute(ovReq);
    expect(ovRes.status).toBe(200);
    const ovJson = await ovRes.json();
    expect(ovJson.data.totals.feesDuePiastres).toBe('1000000');
    expect(ovJson.data.openCharges).toHaveLength(2);
    expect(ovJson.data.openCharges[0].remainingPiastres).toBe('100000');

    // 4. T13-TC-03: Replay with same idempotencyKey -> returns exact same tx & receipt
    const replayReq = new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: trustedOrigin,
        cookie: ownerCookie,
      },
      body: JSON.stringify(payPayload),
    });
    const replayRes = await postTransactionsRoute(replayReq);
    expect(replayRes.status).toBe(200);
    const replayJson = await replayRes.json();
    expect(replayJson.data.transaction.id).toBe(firstTxId);
    expect(replayJson.data.receipt.id).toBe(firstReceiptId);
    expect(replayJson.data.receipt.receiptNumber).toBe(firstReceiptNumber);

    // Same key with changed amount -> 409 IDEMPOTENCY_PAYLOAD_MISMATCH
    const mismatchReq = new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: trustedOrigin,
        cookie: ownerCookie,
      },
      body: JSON.stringify({
        ...payPayload,
        totalAmountPiastres: '400000',
        allocations: [{ feeChargeId: charge1.id, amountPiastres: '400000' }],
      }),
    });
    const mismatchRes = await postTransactionsRoute(mismatchReq);
    expect(mismatchRes.status).toBe(409);
    const mismatchJson = await mismatchRes.json();
    expect(mismatchJson.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');

    // Receipt reprint preserves receiptNumber and creates no new payment/receipt
    const reprintReq = new NextRequest(`${trustedOrigin}/api/finance/receipts/${firstReceiptId}`, {
      headers: { cookie: ownerCookie },
    });
    const reprintRes1 = await getReceiptRoute(reprintReq, {
      params: Promise.resolve({ id: firstReceiptId }),
    });
    const reprintRes2 = await getReceiptRoute(reprintReq, {
      params: Promise.resolve({ id: firstReceiptId }),
    });
    expect(reprintRes1.status).toBe(200);
    expect(reprintRes2.status).toBe(200);
    const r1Json = await reprintRes1.json();
    const r2Json = await reprintRes2.json();
    expect(r1Json.data.receiptNumber).toBe(firstReceiptNumber);
    expect(r2Json.data.receiptNumber).toBe(firstReceiptNumber);
    expect(await prisma.receipt.count()).toBe(receiptCountBeforePay + 1);
  });
  it('T13-TC-04: Concurrent 4,000 EGP payments against 5,000 EGP remaining allow only one, leaving 1,000 EGP', async () => {
    const prisma = getPrismaClient();
    const draft = await saveFeeAgreementDraft(owner, {
      matterId: matter2Id,
      clientMatterPartyId: matter2ClientBMpId,
      description: 'أتعاب استشارة التوريد',
      totalAmountPiastres: '500000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: 'tc04-draft',
    });
    const approved = await approveFeeAgreement(owner, {
      feeAgreementId: draft.id,
      expectedVersion: draft.version,
      idempotencyKey: 'tc04-approve',
    });
    const chargeId = approved.charges[0].id;
    const receiptsBefore = await prisma.receipt.count();

    const results = await Promise.allSettled([
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: matter2Id,
        clientMatterPartyId: matter2ClientBMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '400000',
        allocations: [{ feeChargeId: chargeId, amountPiastres: '400000' }],
        idempotencyKey: 'tc04-race-a',
      }),
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: matter2Id,
        clientMatterPartyId: matter2ClientBMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '400000',
        allocations: [{ feeChargeId: chargeId, amountPiastres: '400000' }],
        idempotencyKey: 'tc04-race-b',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ExcessAllocationError);
    expect(await prisma.receipt.count()).toBe(receiptsBefore + 1);

    const summary = await getMatterFinanceSummary(owner, matter2Id);
    expect(summary.feesChargedPiastres).toBe('500000');
    expect(summary.feesCollectedPiastres).toBe('400000');
    expect(summary.feesDuePiastres).toBe('100000');
  });

  it('T13-TC-05: Rejects invalid amounts, mismatched scope, unbalanced/empty postings, excess, OFFICE_EXPENSE, and immutability violations (service, HTTP & direct SQL)', async () => {
    const prisma = getPrismaClient();

    const isoM1 = await openMatter(owner, {
      title: 'ملف عزل اختبار القيود والمنع 1',
      kind: 'LITIGATION',
      initialClientId: clientAPartyId,
      idempotencyKey: `tc05-m1-${crypto.randomUUID()}`,
    });
    const isoM1Id = isoM1.matter.id;
    const isoM1ClientAMpId = isoM1.matter.parties!.find((p) => p.partyId === clientAPartyId)!.id;
    const isoM1ClientBMp = await linkMatterParty(owner, {
      matterId: isoM1Id,
      partyId: clientBPartyId,
      role: 'CLIENT',
      billingEnabled: true,
      idempotencyKey: `tc05-m1-cb-${crypto.randomUUID()}`,
    });
    const isoM1ClientBMpId = isoM1ClientBMp.id;

    const isoM2 = await openMatter(owner, {
      title: 'ملف عزل اختبار القيود والمنع 2',
      kind: 'CONSULTATION',
      initialClientId: clientBPartyId,
      idempotencyKey: `tc05-m2-${crypto.randomUUID()}`,
    });
    const isoM2Id = isoM2.matter.id;
    const isoM2ClientBMpId = isoM2.matter.parties!.find((p) => p.partyId === clientBPartyId)!.id;

    const d1 = await saveFeeAgreementDraft(owner, {
      matterId: isoM1Id,
      clientMatterPartyId: isoM1ClientAMpId,
      description: 'اتفاق اختبار المنع 1',
      totalAmountPiastres: '600000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `tc05-d1-${crypto.randomUUID()}`,
    });
    const a1 = await approveFeeAgreement(owner, {
      feeAgreementId: d1.id,
      expectedVersion: d1.version,
      idempotencyKey: `tc05-a1-${crypto.randomUUID()}`,
    });
    const m1Charge1 = a1.charges[0];

    const paySeed = await postTransaction(owner, {
      kind: 'FEE_PAYMENT',
      matterId: isoM1Id,
      clientMatterPartyId: isoM1ClientAMpId,
      transactionDate: '2026-11-27',
      paymentMethod: 'CASH',
      totalAmountPiastres: '500000',
      allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: '500000' }],
      idempotencyKey: `tc05-p1-${crypto.randomUUID()}`,
    });
    const existingPaymentTx = paySeed.transaction;

    const d2 = await saveFeeAgreementDraft(owner, {
      matterId: isoM2Id,
      clientMatterPartyId: isoM2ClientBMpId,
      description: 'اتفاق اختبار المنع 2',
      totalAmountPiastres: '300000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `tc05-d2-${crypto.randomUUID()}`,
    });
    const a2 = await approveFeeAgreement(owner, {
      feeAgreementId: d2.id,
      expectedVersion: d2.version,
      idempotencyKey: `tc05-a2-${crypto.randomUUID()}`,
    });
    const m2Charge = a2.charges[0];

    // Snapshot before-state for strict invariance assertions
    const m1Before = await getMatterFinanceSummary(owner, isoM1Id);
    const m2Before = await getMatterFinanceSummary(owner, isoM2Id);
    const txCountBefore = await prisma.moneyTransaction.count();
    const lineCountBefore = await prisma.moneyLine.count();
    const allocCountBefore = await prisma.moneyAllocation.count();
    const receiptCountBefore = await prisma.receipt.count();

    // 1. Zero / negative / float amounts rejected
    for (const badAmount of ['0', '-100', '12.5']) {
      await expect(
        postTransaction(owner, {
          kind: 'FEE_PAYMENT',
          matterId: isoM1Id,
          clientMatterPartyId: isoM1ClientAMpId,
          transactionDate: '2026-11-27',
          paymentMethod: 'CASH',
          totalAmountPiastres: badAmount,
          allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: badAmount }],
          idempotencyKey: `tc05-bad-amt-${badAmount}`,
        })
      ).rejects.toThrow(FinanceValidationError);
    }

    // 2. Mismatched debtor (Client B on Client A's charge) & mismatched matter (Matter 2 charge on Matter 1)
    await expect(
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: isoM1Id,
        clientMatterPartyId: isoM1ClientBMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '50000',
        allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: '50000' }],
        idempotencyKey: 'tc05-mismatch-debtor',
      })
    ).rejects.toThrow(ScopeMismatchError);

    await expect(
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: isoM1Id,
        clientMatterPartyId: isoM1ClientAMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '50000',
        allocations: [{ feeChargeId: m2Charge.id, amountPiastres: '50000' }],
        idempotencyKey: 'tc05-mismatch-matter',
      })
    ).rejects.toThrow(ScopeMismatchError);

    // 3. Unbalanced & empty postings
    await expect(
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: isoM1Id,
        clientMatterPartyId: isoM1ClientAMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '50000',
        allocations: [],
        idempotencyKey: 'tc05-empty-alloc',
      })
    ).rejects.toThrow(FinanceValidationError);

    await expect(
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: isoM1Id,
        clientMatterPartyId: isoM1ClientAMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '50000',
        allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: '40000' }],
        idempotencyKey: 'tc05-unbal-alloc',
      })
    ).rejects.toThrow(FinanceValidationError);

    await expect(
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: isoM1Id,
        clientMatterPartyId: isoM1ClientAMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '50000',
        allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: '50000' }],
        lines: [
          { side: 'DEBIT', amountPiastres: '50000' },
          { side: 'CREDIT', amountPiastres: '40000' },
        ],
        idempotencyKey: 'tc05-unbal-lines',
      })
    ).rejects.toThrow(FinanceValidationError);

    // 4. Excess payment rejected and NOT silently classified as advance
    await expect(
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: isoM1Id,
        clientMatterPartyId: isoM1ClientAMpId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '200000',
        allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: '200000' }],
        idempotencyKey: 'tc05-excess',
      })
    ).rejects.toThrow(ExcessAllocationError);

    expect(
      await prisma.moneyAccount.count({ where: { type: 'CLIENT_ADVANCE' } })
    ).toBe(0);

    // 5. OFFICE_EXPENSE and future T14/T15 kinds explicitly rejected (service & HTTP)
    for (const badKind of ['OFFICE_EXPENSE', 'REIMBURSABLE_EXPENSE', 'ADVANCE_RECEIPT', 'REFUND', 'REVERSAL']) {
      await expect(
        postTransaction(owner, {
          kind: badKind,
          matterId: isoM1Id,
          clientMatterPartyId: isoM1ClientAMpId,
          transactionDate: '2026-11-27',
          paymentMethod: 'CASH',
          totalAmountPiastres: '10000',
          allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: '10000' }],
          idempotencyKey: `tc05-kind-${badKind}`,
        })
      ).rejects.toThrow(UnsupportedTransactionKindError);

      const badKindReq = new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: trustedOrigin,
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          kind: badKind,
          matterId: isoM1Id,
          clientMatterPartyId: isoM1ClientAMpId,
          transactionDate: '2026-11-27',
          paymentMethod: 'CASH',
          totalAmountPiastres: '10000',
          allocations: [{ feeChargeId: m1Charge1.id, amountPiastres: '10000' }],
          idempotencyKey: `tc05-http-kind-${badKind}`,
        }),
      });
      const badKindRes = await postTransactionsRoute(badKindReq);
      expect(badKindRes.status).toBe(400);
      expect((await badKindRes.json()).code).toBe('UNSUPPORTED_TRANSACTION_KIND');
    }

    // 6. Immutability via service, HTTP PATCH/DELETE, and direct SQL triggers
    await expect(updatePostedTransaction(owner, { id: existingPaymentTx.id })).rejects.toThrow(
      ImmutablePostedRecordError
    );
    await expect(deletePostedTransaction(owner, { id: existingPaymentTx.id })).rejects.toThrow(
      ImmutablePostedRecordError
    );

    const patchRes = await patchTransactionRoute(
      new NextRequest(`${trustedOrigin}/api/finance/transactions/${existingPaymentTx.id}`, {
        method: 'PATCH',
        headers: { origin: trustedOrigin, cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: existingPaymentTx.id }) }
    );
    expect(patchRes.status).toBe(409);
    expect((await patchRes.json()).code).toBe('IMMUTABLE_POSTED_RECORD');

    const delRes = await deleteTransactionRoute(
      new NextRequest(`${trustedOrigin}/api/finance/transactions/${existingPaymentTx.id}`, {
        method: 'DELETE',
        headers: { origin: trustedOrigin, cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: existingPaymentTx.id }) }
    );
    expect(delRes.status).toBe(409);
    expect((await delRes.json()).code).toBe('IMMUTABLE_POSTED_RECORD');

    // Direct SQL immutability, dimension integrity, no-truncate, receipt_sequence & balanced triggers
    const approvedAgreement = a1.feeAgreement;
    const cashLine = existingPaymentTx.lines.find((l) => l.accountType === 'CASH_CLEARING')!;
    const recvLine = existingPaymentTx.lines.find((l) => l.accountType === 'FEE_RECEIVABLE')!;
    const existingAlloc = existingPaymentTx.allocations[0];

    await expect(
      dedicated.pool.query(
        `UPDATE public."fee_agreement" SET "status" = 'DRAFT' WHERE "id" = $1`,
        [approvedAgreement.id]
      )
    ).rejects.toThrow(/approval status|immutable|cannot be modified/i);

    await expect(
      dedicated.pool.query(
        `UPDATE public."fee_agreement" SET "approved_at" = NOW() + interval '1 day' WHERE "id" = $1`,
        [approvedAgreement.id]
      )
    ).rejects.toThrow(/approval status|immutable|cannot be modified/i);

    await expect(
      dedicated.pool.query(
        `DELETE FROM public."fee_agreement" WHERE "id" = $1`,
        [approvedAgreement.id]
      )
    ).rejects.toThrow(/cannot be deleted/i);

    await expect(
      dedicated.pool.query(
        `UPDATE public."money_account" SET "currency" = 'EGP' WHERE "id" = $1`,
        [recvLine.accountId]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(
        `DELETE FROM public."money_account" WHERE "id" = $1`,
        [recvLine.accountId]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(
        `UPDATE public."fee_charge" SET "description" = 'sql tamper' WHERE "id" = $1`,
        [m1Charge1.id]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(`DELETE FROM public."fee_charge" WHERE "id" = $1`, [m1Charge1.id])
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(
        `UPDATE public."money_allocation" SET "amount_piastres" = 1 WHERE "id" = $1`,
        [existingAlloc.id]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(`DELETE FROM public."money_allocation" WHERE "id" = $1`, [
        existingAlloc.id,
      ])
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(
        `UPDATE public."money_transaction" SET "description" = 'sql tamper' WHERE "id" = $1`,
        [existingPaymentTx.id]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(`DELETE FROM public."money_transaction" WHERE "id" = $1`, [
        existingPaymentTx.id,
      ])
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(
        `UPDATE public."money_line" SET "amount_piastres" = 1 WHERE "id" = $1`,
        [recvLine.id]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(
        `DELETE FROM public."receipt" WHERE "id" = $1`,
        [existingPaymentTx.receiptId]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(`TRUNCATE public."money_line" CASCADE`)
    ).rejects.toThrow(/cannot be truncated/i);

    await expect(
      dedicated.pool.query(`TRUNCATE public."money_account" CASCADE`)
    ).rejects.toThrow(/cannot be truncated/i);

    await expect(
      dedicated.pool.query(
        `DELETE FROM public."receipt_sequence" WHERE "year" = $1`,
        [paySeed.receipt.year]
      )
    ).rejects.toThrow(/cannot be deleted/i);

    await expect(
      dedicated.pool.query(
        `UPDATE public."receipt_sequence" SET "next_val" = "next_val" - 1 WHERE "year" = $1`,
        [paySeed.receipt.year]
      )
    ).rejects.toThrow(/cannot decrease/i);

    // money_line dimension pairing & account-dimension integrity blocked
    await expect(
      dedicated.pool.query(
        `INSERT INTO public."money_line"
           ("id","transaction_id","account_id","side","amount_piastres","currency","matter_id","client_matter_party_id")
         VALUES ($1, $2, $3, 'DEBIT', 1000, 'EGP', $4, NULL)`,
        [crypto.randomUUID(), existingPaymentTx.id, cashLine.accountId, isoM1Id]
      )
    ).rejects.toThrow(/must match money_account|money_line_dimensions_paired_check/i);

    await expect(
      dedicated.pool.query(
        `INSERT INTO public."money_line"
           ("id","transaction_id","account_id","side","amount_piastres","currency","matter_id","client_matter_party_id")
         VALUES ($1, $2, $3, 'DEBIT', 1000, 'EGP', $4, $5)`,
        [crypto.randomUUID(), existingPaymentTx.id, recvLine.accountId, isoM2Id, isoM2ClientBMpId]
      )
    ).rejects.toThrow(/must match money_account/i);

    await expect(
      dedicated.pool.query(
        `INSERT INTO public."money_line"
           ("id","transaction_id","account_id","side","amount_piastres","currency","matter_id","client_matter_party_id")
         VALUES ($1, $2, $3, 'DEBIT', 1000, 'EGP', $4, $5)`,
        [crypto.randomUUID(), existingPaymentTx.id, cashLine.accountId, isoM1Id, isoM1ClientAMpId]
      )
    ).rejects.toThrow(/must match money_account/i);

    // Direct SQL empty POSTED transaction blocked at commit by DEFERRABLE constraint trigger
    await expect(
      dedicated.pool.query(
        `INSERT INTO public."money_transaction" ("id","kind","status","transaction_date","currency","total_amount_piastres","description","posted_by_id","posted_at","created_by_id")
         VALUES ($1, 'FEE_PAYMENT', 'POSTED', CURRENT_DATE, 'EGP', 10000, 'empty', $2, NOW(), $2)`,
        [crypto.randomUUID(), owner.id]
      )
    ).rejects.toThrow(/unbalanced or incomplete/i);

    // Direct SQL unbalanced POSTED transaction (single DEBIT money_line, no CREDIT) blocked on COMMIT by trg_money_line_balanced
    const unbalClient = await dedicated.pool.connect();
    try {
      const unbalTxId = crypto.randomUUID();
      await unbalClient.query('BEGIN');
      await unbalClient.query(
        `INSERT INTO public."money_transaction" ("id","kind","status","transaction_date","currency","total_amount_piastres","description","matter_id","posted_by_id","posted_at","created_by_id")
         VALUES ($1, 'FEE_PAYMENT', 'POSTED', CURRENT_DATE, 'EGP', 10000, 'unbalanced line check', $2, $3, NOW(), $3)`,
        [unbalTxId, isoM1Id, owner.id]
      );
      await unbalClient.query(
        `INSERT INTO public."money_line" ("id","transaction_id","account_id","side","amount_piastres","currency","matter_id","client_matter_party_id")
         VALUES ($1, $2, $3, 'DEBIT', 10000, 'EGP', $4, $5)`,
        [crypto.randomUUID(), unbalTxId, recvLine.accountId, isoM1Id, isoM1ClientAMpId]
      );
      await expect(unbalClient.query('COMMIT')).rejects.toThrow(/unbalanced or incomplete/i);
    } finally {
      await unbalClient.query('ROLLBACK').catch(() => {});
      unbalClient.release();
    }

    // Verify complete invariance of balances and ledger/receipt counts after all rejections
    const m1After = await getMatterFinanceSummary(owner, isoM1Id);
    const m2After = await getMatterFinanceSummary(owner, isoM2Id);
    expect(m1After.feesChargedPiastres).toBe(m1Before.feesChargedPiastres);
    expect(m1After.feesCollectedPiastres).toBe(m1Before.feesCollectedPiastres);
    expect(m1After.feesDuePiastres).toBe(m1Before.feesDuePiastres);
    expect(m2After.feesChargedPiastres).toBe(m2Before.feesChargedPiastres);
    expect(m2After.feesCollectedPiastres).toBe(m2Before.feesCollectedPiastres);
    expect(m2After.feesDuePiastres).toBe(m2Before.feesDuePiastres);
    expect(await prisma.moneyTransaction.count()).toBe(txCountBefore);
    expect(await prisma.moneyLine.count()).toBe(lineCountBefore);
    expect(await prisma.moneyAllocation.count()).toBe(allocCountBefore);
    expect(await prisma.receipt.count()).toBe(receiptCountBefore);
  });

  it('T13-TC-06: Audit failure rolls back ledger, allocation, receipt, sequence & idempotency; unauthorized & MAINTAINER return 401/403', async () => {
    const prisma = getPrismaClient();
    const isoMatter = await openMatter(owner, {
      title: 'ملف اختبار تراجع التدقيق والصلاحيات',
      kind: 'LITIGATION',
      initialClientId: clientAPartyId,
      idempotencyKey: `tc06-m-${crypto.randomUUID()}`,
    });
    const isoMatterId = isoMatter.matter.id;
    const isoClientMpId = isoMatter.matter.parties!.find((p) => p.partyId === clientAPartyId)!.id;
    const isoDraft = await saveFeeAgreementDraft(owner, {
      matterId: isoMatterId,
      clientMatterPartyId: isoClientMpId,
      description: 'اتفاق اختبار تراجع التدقيق',
      totalAmountPiastres: '100000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `tc06-d-${crypto.randomUUID()}`,
    });
    const isoApproved = await approveFeeAgreement(owner, {
      feeAgreementId: isoDraft.id,
      expectedVersion: isoDraft.version,
      idempotencyKey: `tc06-a-${crypto.randomUUID()}`,
    });
    const targetCharge = isoApproved.charges[0];

    const seqBeforeRows = await prisma.receiptSequence.findMany({ orderBy: { year: 'asc' } });
    const receiptCountBefore = await prisma.receipt.count();
    const txCountBefore = await prisma.moneyTransaction.count();
    const allocCountBefore = await prisma.moneyAllocation.count();

    const failKey = `tc06-audit-rollback-key-${crypto.randomUUID()}`;
    await expect(
      postTransaction(
        owner,
        {
          kind: 'FEE_PAYMENT',
          matterId: isoMatterId,
          clientMatterPartyId: isoClientMpId,
          transactionDate: '2026-11-27',
          paymentMethod: 'CASH',
          totalAmountPiastres: '100000',
          allocations: [{ feeChargeId: targetCharge.id, amountPiastres: '100000' }],
          idempotencyKey: failKey,
        },
        { simulateFailure: true }
      )
    ).rejects.toThrow('SIMULATED_AUDIT_TRANSACTION_FAILURE');

    expect(await prisma.moneyTransaction.count()).toBe(txCountBefore);
    expect(await prisma.moneyAllocation.count()).toBe(allocCountBefore);
    expect(await prisma.receipt.count()).toBe(receiptCountBefore);
    expect(await prisma.receiptSequence.findMany({ orderBy: { year: 'asc' } })).toEqual(seqBeforeRows);
    expect(
      await prisma.idempotencyRecord.findUnique({
        where: {
          actorId_commandType_key: {
            actorId: owner.id,
            commandType: 'postTransaction',
            key: failKey,
          },
        },
      })
    ).toBeNull();

    // Retry with same key succeeds cleanly with relative sequence check (no gap!)
    const retryOk = await postTransaction(owner, {
      kind: 'FEE_PAYMENT',
      matterId: isoMatterId,
      clientMatterPartyId: isoClientMpId,
      transactionDate: '2026-11-27',
      paymentMethod: 'CASH',
      totalAmountPiastres: '100000',
      allocations: [{ feeChargeId: targetCharge.id, amountPiastres: '100000' }],
      idempotencyKey: failKey,
    });
    const prevSeqForYear = seqBeforeRows.find((r) => r.year === retryOk.receipt.year)?.nextVal ?? 1;
    expect(retryOk.receipt.receiptNumber).toBe(
      `RCP-${retryOk.receipt.year}-${String(prevSeqForYear).padStart(4, '0')}`
    );
    expect(await prisma.receipt.count()).toBe(receiptCountBefore + 1);
    expect(retryOk.matterSummary.feesDuePiastres).toBe('0');

    // Unauthenticated HTTP calls -> 401
    expect(
      (
        await getFinanceOverviewRoute(
          new NextRequest(`${trustedOrigin}/api/finance`, { method: 'GET' })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await getStatementRoute(
          new NextRequest(`${trustedOrigin}/api/finance/statement?matterId=${isoMatterId}`, {
            method: 'GET',
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await postTransactionsRoute(
          new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: trustedOrigin },
            body: JSON.stringify({}),
          })
        )
      ).status
    ).toBe(401);

    // MAINTAINER HTTP calls -> 403 FORBIDDEN with zero finance data
    const maintOverview = await getFinanceOverviewRoute(
      new NextRequest(`${trustedOrigin}/api/finance`, {
        method: 'GET',
        headers: { cookie: maintainerCookie },
      })
    );
    expect(maintOverview.status).toBe(403);
    expect((await maintOverview.json()).code).toBe('FORBIDDEN');

    const maintStmt = await getStatementRoute(
      new NextRequest(`${trustedOrigin}/api/finance/statement?matterId=${isoMatterId}`, {
        method: 'GET',
        headers: { cookie: maintainerCookie },
      })
    );
    expect(maintStmt.status).toBe(403);

    const maintReceipt = await getReceiptRoute(
      new NextRequest(`${trustedOrigin}/api/finance/receipts/${retryOk.receipt.id}`, {
        method: 'GET',
        headers: { cookie: maintainerCookie },
      }),
      { params: Promise.resolve({ id: retryOk.receipt.id }) }
    );
    expect(maintReceipt.status).toBe(403);

    const maintPostTx = await postTransactionsRoute(
      new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: trustedOrigin,
          cookie: maintainerCookie,
        },
        body: JSON.stringify({ kind: 'FEE_PAYMENT' }),
      })
    );
    expect(maintPostTx.status).toBe(403);

    const maintPatchTx = await patchTransactionRoute(
      new NextRequest(`${trustedOrigin}/api/finance/transactions/${retryOk.transaction.id}`, {
        method: 'PATCH',
        headers: { origin: trustedOrigin, cookie: maintainerCookie },
      }),
      { params: Promise.resolve({ id: retryOk.transaction.id }) }
    );
    expect(maintPatchTx.status).toBe(403);

    // Untrusted origin -> 403
    const untrustedPost = await postTransactionsRoute(
      new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          cookie: ownerCookie,
        },
        body: JSON.stringify({}),
      })
    );
    expect(untrustedPost.status).toBe(403);
  });

  it('T13-TC-04b: Concurrent saveFeeAgreementDraft and approveFeeAgreement follow aligned lock hierarchy without deadlock', async () => {
    const prisma = getPrismaClient();
    const draft = await saveFeeAgreementDraft(owner, {
      matterId: matter2Id,
      clientMatterPartyId: matter2ClientBMpId,
      description: 'مسودة لاختبار ترتيب الأقفال',
      totalAmountPiastres: '200000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `tc04b-create-draft-${crypto.randomUUID()}`,
    });

    const raceResults = await Promise.allSettled([
      saveFeeAgreementDraft(owner, {
        feeAgreementId: draft.id,
        expectedVersion: draft.version,
        matterId: matter2Id,
        clientMatterPartyId: matter2ClientBMpId,
        description: 'تحديث متزامن للمسودة',
        totalAmountPiastres: '250000',
        agreementDate: '2026-11-27',
        chargingMethod: 'FIXED',
        idempotencyKey: `tc04b-race-update-${crypto.randomUUID()}`,
      }),
      approveFeeAgreement(owner, {
        feeAgreementId: draft.id,
        expectedVersion: draft.version,
        idempotencyKey: `tc04b-race-approve-${crypto.randomUUID()}`,
      }),
    ]);

    const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
    const rejected = raceResults.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(
      reason instanceof ConcurrencyConflictError || reason instanceof AlreadyPostedError
    ).toBe(true);
    const mapped = financeError(reason);
    expect(!mapped.success && mapped.code).toMatch(/^(CONCURRENCY_CONFLICT|ALREADY_POSTED)$/);

    const finalAgreement = await prisma.feeAgreement.findUniqueOrThrow({
      where: { id: draft.id },
      include: { charges: true },
    });
    if (finalAgreement.status === 'APPROVED') {
      expect(finalAgreement.approvedTransactionId).not.toBeNull();
      expect(finalAgreement.charges).toHaveLength(1);
      expect(finalAgreement.totalAmountPiastres).toBe(200000n);
      expect(finalAgreement.version).toBe(2);
    } else {
      expect(finalAgreement.status).toBe('DRAFT');
      expect(finalAgreement.approvedTransactionId).toBeNull();
      expect(finalAgreement.charges).toHaveLength(0);
      expect(finalAgreement.totalAmountPiastres).toBe(250000n);
      expect(finalAgreement.version).toBe(2);
    }
  });

  it('T13-REVIEW-GUARDS: updateMatterParty & unlinkMatterParty enforce ActiveObligationError, statement rejects non-CLIENT, and missing matterId throws NotFoundError', async () => {
    const prisma = getPrismaClient();
    const guardMatter = await openMatter(owner, {
      title: 'ملف اختبار قيود تعديل وفك ارتباط الأطراف',
      kind: 'LITIGATION',
      initialClientId: clientAPartyId,
      idempotencyKey: `guard-m-${crypto.randomUUID()}`,
    });
    const guardMatterId = guardMatter.matter.id;

    // 1. Link clientB as CLIENT, create approved FeeAgreement (creates FeeCharge), then test updateMatterParty demotion & unlinkMatterParty
    const clientBMp = await linkMatterParty(owner, {
      matterId: guardMatterId,
      partyId: clientBPartyId,
      role: 'CLIENT',
      billingEnabled: true,
      idempotencyKey: `guard-cb-${crypto.randomUUID()}`,
    });
    const draft = await saveFeeAgreementDraft(owner, {
      matterId: guardMatterId,
      clientMatterPartyId: clientBMp.id,
      description: 'اتفاق أتعاب يمنع تغيير الصفة أو الفك',
      totalAmountPiastres: '150000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `guard-draft-${crypto.randomUUID()}`,
    });
    await approveFeeAgreement(owner, {
      feeAgreementId: draft.id,
      expectedVersion: draft.version,
      idempotencyKey: `guard-approve-${crypto.randomUUID()}`,
    });

    await expect(
      updateMatterParty(owner, {
        matterId: guardMatterId,
        id: clientBMp.id,
        expectedVersion: clientBMp.version,
        role: 'OTHER',
        idempotencyKey: `guard-demote-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ActiveObligationError);

    // unlinkMatterParty on CLIENT with FeeCharge throws ActiveObligationError (never P2003)
    await expect(
      unlinkMatterParty(owner, {
        matterId: guardMatterId,
        id: clientBMp.id,
        expectedVersion: clientBMp.version,
        idempotencyKey: `guard-unlink-charge-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ActiveObligationError);

    // Non-CLIENT party without financial obligations can be unlinked cleanly
    const otherMp = await linkMatterParty(owner, {
      matterId: guardMatterId,
      partyId: thirdPartyPayerId,
      role: 'OTHER',
      idempotencyKey: `guard-other-${crypto.randomUUID()}`,
    });
    await expect(
      unlinkMatterParty(owner, {
        matterId: guardMatterId,
        id: otherMp.id,
        expectedVersion: otherMp.version,
        idempotencyKey: `guard-unlink-other-${crypto.randomUUID()}`,
      })
    ).resolves.toBeUndefined();

    // Non-CLIENT matterParty with a financial link (simulated row) still raises ActiveObligationError on unlinkMatterParty (never P2003)
    const opponentMp = await linkMatterParty(owner, {
      matterId: guardMatterId,
      partyId: thirdPartyPayerId,
      role: 'OPPONENT',
      idempotencyKey: `guard-opp-${crypto.randomUUID()}`,
    });
    await expect(
      getClientStatement(owner, { clientMatterPartyId: opponentMp.id })
    ).rejects.toThrow(ScopeMismatchError);

    // Create a non-CLIENT-linked FeeAgreement row via SQL (bypassing service role check) to prove unlinkMatterParty guards non-CLIENT against P2003 too
    const oppAgId = crypto.randomUUID();
    await prisma.feeAgreement.create({
      data: {
        id: oppAgId,
        matterId: guardMatterId,
        clientMatterPartyId: opponentMp.id,
        description: 'ربط مباشر لاختبار حراسة فك الارتباط',
        totalAmountPiastres: 10000n,
        currency: 'EGP',
        agreementDate: new Date('2026-11-27T00:00:00.000Z'),
        chargingMethod: 'FIXED',
        status: 'DRAFT',
        version: 1,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await expect(
      unlinkMatterParty(owner, {
        matterId: guardMatterId,
        id: opponentMp.id,
        expectedVersion: opponentMp.version,
        idempotencyKey: `guard-unlink-opp-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ActiveObligationError);

    await expect(
      listFinanceOverview(owner, { matterId: crypto.randomUUID() })
    ).rejects.toThrow(NotFoundError);
  });

  it('T13-DOCUMENTS-AND-ARCHIVED-PARTIES: agreementDocumentId linking, allowExistingArchived, AuditEvent, and archived Party rejections', async () => {
    const prisma = getPrismaClient();

    const docMatterA = await openMatter(owner, {
      title: 'ملف ربط مستند الاتفاق أ',
      kind: 'LITIGATION',
      initialClientId: clientAPartyId,
      idempotencyKey: `doc-mA-${crypto.randomUUID()}`,
    });
    const docMatterB = await openMatter(owner, {
      title: 'ملف ربط مستند الاتفاق ب',
      kind: 'CONSULTATION',
      initialClientId: clientBPartyId,
      idempotencyKey: `doc-mB-${crypto.randomUUID()}`,
    });
    const mAId = docMatterA.matter.id;
    const mAClientMpId = docMatterA.matter.parties!.find((p) => p.partyId === clientAPartyId)!.id;

    // Seed READY document in matter A and READY document in matter B
    const docAId = crypto.randomUUID();
    const verAId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: docAId,
        matterId: mAId,
        title: 'عقد أتعاب ممسوح',
        titleNormalized: 'عقد اتعاب ممسوح',
        documentType: 'CONTRACT',
        sensitivity: 'CONFIDENTIAL',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.documentVersion.create({
      data: {
        id: verAId,
        documentId: docAId,
        versionNumber: 1,
        objectKey: `synthetic/${docAId}/v1.pdf`,
        originalFilename: 'fee-contract.pdf',
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
        sizeBytes: 1024,
        sha256: crypto.createHash('sha256').update('synthetic-a').digest('hex'),
        uploadStatus: 'READY',
        scanStatus: 'NOT_SCANNED_POLICY',
        createdById: owner.id,
      },
    });
    await prisma.document.update({
      where: { id: docAId },
      data: { currentVersionId: verAId },
    });

    const docBId = crypto.randomUUID();
    const verBId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: docBId,
        matterId: docMatterB.matter.id,
        title: 'مستند ملف آخر',
        titleNormalized: 'مستند ملف اخر',
        documentType: 'CONTRACT',
        sensitivity: 'CONFIDENTIAL',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    await prisma.documentVersion.create({
      data: {
        id: verBId,
        documentId: docBId,
        versionNumber: 1,
        objectKey: `synthetic/${docBId}/v1.pdf`,
        originalFilename: 'other-contract.pdf',
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
        sizeBytes: 1024,
        sha256: crypto.createHash('sha256').update('synthetic-b').digest('hex'),
        uploadStatus: 'READY',
        scanStatus: 'NOT_SCANNED_POLICY',
        createdById: owner.id,
      },
    });
    await prisma.document.update({
      where: { id: docBId },
      data: { currentVersionId: verBId },
    });

    // 1. READY same-matter doc links cleanly & AuditEvent records agreementDocumentId
    const draftWithDoc = await saveFeeAgreementDraft(owner, {
      matterId: mAId,
      clientMatterPartyId: mAClientMpId,
      description: 'اتفاق مرتبط بمستند جاهز',
      totalAmountPiastres: '400000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      agreementDocumentId: docAId,
      idempotencyKey: `doc-link-ok-${crypto.randomUUID()}`,
    });
    expect(draftWithDoc.agreementDocumentId).toBe(docAId);

    const createAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: 'FeeAgreement',
        entityId: draftWithDoc.id,
        action: 'CREATE_FEE_AGREEMENT_DRAFT',
      },
    });
    expect(createAudit).not.toBeNull();
    expect((createAudit!.changedFields as Record<string, unknown>).agreementDocumentId).toBe(docAId);

    // 2. Cross-matter document rejected with 403 CROSS_MATTER_LINK_FORBIDDEN
    await expect(
      saveFeeAgreementDraft(owner, {
        matterId: mAId,
        clientMatterPartyId: mAClientMpId,
        description: 'محاولة ربط مستند ملف آخر',
        totalAmountPiastres: '400000',
        agreementDate: '2026-11-27',
        chargingMethod: 'FIXED',
        agreementDocumentId: docBId,
        idempotencyKey: `doc-cross-svc-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    const crossDocRes = await postAgreementDraftRoute(
      new NextRequest(`${trustedOrigin}/api/finance/agreements`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: trustedOrigin,
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: mAId,
          clientMatterPartyId: mAClientMpId,
          description: 'ربط عبر HTTP لمستند ملف آخر',
          totalAmountPiastres: '400000',
          agreementDate: '2026-11-27',
          chargingMethod: 'FIXED',
          agreementDocumentId: docBId,
          idempotencyKey: `doc-cross-http-${crypto.randomUUID()}`,
        }),
      })
    );
    expect(crossDocRes.status).toBe(403);
    expect((await crossDocRes.json()).code).toBe('CROSS_MATTER_LINK_FORBIDDEN');

    // 3. Archive docA -> editing existing DRAFT keeping docA succeeds via allowExistingArchived
    await prisma.document.update({
      where: { id: docAId },
      data: { archivedAt: new Date() },
    });

    const editedWithArchivedDoc = await saveFeeAgreementDraft(owner, {
      feeAgreementId: draftWithDoc.id,
      expectedVersion: draftWithDoc.version,
      matterId: mAId,
      clientMatterPartyId: mAClientMpId,
      description: 'تعديل المسودة مع الإبقاء على المستند المؤرشف',
      totalAmountPiastres: '450000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      agreementDocumentId: docAId,
      idempotencyKey: `doc-edit-archived-${crypto.randomUUID()}`,
    });
    expect(editedWithArchivedDoc.agreementDocumentId).toBe(docAId);
    expect(editedWithArchivedDoc.totalAmountPiastres).toBe('450000');

    // Linking a newly archived document on a new draft fails
    await expect(
      saveFeeAgreementDraft(owner, {
        matterId: mAId,
        clientMatterPartyId: mAClientMpId,
        description: 'ربط مستند مؤرشف حديثاً',
        totalAmountPiastres: '400000',
        agreementDate: '2026-11-27',
        chargingMethod: 'FIXED',
        agreementDocumentId: docAId,
        idempotencyKey: `doc-new-archived-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(DocumentValidationError);

    // 4. Archived Party rejection as payerPartyId in postTransaction & as client in saveFeeAgreementDraft
    const approvedDraft = await approveFeeAgreement(owner, {
      feeAgreementId: editedWithArchivedDoc.id,
      expectedVersion: editedWithArchivedDoc.version,
      idempotencyKey: `doc-approve-${crypto.randomUUID()}`,
    });

    const archivedPayer = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'دافع مؤرشف اختبار',
        nameNormalized: 'دافع مؤرشف اختبار',
        archivedAt: new Date(),
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    await expect(
      postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId: mAId,
        clientMatterPartyId: mAClientMpId,
        payerPartyId: archivedPayer.id,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '100000',
        allocations: [{ feeChargeId: approvedDraft.charges[0].id, amountPiastres: '100000' }],
        idempotencyKey: `archived-payer-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(FinanceValidationError);

    const tempClient = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'موكل سيؤرشف اختبار',
        nameNormalized: 'موكل سيوءرشف اختبار',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const archivedClientMp = await linkMatterParty(owner, {
      matterId: mAId,
      partyId: tempClient.id,
      role: 'CLIENT',
      idempotencyKey: `arch-client-link-${crypto.randomUUID()}`,
    });
    await prisma.party.update({
      where: { id: tempClient.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      saveFeeAgreementDraft(owner, {
        matterId: mAId,
        clientMatterPartyId: archivedClientMp.id,
        description: 'اتفاق لموكل مؤرشف',
        totalAmountPiastres: '100000',
        agreementDate: '2026-11-27',
        chargingMethod: 'FIXED',
        idempotencyKey: `archived-client-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(FinanceValidationError);
  });

  it('T13-OVERVIEW-SEARCH-PAGINATION-AND-STATEMENT: unfiltered office totals, Arabic q search, pagination, page=abc (400), and cross-matter client statement', async () => {
    const prisma = getPrismaClient();

    // Create a dedicated multi-matter client party for exact multi-matter statement assertions
    const multiParty = await prisma.party.create({
      data: {
        kind: 'ORGANIZATION',
        name: 'شركة الأهرام للتوريدات',
        nameNormalized: 'شركه الاهرام للتوريدات',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const mm1 = await openMatter(owner, {
      title: 'أول قضية متعددة الملفات ١٢٣',
      kind: 'LITIGATION',
      initialClientId: multiParty.id,
      idempotencyKey: `mm1-${crypto.randomUUID()}`,
    });
    const mm2 = await openMatter(owner, {
      title: 'ثاني استشارة متعددة الملفات',
      kind: 'CONSULTATION',
      initialClientId: multiParty.id,
      idempotencyKey: `mm2-${crypto.randomUUID()}`,
    });
    const mm1MpId = mm1.matter.parties!.find((p) => p.partyId === multiParty.id)!.id;
    const mm2MpId = mm2.matter.parties!.find((p) => p.partyId === multiParty.id)!.id;

    const ag1 = await saveFeeAgreementDraft(owner, {
      matterId: mm1.matter.id,
      clientMatterPartyId: mm1MpId,
      description: 'اتفاق إجراءات التوريد الأول',
      totalAmountPiastres: '700000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `mm-ag1-${crypto.randomUUID()}`,
    });
    const app1 = await approveFeeAgreement(owner, {
      feeAgreementId: ag1.id,
      expectedVersion: ag1.version,
      idempotencyKey: `mm-app1-${crypto.randomUUID()}`,
    });
    await postTransaction(owner, {
      kind: 'FEE_PAYMENT',
      matterId: mm1.matter.id,
      clientMatterPartyId: mm1MpId,
      transactionDate: '2026-11-27',
      paymentMethod: 'BANK_TRANSFER',
      totalAmountPiastres: '300000',
      allocations: [{ feeChargeId: app1.charges[0].id, amountPiastres: '300000' }],
      idempotencyKey: `mm-pay1-${crypto.randomUUID()}`,
    });

    const ag2 = await saveFeeAgreementDraft(owner, {
      matterId: mm2.matter.id,
      clientMatterPartyId: mm2MpId,
      description: 'اتفاق استشارة التوريد الثاني',
      totalAmountPiastres: '500000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `mm-ag2-${crypto.randomUUID()}`,
    });
    const app2 = await approveFeeAgreement(owner, {
      feeAgreementId: ag2.id,
      expectedVersion: ag2.version,
      idempotencyKey: `mm-app2-${crypto.randomUUID()}`,
    });
    await postTransaction(owner, {
      kind: 'FEE_PAYMENT',
      matterId: mm2.matter.id,
      clientMatterPartyId: mm2MpId,
      transactionDate: '2026-11-27',
      paymentMethod: 'CASH',
      totalAmountPiastres: '200000',
      allocations: [{ feeChargeId: app2.charges[0].id, amountPiastres: '200000' }],
      idempotencyKey: `mm-pay2-${crypto.randomUUID()}`,
    });

    // Extra draft so there are > 2 agreements for pagination verification
    await saveFeeAgreementDraft(owner, {
      matterId: mm2.matter.id,
      clientMatterPartyId: mm2MpId,
      description: 'مسودة ثالثة لاختبار الترقيم',
      totalAmountPiastres: '100000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: `mm-ag3-${crypto.randomUUID()}`,
    });

    // 1. Unfiltered office totals match raw posted FEE_RECEIVABLE ledger totals
    const unfiltered = await listFinanceOverview(owner, {});
    const ledgerSums = await dedicated.pool.query<{ debits: string; credits: string }>(`
      SELECT
        COALESCE(SUM(CASE WHEN ml."side" = 'DEBIT' THEN ml."amount_piastres" ELSE 0 END), 0)::text AS debits,
        COALESCE(SUM(CASE WHEN ml."side" = 'CREDIT' THEN ml."amount_piastres" ELSE 0 END), 0)::text AS credits
      FROM public."money_line" ml
      JOIN public."money_account" ma ON ma."id" = ml."account_id"
      JOIN public."money_transaction" mt ON mt."id" = ml."transaction_id"
      WHERE ma."type" = 'FEE_RECEIVABLE'
        AND mt."status" = 'POSTED'
    `);
    const expectedCharged = BigInt(ledgerSums.rows[0].debits);
    const expectedCollected = BigInt(ledgerSums.rows[0].credits);
    expect(unfiltered.totals.feesChargedPiastres).toBe(expectedCharged.toString());
    expect(unfiltered.totals.feesCollectedPiastres).toBe(expectedCollected.toString());
    expect(unfiltered.totals.feesDuePiastres).toBe((expectedCharged - expectedCollected).toString());

    // 2. Arabic normalization search `q` (no hamza / h instead of taa marbuta / Eastern digits)
    const searchByClient = await listFinanceOverview(owner, { q: 'شركة الاهرام' });
    expect(searchByClient.agreements.length).toBeGreaterThanOrEqual(3);
    expect(searchByClient.openCharges.some((c) => c.matterId === mm1.matter.id)).toBe(true);
    expect(searchByClient.openCharges.some((c) => c.matterId === mm2.matter.id)).toBe(true);

    const searchByMatterDigits = await listFinanceOverview(owner, { q: '١٢٣' });
    expect(searchByMatterDigits.agreements.some((a) => a.id === ag1.id)).toBe(true);

    // 3. Pagination (page & limit)
    const page1 = await listFinanceOverview(owner, { page: 1, limit: 2 });
    const page2 = await listFinanceOverview(owner, { page: 2, limit: 2 });
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.totalAgreements).toBeGreaterThanOrEqual(3);
    expect(page1.agreements).toHaveLength(2);
    expect(page2.agreements.length).toBeGreaterThanOrEqual(1);
    const page1Ids = new Set(page1.agreements.map((a) => a.id));
    for (const ag of page2.agreements) {
      expect(page1Ids.has(ag.id)).toBe(false);
    }

    // 4. HTTP invalid integer param -> 400
    const badPageRes = await getFinanceOverviewRoute(
      new NextRequest(`${trustedOrigin}/api/finance?page=abc`, {
        method: 'GET',
        headers: { cookie: ownerCookie },
      })
    );
    expect(badPageRes.status).toBe(400);
    expect((await badPageRes.json()).code).toBe('VALIDATION_ERROR');

    // 5. Cross-matter getClientStatement({ partyId }) aggregates across both matters cleanly
    const multiStmt = await getClientStatement(owner, { partyId: multiParty.id });
    expect(multiStmt.scope.matterId).toBeNull();
    expect(multiStmt.scope.partyId).toBe(multiParty.id);
    expect(multiStmt.feesChargedPiastres).toBe('1200000'); // 700,000 + 500,000
    expect(multiStmt.feesCollectedPiastres).toBe('500000'); // 300,000 + 200,000
    expect(multiStmt.feesDuePiastres).toBe('700000');
    expect(multiStmt.charges).toHaveLength(2);
    expect(multiStmt.transactions).toHaveLength(4); // 2 FEE_CHARGE + 2 FEE_PAYMENT
    expect(multiStmt.reconciled).toBe(true);
  });

  it('T13-HTTP-SECURITY-REPRINT-SPLIT-AND-IDEMPOTENCY: 413 payload limit, Sec-Fetch-Site same-site 403, reprint 400/404/401, split multi-charge payment, INSTALLMENTS empty, draft/approve idempotency', async () => {
    const prisma = getPrismaClient();
    const m = await openMatter(owner, {
      title: 'ملف اختبار التوزيع المتعدد والأمان',
      kind: 'LITIGATION',
      initialClientId: clientAPartyId,
      idempotencyKey: `sec-m-${crypto.randomUUID()}`,
    });
    const mId = m.matter.id;
    const mpId = m.matter.parties!.find((p) => p.partyId === clientAPartyId)!.id;

    // 1. saveFeeAgreementDraft idempotency replay & payload mismatch
    const draftKey = `sec-draft-${crypto.randomUUID()}`;
    const draftPayload = {
      matterId: mId,
      clientMatterPartyId: mpId,
      description: 'اتفاق أقساط متعدد',
      totalAmountPiastres: '1000000',
      agreementDate: '2026-11-27',
      chargingMethod: 'INSTALLMENTS' as const,
      idempotencyKey: draftKey,
    };
    const d1 = await saveFeeAgreementDraft(owner, draftPayload);
    const d1Replay = await saveFeeAgreementDraft(owner, draftPayload);
    expect(d1Replay.id).toBe(d1.id);
    expect(d1Replay.version).toBe(d1.version);

    await expect(
      saveFeeAgreementDraft(owner, {
        ...draftPayload,
        totalAmountPiastres: '1100000',
      })
    ).rejects.toThrow(IdempotencyPayloadMismatchError);

    // 2. approveFeeAgreement INSTALLMENTS empty rejection
    await expect(
      approveFeeAgreement(owner, {
        feeAgreementId: d1.id,
        expectedVersion: d1.version,
        installments: [],
        idempotencyKey: `sec-app-empty-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(FinanceValidationError);

    // 3. approveFeeAgreement idempotency replay & mismatch
    const approveKey = `sec-app-${crypto.randomUUID()}`;
    const approvePayload = {
      feeAgreementId: d1.id,
      expectedVersion: d1.version,
      installments: [
        { description: 'قسط أ', amountPiastres: '400000' },
        { description: 'قسط ب', amountPiastres: '600000' },
      ],
      idempotencyKey: approveKey,
    };
    const app1 = await approveFeeAgreement(owner, approvePayload);
    const app1Replay = await approveFeeAgreement(owner, approvePayload);
    expect(app1Replay.transaction.id).toBe(app1.transaction.id);
    expect(app1Replay.charges.map((c) => c.id)).toEqual(app1.charges.map((c) => c.id));

    await expect(
      approveFeeAgreement(owner, {
        ...approvePayload,
        installments: [
          { description: 'قسط أ', amountPiastres: '500000' },
          { description: 'قسط ب', amountPiastres: '500000' },
        ],
      })
    ).rejects.toThrow(IdempotencyPayloadMismatchError);

    // 4. Multi-charge split collection in one postTransaction
    const c1 = app1.charges[0];
    const c2 = app1.charges[1];
    const splitPay = await postTransaction(owner, {
      kind: 'FEE_PAYMENT',
      matterId: mId,
      clientMatterPartyId: mpId,
      transactionDate: '2026-11-27',
      paymentMethod: 'INSTAPAY',
      totalAmountPiastres: '650000',
      allocations: [
        { feeChargeId: c1.id, amountPiastres: '400000' },
        { feeChargeId: c2.id, amountPiastres: '250000' },
      ],
      idempotencyKey: `sec-split-${crypto.randomUUID()}`,
    });
    expect(splitPay.transaction.allocations).toHaveLength(2);
    expect(splitPay.receipt.headerSnapshot.allocations).toHaveLength(2);
    expect(splitPay.receipt.headerSnapshot.feesRemainingAfterPiastres).toBe('350000');
    expect(splitPay.matterSummary.feesCollectedPiastres).toBe('650000');
    expect(splitPay.matterSummary.feesDuePiastres).toBe('350000');
    const c2After = splitPay.matterSummary.charges.find((c) => c.id === c2.id)!;
    expect(c2After.allocatedPiastres).toBe('250000');
    expect(c2After.remainingPiastres).toBe('350000');

    // 5. HTTP 413 PAYLOAD_TOO_LARGE on oversized finance JSON POST
    const hugeDescription = 'أ'.repeat(140 * 1024);
    const oversizedRes = await postTransactionsRoute(
      new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: trustedOrigin,
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          kind: 'FEE_PAYMENT',
          description: hugeDescription,
        }),
      })
    );
    expect(oversizedRes.status).toBe(413);
    expect((await oversizedRes.json()).code).toBe('PAYLOAD_TOO_LARGE');

    // 6. Sec-Fetch-Site: same-site rejection (403)
    const sameSiteGetRes = await getFinanceOverviewRoute(
      new NextRequest(`${trustedOrigin}/api/finance`, {
        method: 'GET',
        headers: {
          cookie: ownerCookie,
          'sec-fetch-site': 'same-site',
        },
      })
    );
    expect(sameSiteGetRes.status).toBe(403);
    expect((await sameSiteGetRes.json()).code).toBe('FORBIDDEN');

    const sameSitePostRes = await postTransactionsRoute(
      new NextRequest(`${trustedOrigin}/api/finance/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: trustedOrigin,
          cookie: ownerCookie,
          'sec-fetch-site': 'same-site',
        },
        body: JSON.stringify({ kind: 'FEE_PAYMENT' }),
      })
    );
    expect(sameSitePostRes.status).toBe(403);
    expect((await sameSitePostRes.json()).code).toBe('FORBIDDEN');

    // 7. reprintReceipt 400 / 404 / 401
    await expect(reprintReceipt(owner, 'not-a-uuid')).rejects.toThrow(FinanceValidationError);
    await expect(reprintReceipt(owner, crypto.randomUUID())).rejects.toThrow(NotFoundError);

    const receiptBadIdRes = await getReceiptRoute(
      new NextRequest(`${trustedOrigin}/api/finance/receipts/not-a-uuid`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );
    expect(receiptBadIdRes.status).toBe(400);

    const missingId = crypto.randomUUID();
    const receiptNotFoundRes = await getReceiptRoute(
      new NextRequest(`${trustedOrigin}/api/finance/receipts/${missingId}`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: missingId }) }
    );
    expect(receiptNotFoundRes.status).toBe(404);

    const receiptUnauthRes = await getReceiptRoute(
      new NextRequest(`${trustedOrigin}/api/finance/receipts/${splitPay.receipt.id}`),
      { params: Promise.resolve({ id: splitPay.receipt.id }) }
    );
    expect(receiptUnauthRes.status).toBe(401);
    expect(await prisma.receipt.count({ where: { id: splitPay.receipt.id } })).toBe(1);
  });
});