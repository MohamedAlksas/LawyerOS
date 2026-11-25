import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import { AuthorizationError } from '@/modules/identity/types';
import { addProceeding, openMatter } from '@/modules/matters/matter-service';
import {
  cancelDeadline,
  cancelHearing,
  changeDeadlineDate,
  completeDeadline,
  confirmDeadline,
  createDeadline,
  getDeadline,
  rescheduleHearing,
  scheduleHearing,
} from '@/modules/scheduling';
import { completeTask, createTask, getTask, updateTask } from '@/modules/productivity';
import {
  ConcurrencyConflictError,
  listInbox,
  listReminderRules,
  markReminderRead,
  NotFoundError,
  ReminderValidationError,
  retryFailedReminderJob,
  UnauthorizedError,
  UnsupportedTransitionError,
  updateReminderRule,
} from '@/modules/reminders';
import {
  claimNextReminderJob,
  processClaimedReminderJob,
  runReminderWorkerTick,
} from '@/worker/reminder-worker';
import { GET as getInboxRoute } from '@/app/api/reminders/inbox/route';
import { POST as postMarkReadRoute } from '@/app/api/reminders/inbox/[id]/read/route';
import { POST as postRetryJobRoute } from '@/app/api/reminders/jobs/[id]/retry/route';
import { GET as getRulesRoute, PATCH as patchRulesRoute } from '@/app/api/reminders/rules/route';
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

