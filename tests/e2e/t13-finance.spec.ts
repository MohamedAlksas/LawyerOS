import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { getPrismaClient } from '@/lib/auth';
import { openMatter } from '@/modules/matters/matter-service';
import { createSyntheticActor } from '../helpers/party-test-helper';
import { createValidatedTestPool } from '../helpers/test-db';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';
import {
  deleteT04Owner,
  seedT04Owner,
  signInWithTotp,
  type T04Owner,
} from '../helpers/t04-auth';
import {
  expectNoPageOverflow,
  expectShellReady,
  expectTouchTarget,
  nextPaint,
} from '../helpers/t04-layout';
import {
  expectNoSensitiveValues,
  sensitiveNeedles,
  snapshotStorage,
} from '../helpers/t04-storage';
import { ADMINISTRATIVE_NOTICE_TEXT } from '../helpers/t13-ui-constants';

const prisma = getPrismaClient();

async function cleanupFinanceTestFixtures(matterIds: string[], partyIds: string[], ownerIds: string[]) {
  if (matterIds.length > 0) {
    const { pool } = createValidatedTestPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE public."receipt" DISABLE TRIGGER trg_receipt_immutable');
      await client.query('ALTER TABLE public."money_allocation" DISABLE TRIGGER trg_money_allocation_immutable');
      await client.query('ALTER TABLE public."fee_charge" DISABLE TRIGGER trg_fee_charge_immutable');
      await client.query('ALTER TABLE public."money_line" DISABLE TRIGGER trg_money_line_immutable');
      await client.query('ALTER TABLE public."fee_agreement" DISABLE TRIGGER trg_fee_agreement_approved_immutable');
      await client.query('ALTER TABLE public."money_transaction" DISABLE TRIGGER trg_money_transaction_immutable');
      await client.query('ALTER TABLE public."money_line" DISABLE TRIGGER trg_money_line_balanced');
      await client.query('ALTER TABLE public."money_transaction" DISABLE TRIGGER trg_money_transaction_balanced');

      await client.query(
        `DELETE FROM public."receipt" WHERE transaction_id IN (SELECT id FROM public."money_transaction" WHERE matter_id = ANY($1::text[]))`,
        [matterIds]
      );
      await client.query(
        `DELETE FROM public."money_allocation" WHERE settlement_line_id IN (SELECT id FROM public."money_line" WHERE matter_id = ANY($1::text[]) OR transaction_id IN (SELECT id FROM public."money_transaction" WHERE matter_id = ANY($1::text[]))) OR receivable_line_id IN (SELECT id FROM public."money_line" WHERE matter_id = ANY($1::text[]))`,
        [matterIds]
      );
      await client.query(`DELETE FROM public."fee_charge" WHERE matter_id = ANY($1::text[])`, [matterIds]);
      await client.query(`DELETE FROM public."fee_agreement" WHERE matter_id = ANY($1::text[])`, [matterIds]);
      await client.query(
        `DELETE FROM public."money_line" WHERE matter_id = ANY($1::text[]) OR transaction_id IN (SELECT id FROM public."money_transaction" WHERE matter_id = ANY($1::text[]))`,
        [matterIds]
      );
      await client.query(`DELETE FROM public."money_transaction" WHERE matter_id = ANY($1::text[])`, [matterIds]);
      await client.query(`DELETE FROM public."money_account" WHERE matter_id = ANY($1::text[])`, [matterIds]);

      await client.query('ALTER TABLE public."money_transaction" ENABLE TRIGGER trg_money_transaction_balanced');
      await client.query('ALTER TABLE public."money_line" ENABLE TRIGGER trg_money_line_balanced');
      await client.query('ALTER TABLE public."money_transaction" ENABLE TRIGGER trg_money_transaction_immutable');
      await client.query('ALTER TABLE public."fee_agreement" ENABLE TRIGGER trg_fee_agreement_approved_immutable');
      await client.query('ALTER TABLE public."money_line" ENABLE TRIGGER trg_money_line_immutable');
      await client.query('ALTER TABLE public."fee_charge" ENABLE TRIGGER trg_fee_charge_immutable');
      await client.query('ALTER TABLE public."money_allocation" ENABLE TRIGGER trg_money_allocation_immutable');
      await client.query('ALTER TABLE public."receipt" ENABLE TRIGGER trg_receipt_immutable');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
      await pool.end();
    }
  }

  if (matterIds.length > 0) {
    await cleanupMatterFixtures(prisma, matterIds);
  }
  if (partyIds.length > 0) {
    await cleanupPartyFixtures(prisma, partyIds);
  }
  for (const oid of ownerIds) {
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: oid } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { userId: oid } }).catch(() => {});
    await deleteT04Owner(oid);
  }
}

