import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { financeError } from '@/modules/finance/finance-errors';
import { statusFromFinanceErrorCode } from '@/modules/finance/finance-http';
import {
  approveFeeAgreementSchema,
  formatEgpPiastres,
  getClientStatementSchema,
  parseEgpToPiastres,
  parsePositivePiastres,
  piastresToEgpDecimalString,
  postTransactionSchema,
  saveFeeAgreementDraftSchema,
} from '@/modules/finance/finance-types';

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
});