describe('T10 Integration Tests: Durable Reminders, Leases, Retries & Inbox (PG)', () => {
  const prisma = getPrismaClient();
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const owner = createSyntheticActor({
    id: `t10-owner-${runSuffix}`,
    name: 'الأستاذ أحمد المحامي اختبار T10',
    email: `t10.owner.${runSuffix}@lawoffice.test`,
  });
  const maintainer = createSyntheticMaintainer({
    id: `t10-maintainer-${runSuffix}`,
    email: `t10.maintainer.${runSuffix}@lawoffice.test`,
  });

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdHearingIds: string[] = [];
  const createdDeadlineIds: string[] = [];

  let courtId: string;
  let matterId: string;
  let proceedingId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    // Remove any orphaned job_run rows left behind by prior test suites whose source rows were deleted
    await prisma.$executeRaw`
      DELETE FROM "job_run"
      WHERE ("source_type" = 'Hearing' AND NOT EXISTS (SELECT 1 FROM "hearing" h WHERE h."id" = "job_run"."source_id"))
         OR ("source_type" = 'Deadline' AND NOT EXISTS (SELECT 1 FROM "deadline" d WHERE d."id" = "job_run"."source_id"))
         OR ("source_type" = 'Task' AND NOT EXISTS (SELECT 1 FROM "task" t WHERE t."id" = "job_run"."source_id"))
    `;

    const ts = Date.now();
    const court = await prisma.court.create({
      data: {
        name: `محكمة استئناف القاهرة اختبار T10 ${ts}`,
        code: `T10-${ts.toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    courtId = court.id;
    createdCourtIds.push(court.id);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `موكل اختبار التذكيرات T10 ${ts}`,
        nameNormalized: `موكل اختبار التذكيرات T10 ${ts}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(party.id);

    const m = await openMatter(owner, {
      title: `ملف قضية اختبار التذكيرات T10 ${ts}`,
      kind: 'LITIGATION',
      initialClientId: party.id,
      idempotencyKey: crypto.randomUUID(),
    });
    matterId = m.matter.id;
    createdMatterIds.push(matterId);

    const p = await addProceeding(owner, {
      matterId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: '7101',
      yearLabel: '2027',
      registerType: 'مدني كلي',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingId = p.id;
  });

  afterEach(async () => {
    await prisma.reminderDelivery.deleteMany({
      where: { recipientUserId: owner.id },
    });
    const sourceIds = [...createdHearingIds, ...createdDeadlineIds, ...createdTaskIds];
    if (sourceIds.length > 0) {
      await prisma.jobRun.deleteMany({
        where: { sourceId: { in: sourceIds } },
      });
    }
    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
      createdTaskIds.length = 0;
    }
    if (createdDeadlineIds.length > 0) {
      await prisma.deadline.deleteMany({ where: { id: { in: createdDeadlineIds } } });
      createdDeadlineIds.length = 0;
    }
    if (createdHearingIds.length > 0) {
      await prisma.hearingLink.deleteMany({
        where: {
          OR: [
            { fromHearingId: { in: createdHearingIds } },
            { toHearingId: { in: createdHearingIds } },
          ],
        },
      });
      await prisma.hearing.deleteMany({ where: { id: { in: createdHearingIds } } });
      createdHearingIds.length = 0;
    }
    await prisma.workerHeartbeat.deleteMany({ where: { id: 'reminder-worker' } });
  });

  afterAll(async () => {
    await prisma.reminderDelivery.deleteMany({
      where: { recipientUserId: owner.id },
    });

    const sourceIds = [...createdHearingIds, ...createdDeadlineIds, ...createdTaskIds];
    if (sourceIds.length > 0) {
      await prisma.jobRun.deleteMany({
        where: { sourceId: { in: sourceIds } },
      });
    }
    if (createdMatterIds.length > 0) {
      const mDeadlines = (
        await prisma.deadline.findMany({
          where: { matterId: { in: createdMatterIds } },
          select: { id: true },
        })
      ).map((d) => d.id);
      const mTasks = (
        await prisma.task.findMany({
          where: { matterId: { in: createdMatterIds } },
          select: { id: true },
        })
      ).map((t) => t.id);
      const mHearings = (
        await prisma.hearing.findMany({
          where: { proceeding: { matterId: { in: createdMatterIds } } },
          select: { id: true },
        })
      ).map((h) => h.id);
      const allMatterSources = [...mDeadlines, ...mTasks, ...mHearings];
      if (allMatterSources.length > 0) {
        await prisma.jobRun.deleteMany({
          where: { sourceId: { in: allMatterSources } },
        });
      }
    }

    await prisma.auditEvent.deleteMany({ where: { userId: owner.id } });
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: owner.id } });
    await prisma.workerHeartbeat.deleteMany({ where: { id: 'reminder-worker' } });

    if (createdTaskIds.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    }
    if (createdDeadlineIds.length > 0) {
      await prisma.deadline.deleteMany({ where: { id: { in: createdDeadlineIds } } });
    }
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  it('T10-TC-01: Races two worker claims cleanly, fences expired holder, reclaims expired lease, and yields one inbox item', async () => {
    const dedicated = await createDedicatedTestDatabase();
    const dedicatedPrisma = new PrismaClient({ adapter: new PrismaPg(dedicated.pool) });
    try {
      runPrismaMigrateDeploy(dedicated.url);

      // Seed isolated court, matter, proceeding, hearing (2027-06-20), and 1 due JobRun
      const court = await dedicatedPrisma.court.create({
        data: {
          name: 'محكمة سباق العمال',
          isActive: true,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const matter = await dedicatedPrisma.matter.create({
        data: {
          fileCode: 'LO-2027-9001',
          title: 'قضية سباق العمال',
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const proc = await dedicatedPrisma.proceeding.create({
        data: {
          matterId: matter.id,
          courtId: court.id,
          instance: 'FIRST_INSTANCE',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      const hearing = await dedicatedPrisma.hearing.create({
        data: {
          proceedingId: proc.id,
          hearingDate: new Date('2027-06-20T00:00:00.000Z'),
          hearingTime: null,
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const dueAt = new Date('2027-06-13T06:00:00.000Z'); // 7 days before 2027-06-20 @ 09:00 Cairo (UTC+3)
      const job = await dedicatedPrisma.jobRun.create({
        data: {
          jobType: 'REMINDER_DELIVERY',
          sourceType: 'Hearing',
          sourceId: hearing.id,
          sourceVersion: 1,
          scheduledAt: dueAt,
          availableAt: dueAt,
          status: 'PENDING',
          deduplicationKey: `hearing_reminder_${hearing.id}`,
          payload: {
            hearingId: hearing.id,
            proceedingId: proc.id,
            hearingDate: '2027-06-20',
            hearingTime: null,
            sourceVersion: 1,
            recipientUserId: owner.id,
          },
        },
      });

      // Race two workers at t0 = 2027-06-13T06:01:00Z
      const t0 = new Date('2027-06-13T06:01:00.000Z');
      const [claimA, claimB] = await Promise.all([
        claimNextReminderJob(dedicatedPrisma, {
          now: t0,
          workerId: 'worker-A',
          leaseDurationMs: 60_000,
        }),
        claimNextReminderJob(dedicatedPrisma, {
          now: t0,
          workerId: 'worker-B',
          leaseDurationMs: 60_000,
        }),
      ]);

      const winners = [claimA, claimB].filter((c) => c !== null);
      expect(winners).toHaveLength(1);
      const firstHolder = winners[0]!;
      expect(firstHolder.id).toBe(job.id);
      expect(firstHolder.attemptCount).toBe(1);

      // Before lease expiry (t0 + 30s), a second worker cannot claim
      const tBeforeExpiry = new Date('2027-06-13T06:01:30.000Z');
      const blockedClaim = await claimNextReminderJob(dedicatedPrisma, {
        now: tBeforeExpiry,
        workerId: 'worker-C',
        leaseDurationMs: 60_000,
      });
      expect(blockedClaim).toBeNull();

      // Simulate first holder crashed; advance beyond lease expiry (t0 + 65s) and restart worker-C
      const tAfterExpiry = new Date('2027-06-13T06:02:05.000Z');
      const tick = await runReminderWorkerTick({
        prismaClient: dedicatedPrisma,
        now: tAfterExpiry,
        workerId: 'worker-C',
        leaseDurationMs: 60_000,
      });

      expect(tick.claimedCount).toBe(1);
      expect(tick.deliveredCount).toBe(1);

      // Stale zombie worker-A waking up cannot deliver or overwrite
      const staleAttempt = await processClaimedReminderJob(dedicatedPrisma, firstHolder, {
        now: new Date('2027-06-13T06:02:10.000Z'),
      });
      expect(staleAttempt.outcome).toBe('skipped');

      const finalJob = await dedicatedPrisma.jobRun.findUniqueOrThrow({ where: { id: job.id } });
      expect(finalJob.status).toBe('SUCCEEDED');
      expect(finalJob.attemptCount).toBe(2);

      const deliveries = await dedicatedPrisma.reminderDelivery.findMany({
        where: { sourceType: 'Hearing', sourceId: hearing.id },
      });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe('SENT');
      expect(deliveries[0].readAt).toBeNull();
    } finally {
      await dedicatedPrisma.$disconnect().catch(() => {});
      await dedicated.pool.end().catch(() => {});
      await dedicated.drop().catch(() => {});
    }
  }, 45_000);

  it('T10-TC-02: Rolls back pre-commit failures cleanly, completes on retry, and prevents duplication on post-commit crash & replay', async () => {
    const hearing = await scheduleHearing(owner, {
      proceedingId,
      hearingDate: '2027-08-20',
      hearingTime: '10:30',
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(hearing.id);

    const tDue = new Date('2027-08-13T06:05:00.000Z'); // Only 7d rule (2027-08-13 09:00 Cairo) is due
    const preCommitTick = await runReminderWorkerTick({
      now: tDue,
      workerId: 'worker-pre-fail',
      baseBackoffMs: 30_000,
      _faultInject: 'beforeCommit',
      _faultErrorMessage: 'Simulated DB error before commit',
    });
    expect(preCommitTick.failedCount).toBeGreaterThanOrEqual(1);

    // Pre-commit failure left zero deliveries and scheduled retry after backoff
    const zeroDeliveries = await prisma.reminderDelivery.count({
      where: { sourceType: 'Hearing', sourceId: hearing.id },
    });
    expect(zeroDeliveries).toBe(0);

    const jobAfterPreFail = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `hearing_reminder_${hearing.id}` },
    });
    expect(jobAfterPreFail.status).toBe('PENDING');
    expect(jobAfterPreFail.attemptCount).toBe(1);
    expect(jobAfterPreFail.nextAttemptAt?.getTime()).toBe(tDue.getTime() + 30_000);

    // Worker poll before nextAttemptAt must not claim early
    const earlyTick = await runReminderWorkerTick({
      now: new Date(tDue.getTime() + 10_000),
      workerId: 'worker-early',
    });
    const stillPending = await prisma.jobRun.findUniqueOrThrow({
      where: { id: jobAfterPreFail.id },
    });
    expect(stillPending.attemptCount).toBe(1);
    expect(earlyTick.deliveredIds).toHaveLength(0);

    // Retry after backoff with simulated post-commit crash
    const tRetry = new Date(tDue.getTime() + 35_000);
    await expect(
      runReminderWorkerTick({
        now: tRetry,
        workerId: 'worker-after-crash',
        _faultInject: 'afterCommit',
      })
    ).rejects.toThrow(/SIMULATED_WORKER_POST_COMMIT_CRASH/);

    const deliveriesAfterCommit = await prisma.reminderDelivery.findMany({
      where: { sourceType: 'Hearing', sourceId: hearing.id },
    });
    expect(deliveriesAfterCommit).toHaveLength(1);
    const committedDelivery = deliveriesAfterCommit[0]!;

    const jobAfterPostCrash = await prisma.jobRun.findUniqueOrThrow({
      where: { id: jobAfterPreFail.id },
    });
    expect(jobAfterPostCrash.status).toBe('SUCCEEDED');

    // Replay: reset job or run worker again -> still 1 delivery with identical ID and payload
    await runReminderWorkerTick({
      now: new Date(tRetry.getTime() + 10_000),
      workerId: 'worker-replay-check',
    });
    await prisma.jobRun.update({
      where: { id: jobAfterPreFail.id },
      data: { status: 'PENDING', availableAt: tRetry },
    });
    await runReminderWorkerTick({
      now: new Date(tRetry.getTime() + 20_000),
      workerId: 'worker-replay-forced',
    });

    const deliveriesAfterReplay = await prisma.reminderDelivery.findMany({
      where: { sourceType: 'Hearing', sourceId: hearing.id },
    });
    expect(deliveriesAfterReplay).toHaveLength(1);
    expect(deliveriesAfterReplay[0]!.id).toBe(committedDelivery.id);
    expect(deliveriesAfterReplay[0]!.title).toBe(committedDelivery.title);
    expect(deliveriesAfterReplay[0]!.body).toBe(committedDelivery.body);
    expect(deliveriesAfterReplay[0]!.sourceVersion).toBe(1);
  });

  it('T10-TC-03: Rechecks live source state before delivery so date changes, cancellations, and completions suppress obsolete reminders', async () => {
    // 1. Confirmed Deadline date change while worker holds claim
    const dlA = await createDeadline(owner, {
      matterId,
      proceedingId,
      title: 'موعد طعن بالنقض اختبار T10-TC-03',
      dueDate: '2027-09-20',
      source: 'قرار محكمة',
      basisNotes: 'مراجعة يدوية',
      idempotencyKey: crypto.randomUUID(),
    });
    createdDeadlineIds.push(dlA.id);

    const confirmedA = await confirmDeadline(owner, {
      deadlineId: dlA.id,
      expectedVersion: dlA.version,
      dueDate: '2027-09-20',
      source: 'قرار محكمة',
      basisNotes: 'مراجعة يدوية',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });

    // Simulate worker holding an active claim on v2
    const jobV2 = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `deadline_reminder_${dlA.id}_v${confirmedA.version}` },
    });
    const claimedV2 = {
      id: jobV2.id,
      sourceType: jobV2.sourceType,
      sourceId: jobV2.sourceId,
      sourceVersion: jobV2.sourceVersion,
      payloadVersion: jobV2.payloadVersion,
      scheduledAt: jobV2.scheduledAt,
      availableAt: jobV2.availableAt,
      attemptCount: 1,
      maxAttempts: 5,
      leaseUntil: new Date('2027-09-13T07:00:00.000Z'),
      lockedBy: 'worker-claim-race',
      payload: jobV2.payload as Record<string, unknown>,
    };
    await prisma.jobRun.update({
      where: { id: jobV2.id },
      data: {
        status: 'RUNNING',
        lockedBy: 'worker-claim-race',
        leaseUntil: claimedV2.leaseUntil,
        attemptCount: 1,
      },
    });

    // Lawyer changes deadline date before delivery commits -> returns to DRAFT (v3), cancels old jobs
    const changed = await changeDeadlineDate(owner, {
      deadlineId: dlA.id,
      expectedVersion: confirmedA.version,
      dueDate: '2027-09-28',
      reason: 'تعديل الميعاد بعد مراجعة المحضر',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(changed.status).toBe('DRAFT');

    // Worker wakes up to process v2 claim -> fenced & cancelled, 0 deliveries
    const v2Outcome = await processClaimedReminderJob(prisma, claimedV2, {
      now: new Date('2027-09-13T06:05:00.000Z'),
    });
    expect(v2Outcome.outcome).toBe('skipped');
    expect(
      await prisma.reminderDelivery.count({ where: { sourceType: 'Deadline', sourceId: dlA.id } })
    ).toBe(0);

    // Reconfirm at v4 (2027-09-28) -> only current version v4 delivers
    const reconfirmed = await confirmDeadline(owner, {
      deadlineId: dlA.id,
      expectedVersion: changed.version,
      dueDate: '2027-09-28',
      source: 'محضر منقح',
      basisNotes: 'تاريخ جديد مؤكد',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });
    await runReminderWorkerTick({
      now: new Date('2027-09-21T06:05:00.000Z'), // 7d before 2027-09-28
      workerId: 'worker-dl-v4',
    });
    const dlDeliveries = await prisma.reminderDelivery.findMany({
      where: { sourceType: 'Deadline', sourceId: dlA.id },
    });
    expect(dlDeliveries).toHaveLength(1);
    expect(dlDeliveries[0]!.sourceVersion).toBe(reconfirmed.version);

    // 2. Complete a confirmed deadline while worker holds RUNNING claim (even if JobRun wasn't cancelled yet)
    const dlB = await createDeadline(owner, {
      matterId,
      proceedingId,
      title: 'موعد إيداع أسباب التماس اختبار completion',
      dueDate: '2027-10-15',
      source: 'محضر',
      basisNotes: 'مراجعة',
      idempotencyKey: crypto.randomUUID(),
    });
    createdDeadlineIds.push(dlB.id);
    const confB = await confirmDeadline(owner, {
      deadlineId: dlB.id,
      expectedVersion: dlB.version,
      dueDate: '2027-10-15',
      source: 'محضر',
      basisNotes: 'مراجعة',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });
    await completeDeadline(owner, {
      deadlineId: dlB.id,
      expectedVersion: confB.version,
      completionDescription: 'تم الإيداع فعلياً بالمحكمة',
      completionDate: '2027-10-01',
      idempotencyKey: crypto.randomUUID(),
    });
    // Force job back to RUNNING for worker-recheck proof
    const jobB = await prisma.jobRun.update({
      where: { deduplicationKey: `deadline_reminder_${dlB.id}_v${confB.version}` },
      data: { status: 'RUNNING', lockedBy: 'worker-recheck-b', leaseUntil: new Date('2027-10-10T00:00:00Z') },
    });
    const outcomeB = await processClaimedReminderJob(
      prisma,
      {
        id: jobB.id,
        sourceType: 'Deadline',
        sourceId: dlB.id,
        sourceVersion: jobB.sourceVersion,
        payloadVersion: 1,
        scheduledAt: jobB.scheduledAt,
        availableAt: jobB.availableAt,
        attemptCount: 1,
        maxAttempts: 5,
        leaseUntil: jobB.leaseUntil!,
        lockedBy: 'worker-recheck-b',
        payload: jobB.payload as Record<string, unknown>,
      },
      { now: new Date('2027-10-08T06:05:00Z') }
    );
    expect(outcomeB.outcome).toBe('cancelled');
    expect(
      await prisma.reminderDelivery.count({ where: { sourceType: 'Deadline', sourceId: dlB.id } })
    ).toBe(0);

    // 3. Cancel & Reschedule Hearing suppress obsolete notifications
    const hCancel = await scheduleHearing(owner, {
      proceedingId,
      hearingDate: '2027-10-20',
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(hCancel.id);
    await cancelHearing(owner, {
      hearingId: hCancel.id,
      expectedVersion: hCancel.version,
      reason: 'إلغاء قبل الانعقاد',
      idempotencyKey: crypto.randomUUID(),
    });
    const hJob = await prisma.jobRun.update({
      where: { deduplicationKey: `hearing_reminder_${hCancel.id}` },
      data: { status: 'RUNNING', lockedBy: 'worker-recheck-h', leaseUntil: new Date('2027-10-15T00:00:00Z') },
    });
    const outcomeH = await processClaimedReminderJob(
      prisma,
      {
        id: hJob.id,
        sourceType: 'Hearing',
        sourceId: hCancel.id,
        sourceVersion: 1,
        payloadVersion: 1,
        scheduledAt: hJob.scheduledAt,
        availableAt: hJob.availableAt,
        attemptCount: 1,
        maxAttempts: 5,
        leaseUntil: hJob.leaseUntil!,
        lockedBy: 'worker-recheck-h',
        payload: hJob.payload as Record<string, unknown>,
      },
      { now: new Date('2027-10-13T06:05:00Z') }
    );
    expect(outcomeH.outcome).toBe('cancelled');
    expect(
      await prisma.reminderDelivery.count({ where: { sourceType: 'Hearing', sourceId: hCancel.id } })
    ).toBe(0);

    // Reschedule creates new hearing and cancels old
    const hOrig = await scheduleHearing(owner, {
      proceedingId,
      hearingDate: '2027-11-10',
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(hOrig.id);
    const resched = await rescheduleHearing(owner, {
      hearingId: hOrig.id,
      expectedVersion: hOrig.version,
      newHearingDate: '2027-11-20',
      reason: 'إعادة جدولة',
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(resched.replacementHearing.id);
    expect(
      (await prisma.jobRun.findUniqueOrThrow({ where: { deduplicationKey: `hearing_reminder_${hOrig.id}` } }))
        .status
    ).toBe('CANCELLED');
    expect(
      (
        await prisma.jobRun.findUniqueOrThrow({
          where: { deduplicationKey: `hearing_reminder_${resched.replacementHearing.id}` },
        })
      ).status
    ).toBe('PENDING');
  });

  it('T10-TC-04: Fires unknown-time hearing reminder at configured Cairo DST instant twice with 1 inbox item while keeping hearingTime null', async () => {
    // 2027-05-07 minus 7 days = 2027-04-30 (Egypt spring DST transition day, UTC+3 => 09:00 Cairo = 06:00:00Z)
    const untimedHearing = await scheduleHearing(owner, {
      proceedingId,
      hearingDate: '2027-05-07',
      hearingTime: null,
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(untimedHearing.id);

    const primaryJob = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `hearing_reminder_${untimedHearing.id}` },
    });
    expect(primaryJob.scheduledAt.toISOString()).toBe('2027-04-30T06:00:00.000Z');

    const fireNow = new Date('2027-04-30T06:00:00.000Z');
    await runReminderWorkerTick({ now: fireNow, workerId: 'worker-dst-1' });
    await runReminderWorkerTick({ now: fireNow, workerId: 'worker-dst-2' });

    const deliveries = await prisma.reminderDelivery.findMany({
      where: { sourceType: 'Hearing', sourceId: untimedHearing.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.body).toContain('الساعة غير محددة');

    const persistedHearing = await prisma.hearing.findUniqueOrThrow({
      where: { id: untimedHearing.id },
    });
    expect(persistedHearing.hearingTime).toBeNull();

    // Verify 3-day follow-up rule chained cleanly (2027-05-04 09:00 Cairo = 06:00Z)
    const nextJob = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `reminder_Hearing_${untimedHearing.id}_v1_r3` },
    });
    expect(nextJob.status).toBe('PENDING');
    expect(nextJob.availableAt.toISOString()).toBe('2027-05-04T06:00:00.000Z');
  });

  it('T10-TC-05: Stops at bounded retry limit, exposes terminal failure & safe manual retry, and keeps SENT/readAt independent from Task/Deadline', async () => {
    const dl = await createDeadline(owner, {
      matterId,
      proceedingId,
      title: 'موعد استئناف اختبار الفشل النهائي والقراءة',
      dueDate: '2027-12-20',
      source: 'حكم محكمة أول درجة',
      basisNotes: 'احتساب يدوي',
      idempotencyKey: crypto.randomUUID(),
    });
    createdDeadlineIds.push(dl.id);
    const confDl = await confirmDeadline(owner, {
      deadlineId: dl.id,
      expectedVersion: dl.version,
      dueDate: '2027-12-20',
      source: 'حكم محكمة أول درجة',
      basisNotes: 'احتساب يدوي',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });

    const linkedTask = await createTask(owner, {
      title: 'مهمة تحضير صحيفة الاستئناف المرتبطة',
      matterId,
      proceedingId,
      deadlineId: dl.id,
      idempotencyKey: crypto.randomUUID(),
    });
    createdTaskIds.push(linkedTask.id);

    let clock = new Date('2027-12-13T07:05:00.000Z'); // 7 days before 2027-12-20 @ 09:00 Cairo (UTC+2)
    for (let attempt = 1; attempt <= 5; attempt++) {
      await runReminderWorkerTick({
        now: clock,
        workerId: `worker-fail-${attempt}`,
        baseBackoffMs: 30_000,
        maxBackoffMs: 900_000,
        _faultInject: 'beforeCommit',
        _faultErrorMessage: `Transient outage attempt ${attempt}`,
      });
      const stepDelay = Math.min(30_000 * Math.pow(2, attempt - 1), 900_000);
      clock = new Date(clock.getTime() + stepDelay + 1_000);
    }

    const failedJob = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `deadline_reminder_${dl.id}_v${confDl.version}` },
    });
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.attemptCount).toBe(5);

    // Terminal failure visible in inbox
    const inboxFailed = await listInbox(owner, {}, { now: clock });
    expect(inboxFailed.workerHealth.status).toBe('FAILED');
    expect(inboxFailed.failedJobs.some((j) => j.id === failedJob.id)).toBe(true);

    // Deliberate retry resets safely and is idempotent
    const retryKey = crypto.randomUUID();
    const retryRes = await retryFailedReminderJob(
      owner,
      { jobRunId: failedJob.id, idempotencyKey: retryKey },
      { now: clock }
    );
    expect(retryRes.status).toBe('PENDING');
    expect(retryRes.attemptCount).toBe(0);
    expect(
      await retryFailedReminderJob(
        owner,
        { jobRunId: failedJob.id, idempotencyKey: retryKey },
        { now: clock }
      )
    ).toEqual(retryRes);

    // Run worker cleanly -> delivers SENT item with readAt=null
    const afterRetryClock = new Date(clock.getTime() + 1_000);
    await runReminderWorkerTick({ now: afterRetryClock, workerId: 'worker-recovered' });

    const inboxDelivered = await listInbox(owner, {}, { now: afterRetryClock });
    expect(inboxDelivered.workerHealth.status).toBe('HEALTHY');
    const item = inboxDelivered.items.find((i) => i.sourceId === dl.id && i.sourceType === 'Deadline');
    expect(item).toBeDefined();
    expect(item!.status).toBe('SENT');
    expect(item!.readAt).toBeNull();
    expect(item!.isRead).toBe(false);

    // Mark reminder read -> readAt set, status remains SENT, Task remains OPEN, Deadline remains CONFIRMED
    const marked = await markReminderRead(
      owner,
      { deliveryId: item!.id },
      { now: new Date(afterRetryClock.getTime() + 5_000) }
    );
    expect(marked.status).toBe('SENT');
    expect(marked.readAt).not.toBeNull();
    expect(marked.isRead).toBe(true);

    expect((await getDeadline(owner, dl.id)).status).toBe('CONFIRMED');
    expect((await getTask(owner, linkedTask.id)).status).toBe('OPEN');

    // Cancelling a Deadline also clears any terminal FAILED reminder job so obsolete failures vanish from /inbox
    await prisma.jobRun.updateMany({
      where: { sourceType: 'Deadline', sourceId: dl.id, status: 'PENDING' },
      data: { status: 'FAILED', lastError: 'فشل قبل الإلغاء' },
    });
    const cancelledDl = await cancelDeadline(owner, {
      deadlineId: dl.id,
      expectedVersion: confDl.version,
      reason: 'إلغاء الموعد بعد تعذر الإرسال',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(cancelledDl.status).toBe('CANCELLED');
    expect(
      await prisma.jobRun.count({
        where: { sourceType: 'Deadline', sourceId: dl.id, status: 'FAILED' },
      })
    ).toBe(0);
  });

  it('T10-TC-06: Blocks all jobs in RESTORE_MODE/dispatch-disabled, rejects unauthorized HTTP/service callers, and redacts secrets/bytes', async () => {
    const task = await createTask(owner, {
      title: 'مهمة اختبار وضع الاستعادة والحماية',
      matterId,
      dueDate: '2027-07-10',
      idempotencyKey: crypto.randomUUID(),
    });
    createdTaskIds.push(task.id);

    const prevRestore = process.env.RESTORE_MODE;
    process.env.RESTORE_MODE = 'true';
    try {
      const restoreTick = await runReminderWorkerTick({
        now: new Date('2027-07-09T08:00:00.000Z'),
        workerId: 'worker-restore-check',
      });
      expect(restoreTick.restoreMode).toBe(true);
      expect(restoreTick.claimedCount).toBe(0);
      expect(restoreTick.deliveredCount).toBe(0);

      const pendingTaskJob = await prisma.jobRun.findUniqueOrThrow({
        where: { deduplicationKey: `task_reminder_${task.id}_v1` },
      });
      expect(pendingTaskJob.status).toBe('PENDING');

      const inboxInRestore = await listInbox(owner);
      expect(inboxInRestore.workerHealth.status).toBe('RESTORE_MODE');
    } finally {
      if (prevRestore === undefined) delete process.env.RESTORE_MODE;
      else process.env.RESTORE_MODE = prevRestore;
    }

    // Complete task and verify secret redaction on simulated error
    const doneTask = await completeTask(owner, {
      taskId: task.id,
      expectedVersion: task.version,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(doneTask.status).toBe('DONE');

    // Secret-bearing worker failure gets sanitized before persistence & inbox serialization
    const secretDl = await createDeadline(owner, {
      matterId,
      proceedingId,
      title: 'موعد فحص تنقيح الأسرار',
      dueDate: '2027-07-15',
      source: 'محضر',
      basisNotes: 'سند',
      idempotencyKey: crypto.randomUUID(),
    });
    createdDeadlineIds.push(secretDl.id);
    const confSecretDl = await confirmDeadline(owner, {
      deadlineId: secretDl.id,
      expectedVersion: secretDl.version,
      dueDate: '2027-07-15',
      source: 'محضر',
      basisNotes: 'سند',
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });

    await runReminderWorkerTick({
      now: new Date('2027-07-08T07:05:00.000Z'),
      workerId: 'worker-secret-test',
      _faultInject: 'beforeCommit',
      _faultErrorMessage:
        'Connect error postgresql://admin:SuperSecretDbPass99@10.20.30.40:5432/prod Bearer secret_tok_abc123',
    });
    const secretJob = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `deadline_reminder_${secretDl.id}_v${confSecretDl.version}` },
    });
    expect(secretJob.lastError).not.toContain('SuperSecretDbPass99');
    expect(secretJob.lastError).not.toContain('secret_tok_abc123');

    // Service RBAC checks: unauthenticated & MAINTAINER rejected
    const nullActor = null as unknown as Parameters<typeof listInbox>[0];
    await expect(listInbox(nullActor)).rejects.toThrow(UnauthorizedError);
    await expect(listInbox(maintainer)).rejects.toThrow(AuthorizationError);
    await expect(listReminderRules(maintainer)).rejects.toThrow(AuthorizationError);
    await expect(
      markReminderRead(maintainer, { deliveryId: crypto.randomUUID() })
    ).rejects.toThrow(AuthorizationError);
    await expect(
      retryFailedReminderJob(maintainer, {
        jobRunId: secretJob.id,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(AuthorizationError);
    await expect(
      updateReminderRule(maintainer, {
        ruleId: crypto.randomUUID(),
        expectedVersion: 1,
        enabled: false,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(AuthorizationError);

    // Direct HTTP route checks (unauthenticated 401, cross-origin 403, no-store headers)
    const trustedOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const unauthInbox = await getInboxRoute(new Request(`${trustedOrigin}/api/reminders/inbox`));
    expect(unauthInbox.status).toBe(401);
    expect(unauthInbox.headers.get('cache-control')).toBe('private, no-store');

    const unauthRules = await getRulesRoute(new Request(`${trustedOrigin}/api/reminders/rules`));
    expect(unauthRules.status).toBe(401);

    const crossOriginRead = await postMarkReadRoute(
      new Request(`${trustedOrigin}/api/reminders/inbox/${crypto.randomUUID()}/read`, {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: crypto.randomUUID() }) }
    );
    expect(crossOriginRead.status).toBe(403);
    expect(crossOriginRead.headers.get('cache-control')).toBe('private, no-store');

    const crossSiteRetry = await postRetryJobRoute(
      new Request(`${trustedOrigin}/api/reminders/jobs/${secretJob.id}/retry`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      }),
      { params: Promise.resolve({ id: secretJob.id }) }
    );
    expect(crossSiteRetry.status).toBe(403);

    const unauthPatchRules = await patchRulesRoute(
      new Request(`${trustedOrigin}/api/reminders/rules`, {
        method: 'PATCH',
        headers: { origin: trustedOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({
          ruleId: crypto.randomUUID(),
          expectedVersion: 1,
          enabled: false,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(unauthPatchRules.status).toBe(401);

    // Rule update validation & optimistic concurrency check
    const rules = await listReminderRules(owner);
    expect(rules.length).toBeGreaterThanOrEqual(7);
    const taskRule = rules.find((r) => r.eventType === 'TASK')!;
    const updatedRule = await updateReminderRule(owner, {
      ruleId: taskRule.id,
      expectedVersion: taskRule.version,
      reminderTime: '10:00',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(updatedRule.reminderTime).toBe('10:00');
    expect(updatedRule.version).toBe(taskRule.version + 1);

    await expect(
      updateReminderRule(owner, {
        ruleId: taskRule.id,
        expectedVersion: taskRule.version, // stale version
        reminderTime: '11:00',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    await expect(
      updateReminderRule(owner, {
        ruleId: updatedRule.id,
        expectedVersion: updatedRule.version,
        reminderTime: '25:00',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(ReminderValidationError);

    const hearingRule7 = rules.find((r) => r.eventType === 'HEARING' && r.dayOffset === 7)!;
    await expect(
      updateReminderRule(owner, {
        ruleId: hearingRule7.id,
        expectedVersion: hearingRule7.version,
        dayOffset: 3, // duplicates existing HEARING dayOffset=3 rule
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(ReminderValidationError);

    // Restore original rule time
    await updateReminderRule(owner, {
      ruleId: updatedRule.id,
      expectedVersion: updatedRule.version,
      reminderTime: '09:00',
      idempotencyKey: crypto.randomUUID(),
    });

    // REMINDER_DISPATCH_DISABLED blocks all dispatch without advancing deliveries
    const blockedTask = await createTask(owner, {
      title: 'مهمة فحص تعطيل الإرسال REMINDER_DISPATCH_DISABLED',
      matterId,
      dueDate: '2027-07-12',
      idempotencyKey: crypto.randomUUID(),
    });
    createdTaskIds.push(blockedTask.id);
    const prevDisabled = process.env.REMINDER_DISPATCH_DISABLED;
    process.env.REMINDER_DISPATCH_DISABLED = 'true';
    try {
      const disabledTick = await runReminderWorkerTick({
        now: new Date('2027-07-11T08:00:00.000Z'),
        workerId: 'worker-dispatch-disabled-check',
      });
      expect(disabledTick.restoreMode).toBe(true);
      expect(disabledTick.claimedCount).toBe(0);
      expect(disabledTick.deliveredCount).toBe(0);
      const pendingBlockedJob = await prisma.jobRun.findUniqueOrThrow({
        where: { deduplicationKey: `task_reminder_${blockedTask.id}_v1` },
      });
      expect(pendingBlockedJob.status).toBe('PENDING');
    } finally {
      if (prevDisabled === undefined) delete process.env.REMINDER_DISPATCH_DISABLED;
      else process.env.REMINDER_DISPATCH_DISABLED = prevDisabled;
    }

    // Complete secretDl/blockedTask cleanup vs full redaction verification across DB, inbox, and AuditEvent
    // Drive secretJob to terminal FAILED (4 more transient failures after attempt 1)
    let secretClock = new Date('2027-07-08T08:00:00.000Z');
    for (let i = 0; i < 4; i++) {
      await runReminderWorkerTick({
        now: secretClock,
        workerId: `worker-secret-fail-${i}`,
        baseBackoffMs: 1_000,
        maxBackoffMs: 5_000,
        _faultInject: 'beforeCommit',
        _faultErrorMessage:
          'Connect error postgresql://admin:SuperSecretDbPass99@10.20.30.40:5432/prod Bearer secret_tok_abc123',
      });
      secretClock = new Date(secretClock.getTime() + 10_000);
    }
    const terminalSecretJob = await prisma.jobRun.findUniqueOrThrow({
      where: { id: secretJob.id },
    });
    expect(terminalSecretJob.status).toBe('FAILED');

    const hbSecret = await prisma.workerHeartbeat.findUniqueOrThrow({
      where: { id: 'reminder-worker' },
    });
    expect(hbSecret.lastError ?? '').not.toContain('SuperSecretDbPass99');
    expect(hbSecret.lastError ?? '').not.toContain('secret_tok_abc123');
    expect(JSON.stringify(terminalSecretJob.payload)).not.toContain('SuperSecretDbPass99');

    const secretInbox = await listInbox(owner, {}, { now: secretClock });
    expect(secretInbox.workerHealth.lastError ?? '').not.toContain('SuperSecretDbPass99');
    expect(secretInbox.workerHealth.lastError ?? '').not.toContain('secret_tok_abc123');
    const exposedSecretFailed = secretInbox.failedJobs.find((j) => j.id === secretJob.id);
    expect(exposedSecretFailed).toBeDefined();
    expect(exposedSecretFailed!.lastError).not.toContain('SuperSecretDbPass99');
    expect(exposedSecretFailed!.lastError).not.toContain('secret_tok_abc123');

    const recentAudits = await prisma.auditEvent.findMany({
      where: { entityId: { in: [secretJob.id, secretDl.id] } },
    });
    expect(JSON.stringify(recentAudits)).not.toContain('SuperSecretDbPass99');
    expect(JSON.stringify(recentAudits)).not.toContain('secret_tok_abc123');

    // Terminal FAILED job stays idle across an extra worker poll (when no other jobs are due)
    await prisma.jobRun.updateMany({
      where: { sourceType: 'Task', sourceId: blockedTask.id },
      data: { status: 'CANCELLED' },
    });
    const idleTick = await runReminderWorkerTick({
      now: new Date(secretClock.getTime() + 60_000),
      workerId: 'worker-terminal-idle',
    });
    expect(idleTick.claimedCount).toBe(0);
    expect((await prisma.jobRun.findUniqueOrThrow({ where: { id: secretJob.id } })).status).toBe(
      'FAILED'
    );

    // Negative reminder-service edge cases: NotFoundError on unknown/other-user markReminderRead,
    // UnsupportedTransitionError on retrying non-FAILED job, IdempotencyPayloadMismatchError on mismatched retry
    await expect(
      markReminderRead(owner, { deliveryId: crypto.randomUUID() })
    ).rejects.toThrow(NotFoundError);

    const pendingJob = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `task_reminder_${blockedTask.id}_v1` },
    });
    await expect(
      retryFailedReminderJob(owner, {
        jobRunId: pendingJob.id,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(UnsupportedTransitionError);

    const retryIdemKey = crypto.randomUUID();
    await retryFailedReminderJob(owner, {
      jobRunId: secretJob.id,
      idempotencyKey: retryIdemKey,
    });
    await expect(
      retryFailedReminderJob(owner, {
        jobRunId: crypto.randomUUID(), // different jobRunId with same idempotencyKey
        idempotencyKey: retryIdemKey,
      })
    ).rejects.toThrow(IdempotencyPayloadMismatchError);
  });

  it('Preserves dated Task reminders across non-date updates, supersedes on dueDate change, and drains healthy jobs past expired max-attempt poison pills', async () => {
    // 1. Create dated Task -> update status to IN_PROGRESS + edit title/dueTime -> reminder still fires
    const taskA = await createTask(owner, {
      title: 'مهمة إجرائية أولية',
      matterId,
      proceedingId,
      dueDate: '2027-08-10',
      idempotencyKey: crypto.randomUUID(),
    });
    createdTaskIds.push(taskA.id);

    const progressedTaskA = await updateTask(owner, {
      taskId: taskA.id,
      expectedVersion: taskA.version,
      status: 'IN_PROGRESS',
      title: 'مهمة قيد التنفيذ بعد التحديث',
      dueTime: '14:30',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(progressedTaskA.version).toBe(taskA.version + 1);
    expect(progressedTaskA.status).toBe('IN_PROGRESS');

    await runReminderWorkerTick({
      now: new Date('2027-08-09T06:05:00.000Z'), // 1 day before 2027-08-10 @ 09:00 Cairo (UTC+3)
      workerId: 'worker-task-progress',
    });

    const taskADeliveries = await prisma.reminderDelivery.findMany({
      where: { sourceType: 'Task', sourceId: taskA.id },
    });
    expect(taskADeliveries).toHaveLength(1);
    expect(taskADeliveries[0]!.status).toBe('SENT');
    expect(taskADeliveries[0]!.body).toContain('مهمة قيد التنفيذ بعد التحديث');
    expect(taskADeliveries[0]!.body).toContain('2:30 م');

    // 2. Changing Task dueDate cancels old reminder JobRun and creates new versioned reminder
    const taskB = await createTask(owner, {
      title: 'مهمة سيتغير موعدها',
      matterId,
      dueDate: '2027-08-15',
      idempotencyKey: crypto.randomUUID(),
    });
    createdTaskIds.push(taskB.id);

    const rescheduledTaskB = await updateTask(owner, {
      taskId: taskB.id,
      expectedVersion: taskB.version,
      dueDate: '2027-08-22',
      idempotencyKey: crypto.randomUUID(),
    });
    const oldTaskBJob = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `task_reminder_${taskB.id}_v1` },
    });
    expect(oldTaskBJob.status).toBe('CANCELLED');
    const newTaskBJob = await prisma.jobRun.findUniqueOrThrow({
      where: { deduplicationKey: `task_reminder_${taskB.id}_v${rescheduledTaskB.version}` },
    });
    expect(newTaskBJob.status).toBe('PENDING');

    // Firing at the old date delivers 0; firing at new date delivers 1
    await runReminderWorkerTick({
      now: new Date('2027-08-14T06:05:00.000Z'),
      workerId: 'worker-task-old-date',
    });
    expect(
      await prisma.reminderDelivery.count({ where: { sourceType: 'Task', sourceId: taskB.id } })
    ).toBe(0);

    await runReminderWorkerTick({
      now: new Date('2027-08-21T06:05:00.000Z'),
      workerId: 'worker-task-new-date',
    });
    expect(
      await prisma.reminderDelivery.count({ where: { sourceType: 'Task', sourceId: taskB.id } })
    ).toBe(1);

    // 3. Expired RUNNING job at maxAttempts (poison pill) retires to FAILED without stalling healthy job behind it
    const poisonTask = await createTask(owner, {
      title: 'مهمة قفل منتهٍ عند الحد الأقصى',
      matterId,
      dueDate: '2027-09-02',
      idempotencyKey: crypto.randomUUID(),
    });
    createdTaskIds.push(poisonTask.id);
    const healthyTask = await createTask(owner, {
      title: 'مهمة سليمة خلف المهمة المتعثرة',
      matterId,
      dueDate: '2027-09-03',
      idempotencyKey: crypto.randomUUID(),
    });
    createdTaskIds.push(healthyTask.id);

    const poisonJob = await prisma.jobRun.update({
      where: { deduplicationKey: `task_reminder_${poisonTask.id}_v1` },
      data: {
        status: 'RUNNING',
        attemptCount: 5,
        maxAttempts: 5,
        lockedBy: 'crashed-worker-poison',
        leaseUntil: new Date('2027-09-01T05:00:00.000Z'),
      },
    });

    const tickWithPoison = await runReminderWorkerTick({
      now: new Date('2027-09-02T07:00:00.000Z'), // both poisonJob and healthyTask are due
      workerId: 'worker-past-poison',
    });
    expect(tickWithPoison.terminalFailedCount).toBe(1);
    expect(tickWithPoison.deliveredCount).toBe(1);

    const retiredPoison = await prisma.jobRun.findUniqueOrThrow({ where: { id: poisonJob.id } });
    expect(retiredPoison.status).toBe('FAILED');
    expect(retiredPoison.lockedBy).toBeNull();

    const healthyDeliveries = await prisma.reminderDelivery.findMany({
      where: { sourceType: 'Task', sourceId: healthyTask.id },
    });
    expect(healthyDeliveries).toHaveLength(1);
    expect(healthyDeliveries[0]!.status).toBe('SENT');
  });

  it('Reschedules pulled-forward chained jobs over CANCELLED collisions via _resched_, preserves future chaining without dropping rules, and leaves RUNNING jobs untouched', async () => {
    const rules = await listReminderRules(owner);
    const rule7 = rules.find((r) => r.eventType === 'HEARING' && r.dayOffset === 7);
    expect(rule7).toBeDefined();
    expect(rules.some((r) => r.eventType === 'HEARING' && r.dayOffset === 5)).toBe(false);

    const h1 = await scheduleHearing(owner, {
      proceedingId,
      hearingDate: '2028-02-20',
      hearingTime: null,
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(h1.id);

    const hRunning = await scheduleHearing(owner, {
      proceedingId,
      hearingDate: '2028-02-22',
      hearingTime: null,
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(hRunning.id);

    const runningPrimaryKey = `hearing_reminder_${hRunning.id}`;
    const runningOriginalLease = new Date('2028-02-25T00:00:00.000Z');
    const runningJobBefore = await prisma.jobRun.update({
      where: { deduplicationKey: runningPrimaryKey },
      data: {
        status: 'RUNNING',
        lockedBy: 'worker-concurrent-lease',
        leaseUntil: runningOriginalLease,
        attemptCount: 1,
      },
    });

    let updatedRule7Version: number | null = null;
    try {
      // Tick 1: 7 days before 2028-02-20 @ 09:00 Cairo (UTC+2) => delivers offset_7 and chains r3
      await runReminderWorkerTick({
        now: new Date('2028-02-13T07:05:00.000Z'),
        workerId: 'worker-resched-init',
      });

      const jobR3 = await prisma.jobRun.findUniqueOrThrow({
        where: { deduplicationKey: `reminder_Hearing_${h1.id}_v1_r3` },
      });
      expect(jobR3.status).toBe('PENDING');

      // Seed prior CANCELLED collision rows at r5 (for _resched_ collision) and r1 (for _chain_ collision)
      const cancelledR5 = await prisma.jobRun.create({
        data: {
          jobType: 'REMINDER_DELIVERY',
          sourceType: 'Hearing',
          sourceId: h1.id,
          sourceVersion: 1,
          scheduledAt: new Date('2028-02-15T07:00:00.000Z'),
          availableAt: new Date('2028-02-15T07:00:00.000Z'),
          status: 'CANCELLED',
          completedAt: new Date('2028-02-13T07:06:00.000Z'),
          deduplicationKey: `reminder_Hearing_${h1.id}_v1_r5`,
          payload: jobR3.payload as object,
        },
      });
      const cancelledR1 = await prisma.jobRun.create({
        data: {
          jobType: 'REMINDER_DELIVERY',
          sourceType: 'Hearing',
          sourceId: h1.id,
          sourceVersion: 1,
          scheduledAt: new Date('2028-02-19T07:00:00.000Z'),
          availableAt: new Date('2028-02-19T07:00:00.000Z'),
          status: 'CANCELLED',
          completedAt: new Date('2028-02-13T07:06:00.000Z'),
          deduplicationKey: `reminder_Hearing_${h1.id}_v1_r1`,
          payload: jobR3.payload as object,
        },
      });

      // Pull forward rule 7 -> 5: collides with CANCELLED _r5, so jobR3 moves to _resched_<id>
      const updatedRule7 = await updateReminderRule(owner, {
        ruleId: rule7!.id,
        expectedVersion: rule7!.version,
        dayOffset: 5,
        idempotencyKey: crypto.randomUUID(),
      });
      updatedRule7Version = updatedRule7.version;

      const expectedReschedKey = `reminder_Hearing_${h1.id}_v1_r5_resched_${jobR3.id}`;
      const rescheduledJob = await prisma.jobRun.findUniqueOrThrow({
        where: { id: jobR3.id },
      });
      expect(rescheduledJob.status).toBe('PENDING');
      expect(rescheduledJob.deduplicationKey).toBe(expectedReschedKey);
      expect(rescheduledJob.scheduledAt.toISOString()).toBe('2028-02-15T07:00:00.000Z');
      expect(rescheduledJob.availableAt.toISOString()).toBe('2028-02-15T07:00:00.000Z');

      // Cancelled collision rows stay CANCELLED, and concurrently RUNNING job is untouched
      expect((await prisma.jobRun.findUniqueOrThrow({ where: { id: cancelledR5.id } })).status).toBe('CANCELLED');
      const runningAfterRuleUpdate = await prisma.jobRun.findUniqueOrThrow({ where: { id: runningJobBefore.id } });
      expect(runningAfterRuleUpdate.status).toBe('RUNNING');
      expect(runningAfterRuleUpdate.lockedBy).toBe('worker-concurrent-lease');
      expect(runningAfterRuleUpdate.leaseUntil?.getTime()).toBe(runningOriginalLease.getTime());
      expect(runningAfterRuleUpdate.scheduledAt.getTime()).toBe(runningJobBefore.scheduledAt.getTime());
      expect(runningAfterRuleUpdate.availableAt.getTime()).toBe(runningJobBefore.availableAt.getTime());
      expect(runningAfterRuleUpdate.deduplicationKey).toBe(runningPrimaryKey);

      // Tick 2: 5 days before 2028-02-20 => delivers offset_5 and chains r3 without dropping it
      await runReminderWorkerTick({
        now: new Date('2028-02-15T07:05:00.000Z'),
        workerId: 'worker-resched-r5',
      });

      expect((await prisma.jobRun.findUniqueOrThrow({ where: { id: jobR3.id } })).status).toBe('SUCCEEDED');
      const chainedR3AfterTick2 = await prisma.jobRun.findUniqueOrThrow({
        where: { deduplicationKey: `reminder_Hearing_${h1.id}_v1_r3` },
      });
      expect(chainedR3AfterTick2.status).toBe('PENDING');
      expect(chainedR3AfterTick2.scheduledAt.toISOString()).toBe('2028-02-17T07:00:00.000Z');

      // Tick 3: 3 days before 2028-02-20 => delivers offset_3 and chains r1 via _chain_ over CANCELLED _r1
      await runReminderWorkerTick({
        now: new Date('2028-02-17T07:05:00.000Z'),
        workerId: 'worker-resched-r3',
      });

      expect((await prisma.jobRun.findUniqueOrThrow({ where: { id: chainedR3AfterTick2.id } })).status).toBe('SUCCEEDED');
      expect((await prisma.jobRun.findUniqueOrThrow({ where: { id: cancelledR1.id } })).status).toBe('CANCELLED');
      const chainedR1AfterTick3 = await prisma.jobRun.findUniqueOrThrow({
        where: { deduplicationKey: `reminder_Hearing_${h1.id}_v1_r1_chain_${chainedR3AfterTick2.id}` },
      });
      expect(chainedR1AfterTick3.status).toBe('PENDING');
      expect(chainedR1AfterTick3.scheduledAt.toISOString()).toBe('2028-02-19T07:00:00.000Z');

      const deliveries = await prisma.reminderDelivery.findMany({
        where: { sourceType: 'Hearing', sourceId: h1.id },
        orderBy: { scheduledAt: 'asc' },
      });
      expect(deliveries.map((d) => d.ruleKey)).toEqual(['offset_7', 'offset_5', 'offset_3']);

      const runningAfterTicks = await prisma.jobRun.findUniqueOrThrow({ where: { id: runningJobBefore.id } });
      expect(runningAfterTicks.status).toBe('RUNNING');
      expect(runningAfterTicks.lockedBy).toBe('worker-concurrent-lease');
      expect(runningAfterTicks.leaseUntil?.getTime()).toBe(runningOriginalLease.getTime());
    } finally {
      await prisma.reminderDelivery.deleteMany({
        where: { sourceType: 'Hearing', sourceId: { in: [h1.id, hRunning.id] } },
      });
      await prisma.jobRun.deleteMany({
        where: { sourceType: 'Hearing', sourceId: { in: [h1.id, hRunning.id] } },
      });
      await prisma.hearing.deleteMany({
        where: { id: { in: [h1.id, hRunning.id] } },
      });
      if (updatedRule7Version !== null) {
        const latestRules = await listReminderRules(owner);
        const currentRule = latestRules.find((r) => r.id === rule7!.id);
        if (currentRule && currentRule.dayOffset !== 7) {
          await updateReminderRule(owner, {
            ruleId: currentRule.id,
            expectedVersion: currentRule.version,
            dayOffset: 7,
            idempotencyKey: crypto.randomUUID(),
          });
        }
      }
    }
  });

  it('Migration verification: fresh deploy, SQL CHECK constraints, and populated T09-to-T10 upgrade with available_at backfill', async () => {
    const fresh = await createDedicatedTestDatabase();
    try {
      runPrismaMigrateDeploy(fresh.url);

      const seededRules = await fresh.pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM "reminder_rule"`
      );
      expect(seededRules.rows[0]?.count).toBe(7);

      await expect(
        fresh.pool.query(`
          INSERT INTO "reminder_rule" ("id", "event_type", "day_offset", "reminder_time")
          VALUES ('bad-offset', 'HEARING', -1, '09:00');
        `)
      ).rejects.toThrow(/reminder_rule_day_offset_range_check/);

      await expect(
        fresh.pool.query(`
          INSERT INTO "reminder_rule" ("id", "event_type", "day_offset", "reminder_time")
          VALUES ('bad-time', 'HEARING', 2, '25:00');
        `)
      ).rejects.toThrow(/reminder_rule_time_format_check/);

      await expect(
        fresh.pool.query(`
          INSERT INTO "job_run" ("id", "source_id", "scheduled_at", "deduplication_key", "payload", "attempt_count", "updated_at")
          VALUES ('bad-attempt', 's1', now(), 'k-bad', '{}'::jsonb, -1, now());
        `)
      ).rejects.toThrow(/job_run_attempt_count_non_negative_check/);
    } finally {
      await fresh.pool.end().catch(() => {});
      await fresh.drop().catch(() => {});
    }

    // Populated T09 -> T10 upgrade preserves existing rows and backfills job_run.available_at from scheduled_at
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-t09-baseline-'));
    const upgraded = await createDedicatedTestDatabase();
    try {
      const schema = path.join(stageDir, 'schema.prisma');
      const migrations = path.join(stageDir, 'migrations');
      fs.mkdirSync(migrations);
      fs.copyFileSync(path.resolve('prisma/schema.prisma'), schema);
      for (const name of fs.readdirSync(path.resolve('prisma/migrations'))) {
        if (name === 'migration_lock.toml' || name < '20261124000000') {
          fs.cpSync(path.resolve('prisma/migrations', name), path.join(migrations, name), {
            recursive: true,
          });
        }
      }
      runPrismaMigrateDeploy(upgraded.url, schema);

      await upgraded.pool.query(`
        INSERT INTO "court" ("id", "name", "createdById", "updatedById", "updatedAt")
        VALUES ('t09-court', 'محكمة ترقية T09', 'u1', 'u1', now());
        INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "createdById", "updatedById", "updatedAt")
        VALUES ('t09-matter', 'LO-2027-0999', 'ملف قبل ترقية T10', 'LITIGATION', 'ACTIVE', 'u1', 'u1', now());
        INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "createdById", "updatedById", "updatedAt")
        VALUES ('t09-proc', 't09-matter', 't09-court', 'FIRST_INSTANCE', '999', '2027', 'مدني', 'ACTIVE', 'u1', 'u1', now());
        INSERT INTO "hearing" ("id", "proceeding_id", "hearing_date", "created_by_id", "updated_by_id", "updated_at")
        VALUES ('t09-hearing', 't09-proc', '2027-06-15', 'u1', 'u1', now());
        INSERT INTO "job_run" ("id", "source_id", "scheduled_at", "deduplication_key", "payload", "updated_at")
        VALUES ('t09-job', 't09-hearing', '2027-06-08T06:00:00Z', 'hearing_reminder_t09-hearing', '{"hearingId":"t09-hearing"}'::jsonb, now());
      `);

      // Apply full migrations including T10
      runPrismaMigrateDeploy(upgraded.url);

      const backfilled = await upgraded.pool.query<{
        id: string;
        available_at: string;
        scheduled_at: string;
        status: string;
        source_version: number;
      }>(`
        SELECT id, available_at::text, scheduled_at::text, status::text, source_version
        FROM "job_run"
        WHERE id = 't09-job'
      `);
      expect(backfilled.rows).toHaveLength(1);
      expect(backfilled.rows[0]!.available_at).toBe(backfilled.rows[0]!.scheduled_at);
      expect(backfilled.rows[0]!.status).toBe('PENDING');
      expect(backfilled.rows[0]!.source_version).toBe(1);
    } finally {
      await upgraded.pool.end().catch(() => {});
      await upgraded.drop().catch(() => {});
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }, 60_000);
});
