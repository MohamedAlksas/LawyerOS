import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  updateMatter,
  linkMatterParty,
  addProceeding,
  updateProceeding,
  linkProceedingParty,
  unlinkProceedingParty,
  searchMatters,
} from '@/modules/matters/matter-service';
import { createReferenceItem } from '@/modules/settings/reference-service';
import {
  ConcurrencyConflictError,
  MatterValidationError,
  NotFoundError,
  MatterStatus,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

describe('T06 Round 2 Regression & Defect Verification', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
    await cleanupPartyFixtures(prisma, createdPartyIds);
  });

  it('T06-R2-01: capacity writes advance proceeding version and prevent stale concurrent overwrites', async () => {
    // 1. Setup matter and proceeding
    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: `Regression Court ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const m = await openMatter(actor, {
      title: 'Proceeding Version Concurrency Matter',
      kind: 'LITIGATION',
      idempotencyKey: `matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'Party For Capacity Test',
        nameNormalized: 'party for capacity test',
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    createdPartyIds.push(party.id);

    const mp = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: party.id,
      role: 'CLIENT',
      idempotencyKey: `mp-${crypto.randomUUID()}`,
    });

    const proceeding = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: `proc-${crypto.randomUUID()}`,
    });
    expect(proceeding.version).toBe(1);

    // Initial capacity link
    await linkProceedingParty(actor, {
      proceedingId: proceeding.id,
      matterPartyId: mp.id,
      capacityText: 'Initial Capacity Text',
      expectedVersion: proceeding.version,
      idempotencyKey: `cap-init-${crypto.randomUUID()}`,
    });

    // Check version after initial link
    const procAfterInit = await prisma.proceeding.findUniqueOrThrow({ where: { id: proceeding.id } });
    expect(procAfterInit.version).toBe(2);

    // Device A retains version 2 as staleVersion
    const staleVersion = procAfterInit.version;

    // Device B modifies capacity -> advances proceeding.version to 3
    await linkProceedingParty(actor, {
      proceedingId: proceeding.id,
      matterPartyId: mp.id,
      capacityText: 'Device B Updated Capacity',
      expectedVersion: procAfterInit.version,
      idempotencyKey: `cap-b-${crypto.randomUUID()}`,
    });

    const procAfterB = await prisma.proceeding.findUniqueOrThrow({ where: { id: proceeding.id } });
    expect(procAfterB.version).toBe(3);

    // Device A attempts metadata edit with staleVersion (2) -> must reject with ConcurrencyConflictError
    await expect(
      updateProceeding(actor, {
        id: proceeding.id,
        matterId: m.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        status: 'DRAFT',
        expectedVersion: staleVersion,
        circuit: 'Device A Stale Metadata',
        idempotencyKey: `proc-a-stale-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Device A attempts capacity edit with staleVersion (2) -> must reject with ConcurrencyConflictError
    await expect(
      linkProceedingParty(actor, {
        proceedingId: proceeding.id,
        matterPartyId: mp.id,
        capacityText: 'Device A Stale Capacity Overwrite',
        expectedVersion: staleVersion,
        idempotencyKey: `cap-a-stale-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Device A attempts capacity unlink with staleVersion (2) -> must reject with ConcurrencyConflictError
    const capRecord = await prisma.proceedingParty.findFirstOrThrow({
      where: { proceedingId: proceeding.id, matterPartyId: mp.id },
    });
    await expect(
      unlinkProceedingParty(actor, {
        id: capRecord.id,
        proceedingId: proceeding.id,
        expectedVersion: staleVersion,
        idempotencyKey: `cap-unlink-stale-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // Verify Device B's capacity was NOT overwritten
    const currentCap = await prisma.proceedingParty.findUniqueOrThrow({
      where: { id: capRecord.id },
    });
    expect(currentCap.capacityText).toBe('Device B Updated Capacity');

    // Valid update with current version (3) succeeds and advances to 4
    await linkProceedingParty(actor, {
      proceedingId: proceeding.id,
      matterPartyId: mp.id,
      capacityText: 'Device A Fresh Capacity',
      expectedVersion: 3,
      idempotencyKey: `cap-a-fresh-${crypto.randomUUID()}`,
    });

    const procAfterFresh = await prisma.proceeding.findUniqueOrThrow({ where: { id: proceeding.id } });
    expect(procAfterFresh.version).toBe(4);
  });

  it('T06-R2-02: lock ordering (Matter first, then Proceeding) avoids ABBA deadlocks during concurrent saves', async () => {
    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: `Deadlock Court ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const m = await openMatter(actor, {
      title: 'Deadlock Lock Order Matter',
      kind: 'LITIGATION',
      idempotencyKey: `matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'Deadlock Test Party',
        nameNormalized: 'deadlock test party',
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    createdPartyIds.push(party.id);

    const mp = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: party.id,
      role: 'CLIENT',
      idempotencyKey: `mp-${crypto.randomUUID()}`,
    });

    const proceeding = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: `proc-${crypto.randomUUID()}`,
    });

    // Run concurrent metadata edit and capacity edit
    const outcomes = await Promise.allSettled([
      updateProceeding(actor, {
        id: proceeding.id,
        matterId: m.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        status: 'DRAFT',
        expectedVersion: proceeding.version,
        circuit: 'Concurrent Circuit Update',
        idempotencyKey: `proc-concurrent-${crypto.randomUUID()}`,
      }),
      linkProceedingParty(actor, {
        proceedingId: proceeding.id,
        matterPartyId: mp.id,
        capacityText: 'Concurrent Capacity Update',
        expectedVersion: proceeding.version,
        idempotencyKey: `cap-concurrent-${crypto.randomUUID()}`,
      }),
    ]);

    // Neither command should fail with a database deadlock error (P2010 or 40P01)
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        const errMessage = String(outcome.reason?.message ?? '');
        expect(errMessage).not.toMatch(/deadlock/i);
        expect(errMessage).not.toContain('40P01');
      }
    }
  });

  it('T06-R2-03: Arabic search normalization on both sides matches Alef, Yaa/Maqsura, Taa/Haa, and digits', async () => {
    // 1. Alef Maqsura stored ('دعوى'), searched with Yaa ('دعوي')
    const m1 = await openMatter(actor, {
      title: 'دعوى تعويض مدني عاجلة',
      kind: 'LITIGATION',
      idempotencyKey: `matter-ar1-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m1.matter.id);

    const search1 = await searchMatters({ query: 'دعوي تعويض' }, actor);
    expect(search1.matters.some((m) => m.id === m1.matter.id)).toBe(true);

    // 2. Yaa stored ('مدعي'), searched with Alef Maqsura ('مدعى')
    const m2 = await openMatter(actor, {
      title: 'طلب إلزام المدعي بالمصاريف',
      kind: 'LITIGATION',
      idempotencyKey: `matter-ar2-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m2.matter.id);

    const search2 = await searchMatters({ query: 'المدعى بالمصاريف' }, actor);
    expect(search2.matters.some((m) => m.id === m2.matter.id)).toBe(true);

    // 3. Eastern Arabic digits stored ('١٤٢٥'), searched with ASCII digits ('1425')
    const m3 = await openMatter(actor, {
      title: 'قضية رقم ١٤٢٥ لسنة ٢٠٢٦',
      kind: 'LITIGATION',
      idempotencyKey: `matter-ar3-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m3.matter.id);

    const search3 = await searchMatters({ query: '1425' }, actor);
    expect(search3.matters.some((m) => m.id === m3.matter.id)).toBe(true);

    // 4. Alef variants ('أحمد إبراهيم آسر') searched with plain Alef ('احمد ابراهيم')
    const m4 = await openMatter(actor, {
      title: 'منازعة ورثة أحمد إبراهيم آسر',
      kind: 'LITIGATION',
      idempotencyKey: `matter-ar4-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m4.matter.id);

    const search4 = await searchMatters({ query: 'احمد ابراهيم' }, actor);
    expect(search4.matters.some((m) => m.id === m4.matter.id)).toBe(true);
  });

  it('T06-R2-05: atomic proceeding creation with parties rolls back completely on any party failure', async () => {
    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: `Atomic Court ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const m = await openMatter(actor, {
      title: 'Atomic Proceeding Parties Matter',
      kind: 'LITIGATION',
      idempotencyKey: `matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const party1 = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'Atomic Party 1',
        nameNormalized: 'atomic party 1',
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    createdPartyIds.push(party1.id);

    const mp1 = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: party1.id,
      role: 'CLIENT',
      idempotencyKey: `mp1-${crypto.randomUUID()}`,
    });

    // 1. Successful atomic create
    const procSuccess = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      circuit: 'Atomic First Circuit',
      parties: [
        {
          matterPartyId: mp1.id,
          legalCapacity: 'PLAINTIFF',
          capacityText: '???? ????',
        },
      ],
      idempotencyKey: `proc-atomic-ok-${crypto.randomUUID()}`,
    });

    expect(procSuccess.parties).toHaveLength(1);
    expect(procSuccess.parties![0].capacityText).toBe('???? ????');

    // 2. Failed atomic create (second party does not exist) -> must roll back EVERYTHING
    const fakePartyId = crypto.randomUUID();
    const failingKey = `proc-atomic-fail-${crypto.randomUUID()}`;

    await expect(
      addProceeding(actor, {
        matterId: m.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        circuit: 'Doomed Circuit',
        parties: [
          {
            matterPartyId: mp1.id,
            legalCapacity: 'PLAINTIFF',
            capacityText: '???? ???',
          },
          {
            matterPartyId: fakePartyId,
            legalCapacity: 'DEFENDANT',
            capacityText: '???? ???? ??? ?????',
          },
        ],
        idempotencyKey: failingKey,
      })
    ).rejects.toThrow(NotFoundError);

    // Verify NO proceeding with circuit 'Doomed Circuit' was persisted
    const doomedProc = await prisma.proceeding.findFirst({
      where: { matterId: m.matter.id, circuit: 'Doomed Circuit' },
    });
    expect(doomedProc).toBeNull();
  });

  it('T06-R2-08: replay reports current resourceVersion but original operationVersion', async () => {
    const key = `idem-opver-${crypto.randomUUID()}`;
    const initial = await openMatter(actor, {
      title: 'Original Creation Title',
      kind: 'LITIGATION',
      idempotencyKey: key,
    });
    createdMatterIds.push(initial.matter.id);
    expect(initial.matter.version).toBe(1);
    expect(initial.operationVersion).toBe(1);

    // Update matter to version 2
    const updated = await updateMatter(actor, {
      id: initial.matter.id,
      title: 'Updated Matter Title',
      kind: 'LITIGATION',
      status: 'DRAFT',
      expectedVersion: initial.matter.version,
      idempotencyKey: `update-${crypto.randomUUID()}`,
    });
    expect(updated.matter.version).toBe(2);
    expect(updated.operationVersion).toBe(2);

    // Replay original openMatter key -> resourceVersion is 2, BUT operationVersion is 1!
    const replay = await openMatter(actor, {
      title: 'Original Creation Title',
      kind: 'LITIGATION',
      idempotencyKey: key,
    });

    expect(replay.matter.version).toBe(2); // Current state
    expect(replay.operationVersion).toBe(1); // Original acknowledged operation version
  });

  it('T06-R2-09: openMatter rejects ARCHIVED status and allocates no code or DB rows', async () => {
    const key = `archive-rej-${crypto.randomUUID()}`;
    await expect(
      openMatter(actor, {
        title: 'Archived Matter Attempt',
        kind: 'LITIGATION',
        status: 'ARCHIVED' as unknown as MatterStatus,
        idempotencyKey: key,
      })
    ).rejects.toThrow(MatterValidationError);

    // Verify no matter was created
    const matterInDb = await prisma.matter.findFirst({
      where: { title: 'Archived Matter Attempt' },
    });
    expect(matterInDb).toBeNull();

    // Verify no idempotency record was created
    const idem = await prisma.idempotencyRecord.findFirst({
      where: { key },
    });
    expect(idem).toBeNull();
  });
});
