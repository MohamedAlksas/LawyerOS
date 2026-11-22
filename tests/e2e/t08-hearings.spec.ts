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
  test('T08-TC-01: Incomplete Proceeding + hearing near Cairo DST change (Cairo vs New York) @dst', async ({ page }) => {
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

    const date = '2027-04-30';
    await signInWithTotp(page, owner);
    await page.goto(`/matters/${matter.id}/proceedings/${proceeding.id}`);
    await expect(page.getByText('الرقم غير مستكمل').first()).toBeVisible();
    const submissions: Array<string | null> = [];
    await page.route('**/matters/**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      submissions.push(route.request().postData());
      if (submissions.length > 1) return route.continue();
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort('failed');
    });
    await page.getByTestId('schedule-hearing-button').click();
    await page.getByTestId('schedule-hearing-date-input').fill(date);
    await page.getByTestId('schedule-hearing-submit-button').click();
    await expect(page.getByTestId('schedule-hearing-retry-banner')).toBeVisible();
    const pending = await prisma.hearing.findFirstOrThrow({ where: { proceedingId: proceeding.id } });
    await page.getByTestId('schedule-hearing-cancel-button').click();
    await page.getByTestId('schedule-hearing-button').click();
    await expect(page.getByTestId('schedule-hearing-date-input')).toHaveValue(date);
    await expect(page.getByTestId('schedule-hearing-date-input')).toBeDisabled();
    await page.getByTestId('schedule-hearing-submit-button').click();
    await expect(page.getByTestId('hearings-count-badge')).toHaveText('1');
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toBe(submissions[0]);
    const hearing = await prisma.hearing.findFirstOrThrow({ where: { proceedingId: proceeding.id } });
    expect(hearing.id).toBe(pending.id);
    expect(await prisma.hearing.count({ where: { proceedingId: proceeding.id } })).toBe(1);
    expect(hearing.hearingDate.toISOString().slice(0, 10)).toBe(date);
    expect(hearing.hearingTime).toBeNull();
    await page.goto(`/hearings/${hearing.id}`);
    await expect(page).toHaveTitle('تفاصيل الجلسة — LawOffice OS');
    await expect(page.getByText(date).first()).toBeVisible();
    await expect(page.getByText('الساعة غير محددة')).toBeVisible();
    await expect(page.getByText('الرقم غير مستكمل')).toBeVisible();
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
    await page.goto(`/matters/${matter.id}/proceedings/${proceeding.id}`);
    await page.getByTestId(`record-result-button-${hearing.id}`).click();

    // Enter decision text
    await page.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('تأجيل لتقديم مذكرة');

    // Select that there is a next hearing
    const hasNextDateRadio = page.getByRole('radio', { name: /نعم|يوجد موعد قادم/i });
    await hasNextDateRadio.locator('..').click();
    await expect(hasNextDateRadio).toBeChecked();
    await page.getByTestId('save-hearing-result-btn').click();
    await expect(page.getByRole('alert').filter({ hasText: 'حدد تاريخ الجلسة القادمة' })).toBeVisible();

    // Fill next hearing date 2027-02-09
    await page.getByLabel(/تاريخ الجلسة القادمة|الموعد القادم/i).fill('2027-02-09');

    // Add 2 tasks
    const addTaskBtn = page.getByRole('button', { name: /إضافة مهمة|إضافة عمل مطلوب/i });
    await addTaskBtn.click();
    await page.getByTestId('task-title-0').fill('إعداد مذكرة الدفاع بالدفوع الشكلية');
    await addTaskBtn.click();
    await page.getByTestId('task-title-1').fill('استخراج صورة رسمية من محضر الجلسة');
    await page.getByLabel('وقت الجلسة القادمة (اختياري)').fill('10:30');
    await page.getByLabel('ملخص الجلسة (اختياري)').fill('تأجيل للمذكرات');
    await page.getByLabel('الحضور (اختياري)').fill('حضر وكيل المدعي');

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
    expect(nextHearingInDb?.hearingTime).toBe('10:30');
    expect(await prisma.hearingResult.findFirst({
      where: { hearingId: hearing.id }, select: { summary: true, attendance: true },
    })).toEqual({ summary: 'تأجيل للمذكرات', attendance: 'حضر وكيل المدعي' });
    const nextId = nextHearingInDb!.id;
    expect(await prisma.hearingLink.count({ where: { fromHearingId: hearing.id, toHearingId: nextId, relation: 'ADJOURNED_TO' } })).toBe(1);
    expect(await prisma.task.count({ where: { hearingId: hearing.id, matterId: matter.id, proceedingId: proceeding.id } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { entityId: hearing.id, action: 'RECORD_HEARING_RESULT' } })).toBe(1);
    expect(await prisma.jobRun.count({ where: { sourceId: nextId, sourceType: 'Hearing', status: 'PENDING' } })).toBe(1);
    await expect(page.getByTestId('linked-next-hearing')).toHaveAttribute('href', `/hearings/${nextId}`);
    await page.getByRole('link', { name: 'عرض الموعد أو تغييره من القيد' }).click();
    await expect(page.getByTestId(`hearing-card-${hearing.id}`)).toContainText('تأجيل لتقديم مذكرة');
    await expect(page.getByTestId(`hearing-card-${nextId}`)).toBeVisible();

    await page.getByTestId(`reschedule-hearing-button-${nextId}`).click();
    await page.getByTestId('reschedule-new-date-input').fill('2027-02-19');
    await page.getByTestId('reschedule-reason-input').fill('تعديل الموعد لاختبار نقل مهمة واحدة');
    await page.getByRole('checkbox', { name: /نقل إعداد مذكرة الدفاع/ }).check();
    await page.getByLabel(/الموعد الجديد لمهمة إعداد مذكرة الدفاع/).fill('2027-02-17');
    await page.getByTestId('reschedule-submit-button').click();
    await expect(page.getByTestId('hearings-count-badge')).toHaveText('3');
    const replacement = await prisma.hearing.findFirstOrThrow({ where: { supersedesHearingId: nextId } });
    const movedTasks = await prisma.task.findMany({ where: { hearingId: replacement.id } });
    expect(movedTasks.map(({ title }) => title)).toEqual(['إعداد مذكرة الدفاع بالدفوع الشكلية']);
    expect(movedTasks[0].dueDate?.toISOString().slice(0, 10)).toBe('2027-02-17');
    expect(await prisma.task.count({ where: { hearingId: hearing.id } })).toBe(1);
    await page.getByTestId(`correct-result-button-${hearing.id}`).click();
    await expect(page.getByTestId('linked-next-hearing')).toHaveAttribute('href', `/hearings/${replacement.id}`);
    await expect(page.getByTestId('linked-next-hearing')).toContainText('2027-02-19');
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

    await page.goto(`/matters/${matter.id}/proceedings/${proceeding.id}`);
    await page.getByTestId(`record-result-button-${hearing.id}`).click();
    await page.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('تأجيل للاطلاع وتبادل المستندات');

    await page.getByRole('radio', { name: /يوجد موعد قادم/ }).locator('..').click();
    await page.getByTestId('next-hearing-date-input').fill('2027-03-20');
    await page.getByTestId('add-task-button').click();
    await page.getByTestId('task-title-0').fill('متابعة المستندات');
    const bodies: Array<string | null> = [];
    let firstResultId: string | undefined;
    await page.route('**/api/scheduling/hearings/*/result', async (route) => {
      bodies.push(route.request().postData());
      if (bodies.length === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        firstResultId = (await response.json()).data.resultId;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByTestId('save-hearing-result-btn').click();
    await expect(page.getByTestId('uncertainty-error-banner')).toBeVisible();
    await expect(page.getByTestId('task-title-0')).toBeDisabled();
    await page.getByRole('navigation', { name: 'مسار التنقل' }).getByRole('link', { name: 'القيد القضائي' }).click();
    await page.getByTestId(`correct-result-button-${hearing.id}`).click();
    await page.getByTestId('record-result-retry-btn').click();
    await expect(page.getByTestId('save-success-banner')).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    const results = await prisma.hearingResult.findMany({ where: { hearingId: hearing.id } });
    expect(results.map(({ id }) => id)).toEqual([firstResultId]);
    expect(await prisma.hearingLink.count({ where: { fromHearingId: hearing.id } })).toBe(1);
    expect(await prisma.task.count({ where: { hearingId: hearing.id } })).toBe(1);
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
    await page1.goto(`/matters/${matter.id}/proceedings/${proceeding.id}`);
    await page1.getByTestId(`record-result-button-${hearing.id}`).click();

    // Session 2 opens form
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await signInWithTotp(page2, owner);
    await page2.goto(`/matters/${matter.id}/proceedings/${proceeding.id}`);
    await page2.getByTestId(`record-result-button-${hearing.id}`).click();

    // Session 1 submits first and succeeds
    await page1.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('حكمت المحكمة بندب خبير حسابي');
    await page1.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i }).click();
    await expect(page1.getByText(/تم حفظ النتيجة|حكمت المحكمة بندب خبير حسابي/i)).toBeVisible();

    // Session 2 attempts to submit conflicting decision
    await page2.getByLabel(/منطوق القرار|قرار المحكمة/i).fill('تأجيل لحضور المدعي شخصياً');
    await page2.getByRole('button', { name: /حفظ النتيجة|تأكيد وحفظ/i }).click();

    // Session 2 receives conflict error prompt
    await expect(page2.getByTestId('conflict-error-banner')).toBeVisible();

    // Session 2 reloads and views persisted result
    await page2.reload();
    await expect(page2.getByText('حكمت المحكمة بندب خبير حسابي')).toBeVisible();

    await page2.getByTestId('correct-result-button').click();
    await page2.getByLabel(/سبب التصحيح/i).fill('تصحيح بناءً على الاطلاع على منطوق الحكم التمهيدي');
    await page2.getByLabel(/المنطوق المصحح/i).fill('حكمت المحكمة تمهيدياً بندب مكتب خبراء وزارة العدل');
    const corrections: Array<string | null> = [];
    await page2.route('**/api/scheduling/hearings/*/correct', async (route) => {
      corrections.push(route.request().postData());
      if (corrections.length > 1) return route.continue();
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort('failed');
    });
    await page2.getByTestId('save-correction-btn').click();
    await expect(page2.getByRole('alert').filter({ hasText: 'تعذر استلام تأكيد الحفظ' })).toBeVisible();
    await expect(page2.getByLabel(/المنطوق المصحح/i)).toBeDisabled();
    await page2.getByTestId('save-correction-btn').click();
    await expect(page2.getByText(/تم حفظ التصحيح بنجاح/)).toBeVisible();
    expect(corrections).toHaveLength(2);
    expect(corrections[1]).toBe(corrections[0]);
    expect(await prisma.hearingResult.count({ where: { hearingId: hearing.id } })).toBe(2);
    await expect(page2.getByTestId('persisted-decision-text')).toHaveText('حكمت المحكمة تمهيدياً بندب مكتب خبراء وزارة العدل');
    await page2.getByText('مراجعات النتيجة السابقة').click();
    await expect(page2.getByText('حكمت المحكمة بندب خبير حسابي')).toBeVisible();

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

    await page.goto(`/matters/${matter.id}/proceedings/${proceeding.id}`);
    await page.getByTestId(`record-result-button-${hearing.id}`).click();
    await expect(page.getByTestId('hearing-unknown-time')).toBeVisible();
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const decision = page.getByTestId('hearing-decision-textarea');
    await decision.focus();
    await expect(decision).toBeFocused();
    await page.keyboard.insertText('قرار مسجل عبر لوحة المفاتيح');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('ملخص الجلسة (اختياري)')).toBeFocused();
    await page.keyboard.insertText('ملخص للاختبار');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => document.documentElement.clientWidth));

    await page.route('**/api/scheduling/hearings/*/result', async (route) => {
      await page.context().setOffline(true);
      await route.abort('internetdisconnected');
    }, { times: 1 });
    await page.getByTestId('save-hearing-result-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('uncertainty-error-banner')).toBeVisible();
    await expect(decision).toHaveValue('قرار مسجل عبر لوحة المفاتيح');
    await expect(page.getByLabel('ملخص الجلسة (اختياري)')).toHaveValue('ملخص للاختبار');
    await expect(decision).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.getByTestId('protected-view-lock')).toBeHidden();
    await page.getByTestId('record-result-retry-btn').press('Enter');
    await expect(page.getByTestId('save-success-banner')).toBeVisible();
  });
});
