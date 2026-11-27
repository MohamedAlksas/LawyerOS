import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { getPrismaClient } from '@/lib/auth';
import { getCairoTodayDateString } from '@/lib/cairo-date';
import { seedT04Owner, deleteT04Owner, signInWithTotp, type T04Owner } from '../helpers/t04-auth';
import { cleanupTrackedFixtures, createValidatedTestPool } from '../helpers/test-db';
import { setupTestEncryptionKeys, cleanupPartyFixtures } from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { formatCairoOffsetYmd } from '../helpers/cairo-test-date';
import {
  expectNoElementOverflow,
  expectNoPageOverflow,
  expectShellReady,
  expectVisibleFocus,
  nextPaint,
  tabToTestId,
} from '../helpers/t04-layout';
import {
  expectNoSensitiveValues,
  expectSessionCookiesHardened,
  sensitiveNeedles,
  snapshotCookies,
  snapshotStorage,
} from '../helpers/t04-storage';

/**
 * T09 E2E Browser Test Suite: Manually Confirmed Deadlines, Tasks, and Cairo Agenda.
 *
 * Covers browser & HTTP acceptance cases:
 * - T09-TC-01: Draft deadline without date -> validation -> manual lawyer confirmation + audit/outbox
 * - T09-TC-03: Undated task, time-without-day rejection, task completion leaves deadline open,
 *              deadline completion requires execution description/date + audit
 * - T09-TC-04: Cairo DST (2027-04-30) & midnight boundary (2026-04-23/24), unknown-time & undated groups,
 *              overdue deadlines across Africa/Cairo and America/New_York browser profiles
 * - T09-TC-06: Auth boundaries (unauthenticated & MAINTAINER blocked), Matter detail tab,
 *              populated/empty/offline/error states, keyboard accessibility, 200% scale reflow,
 *              390/768/1440 responsive screenshots, print view, and browser storage privacy
 */

const prisma = getPrismaClient();

async function cleanupScopedT09Data(opts: {
  ownerIds?: string[];
  matterIds?: string[];
  partyIds?: string[];
  courtIds?: string[];
  taskIds?: string[];
  deadlineIds?: string[];
  hearingIds?: string[];
}) {
  const deadlineIds = new Set(opts.deadlineIds ?? []);
  const taskIds = new Set(opts.taskIds ?? []);
  const hearingIds = new Set(opts.hearingIds ?? []);
  const matterIds = opts.matterIds ?? [];

  if (matterIds.length > 0) {
    const matterDeadlines = await prisma.deadline.findMany({
      where: { matterId: { in: matterIds } },
      select: { id: true },
    });
    for (const d of matterDeadlines) deadlineIds.add(d.id);

    const matterTasks = await prisma.task.findMany({
      where: { matterId: { in: matterIds } },
      select: { id: true },
    });
    for (const t of matterTasks) taskIds.add(t.id);

    const matterHearings = await prisma.hearing.findMany({
      where: { proceeding: { matterId: { in: matterIds } } },
      select: { id: true },
    });
    for (const h of matterHearings) hearingIds.add(h.id);
  }

  const allDeadlineIds = Array.from(deadlineIds);
  const allTaskIds = Array.from(taskIds);
  const allHearingIds = Array.from(hearingIds);

  if (allDeadlineIds.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { sourceType: 'Deadline', sourceId: { in: allDeadlineIds } },
    });
  }
  if (allHearingIds.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { sourceType: 'Hearing', sourceId: { in: allHearingIds } },
    });
  }

  const entityIds = [...allDeadlineIds, ...allTaskIds, ...allHearingIds, ...matterIds];
  if (entityIds.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: { entityId: { in: entityIds } },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: { resultId: { in: entityIds } },
    });
  }

  if (opts.ownerIds && opts.ownerIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({
      where: { actorId: { in: opts.ownerIds } },
    });
    await prisma.auditEvent.deleteMany({
      where: { userId: { in: opts.ownerIds } },
    });
  }

  if (allTaskIds.length > 0) {
    await prisma.task.deleteMany({ where: { id: { in: allTaskIds } } });
  }
  if (allDeadlineIds.length > 0) {
    await prisma.deadline.deleteMany({ where: { id: { in: allDeadlineIds } } });
  }

  if (matterIds.length > 0) {
    await cleanupMatterFixtures(prisma, matterIds);
  }
  if (opts.partyIds && opts.partyIds.length > 0) {
    await cleanupPartyFixtures(prisma, opts.partyIds);
  }
  if (opts.courtIds && opts.courtIds.length > 0) {
    await cleanupReferenceFixtures(prisma, { courtIds: opts.courtIds });
  }
}

