import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { openMatter, addProceeding } from '@/modules/matters/matter-service';
import { ConcurrencyConflictError } from '@/modules/matters/matter-types';
import {
  scheduleHearing,
  recordHearingResult,
  correctHearingResult,
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

    // Verify durable reminder work (JobRun outbox) created for next hearing
    const job = await prisma.jobRun.findFirst({
      where: {
        sourceType: 'Hearing',
        sourceId: result.nextHearing!.id,
        status: 'PENDING',
      },
    });
    expect(job).not.toBeNull();
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

    await expect(recordHearingResult(actor, driftedPayload)).rejects.toThrow();
  });

  it('T08-TC-04: Full rollback on injected failure (tasks / audit); retry succeeds after fix', async () => {
    // 1. Setup hearing and record baseline counts
    const hearing = await scheduleHearing(actor, {
      proceedingId: testProceedingId,
      hearingDate: '2027-03-20',
      idempotencyKey: `sched_tc04_${crypto.randomUUID()}`,
    });

    const initialHearingCount = await prisma.hearing.count();
    const initialResultCount = await prisma.hearingResult.count();
    const initialTaskCount = await prisma.task.count();
    const initialJobCount = await prisma.jobRun.count();
    const initialAuditCount = await prisma.auditEvent.count();

    // 2. Inject failure at task creation (e.g. invalid task title violating length/content constraints)
    const invalidTaskPayload = {
      hearingId: hearing.id,
      expectedVersion: hearing.version,
      decisionText: 'قرار تجريبي لفحص التراجع الكامل',
      nextDateDisposition: 'KNOWN' as const,
      nextHearingDate: '2027-04-20',
      tasks: [{ title: '' }], // Empty title triggers validation failure inside transaction
      idempotencyKey: `tx_fail_task_${crypto.randomUUID()}`,
    };

    await expect(recordHearingResult(actor, invalidTaskPayload)).rejects.toThrow();

    // Verify status, result, linked hearings, tasks, outbox stay at pre-command values
    expect(await prisma.hearing.count()).toBe(initialHearingCount);
    expect(await prisma.hearingResult.count()).toBe(initialResultCount);
    expect(await prisma.task.count()).toBe(initialTaskCount);
    expect(await prisma.jobRun.count()).toBe(initialJobCount);
    expect(await prisma.auditEvent.count()).toBe(initialAuditCount);

    const untouchedHearing = await getHearing(actor, hearing.id);
    expect(untouchedHearing.status).toBe('SCHEDULED');
    expect(untouchedHearing.version).toBe(hearing.version);

    // 3. Retry after removing failure succeeds cleanly
    const validPayload = {
      hearingId: hearing.id,
      expectedVersion: hearing.version,
      decisionText: 'قرار سليم بعد إزالة الخطأ المحقون',
      nextDateDisposition: 'NONE' as const,
      idempotencyKey: `tx_retry_success_${crypto.randomUUID()}`,
    };

    const successRes = await recordHearingResult(actor, validPayload);
    expect(successRes.resultId).toBeDefined();

    const completedHearing = await getHearing(actor, hearing.id);
    expect(completedHearing.status).toBe('COMPLETED');
  });

  it('T08-TC-05: Concurrency conflict rejection and result correction with history preservation', async () => {
    // 1. Setup hearing viewed by two sessions with version 1
    const hearing = await scheduleHearing(actor, {
      proceedingId: testProceedingId,
      hearingDate: '2027-05-15',
      idempotencyKey: `sched_tc05_${crypto.randomUUID()}`,
    });
    expect(hearing.version).toBe(1);

    // 2. Session 1 submits result with expectedVersion 1
    const session1Res = await recordHearingResult(actor, {
      hearingId: hearing.id,
      expectedVersion: 1,
      decisionText: 'حكمت المحكمة بندب خبير في الدعوى',
      nextDateDisposition: 'KNOWN',
      nextHearingDate: '2027-06-15',
      idempotencyKey: `s1_result_${crypto.randomUUID()}`,
    });
    expect(session1Res.resultId).toBeDefined();

    // 3. Session 2 attempts concurrent submission with stale expectedVersion 1
    await expect(
      recordHearingResult(actor2, {
        hearingId: hearing.id,
        expectedVersion: 1, // Stale!
        decisionText: 'محاولة تعديل متزامنة متضاربة',
        nextDateDisposition: 'NONE',
        idempotencyKey: `s2_result_${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);

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
  });
});
