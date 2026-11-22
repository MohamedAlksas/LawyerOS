import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  addProceeding,
  archiveMatter,
  archiveProceeding,
} from '@/modules/matters/matter-service';
import {
  MatterArchivedError,
  ProceedingArchivedError,
  ActiveObligationError,
} from '@/modules/matters/matter-types';
import {
  scheduleHearing,
  rescheduleHearing,
  cancelHearing,
  getHearing,
} from '@/modules/scheduling';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

/**
 * T08 Acceptance Test Case 06:
 * Scheduled hearings, rescheduling, cancellation, and archive guards.
 *
 * Setup:
 * Two unheld scheduled hearings with durable work.
 *
 * Steps & Expected:
 * 1. Reschedule one hearing and cancel the other with reasons.
 * 2. Replacement and reschedule history linked (RESCHEDULED_TO); old work invalidated;
 *    no result created for unheld hearing.
 * 3. Separately try archiving Matter or Proceeding with upcoming hearing:
 *    Archive guards reject prohibited transitions (ActiveObligationError).
 * 4. Try scheduling on archived parents (archived Matter or Proceeding):
 *    Guards reject with MatterArchivedError / ProceedingArchivedError.
 */
describe('T08 Integration Tests: Hearing Rescheduling, Cancellation & Archive Guards (T08-TC-06)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];

  let testCourtId: string;
  let activeMatterId: string;
  let activeProceedingId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    const court = await prisma.court.create({
      data: {
        name: `محكمة استئناف القاهرة - الدائرة العمالية ${Date.now()}`,
        code: `CAIRO-LABOR-${Date.now().toString().slice(-4)}`,
        isActive: true,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    testCourtId = court.id;
    createdCourtIds.push(court.id);

    // Seed test party as client
    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `سعيد المنشاوي للاختبار ${Date.now().toString().slice(-4)}`,
        nameNormalized: `سعيد المنشاوي للاختبار ${Date.now().toString().slice(-4)}`,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    createdPartyIds.push(party.id);

    // Create active matter with proceeding
    const matterRes = await openMatter(actor, {
      title: 'نزاع عمالي تجريبي لاختبار حراسة الأرشفة',
      kind: 'LITIGATION',
      initialClientId: party.id,
      idempotencyKey: `open_matter_t08_${crypto.randomUUID()}`,
    });
    activeMatterId = matterRes.matter.id;
    createdMatterIds.push(activeMatterId);

    const procRes = await addProceeding(actor, {
      matterId: activeMatterId,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '8872',
      yearLabel: '2027',
      registerType: 'عمال كلي',
      idempotencyKey: `add_proc_t08_${crypto.randomUUID()}`,
    });
    activeProceedingId = procRes.id;
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  it('T08-TC-06 Part 1: Reschedule unheld hearing, link replacement, and invalidate obsolete reminder work', async () => {
    // 1. Schedule hearing A
    const hearingDate = '2027-03-15';
    const hearingA = await scheduleHearing(actor, {
      proceedingId: activeProceedingId,
      hearingDate,
      hearingTime: '10:00',
      hearingPurpose: 'حضور المستندات والمرافعة',
      idempotencyKey: `sched_h_a_${crypto.randomUUID()}`,
    });

    expect(hearingA.status).toBe('SCHEDULED');

    // 2. Reschedule hearing A with a reason
    const newDate = '2027-04-12';
    const rescheduleReason = 'تأجيل إداري لضم المفردات وإعادة الإعلان';
    const rescheduled = await rescheduleHearing(actor, {
      hearingId: hearingA.id,
      expectedVersion: hearingA.version,
      newHearingDate: newDate,
      newHearingTime: '11:00',
      reason: rescheduleReason,
      idempotencyKey: `resched_h_a_${crypto.randomUUID()}`,
    });

    // Verify replacement hearing is scheduled
    expect(rescheduled.replacementHearing.status).toBe('SCHEDULED');
    expect(rescheduled.replacementHearing.hearingDate).toBe(newDate);

    // Verify original hearing is marked RESCHEDULED
    const originalHearing = await getHearing(actor, hearingA.id);
    expect(originalHearing.status).toBe('RESCHEDULED');
    expect(originalHearing.rescheduleReason).toBe(rescheduleReason);

    // Verify link between original and replacement
    const link = await prisma.hearingLink.findFirst({
      where: {
        fromHearingId: hearingA.id,
        toHearingId: rescheduled.replacementHearing.id,
        relation: 'RESCHEDULED_TO',
      },
    });
    expect(link).not.toBeNull();

    // Verify NO result was created for unheld hearing
    const resultCount = await prisma.hearingResult.count({
      where: { hearingId: hearingA.id },
    });
    expect(resultCount).toBe(0);

    // Verify obsolete reminder work for original hearing is cancelled
    const oldJobs = await prisma.jobRun.findMany({
      where: {
        sourceType: 'Hearing',
        sourceId: hearingA.id,
      },
    });
    for (const job of oldJobs) {
      expect(job.status).toBe('CANCELLED');
    }
  });

  it('T08-TC-06 Part 2: Cancel unheld hearing with reason and invalidate durable reminder work', async () => {
    // 1. Schedule hearing B
    const hearingB = await scheduleHearing(actor, {
      proceedingId: activeProceedingId,
      hearingDate: '2027-05-10',
      hearingTime: '09:30',
      hearingPurpose: 'جلسة تسوية تمهيدية',
      idempotencyKey: `sched_h_b_${crypto.randomUUID()}`,
    });

    expect(hearingB.status).toBe('SCHEDULED');

    // 2. Cancel hearing B with reason
    const cancelReason = 'إلغاء الموعد بناءً على ترك الدعوى والتصالح الودي';
    const cancelled = await cancelHearing(actor, {
      hearingId: hearingB.id,
      expectedVersion: hearingB.version,
      reason: cancelReason,
      idempotencyKey: `cancel_h_b_${crypto.randomUUID()}`,
    });

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancellationReason).toBe(cancelReason);

    // Verify NO result was created for cancelled unheld hearing
    const resultCount = await prisma.hearingResult.count({
      where: { hearingId: hearingB.id },
    });
    expect(resultCount).toBe(0);

    // Verify reminder work is cancelled
    const jobs = await prisma.jobRun.findMany({
      where: {
        sourceType: 'Hearing',
        sourceId: hearingB.id,
      },
    });
    for (const job of jobs) {
      expect(job.status).toBe('CANCELLED');
    }
  });

  it('T08-TC-06 Part 3: Prohibit archiving Matter or Proceeding while a scheduled hearing exists', async () => {
    // 1. Schedule hearing C (active scheduled obligation)
    const hearingC = await scheduleHearing(actor, {
      proceedingId: activeProceedingId,
      hearingDate: '2027-06-20',
      idempotencyKey: `sched_h_c_${crypto.randomUUID()}`,
    });
    expect(hearingC.status).toBe('SCHEDULED');

    // 2. Attempting to archive the proceeding must fail
    const procBeforeArchive = await prisma.proceeding.findUnique({
      where: { id: activeProceedingId },
    });
    await expect(
      archiveProceeding(actor, {
        matterId: activeMatterId,
        proceedingId: activeProceedingId,
        expectedVersion: procBeforeArchive!.version,
        reason: 'محاولة أرشفة قيد به جلسة قائمة',
        idempotencyKey: `arch_proc_fail_${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ActiveObligationError);

    // 3. Attempting to archive the parent matter must fail
    const matterBeforeArchive = await prisma.matter.findUnique({
      where: { id: activeMatterId },
    });
    await expect(
      archiveMatter(actor, {
        matterId: activeMatterId,
        expectedVersion: matterBeforeArchive!.version,
        reason: 'محاولة أرشفة ملف به جلسة قائمة',
        idempotencyKey: `arch_matter_fail_${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ActiveObligationError);

    // 4. Cancel the active hearing to clear obligation
    await cancelHearing(actor, {
      hearingId: hearingC.id,
      expectedVersion: hearingC.version,
      reason: 'إنهاء الجلسة لاختبار نجاح الأرشفة اللاحقة',
      idempotencyKey: `cancel_h_c_${crypto.randomUUID()}`,
    });
  });

  it('T08-TC-06 Part 4: Prohibit scheduling a hearing on an archived Matter or Proceeding', async () => {
    // 1. Create a separate matter and proceeding to archive cleanly
    const mRes = await openMatter(actor, {
      title: 'ملف للأرشفة وحراسة الجدولة',
      kind: 'CONSULTATION',
      initialClientId: createdPartyIds[0],
      idempotencyKey: `open_m_arch_${crypto.randomUUID()}`,
    });
    createdMatterIds.push(mRes.matter.id);

    const pRes = await addProceeding(actor, {
      matterId: mRes.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '1122',
      yearLabel: '2027',
      registerType: 'مدني كلي',
      idempotencyKey: `add_p_arch_${crypto.randomUUID()}`,
    });

    // Archive proceeding
    const pFresh = await prisma.proceeding.findUnique({
      where: { id: pRes.id },
    });
    await archiveProceeding(actor, {
      matterId: mRes.matter.id,
      proceedingId: pRes.id,
      expectedVersion: pFresh!.version,
      reason: 'أرشفة نظامية للقيد المنتهي',
      idempotencyKey: `arch_p_clean_${crypto.randomUUID()}`,
    });

    // Attempting to schedule on archived proceeding must fail with ProceedingArchivedError
    await expect(
      scheduleHearing(actor, {
        proceedingId: pRes.id,
        hearingDate: '2027-08-01',
        idempotencyKey: `sched_on_arch_proc_${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ProceedingArchivedError);

    // Archive matter
    const mFresh = await prisma.matter.findUnique({
      where: { id: mRes.matter.id },
    });
    await archiveMatter(actor, {
      matterId: mRes.matter.id,
      expectedVersion: mFresh!.version,
      reason: 'أرشفة نظامية للملف المنتهي',
      idempotencyKey: `arch_m_clean_${crypto.randomUUID()}`,
    });

    // Attempting to schedule on proceeding belonging to archived matter must fail with MatterArchivedError
    await expect(
      scheduleHearing(actor, {
        proceedingId: pRes.id,
        hearingDate: '2027-08-01',
        idempotencyKey: `sched_on_arch_matter_${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterArchivedError);
  });
});
