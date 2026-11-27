import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAuth, getPrismaClient } from '@/lib/auth';
import { closeDbPool } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { openMatter, linkMatterParty } from '@/modules/matters/matter-service';
import {
  ConcurrencyConflictError,
  ExcessAllocationError,
  FinanceValidationError,
  ImmutablePostedRecordError,
  ScopeMismatchError,
  UnsupportedTransactionKindError,
  approveFeeAgreement,
  deletePostedTransaction,
  getMatterFinanceSummary,
  postTransaction,
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
    expect(payJson.data.receipt.receiptNumber).toMatch(/^RCP-\d{4}-0001$/);
    expect(payJson.data.receipt.payerName).toBe('سعيد حسن الدافع');
    expect(payJson.data.receipt.headerSnapshot.feesRemainingAfterPiastres).toBe('1000000');

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
    expect(await prisma.receipt.count()).toBe(1);
  });
  it('T13-TC-04: Concurrent 4,000 EGP payments against 5,000 EGP remaining allow only one, leaving 1,000 EGP', async () => {
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

    const summary = await getMatterFinanceSummary(owner, matter2Id);
    expect(summary.feesChargedPiastres).toBe('500000');
    expect(summary.feesCollectedPiastres).toBe('400000');
    expect(summary.feesDuePiastres).toBe('100000');
  });

  it('T13-TC-05: Rejects invalid amounts, mismatched scope, unbalanced/empty postings, excess, OFFICE_EXPENSE, and immutability violations (service, HTTP & direct SQL)', async () => {
    const prisma = getPrismaClient();
    const m1Summary = await getMatterFinanceSummary(owner, matter1Id);
    const m1Charge1 = m1Summary.charges[0];
    const m2Summary = await getMatterFinanceSummary(owner, matter2Id);
    const m2Charge = m2Summary.charges[0];
    const existingPaymentTx = m1Summary.transactions.find((t) => t.kind === 'FEE_PAYMENT')!;

    // 1. Zero / negative / float amounts rejected
    for (const badAmount of ['0', '-100', '12.5']) {
      await expect(
        postTransaction(owner, {
          kind: 'FEE_PAYMENT',
          matterId: matter1Id,
          clientMatterPartyId: matter1ClientAMpId,
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
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientBMpId,
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
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientAMpId,
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
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientAMpId,
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
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientAMpId,
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
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientAMpId,
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
        matterId: matter1Id,
        clientMatterPartyId: matter1ClientAMpId,
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
          matterId: matter1Id,
          clientMatterPartyId: matter1ClientAMpId,
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
          matterId: matter1Id,
          clientMatterPartyId: matter1ClientAMpId,
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

    // 6. Immutability via service, HTTP PATCH/DELETE, and direct SQL
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

    // Direct SQL immutability & balanced constraint triggers
    const approvedAgreement = m1Summary.agreements.find((a) => a.status === 'APPROVED')!;
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
        `UPDATE public."fee_agreement" SET "approved_by_id" = $2 WHERE "id" = $1`,
        [approvedAgreement.id, crypto.randomUUID()]
      )
    ).rejects.toThrow(/approval status|immutable|cannot be modified/i);

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
        [existingPaymentTx.lines[0].id]
      )
    ).rejects.toThrow(/immutable/i);

    await expect(
      dedicated.pool.query(
        `DELETE FROM public."receipt" WHERE "id" = $1`,
        [existingPaymentTx.receiptId]
      )
    ).rejects.toThrow(/immutable/i);

    // Direct SQL empty/unbalanced POSTED transaction blocked at commit by DEFERRABLE constraint trigger
    await expect(
      dedicated.pool.query(
        `INSERT INTO public."money_transaction" ("id","kind","status","transaction_date","currency","total_amount_piastres","description","posted_by_id","posted_at","created_by_id")
         VALUES ($1, 'FEE_PAYMENT', 'POSTED', CURRENT_DATE, 'EGP', 10000, 'empty', $2, NOW(), $2)`,
        [crypto.randomUUID(), owner.id]
      )
    ).rejects.toThrow(/unbalanced or incomplete/i);
  });

  it('T13-TC-06: Audit failure rolls back ledger, allocation, receipt, sequence & idempotency; unauthorized & MAINTAINER return 401/403', async () => {
    const prisma = getPrismaClient();
    const m2SummaryBefore = await getMatterFinanceSummary(owner, matter2Id);
    const m2Charge = m2SummaryBefore.charges[0];
    const seqBeforeRows = await prisma.receiptSequence.findMany();
    const receiptCountBefore = await prisma.receipt.count();
    const txCountBefore = await prisma.moneyTransaction.count();
    const allocCountBefore = await prisma.moneyAllocation.count();

    const failKey = 'tc06-audit-rollback-key';
    await expect(
      postTransaction(
        owner,
        {
          kind: 'FEE_PAYMENT',
          matterId: matter2Id,
          clientMatterPartyId: matter2ClientBMpId,
          transactionDate: '2026-11-27',
          paymentMethod: 'CASH',
          totalAmountPiastres: '100000',
          allocations: [{ feeChargeId: m2Charge.id, amountPiastres: '100000' }],
          idempotencyKey: failKey,
        },
        { simulateFailure: true }
      )
    ).rejects.toThrow('SIMULATED_AUDIT_TRANSACTION_FAILURE');

    expect(await prisma.moneyTransaction.count()).toBe(txCountBefore);
    expect(await prisma.moneyAllocation.count()).toBe(allocCountBefore);
    expect(await prisma.receipt.count()).toBe(receiptCountBefore);
    expect(await prisma.receiptSequence.findMany()).toEqual(seqBeforeRows);
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

    // Retry with same key succeeds cleanly with no sequence gap!
    const retryOk = await postTransaction(owner, {
      kind: 'FEE_PAYMENT',
      matterId: matter2Id,
      clientMatterPartyId: matter2ClientBMpId,
      transactionDate: '2026-11-27',
      paymentMethod: 'CASH',
      totalAmountPiastres: '100000',
      allocations: [{ feeChargeId: m2Charge.id, amountPiastres: '100000' }],
      idempotencyKey: failKey,
    });
    expect(retryOk.receipt.receiptNumber).toMatch(/^RCP-\d{4}-0003$/);
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
          new NextRequest(`${trustedOrigin}/api/finance/statement?matterId=${matter1Id}`, {
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
      new NextRequest(`${trustedOrigin}/api/finance/statement?matterId=${matter1Id}`, {
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
    const draft = await saveFeeAgreementDraft(owner, {
      matterId: matter2Id,
      clientMatterPartyId: matter2ClientBMpId,
      description: 'مسودة لاختبار ترتيب الأقفال',
      totalAmountPiastres: '200000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      idempotencyKey: 'tc04b-create-draft',
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
        idempotencyKey: 'tc04b-race-update',
      }),
      approveFeeAgreement(owner, {
        feeAgreementId: draft.id,
        expectedVersion: draft.version,
        idempotencyKey: 'tc04b-race-approve',
      }),
    ]);

    const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
    const rejected = raceResults.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
    expect(reason.code).not.toBe('40P01');
  });
});