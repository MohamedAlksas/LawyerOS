import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, type T04Owner } from '../helpers/t04-auth';
import { cleanupTrackedFixtures, createValidatedTestPool } from '../helpers/test-db';
import { setupTestEncryptionKeys, cleanupPartyFixtures } from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { formatCairoOffsetYmd } from '../helpers/cairo-test-date';
import {
  expectNoElementOverflow,
  expectNoPageOverflow,
  expectShellReady,
  nextPaint,
} from '../helpers/t04-layout';
import {
  expectNoSensitiveValues,
  expectSessionCookiesHardened,
  sensitiveNeedles,
  snapshotCookies,
  snapshotStorage,
} from '../helpers/t04-storage';

/**
 * T10 E2E Browser Test Suite: Durable Reminders, Worker Health & In-App Inbox.
 *
 * Covers browser acceptance cases:
 * - T10-TC-05: Terminal failure visibility, deliberate retry, marking SENT item read without completing Task/Deadline
 * - T10-TC-06: Unauthenticated & MAINTAINER access boundaries on /inbox and /api/reminders/*
 * - T10-TC-07: Inbox with unread, overdue, and worker-failed states at 390/768/1440px, 200% zoom,
 *              loss of connectivity + stale refresh retry, Arabic closed-app/offline limits notice, and browser privacy
 */

const prisma = getPrismaClient();

async function cleanupScopedT10Data(opts: {
  ownerIds?: string[];
  matterIds?: string[];
  partyIds?: string[];
  courtIds?: string[];
  taskIds?: string[];
  deadlineIds?: string[];
  deliveryIds?: string[];
  jobIds?: string[];
}) {
  if (opts.deliveryIds && opts.deliveryIds.length > 0) {
    await prisma.reminderDelivery.deleteMany({ where: { id: { in: opts.deliveryIds } } });
  }
  if (opts.ownerIds && opts.ownerIds.length > 0) {
    await prisma.reminderDelivery.deleteMany({ where: { recipientUserId: { in: opts.ownerIds } } });
  }
  if (opts.jobIds && opts.jobIds.length > 0) {
    await prisma.jobRun.deleteMany({ where: { id: { in: opts.jobIds } } });
  }
  if (opts.deadlineIds && opts.deadlineIds.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { sourceType: 'Deadline', sourceId: { in: opts.deadlineIds } },
    });
  }
  if (opts.taskIds && opts.taskIds.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { sourceType: 'Task', sourceId: { in: opts.taskIds } },
    });
  }

  const entityIds = [
    ...(opts.deliveryIds ?? []),
    ...(opts.jobIds ?? []),
    ...(opts.deadlineIds ?? []),
    ...(opts.taskIds ?? []),
    ...(opts.matterIds ?? []),
  ];
  if (entityIds.length > 0) {
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { resultId: { in: entityIds } } });
  }
  if (opts.ownerIds && opts.ownerIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: { in: opts.ownerIds } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: opts.ownerIds } } });
  }
  if (opts.taskIds && opts.taskIds.length > 0) {
    await prisma.task.deleteMany({ where: { id: { in: opts.taskIds } } });
  }
  if (opts.deadlineIds && opts.deadlineIds.length > 0) {
    await prisma.deadline.deleteMany({ where: { id: { in: opts.deadlineIds } } });
  }
  if (opts.matterIds && opts.matterIds.length > 0) {
    await cleanupMatterFixtures(prisma, opts.matterIds);
  }
  if (opts.partyIds && opts.partyIds.length > 0) {
    await cleanupPartyFixtures(prisma, opts.partyIds);
  }
  if (opts.courtIds && opts.courtIds.length > 0) {
    await cleanupReferenceFixtures(prisma, { courtIds: opts.courtIds });
  }
}

