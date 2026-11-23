import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'child_process';
import { getPrismaClient } from '@/lib/auth';
import {
  addProceeding,
  archiveMatter,
  archiveProceeding,
  openMatter,
} from '@/modules/matters/matter-service';
import {
  ActiveObligationError,
  ConcurrencyConflictError,
  CrossMatterLinkForbiddenError,
  MatterArchivedError,
  ProceedingArchivedError,
  UnauthorizedError,
  UnsupportedTransitionError,
} from '@/modules/matters/matter-types';
import { AuthorizationError } from '@/modules/identity/types';
import { CalendarValidationError, UNSPECIFIED_TIME_LABEL } from '@/lib/cairo-date';
import { IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import {
  cancelDeadline,
  changeDeadlineDate,
  completeDeadline,
  confirmDeadline,
  correctHearingResult,
  createDeadline,
  getDeadline,
  listDeadlines,
  recordHearingResult,
  scheduleHearing,
  SchedulingValidationError,
} from '@/modules/scheduling';
import { schedulingHttpErrorResponse } from '@/modules/scheduling/deadline-http';
import {
  cancelTask,
  completeTask,
  createTask,
  getTask,
  getTodayOverview,
  listAgenda,
  listSelectableMatters,
  listTasks,
  updateTask,
} from '@/modules/productivity';
import { GET as getAgendaRoute } from '@/app/api/agenda/route';
import { GET as getTodayRoute } from '@/app/api/today/route';
import { GET as getTasksRoute, POST as postTasksRoute } from '@/app/api/tasks/route';
import { GET as getDeadlinesRoute, POST as postDeadlinesRoute } from '@/app/api/deadlines/route';
import { POST as postDeadlineConfirmRoute } from '@/app/api/deadlines/[id]/confirm/route';
import {
  cleanupPartyFixtures,
  createSyntheticActor,
  createSyntheticMaintainer,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { createDedicatedTestDatabase } from '../helpers/test-db';

function runPrismaMigrateDeploy(dbUrl: string, schema?: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(
    process.execPath,
    [prismaJs, 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])],
    {
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        NODE_ENV: 'test',
      },
      encoding: 'utf-8',
    }
  );
  if (res.status !== 0) {
    throw new Error(
      `Prisma migrate deploy failed with status ${res.status}:\nSTDOUT: ${res.stdout}\nSTDERR: ${res.stderr}`
    );
  }
  return res;
}

