import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  approveFeeAgreement,
  getClientStatement,
  listFinanceOverview,
  postTransaction,
  saveFeeAgreementDraft,
} from '@/modules/finance';
import { financeError } from '@/modules/finance/finance-errors';
import { statusFromFinanceErrorCode } from '@/modules/finance/finance-http';
import {
  FinanceValidationError,
  MAX_PIASTRE_AMOUNT,
  approveFeeAgreementSchema,
  explicitLedgerLineInputSchema,
  feeAllocationInputSchema,
  feeInstallmentInputSchema,
  formatEgpPiastres,
  getClientStatementSchema,
  listFinanceOverviewSchema,
  parseEgpToPiastres,
  parsePositivePiastres,
  piastresToEgpDecimalString,
  postTransactionSchema,
  saveFeeAgreementDraftSchema,
} from '@/modules/finance/finance-types';
import { createSyntheticActor } from '../helpers/party-test-helper';

describe('T13 Unit Tests: Finance Validation, Arabic/Latin Digits & BigInt Piastres', () => {
  it('parses Arabic-Indic, Persian, and Latin digits into exact BigInt piastres without floats', () => {
    expect(parsePositivePiastres('1500000')).toBe(1500000n);
    expect(parsePositivePiastres('١٥٠٠٠٠٠')).toBe(1500000n);
    expect(parsePositivePiastres('۵۰۰۰۰۰')).toBe(500000n);
    expect(parsePositivePiastres(600000)).toBe(600000n);
    expect(parsePositivePiastres(900000n)).toBe(900000n);
    expect(parsePositivePiastres('9007199254740993')).toBe(9007199254740993n);

    expect(parseEgpToPiastres('15000')).toBe(1500000n);
    expect(parseEgpToPiastres('١٥٠٠٠')).toBe(1500000n);
    expect(parseEgpToPiastres('15,000.50')).toBe(1500050n);
    expect(parseEgpToPiastres('١٥٬٠٠٠٫٢٥')).toBe(1500025n);
    expect(parseEgpToPiastres('٥٠٠٠.٥')).toBe(500050n);
  });

  it('rejects zero, negative, float, >2 decimal places, and malformed amounts', () => {
    for (const badPiastres of ['0', '٠', '-100', '-١٠٠', '12.5', 12.5, 0, -50, 0n, -1n, '1e5', 'abc', '']) {
      expect(() => parsePositivePiastres(badPiastres), String(badPiastres)).toThrow();
    }

    for (const badEgp of ['0', '0.00', '٠٫٠٠', '-500', '100.123', '١٠٠٫١٢٣', '10.5.2', 'abc', '', 15000 as unknown]) {
      expect(() => parseEgpToPiastres(badEgp as string), String(badEgp)).toThrow();
    }
  });

  it('formats exact BigInt piastres to EGP strings without float precision loss', () => {
    expect(piastresToEgpDecimalString(1500000n)).toBe('15000.00');
    expect(piastresToEgpDecimalString(500025n)).toBe('5000.25');
    expect(piastresToEgpDecimalString(9007199254740993n)).toBe('90071992547409.93');

    expect(formatEgpPiastres(1500000n)).toBe('15,000 ج.م.');
    expect(formatEgpPiastres(1500000n, { showZeroDecimals: true })).toBe('15,000.00 ج.م.');
    expect(formatEgpPiastres(1000050n, { includeCurrency: false })).toBe('10,000.50');
  });

  it('validates saveFeeAgreementDraftSchema and approveFeeAgreementSchema', () => {
    const matterId = crypto.randomUUID();
    const clientMatterPartyId = crypto.randomUUID();
    const feeAgreementId = crypto.randomUUID();

    const draftOk = saveFeeAgreementDraftSchema.safeParse({
      matterId,
      clientMatterPartyId,
      description: 'اتفاق أتعاب الدعوى المدنية',
      totalAmountPiastres: '١٥٠٠٠٠٠',
      agreementDate: '2026-11-27',
      chargingMethod: 'INSTALLMENTS',
      idempotencyKey: 't13-draft-1',
    });
    expect(draftOk.success).toBe(true);
    if (draftOk.success) {
      expect(draftOk.data.totalAmountPiastres).toBe('1500000');
    }

    // Update without expectedVersion rejected
    expect(
      saveFeeAgreementDraftSchema.safeParse({
        feeAgreementId,
        matterId,
        clientMatterPartyId,
        description: 'تحديث',
        totalAmountPiastres: '1500000',
        agreementDate: '2026-11-27',
        chargingMethod: 'FIXED',
        idempotencyKey: 't13-draft-2',
      }).success
    ).toBe(false);

    // Zero or float rejected
    expect(
      saveFeeAgreementDraftSchema.safeParse({
        matterId,
        clientMatterPartyId,
        description: 'مرفوض',
        totalAmountPiastres: '150.5',
        agreementDate: '2026-11-27',
        chargingMethod: 'FIXED',
        idempotencyKey: 't13-draft-3',
      }).success
    ).toBe(false);

    const approveOk = approveFeeAgreementSchema.safeParse({
      feeAgreementId,
      expectedVersion: 1,
      installments: [
        { description: 'الدفعة الأولى', amountPiastres: '٦٠٠٠٠٠', dueDate: '2026-12-01' },
        { description: 'الدفعة الثانية', amountPiastres: '900000', dueDate: '2027-01-01' },
      ],
      idempotencyKey: 't13-approve-1',
    });
    expect(approveOk.success).toBe(true);
    if (approveOk.success) {
      const sum = approveOk.data.installments!.reduce((s, i) => s + BigInt(i.amountPiastres), 0n);
      expect(sum).toBe(1500000n);
    }
  });

  it('rejects unsupported kinds (OFFICE_EXPENSE, T14/T15), unbalanced allocations, empty postings, and duplicate charges', () => {
    const matterId = crypto.randomUUID();
    const clientMatterPartyId = crypto.randomUUID();
    const chargeA = crypto.randomUUID();
    const chargeB = crypto.randomUUID();

    // Valid FEE_PAYMENT with Arabic digits
    const valid = postTransactionSchema.safeParse({
      kind: 'FEE_PAYMENT',
      matterId,
      clientMatterPartyId,
      transactionDate: '2026-11-27',
      paymentMethod: 'CASH',
      totalAmountPiastres: '٥٠٠٠٠٠',
      allocations: [{ feeChargeId: chargeA, amountPiastres: '500000' }],
      idempotencyKey: 't13-pay-1',
    });
    expect(valid.success).toBe(true);

    // Unsupported OFFICE_EXPENSE and future kinds rejected
    for (const kind of ['OFFICE_EXPENSE', 'REIMBURSABLE_EXPENSE', 'ADVANCE_RECEIPT', 'REFUND', 'REVERSAL']) {
      expect(
        postTransactionSchema.safeParse({
          kind,
          matterId,
          clientMatterPartyId,
          transactionDate: '2026-11-27',
          paymentMethod: 'CASH',
          totalAmountPiastres: '500000',
          allocations: [{ feeChargeId: chargeA, amountPiastres: '500000' }],
          idempotencyKey: `t13-bad-kind-${kind}`,
        }).success,
        kind
      ).toBe(false);
    }

    // Empty allocations rejected
    expect(
      postTransactionSchema.safeParse({
        kind: 'FEE_PAYMENT',
        matterId,
        clientMatterPartyId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '500000',
        allocations: [],
        idempotencyKey: 't13-empty-alloc',
      }).success
    ).toBe(false);

    // Unbalanced allocations (sum !== total) rejected
    expect(
      postTransactionSchema.safeParse({
        kind: 'FEE_PAYMENT',
        matterId,
        clientMatterPartyId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '500000',
        allocations: [{ feeChargeId: chargeA, amountPiastres: '400000' }],
        idempotencyKey: 't13-unbal-alloc',
      }).success
    ).toBe(false);

    // Duplicate feeChargeId rejected
    expect(
      postTransactionSchema.safeParse({
        kind: 'FEE_PAYMENT',
        matterId,
        clientMatterPartyId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '500000',
        allocations: [
          { feeChargeId: chargeA, amountPiastres: '250000' },
          { feeChargeId: chargeA, amountPiastres: '250000' },
        ],
        idempotencyKey: 't13-dup-charge',
      }).success
    ).toBe(false);

    // Explicit unbalanced or empty lines rejected
    expect(
      postTransactionSchema.safeParse({
        kind: 'FEE_PAYMENT',
        matterId,
        clientMatterPartyId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '500000',
        allocations: [{ feeChargeId: chargeA, amountPiastres: '500000' }],
        lines: [{ side: 'DEBIT', amountPiastres: '500000' }],
        idempotencyKey: 't13-single-line',
      }).success
    ).toBe(false);

    expect(
      postTransactionSchema.safeParse({
        kind: 'FEE_PAYMENT',
        matterId,
        clientMatterPartyId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '500000',
        allocations: [{ feeChargeId: chargeB, amountPiastres: '500000' }],
        lines: [
          { side: 'DEBIT', amountPiastres: '500000' },
          { side: 'CREDIT', amountPiastres: '400000' },
        ],
        idempotencyKey: 't13-unbal-lines',
      }).success
    ).toBe(false);

    // Empty statement scope rejected
    expect(getClientStatementSchema.safeParse({}).success).toBe(false);
    expect(getClientStatementSchema.safeParse({ matterId }).success).toBe(true);
  });

  it('maps PostgreSQL deadlock SQLSTATE 40P01 and lock contention to CONCURRENCY_CONFLICT (409)', () => {
    const rawPgDeadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    expect(financeError(rawPgDeadlock)).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });

    const prismaRawDeadlock = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
      code: 'P2010',
      clientVersion: '7.10.1',
      meta: {
        code: '40P01',
        driverAdapterError: { cause: { originalCode: '40P01' } },
      },
    });
    expect(financeError(prismaRawDeadlock)).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });

    const prismaWriteConflict = new Prisma.PrismaClientKnownRequestError('Transaction deadlock', {
      code: 'P2034',
      clientVersion: '7.10.1',
    });
    expect(financeError(prismaWriteConflict)).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });

    expect(statusFromFinanceErrorCode('CONCURRENCY_CONFLICT')).toBe(409);
  });

  it('enforces boundary limits for parsePositivePiastres, parseEgpToPiastres, and formatEgpPiastres', () => {
    expect(parsePositivePiastres(MAX_PIASTRE_AMOUNT)).toBe(MAX_PIASTRE_AMOUNT);
    expect(parsePositivePiastres(MAX_PIASTRE_AMOUNT.toString())).toBe(MAX_PIASTRE_AMOUNT);
    expect(parsePositivePiastres(Number.MAX_SAFE_INTEGER)).toBe(BigInt(Number.MAX_SAFE_INTEGER));

    // > MAX_PIASTRE_AMOUNT
    expect(() => parsePositivePiastres(MAX_PIASTRE_AMOUNT + 1n)).toThrow();
    expect(() => parsePositivePiastres((MAX_PIASTRE_AMOUNT + 1n).toString())).toThrow();
    // > 32 chars
    expect(() => parsePositivePiastres('1'.repeat(33))).toThrow();
    // Unsafe / non-finite numbers
    expect(() => parsePositivePiastres(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => parsePositivePiastres(Infinity)).toThrow();
    expect(() => parsePositivePiastres(-Infinity)).toThrow();
    expect(() => parsePositivePiastres(NaN)).toThrow();

    // parseEgpToPiastres boundaries
    expect(() => parseEgpToPiastres('0,500')).toThrow();
    expect(() => parseEgpToPiastres('1 5')).toThrow();
    expect(() => parseEgpToPiastres((MAX_PIASTRE_AMOUNT / 100n + 1n).toString())).toThrow();
    expect(() => parseEgpToPiastres('1'.repeat(33))).toThrow();

    // formatEgpPiastres edge values: 0n, negative, and numeric strings
    expect(formatEgpPiastres(0n)).toBe('0 ج.م.');
    expect(formatEgpPiastres(0n, { showZeroDecimals: true })).toBe('0.00 ج.م.');
    expect(formatEgpPiastres(-1500000n)).toBe('-15,000 ج.م.');
    expect(formatEgpPiastres('1500000')).toBe('15,000 ج.م.');
    expect(formatEgpPiastres('0')).toBe('0 ج.م.');
    expect(formatEgpPiastres('-250050')).toBe('-2,500.50 ج.م.');
  });

  it('maps 40001, 55P03, sqlState, deep cause chains, and all HTTP status codes accurately', () => {
    expect(financeError({ code: '40001' })).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });
    expect(financeError({ code: '55P03' })).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });
    expect(financeError({ sqlState: '40001' })).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });
    expect(financeError({ sqlState: '55P03' })).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });

    const deepCause = {
      cause: {
        cause: {
          cause: {
            cause: {
              driverAdapterError: { sqlState: '40P01' },
            },
          },
        },
      },
    };
    expect(financeError(deepCause)).toMatchObject({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
    });

    expect(statusFromFinanceErrorCode('VALIDATION_ERROR')).toBe(400);
    expect(statusFromFinanceErrorCode('UNSUPPORTED_TRANSACTION_KIND')).toBe(400);
    expect(statusFromFinanceErrorCode(undefined)).toBe(400);
    expect(statusFromFinanceErrorCode('UNAUTHENTICATED')).toBe(401);
    expect(statusFromFinanceErrorCode('MFA_REQUIRED')).toBe(401);
    expect(statusFromFinanceErrorCode('SESSION_EXPIRED')).toBe(401);
    expect(statusFromFinanceErrorCode('SESSION_INACTIVE')).toBe(401);
    expect(statusFromFinanceErrorCode('FORBIDDEN')).toBe(403);
    expect(statusFromFinanceErrorCode('CROSS_MATTER_LINK_FORBIDDEN')).toBe(403);
    expect(statusFromFinanceErrorCode('NOT_FOUND')).toBe(404);
    expect(statusFromFinanceErrorCode('CONCURRENCY_CONFLICT')).toBe(409);
    expect(statusFromFinanceErrorCode('IDEMPOTENCY_PAYLOAD_MISMATCH')).toBe(409);
    expect(statusFromFinanceErrorCode('IDEMPOTENCY_CONCURRENT_CONFLICT')).toBe(409);
    expect(statusFromFinanceErrorCode('IMMUTABLE_POSTED_RECORD')).toBe(409);
    expect(statusFromFinanceErrorCode('EXCESS_OVERPAYMENT')).toBe(409);
    expect(statusFromFinanceErrorCode('ALREADY_POSTED')).toBe(409);
    expect(statusFromFinanceErrorCode('MATTER_ARCHIVED')).toBe(409);
    expect(statusFromFinanceErrorCode('UNSUPPORTED_TRANSITION')).toBe(409);
    expect(statusFromFinanceErrorCode('DOCUMENT_NOT_READY')).toBe(409);
    expect(statusFromFinanceErrorCode('PAYLOAD_TOO_LARGE')).toBe(413);
    expect(statusFromFinanceErrorCode('INTERNAL_ERROR')).toBe(500);
  });

  it('rejects unknown/typoed keys via .strict() and maps them to Arabic messages via formatZodIssues', async () => {
    const owner = createSyntheticActor();
    const matterId = crypto.randomUUID();
    const clientMatterPartyId = crypto.randomUUID();
    const feeAgreementId = crypto.randomUUID();
    const feeChargeId = crypto.randomUUID();

    // 1. saveFeeAgreementDraftSchema: currency & documentId typo
    const draftUnknown = saveFeeAgreementDraftSchema.safeParse({
      matterId,
      clientMatterPartyId,
      description: 'اتفاق أتعاب',
      totalAmountPiastres: '150000',
      agreementDate: '2026-11-27',
      chargingMethod: 'FIXED',
      currency: 'USD',
      documentId: crypto.randomUUID(),
      idempotencyKey: 'strict-draft-1',
    });
    expect(draftUnknown.success).toBe(false);
    if (!draftUnknown.success) {
      expect(draftUnknown.error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    }

    let draftErr: unknown;
    try {
      await saveFeeAgreementDraft(owner, {
        matterId,
        clientMatterPartyId,
        description: 'اتفاق أتعاب',
        totalAmountPiastres: '150000',
        agreementDate: '2026-11-27',
        chargingMethod: 'FIXED',
        currency: 'USD',
        documentId: crypto.randomUUID(),
        idempotencyKey: 'strict-draft-svc-1',
      } as unknown as Parameters<typeof saveFeeAgreementDraft>[1]);
    } catch (e) {
      draftErr = e;
    }
    expect(draftErr).toBeInstanceOf(FinanceValidationError);
    const draftFieldErrors = (draftErr as FinanceValidationError).fieldErrors ?? {};
    expect(draftFieldErrors.currency).toBe('حقل غير معروف في الطلب: currency');
    expect(draftFieldErrors.documentId).toBe('حقل غير معروف في الطلب: documentId');

    // 2. approveFeeAgreementSchema: installment typo & nested currency on installment item
    const approveTypo = approveFeeAgreementSchema.safeParse({
      feeAgreementId,
      expectedVersion: 1,
      installment: [{ description: 'قسط', amountPiastres: '100000' }],
      idempotencyKey: 'strict-approve-1',
    });
    expect(approveTypo.success).toBe(false);

    let approveErr: unknown;
    try {
      await approveFeeAgreement(owner, {
        feeAgreementId,
        expectedVersion: 1,
        installment: [{ description: 'قسط', amountPiastres: '100000' }],
        idempotencyKey: 'strict-approve-svc-1',
      } as unknown as Parameters<typeof approveFeeAgreement>[1]);
    } catch (e) {
      approveErr = e;
    }
    expect(approveErr).toBeInstanceOf(FinanceValidationError);
    expect((approveErr as FinanceValidationError).fieldErrors?.installment).toBe(
      'حقل غير معروف في الطلب: installment'
    );

    expect(
      feeInstallmentInputSchema.safeParse({
        description: 'قسط',
        amountPiastres: '100000',
        currency: 'USD',
      }).success
    ).toBe(false);

    // 3. postTransactionSchema & nested allocation/line schemas: unknown keys rejected in Arabic
    let postErr: unknown;
    try {
      await postTransaction(owner, {
        kind: 'FEE_PAYMENT',
        matterId,
        clientMatterPartyId,
        transactionDate: '2026-11-27',
        paymentMethod: 'CASH',
        totalAmountPiastres: '100000',
        currency: 'USD',
        allocations: [{ feeChargeId, amountPiastres: '100000', extraAllocKey: true }],
        idempotencyKey: 'strict-post-svc-1',
      } as unknown as Parameters<typeof postTransaction>[1]);
    } catch (e) {
      postErr = e;
    }
    expect(postErr).toBeInstanceOf(FinanceValidationError);
    const postFieldErrors = (postErr as FinanceValidationError).fieldErrors ?? {};
    expect(postFieldErrors.currency).toBe('حقل غير معروف في الطلب: currency');
    expect(postFieldErrors['allocations.0.extraAllocKey']).toBe(
      'حقل غير معروف في الطلب: extraAllocKey'
    );

    expect(
      feeAllocationInputSchema.safeParse({
        feeChargeId,
        amountPiastres: '100000',
        currency: 'USD',
      }).success
    ).toBe(false);
    expect(
      explicitLedgerLineInputSchema.safeParse({
        side: 'DEBIT',
        amountPiastres: '100000',
        currency: 'USD',
      }).success
    ).toBe(false);

    // 4. getClientStatementSchema & listFinanceOverviewSchema: unknown keys rejected in Arabic
    let stmtErr: unknown;
    try {
      await getClientStatement(owner, {
        matterId,
        currency: 'USD',
      } as unknown as Parameters<typeof getClientStatement>[1]);
    } catch (e) {
      stmtErr = e;
    }
    expect(stmtErr).toBeInstanceOf(FinanceValidationError);
    expect((stmtErr as FinanceValidationError).fieldErrors?.currency).toBe(
      'حقل غير معروف في الطلب: currency'
    );

    let ovErr: unknown;
    try {
      await listFinanceOverview(owner, {
        unknownFilter: 'x',
      } as unknown as Parameters<typeof listFinanceOverview>[1]);
    } catch (e) {
      ovErr = e;
    }
    expect(ovErr).toBeInstanceOf(FinanceValidationError);
    expect((ovErr as FinanceValidationError).fieldErrors?.unknownFilter).toBe(
      'حقل غير معروف في الطلب: unknownFilter'
    );
    expect(listFinanceOverviewSchema.safeParse({ unknownFilter: 'x' }).success).toBe(false);
  });

  it('returns Arabic validation messages (never English "Invalid input") for missing or wrong-type base fields', async () => {
    const owner = createSyntheticActor();

    const assertArabicMessages = (messages: string[], context: string) => {
      expect(messages.length, context).toBeGreaterThan(0);
      for (const msg of messages) {
        expect(msg, `${context}: ${msg}`).not.toMatch(/Invalid input|Expected |Required/i);
        expect(msg, `${context}: ${msg}`).toMatch(/[\u0600-\u06FF]/);
      }
    };

    const schemaCases: Array<{
      name: string;
      result: { success: boolean; error?: { issues: Array<{ message: string }> } };
    }> = [
      {
        name: 'saveFeeAgreementDraftSchema missing/wrong-type',
        result: saveFeeAgreementDraftSchema.safeParse({
          matterId: 123,
          clientMatterPartyId: null,
          description: 99,
          totalAmountPiastres: { invalid: true },
          agreementDate: 20261127,
          chargingMethod: 'INVALID_METHOD',
          idempotencyKey: undefined,
        }),
      },
      {
        name: 'approveFeeAgreementSchema missing/wrong-type',
        result: approveFeeAgreementSchema.safeParse({
          feeAgreementId: 42,
          expectedVersion: '1',
          transactionDate: 12345,
          installments: 'not-an-array',
          idempotencyKey: null,
        }),
      },
      {
        name: 'postTransactionSchema missing/wrong-type',
        result: postTransactionSchema.safeParse({
          kind: 'FEE_PAYMENT',
          matterId: undefined,
          clientMatterPartyId: 100,
          payerPartyId: 200,
          transactionDate: null,
          paymentMethod: 55,
          totalAmountPiastres: true,
          reference: 123,
          description: ['bad'],
          allocations: 'bad',
          lines: 42,
          idempotencyKey: 1,
        }),
      },
      {
        name: 'getClientStatementSchema wrong-type',
        result: getClientStatementSchema.safeParse({
          matterId: 123,
          partyId: false,
          clientMatterPartyId: {},
        }),
      },
      {
        name: 'listFinanceOverviewSchema wrong-type',
        result: listFinanceOverviewSchema.safeParse({
          matterId: 123,
          q: 456,
          page: '1',
          limit: '20',
        }),
      },
    ];

    for (const c of schemaCases) {
      expect(c.result.success, c.name).toBe(false);
      assertArabicMessages(
        c.result.error!.issues.map((i) => i.message),
        c.name
      );
    }

    // Verify service boundary formatting via formatZodIssues as well
    const serviceCalls: Array<() => Promise<unknown>> = [
      () =>
        saveFeeAgreementDraft(
          owner,
          {
            matterId: 123,
            totalAmountPiastres: { bad: 1 },
            agreementDate: null,
            idempotencyKey: undefined,
          } as unknown as Parameters<typeof saveFeeAgreementDraft>[1]
        ),
      () =>
        approveFeeAgreement(
          owner,
          {
            feeAgreementId: null,
            expectedVersion: '1',
            idempotencyKey: 123,
          } as unknown as Parameters<typeof approveFeeAgreement>[1]
        ),
      () =>
        postTransaction(
          owner,
          {
            kind: 'FEE_PAYMENT',
            matterId: 123,
            totalAmountPiastres: false,
            transactionDate: 123,
            allocations: 'bad',
            idempotencyKey: undefined,
          } as unknown as Parameters<typeof postTransaction>[1]
        ),
      () =>
        getClientStatement(
          owner,
          { matterId: 123 } as unknown as Parameters<typeof getClientStatement>[1]
        ),
      () =>
        listFinanceOverview(
          owner,
          { page: 'abc', limit: false } as unknown as Parameters<typeof listFinanceOverview>[1]
        ),
    ];

    for (const fn of serviceCalls) {
      let caught: unknown;
      try {
        await fn();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(FinanceValidationError);
      const msgs = Object.values((caught as FinanceValidationError).fieldErrors ?? {});
      assertArabicMessages(msgs, 'service formatZodIssues');
    }
  });
});