async function seedOwnedMatterAndProceeding(params: {
  ownerId: string;
  partyId: string;
  courtId: string;
  fileCode: string;
  title: string;
  numberText?: string | null;
  yearLabel?: string | null;
}) {
  const matter = await prisma.matter.create({
    data: {
      fileCode: params.fileCode,
      title: params.title,
      titleNormalized: params.title,
      kind: 'LITIGATION',
      status: 'ACTIVE',
      createdById: params.ownerId,
      updatedById: params.ownerId,
      parties: {
        create: {
          partyId: params.partyId,
          role: 'CLIENT',
          isPrimaryContact: true,
          createdById: params.ownerId,
          updatedById: params.ownerId,
        },
      },
    },
  });

  const proceeding = await prisma.proceeding.create({
    data: {
      matterId: matter.id,
      courtId: params.courtId,
      instance: 'FIRST_INSTANCE',
      numberText: params.numberText === undefined ? '501' : params.numberText,
      yearLabel: params.yearLabel === undefined ? '2027' : params.yearLabel,
      registerType: 'مدني كلي',
      status: 'ACTIVE',
      createdById: params.ownerId,
      updatedById: params.ownerId,
    },
  });

  return { matter, proceeding };
}

test.describe('T09 Deadlines, Tasks & Cairo Agenda E2E Tests', () => {
  let owner: T04Owner;
  let testCourtId: string;
  let testPartyId: string;

  const runId = randomUUID().slice(0, 6);
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdDeadlineIds: string[] = [];

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: `t09-${runId}`, name: `أحمد المحامي ${runId}` });

    const court = await prisma.court.create({
      data: {
        name: `محكمة شمال القاهرة الابتدائية ${runId}`,
        code: `NC-E2E-${runId.toUpperCase()}`,
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
        name: `محمود عبد الحميد السري ${runId}`,
        nameNormalized: `محمود عبد الحميد السري ${runId}`,
        primaryPhone: `010${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '7')}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testPartyId = party.id;
    createdPartyIds.push(party.id);
  });

  test.afterAll(async () => {
    await cleanupScopedT09Data({
      ownerIds: [owner.id],
      matterIds: createdMatterIds,
      partyIds: createdPartyIds,
      courtIds: createdCourtIds,
      taskIds: createdTaskIds,
      deadlineIds: createdDeadlineIds,
    });
    await deleteT04Owner(owner.id);
  });

  /**
   * T09-TC-01: A Matter and a draft deadline without a date.
   * Incomplete draft has no confirmed reminder work. Valid confirmation records
   * reviewer, timestamp, audit, and moves item to the confirmed group.
   */
  test('T09-TC-01: Draft deadline validation and explicit manual confirmation @t09 @deadlines', async ({
    page,
  }) => {
    const { matter, proceeding } = await seedOwnedMatterAndProceeding({
      ownerId: owner.id,
      partyId: testPartyId,
      courtId: testCourtId,
      fileCode: `LO-2027-${runId}-TC01`,
      title: `قضية اختبار اعتماد الميعاد ${runId}`,
    });
    createdMatterIds.push(matter.id);

    const draftDeadline = await prisma.deadline.create({
      data: {
        matterId: matter.id,
        proceedingId: proceeding.id,
        title: `آخر ميعاد لإيداع صحيفة الاستئناف ${runId}`,
        dueDate: null,
        dueTime: null,
        source: null,
        basisNotes: null,
        status: 'DRAFT',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDeadlineIds.push(draftDeadline.id);

    expect(
      await prisma.jobRun.count({
        where: { sourceType: 'Deadline', sourceId: draftDeadline.id, status: 'PENDING' },
      })
    ).toBe(0);

    await signInWithTotp(page, owner);
    await page.goto('/deadlines');

    const draftSection = page.getByTestId('deadlines-draft-section');
    const confirmedSection = page.getByTestId('deadlines-confirmed-section');

    await expect(draftSection.getByTestId(`deadline-card-${draftDeadline.id}`)).toBeVisible();
    await expect(page.getByTestId(`deadline-status-badge-${draftDeadline.id}`)).toHaveText(
      'مسودة تحتاج مراجعة'
    );

    await page.getByTestId(`open-deadline-button-${draftDeadline.id}`).click();
    const confirmBtn = page.getByTestId('confirm-deadline-button');
    await expect(confirmBtn).toHaveText('راجعت الموعد واعتمدته');

    // Missing date -> rejected
    await confirmBtn.click();
    await expect(page.getByTestId('deadline-form-error')).toContainText(
      'التاريخ النهائي للموعد القانوني مطلوب للاعتماد'
    );

    // Fill date, missing source -> rejected
    await page.getByTestId('deadline-date-input').fill(formatCairoOffsetYmd(30));
    await confirmBtn.click();
    await expect(page.getByTestId('deadline-form-error')).toContainText(
      'مصدر الموعد القانوني مطلوب للاعتماد'
    );

    // Fill source, missing basis -> rejected
    await page.getByTestId('deadline-source-input').fill('إعلان الحكم الحضوري بجلسة المرافعة');
    await confirmBtn.click();
    await expect(page.getByTestId('deadline-form-error')).toContainText(
      'سند الاحتساب وملاحظات المراجعة مطلوبة للاعتماد'
    );

    // Fill basis, missing explicit review checkbox -> rejected
    await page
      .getByTestId('deadline-basis-input')
      .fill('أربعون يوماً من تاريخ صدور الحكم طبقاً للمادة 227 مرافعات');
    await confirmBtn.click();
    await expect(page.getByTestId('deadline-form-error')).toContainText(
      'راجعت الموعد واعتمدته'
    );

    expect(
      await prisma.jobRun.count({
        where: { sourceType: 'Deadline', sourceId: draftDeadline.id, status: 'PENDING' },
      })
    ).toBe(0);

    // Explicit lawyer confirmation
    await page.getByTestId('deadline-review-checkbox').check();
    await confirmBtn.click();

    await expect(page.getByTestId('deadline-status-notice')).toContainText(
      'تمت مراجعة الموعد القانوني واعتماده'
    );
    await expect(draftSection.getByTestId(`deadline-card-${draftDeadline.id}`)).toHaveCount(0);
    await expect(confirmedSection.getByTestId(`deadline-card-${draftDeadline.id}`)).toBeVisible();
    await expect(page.getByTestId(`deadline-status-badge-${draftDeadline.id}`)).toHaveText('مؤكد');
    await expect(page.getByTestId(`deadline-reviewer-meta-${draftDeadline.id}`)).toContainText(
      owner.name
    );

    const updated = await prisma.deadline.findUniqueOrThrow({ where: { id: draftDeadline.id } });
    expect(updated.status).toBe('CONFIRMED');
    expect(updated.dueDate?.toISOString().slice(0, 10)).toBe(formatCairoOffsetYmd(30));
    expect(updated.confirmedById).toBe(owner.id);
    expect(updated.confirmedByName).toBe(owner.name);
    expect(updated.confirmedAt).not.toBeNull();
    expect(updated.version).toBe(2);

    expect(
      await prisma.auditEvent.count({
        where: { entityType: 'Deadline', entityId: draftDeadline.id, action: 'CONFIRM_DEADLINE' },
      })
    ).toBe(1);
    expect(
      await prisma.jobRun.count({
        where: { sourceType: 'Deadline', sourceId: draftDeadline.id, status: 'PENDING' },
      })
    ).toBe(1);
  });

  /**
   * T09-TC-03: Standalone task and separate confirmed deadline on one Matter.
   * Undated task saves; task time without day fails; completing task leaves deadline open;
   * completing deadline requires execution description/date and writes audit.
   */
  test('T09-TC-03: Task creation/completion independence and explicit deadline completion @t09 @tasks', async ({
    page,
  }) => {
    const { matter, proceeding } = await seedOwnedMatterAndProceeding({
      ownerId: owner.id,
      partyId: testPartyId,
      courtId: testCourtId,
      fileCode: `LO-2027-${runId}-TC03`,
      title: `قضية فصل المهام عن المواعيد ${runId}`,
    });
    createdMatterIds.push(matter.id);

    const confirmedDeadline = await prisma.deadline.create({
      data: {
        matterId: matter.id,
        proceedingId: proceeding.id,
        title: `تقديم مذكرة الرد النهائية ${runId}`,
        dueDate: new Date(`${formatCairoOffsetYmd(40)}T00:00:00.000Z`),
        dueTime: null,
        source: 'قرار المحكمة بالجلسة السابقة',
        basisNotes: 'أجل مسجل بمحضر الجلسة',
        status: 'CONFIRMED',
        confirmedById: owner.id,
        confirmedByName: owner.name,
        confirmedAt: new Date(),
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDeadlineIds.push(confirmedDeadline.id);

    await prisma.jobRun.create({
      data: {
        jobType: 'REMINDER_DELIVERY',
        sourceType: 'Deadline',
        sourceId: confirmedDeadline.id,
        scheduledAt: new Date(`${formatCairoOffsetYmd(40)}T00:00:00.000Z`),
        status: 'PENDING',
        deduplicationKey: `t09_tc03_${confirmedDeadline.id}`,
        payload: { deadlineId: confirmedDeadline.id },
      },
    });

    await signInWithTotp(page, owner);
    await page.goto('/tasks');

    const taskTitle = `مهمة تجهيز حافظة مستندات بدون تاريخ ${runId}`;
    await page.getByTestId('new-task-button').click();
    await page.getByTestId('task-title-input').fill(taskTitle);
    await page.getByTestId('task-matter-select').selectOption(matter.id);

    // Reject time without day
    await page.getByTestId('task-due-time-input').fill('11:30');
    await page.getByTestId('task-submit-button').click();
    await expect(page.getByTestId('task-form-error')).toContainText(
      'لا يمكن تحديد وقت بدون تحديد التاريخ'
    );

    // Clear time and save undated task
    await page.getByTestId('task-due-time-input').fill('');
    await page.getByTestId('task-submit-button').click();
    await expect(page.getByTestId('task-status-notice')).toContainText('تم حفظ المهمة بنجاح');

    const createdTask = await prisma.task.findFirstOrThrow({
      where: { matterId: matter.id, title: taskTitle },
    });
    createdTaskIds.push(createdTask.id);
    expect(createdTask.dueDate).toBeNull();
    expect(createdTask.dueTime).toBeNull();
    expect(createdTask.status).toBe('OPEN');

    const taskCard = page.getByTestId(`task-card-${createdTask.id}`);
    await expect(taskCard).toBeVisible();
    await expect(taskCard).toContainText('بدون تاريخ استحقاق محدد');

    // Complete task -> must leave confirmed deadline OPEN (CONFIRMED)
    await page.getByTestId(`complete-task-button-${createdTask.id}`).click();
    await expect(page.getByTestId('task-status-notice')).toContainText('تم تسجيل إتمام المهمة');
    await expect(page.getByTestId(`task-status-badge-${createdTask.id}`)).toHaveText('تمت');

    const completedTaskDb = await prisma.task.findUniqueOrThrow({ where: { id: createdTask.id } });
    expect(completedTaskDb.status).toBe('DONE');
    const deadlineAfterTaskDb = await prisma.deadline.findUniqueOrThrow({
      where: { id: confirmedDeadline.id },
    });
    expect(deadlineAfterTaskDb.status).toBe('CONFIRMED');

    // Open Deadlines -> verify still CONFIRMED, try incomplete completion, then valid completion
    await page.goto('/deadlines');
    const confirmedSection = page.getByTestId('deadlines-confirmed-section');
    const completedSection = page.getByTestId('deadlines-completed-section');
    await expect(confirmedSection.getByTestId(`deadline-card-${confirmedDeadline.id}`)).toBeVisible();

    await page.getByTestId(`complete-deadline-button-${confirmedDeadline.id}`).click();
    await page.getByTestId('deadline-completion-submit-button').click();
    await expect(page.getByTestId('deadline-completion-error')).toContainText(
      'وصف الإجراء التنفيذي'
    );

    await page.getByTestId('deadline-completion-date-input').fill('');
    await page
      .getByTestId('deadline-completion-notes-input')
      .fill('تم إيداع المذكرة بالسكرتارية برقم 412');
    await page.getByTestId('deadline-completion-submit-button').click();
    await expect(page.getByTestId('deadline-completion-error')).toContainText(
      'تاريخ تنفيذ الإجراء القانوني مطلوب'
    );

    await page.getByTestId('deadline-completion-date-input').fill(formatCairoOffsetYmd(35));
    await page.getByTestId('deadline-completion-submit-button').click();

    await expect(completedSection.getByTestId(`deadline-card-${confirmedDeadline.id}`)).toBeVisible();
    await expect(page.getByTestId(`deadline-status-badge-${confirmedDeadline.id}`)).toHaveText(
      'تم الإجراء'
    );

    const finalDeadline = await prisma.deadline.findUniqueOrThrow({
      where: { id: confirmedDeadline.id },
    });
    expect(finalDeadline.status).toBe('COMPLETED');
    expect(finalDeadline.completedDate?.toISOString().slice(0, 10)).toBe(formatCairoOffsetYmd(35));
    expect(finalDeadline.completionDescription).toBe('تم إيداع المذكرة بالسكرتارية برقم 412');
    expect(finalDeadline.completedById).toBe(owner.id);

    expect(
      await prisma.auditEvent.count({
        where: {
          entityType: 'Deadline',
          entityId: confirmedDeadline.id,
          action: 'COMPLETE_DEADLINE',
        },
      })
    ).toBe(1);
    expect(
      await prisma.jobRun.count({
        where: { sourceType: 'Deadline', sourceId: confirmedDeadline.id, status: 'PENDING' },
      })
    ).toBe(0);
  });

  /**
   * T09-TC-04: Cairo DST transition (2027-04-30) & midnight boundary (2026-04-23/24)
   * across both Africa/Cairo and America/New_York browser timezone profiles.
   */
  test('T09-TC-04: Cairo DST & midnight boundaries align identically in Cairo and NY browsers @dst @timezone', async ({
    page,
  }, testInfo) => {
    const profileTag = testInfo.project.name.replace(/[^a-z0-9]/gi, '');
    const localMatters: string[] = [];
    const localTasks: string[] = [];
    const localDeadlines: string[] = [];
    const localHearings: string[] = [];

    try {
      const cairoToday = getCairoTodayDateString();
      const { matter, proceeding } = await seedOwnedMatterAndProceeding({
        ownerId: owner.id,
        partyId: testPartyId,
        courtId: testCourtId,
        fileCode: `LO-2027-${runId}-${profileTag}`,
        title: `قضية التوقيت الصيفي ومنتصف الليل ${runId} ${profileTag}`,
      });
      localMatters.push(matter.id);

      const timedDstHearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date('2027-04-30T00:00:00.000Z'),
          hearingTime: '09:30',
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const untimedDstHearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date('2027-04-30T00:00:00.000Z'),
          hearingTime: null,
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const midnightBeforeHearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date('2026-04-23T00:00:00.000Z'),
          hearingTime: '23:59',
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const midnightAfterHearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date('2026-04-24T00:00:00.000Z'),
          hearingTime: '00:01',
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const todayUntimedHearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date(`${cairoToday}T00:00:00.000Z`),
          hearingTime: null,
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localHearings.push(
        timedDstHearing.id,
        untimedDstHearing.id,
        midnightBeforeHearing.id,
        midnightAfterHearing.id,
        todayUntimedHearing.id
      );

      const dstConfirmedDeadline = await prisma.deadline.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: `موعد انتقال التوقيت الصيفي ${profileTag}`,
          dueDate: new Date('2027-04-30T00:00:00.000Z'),
          dueTime: null,
          source: 'سجل المواعيد',
          basisNotes: 'تاريخ يدوي صريح',
          status: 'CONFIRMED',
          confirmedById: owner.id,
          confirmedByName: owner.name,
          confirmedAt: new Date(),
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const overdueDeadline = await prisma.deadline.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: `موعد متأخر حدود منتصف الليل ${profileTag}`,
          dueDate: new Date('2026-04-23T00:00:00.000Z'),
          dueTime: '23:59',
          source: 'حكم سابق',
          basisNotes: 'موعد مؤكد منقضي التاريخ',
          status: 'CONFIRMED',
          confirmedById: owner.id,
          confirmedByName: owner.name,
          confirmedAt: new Date(),
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localDeadlines.push(dstConfirmedDeadline.id, overdueDeadline.id);

      const undatedTask = await prisma.task.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: `مهمة بدون تاريخ لاختبار الأجندة ${profileTag}`,
          dueDate: null,
          dueTime: null,
          priority: 'HIGH',
          status: 'OPEN',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localTasks.push(undatedTask.id);

      await signInWithTotp(page, owner);

      // 1. Agenda Day View on 2027-04-30 (Cairo DST transition date)
      await page.goto('/agenda?view=day&anchorDate=2027-04-30');
      await expect(page.getByTestId(`agenda-item-hearing-${timedDstHearing.id}`)).toBeVisible();

      const unknownGroup = page.getByTestId('agenda-unknown-time-group');
      await expect(unknownGroup).toBeVisible();
      await expect(
        unknownGroup.getByTestId(`agenda-item-hearing-${untimedDstHearing.id}`)
      ).toBeVisible();
      await expect(
        unknownGroup.getByTestId(`hearing-unknown-time-${untimedDstHearing.id}`)
      ).toHaveText('الساعة غير محددة');
      await expect(
        unknownGroup.getByTestId(`agenda-item-hearing-${timedDstHearing.id}`)
      ).toHaveCount(0);
      await expect(
        unknownGroup.getByTestId(`agenda-item-deadline-${dstConfirmedDeadline.id}`)
      ).toBeVisible();

      await expect(page.getByTestId(`deadline-overdue-badge-${overdueDeadline.id}`)).toBeVisible();
      const undatedGroup = page.getByTestId('agenda-undated-tasks-group');
      await expect(undatedGroup).toBeVisible();
      await expect(undatedGroup.getByTestId(`agenda-item-task-${undatedTask.id}`)).toBeVisible();

      // 2. Switch to Week View -> must stay on 2027-04-30 (never shift to 2027-04-29 in NY)
      await page.getByTestId('agenda-view-week').click();
      const dstWeekDay = page.getByTestId('agenda-week-day-2027-04-30');
      await expect(dstWeekDay).toBeVisible();
      await expect(dstWeekDay.getByTestId(`agenda-item-hearing-${timedDstHearing.id}`)).toBeVisible();
      await expect(dstWeekDay.getByTestId(`agenda-item-hearing-${untimedDstHearing.id}`)).toBeVisible();
      await expect(
        dstWeekDay.getByTestId(`agenda-item-deadline-${dstConfirmedDeadline.id}`)
      ).toBeVisible();
      await expect(
        page
          .getByTestId('agenda-week-day-2027-04-29')
          .getByTestId(`agenda-item-hearing-${timedDstHearing.id}`)
      ).toHaveCount(0);

      // 3. Switch to Month View -> must stay on 2027-04-30
      await page.getByTestId('agenda-view-month').click();
      const dstMonthDay = page.getByTestId('agenda-month-day-2027-04-30');
      await expect(dstMonthDay).toBeVisible();
      await expect(dstMonthDay.getByTestId(`agenda-item-hearing-${timedDstHearing.id}`)).toBeVisible();
      await expect(
        dstMonthDay.getByTestId(`agenda-item-hearing-${untimedDstHearing.id}`)
      ).toBeVisible();
      await expect(
        dstMonthDay.getByTestId(`agenda-item-deadline-${dstConfirmedDeadline.id}`)
      ).toBeVisible();
      await expect(
        page
          .getByTestId('agenda-month-day-2027-04-29')
          .getByTestId(`agenda-item-hearing-${timedDstHearing.id}`)
      ).toHaveCount(0);

      // 4. Cairo midnight boundary week (2026-04-23 23:59 vs 2026-04-24 00:01)
      await page.goto('/agenda?view=week&anchorDate=2026-04-23');
      const apr23 = page.getByTestId('agenda-week-day-2026-04-23');
      const apr24 = page.getByTestId('agenda-week-day-2026-04-24');
      await expect(apr23.getByTestId(`agenda-item-hearing-${midnightBeforeHearing.id}`)).toBeVisible();
      await expect(apr23.getByTestId(`agenda-item-deadline-${overdueDeadline.id}`)).toBeVisible();
      await expect(apr24.getByTestId(`agenda-item-hearing-${midnightAfterHearing.id}`)).toBeVisible();
      await expect(apr24.getByTestId(`agenda-item-hearing-${midnightBeforeHearing.id}`)).toHaveCount(
        0
      );

      // 5. Today page (/today) Cairo today, unknown-time group, overdue deadline, undated task
      await page.goto('/today');
      await expect(page.getByTestId('today-cairo-date')).toContainText(cairoToday);
      const todayHearings = page.getByTestId('today-hearings-section');
      await expect(
        todayHearings
          .getByTestId('agenda-unknown-time-group')
          .getByTestId(`agenda-item-hearing-${todayUntimedHearing.id}`)
      ).toBeVisible();
      await expect(
        todayHearings.getByTestId(`hearing-unknown-time-${todayUntimedHearing.id}`)
      ).toHaveText('الساعة غير محددة');

      await expect(
        page
          .getByTestId('today-deadlines-upcoming-section')
          .getByTestId(`deadline-overdue-badge-${overdueDeadline.id}`)
      ).toBeVisible();
      await expect(
        page
          .getByTestId('agenda-undated-tasks-group')
          .getByTestId(`agenda-item-task-${undatedTask.id}`)
      ).toBeVisible();
    } finally {
      await cleanupScopedT09Data({
        matterIds: localMatters,
        taskIds: localTasks,
        deadlineIds: localDeadlines,
        hearingIds: localHearings,
      });
    }
  });

  /**
   * T09-TC-06 (Auth & Direct HTTP): Unauthenticated browser redirected to /login;
   * MAINTAINER denied on T09 pages & /api/{today,agenda,tasks,deadlines}.
   */
  test('T09-TC-06a: Unauthenticated and MAINTAINER authorization boundaries @t09', async ({
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;

    // 1. Unauthenticated browser & API checks
    const unauthCtx = await browser.newContext({ baseURL });
    const unauthPage = await unauthCtx.newPage();
    try {
      for (const route of ['/today', '/agenda', '/tasks', '/deadlines']) {
        await unauthPage.goto(route);
        await expect(unauthPage).toHaveURL((u) => u.pathname === '/login');
      }

      for (const endpoint of ['/api/today', '/api/agenda', '/api/tasks', '/api/deadlines']) {
        const res = await unauthPage.request.get(endpoint);
        expect(res.status(), `Expected 401 for unauthenticated GET ${endpoint}`).toBe(401);
      }
    } finally {
      await unauthCtx.close();
    }

    // 2. MAINTAINER browser & API checks
    const maintainerId = randomUUID();
    const maintainerEmail = `t09.maintainer.${runId}.${maintainerId.slice(0, 6)}@office.test`;
    const maintainerPass = `MntT09!${runId}99`;
    const hashed = await hashPassword(maintainerPass);
    const { pool } = createValidatedTestPool();
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, false, NOW(), NOW())',
        [maintainerId, 'مسؤول الصيانة للاختبار', maintainerEmail, 'MAINTAINER']
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

      for (const route of ['/today', '/agenda', '/tasks', '/deadlines']) {
        await maintPage.goto(route);
        await expect(maintPage.getByRole('heading', { level: 1 })).toHaveText('وصول مرفوض');
      }

      for (const endpoint of ['/api/today', '/api/agenda', '/api/tasks', '/api/deadlines']) {
        const res = await maintPage.request.get(endpoint);
        expect(res.status(), `Expected 403 for MAINTAINER GET ${endpoint}`).toBe(403);
      }

      const postTaskRes = await maintPage.request.post('/api/tasks', {
        headers: { Origin: baseURL, 'Content-Type': 'application/json' },
        data: { title: 'محاولة غير مصرح بها', idempotencyKey: `unauth-t-${runId}` },
      });
      expect(postTaskRes.status()).toBe(403);

      const postDeadlineRes = await maintPage.request.post('/api/deadlines', {
        headers: { Origin: baseURL, 'Content-Type': 'application/json' },
        data: {
          matterId: randomUUID(),
          title: 'محاولة موعد غير مصرح',
          idempotencyKey: `unauth-d-${runId}`,
        },
      });
      expect(postDeadlineRes.status()).toBe(403);
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

  /**
   * T09-TC-06 (Matter Detail Tab): Verify «المهام والمواعيد» tab renders Matter deadlines & tasks.
   */
  test('T09-TC-06b: Matter detail Tasks & Deadlines tab renders scoped records @t09', async ({
    page,
  }) => {
    const { matter, proceeding } = await seedOwnedMatterAndProceeding({
      ownerId: owner.id,
      partyId: testPartyId,
      courtId: testCourtId,
      fileCode: `LO-2027-${runId}-TAB`,
      title: `قضية تبويب المهام والمواعيد ${runId}`,
    });
    createdMatterIds.push(matter.id);

    const matterDeadline = await prisma.deadline.create({
      data: {
        matterId: matter.id,
        proceedingId: proceeding.id,
        title: `موعد على ملف القضية ${runId}`,
        dueDate: null,
        status: 'DRAFT',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDeadlineIds.push(matterDeadline.id);

    const matterTask = await prisma.task.create({
      data: {
        matterId: matter.id,
        proceedingId: proceeding.id,
        title: `مهمة على ملف القضية ${runId}`,
        dueDate: null,
        status: 'OPEN',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdTaskIds.push(matterTask.id);

    await signInWithTotp(page, owner);
    await page.goto(`/matters/${matter.id}`);

    await page.getByTestId('tab-tasks-deadlines').click();
    const panel = page.getByTestId('matter-tasks-deadlines-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId(`deadline-card-${matterDeadline.id}`)).toBeVisible();
    await expect(panel.getByTestId(`task-card-${matterTask.id}`)).toBeVisible();
  });

  /**
   * T09-TC-06 (Responsive / States / Keyboard / 200% Scale / Privacy / Screenshots):
   * Executed across desktop-1440, tablet-768, and mobile-390 projects.
   */
  test('T09-TC-06c: Populated, empty, offline, error, print, keyboard modal, 200% scale & storage privacy @responsive @a11y', async ({
    page,
  }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1440;
    const tag = `${runId}-w${width}`;
    const localMatters: string[] = [];
    const localCourts: string[] = [];
    const localTasks: string[] = [];
    const localDeadlines: string[] = [];
    const localHearings: string[] = [];

    const secretMatterTitle = `ملف سري للغاية لأجندة المكتب ${tag}`;
    const secretDeadlineTitle = `موعد نقض سري حرج ${tag}`;
    const secretTaskTitle = `مهمة سرية لتجهيز حافظة ${tag}`;

    try {
      const cairoToday = getCairoTodayDateString();
      const emptyCourt = await prisma.court.create({
        data: {
          name: `محكمة خالية للتصفية ${tag}`,
          code: `EMPTY-${tag.toUpperCase()}`,
          isActive: true,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localCourts.push(emptyCourt.id);

      const { matter, proceeding } = await seedOwnedMatterAndProceeding({
        ownerId: owner.id,
        partyId: testPartyId,
        courtId: testCourtId,
        fileCode: `LO-2027-${tag}`,
        title: secretMatterTitle,
      });
      localMatters.push(matter.id);

      const todayHearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date(`${cairoToday}T00:00:00.000Z`),
          hearingTime: '10:00',
          purpose: 'تقديم المذكرات الختامية',
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const untimedTodayHearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date(`${cairoToday}T00:00:00.000Z`),
          hearingTime: null,
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localHearings.push(todayHearing.id, untimedTodayHearing.id);

      const confirmedDeadline = await prisma.deadline.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: secretDeadlineTitle,
          dueDate: new Date(`${cairoToday}T00:00:00.000Z`),
          dueTime: null,
          source: 'صحيفة الدعوى',
          basisNotes: 'موعد قانوني مؤكد',
          status: 'CONFIRMED',
          confirmedById: owner.id,
          confirmedByName: owner.name,
          confirmedAt: new Date(),
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localDeadlines.push(confirmedDeadline.id);

      const seededTask = await prisma.task.create({
        data: {
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: secretTaskTitle,
          dueDate: null,
          status: 'OPEN',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localTasks.push(seededTask.id);

      await signInWithTotp(page, owner);

      // 1. Populated Today & Agenda RTL layout + screenshots
      await page.goto('/today');
      await expectShellReady(page);
      await expect(page.getByTestId(`agenda-item-hearing-${todayHearing.id}`)).toBeVisible();
      await expect(page.getByTestId(`agenda-item-deadline-${confirmedDeadline.id}`)).toBeVisible();
      await expect(page.getByTestId(`agenda-item-task-${seededTask.id}`)).toBeVisible();
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      await page.goto('/agenda');
      await expectShellReady(page);
      await expect(page.getByTestId(`agenda-item-hearing-${todayHearing.id}`)).toBeVisible();
      await expect(page.getByTestId(`agenda-item-hearing-${untimedTodayHearing.id}`)).toBeVisible();
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      const todayScreenshotPath = testInfo.outputPath(`t09-${width}.png`);
      await page.screenshot({
        path: todayScreenshotPath,
        fullPage: true,
      });
      await testInfo.attach(`t09-${width}`, {
        path: todayScreenshotPath,
        contentType: 'image/png',
      });

      // Printable agenda check on desktop 1440
      if (width === 1440) {
        await page.emulateMedia({ media: 'print' });
        await expect(page.getByText('مكتب المحامي — أجندة العمل اليومية')).toBeVisible();
        await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
        const printScreenshotPath = testInfo.outputPath('t09-agenda-print.png');
        await page.screenshot({
          path: printScreenshotPath,
          fullPage: true,
        });
        await testInfo.attach('t09-agenda-print', {
          path: printScreenshotPath,
          contentType: 'image/png',
        });
        await page.emulateMedia({ media: 'screen' });
      }

      // 2. 200% text scaling reflow check without horizontal overflow
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

      // Restore normal scale before interactive state checks
      await page.reload();
      await expectShellReady(page);

      // 3. Genuine empty state via empty court filter & recovery
      await page.getByTestId('agenda-filter-court').selectOption(emptyCourt.id);
      await expect(page.getByTestId('agenda-empty-state')).toBeVisible();
      await page.getByRole('button', { name: 'غيّر الفلاتر' }).click();
      await expect(page.getByTestId('agenda-empty-state')).toBeHidden();
      await expect(page.getByTestId(`agenda-item-hearing-${todayHearing.id}`)).toBeVisible();

      // 4. Read failure state & retry recovery on /agenda
      let failOnce = true;
      await page.route('**/api/agenda*', async (route) => {
        if (failOnce) {
          failOnce = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, code: 'INTERNAL_ERROR', error: 'تعذر تحميل الأجندة' }),
          });
        } else {
          await route.continue();
        }
      });
      await page.getByTestId('agenda-refresh-button').click();
      const errorState = page.getByTestId('agenda-error-state');
      await expect(errorState).toBeVisible();
      await expect(errorState.getByRole('alert')).toBeVisible();
      await page.getByTestId('agenda-error-retry-button').click();
      await expect(errorState).toBeHidden();
      await expect(page.getByTestId(`agenda-item-hearing-${todayHearing.id}`)).toBeVisible();
      await page.unroute('**/api/agenda*');

      // 5. Offline connectivity banner + in-memory form preservation + retry recovery on /tasks
      await page.goto('/tasks');
      await expectShellReady(page);
      await page.getByTestId('new-task-button').click();
      const offlineTaskTitle = `مهمة اختبار الانقطاع الشبكي ${tag}`;
      await page.getByTestId('task-title-input').fill(offlineTaskTitle);

      await page.context().setOffline(true);
      await expect(page.getByTestId('connectivity-banner')).toBeVisible();
      await expect(page.getByTestId('connectivity-banner')).toHaveText(
        'انقطع الاتصال بالإنترنت. التعديلات غير محفوظة'
      );

      await page.getByTestId('task-submit-button').click();
      await expect(page.getByTestId('task-form-error')).toBeVisible();
      await expect(page.getByTestId('task-title-input')).toHaveValue(offlineTaskTitle);

      await page.context().setOffline(false);
      await expect(page.getByTestId('connectivity-banner')).toBeHidden();
      await page.getByTestId('task-submit-button').click();
      await expect(page.getByTestId('task-status-notice')).toContainText('تم حفظ المهمة بنجاح');

      const offlineCreated = await prisma.task.findMany({ where: { title: offlineTaskTitle } });
      expect(offlineCreated).toHaveLength(1);
      localTasks.push(offlineCreated[0].id);

      // 6. Keyboard accessibility: Tab, visible focus, Enter, modal focus trap, Escape focus restore on /deadlines
      await page.goto('/deadlines');
      await expectShellReady(page);
      const newDeadlineBtn = page.getByTestId('new-deadline-button');
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      const reachedNewDeadlineBtn = await tabToTestId(page, 'new-deadline-button', 35);
      expect(reachedNewDeadlineBtn, 'new-deadline-button must be reachable by Tab').toBe(true);
      await expectVisibleFocus(page, newDeadlineBtn);
      await page.keyboard.press('Enter');

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('deadline-title-input')).toBeFocused();

      // Tab inside modal does not escape to #app-shell-content
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const stillInsideDialog = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(stillInsideDialog).toBe(true);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(newDeadlineBtn).toBeFocused();

      // 7. Browser storage privacy: no confidential agenda/matter/deadline/task data or session secrets persisted
      const storage = await snapshotStorage(page);
      expect(storage.indexedDbErrors).toEqual([]);
      expect(storage.cacheErrors).toEqual([]);

      const rawCookies = await page.context().cookies();
      const rawSessionCookies = rawCookies
        .filter((c) => /session/i.test(c.name))
        .map((c) => ({ name: c.name, value: c.value }));
      expectSessionCookiesHardened(await snapshotCookies(page));

      const suspiciousKeys = [
        ...Object.keys(storage.localStorage),
        ...Object.keys(storage.sessionStorage),
      ].filter((key) =>
        /session|token|secret|password|mfa|totp|agenda|deadline|task|matter|client/i.test(key)
      );
      expect(suspiciousKeys).toEqual([]);

      expectNoSensitiveValues(storage, [
        ...sensitiveNeedles(owner, rawSessionCookies),
        { label: 'confidential matter title', value: secretMatterTitle },
        { label: 'confidential deadline title', value: secretDeadlineTitle },
        { label: 'confidential task title', value: secretTaskTitle },
      ]);
    } finally {
      await page.context().setOffline(false).catch(() => {});
      await cleanupScopedT09Data({
        matterIds: localMatters,
        courtIds: localCourts,
        taskIds: localTasks,
        deadlineIds: localDeadlines,
        hearingIds: localHearings,
      });
    }
  });
});