test.describe('T10 E2E: In-App Reminder Inbox, Worker Failures & Arabic RTL States', () => {
  const runId = randomUUID().slice(0, 6);
  let owner: T04Owner;
  let testPartyId: string;
  let testCourtId: string;

  const createdCourtIds: string[] = [];
  const createdPartyIds: string[] = [];

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: `t10-${runId}`, name: `أحمد المحامي T10 ${runId}` });

    const court = await prisma.court.create({
      data: {
        name: `محكمة استئناف القاهرة T10 ${runId}`,
        code: `T10E-${runId}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testCourtId = court.id;
    createdCourtIds.push(court.id);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `موكل تذكيرات اختبار ${runId}`,
        nameNormalized: `موكل تذكيرات اختبار ${runId}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testPartyId = party.id;
    createdPartyIds.push(party.id);
  });

  test.afterAll(async () => {
    await prisma.workerHeartbeat.deleteMany({ where: { id: 'reminder-worker' } });
    await cleanupScopedT10Data({
      ownerIds: [owner.id],
      partyIds: createdPartyIds,
      courtIds: createdCourtIds,
    });
    await deleteT04Owner(owner.id);
  });

  test('T10-TC-05: Terminal failure retry in browser, mark-read without completing Task/Deadline, filter tabs, and rule save @t10 @inbox', async ({
    page,
  }) => {
    const localMatterIds: string[] = [];
    const localDeadlineIds: string[] = [];
    const localTaskIds: string[] = [];
    const localDeliveryIds: string[] = [];
    const localJobIds: string[] = [];

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-T10-${runId}-05`,
          title: `ملف تذكير الإخفاق والقراءة ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);
      await prisma.matterParty.create({
        data: {
          matterId: matter.id,
          partyId: testPartyId,
          role: 'CLIENT',
          isPrimaryContact: true,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const proceeding = await prisma.proceeding.create({
        data: {
          matterId: matter.id,
          courtId: testCourtId,
          instance: 'FIRST_INSTANCE',
          numberText: `510-${runId}`,
          yearLabel: '2027',
          registerType: 'مدني كلي',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const deadline = await prisma.deadline.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: `موعد مذكرة استئناف حاسم ${runId}`,
          dueDate: new Date(`${formatCairoOffsetYmd(60)}T00:00:00.000Z`),
          source: 'قرار المحكمة بالجلسة',
          basisNotes: 'اعتماد يدوي',
          status: 'CONFIRMED',
          confirmedById: owner.id,
          confirmedByName: owner.name,
          confirmedAt: new Date(),
          version: 2,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localDeadlineIds.push(deadline.id);

      const linkedTask = await prisma.task.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          deadlineId: deadline.id,
          title: `مهمة إعداد المذكرة المرتبطة ${runId}`,
          dueDate: new Date(`${formatCairoOffsetYmd(55)}T00:00:00.000Z`),
          status: 'OPEN',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localTaskIds.push(linkedTask.id);

      const failedJob = await prisma.jobRun.create({
        data: {
          jobType: 'REMINDER_DELIVERY',
          sourceType: 'Deadline',
          sourceId: deadline.id,
          sourceVersion: deadline.version,
          scheduledAt: new Date(`${formatCairoOffsetYmd(53)}T06:00:00.000Z`),
          availableAt: new Date(`${formatCairoOffsetYmd(53)}T06:00:00.000Z`),
          status: 'FAILED',
          attemptCount: 5,
          maxAttempts: 5,
          completedAt: new Date(),
          lastError: 'انقطع الاتصال مؤقتاً بقاعدة البيانات أثناء معالجة التنبيه',
          deduplicationKey: `t10_e2e_failed_${deadline.id}`,
          payload: { deadlineId: deadline.id, version: deadline.version },
        },
      });
      localJobIds.push(failedJob.id);

      const sentDelivery = await prisma.reminderDelivery.create({
        data: {
          sourceType: 'Deadline',
          sourceId: deadline.id,
          sourceVersion: deadline.version,
          ruleKey: 'offset_7',
          scheduledAt: new Date(`${formatCairoOffsetYmd(53)}T06:00:00.000Z`),
          channel: 'IN_APP',
          recipientUserId: owner.id,
          status: 'SENT',
          title: `تذكير بموعد قانوني مؤكد — ${matter.fileCode}`,
          body: `${deadline.title} • ${matter.title} (الساعة غير محددة)`,
          matterId: matter.id,
          deliveredAt: new Date(`${formatCairoOffsetYmd(53)}T06:00:05.000Z`),
          readAt: null,
        },
      });
      localDeliveryIds.push(sentDelivery.id);

      await signInWithTotp(page, owner);
      await page.goto('/inbox');
      await expectShellReady(page);

      await expect(page.getByTestId('worker-health-badge')).toContainText('متعطل');
      await expect(page.getByTestId(`failed-job-card-${failedJob.id}`)).toBeVisible();
      await expect(page.getByTestId(`failed-job-error-${failedJob.id}`)).toContainText(
        'انقطع الاتصال مؤقتاً'
      );

      // Exercise filter tabs while item is unread & non-overdue
      await page.getByTestId('inbox-filter-unread').click();
      await expect(page.getByTestId('inbox-items-heading')).toHaveText('التنبيهات الواردة (1)');
      await expect(page.getByTestId(`inbox-item-${sentDelivery.id}`)).toBeVisible();

      await page.getByTestId('inbox-filter-overdue').click();
      await expect(page.getByTestId('inbox-items-heading')).toHaveText('التنبيهات الواردة (0)');
      await expect(page.getByTestId('inbox-empty-state')).toBeVisible();

      await page.getByTestId('inbox-filter-all').click();
      await expect(page.getByTestId(`inbox-item-${sentDelivery.id}`)).toBeVisible();

      // Deliberate retry resets FAILED job to PENDING
      await page.getByTestId(`retry-failed-job-${failedJob.id}`).click();
      await expect(page.getByTestId('inbox-action-notice')).toContainText(
        'تمت إعادة جدولة مهمة التذكير'
      );
      await expect(page.getByTestId(`failed-job-card-${failedJob.id}`)).toHaveCount(0);

      const jobAfterRetry = await prisma.jobRun.findUniqueOrThrow({ where: { id: failedJob.id } });
      expect(jobAfterRetry.status).toBe('PENDING');
      expect(jobAfterRetry.attemptCount).toBe(0);

      // Mark SENT unread delivery as read
      await expect(page.getByTestId(`inbox-read-badge-${sentDelivery.id}`)).toContainText(
        'غير مقروء'
      );
      await page.getByTestId(`mark-reminder-read-${sentDelivery.id}`).click();
      await expect(page.getByTestId('inbox-action-notice')).toContainText(
        'ولم تتغير حالة المهمة أو الموعد القانوني المرتبط'
      );
      await expect(page.getByTestId(`inbox-read-badge-${sentDelivery.id}`)).toContainText('مقروء');

      // Exercise reminder rule toggle & save via UI, then restore enabled=true
      const taskRule = await prisma.reminderRule.findFirstOrThrow({
        where: { eventType: 'TASK', channel: 'IN_APP' },
      });
      const taskRuleRow = page.getByTestId(`reminder-rule-row-${taskRule.id}`);
      await taskRuleRow.getByRole('checkbox').uncheck();
      await page.getByTestId(`save-rule-${taskRule.id}`).click();
      await expect(page.getByTestId('inbox-action-notice')).toContainText(
        'تم تحديث سياسة التذكير بنجاح.'
      );
      await expect(taskRuleRow).toContainText(`الإصدار ${taskRule.version + 1}`);

      await taskRuleRow.getByRole('checkbox').check();
      await page.getByTestId(`save-rule-${taskRule.id}`).click();
      await expect(taskRuleRow).toContainText(`الإصدار ${taskRule.version + 2}`);

      // Verify DB: status remains SENT, readAt set, Task remains OPEN, Deadline remains CONFIRMED
      const updatedDelivery = await prisma.reminderDelivery.findUniqueOrThrow({
        where: { id: sentDelivery.id },
      });
      expect(updatedDelivery.status).toBe('SENT');
      expect(updatedDelivery.readAt).not.toBeNull();

      const persistedTask = await prisma.task.findUniqueOrThrow({ where: { id: linkedTask.id } });
      expect(persistedTask.status).toBe('OPEN');
      const persistedDeadline = await prisma.deadline.findUniqueOrThrow({
        where: { id: deadline.id },
      });
      expect(persistedDeadline.status).toBe('CONFIRMED');
    } finally {
      await prisma.workerHeartbeat.deleteMany({ where: { id: 'reminder-worker' } });
      await prisma.reminderRule.updateMany({
        where: { eventType: 'TASK', channel: 'IN_APP' },
        data: { enabled: true, dayOffset: 1, reminderTime: '09:00' },
      });
      await cleanupScopedT10Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        deadlineIds: localDeadlineIds,
        taskIds: localTaskIds,
        deliveryIds: localDeliveryIds,
        jobIds: localJobIds,
      });
    }
  });

  test('T10-TC-06: Unauthenticated and MAINTAINER authorization boundaries on /inbox and /api/reminders/* @t10', async ({
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;

    const unauthCtx = await browser.newContext({ baseURL });
    const unauthPage = await unauthCtx.newPage();
    try {
      await unauthPage.goto('/inbox');
      await expect(unauthPage).toHaveURL((u) => u.pathname === '/login');

      const inboxRes = await unauthPage.request.get('/api/reminders/inbox');
      expect(inboxRes.status()).toBe(401);
      expect(inboxRes.headers()['cache-control']).toBe('private, no-store');

      const rulesRes = await unauthPage.request.get('/api/reminders/rules');
      expect(rulesRes.status()).toBe(401);

      const retryRes = await unauthPage.request.post(`/api/reminders/jobs/${randomUUID()}/retry`, {
        headers: { Origin: baseURL, 'Content-Type': 'application/json' },
        data: { idempotencyKey: randomUUID() },
      });
      expect(retryRes.status()).toBe(401);
    } finally {
      await unauthCtx.close();
    }

    // Seed temporary MAINTAINER user
    const maintainerId = randomUUID();
    const maintainerEmail = `t10.maintainer.${runId}.${maintainerId.slice(0, 6)}@office.test`;
    const maintainerPass = `MntT10!${runId}99`;
    const hashed = await hashPassword(maintainerPass);
    const { pool } = createValidatedTestPool();
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, false, NOW(), NOW())',
        [maintainerId, 'مسؤول الصيانة T10', maintainerEmail, 'MAINTAINER']
      );
      await client.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [randomUUID(), maintainerId, 'credential', maintainerId, hashed]
      );
    } finally {
      client.release();
      await pool.end();
    }

    const maintCtx = await browser.newContext({ baseURL });
    const maintPage = await maintCtx.newPage();
    try {
      await maintPage.goto('/login');
      await maintPage.locator('#email').fill(maintainerEmail);
      await maintPage.locator('#password').fill(maintainerPass);
      await maintPage.locator('button[type="submit"]').click();
      await expect(maintPage).not.toHaveURL(/\/login(?:[/?]|$)/);

      await maintPage.goto('/inbox');
      await expect(maintPage.getByRole('heading', { level: 1 })).toHaveText('وصول مرفوض');
      await expect(maintPage.getByTestId('app-header')).toBeVisible();
      await expect(maintPage.getByTestId('header-notifications-button')).toHaveCount(0);

      const maintInboxApi = await maintPage.request.get('/api/reminders/inbox');
      expect(maintInboxApi.status()).toBe(403);

      const maintRulesApi = await maintPage.request.get('/api/reminders/rules');
      expect(maintRulesApi.status()).toBe(403);

      const maintReadApi = await maintPage.request.post(
        `/api/reminders/inbox/${randomUUID()}/read`,
        {
          headers: { Origin: baseURL, 'Content-Type': 'application/json' },
          data: {},
        }
      );
      expect(maintReadApi.status()).toBe(403);

      const maintRetryApi = await maintPage.request.post(
        `/api/reminders/jobs/${randomUUID()}/retry`,
        {
          headers: { Origin: baseURL, 'Content-Type': 'application/json' },
          data: { idempotencyKey: randomUUID() },
        }
      );
      expect(maintRetryApi.status()).toBe(403);

      const maintPatchRulesApi = await maintPage.request.patch('/api/reminders/rules', {
        headers: { Origin: baseURL, 'Content-Type': 'application/json' },
        data: {
          ruleId: randomUUID(),
          expectedVersion: 1,
          enabled: false,
          idempotencyKey: randomUUID(),
        },
      });
      expect(maintPatchRulesApi.status()).toBe(403);
    } finally {
      await maintCtx.close();
      const { pool: cleanupPool } = createValidatedTestPool();
      try {
        await cleanupTrackedFixtures(cleanupPool, { userIds: [maintainerId] });
      } finally {
        await cleanupPool.end();
      }
    }
  });

  test('T10-TC-07: Inbox renders unread, overdue, and failed states at 390/768/1440px, 200% zoom, connectivity loss, and stale refresh recovery @t10 @inbox @responsive @a11y', async ({
    page,
  }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1440;
    const tag = `${runId}-w${width}`;
    const secretMatterTitle = `ملف سري لاختبار الصندوق ${tag}`;
    const secretOverdueTitle = `موعد متأخر سري ${tag}`;

    const localMatterIds: string[] = [];
    const localDeadlineIds: string[] = [];
    const localDeliveryIds: string[] = [];
    const localJobIds: string[] = [];

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-${tag}`,
          title: secretMatterTitle,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const proceeding = await prisma.proceeding.create({
        data: {
          matterId: matter.id,
          courtId: testCourtId,
          instance: 'FIRST_INSTANCE',
          numberText: `777-${width}`,
          yearLabel: '2027',
          registerType: 'مدني كلي',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const overdueDeadline = await prisma.deadline.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: secretOverdueTitle,
          dueDate: new Date(`${formatCairoOffsetYmd(-10)}T00:00:00.000Z`),
          source: 'قرار المحكمة',
          basisNotes: 'تاريخ منقضي للاختبار',
          status: 'CONFIRMED',
          confirmedById: owner.id,
          confirmedByName: owner.name,
          confirmedAt: new Date(),
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localDeadlineIds.push(overdueDeadline.id);

      const overdueDelivery = await prisma.reminderDelivery.create({
        data: {
          sourceType: 'Deadline',
          sourceId: overdueDeadline.id,
          sourceVersion: 1,
          ruleKey: 'offset_1',
          scheduledAt: new Date(`${formatCairoOffsetYmd(-11)}T07:00:00.000Z`),
          channel: 'IN_APP',
          recipientUserId: owner.id,
          status: 'SENT',
          title: `تذكير بموعد قانوني متأخر — ${matter.fileCode}`,
          body: `${secretOverdueTitle} • ${secretMatterTitle}`,
          matterId: matter.id,
          deliveredAt: new Date(`${formatCairoOffsetYmd(-10)}T12:00:00.000Z`), // late delivery -> missed & overdue
          readAt: null,
        },
      });
      localDeliveryIds.push(overdueDelivery.id);

      const failedJob = await prisma.jobRun.create({
        data: {
          jobType: 'REMINDER_DELIVERY',
          sourceType: 'Deadline',
          sourceId: overdueDeadline.id,
          sourceVersion: 1,
          scheduledAt: new Date(`${formatCairoOffsetYmd(-17)}T07:00:00.000Z`),
          availableAt: new Date(`${formatCairoOffsetYmd(-17)}T07:00:00.000Z`),
          status: 'FAILED',
          attemptCount: 5,
          maxAttempts: 5,
          completedAt: new Date(),
          lastError: 'فشل مؤقت بعد استنفاد محاولات الإرسال',
          deduplicationKey: `t10_tc07_fail_${tag}`,
          payload: { deadlineId: overdueDeadline.id },
        },
      });
      localJobIds.push(failedJob.id);

      await prisma.workerHeartbeat.upsert({
        where: { id: 'reminder-worker' },
        create: {
          id: 'reminder-worker',
          workerId: `worker-e2e-${tag}`,
          lastPollAt: new Date(),
          lastErrorAt: new Date(),
          lastError: 'فشل مؤقت بعد استنفاد محاولات الإرسال',
          restoreMode: false,
        },
        update: {
          workerId: `worker-e2e-${tag}`,
          lastPollAt: new Date(),
          lastErrorAt: new Date(),
          lastError: 'فشل مؤقت بعد استنفاد محاولات الإرسال',
          restoreMode: false,
        },
      });

      await signInWithTotp(page, owner);

      // Verify /today links truthfully to /inbox
      await page.goto('/today');
      await expectShellReady(page);
      await expect(page.getByTestId('today-inbox-link')).toBeVisible();
      await page.getByTestId('today-inbox-link').click();
      await expect(page).toHaveURL(/\/inbox$/);

      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
      await expect(page.getByTestId('inbox-view')).toBeVisible();
      await expect(page.getByTestId('worker-health-badge')).toBeVisible();
      await expect(page.getByTestId('inbox-last-refresh')).toBeVisible();

      // Confirm clean fixture isolation: exactly (1) inbox item and (1) failed job
      await expect(page.getByTestId('inbox-items-heading')).toHaveText('التنبيهات الواردة (1)');
      await expect(page.getByTestId('inbox-failed-jobs-section')).toContainText(
        'مهام تذكير متعثرة (1)'
      );

      const limitNotice = page.getByTestId('inbox-delivery-limit-notice');
      await expect(limitNotice).toBeVisible();
      await expect(limitNotice).toContainText('إغلاق التطبيق');
      await expect(limitNotice).toContainText('انقطاع الاتصال');

      await expect(page.getByTestId(`inbox-item-${overdueDelivery.id}`)).toBeVisible();
      await expect(page.getByTestId(`inbox-overdue-badge-${overdueDelivery.id}`)).toBeVisible();
      await expect(page.getByTestId(`failed-job-card-${failedJob.id}`)).toBeVisible();

      // Keyboard focus indicator check on inbox refresh button
      const refreshBtn = page.getByTestId('inbox-refresh-button');
      await page.getByRole('link', { name: 'العودة إلى اليوم' }).focus();
      await page.keyboard.press('Shift+Tab');
      await expect(refreshBtn).toBeFocused();
      const focusRingStyle = await refreshBtn.evaluate((el) => {
        const s = getComputedStyle(el);
        return { boxShadow: s.boxShadow, outlineStyle: s.outlineStyle };
      });
      expect(
        focusRingStyle.boxShadow !== 'none' || focusRingStyle.outlineStyle !== 'none'
      ).toBe(true);

      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      const inboxScreenshotPath = testInfo.outputPath(`t10-inbox-${width}.png`);
      await page.screenshot({
        path: inboxScreenshotPath,
        fullPage: true,
      });
      await testInfo.attach(`t10-inbox-${width}`, {
        path: inboxScreenshotPath,
        contentType: 'image/png',
      });

      // 200% font scale reflow check
      const baselineFontSize = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      );
      await page.addStyleTag({
        content: `html { font-size: ${baselineFontSize * 2}px !important; }`,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await nextPaint(page);
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      // Reload normal scale for connectivity & stale refresh retry test
      await page.reload();
      await expectShellReady(page);
      const beforeRefreshIso = await page
        .getByTestId('inbox-last-refresh')
        .getAttribute('data-refreshed-at');

      // Simulate connectivity loss during refresh
      await page.route('**/api/reminders/inbox*', (route) => route.abort('failed'));
      await page.context().setOffline(true);
      await expect(page.getByTestId('connectivity-banner')).toBeVisible();

      await page.getByTestId('inbox-refresh-button').click();
      await expect(page.getByTestId('inbox-refresh-error')).toBeVisible();
      await expect(page.getByTestId('inbox-error-retry-button')).toBeVisible();
      // Existing items remain visible on screen instead of disappearing into blank page
      await expect(page.getByTestId(`inbox-item-${overdueDelivery.id}`)).toBeVisible();

      // Restore connection & retry refresh cleanly and confirm last-refresh timestamp updates
      await page.context().setOffline(false);
      await page.unroute('**/api/reminders/inbox*');
      expect(beforeRefreshIso).toBeTruthy();
      await Promise.all([
        page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === '/api/reminders/inbox' && res.status() === 200
        ),
        page.getByTestId('inbox-error-retry-button').click(),
      ]);
      await expect(page.getByTestId('inbox-refresh-error')).toBeHidden();
      await expect(page.getByTestId(`inbox-item-${overdueDelivery.id}`)).toBeVisible();
      await expect(page.getByTestId('inbox-last-refresh')).not.toHaveAttribute(
        'data-refreshed-at',
        beforeRefreshIso!
      );

      const afterRefreshIso = await page
        .getByTestId('inbox-last-refresh')
        .getAttribute('data-refreshed-at');
      expect(afterRefreshIso).toBeTruthy();
      expect(afterRefreshIso).not.toBe(beforeRefreshIso);

      // Privacy & cookie hardening assertions
      const cookies = await snapshotCookies(page);
      expectSessionCookiesHardened(cookies);
      const storage = await snapshotStorage(page);
      const rawCookies = await page.context().cookies();
      const needles = [
        ...sensitiveNeedles(owner, rawCookies),
        { label: 'secret matter title', value: secretMatterTitle },
        { label: 'secret overdue title', value: secretOverdueTitle },
      ];
      expectNoSensitiveValues(storage, needles);
    } finally {
      await prisma.workerHeartbeat.deleteMany({ where: { id: 'reminder-worker' } });
      await cleanupScopedT10Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        deadlineIds: localDeadlineIds,
        deliveryIds: localDeliveryIds,
        jobIds: localJobIds,
      });
    }
  });

  test('Header notification bell popover replaces sidebar link, marks read, links to /inbox, and stays within viewport at 390/768/1440px @t10 @inbox @responsive', async ({
    page,
  }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1440;
    const tag = `${runId}-hdr-${width}`;
    const localMatterIds: string[] = [];
    const localDeadlineIds: string[] = [];
    const localDeliveryIds: string[] = [];

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-${tag}`,
          title: `ملف جرس التنبيهات ${tag}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const proceeding = await prisma.proceeding.create({
        data: {
          matterId: matter.id,
          courtId: testCourtId,
          instance: 'FIRST_INSTANCE',
          numberText: `888-${width}`,
          yearLabel: '2027',
          registerType: 'مدني كلي',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const deadline = await prisma.deadline.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: `موعد تذكير الجرس ${tag}`,
          dueDate: new Date(`${formatCairoOffsetYmd(45)}T00:00:00.000Z`),
          source: 'قرار المحكمة',
          basisNotes: 'اختبار قائمة الهيدر',
          status: 'CONFIRMED',
          confirmedById: owner.id,
          confirmedByName: owner.name,
          confirmedAt: new Date(),
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localDeadlineIds.push(deadline.id);

      const sentDelivery = await prisma.reminderDelivery.create({
        data: {
          sourceType: 'Deadline',
          sourceId: deadline.id,
          sourceVersion: 1,
          ruleKey: 'offset_1',
          scheduledAt: new Date(`${formatCairoOffsetYmd(44)}T06:00:00.000Z`),
          channel: 'IN_APP',
          recipientUserId: owner.id,
          status: 'SENT',
          title: `تذكير عبر الجرس — ${matter.fileCode}`,
          body: `${deadline.title} • ${matter.title}`,
          matterId: matter.id,
          deliveredAt: new Date(`${formatCairoOffsetYmd(44)}T06:00:05.000Z`),
          readAt: null,
        },
      });
      localDeliveryIds.push(sentDelivery.id);

      await signInWithTotp(page, owner);
      await page.goto('/today');
      await expectShellReady(page);

      // Sidebar/drawer must no longer contain nav-link-inbox
      await expect(page.getByTestId('nav-link-inbox')).toHaveCount(0);
      if (width < 1024) {
        await page.getByTestId('drawer-toggle-button').click();
        const drawer = page.getByTestId('tablet-drawer');
        await expect(drawer).toBeVisible();
        await expect(drawer.getByTestId('nav-link-inbox')).toHaveCount(0);
        await page.getByTestId('drawer-close-button').click();
        await expect(drawer).toHaveCount(0);
      }

      const bellButton = page.getByTestId('header-notifications-button');
      await expect(bellButton).toBeVisible();
      await expect(page.getByTestId('header-notifications-badge')).toHaveText('1');

      await bellButton.click();
      const popover = page.getByTestId('header-notifications-popover');
      await expect(popover).toBeVisible();
      await expect(page.getByTestId(`header-notification-item-${sentDelivery.id}`)).toBeVisible();

      // Zero horizontal overflow while popover is open at 390/768/1440px
      await expectNoPageOverflow(page);
      const popoverBox = await popover.boundingBox();
      expect(popoverBox).not.toBeNull();
      expect(popoverBox!.x).toBeGreaterThanOrEqual(-1);
      expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(width + 1);

      // Mark read directly from the header popover
      await page.getByTestId(`header-notification-read-${sentDelivery.id}`).click();
      await expect(page.getByTestId(`header-notification-read-${sentDelivery.id}`)).toHaveCount(0);
      await expect(page.getByTestId('header-notifications-badge')).toHaveCount(0);

      const persisted = await prisma.reminderDelivery.findUniqueOrThrow({
        where: { id: sentDelivery.id },
      });
      expect(persisted.status).toBe('SENT');
      expect(persisted.readAt).not.toBeNull();

      // Escape closes the popover and returns focus to bell button
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(bellButton).toBeFocused();

      // Settings footer link inside popover still navigates to /inbox
      await bellButton.click();
      await expect(popover).toBeVisible();
      await page.getByTestId('header-notifications-settings-link').click();
      await expect(page).toHaveURL(/\/inbox$/);
      await expect(popover).toHaveCount(0);
    } finally {
      await cleanupScopedT10Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        deadlineIds: localDeadlineIds,
        deliveryIds: localDeliveryIds,
      });
    }
  });
});