test.describe('T13 E2E: Fee Agreements, Balanced Collections, Receipts & Arabic RTL', () => {
  const createdOwners: string[] = [];
  const createdMatters: string[] = [];
  const createdParties: string[] = [];

  test.beforeAll(() => {
    setupTestEncryptionKeys();
  });

  test.afterAll(async () => {
    await cleanupFinanceTestFixtures(createdMatters, createdParties, createdOwners);
  });

  async function seedOwnerAndMatter(suffix: string): Promise<{
    owner: T04Owner;
    partyId: string;
    matterId: string;
    matterFileCode: string;
    clientName: string;
  }> {
    const owner = await seedT04Owner({ label: `t13-${suffix}` });
    createdOwners.push(owner.id);
    const actor = createSyntheticActor({ id: owner.id, name: owner.name, email: owner.email });

    const clientName = `موكل حسابات ${suffix}`;
    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: clientName,
        nameNormalized: clientName,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdParties.push(party.id);

    const opened = await openMatter(actor, {
      title: `قضية أتعاب وتحصيل ${suffix}`,
      kind: 'LITIGATION',
      initialClientId: party.id,
      idempotencyKey: randomUUID(),
    });
    createdMatters.push(opened.matter.id);

    return {
      owner,
      partyId: party.id,
      matterId: opened.matter.id,
      matterFileCode: opened.matter.fileCode,
      clientName,
    };
  }

  test('T13-TC-01, T13-TC-02 & T13-TC-03: 15,000 draft -> approve (6k+9k) -> 5,000 collection -> 10,000 due -> retry & reprint @t13 @finance', async ({
    page,
  }) => {
    const fixture = await seedOwnerAndMatter(randomUUID().slice(0, 6));
    await signInWithTotp(page, fixture.owner);
    await expectShellReady(page);

    // Navigate via sidebar link to /finance
    await page.getByTestId('nav-link-finance').click();
    await expect(page).toHaveURL((u) => u.pathname === '/finance');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('الحسابات المالية');

    // Filter to seeded matter so totals start cleanly at 0
    await page.getByTestId('finance-matter-filter').selectOption(fixture.matterId);
    await expect(page.getByTestId('fees-due-value')).toContainText('0 ج.م.');
    await expect(page.getByTestId('finance-card-expenses')).toContainText('T14');
    await expect(page.getByTestId('finance-card-advances')).toContainText('T14');

    // 1. Save 15,000 EGP draft fee agreement -> confirm draft creates ZERO debt
    await page.getByTestId('toggle-draft-agreement-button').click();
    await page.getByTestId('draft-description-input').fill('أتعاب التقاضي شاملة الدرجات');
    await page.getByTestId('draft-total-egp-input').fill('15000');
    await page.getByTestId('save-draft-agreement-button').click();

    await expect(page.getByTestId('finance-success-banner')).toContainText('مسودة');
    await expect(page.getByTestId('fees-due-value')).toContainText('0 ج.م.');
    await expect(page.getByTestId('fees-charged-value')).toContainText('0 ج.م.');

    const agreementCard = page.locator('[data-testid^="fee-agreement-card-"]').first();
    const agIdAttr = await agreementCard.getAttribute('data-testid');
    const agId = agIdAttr!.replace('fee-agreement-card-', '');

    // 2. Approve as 2 installments (6,000 + 9,000 = 15,000)
    await page.getByTestId(`open-approve-agreement-${agId}`).click();
    await page.getByTestId('installment-amount-0').fill('6000');
    await page.getByTestId('add-installment-row-button').click();
    await page.getByTestId('installment-desc-1').fill('الدفعة الثانية');
    await page.getByTestId('installment-amount-1').fill('9000');
    await page.getByTestId(`confirm-approve-agreement-${agId}`).click();

    await expect(page.getByTestId(`agreement-status-${agId}`)).toContainText('معتمد');
    await expect(page.getByTestId('fees-charged-value')).toContainText('15,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('15,000 ج.م.');

    // 3. Collect 5,000 EGP toward installment #1 -> inspect preview -> verify 10,000 due & receipt
    await page.getByTestId('pay-amount-egp-input').fill('5000');
    await page.getByTestId('allocation-amount-0').fill('5000');
    await expect(page.getByTestId('finance-presave-preview')).toContainText('5,000 ج.م.');
    await expect(page.getByTestId('finance-presave-preview')).toContainText('10,000 ج.م.');

    await page.getByTestId('submit-payment-button').click();
    const receiptDialog = page.getByTestId('finance-receipt-dialog');
    await expect(receiptDialog).toBeVisible();
    const firstReceiptNumber = (await page.getByTestId('receipt-number').innerText()).trim();
    expect(firstReceiptNumber).toMatch(/^RCP-\d{4}-\d{4}$/);
    await expect(page.getByTestId('receipt-amount')).toContainText('5,000 ج.م.');
    await expect(page.getByTestId('receipt-remaining-after')).toContainText('10,000 ج.م.');
    await expect(page.getByTestId('receipt-administrative-notice')).toContainText(
      ADMINISTRATIVE_NOTICE_TEXT
    );

    await page.getByTestId('close-receipt-dialog-button').click();
    await expect(receiptDialog).toBeHidden();
    await expect(page.getByTestId('fees-collected-value')).toContainText('5,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('10,000 ج.م.');

    // 4. T13-TC-03: Simulate lost response after server commit -> retry with frozen idempotency key
    await page.getByTestId('pay-amount-egp-input').fill('1000');
    await page.getByTestId('allocation-amount-0').fill('1000');

    let intercepted = false;
    await page.route('**/api/finance/transactions', async (route) => {
      if (!intercepted && route.request().method() === 'POST') {
        intercepted = true;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.getByTestId('submit-payment-button').click();
    await expect(page.getByTestId('retry-payment-button')).toBeVisible();
    await page.unroute('**/api/finance/transactions');

    await page.getByTestId('retry-payment-button').click();
    await expect(receiptDialog).toBeVisible();
    const retryReceiptNumber = (await page.getByTestId('receipt-number').innerText()).trim();
    expect(retryReceiptNumber).not.toBe(firstReceiptNumber);
    await expect(page.getByTestId('receipt-remaining-after')).toContainText('9,000 ج.م.');
    await page.getByTestId('close-receipt-dialog-button').click();

    await expect(page.getByTestId('fees-collected-value')).toContainText('6,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('9,000 ج.م.');

    // Reprint first receipt -> must keep exact original receiptNumber without creating any payment
    const reprintBtn = page.locator('[data-testid^="reprint-receipt-button-"]').last();
    await reprintBtn.click();
    await expect(receiptDialog).toBeVisible();
    const reprintedNum = (await page.getByTestId('receipt-number').innerText()).trim();
    expect(reprintedNum).toBe(firstReceiptNumber);
    await expect(page.getByTestId('fees-due-value')).toContainText('9,000 ج.م.');
  });

  test('T13-TC-06: MAINTAINER is excluded from navigation and denied 403 on /finance and /api/finance @t13 @finance', async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const maintainerId = randomUUID();
    const maintainerEmail = `t13.maint.${suffix}@office.test`;
    const maintainerPass = `MntT13!${suffix}99`;
    createdOwners.push(maintainerId);

    const hashed = await hashPassword(maintainerPass);
    const { pool } = createValidatedTestPool();
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, false, NOW(), NOW())',
        [maintainerId, 'مسؤول الصيانة T13', maintainerEmail, 'MAINTAINER']
      );
      await client.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [randomUUID(), maintainerId, 'credential', maintainerId, hashed]
      );
    } finally {
      client.release();
      await pool.end();
    }

    await page.goto('/login');
    await page.locator('#email').fill(maintainerEmail);
    await page.locator('#password').fill(maintainerPass);
    await page.locator('button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/login(?:[/?]|$)/);
    await expectShellReady(page);

    await expect(page.getByTestId('nav-link-finance')).toHaveCount(0);

    await page.goto('/finance');
    await expect(page.getByTestId('finance-forbidden')).toBeVisible();

    const apiRes = await page.request.get('/api/finance');
    expect(apiRes.status()).toBe(403);
  });

  test('T13-TC-07: Matter Finance tab, 390/768/1440px responsive reflow, 200% zoom, keyboard Escape, and storage privacy @t13 @finance @responsive @a11y', async ({
    page,
  }, testInfo) => {
    const fixture = await seedOwnerAndMatter(randomUUID().slice(0, 6));
    await signInWithTotp(page, fixture.owner);
    await expectShellReady(page);

    await page.goto(`/matters/${fixture.matterId}`);
    await page.getByTestId('tab-finance').click();
    await expect(page.getByTestId('finance-workspace')).toBeVisible();

    await expectNoPageOverflow(page);
    await expectTouchTarget(page.getByTestId('toggle-draft-agreement-button'));

    await page.getByTestId('toggle-draft-agreement-button').click();
    await page.getByTestId('draft-description-input').fill('أتعاب ملف متجاوب');
    await page.getByTestId('draft-total-egp-input').fill('١٥٠٠٠'); // Arabic-Indic digits
    await page.getByTestId('save-draft-agreement-button').click();
    await expect(page.getByTestId('finance-success-banner')).toBeVisible();

    const agCard = page.locator('[data-testid^="fee-agreement-card-"]').first();
    const agId = (await agCard.getAttribute('data-testid'))!.replace('fee-agreement-card-', '');
    await page.getByTestId(`open-approve-agreement-${agId}`).click();
    await page.getByTestId(`confirm-approve-agreement-${agId}`).click();
    await expect(page.getByTestId('fees-due-value')).toContainText('15,000 ج.م.');

    await page.getByTestId('pay-amount-egp-input').fill('٥٠٠٠');
    await page.getByTestId('submit-payment-button').click();
    const receiptDialog = page.getByTestId('finance-receipt-dialog');
    await expect(receiptDialog).toBeVisible();
    await expect(page.getByTestId('fees-due-value')).toContainText('10,000 ج.م.');

    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`t13-${testInfo.project.name}-receipt.png`, {
      body: shot,
      contentType: 'image/png',
    });

    // Keyboard Escape closes receipt modal
    await page.keyboard.press('Escape');
    await expect(receiptDialog).toBeHidden();

    // 200% text scaling reflow check
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await nextPaint(page);
    await expectNoPageOverflow(page);

    // Client storage privacy audit: zero confidential leakage
    const storageDump = await snapshotStorage(page);
    const rawCookies = await page.context().cookies();
    expectNoSensitiveValues(storageDump, [
      ...sensitiveNeedles(fixture.owner, rawCookies),
      { label: 'client name', value: fixture.clientName },
    ]);
  });
});
