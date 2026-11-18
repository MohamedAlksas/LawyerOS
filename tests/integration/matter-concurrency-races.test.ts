import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  updateMatter,
  linkMatterParty,
  unlinkMatterParty,
  addProceeding,
  updateProceeding,
  linkMatterAuthorization,
  getMatter,
} from '@/modules/matters/matter-service';
import {
  createReferenceItem,
  updateReferenceItem,
} from '@/modules/settings/reference-service';
import { saveParty, savePowerOfAttorney } from '@/modules/parties/service';
import {
  ProceedingCycleDetectedError,
  ConcurrencyConflictError,
  InactiveReferenceSelectedError,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

function createBarrier(count: number) {
  let arrived = 0;
  let release: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait() {
      arrived++;
      if (arrived >= count) {
        release();
      }
      await promise;
    },
  };
}

describe('T06 Concurrency Races & Barrier Verification', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdPracticeAreaIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, {
      courtIds: createdCourtIds,
      practiceAreaIds: createdPracticeAreaIds,
    });
    createdMatterIds.length = 0;
    createdPartyIds.length = 0;
    createdCourtIds.length = 0;
    createdPracticeAreaIds.length = 0;
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
  });

  it('Race 1: Barrier-driven disjoint proceeding cycle race (A->B and B->A concurrent)', async () => {
    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: `محكمة سباق الحلقات ${crypto.randomUUID().slice(0, 8)}`,
      idempotencyKey: `court-cycle-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const matter = await openMatter(actor, {
      title: 'ملف سباق الحلقات التزامنية',
      kind: 'LITIGATION',
      idempotencyKey: `matter-cycle-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const procA = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      numberText: '101',
      yearLabel: '2026',
      registerType: 'كلي',
      idempotencyKey: `proc-a-${crypto.randomUUID()}`,
    });

    const procB = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: court.id,
      instance: 'APPEAL',
      numberText: '202',
      yearLabel: '2026',
      registerType: 'استئناف',
      idempotencyKey: `proc-b-${crypto.randomUUID()}`,
    });

    const barrier = createBarrier(2);

    const worker1 = async () => {
      await barrier.wait();
      return updateProceeding(actor, {
        id: procA.id,
        matterId: matter.matter.id,
        expectedVersion: procA.version,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        parentProceedingId: procB.id,
        numberText: '101',
        yearLabel: '2026',
        registerType: 'كلي',
        status: 'DRAFT',
        idempotencyKey: `race-p1-${crypto.randomUUID()}`,
      });
    };

    const worker2 = async () => {
      await barrier.wait();
      return updateProceeding(actor, {
        id: procB.id,
        matterId: matter.matter.id,
        expectedVersion: procB.version,
        courtId: court.id,
        instance: 'APPEAL',
        parentProceedingId: procA.id,
        numberText: '202',
        yearLabel: '2026',
        registerType: 'استئناف',
        status: 'DRAFT',
        idempotencyKey: `race-p2-${crypto.randomUUID()}`,
      });
    };

    const results = await Promise.allSettled([worker1(), worker2()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
    expect(
      rejectedError instanceof ProceedingCycleDetectedError ||
      rejectedError instanceof ConcurrencyConflictError
    ).toBe(true);

    const reloaded = await getMatter(matter.matter.id, actor);
    const dbProcA = reloaded.proceedings?.find((p) => p.id === procA.id);
    const dbProcB = reloaded.proceedings?.find((p) => p.id === procB.id);

    const aParent = dbProcA?.parentProceedingId;
    const bParent = dbProcB?.parentProceedingId;

    const isCycle = aParent === procB.id && bParent === procA.id;
    expect(isCycle).toBe(false);
  });

  it('Race 2: Barrier-driven client removal vs POA linking race', async () => {
    const party1 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'موكل سباق التوكيل 1',
      idempotencyKey: `party-poa-race-1-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party1.party.id);

    const party2 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'موكل سباق التوكيل 2',
      idempotencyKey: `party-poa-race-2-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party2.party.id);

    const poa = await savePowerOfAttorney(actor, {
      partyId: party1.party.id,
      poaNumberText: '8877/ق',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق الدقي',
      poaType: 'GENERAL',
      idempotencyKey: `poa-race-${crypto.randomUUID()}`,
    });

    const matter = await openMatter(actor, {
      title: 'ملف سباق إزالة الموكل والتوكيل',
      kind: 'LITIGATION',
      idempotencyKey: `matter-poa-race-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const mp1 = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: party1.party.id,
      role: 'CLIENT',
      idempotencyKey: `link-mp1-${crypto.randomUUID()}`,
    });

    await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: party2.party.id,
      role: 'CLIENT',
      idempotencyKey: `link-mp2-${crypto.randomUUID()}`,
    });

    const barrier = createBarrier(2);

    const worker1 = async () => {
      await barrier.wait();
      return unlinkMatterParty(actor, {
        id: mp1.id,
        matterId: matter.matter.id,
        expectedVersion: mp1.version,
        idempotencyKey: `race-unlink-${crypto.randomUUID()}`,
      });
    };

    const worker2 = async () => {
      await barrier.wait();
      return linkMatterAuthorization(actor, {
        matterId: matter.matter.id,
        powerOfAttorneyId: poa.id,
        idempotencyKey: `race-link-poa-${crypto.randomUUID()}`,
      });
    };

    const results = await Promise.allSettled([worker1(), worker2()]);

    const rejected = results.filter((r) => r.status === 'rejected');

    const reloaded = await getMatter(matter.matter.id, actor);
    const isParty1Linked = reloaded.parties?.some((p) => p.partyId === party1.party.id && p.role === 'CLIENT');
    const isPoaLinked = reloaded.authorizations?.some((a) => a.powerOfAttorneyId === poa.id);

    if (isPoaLinked) {
      expect(isParty1Linked).toBe(true);
    } else {
      expect(rejected.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Race 3: Barrier-driven inactive reference deactivation vs assignment race', async () => {
    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: `محكمة سباق التعطيل ${crypto.randomUUID().slice(0, 8)}`,
      idempotencyKey: `court-deact-race-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const matter = await openMatter(actor, {
      title: 'ملف سباق المحكمة المعطلة',
      kind: 'LITIGATION',
      idempotencyKey: `matter-deact-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const barrier = createBarrier(2);

    const worker1 = async () => {
      await barrier.wait();
      return updateReferenceItem(actor, {
        type: 'COURT',
        id: court.id,
        expectedVersion: court.version,
        name: court.name,
        isActive: false,
        idempotencyKey: `race-deact-court-${crypto.randomUUID()}`,
      });
    };

    const worker2 = async () => {
      await barrier.wait();
      return addProceeding(actor, {
        matterId: matter.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        numberText: '303',
        yearLabel: '2026',
        registerType: 'مدني',
        idempotencyKey: `race-add-proc-court-${crypto.randomUUID()}`,
      });
    };

    const results = await Promise.allSettled([worker1(), worker2()]);

    const reloadedCourt = await prisma.court.findUniqueOrThrow({ where: { id: court.id } });
    const reloadedMatter = await getMatter(matter.matter.id, actor);
    const addedProc = reloadedMatter.proceedings?.find((p) => p.courtId === court.id);

    if (addedProc) {
      expect(reloadedCourt.isActive).toBe(false);
    } else {
      expect(results.some((r) => r.status === 'rejected')).toBe(true);
      const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(
        rej.reason instanceof InactiveReferenceSelectedError ||
        rej.reason instanceof ConcurrencyConflictError
      ).toBe(true);
    }
  });

  it('Race 4: Optimistic concurrency version conflict on simultaneous matter updates', async () => {
    const matter = await openMatter(actor, {
      title: 'ملف سباق تعارض الإصدارات التفاؤلية',
      kind: 'LITIGATION',
      idempotencyKey: `matter-version-race-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);
    expect(matter.matter.version).toBe(1);

    const barrier = createBarrier(2);

    const worker1 = async () => {
      await barrier.wait();
      return updateMatter(actor, {
        id: matter.matter.id,
        expectedVersion: 1,
        title: 'تعديل متزامن ألف',
        kind: 'LITIGATION',
        status: 'DRAFT',
        idempotencyKey: `ver-race-w1-${crypto.randomUUID()}`,
      });
    };

    const worker2 = async () => {
      await barrier.wait();
      return updateMatter(actor, {
        id: matter.matter.id,
        expectedVersion: 1,
        title: 'تعديل متزامن باء',
        kind: 'LITIGATION',
        status: 'DRAFT',
        idempotencyKey: `ver-race-w2-${crypto.randomUUID()}`,
      });
    };

    const results = await Promise.allSettled([worker1(), worker2()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rej = rejected[0] as PromiseRejectedResult;
    expect(rej.reason instanceof ConcurrencyConflictError).toBe(true);

    const reloaded = await getMatter(matter.matter.id, actor);
    expect(reloaded.version).toBe(2);
    expect(['تعديل متزامن ألف', 'تعديل متزامن باء']).toContain(reloaded.title);
  });
});
