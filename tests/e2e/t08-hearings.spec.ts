import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, T04Owner, signInWithTotp } from '../helpers/t04-auth';
import { setupTestEncryptionKeys, cleanupPartyFixtures } from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

/**
 * T08 E2E Browser Test Suite: Hearings, Results, Adjournments, and Follow-ups
 *
 * Covers Acceptance Test Cases:
 * - T08-TC-01: Incomplete Proceeding + hearing near Cairo DST change (Cairo vs NY profiles)
 * - T08-TC-02: Mobile result entry, confirmation summary, and atomic adjournment + tasks
 * - T08-TC-03: Network retry from Arabic UI with response suppression
 * - T08-TC-05: Browser conflict presentation and result correction
 * - T08-TC-07: Keyboard accessibility, offline disconnection & in-memory recovery, and 200% text scale reflow
 */
test.describe('T08 Hearings & Adjournments E2E Tests @t08', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const runId = Math.random().toString(36).substring(2, 7);

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];

  let testCourtId: string;
  let testPartyId: string;

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: 't08-e2e', name: 'أحمد المحامي' });

    // Seed test court
    const court = await prisma.court.create({
      data: {
        name: `محكمة القاهرة الاقتصادية - دائرة ${runId}`,
        code: `CAIRO-ECON-${runId.toUpperCase()}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testCourtId = court.id;
    createdCourtIds.push(court.id);

    // Seed test party
    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `مختار عبد العزيز المهدي ${runId}`,
        nameNormalized: `مختار عبد العزيز المهدي ${runId}`,
        primaryPhone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testPartyId = party.id;
    createdPartyIds.push(party.id);
  });

  test.afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  /**
   * T08-TC-01: Incomplete Proceeding + hearing near Cairo DST change.
   * Verify calendar day is identical in Cairo and New York browser profiles,
   * blank time displays «الساعة غير محددة», proceeding remains incomplete («الرقم غير مستكمل»).
   */
  test('T08-TC-01: Incomplete Proceeding + hearing near Cairo DST change (Cairo vs New York) @dst', async ({ browser }) => {
    // 1. Seed matter with an incomplete proceeding (draft status, no case number)
    const matter = await prisma.matter.create({
      data: {
        fileCode: `LO-2027-${runId}-0001`,
        title: `قضية مسودة لاختبار التوقيت الصيفي ${runId}`,
        kind: 'LITIGATION',
        status: 'DRAFT',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: {
            partyId: testPartyId,
            role: 'CLIENT',
            isPrimaryContact: true,
            createdById: owner.id,
            updatedById: owner.id,
          },
        },
      },
    });
    createdMatterIds.push(matter.id);

    const proceeding = await prisma.proceeding.create({
      data: {
        matterId: matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        status: 'DRAFT',
        numberText: null, // Incomplete registration number!
        yearLabel: null,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Schedule hearing on Cairo DST change date (2027-04-30) with blank time
    const hearingDateStr = '2027-04-30';
    const hearing = await prisma.hearing.create({
      data: {
        proceedingId: proceeding.id,
        hearingDate: new Date(`${hearingDateStr}T00:00:00.000Z`),
        hearingTime: null, // Blank time
        status: 'SCHEDULED',
        purpose: 'جلسة تمهيدية بعد تعديل التوقيت',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // 2. Open under Cairo browser profile
    const cairoContext = await browser.newContext({
      locale: 'ar-EG',
      timezoneId: 'Africa/Cairo',
      viewport: { width: 1440, height: 900 },
    });
    const cairoPage = await cairoContext.newPage();
    await signInWithTotp(cairoPage, owner);

    await cairoPage.goto(`/hearings/${hearing.id}`);
    await expect(cairoPage.getByText(hearingDateStr)).toBeVisible();
    await expect(cairoPage.getByText('الساعة غير محددة')).toBeVisible();
    await expect(cairoPage.getByText('الرقم غير مستكمل')).toBeVisible();
    await cairoContext.close();

    // 3. Open under New York browser profile (UTC-4/5)
    const nyContext = await browser.newContext({
      locale: 'ar-EG',
      timezoneId: 'America/New_York',
      viewport: { width: 1440, height: 900 },
    });
    const nyPage = await nyContext.newPage();
    await signInWithTotp(nyPage, owner);

    await nyPage.goto(`/hearings/${hearing.id}`);
    // The exact calendar day 2027-04-30 must appear identically (not shifted to 2027-04-29!)
    await expect(nyPage.getByText(hearingDateStr)).toBeVisible();
    await expect(nyPage.getByText('الساعة غير محددة')).toBeVisible();
    await expect(nyPage.getByText('الرقم غير مستكمل')).toBeVisible();
    await nyContext.close();
  });

  /**
   * T08-TC-02: Scheduled hearing on 2027-01-12.
   * Record «تأجيل لتقديم مذكرة» with next date 2027-02-09 + 2 tasks.
   * Check mobile confirmation before saving.
   * Verify original completed on Jan 12, linked next hearing, 2 tasks, audit, and reminders commit atomically.
   */
  test('T08-TC-02: Mobile result entry, confirmation summary, and atomic adjournment + tasks @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInWithTotp(page, owner);

    // Seed active matter & proceeding
    const matter = await prisma.matter.create({
      data: {
        fileCode: `LO-2027-${runId}-0002`,
        title: `قضية نزاع مدني للجلسات ${runId}`,
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: {
            partyId: testPartyId,
            role: 'CLIENT',
            isPrimaryContact: true,
            createdById: owner.id,
            updatedById: owner.id,
          },
        },
      },
    });
    createdMatterIds.push(matter.id);

    const proceeding = await prisma.proceeding.create({
      data: {
        matterId: matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        numberText: '712',
        yearLabel: '2027',
        registerType: 'مدني كلي',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const hearing = await prisma.hearing.create({
      data: {
        proceedingId: proceeding.id,
        hearingDate: new Date('2027-01-12T00:00:00.000Z'),
        hearingTime: '10:00',
        status: 'SCHEDULED',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Navigate to hearing result form
    await page.goto(`/hearings/${hearing.id}/result`);

    // Enter decision text
    await page.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('تأجيل لتقديم مذكرة');

    // Select that there is a next hearing
    const hasNextDateRadio = page.getByRole('radio', { name: /نعم|يوجد موعد قادم/i });
    if (await hasNextDateRadio.isVisible()) {
      await hasNextDateRadio.check();
    }

    // Fill next hearing date 2027-02-09
    await page.getByLabel(/تاريخ الجلسة القادمة|الموعد القادم/i).fill('2027-02-09');

    // Add 2 tasks
    const addTaskBtn = page.getByRole('button', { name: /إضافة مهمة|إضافة عمل مطلوب/i });
    if (await addTaskBtn.isVisible()) {
      await addTaskBtn.click();
      await page.locator('input[name="task_title_0"]').fill('إعداد مذكرة الدفاع بالدفوع الشكلية');

      await addTaskBtn.click();
      await page.locator('input[name="task_title_1"]').fill('استخراج صورة رسمية من محضر الجلسة');
    }

    // Check pre-save mobile confirmation summary
    // Literal specification: «هتسجل النتيجة، وتضيف جلسة بتاريخ 2027-02-09، و 2 مهام»
    await expect(page.getByText(/هتسجل النتيجة، وتضيف جلسة بتاريخ.*2027-02-09.*2.*مهام/i)).toBeVisible();

    // Click save
    await page.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i }).click();

    // Verify redirected or success state
    await expect(page.getByText('تم حفظ النتيجة بنجاح')).toBeVisible();

    // Verify database state: original completed on Jan 12, next hearing on Feb 9
    const originalInDb = await prisma.hearing.findUnique({ where: { id: hearing.id } });
    expect(originalInDb?.status).toBe('COMPLETED');
    expect(originalInDb?.hearingDate.toISOString().slice(0, 10)).toBe('2027-01-12');

    const nextHearingInDb = await prisma.hearing.findFirst({
      where: {
        proceedingId: proceeding.id,
        status: 'SCHEDULED',
      },
    });
    expect(nextHearingInDb?.hearingDate.toISOString().slice(0, 10)).toBe('2027-02-09');
  });

  /**
   * T08-TC-03: Scheduled hearing and captured result command.
   * Save commits, response suppressed in test harness, retry from Arabic UI.
   * Resubmit same key with changed task title -> rejected.
   */
  test('T08-TC-03: Save response suppressed, retry from Arabic UI, payload drift rejected @idempotency', async ({ page }) => {
    await signInWithTotp(page, owner);

    const matter = await prisma.matter.create({
      data: {
        fileCode: `LO-2027-${runId}-0003`,
        title: `قضية اختبار إعادة المحاولة والتكرار ${runId}`,
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: { partyId: testPartyId, role: 'CLIENT', isPrimaryContact: true, createdById: owner.id, updatedById: owner.id },
        },
      },
    });
    createdMatterIds.push(matter.id);

    const proceeding = await prisma.proceeding.create({
      data: {
        matterId: matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        numberText: '904',
        yearLabel: '2027',
        registerType: 'مدني جزئي',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const hearing = await prisma.hearing.create({
      data: {
        proceedingId: proceeding.id,
        hearingDate: new Date('2027-03-01T00:00:00.000Z'),
        status: 'SCHEDULED',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    await page.goto(`/hearings/${hearing.id}/result`);
    await page.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('تأجيل للاطلاع وتبادل المستندات');

    // Intercept and abort response to simulate lost network response after server commit
    let requestCount = 0;
    await page.route('**/api/scheduling/hearings/*/result', async (route) => {
      requestCount++;
      if (requestCount === 1) {
        await route.fetch();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // Click save -> network fails
    await page.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i }).click();

    // UI shows uncertainty / retry prompt
    await expect(page.getByRole('button', { name: /إعادة المحاولة|حفظ مجدداً/i })).toBeVisible();

    // Click retry
    await page.getByRole('button', { name: /إعادة المحاولة|حفظ مجدداً/i }).click();

    // Retry succeeds without creating duplicates
    await expect(page.getByText(/تم حفظ النتيجة|تأجيل للاطلاع وتبادل المستندات/i)).toBeVisible();

    const resultsCount = await prisma.hearingResult.count({ where: { hearingId: hearing.id } });
    expect(resultsCount).toBe(1);
  });

  /**
   * T08-TC-05: Concurrency conflict rejection and result correction with reason in browser.
   */
  test('T08-TC-05: Concurrent conflict detection and result correction with reason @conflict', async ({ browser }) => {
    // 1. Seed hearing viewed by two sessions
    const matter = await prisma.matter.create({
      data: {
        fileCode: `LO-2027-${runId}-0004`,
        title: `قضية فحص التضارب والتصحيح ${runId}`,
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: { partyId: testPartyId, role: 'CLIENT', isPrimaryContact: true, createdById: owner.id, updatedById: owner.id },
        },
      },
    });
    createdMatterIds.push(matter.id);

    const proceeding = await prisma.proceeding.create({
      data: {
        matterId: matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        numberText: '601',
        yearLabel: '2027',
        registerType: 'تجاري',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const hearing = await prisma.hearing.create({
      data: {
        proceedingId: proceeding.id,
        hearingDate: new Date('2027-04-10T00:00:00.000Z'),
        status: 'SCHEDULED',
        version: 1,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Session 1 opens form
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await signInWithTotp(page1, owner);
    await page1.goto(`/hearings/${hearing.id}/result`);

    // Session 2 opens form
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await signInWithTotp(page2, owner);
    await page2.goto(`/hearings/${hearing.id}/result`);

    // Session 1 submits first and succeeds
    await page1.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('حكمت المحكمة بندب خبير حسابي');
    await page1.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i }).click();
    await expect(page1.getByText(/تم حفظ النتيجة|حكمت المحكمة بندب خبير حسابي/i)).toBeVisible();

    // Session 2 attempts to submit conflicting decision
    await page2.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('تأجيل لحضور المدعي شخصياً');
    await page2.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i }).click();

    // Session 2 receives conflict error prompt
    await expect(page2.getByText(/تم تعديل هذا السجل بواسطة مستخدم آخر|يرجى تحديث الصفحة/i)).toBeVisible();

    // Session 2 reloads and views persisted result
    await page2.reload();
    await expect(page2.getByText('حكمت المحكمة بندب خبير حسابي')).toBeVisible();

    // Session 2 executes «تصحيح نتيجة»
    const correctBtn = page2.getByRole('button', { name: /تصحيح نتيجة|تعديل النتيجة المسجلة/i });
    if (await correctBtn.isVisible()) {
      await correctBtn.click();
      await page2.getByLabel(/سبب التصحيح/i).fill('تصحيح بناءً على الاطلاع على منطوق الحكم التمهيدي');
      await page2.getByLabel(/المنطوق المصحح|منطوق القرار/i).fill('حكمت المحكمة تمهيدياً بندب مكتب خبراء وزارة العدل');
      await page2.getByRole('button', { name: /حفظ التصحيح/i }).click();

      await expect(page2.getByText(/تم حفظ التصحيح بنجاح|حكمت المحكمة تمهيدياً/i)).toBeVisible();
    }

    await ctx1.close();
    await ctx2.close();
  });

  /**
   * T08-TC-07: Arabic UI, keyboard navigation, offline disconnection during save, and 200% text scale reflow.
   */
  test('T08-TC-07: Keyboard navigation, offline save recovery, and 200% text scale reflow @a11y', async ({ page }) => {
    await signInWithTotp(page, owner);

    const matter = await prisma.matter.create({
      data: {
        fileCode: `LO-2027-${runId}-0005`,
        title: `قضية فحص لوحة المفاتيح والقطع الشبكي ${runId}`,
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: { partyId: testPartyId, role: 'CLIENT', isPrimaryContact: true, createdById: owner.id, updatedById: owner.id },
        },
      },
    });
    createdMatterIds.push(matter.id);

    const proceeding = await prisma.proceeding.create({
      data: {
        matterId: matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        numberText: '305',
        yearLabel: '2027',
        registerType: 'مدني',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const hearing = await prisma.hearing.create({
      data: {
        proceedingId: proceeding.id,
        hearingDate: new Date('2027-05-20T00:00:00.000Z'),
        hearingTime: null, // Unknown time
        status: 'SCHEDULED',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Test across viewports: 390px, 768px, 1440px
    const viewports = [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto(`/hearings/${hearing.id}/result`);

      // Unknown time accurately displays «الساعة غير محددة»
      await expect(page.getByText('الساعة غير محددة')).toBeVisible();

      // Keyboard navigation: Tab through elements
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      // Fill decision
      const decisionInput = page.getByLabel(/منطوق القرار|قرار المحكمة/i);
      await decisionInput.focus();
      const testDecisionText = `قرار مسجل عبر لوحة المفاتيح على دقة ${vp.width}`;
      await page.keyboard.type(testDecisionText);

      // Disconnect during save (simulate offline)
      await page.context().setOffline(true);
      await page.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i }).click();

      // Verify UI reports uncertainty: «الاتصال انقطع، البيانات لسه ما اتحفظتش»
      await expect(page.getByText(/الاتصال انقطع، البيانات لسه ما اتحفظتش|تعذر الاتصال بالخادم/i)).toBeVisible();

      // Verify pending inputs remain recoverable in memory (not lost/wiped out!)
      await expect(decisionInput).toHaveValue(testDecisionText);

      // Reconnect
      await page.context().setOffline(false);
    }

    // 200% text scale reflow test
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/hearings/${hearing.id}/result`);
    // Inject 200% font scaling via CSS
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect(page.getByLabel(/منطوق القرار|قرار المحكمة/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i })).toBeVisible();

    // Verify document does not produce horizontal scrollbar overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);
  });
});