describe('T09 Integration Tests: Deadlines, Tasks, Agenda & Archive Guards (PG)', () => {
  const prisma = getPrismaClient();
  const owner = createSyntheticActor();
  const owner2 = createSyntheticActor({
    id: 'synthetic-owner-uuid-002',
    name: 'الأستاذ طارق الشريك',
    email: 'partner@lawoffice.test',
  });
  const maintainer = createSyntheticMaintainer();

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdStandaloneTaskIds: string[] = [];

  let courtCairoId: string;
  let courtGizaId: string;
  let matterAId: string;
  let proceedingAId: string;
  let matterBId: string;
  let proceedingBId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    const ts = Date.now();
    const c1 = await prisma.court.create({
      data: {
        name: `محكمة استئناف القاهرة اختبار T09 ${ts}`,
        code: `T09-CAIRO-${ts.toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    const c2 = await prisma.court.create({
      data: {
        name: `محكمة الجيزة الابتدائية اختبار T09 ${ts}`,
        code: `T09-GIZA-${ts.toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    courtCairoId = c1.id;
    courtGizaId = c2.id;
    createdCourtIds.push(c1.id, c2.id);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `عماد الدين حسن اختبار T09 ${ts}`,
        nameNormalized: `عماد الدين حسن اختبار T09 ${ts}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(party.id);

    const mA = await openMatter(owner, {
      title: `ملف قضية اختبار المواعيد أ ${ts}`,
      kind: 'LITIGATION',
      initialClientId: party.id,
      idempotencyKey: crypto.randomUUID(),
    });
    matterAId = mA.matter.id;
    createdMatterIds.push(matterAId);

    const pA = await addProceeding(owner, {
      matterId: matterAId,
      courtId: courtCairoId,
      instance: 'FIRST_INSTANCE',
      numberText: '8101',
      yearLabel: '2027',
      registerType: 'مدني كلي',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingAId = pA.id;

    const mB = await openMatter(owner, {
      title: `ملف قضية اختبار المواعيد ب ${ts}`,
      kind: 'LITIGATION',
      initialClientId: party.id,
      idempotencyKey: crypto.randomUUID(),
    });
    matterBId = mB.matter.id;
    createdMatterIds.push(matterBId);

    const pB = await addProceeding(owner, {
      matterId: matterBId,
      courtId: courtGizaId,
      instance: 'APPEAL',
      numberText: '9202',
      yearLabel: '2027',
      registerType: 'استئناف مدني',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingBId = pB.id;
  });

  afterAll(async () => {
    if (createdStandaloneTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdStandaloneTaskIds } } });
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'Task', entityId: { in: createdStandaloneTaskIds } },
      });
    }
    if (createdMatterIds.length > 0) {
      const deadlineIds = (
        await prisma.deadline.findMany({
          where: { matterId: { in: createdMatterIds } },
          select: { id: true },
        })
      ).map((d) => d.id);
      if (deadlineIds.length > 0) {
        await prisma.jobRun.deleteMany({
          where: { sourceType: 'Deadline', sourceId: { in: deadlineIds } },
        });
        await prisma.auditEvent.deleteMany({
          where: { entityType: 'Deadline', entityId: { in: deadlineIds } },
        });
      }
      const taskIds = (
        await prisma.task.findMany({
          where: { matterId: { in: createdMatterIds } },
          select: { id: true },
        })
      ).map((t) => t.id);
      if (taskIds.length > 0) {
        await prisma.auditEvent.deleteMany({
          where: { entityType: 'Task', entityId: { in: taskIds } },
        });
      }
    }
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  it('T09-TC-01: Undated draft deadline remains unapproved with zero reminder jobs until explicit lawyer confirmation', async () => {
    const draft = await createDeadline(owner, {
      matterId: matterAId,
      proceedingId: proceedingAId,
      title: 'ميعاد استئناف الحكم الابتدائي — قيد المراجعة',
      idempotencyKey: crypto.randomUUID(),
    });

    expect(draft.status).toBe('DRAFT');
    expect(draft.dueDate).toBeNull();
    expect(draft.needsReview).toBe(true);
    expect(draft.confirmedAt).toBeNull();
    expect(draft.confirmedById).toBeNull();
    expect(draft.pendingReminderCount).toBe(0);

    const draftJobs = await prisma.jobRun.count({
      where: { sourceType: 'Deadline', sourceId: draft.id },
    });
    expect(draftJobs).toBe(0);

    // Reject confirmation with missing date, source, basis, confirmation checkbox, or deferred doc link
    await expect(
      confirmDeadline(owner, {
        deadlineId: draft.id,
        expectedVersion: draft.version,
        dueDate: '',
        source: 'مراجعة المحامي للحكم',
        basisNotes: '٤٠ يوماً من تاريخ النطق بالحكم الحضوري',
        confirmationAccepted: true,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(SchedulingValidationError);

    await expect(
      confirmDeadline(owner, {
        deadlineId: draft.id,
        expectedVersion: draft.version,
        dueDate: '2027-07-15',
        source: 'مراجعة المحامي للحكم',
        basisNotes: '   ',
        confirmationAccepted: true,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(SchedulingValidationError);

    await expect(
      confirmDeadline(owner, {
        deadlineId: draft.id,
        expectedVersion: draft.version,
        dueDate: '2027-07-15',
        source: 'مراجعة المحامي للحكم',
        basisNotes: '٤٠ يوماً من تاريخ النطق بالحكم الحضوري',
        confirmationAccepted: false,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(SchedulingValidationError);

    await expect(
      confirmDeadline(owner, {
        deadlineId: draft.id,
        expectedVersion: draft.version,
        dueDate: '2027-07-15',
        source: 'مراجعة المحامي للحكم',
        basisNotes: '٤٠ يوماً من تاريخ النطق بالحكم الحضوري',
        sourceDocumentId: 'doc-deferred-t12',
        confirmationAccepted: true,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(SchedulingValidationError);

    // Valid confirmation
    const confirmKey = crypto.randomUUID();
    const confirmed = await confirmDeadline(owner, {
      deadlineId: draft.id,
      expectedVersion: draft.version,
      dueDate: '2027-07-15',
      dueTime: '11:30',
      source: 'ملف القضية وصورة الحكم الرسمية',
      basisNotes: 'تم احتساب الميعاد يدوياً وفق المادة ٢٢٧ مرافعات بعد الاطلاع على محضر النطق بالحكم',
      confirmationAccepted: true,
      idempotencyKey: confirmKey,
    });

    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.version).toBe(2);
    expect(confirmed.dueDate).toBe('2027-07-15');
    expect(confirmed.dueTime).toBe('11:30');
    expect(confirmed.confirmedById).toBe(owner.id);
    expect(confirmed.confirmedByName).toBe(owner.name);
    expect(confirmed.confirmedAt).toBeTruthy();
    expect(confirmed.pendingReminderCount).toBe(1);

    const confirmAudit = await prisma.auditEvent.findFirst({
      where: { entityType: 'Deadline', entityId: draft.id, action: 'CONFIRM_DEADLINE' },
    });
    expect(confirmAudit).not.toBeNull();

    const jobs = await prisma.jobRun.findMany({
      where: { sourceType: 'Deadline', sourceId: draft.id, status: 'PENDING' },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].deduplicationKey).toBe(`deadline_reminder_${draft.id}_v2`);

    // Cancel at end so matterA isn't blocked for other independent cases
    await cancelDeadline(owner, {
      deadlineId: confirmed.id,
      expectedVersion: confirmed.version,
      reason: 'تنظيف حالة الاختبار TC-01',
      idempotencyKey: crypto.randomUUID(),
    });
  });

  it('T09-TC-02: Changing a confirmed deadline date clears confirmation, cancels old reminders, rejects stale versions, and supports reapproval', async () => {
    const draft = await createDeadline(owner, {
      matterId: matterAId,
      proceedingId: proceedingAId,
      title: 'ميعاد تقديم مستندات أصلية',
      dueDate: '2027-08-01',
      source: 'محضر الجلسة',
      basisNotes: 'مهلة أسبوعين بقرار المحكمة',
      idempotencyKey: crypto.randomUUID(),
    });

    const confirmed = await confirmDeadline(owner, {
      deadlineId: draft.id,
      expectedVersion: draft.version,
      dueDate: '2027-08-01',
      source: 'محضر الجلسة',
      basisNotes: 'مهلة أسبوعين بقرار المحكمة',
      lawyerReviewed: true,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(confirmed.version).toBe(2);

    // Changing confirmed deadline date without reason must fail
    await expect(
      changeDeadlineDate(owner, {
        deadlineId: confirmed.id,
        expectedVersion: confirmed.version,
        dueDate: '2027-08-10',
        reason: '   ',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(SchedulingValidationError);

    // Valid date change reverts to DRAFT and cancels old JobRun
    const changeKey = crypto.randomUUID();
    const reverted = await changeDeadlineDate(owner, {
      deadlineId: confirmed.id,
      expectedVersion: confirmed.version,
      dueDate: '2027-08-10',
      dueTime: '09:30',
      reason: 'تبين تصحيح تاريخ إعلان الخصم بالمحضر الرسمي',
      idempotencyKey: changeKey,
    });

    expect(reverted.status).toBe('DRAFT');
    expect(reverted.version).toBe(3);
    expect(reverted.dueDate).toBe('2027-08-10');
    expect(reverted.confirmedAt).toBeNull();
    expect(reverted.confirmedById).toBeNull();
    expect(reverted.confirmedByName).toBeNull();
    expect(reverted.pendingReminderCount).toBe(0);

    const oldJob = await prisma.jobRun.findFirstOrThrow({
      where: { sourceType: 'Deadline', sourceId: confirmed.id },
    });
    expect(oldJob.status).toBe('CANCELLED');

    // Idempotent replay of changeDeadlineDate returns identical DTO without re-failing
    const replayedChange = await changeDeadlineDate(owner, {
      deadlineId: confirmed.id,
      expectedVersion: confirmed.version,
      dueDate: '2027-08-10',
      dueTime: '09:30',
      reason: 'تبين تصحيح تاريخ إعلان الخصم بالمحضر الرسمي',
      idempotencyKey: changeKey,
    });
    expect(replayedChange).toEqual(reverted);

    // Different payload under same key is rejected
    await expect(
      changeDeadlineDate(owner, {
        deadlineId: confirmed.id,
        expectedVersion: confirmed.version,
        dueDate: '2027-08-12',
        reason: 'تبين تصحيح تاريخ إعلان الخصم بالمحضر الرسمي',
        idempotencyKey: changeKey,
      })
    ).rejects.toThrow(IdempotencyPayloadMismatchError);

    // Stale expectedVersion (2 instead of 3) must fail with ConcurrencyConflictError
    await expect(
      confirmDeadline(owner, {
        deadlineId: reverted.id,
        expectedVersion: confirmed.version,
        dueDate: '2027-08-10',
        source: 'محضر الجلسة المصحح',
        basisNotes: 'إعادة احتساب بعد تصحيح الإعلان',
        confirmationAccepted: true,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Reapproval with current version creates a NEW pending JobRun without unique key collision
    const reconfirmed = await confirmDeadline(owner, {
      deadlineId: reverted.id,
      expectedVersion: reverted.version,
      dueDate: '2027-08-10',
      dueTime: '09:30',
      source: 'محضر الجلسة المصحح',
      basisNotes: 'إعادة احتساب بعد تصحيح الإعلان',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(reconfirmed.status).toBe('CONFIRMED');
    expect(reconfirmed.version).toBe(4);
    expect(reconfirmed.pendingReminderCount).toBe(1);

    const allJobs = await prisma.jobRun.findMany({
      where: { sourceType: 'Deadline', sourceId: reverted.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(allJobs).toHaveLength(2);
    expect(allJobs[0].status).toBe('CANCELLED');
    expect(allJobs[1].status).toBe('PENDING');
    expect(allJobs[1].deduplicationKey).toBe(`deadline_reminder_${reverted.id}_v4`);

    await cancelDeadline(owner, {
      deadlineId: reconfirmed.id,
      expectedVersion: reconfirmed.version,
      reason: 'تنظيف حالة الاختبار TC-02',
      idempotencyKey: crypto.randomUUID(),
    });
  });

  it('T09-TC-03: Standalone undated tasks work, time without day fails, completing a task leaves its deadline open, and valid deadline completion audits', async () => {
    // Standalone undated task (no matter, no dueDate)
    const standalone = await createTask(owner, {
      title: 'مراجعة أرشيف التوكيلات العامة بالمكتب',
      idempotencyKey: crypto.randomUUID(),
    });
    createdStandaloneTaskIds.push(standalone.id);
    expect(standalone.matterId).toBeNull();
    expect(standalone.dueDate).toBeNull();
    expect(standalone.dueTime).toBeNull();
    expect(standalone.status).toBe('OPEN');

    // Time without a day must fail
    await expect(
      createTask(owner, {
        title: 'مهمة بوقت دون تاريخ',
        dueTime: '10:30',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CalendarValidationError);

    // Update standalone task to IN_PROGRESS and verify
    const inProgress = await updateTask(owner, {
      taskId: standalone.id,
      expectedVersion: standalone.version,
      status: 'IN_PROGRESS',
      details: 'تم فرز نصف الدرج الأول',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(inProgress.status).toBe('IN_PROGRESS');
    expect(inProgress.version).toBe(2);

    // Create a confirmed deadline and a linked task
    const dlDraft = await createDeadline(owner, {
      matterId: matterAId,
      proceedingId: proceedingAId,
      title: 'إيداع صحيفة الطعن بالنقض',
      idempotencyKey: crypto.randomUUID(),
    });
    const dlConfirmed = await confirmDeadline(owner, {
      deadlineId: dlDraft.id,
      expectedVersion: dlDraft.version,
      dueDate: '2027-09-20',
      source: 'شهادة جدول النقض',
      basisNotes: '٦٠ يوماً من تاريخ الحكم الاستئنافي',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });

    const linkedTask = await createTask(owner, {
      title: 'تجهيز حافظة المستندات المرفقة بالطعن',
      matterId: matterAId,
      proceedingId: proceedingAId,
      deadlineId: dlConfirmed.id,
      dueDate: '2027-09-15',
      dueTime: '12:00',
      priority: 'HIGH',
      idempotencyKey: crypto.randomUUID(),
    });

    // Complete the linked task
    const doneTask = await completeTask(owner, {
      taskId: linkedTask.id,
      expectedVersion: linkedTask.version,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(doneTask.status).toBe('DONE');
    expect(doneTask.completedAt).toBeTruthy();

    // Critical rule: linked deadline MUST remain CONFIRMED and open!
    const stillOpenDeadline = await getDeadline(owner, dlConfirmed.id);
    expect(stillOpenDeadline.status).toBe('CONFIRMED');
    expect(stillOpenDeadline.completedAt).toBeNull();
    expect(stillOpenDeadline.pendingReminderCount).toBe(1);

    // Completing deadline without required execution description or from DRAFT must fail
    await expect(
      completeDeadline(owner, {
        deadlineId: dlConfirmed.id,
        expectedVersion: dlConfirmed.version,
        completionDescription: '   ',
        completionDate: '2027-09-18',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(SchedulingValidationError);

    const draftOnly = await createDeadline(owner, {
      matterId: matterAId,
      title: 'مسودة غير معتمدة لا يجوز إتمامها',
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      completeDeadline(owner, {
        deadlineId: draftOnly.id,
        expectedVersion: draftOnly.version,
        completionDescription: 'محاولة إتمام مسودة',
        completionDate: '2027-09-18',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(UnsupportedTransitionError);

    // Valid completion of confirmed deadline
    const completedDl = await completeDeadline(owner, {
      deadlineId: dlConfirmed.id,
      expectedVersion: dlConfirmed.version,
      completionDescription: 'تم إيداع صحيفة الطعن برقم صادر ٤١٢ بقلم كتاب محكمة النقض',
      completionDate: '2027-09-18',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(completedDl.status).toBe('COMPLETED');
    expect(completedDl.completedDate).toBe('2027-09-18');
    expect(completedDl.completedAt).toBeTruthy();
    expect(completedDl.pendingReminderCount).toBe(0);

    const completeAudit = await prisma.auditEvent.findFirst({
      where: { entityType: 'Deadline', entityId: dlConfirmed.id, action: 'COMPLETE_DEADLINE' },
    });
    expect(completeAudit).not.toBeNull();

    await cancelDeadline(owner, {
      deadlineId: draftOnly.id,
      expectedVersion: draftOnly.version,
      reason: 'تنظيف مسودة الاختبار',
      idempotencyKey: crypto.randomUUID(),
    });
  });

  it('T09-TC-04: Cairo midnight, spring DST boundaries, untimed hearings, undated tasks, court conflicts, and dynamic overdue escalation', async () => {
    // Schedule 1 timed hearing and 1 untimed hearing on 2027-04-30 (Egypt DST transition day) across 2 courts
    const timedHearing = await scheduleHearing(owner, {
      proceedingId: proceedingAId,
      hearingDate: '2027-04-30',
      hearingTime: '09:30',
      purpose: 'مرافعة ختامية',
      idempotencyKey: crypto.randomUUID(),
    });
    const untimedHearing = await scheduleHearing(owner, {
      proceedingId: proceedingBId,
      hearingDate: '2027-04-30',
      hearingTime: null,
      purpose: 'جلسة بدون ساعة محددة',
      idempotencyKey: crypto.randomUUID(),
    });

    const dlDraft = await createDeadline(owner, {
      matterId: matterAId,
      proceedingId: proceedingAId,
      title: 'موعد ختامي في يوم الانتقال الصيفي',
      idempotencyKey: crypto.randomUUID(),
    });
    const dlConfirmed = await confirmDeadline(owner, {
      deadlineId: dlDraft.id,
      expectedVersion: dlDraft.version,
      dueDate: '2027-04-30',
      source: 'رول المحكمة',
      basisNotes: 'قرار الهيئة بالجلسة السابقة',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });

    const undatedTask = await createTask(owner, {
      title: 'مهمة غير مؤرخة لا تظهر في يوم محدد',
      idempotencyKey: crypto.randomUUID(),
    });
    createdStandaloneTaskIds.push(undatedTask.id);

    // 1. Freeze at 2027-04-29T21:59:59Z -> Cairo is still 2027-04-29 23:59:59
    const beforeMidnight = new Date('2027-04-29T21:59:59Z');
    const dayBefore = await listAgenda(owner, { view: 'day' }, { now: beforeMidnight });
    expect(dayBefore.cairoToday).toBe('2027-04-29');
    expect(dayBefore.hearings.some((h) => h.id === timedHearing.id)).toBe(false);
    expect(dayBefore.undatedTasks.some((t) => t.id === undatedTask.id)).toBe(true);
    expect(dayBefore.datedTasks.some((t) => t.id === undatedTask.id)).toBe(false);

    // 2. Freeze at 2027-04-29T22:00:00Z -> Cairo jumps to 2027-04-30 01:00:00 (DST)
    const dstDay = new Date('2027-04-29T22:00:00Z');
    const todayOverview = await getTodayOverview(owner, { now: dstDay });
    expect(todayOverview.cairoToday).toBe('2027-04-30');
    expect(todayOverview.agenda.timedHearings.map((h) => h.id)).toContain(timedHearing.id);
    expect(todayOverview.agenda.untimedHearings.map((h) => h.id)).toContain(untimedHearing.id);
    const untimedDto = todayOverview.agenda.untimedHearings.find((h) => h.id === untimedHearing.id)!;
    expect(untimedDto.hearingTime).toBeNull();
    expect(untimedDto.timeLabel).toBe(UNSPECIFIED_TIME_LABEL);
    expect(todayOverview.agenda.confirmedDeadlines.map((d) => d.id)).toContain(dlConfirmed.id);
    expect(
      todayOverview.agenda.confirmedDeadlines.find((d) => d.id === dlConfirmed.id)?.isOverdue
    ).toBe(false);
    // Multi-court same-day conflict warning
    expect(todayOverview.agenda.sameDayCourtConflicts.some((c) => c.date === '2027-04-30')).toBe(true);
    // Undated task stays strictly in undatedTasks
    expect(todayOverview.agenda.undatedTasks.map((t) => t.id)).toContain(undatedTask.id);
    expect(todayOverview.agenda.datedTasks.map((t) => t.id)).not.toContain(undatedTask.id);

    // Week and month views align cleanly to Cairo calendar
    const weekAgenda = await listAgenda(owner, { view: 'week' }, { now: dstDay });
    expect(weekAgenda.rangeStart).toBe('2027-04-24');
    expect(weekAgenda.rangeEnd).toBe('2027-04-30');
    expect(weekAgenda.confirmedDeadlines.map((d) => d.id)).toContain(dlConfirmed.id);

    const monthAgenda = await listAgenda(owner, { view: 'month' }, { now: dstDay });
    expect(monthAgenda.rangeStart).toBe('2027-04-01');
    expect(monthAgenda.rangeEnd).toBe('2027-04-30');
    expect(monthAgenda.hearings.map((h) => h.id)).toContain(timedHearing.id);

    // Court filter restricts hearings accurately
    const cairoFiltered = await listAgenda(
      owner,
      { view: 'day', anchorDate: '2027-04-30', courtId: courtCairoId },
      { now: dstDay }
    );
    expect(cairoFiltered.hearings.map((h) => h.id)).toContain(timedHearing.id);
    expect(cairoFiltered.hearings.map((h) => h.id)).not.toContain(untimedHearing.id);

    // 3. Advance clock past midnight in Cairo DST (2027-04-30T21:00:00Z = 2027-05-01 00:00 Cairo, still Apr 30 UTC)
    const nextCairoDay = new Date('2027-04-30T21:00:00Z');
    const afterDeadline = await listAgenda(owner, { view: 'today' }, { now: nextCairoDay });
    expect(afterDeadline.cairoToday).toBe('2027-05-01');
    const overdueItem = afterDeadline.overdueDeadlines.find((d) => d.id === dlConfirmed.id);
    expect(overdueItem).toBeDefined();
    expect(overdueItem?.isOverdue).toBe(true);

    // Clean up obligations from matterA/B
    await cancelDeadline(owner, {
      deadlineId: dlConfirmed.id,
      expectedVersion: dlConfirmed.version,
      reason: 'تنظيف حالة TC-04',
      idempotencyKey: crypto.randomUUID(),
    });
    await prisma.hearing.updateMany({
      where: { id: { in: [timedHearing.id, untimedHearing.id] } },
      data: { status: 'CANCELLED', cancellationReason: 'تنظيف TC-04' },
    });
    await prisma.jobRun.updateMany({
      where: { sourceType: 'Hearing', sourceId: { in: [timedHearing.id, untimedHearing.id] } },
      data: { status: 'CANCELLED' },
    });
  });

  it('T09-TC-05: Enforces cross-matter guards, archive guards for confirmed deadlines, transactional rollback, and concurrency', async () => {
    // 1. Cross-matter links rejected
    await expect(
      createDeadline(owner, {
        matterId: matterAId,
        proceedingId: proceedingBId,
        title: 'محاولة ربط عابر للملفات',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    await expect(
      createTask(owner, {
        title: 'مهمة عابرة للملفات',
        matterId: matterAId,
        proceedingId: proceedingBId,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    // 2. Confirmed deadline blocks archiveMatter AND archiveProceeding; DRAFT does not
    const draft = await createDeadline(owner, {
      matterId: matterBId,
      proceedingId: proceedingBId,
      title: 'موعد لمنع الأرشفة حتى البت فيه',
      idempotencyKey: crypto.randomUUID(),
    });

    // Inject outbox failure on confirmDeadline -> full rollback + clean retry
    const faultKey = crypto.randomUUID();
    await expect(
      confirmDeadline(
        owner,
        {
          deadlineId: draft.id,
          expectedVersion: draft.version,
          dueDate: '2027-11-15',
          source: 'صحيفة الدعوى',
          basisNotes: 'مهلة أصلية',
          confirmationAccepted: true,
          idempotencyKey: faultKey,
        },
        { _faultInject: 'outbox' }
      )
    ).rejects.toThrow('SIMULATED_OUTBOX_TRANSACTION_FAILURE');

    // Verify rollback left zero partial state and zero idempotency record
    const afterFaultDl = await getDeadline(owner, draft.id);
    expect(afterFaultDl.status).toBe('DRAFT');
    expect(afterFaultDl.version).toBe(1);
    expect(
      await prisma.jobRun.count({ where: { sourceType: 'Deadline', sourceId: draft.id } })
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { entityType: 'Deadline', entityId: draft.id, action: 'CONFIRM_DEADLINE' },
      })
    ).toBe(0);
    expect(
      await prisma.idempotencyRecord.count({ where: { actorId: owner.id, key: faultKey } })
    ).toBe(0);

    // Same key succeeds cleanly once fault clears; race with owner2 produces 1 winner & 1 ConcurrencyConflictError
    const race = await Promise.allSettled([
      confirmDeadline(owner, {
        deadlineId: draft.id,
        expectedVersion: draft.version,
        dueDate: '2027-11-15',
        source: 'صحيفة الدعوى',
        basisNotes: 'مهلة أصلية',
        confirmationAccepted: true,
        idempotencyKey: faultKey,
      }),
      confirmDeadline(owner2, {
        deadlineId: draft.id,
        expectedVersion: draft.version,
        dueDate: '2027-11-15',
        source: 'صحيفة الدعوى',
        basisNotes: 'مهلة أصلية',
        confirmationAccepted: true,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    const winners = race.filter((r) => r.status === 'fulfilled');
    const losers = race.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflictError);

    const confirmedDl = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof confirmDeadline>>>)
      .value;

    // Reload current matterB & proceedingB versions and try archiving
    const matterBRow = await prisma.matter.findUniqueOrThrow({ where: { id: matterBId } });
    const procBRow = await prisma.proceeding.findUniqueOrThrow({ where: { id: proceedingBId } });

    await expect(
      archiveMatter(owner, {
        matterId: matterBId,
        reason: 'محاولة أرشفة رغم وجود موعد مؤكد',
        expectedVersion: matterBRow.version,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(ActiveObligationError);

    await expect(
      archiveProceeding(owner, {
        proceedingId: proceedingBId,
        matterId: matterBId,
        reason: 'محاولة أرشفة قيد رغم وجود موعد مؤكد',
        expectedVersion: procBRow.version,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(ActiveObligationError);

    // Complete/cancel the deadline, then archive proceedingB and verify mutations fail on archived parents
    await cancelDeadline(owner, {
      deadlineId: confirmedDl.id,
      expectedVersion: confirmedDl.version,
      reason: 'انتهت الحاجة قبل الأرشفة',
      idempotencyKey: crypto.randomUUID(),
    });

    await archiveProceeding(owner, {
      proceedingId: proceedingBId,
      matterId: matterBId,
      reason: 'أرشفة القيد بعد إغلاق المواعيد',
      expectedVersion: procBRow.version,
      idempotencyKey: crypto.randomUUID(),
    });

    await expect(
      createDeadline(owner, {
        matterId: matterBId,
        proceedingId: proceedingBId,
        title: 'موعد على قيد مؤرشف',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(ProceedingArchivedError);

    const matterBRowAfter = await prisma.matter.findUniqueOrThrow({ where: { id: matterBId } });
    await archiveMatter(owner, {
      matterId: matterBId,
      reason: 'أرشفة الملف بعد إغلاق كل الالتزامات',
      expectedVersion: matterBRowAfter.version,
      idempotencyKey: crypto.randomUUID(),
    });

    await expect(
      createDeadline(owner, {
        matterId: matterBId,
        title: 'موعد على ملف مؤرشف',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(MatterArchivedError);

    await expect(
      createTask(owner, {
        title: 'مهمة على ملف مؤرشف',
        matterId: matterBId,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(MatterArchivedError);

    // Real PostgreSQL CHECK constraint fault injection during createTask rolls back Task + IdempotencyRecord
    const taskFaultKey = crypto.randomUUID();
    const taskCountBefore = await prisma.task.count({ where: { matterId: matterAId } });
    const constraintName = 't09_test_audit_fail';
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "audit_event" ADD CONSTRAINT ${constraintName} CHECK ("action" <> 'CREATE_TASK' OR "userId" <> '${owner.id}') NOT VALID`
    );
    try {
      await expect(
        createTask(owner, {
          title: 'مهمة لاختبار التراجع الفعلي في PostgreSQL',
          matterId: matterAId,
          idempotencyKey: taskFaultKey,
        })
      ).rejects.toThrow(constraintName);
      expect(await prisma.task.count({ where: { matterId: matterAId } })).toBe(taskCountBefore);
      expect(
        await prisma.idempotencyRecord.count({ where: { actorId: owner.id, key: taskFaultKey } })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS ${constraintName}`
      );
    }
  });

  it('T09-TC-06: Rejects unauthenticated and Maintainer direct module commands and enforces HTTP private/origin boundaries', async () => {
    const nullActor = null as unknown as Parameters<typeof createTask>[0];

    await expect(
      createTask(nullActor, { title: 'مرفوض', idempotencyKey: crypto.randomUUID() })
    ).rejects.toThrow(UnauthorizedError);
    await expect(listAgenda(nullActor, { view: 'today' })).rejects.toThrow(UnauthorizedError);
    await expect(getTodayOverview(nullActor)).rejects.toThrow(UnauthorizedError);
    await expect(listDeadlines(nullActor)).rejects.toThrow(UnauthorizedError);

    // Maintainer strictly forbidden from reading or writing client productivity/deadlines data
    await expect(
      createTask(maintainer, { title: 'ممنوع للصيانة', idempotencyKey: crypto.randomUUID() })
    ).rejects.toThrow(AuthorizationError);
    await expect(
      createDeadline(maintainer, {
        matterId: matterAId,
        title: 'ممنوع للصيانة',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(AuthorizationError);
    await expect(listTasks(maintainer)).rejects.toThrow(AuthorizationError);
    await expect(listDeadlines(maintainer)).rejects.toThrow(AuthorizationError);
    await expect(listAgenda(maintainer, { view: 'today' })).rejects.toThrow(AuthorizationError);
    await expect(getTodayOverview(maintainer)).rejects.toThrow(AuthorizationError);
    await expect(listSelectableMatters(maintainer)).rejects.toThrow(AuthorizationError);

    // Owner selectable matters works and excludes archived matterB
    const selectable = await listSelectableMatters(owner);
    expect(selectable.some((m) => m.id === matterAId)).toBe(true);
    expect(selectable.some((m) => m.id === matterBId)).toBe(false);

    // Real HTTP route handlers reject unauthenticated and untrusted-origin requests with private no-store headers
    const unauthAgenda = await getAgendaRoute(new Request('http://127.0.0.1:3208/api/agenda'));
    expect(unauthAgenda.status).toBe(401);
    expect(unauthAgenda.headers.get('cache-control')).toBe('private, no-store');

    const unauthToday = await getTodayRoute(new Request('http://127.0.0.1:3208/api/today'));
    expect(unauthToday.status).toBe(401);

    const unauthTasksGet = await getTasksRoute(new Request('http://127.0.0.1:3208/api/tasks'));
    expect(unauthTasksGet.status).toBe(401);

    const unauthDeadlinesGet = await getDeadlinesRoute(
      new Request('http://127.0.0.1:3208/api/deadlines')
    );
    expect(unauthDeadlinesGet.status).toBe(401);

    const crossOriginTaskPost = await postTasksRoute(
      new Request('http://127.0.0.1:3208/api/tasks', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'xss', idempotencyKey: 'k1' }),
      })
    );
    expect(crossOriginTaskPost.status).toBe(403);
    expect(crossOriginTaskPost.headers.get('cache-control')).toBe('private, no-store');

    const crossSiteDeadlinePost = await postDeadlinesRoute(
      new Request('http://127.0.0.1:3208/api/deadlines', {
        method: 'POST',
        headers: {
          origin: 'http://127.0.0.1:3208',
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ matterId: matterAId, title: 'csrf', idempotencyKey: 'k2' }),
      })
    );
    expect(crossSiteDeadlinePost.status).toBe(403);

    const unauthConfirmPost = await postDeadlineConfirmRoute(
      new Request('http://127.0.0.1:3208/api/deadlines/00000000-0000-4000-8000-000000000000/confirm', {
        method: 'POST',
        headers: {
          origin: 'http://127.0.0.1:3208',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }) }
    );
    expect(unauthConfirmPost.status).toBe(401);

    // Safe HTTP error mapper checks
    const forbiddenRes = schedulingHttpErrorResponse(new AuthorizationError());
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.headers.get('cache-control')).toBe('private, no-store');

    const internalRes = schedulingHttpErrorResponse(new Error('sensitive postgres string'));
    expect(internalRes.status).toBe(500);
    const internalBody = (await internalRes.json()) as { code: string; error: string };
    expect(internalBody.code).toBe('INTERNAL_ERROR');
    expect(internalBody.error).not.toContain('sensitive postgres string');
  });

  it('T09-TC-07: Recording or correcting a hearing result never derives appeal dates or modifies draft deadlines', async () => {
    const manualDraft = await createDeadline(owner, {
      matterId: matterAId,
      proceedingId: proceedingAId,
      title: 'ميعاد مسودة يدوي مرتبط بالدعوى',
      dueDate: '2027-06-10',
      idempotencyKey: crypto.randomUUID(),
    });

    const hearing = await scheduleHearing(owner, {
      proceedingId: proceedingAId,
      hearingDate: '2027-05-01',
      idempotencyKey: crypto.randomUUID(),
    });

    const recorded = await recordHearingResult(owner, {
      hearingId: hearing.id,
      expectedVersion: hearing.version,
      decisionText: 'حكمت المحكمة بإلزام المدعى عليه بالتعويض',
      nextDateDisposition: 'NONE',
      idempotencyKey: crypto.randomUUID(),
    });

    await correctHearingResult(owner, {
      hearingId: hearing.id,
      currentResultId: recorded.resultId,
      correctionReason: 'تعديل منطوق الحكم وفق الصورة الرسمية',
      decisionText: 'حكمت المحكمة برفض الدعوى مع المصروفات',
      nextDateDisposition: 'NONE',
      idempotencyKey: crypto.randomUUID(),
    });

    const allMatterDeadlines = await listDeadlines(owner, { matterId: matterAId, includeClosed: true });
    const draftAfter = await getDeadline(owner, manualDraft.id);
    expect(draftAfter.dueDate).toBe('2027-06-10');
    expect(draftAfter.status).toBe('DRAFT');
    expect(draftAfter.version).toBe(1);
    expect(
      allMatterDeadlines.filter((d) => d.createdAt >= manualDraft.createdAt && d.id !== manualDraft.id)
    ).toHaveLength(0);

    // Also verify cancelTask works cleanly
    const tempTask = await createTask(owner, {
      title: 'مهمة مؤقتة للإلغاء',
      matterId: matterAId,
      idempotencyKey: crypto.randomUUID(),
    });
    const cancelledTask = await cancelTask(owner, {
      taskId: tempTask.id,
      expectedVersion: tempTask.version,
      reason: 'لا حاجة لها',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(cancelledTask.status).toBe('CANCELLED');
    expect((await getTask(owner, tempTask.id)).status).toBe('CANCELLED');

    await cancelDeadline(owner, {
      deadlineId: manualDraft.id,
      expectedVersion: manualDraft.version,
      reason: 'تنظيف اختبار TC-07',
      idempotencyKey: crypto.randomUUID(),
    });
  });

  it('Migration verification: fresh deploy, SQL CHECK constraints, and populated T08-to-T09 schema upgrade', async () => {
    // 1. Fresh DB migration + SQL CHECK constraint enforcement
    const fresh = await createDedicatedTestDatabase();
    try {
      runPrismaMigrateDeploy(fresh.url);

      // Verify task.matter_id is nullable and deadline table exists
      const matterIdNullable = await fresh.pool.query(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'task' AND column_name = 'matter_id';
      `);
      expect(matterIdNullable.rows[0]?.is_nullable).toBe('YES');

      // Seed minimal matter to test SQL CHECK constraints directly
      await fresh.pool.query(`
        INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "createdById", "updatedById", "updatedAt")
        VALUES ('fresh-matter', 'LO-2027-0001', 'ملف فحص قيود SQL', 'LITIGATION', 'DRAFT', 'u1', 'u1', now());
      `);

      await expect(
        fresh.pool.query(`
          INSERT INTO "task" ("id", "title", "due_time", "created_by_id", "updated_by_id", "updated_at")
          VALUES ('bad-task', 'وقت بدون تاريخ', '09:00', 'u1', 'u1', now());
        `)
      ).rejects.toThrow(/task_due_time_requires_due_date_check/);

      await expect(
        fresh.pool.query(`
          INSERT INTO "deadline" ("id", "matter_id", "title", "status", "created_by_id", "updated_by_id", "updated_at")
          VALUES ('bad-dl-confirmed', 'fresh-matter', 'مؤكد ناقص', 'CONFIRMED', 'u1', 'u1', now());
        `)
      ).rejects.toThrow(/deadline_confirmed_fields_check/);

      await expect(
        fresh.pool.query(`
          INSERT INTO "deadline" ("id", "matter_id", "title", "status", "created_by_id", "updated_by_id", "updated_at")
          VALUES ('bad-dl-completed', 'fresh-matter', 'مكتمل ناقص', 'COMPLETED', 'u1', 'u1', now());
        `)
      ).rejects.toThrow(/deadline_completed_fields_check/);
    } finally {
      await fresh.pool.end().catch(() => {});
      await fresh.drop().catch(() => {});
    }

    // 2. Populated T08 -> T09 upgrade preserves existing Matter/Proceeding/Hearing/Task/JobRun rows
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-t08-baseline-'));
    const upgraded = await createDedicatedTestDatabase();
    try {
      const schema = path.join(stageDir, 'schema.prisma');
      const migrations = path.join(stageDir, 'migrations');
      fs.mkdirSync(migrations);
      fs.copyFileSync(path.resolve('prisma/schema.prisma'), schema);
      for (const name of fs.readdirSync(path.resolve('prisma/migrations'))) {
        if (name === 'migration_lock.toml' || name < '20261123000000') {
          fs.cpSync(path.resolve('prisma/migrations', name), path.join(migrations, name), {
            recursive: true,
          });
        }
      }
      runPrismaMigrateDeploy(upgraded.url, schema);

      await upgraded.pool.query(`
        INSERT INTO "court" ("id", "name", "createdById", "updatedById", "updatedAt")
        VALUES ('t08-court', 'محكمة الترقية T08', 'u1', 'u1', now());
        INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "createdById", "updatedById", "updatedAt")
        VALUES ('t08-matter', 'LO-2027-0888', 'ملف قبل ترقية T09', 'LITIGATION', 'ACTIVE', 'u1', 'u1', now());
        INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "createdById", "updatedById", "updatedAt")
        VALUES ('t08-proc', 't08-matter', 't08-court', 'FIRST_INSTANCE', '555', '2027', 'مدني', 'ACTIVE', 'u1', 'u1', now());
        INSERT INTO "hearing" ("id", "proceeding_id", "hearing_date", "created_by_id", "updated_by_id", "updated_at")
        VALUES ('t08-hearing', 't08-proc', '2027-06-01', 'u1', 'u1', now());
        INSERT INTO "task" ("id", "matter_id", "proceeding_id", "hearing_id", "title", "due_date", "status", "created_by_id", "updated_by_id", "updated_at")
        VALUES ('t08-task', 't08-matter', 't08-proc', 't08-hearing', 'مهمة قائمة من T08', '2027-05-25', 'OPEN', 'u1', 'u1', now());
        INSERT INTO "job_run" ("id", "source_id", "scheduled_at", "deduplication_key", "payload", "updated_at")
        VALUES ('t08-job', 't08-hearing', '2027-06-01T00:00:00Z', 'hearing_reminder_t08-hearing', '{"hearingId":"t08-hearing"}'::jsonb, now());
      `);

      // Apply full current migrations (including 20261123000000_t09_deadlines_tasks_agenda)
      runPrismaMigrateDeploy(upgraded.url);

      const preservedTask = await upgraded.pool.query(
        `SELECT id, matter_id, title, due_date::text AS due_date, status::text AS status FROM "task" WHERE id = 't08-task'`
      );
      expect(preservedTask.rows).toEqual([
        {
          id: 't08-task',
          matter_id: 't08-matter',
          title: 'مهمة قائمة من T08',
          due_date: '2027-05-25',
          status: 'OPEN',
        },
      ]);

      // Standalone task and IN_PROGRESS status work post-upgrade
      const standaloneRes = await upgraded.pool.query(
        `INSERT INTO "task" ("id", "title", "status", "created_by_id", "updated_by_id", "updated_at")
         VALUES ('t09-task', 'مهمة عامة بعد الترقية', 'IN_PROGRESS', 'u1', 'u1', now())
         RETURNING id, matter_id, status::text AS status`
      );
      expect(standaloneRes.rows[0]).toEqual({
        id: 't09-task',
        matter_id: null,
        status: 'IN_PROGRESS',
      });
    } finally {
      await upgraded.pool.end().catch(() => {});
      await upgraded.drop().catch(() => {});
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }, 60_000);
});
