import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, T04Owner } from '../helpers/t04-auth';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';

function formatOffsetYmd(daysFromNow: number, base: Date = new Date()): string {
  return new Date(base.getTime() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test.describe('T05 Parties & Client Profiles Browser Journeys', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const createdPartyIds: string[] = [];

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: 'parties-e2e', name: 'أحمد المحامي الشريك' });
    await prisma.party.deleteMany({
      where: {
        primaryPhone: { in: ['01012345678', '01022223333', '01033334444', '01055556666'] },
      },
    });
  });

  test.afterAll(async () => {
    if (createdPartyIds.length > 0) {
      await cleanupPartyFixtures(prisma, createdPartyIds);
    }
    if (owner?.id) {
      await deleteT04Owner(owner.id);
    }
  });

  test('guards unsaved Party edits through sidebar and account navigation and restores on Back @desktop', async ({ page }) => {
    await signInWithTotp(page, owner);
    await page.goto('/parties');
    await page.getByTestId('add-party-button').click();
    const name = page.getByTestId('party-name-input');
    await name.fill('مسودة غير محفوظة');
    for (const link of [
      page.getByTestId('nav-link-search').filter({ visible: true }).first(),
      page.getByTestId('user-identity-badge'),
    ]) {
      const confirmation = page.waitForEvent('dialog').then(async (dialog) => {
        expect(dialog.message()).toContain('تغييرات غير محفوظة');
        await dialog.dismiss();
      });
      await link.click();
      await confirmation;
      await expect(name).toHaveValue('مسودة غير محفوظة');
    }
    await page.goBack();
    await expect(page).toHaveURL(/\/parties$/);
    await page.getByTestId('add-party-button').click();
    await expect(name).toHaveValue('مسودة غير محفوظة');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('cancel-party-button').click();
    await page.getByTestId('add-party-button').click();
    await expect(name).toHaveValue('');
  });

  test('full operational party lifecycle journey @parties', async ({ page }) => {
    test.setTimeout(120_000);
    // 1. Authenticate with real TOTP
    await signInWithTotp(page, owner);

    // 2. Visit Parties Directory (/parties)
    await page.goto('/parties');
    await expect(page).toHaveURL(/\/parties/);
    await expect(page.locator('h1')).toContainText('دليل الأطراف والموكلين');

    // 3. Navigate to /parties/new via CTA
    const addPartyBtn = page.getByTestId('add-party-button');
    await expect(addPartyBtn).toBeVisible();
    await addPartyBtn.click();
    await expect(page).toHaveURL(/\/parties\/new/);
    await expect(page.locator('h1')).toContainText('إضافة طرف أو موكل جديد');

    // 4. Fill Party Creation Form (PERSON with synthetic identity)
    await page.getByTestId('kind-person').click();
    const testPartyName = 'محمود عبد العزيز الشربيني';
    const testPhone = '01012345678';
    await page.getByTestId('party-name-input').fill(testPartyName);
    await page.getByTestId('party-phone-input').fill(testPhone);
    await page.getByTestId('party-email-input').fill('mahmoud@client.test');
    await page.getByTestId('party-address-input').fill('15 شارع قصر النيل، وسط البلد، القاهرة');

    // Toggle optional identity fields
    await page.getByTestId('toggle-identity-fields').click();
    await page.getByTestId('identity-type-select').selectOption('NATIONAL_ID');
    const syntheticIdNumber = '29001011234567';
    await page.getByTestId('identity-number-input').fill(syntheticIdNumber);

    let firstSave: unknown;
    let retriedSave: unknown;
    await page.route('**/parties/new', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const args = request.postDataJSON() as unknown[];
        if (args[0] && typeof args[0] === 'object' && 'idempotencyKey' in args[0]) {
          if (!firstSave) {
            firstSave = args;
            await route.fetch();
            await route.abort('failed');
            return;
          }
          retriedSave = args;
        }
      }
      await route.continue();
    });
    await page.getByTestId('submit-party-button').click();
    await expect(page.getByTestId('party-name-input')).toBeDisabled();
    await expect(page.getByTestId('submit-party-button')).toBeEnabled();
    await page.getByTestId('submit-party-button').click();

    // 5. Land on Party Profile (/parties/[id])
    await expect(page).toHaveURL(/\/parties\/[a-f0-9-]+$/);
    expect(firstSave).toBeDefined();
    expect(retriedSave).toEqual(firstSave);
    await page.unroute('**/parties/new');
    const partyUrl = page.url();
    const partyId = partyUrl.split('/').pop()!;
    createdPartyIds.push(partyId);

    // Verify Party Summary Card
    await expect(page.getByTestId('party-summary-card')).toBeVisible();
    await expect(page.locator('h1')).toContainText(testPartyName);
    await expect(page.getByTestId('party-summary-card')).toContainText(testPhone);
    await expect(page.getByTestId('party-summary-card')).toContainText('4567');

    // 6. Reveal Identity Mask Test (R05-07)
    const revealBtn = page.getByTestId('reveal-identity-button');
    await expect(revealBtn).toBeVisible();
    await revealBtn.click();

    // Full decrypted number appears
    const revealedEl = page.getByTestId('revealed-identity-number');
    await expect(revealedEl).toBeVisible();
    await expect(revealedEl).toHaveText(syntheticIdNumber);
    await expect(page.getByTestId('reveal-audit-notice')).toBeVisible();

    // Hide identity again
    await page.getByTestId('hide-identity-button').click();
    await expect(revealedEl).toBeHidden();

    // 7. Add Communication Note (R05-09)
    await page.getByTestId('add-note-button').click();
    await page.getByTestId('note-channel-select').selectOption('PHONE');
    const noteSummaryText = 'تم التواصل مع الموكل لمناقشة طلبات صحيفة الدعوى وموعد جلسة الخبراء';
    await page.getByTestId('note-summary-input').fill(noteSummaryText);
    await page.getByTestId('note-follow-up-checkbox').check();
    await page.getByTestId('note-follow-up-date-input').fill(formatOffsetYmd(5));
    let firstNote: unknown;
    let retriedNote: unknown;
    await page.route(`**/parties/${partyId}`, async (route) => {
      if (route.request().method() === 'POST') {
        const args = route.request().postDataJSON();
        if (!firstNote) {
          firstNote = args;
          await route.fetch();
          await route.abort('failed');
          return;
        }
        retriedNote = args;
      }
      await route.continue();
    });
    await page.getByTestId('save-note-button').click();
    await expect(page.getByTestId('note-form-error')).toBeVisible();
    await expect(page.getByTestId('add-note-button')).toBeDisabled();
    await expect(page.getByTestId('note-summary-input')).toBeDisabled();
    await page.getByTestId('save-note-button').click();

    // Verify Note in timeline
    const noteItem = page.getByTestId('communication-note-item').first();
    await expect(noteItem).toBeVisible();
    await expect(noteItem).toContainText(noteSummaryText);
    await expect(noteItem.getByTestId('note-cairo-timestamp')).toBeVisible();
    expect(firstNote).toBeDefined();
    expect(retriedNote).toEqual(firstNote);
    expect(await prisma.communicationNote.count({ where: { partyId, summary: noteSummaryText } })).toBe(1);
    await page.unroute(`**/parties/${partyId}`);

    // 8. Add Power of Attorney (R05-09)
    await page.getByTestId('add-poa-button').click();
    await page.getByTestId('poa-number-input').fill('0045');
    await page.getByTestId('poa-year-input').fill('2026');
    await page.getByTestId('poa-office-input').fill('مكتب توثيق الأهرام النموذجي');
    await page.getByTestId('poa-type-select').selectOption('LITIGATION');
    await page.getByTestId('poa-status-select').selectOption('VALID');
    await page.getByTestId('poa-notes-input').fill('شامل المرافعة أمام محاكم الاستئناف');
    await page.goBack();
    await expect(page).toHaveURL(/\/parties\/new$/);
    await page.goForward();
    await expect(page).toHaveURL(partyUrl);
    await expect(page.getByTestId('poa-number-input')).toHaveValue('0045');
    await expect(page.getByTestId('poa-notes-input')).toHaveValue('شامل المرافعة أمام محاكم الاستئناف');

    await page.route(partyUrl, async (route) => {
      if (route.request().method() === 'POST' && route.request().postData()?.includes('0045')) {
        await page.request.fetch(route.request());
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByTestId('save-poa-button').click();
    await expect(page.getByTestId('poa-form-error')).toBeVisible();
    await page.unroute(partyUrl);
    const committedPoa = await prisma.powerOfAttorney.findFirstOrThrow({ where: { partyId } });
    const originalClaim = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { actorId: owner.id, commandType: 'savePowerOfAttorney', resultId: committedPoa.id },
    });

    await page.goBack();
    await expect(page).toHaveURL(/\/parties\/new$/);
    await page.goForward();
    await expect(page).toHaveURL(partyUrl);
    await expect(page.getByTestId('poa-number-input')).toHaveValue('0045');
    await expect(page.getByTestId('poa-number-input')).toBeDisabled();
    await page.getByRole('button', { name: 'إعادة محاولة الحفظ', exact: true }).click();

    // Verify POA in list
    const poaItem = page.getByTestId('poa-item').first();
    await expect(poaItem).toBeVisible();
    await expect(poaItem).toContainText('0045');
    await expect(poaItem).toContainText('2026');
    await expect(poaItem).toContainText('مكتب توثيق الأهرام النموذجي');
    await expect(poaItem.getByTestId('poa-review-status-badge')).toContainText('سارٍ ومعتمد');
    expect(await prisma.powerOfAttorney.count({ where: { partyId } })).toBe(1);
    expect(await prisma.idempotencyRecord.findUniqueOrThrow({ where: { id: originalClaim.id } }))
      .toEqual(originalClaim);

    // 9. Edit Party with Optimistic Version Protection (R05-03)
    await page.getByTestId('edit-party-button').click();
    await expect(page).toHaveURL(new RegExp(`/parties/${partyId}/edit$`));

    const updatedAddress = '20 شارع طلعت حرب، القاهرة';
    await page.getByTestId('party-address-input').fill(updatedAddress);
    await page.getByTestId('submit-party-button').click();

    // Redirected back to profile with updated address
    await expect(page).toHaveURL(new RegExp(`/parties/${partyId}$`));
    await expect(page.getByTestId('party-summary-card')).toContainText(updatedAddress);

    // 10. Search & Filter in Directory (R05-02)
    await page.goto('/parties');
    await expect(page.getByTestId('party-search-input')).toBeVisible();

    // Normalized search: Alef without hamza matches original with hamza
    await page.getByTestId('party-search-input').fill('محمود عبد العزيز');
    await page.getByTestId('party-search-submit').click();

    const partyEntry = page
      .locator(`[data-testid="party-row-${partyId}"], [data-testid="party-card-${partyId}"]`)
      .filter({ visible: true });
    await expect(partyEntry).toBeVisible();
    await expect(page.getByTestId('party-total-count')).toContainText('1');

    // Filter by Organization -> zero results
    await page.getByTestId('filter-organization').click();
    await expect(page.getByTestId('empty-search-container')).toBeVisible();

    // Filter by Person -> 1 result
    await page.getByTestId('filter-person').click();
    await expect(partyEntry).toBeVisible();

    // 11. Advisory Duplicate Warning Journey (R05-02 / T05-11 / PARENT-03)
    // 11a. Pre-save duplicate check: clicking "open existing" leaves party count unchanged (zero new records)
    const countBeforeDupAttempt = await prisma.party.count({ where: { archivedAt: null } });

    await page.goto('/parties/new');
    await page.getByTestId('kind-person').click();
    await page.getByTestId('party-name-input').fill('محمود عبد العزيز');
    await page.getByTestId('party-phone-input').fill(testPhone);

    await page.getByTestId('submit-party-button').click();

    // Duplicate advisory warning banner must appear BEFORE any record is created in the database
    const advisoryBanner = page.getByTestId('duplicate-advisory-banner');
    await expect(advisoryBanner).toBeVisible();
    await expect(advisoryBanner).toContainText('تنبيه استرشادي');
    await expect(page.getByTestId('duplicate-warning-item').first()).toBeVisible();

    // Assert zero new parties were inserted in the database
    const countAfterAdvisory = await prisma.party.count({ where: { archivedAt: null } });
    expect(countAfterAdvisory).toBe(countBeforeDupAttempt);

    // Option 1: "فتح الملف الموجود" navigates to the existing profile without inserting anything
    const viewExistingLink = page.getByTestId(`view-existing-duplicate-${partyId}`);
    await expect(viewExistingLink).toBeVisible();
    await viewExistingLink.click();

    await expect(page).toHaveURL(new RegExp(`/parties/${partyId}$`));
    const countAfterOpenExisting = await prisma.party.count({ where: { archivedAt: null } });
    expect(countAfterOpenExisting).toBe(countBeforeDupAttempt);

    // 11b. Deliberate distinct creation: clicking "حفظ كطرف مستقل" inserts exactly one record
    await page.goto('/parties/new');
    await page.getByTestId('kind-person').click();
    await page.getByTestId('party-name-input').fill('محمود عبد العزيز');
    await page.getByTestId('party-phone-input').fill(testPhone);

    await page.getByTestId('submit-party-button').click();
    await expect(advisoryBanner).toBeVisible();

    // Click "حفظ كطرف مستقل" to confirm distinct creation
    const confirmDupBtn = page.getByTestId('confirm-duplicate-button');
    await expect(confirmDupBtn).toBeVisible();
    await confirmDupBtn.click();

    // Lands on distinct party profile
    await expect(page).toHaveURL(/\/parties\/[a-f0-9-]+$/);
    const secondPartyId = page.url().split('/').pop()!;
    expect(secondPartyId).not.toBe(partyId);
    createdPartyIds.push(secondPartyId);

    // Assert exactly one new record was inserted
    const countAfterDistinctSave = await prisma.party.count({ where: { archivedAt: null } });
    expect(countAfterDistinctSave).toBe(countBeforeDupAttempt + 1);

    // 12. Optimistic Concurrency Conflict (R05-03)
    // Open edit page for second party
    await page.goto(`/parties/${secondPartyId}/edit`);
    await expect(page.getByTestId('party-form')).toBeVisible();

    // Simulate concurrent update on database directly
    await prisma.party.update({
      where: { id: secondPartyId },
      data: {
        version: { increment: 1 },
        notes: 'تعديل متزامن من جلسة أخرى',
      },
    });

    // Attempt to submit with stale version
    await page.getByTestId('party-notes-input').fill('محاولة حفظ من جلسة متأخرة');
    await page.getByTestId('submit-party-button').click();

    // Concurrency conflict banner must appear
    const conflictBanner = page.getByTestId('concurrency-conflict-banner');
    await expect(conflictBanner).toBeVisible();
    await expect(conflictBanner).toContainText('تم تعديل البيانات من شاشة أخرى');
    await expect(page.getByTestId('reload-latest-button')).toBeVisible();

    // Form inputs must remain preserved in memory
    await expect(page.getByTestId('party-notes-input')).toHaveValue('محاولة حفظ من جلسة متأخرة');
  });

  test('controlled search race discards late out-of-order response via request generation @parties', async ({ page }) => {
    await signInWithTotp(page, owner);

    // Seed two distinct parties for testing out-of-order search responses
    const slowParty = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'طرف استعلام بطيء للتأكد من السباق',
        nameNormalized: 'طرف استعلام بطيء للتاكد من السباق',
        primaryPhone: '01011112222',
        primaryPhoneNormalized: '01011112222',
        createdById: owner.id,
        updatedById: owner.id,
        version: 1,
      },
    });
    createdPartyIds.push(slowParty.id);

    const fastParty = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'طرف استعلام سريع للتأكد من السباق',
        nameNormalized: 'طرف استعلام سريع للتاكد من السباق',
        primaryPhone: '01033334444',
        primaryPhoneNormalized: '01033334444',
        createdById: owner.id,
        updatedById: owner.id,
        version: 1,
      },
    });
    createdPartyIds.push(fastParty.id);

    await page.goto('/parties');
    const searchInput = page.getByTestId('party-search-input');
    await expect(searchInput).toBeVisible();

    let resolveQuery1Started!: () => void;
    const query1Started = new Promise<void>((resolve) => {
      resolveQuery1Started = resolve;
    });
    let releaseQuery1!: () => void;
    const query1Gate = new Promise<void>((resolve) => {
      releaseQuery1 = resolve;
    });
    let resolveQuery2Started!: () => void;
    const query2Started = new Promise<void>((resolve) => {
      resolveQuery2Started = resolve;
    });
    let releaseQuery2!: () => void;
    const query2Gate = new Promise<void>((resolve) => {
      releaseQuery2 = resolve;
    });

    let postCount = 0;
    let query1Fulfilled = false;
    let query2Fulfilled = false;
    await page.route('**/parties**', async (route) => {
      if (route.request().method() === 'POST') {
        postCount++;
        if (postCount === 1) {
          resolveQuery1Started();
          await query1Gate;
          try {
            const response = await route.fetch();
            await route.fulfill({ response });
            query1Fulfilled = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              !msg.includes('Target page, context or browser has been closed') &&
              !msg.includes('Route is already handled')
            ) {
              throw err;
            }
          }
        } else if (postCount === 2) {
          resolveQuery2Started();
          await query2Gate;
          try {
            const response = await route.fetch();
            await route.fulfill({ response });
            query2Fulfilled = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              !msg.includes('Target page, context or browser has been closed') &&
              !msg.includes('Route is already handled')
            ) {
              throw err;
            }
          }
        } else {
          try {
            const response = await route.fetch();
            await route.fulfill({ response });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              !msg.includes('Target page, context or browser has been closed') &&
              !msg.includes('Route is already handled')
            ) {
              throw err;
            }
          }
        }
      } else {
        await route.continue();
      }
    });

    try {
      // 1. Dispatch Query 1 ("بطيء") and wait deterministically until it is intercepted in flight
      await searchInput.fill('بطيء');
      await page.getByTestId('party-search-submit').click();
      await query1Started;

      // 2. Dispatch Query 2 ("سريع") while Query 1 is held (advances requestGenRef past gen=1 while Next.js queues Request 2)
      await searchInput.fill('سريع');
      await page.getByTestId('party-search-submit').click();

      // 3. Release Query 1 while Query 2 is held by query2Gate; Query 1's stale response must settle and be discarded
      releaseQuery1();
      await expect.poll(() => query1Fulfilled, { timeout: 10_000 }).toBe(true);
      await query2Started;

      // Let React settle any pending microtasks/frames from Query 1 while Query 2 is still held
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      );

      const fastPartyEntry = page
        .locator(`[data-testid="party-row-${fastParty.id}"], [data-testid="party-card-${fastParty.id}"]`)
        .filter({ visible: true });
      const slowPartyEntry = page
        .locator(`[data-testid="party-row-${slowParty.id}"], [data-testid="party-card-${slowParty.id}"]`)
        .filter({ visible: true });
      await expect(page.getByTestId('loading-indicator')).toBeVisible();
      await expect(slowPartyEntry).toBeHidden();
      await expect(fastPartyEntry).toBeHidden();

      // 4. Release Query 2 and verify Fast party renders while Slow party stays hidden
      releaseQuery2();
      await expect.poll(() => query2Fulfilled, { timeout: 10_000 }).toBe(true);
      await expect(fastPartyEntry).toBeVisible({ timeout: 15_000 });
      await expect(slowPartyEntry).toBeHidden();
      expect(postCount).toBeGreaterThanOrEqual(2);
    } finally {
      releaseQuery1();
      releaseQuery2();
      await page.unroute('**/parties**');
    }
  });

  test('search handles transport failures with accessible retry banner @parties', async ({ page }) => {
    await signInWithTotp(page, owner);
    await page.goto('/parties');

    const searchInput = page.getByTestId('party-search-input');
    await expect(searchInput).toBeVisible();

    // Fast sequential searches: latest query result must remain in view
    await searchInput.fill('محمود');
    await page.getByTestId('party-search-submit').click();
    await expect(page.getByTestId('party-total-count')).toBeVisible();

    // Simulate transport failure
    await page.route('**/parties**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await searchInput.fill('بحث_معطل');
    await page.getByTestId('party-search-submit').click();

    // Error banner appears with retry button
    const errorContainer = page.getByTestId('error-container');
    await expect(errorContainer).toBeVisible();
    const retryBtn = page.getByTestId('error-retry-button');
    await expect(retryBtn).toBeVisible();

    // Unroute and retry: recovers gracefully
    await page.unroute('**/parties**');
    await retryBtn.click();
    await expect(errorContainer).toBeHidden();
  });

  test('communication notes parse Cairo wall-time correctly from non-Cairo client timezone @parties', async ({ browser }) => {
    // Non-Cairo browser timezone (America/New_York)
    const context = await browser.newContext({
      timezoneId: 'America/New_York',
      locale: 'ar-EG',
    });
    try {
      const page = await context.newPage();
      await signInWithTotp(page, owner);

      // Create a temporary party for this test
      const timeParty = await prisma.party.create({
        data: {
          kind: 'PERSON',
          name: 'طرف فحص توقيت القاهرة الخارجي',
          nameNormalized: 'طرف فحص توقيت القاهرة الخارجي',
          primaryPhone: '01055556666',
          primaryPhoneNormalized: '01055556666',
          createdById: owner.id,
          updatedById: owner.id,
          version: 1,
        },
      });
      createdPartyIds.push(timeParty.id);

      await page.goto(`/parties/${timeParty.id}`);
      await page.getByTestId('add-note-button').click();

      // Specific Cairo wall-clock time: 2026-11-25T14:30
      // In November 2026, Cairo is UTC+2 (Standard Time).
      // So 14:30 Cairo wall-clock time must correspond strictly to 12:30:00.000Z in UTC
      const targetWallTime = '2026-11-25T14:30';
      await page.getByTestId('note-date-input').fill(targetWallTime);
      await page.getByTestId('note-channel-select').selectOption('PHONE');
      await page.getByTestId('note-summary-input').fill('محادثة مسجلة بتوقيت القاهرة من عميل في نيويورك');
      await page.getByTestId('save-note-button').click();

      // Verify note is rendered in timeline
      const noteItem = page.getByTestId('communication-note-item').first();
      await expect(noteItem).toBeVisible();
      await expect(noteItem.getByTestId('note-cairo-timestamp')).toBeVisible();

      // Check exact UTC instant stored in the database
      const savedNote = await prisma.communicationNote.findFirst({
        where: { partyId: timeParty.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(savedNote).not.toBeNull();
      expect(savedNote!.communicationAt.toISOString()).toBe('2026-11-25T12:30:00.000Z');
    } finally {
      await context.close();
    }
  });
});
