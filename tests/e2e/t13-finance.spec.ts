import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { getPrismaClient } from '@/lib/auth';
import { closeDbPool } from '@/lib/db';
import { linkMatterParty, openMatter } from '@/modules/matters/matter-service';
import { createSyntheticActor } from '../helpers/party-test-helper';
import { createValidatedTestPool } from '../helpers/test-db';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';
import {
  currentTotp,
  deleteT04Owner,
  seedT04Owner,
  signInWithTotp,
  type T04Owner,
} from '../helpers/t04-auth';
import {
  expectNoPageOverflow,
  expectShellReady,
  expectTouchTarget,
  expectVisibleFocus,
  nextPaint,
  shellModeForViewport,
  tabToTestId,
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
    await cleanupMatterFixtures(prisma, matterIds);
  }
  if (partyIds.length > 0) {
    await cleanupPartyFixtures(prisma, partyIds);
  }
  for (const oid of ownerIds) {
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: oid } });
    await prisma.auditEvent.deleteMany({ where: { userId: oid } });
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

  test.afterEach(async () => {
    const matters = createdMatters.splice(0);
    const parties = createdParties.splice(0);
    const owners = createdOwners.splice(0);
    await cleanupFinanceTestFixtures(matters, parties, owners);
  });

  test.afterAll(async () => {
    await closeDbPool();
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

    // Filter to seeded matter and wait for overview GET + client balance row
    const filterRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/finance?matterId=${fixture.matterId}`) &&
        res.request().method() === 'GET' &&
        res.status() === 200
    );
    await page.getByTestId('finance-matter-filter').selectOption(fixture.matterId);
    await filterRespPromise;
    await expect(page.locator('[data-testid^="client-balance-row-"]').first()).toBeVisible();

    await expect(page.getByTestId('fees-due-value')).toContainText('0 ج.م.');
    await expect(page.getByTestId('finance-card-expenses')).toContainText('قيد التفعيل لاحقاً');
    await expect(page.getByTestId('finance-card-advances')).toContainText('قيد التفعيل لاحقاً');

    // 1. Save 15,000 EGP draft fee agreement -> confirm draft creates ZERO debt
    await page.getByTestId('toggle-draft-agreement-button').click();
    await page.getByTestId('draft-description-input').fill('أتعاب التقاضي شاملة الدرجات');
    await page.getByTestId('draft-total-egp-input').fill('15000');

    const afterDraftOverviewPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/finance?matterId=${fixture.matterId}`) &&
        res.request().method() === 'GET' &&
        res.status() === 200
    );
    await page.getByTestId('save-draft-agreement-button').click();
    await afterDraftOverviewPromise;

    await expect(page.getByTestId('finance-success-banner')).toContainText('مسودة');
    await expect(page.getByTestId('fees-due-value')).toContainText('0 ج.م.');
    await expect(page.getByTestId('fees-charged-value')).toContainText('0 ج.م.');

    const agreementCard = page.locator('[data-testid^="fee-agreement-card-"]').first();
    await expect(agreementCard).toBeVisible();
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
    expect(firstReceiptNumber).toMatch(/^RCP-\d{4}-\d{4,}$/);
    await expect(page.getByTestId('receipt-amount')).toContainText('5,000 ج.م.');
    await expect(page.getByTestId('receipt-remaining-after')).toContainText('10,000 ج.م.');
    await expect(page.getByTestId('receipt-administrative-notice')).toContainText(
      ADMINISTRATIVE_NOTICE_TEXT
    );

    await page.getByTestId('close-receipt-dialog-button').click();
    await expect(receiptDialog).toBeHidden();
    await expect(page.getByTestId('fees-collected-value')).toContainText('5,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('10,000 ج.م.');

    // Open detailed single-client statement BEFORE the next payment and verify auto-refresh after retry payment
    await page.getByRole('button', { name: /عرض الكشف المفصل/ }).first().click();
    const statementSummary = page.getByTestId('client-statement-summary');
    await expect(statementSummary).toBeVisible();
    await expect(statementSummary).toContainText('15,000 ج.م.');
    await expect(statementSummary).toContainText('5,000 ج.م.');
    await expect(statementSummary).toContainText('10,000 ج.م.');

    // 4. T13-TC-03: Simulate lost response after server commit -> retry with frozen idempotency key
    await page.getByTestId('pay-amount-egp-input').fill('1000');
    await page.getByTestId('allocation-amount-0').fill('1000');

    let intercepted = false;
    let committedNum = '';
    await page.route('**/api/finance/transactions', async (route) => {
      if (!intercepted && route.request().method() === 'POST') {
        intercepted = true;
        const response = await route.fetch();
        const json = (await response.json()) as { data?: { receipt?: { receiptNumber?: string } } };
        committedNum = json.data?.receipt?.receiptNumber ?? '';
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
    expect(committedNum).toMatch(/^RCP-\d{4}-\d{4,}$/);
    expect(retryReceiptNumber).toBe(committedNum);
    expect(retryReceiptNumber).not.toBe(firstReceiptNumber);
    await expect(page.getByTestId('receipt-remaining-after')).toContainText('9,000 ج.م.');
    await page.getByTestId('close-receipt-dialog-button').click();
    await expect(receiptDialog).toBeHidden();

    await expect(page.getByTestId('fees-collected-value')).toContainText('6,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('9,000 ج.م.');

    // Reprint first receipt -> scoped to the posted-tx-row containing firstReceiptNumber
    const firstTxRow = page.locator('[data-testid^="posted-tx-row-"]', {
      hasText: firstReceiptNumber,
    });
    await firstTxRow.locator('[data-testid^="reprint-receipt-button-"]').click();
    await expect(receiptDialog).toBeVisible();
    const reprintedNum = (await page.getByTestId('receipt-number').innerText()).trim();
    expect(reprintedNum).toBe(firstReceiptNumber);
    await expect(page.getByTestId('fees-due-value')).toContainText('9,000 ج.م.');
    await page.getByTestId('close-receipt-dialog-button').click();
    await expect(receiptDialog).toBeHidden();

    // Open client statement summary must have auto-refreshed to 6,000 / 9,000 without re-clicking
    await expect(statementSummary).toBeVisible();
    await expect(statementSummary).toContainText('مطابق حسابياً مع القيود المرحلة');
    await expect(statementSummary).toContainText('15,000 ج.م.');
    await expect(statementSummary).toContainText('6,000 ج.م.');
    await expect(statementSummary).toContainText('9,000 ج.م.');

    // Visiting /finance?matterId=<missing-uuid> and non-RFC4122 UUID must render clean 404 (not 500)
    const missingRes = await page.goto(`/finance?matterId=${randomUUID()}`);
    expect(missingRes?.status()).toBe(404);

    const nonRfcRes = await page.goto('/finance?matterId=11111111-1111-1111-1111-111111111111');
    expect(nonRfcRes?.status()).toBe(404);

    // Party profile finance link opens /finance cleanly
    await page.goto(`/parties/${fixture.partyId}`);
    const partyFinanceLink = page.getByTestId('party-finance-link');
    await expect(partyFinanceLink).toBeVisible();
    await partyFinanceLink.click();
    await expect(page).toHaveURL((u) => u.pathname === '/finance');
    await expect(page.getByTestId('finance-workspace')).toBeVisible();
  });

  test('T13-AUTH-REDIRECT: Unauthenticated /finance redirects to /login preserving returnTo and lands back on /finance @t13 @finance', async ({
    page,
  }) => {
    const owner = await seedT04Owner({ label: `t13-auth-${randomUUID().slice(0, 6)}` });
    createdOwners.push(owner.id);

    await page.goto('/finance');
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/finance');

    await page.locator('#email').fill(owner.email);
    await page.locator('#password').fill(owner.password);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/verify/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/finance');

    const code = await currentTotp(owner.totpSecret);
    await page.locator('#totpCode').fill(code);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL((u) => u.pathname === '/finance');
    await expectShellReady(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('الحسابات المالية');
  });

  test('T13-DRAFT-EDIT-AND-2CLIENT-EXCESS: Editing DRAFT agreement and 2-client excess warning preview against totalEligibleDue @t13 @finance', async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 6);
    const fixture = await seedOwnerAndMatter(suffix);
    const actor = createSyntheticActor({
      id: fixture.owner.id,
      name: fixture.owner.name,
      email: fixture.owner.email,
    });

    const secondParty = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `موكل ثاني ${suffix}`,
        nameNormalized: `موكل ثاني ${suffix}`,
        createdById: fixture.owner.id,
        updatedById: fixture.owner.id,
      },
    });
    createdParties.push(secondParty.id);

    const secondClientMp = await linkMatterParty(actor, {
      matterId: fixture.matterId,
      partyId: secondParty.id,
      role: 'CLIENT',
      billingEnabled: true,
      idempotencyKey: randomUUID(),
    });

    await signInWithTotp(page, fixture.owner);
    await expectShellReady(page);
    await page.goto('/finance');

    const filterRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/finance?matterId=${fixture.matterId}`) &&
        res.request().method() === 'GET' &&
        res.status() === 200
    );
    await page.getByTestId('finance-matter-filter').selectOption(fixture.matterId);
    await filterRespPromise;
    await expect(page.locator(`[data-testid="client-balance-row-${secondClientMp.id}"]`)).toBeVisible();

    // 1. Save initial DRAFT for Client 1 (10,000 EGP) -> test frozen draft reset-frozen-draft-button -> then save & edit DRAFT to 15,000 EGP
    await page.getByTestId('toggle-draft-agreement-button').click();
    await page.getByTestId('draft-description-input').fill('مسودة أولية قبل التعديل');
    await page.getByTestId('draft-total-egp-input').fill('10000');

    let abortedDraftOnce = false;
    await page.route('**/api/finance/agreements', async (route) => {
      if (!abortedDraftOnce && route.request().method() === 'POST') {
        abortedDraftOnce = true;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.getByTestId('save-draft-agreement-button').click();
    await expect(page.getByTestId('frozen-draft-banner')).toBeVisible();
    await expect(page.getByTestId('retry-draft-button')).toBeVisible();
    await expect(page.getByTestId('draft-description-input')).toBeDisabled();
    await page.unroute('**/api/finance/agreements');

    await page.getByTestId('reset-frozen-draft-button').click();
    await expect(page.getByTestId('frozen-draft-banner')).toBeHidden();
    await expect(page.getByTestId('draft-description-input')).toBeEnabled();

    const afterCreatePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/finance?matterId=${fixture.matterId}`) &&
        res.request().method() === 'GET' &&
        res.status() === 200
    );
    await page.getByTestId('save-draft-agreement-button').click();
    await afterCreatePromise;

    const draftCard = page.locator('[data-testid^="fee-agreement-card-"]').first();
    const ag1Id = (await draftCard.getAttribute('data-testid'))!.replace('fee-agreement-card-', '');
    await expect(draftCard).toContainText('10,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('0 ج.م.');

    await page.getByTestId(`edit-draft-agreement-${ag1Id}`).click();
    await page.getByTestId('draft-description-input').fill('أتعاب معدلة قبل الاعتماد');
    await page.getByTestId('draft-total-egp-input').fill('15000');

    const afterEditPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/finance?matterId=${fixture.matterId}`) &&
        res.request().method() === 'GET' &&
        res.status() === 200
    );
    await page.getByTestId('save-draft-agreement-button').click();
    await afterEditPromise;

    await expect(page.getByTestId(`fee-agreement-card-${ag1Id}`)).toContainText('أتعاب معدلة قبل الاعتماد');
    await expect(page.getByTestId(`fee-agreement-card-${ag1Id}`)).toContainText('15,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('0 ج.م.');

    // Approve Client 1 agreement (15,000 EGP) with simulated lost response -> retry-approve-button idempotently
    await page.getByTestId(`open-approve-agreement-${ag1Id}`).click();
    let interceptedApprove = false;
    await page.route(`**/api/finance/agreements/${ag1Id}/approve`, async (route) => {
      if (!interceptedApprove && route.request().method() === 'POST') {
        interceptedApprove = true;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.getByTestId(`confirm-approve-agreement-${ag1Id}`).click();
    await expect(page.getByTestId('frozen-approve-banner')).toBeVisible();
    await expect(page.getByTestId('retry-approve-button')).toBeVisible();
    await page.unroute(`**/api/finance/agreements/${ag1Id}/approve`);
    await page.getByTestId('retry-approve-button').click();
    await expect(page.getByTestId(`agreement-status-${ag1Id}`)).toContainText('معتمد');
    await expect(page.getByTestId('fees-due-value')).toContainText('15,000 ج.م.');

    // 2. Create & approve smaller agreement for Client 2 (3,000 EGP) -> matter due = 18,000 EGP
    await page.getByTestId('toggle-draft-agreement-button').click();
    await page.getByTestId('draft-client-select').selectOption(secondClientMp.id);
    await page.getByTestId('draft-description-input').fill('اتفاق الموكل الثاني');
    await page.getByTestId('draft-total-egp-input').fill('3000');

    const afterDraft2Promise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/finance?matterId=${fixture.matterId}`) &&
        res.request().method() === 'GET' &&
        res.status() === 200
    );
    await page.getByTestId('save-draft-agreement-button').click();
    await afterDraft2Promise;

    const ag2Card = page.locator('[data-testid^="fee-agreement-card-"]', {
      hasText: 'اتفاق الموكل الثاني',
    });
    const ag2Id = (await ag2Card.getAttribute('data-testid'))!.replace('fee-agreement-card-', '');
    await page.getByTestId(`open-approve-agreement-${ag2Id}`).click();
    await page.getByTestId('installment-amount-0').fill('1500');
    await page.getByTestId('add-installment-row-button').click();
    await page.getByTestId('installment-desc-1').fill('قسط ثاني للموكل الثاني');
    await page.getByTestId('installment-amount-1').fill('1500');
    await page.getByTestId(`confirm-approve-agreement-${ag2Id}`).click();
    await expect(page.getByTestId('fees-due-value')).toContainText('18,000 ج.م.');

    // 3. Select Client 2 for payment and enter 5,000 EGP (> Client 2's 3,000 EGP due, < 18,000 matter total)
    await page.getByTestId('pay-client-select').selectOption(secondClientMp.id);
    await page.getByTestId('pay-amount-egp-input').fill('5000');

    const preview = page.getByTestId('finance-presave-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('يتجاوز إجمالي الأتعاب المستحقة على الموكل المحدد');
    await expect(preview).toContainText('3,000 ج.م.');
    await expect(preview).toContainText('ولن يتم ترحيله كدفعة مقدمة تلقائياً');

    // Submitting is rejected client-side without touching balances
    await page.getByTestId('submit-payment-button').click();
    await expect(page.getByTestId('finance-error-banner')).toBeVisible();
    await expect(page.getByTestId('fees-due-value')).toContainText('18,000 ج.م.');
  });

  test('T13-TC-06: MAINTAINER is excluded from navigation (desktop sidebar & tablet-drawer) and denied 403 on /finance and /api/finance @t13 @finance @responsive', async ({
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

    const mode = shellModeForViewport(page.viewportSize()!.width);
    if (mode === 'desktop') {
      await expect(page.getByTestId('desktop-sidebar').getByTestId('nav-link-finance')).toHaveCount(0);
    } else {
      if (mode === 'mobile') {
        const mobileNav = page.getByTestId('mobile-bottom-nav');
        await expect(mobileNav).toBeVisible();
        await expect(mobileNav.getByTestId('nav-link-finance')).toHaveCount(0);
      }
      await page.getByTestId('drawer-toggle-button').click();
      const drawer = page.getByTestId('tablet-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('nav-link-finance')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }

    await page.goto('/finance');
    await expect(page.getByTestId('finance-forbidden')).toBeVisible();
    await expectNoPageOverflow(page);

    const apiRes = await page.request.get('/api/finance');
    expect(apiRes.status()).toBe(403);
  });

  test('T13-TC-07: Matter Finance tab, 390/768/1440px responsive reflow, print media CSS, 200% zoom, keyboard Escape, and storage privacy @t13 @finance @responsive @a11y', async ({
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
    const firstReceiptNumber = (await page.getByTestId('receipt-number').innerText()).trim();
    expect(firstReceiptNumber).toMatch(/^RCP-\d{4}-\d{4,}$/);
    await expect(page.getByTestId('fees-due-value')).toContainText('10,000 ج.م.');

    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`t13-${testInfo.project.name}-receipt.png`, {
      body: shot,
      contentType: 'image/png',
    });

    // Verify print media CSS while receipt modal is open, then restore screen media
    try {
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('#app-shell-content')).toBeHidden();
      await expect(receiptDialog).toBeVisible();
      await expect(page.getByTestId('print-receipt-button')).toBeHidden();
    } finally {
      await page.emulateMedia({ media: 'screen' });
    }

    // Keyboard Tab traversal inside receipt modal + visible focus, then Escape dismisses & restores focus
    expect(await tabToTestId(page, 'print-receipt-button', 6)).toBe(true);
    await expectVisibleFocus(page, page.getByTestId('print-receipt-button'));
    await page.keyboard.press('Escape');
    await expect(receiptDialog).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement !== null &&
            document.activeElement !== document.body &&
            document.activeElement !== document.documentElement
        )
      )
      .toBe(true);

    // Load detailed single-client statement across all 3 viewports without horizontal overflow
    await page.getByRole('button', { name: /عرض الكشف المفصل/ }).first().click();
    const statementSummary = page.getByTestId('client-statement-summary');
    await expect(statementSummary).toBeVisible();
    await expect(statementSummary).toContainText('مطابق حسابياً مع القيود المرحلة');
    await expect(statementSummary).toContainText('15,000 ج.م.');
    await expect(statementSummary).toContainText('5,000 ج.م.');
    await expect(statementSummary).toContainText('10,000 ج.م.');
    await expectNoPageOverflow(page);

    // Reprint receipt across all 3 viewports: identical number, remaining balance unchanged
    const firstTxRow = page.locator('[data-testid^="posted-tx-row-"]', {
      hasText: firstReceiptNumber,
    });
    await firstTxRow.locator('[data-testid^="reprint-receipt-button-"]').click();
    await expect(receiptDialog).toBeVisible();
    expect((await page.getByTestId('receipt-number').innerText()).trim()).toBe(firstReceiptNumber);
    await expect(page.getByTestId('receipt-remaining-after')).toContainText('10,000 ج.م.');
    await expect(page.getByTestId('fees-collected-value')).toContainText('5,000 ج.م.');
    await expect(page.getByTestId('fees-due-value')).toContainText('10,000 ج.م.');
    await page.getByTestId('close-receipt-dialog-button').click();
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
