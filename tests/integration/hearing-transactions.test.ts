import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { openMatter, addProceeding } from '@/modules/matters/matter-service';
import { ConcurrencyConflictError } from '@/modules/matters/matter-types';
import { IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import {
  scheduleHearing,
  recordHearingResult,
  correctHearingResult,
  rescheduleHearing,
  listHearingsForProceeding,
  getHearing,
} from '@/modules/scheduling';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

/**
 * T08 Integration Tests: Hearing Transactions & Atomicity
 *
 * Covers:
 * - T08-TC-02: Atomic result recording, adjournment, tasks, audit, and durable reminder creation
 * - T08-TC-03: Idempotent retries and payload drift detection
 * - T08-TC-04: Full rollback on injected failures (tasks / audit)
 * - T08-TC-05: Concurrency conflict rejection and result correction with history preservation
 */
describe('T08 Integration Tests: Hearing Transactions & Atomicity', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const actor2 = createSyntheticActor({
    id: 'synthetic-associate-uuid-002',
    name: 'المحامي المساعد للاختبار',
    email: 'associate@lawoffice.test',
  });

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];

  let testCourtId: string;
  let testMatterId: string;
  let testProceedingId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    const court = await prisma.court.create({
      data: {
        name: `محكمة شمال القاهرة الابتدائية - مدني ${Date.now()}`,
        code: `NCAIRO-CIVIL-${Date.now().toString().slice(-4)}`,
        isActive: true,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    testCourtId = court.id;
    createdCourtIds.push(court.id);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `كمال الدين إبراهيم ${Date.now().toString().slice(-4)}`,
        nameNormalized: `كمال الدين ابراهيم ${Date.now().toString().slice(-4)}`,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    createdPartyIds.push(party.id);

    const matterRes = await openMatter(actor, {
      title: 'قضية تعويض تجريبية لاختبار معاملات الجلسات',
      kind: 'LITIGATION',
      initialClientId: party.id,
      idempotencyKey: `open_m_tx_${crypto.randomUUID()}`,
    });
    testMatterId = matterRes.matter.id;
    createdMatterIds.push(testMatterId);

    const procRes = await addProceeding(actor, {
      matterId: testMatterId,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '4019',
      yearLabel: '2027',
      registerType: 'مدني كلي',
      idempotencyKey: `add_p_tx_${crypto.randomUUID()}`,
    });
    testProceedingId = procRes.id;
  });

  afterAll(async () => {
    if (createdMatterIds.length > 0) {
      const [hearings, tasks] = await Promise.all([
        prisma.hearing.findMany({
          where: { proceeding: { matterId: { in: createdMatterIds } } },
          select: { id: true },
        }),
        prisma.task.findMany({
          where: { matterId: { in: createdMatterIds } },
          select: { id: true },
        }),
      ]);
      const hearingIds = hearings.map((h) => h.id);
      if (hearingIds.length > 0) {
        await prisma.jobRun.deleteMany({
          where: { sourceType: 'Hearing', sourceId: { in: hearingIds } },
        });
      }
      const taskIds = tasks.map((t) => t.id);
      if (taskIds.length > 0) {
        await prisma.jobRun.deleteMany({
          where: { sourceType: 'Task', sourceId: { in: taskIds } },
        });
      }
    }
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  it('T08-TC-02: Atomically record adjournment result, next hearing, 2 tasks, audit, and reminder work', async () => {
    // 1. Scheduled hearing on 2027-01-12
    const originalHearing = await scheduleHearing(actor, {
      proceedingId: testProceedingId,
      hearingDate: '2027-01-12',
      hearingTime: '10:00',
      hearingPurpose: 'تقديم المذكرات الختامية',
      idempotencyKey: `sched_tc02_${crypto.randomUUID()}`,
    });
    expect(originalHearing.status).toBe('SCHEDULED');
    expect(originalHearing.hearingDate).toBe('2027-01-12');

    // 2. Record result «تأجيل لتقديم مذكرة» with next hearing 2027-02-09 and 2 tasks
    const decisionText = 'تأجيل لتقديم مذكرة والرد على دفاع الخصم';
    const nextDate = '2027-02-09';
    const tasks = [
      { title: 'إعداد مسودة مذكرة الدفاع في الدفوع الشكلية', priority: 'HIGH' as const },
      { title: 'استخراج شهادة رسمية من جدول المحكمة', priority: 'NORMAL' as const },
    ];
    const idemKey = `rec_tc02_${crypto.randomUUID()}`;

    const result = await recordHearingResult(actor, {
      hearingId: originalHearing.id,
      expectedVersion: originalHearing.version,
      decisionText,
      nextDateDisposition: 'KNOWN',
      nextHearingDate: nextDate,
      nextHearingTime: '10:30',
      tasks,
      idempotencyKey: idemKey,
    });

    // Verify original completed on Jan 12 (calendar day is unchanged!)
    const updatedOriginal = await getHearing(actor, originalHearing.id);
    expect(updatedOriginal.status).toBe('COMPLETED');
    expect(updatedOriginal.hearingDate).toBe('2027-01-12');

    // Verify linked next hearing created for Feb 9
    expect(result.nextHearing).toBeDefined();
    expect(result.nextHearing!.status).toBe('SCHEDULED');
    expect(result.nextHearing!.hearingDate).toBe(nextDate);

    // Verify link relation is ADJOURNED_TO
    const link = await prisma.hearingLink.findFirst({
      where: {
        fromHearingId: originalHearing.id,
        toHearingId: result.nextHearing!.id,
        relation: 'ADJOURNED_TO',
      },
    });
    expect(link).not.toBeNull();

    // Verify 2 tasks created with linked matter and proceeding
    const createdTasks = await prisma.task.findMany({
      where: { hearingId: originalHearing.id },
    });
    expect(createdTasks.length).toBe(2);
    for (const t of createdTasks) {
      expect(t.matterId).toBe(testMatterId);
      expect(t.proceedingId).toBe(testProceedingId);
      expect(t.status).toBe('OPEN');
    }

    // Verify audit event persisted
    const audit = await prisma.auditEvent.findFirst({
      where: {
        entityType: 'Hearing',
        entityId: originalHearing.id,
        action: 'RECORD_HEARING_RESULT',
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.changedFields).toMatchObject({ resultId: result.resultId });
    expect(JSON.stringify(audit?.changedFields)).not.toContain(decisionText);

    // Verify durable reminder work (JobRun outbox) created for next hearing
    const job = await prisma.jobRun.findFirst({
      where: {
        sourceType: 'Hearing',
        sourceId: result.nextHearing!.id,
        status: 'PENDING',
      },
    });
    expect(job).not.toBeNull();

    const scheduled = result.nextHearing!;
    const list = await listHearingsForProceeding(actor, testProceedingId);
    const tasksForNext = list.find(({ id }) => id === scheduled.id)?.followUpTasks;
    expect(tasksForNext?.map(({ id }) => id)).toEqual(expect.arrayContaining(createdTasks.map(({ id }) => id)));
    const [selected, unchanged] = createdTasks;
    const move = {
      hearingId: scheduled.id, expectedVersion: scheduled.version, newHearingDate: '2027-02-19',
      reason: 'تعديل موعد الجلسة وإحدى المهام', idempotencyKey: crypto.randomUUID(),
      taskChanges: [{ taskId: selected.id, expectedVersion: selected.version, dueDate: '2027-02-17' }],
    };
    const moved = await rescheduleHearing(actor, move);
    expect(await rescheduleHearing(actor, move)).toEqual(moved);
    const updated = await prisma.task.findUniqueOrThrow({ where: { id: selected.id } });
    expect(updated.hearingId).toBe(moved.replacementHearing.id);
    expect(updated.dueDate?.toISOString().slice(0, 10)).toBe('2027-02-17');
    expect(await prisma.task.findUniqueOrThrow({ where: { id: unchanged.id } })).toEqual(unchanged);
  });

  it('T08-TC-03: Idempotent retry returns original result; payload drift under same key is rejected', async () => {
    // 1. Create hearing
    const hearing = await scheduleHearing(actor, {
      proceedingId: testProceedingId,
      hearingDate: '2027-02-15',
      idempotencyKey: `sched_tc03_${crypto.randomUUID()}`,
    });

    const idemKey = `idem_tc03_${crypto.randomUUID()}`;
    const initialPayload = {
      hearingId: hearing.id,
      expectedVersion: hearing.version,
      decisionText: 'تأجيل للاطلاع والمستندات',
      nextDateDisposition: 'KNOWN' as const,
      nextHearingDate: '2027-03-15',
      tasks: [{ title: 'تصوير محضر الجلسة السابقة' }],
      idempotencyKey: idemKey,
    };

    // First save commits
    const firstRes = await recordHearingResult(actor, initialPayload);
    expect(firstRes.resultId).toBeDefined();

    // Retry with identical key and identical payload (simulating network response loss)
    const retryRes = await recordHearingResult(actor, initialPayload);
    expect(retryRes.resultId).toBe(firstRes.resultId);
    expect(retryRes.nextHearing?.id).toBe(firstRes.nextHearing?.id);
    expect(retryRes).toEqual(firstRes);
    const equivalentIntent = await recordHearingResult(actor, {
      ...initialPayload,
      decisionText: undefined,
      decision: initialPayload.decisionText,
      nextHearingDate: undefined,
      nextHearing: { hearingDate: initialPayload.nextHearingDate, hearingTime: null },
      tasks: [{ ...initialPayload.tasks[0], priority: 'NORMAL', dueDate: null }],
    });
    expect(equivalentIntent).toEqual(firstRes);
    const claim = await prisma.idempotencyRecord.findFirstOrThrow({ where: { actorId: actor.id, key: idemKey } });
    expect(JSON.stringify(claim.resultPayload)).not.toContain(initialPayload.decisionText);
    expect(JSON.stringify(claim.resultPayload)).not.toContain(initialPayload.tasks[0].title);

    // Verify NO duplicate hearings, results, or tasks were written
    const resultsCount = await prisma.hearingResult.count({ where: { hearingId: hearing.id } });
    expect(resultsCount).toBe(1);

    const tasksCount = await prisma.task.count({ where: { hearingId: hearing.id } });
    expect(tasksCount).toBe(1);

    // Resubmit same key with modified payload (changed task title)
    const driftedPayload = {
      ...initialPayload,
      tasks: [{ title: 'عنوان مختلف تماماً لاختبار رفض التلاعب' }],
    };

    await expect(recordHearingResult(actor, driftedPayload)).rejects.toThrowError(
      IdempotencyPayloadMismatchError
    );
  });

  it.each(['task', 'audit_event'] as const)('T08-TC-04: Rolls back an injected %s write failure and retries unchanged', async (table) => {
    const hearing = await scheduleHearing(actor, {
      proceedingId: testProceedingId,
      hearingDate: '2027-03-20',
      idempotencyKey: crypto.randomUUID(),
    });
    const payload = {
      hearingId: hearing.id,
      expectedVersion: hearing.version,
      decisionText: 'قرار تجريبي لفحص التراجع الكامل',
      nextDateDisposition: 'KNOWN' as const,
      nextHearingDate: '2027-04-20',
      tasks: [{ title: 'متابعة القرار التجريبي' }],
      idempotencyKey: crypto.randomUUID(),
    };
    const snapshot = async () => {
      const hearings = await prisma.hearing.findMany({ where: { proceedingId: testProceedingId }, orderBy: { id: 'asc' } });
      const ids = hearings.map(({ id }) => id);
      return {
        hearings,
        results: await prisma.hearingResult.count({ where: { hearingId: hearing.id } }),
        links: await prisma.hearingLink.count({ where: { fromHearingId: hearing.id } }),
        tasks: await prisma.task.count({ where: { proceedingId: testProceedingId } }),
        jobs: await prisma.jobRun.findMany({ where: { sourceType: 'Hearing', sourceId: { in: ids } }, orderBy: { id: 'asc' } }),
        audit: await prisma.auditEvent.count({ where: { entityId: hearing.id } }),
        claims: await prisma.idempotencyRecord.count({ where: { actorId: actor.id, key: payload.idempotencyKey } }),
      };
    };
    const before = await snapshot();
    expect(hearing.id).toMatch(/^[0-9a-f-]{36}$/);
    const constraint = 't08_test_injected_write_failure';
    const column = table === 'task' ? 'hearing_id' : '"entityId"';
    // NOT VALID checks upcoming writes without scanning unrelated fixture rows.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE ' + table + ' ADD CONSTRAINT ' + constraint + ' CHECK (' + column + " <> '" + hearing.id + "') NOT VALID",
    );
    try {
      await expect(recordHearingResult(actor, payload)).rejects.toThrow(constraint);
      expect(await snapshot()).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE ' + table + ' DROP CONSTRAINT ' + constraint);
    }

    const saved = await recordHearingResult(actor, payload);
    expect(saved.nextHearing?.id).toBeDefined();
    expect(saved.taskIds).toHaveLength(1);
    const after = await snapshot();
    expect(after.results).toBe(1);
    expect(after.links).toBe(1);
    expect(after.claims).toBe(1);
    expect(after.tasks).toBe(before.tasks + 1);
    expect(after.audit).toBe(before.audit + 1);
    expect(after.jobs.length).toBeGreaterThan(before.jobs.length);
    expect(after.hearings.find(({ id }) => id === hearing.id)?.status).toBe('COMPLETED');
  });

  it('T08-TC-05: Concurrency conflict rejection and result correction with history preservation', async () => {
    // 1. Setup hearing viewed by two sessions with version 1
    const hearing = await scheduleHearing(actor, {
      proceedingId: testProceedingId,
      hearingDate: '2027-05-15',
      idempotencyKey: `sched_tc05_${crypto.randomUUID()}`,
    });
    expect(hearing.version).toBe(1);

    const decisionText = 'حكمت المحكمة بندب خبير في الدعوى';
    const payload = {
      hearingId: hearing.id,
      expectedVersion: 1,
      decisionText,
      nextDateDisposition: 'KNOWN' as const,
      nextHearingDate: '2027-06-15',
      tasks: [{ title: 'متابعة الجلسة' }],
    };
    const submissions = await Promise.allSettled([
      recordHearingResult(actor, { ...payload, idempotencyKey: crypto.randomUUID() }),
      recordHearingResult(actor2, { ...payload, idempotencyKey: crypto.randomUUID() }),
    ]);
    const winners = submissions.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : []);
    const losers = submissions.flatMap((outcome) => outcome.status === 'rejected' ? [outcome.reason] : []);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toBeInstanceOf(ConcurrencyConflictError);
    const [session1Res] = winners;
    expect(await prisma.hearingLink.count({ where: { fromHearingId: hearing.id } })).toBe(1);
    expect(await prisma.task.count({ where: { hearingId: hearing.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: hearing.id, action: 'RECORD_HEARING_RESULT' } })).toBe(1);

    // 4. Session 2 reloads and performs correction with reason
    const reloaded = await getHearing(actor2, hearing.id);
    expect(reloaded.version).toBe(2);

    const correctionReason = 'تصحيح منطوق القرار بناءً على صورة الرول المعتمدة من سكرتير الجلسة';
    const correctedDecision = 'حكمت المحكمة تمهيدياً بإحالة الدعوى للتحقيق لإثبات واقعة الضرر';

    const corrected = await correctHearingResult(actor2, {
      hearingId: hearing.id,
      currentResultId: session1Res.resultId,
      correctionReason,
      decisionText: correctedDecision,
      nextDateDisposition: 'KNOWN',
      nextHearingDate: '2027-06-15',
      idempotencyKey: `correct_tc05_${crypto.randomUUID()}`,
    });

    expect(corrected.revision).toBe(2);
    expect(corrected.decisionText).toBe(correctedDecision);
    expect(corrected.correctionReason).toBe(correctionReason);

    // Verify prior decision is preserved in version history
    const allResults = await prisma.hearingResult.findMany({
      where: { hearingId: hearing.id },
      orderBy: { revision: 'asc' },
    });
    expect(allResults.length).toBe(2);
    expect(allResults[0].revision).toBe(1);
    expect(allResults[0].decisionText).toBe('حكمت المحكمة بندب خبير في الدعوى');
    expect(allResults[1].revision).toBe(2);
    expect(allResults[1].supersedesResultId).toBe(allResults[0].id);
    const linked = await prisma.hearingLink.findFirstOrThrow({ where: { fromHearingId: hearing.id, relation: 'ADJOURNED_TO' }, include: { toHearing: true } });
    expect(linked.toHearingId).toBe(session1Res.nextHearing?.id);
    expect(linked.toHearing.hearingDate.toISOString().slice(0, 10)).toBe('2027-06-15');
  });

  it('T08-R3: recordHearingResult persists dueTime and rescheduleHearing carries IN_PROGRESS task while clearing dueTime when dueDate is null', async () => {
    const hOrig = await scheduleHearing(actor, {
      proceedingId: testProceedingId,
      hearingDate: '2027-07-01',
      idempotencyKey: `sched_r3_${crypto.randomUUID()}`,
    });

    const recorded = await recordHearingResult(actor, {
      hearingId: hOrig.id,
      expectedVersion: hOrig.version,
      decisionText: 'تأجيل مع تحديد موعد ومهمة بوقت محدد',
      nextDateDisposition: 'KNOWN',
      nextHearingDate: '2027-08-01',
      tasks: [
        {
          title: 'مراجعة حافظة المستندات قبل الجلسة',
          dueDate: '2027-07-20',
          dueTime: '14:30',
        },
      ],
      idempotencyKey: `res_r3_${crypto.randomUUID()}`,
    });

    expect(recorded.taskIds).toHaveLength(1);
    const createdTask = await prisma.task.findUniqueOrThrow({
      where: { id: recorded.taskIds[0] },
    });
    expect(createdTask.dueDate?.toISOString().slice(0, 10)).toBe('2027-07-20');
    expect(createdTask.dueTime).toBe('14:30');

    const inProgressTask = await prisma.task.update({
      where: { id: createdTask.id },
      data: { status: 'IN_PROGRESS' },
    });

    const moved = await rescheduleHearing(actor, {
      hearingId: recorded.nextHearing!.id,
      expectedVersion: recorded.nextHearing!.version,
      newHearingDate: '2027-08-15',
      reason: 'نقل الجلسة مع مسح تاريخ استحقاق المهمة الجارية',
      taskChanges: [
        {
          taskId: inProgressTask.id,
          expectedVersion: inProgressTask.version,
          dueDate: null,
        },
      ],
      idempotencyKey: `resched_r3_${crypto.randomUUID()}`,
    });

    const carriedTask = await prisma.task.findUniqueOrThrow({
      where: { id: inProgressTask.id },
    });
    expect(carriedTask.hearingId).toBe(moved.replacementHearing.id);
    expect(carriedTask.status).toBe('IN_PROGRESS');
    expect(carriedTask.dueDate).toBeNull();
    expect(carriedTask.dueTime).toBeNull();
  });
});
