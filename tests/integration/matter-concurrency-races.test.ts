import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import * as idempotencyModule from '@/lib/idempotency';
import {
  openMatter,
  updateMatter,
  linkMatterParty,
  updateMatterParty,
  unlinkMatterParty,
  addProceeding,
  updateProceeding,
  getMatter,
} from '@/modules/matters/matter-service';
import {
  createReferenceItem,
  updateReferenceItem,
} from '@/modules/settings/reference-service';
import { saveParty } from '@/modules/parties/service';
import {
  ProceedingCycleDetectedError,
  ConcurrencyConflictError,
  InactiveReferenceSelectedError,
  LastClientRequiredError,
  PrimaryContactConflictError,
  MatterKind,
} from '@/modules/matters/matter-types';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyConcurrentConflictError,
} from '@/lib/idempotency';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

const originalClaim = idempotencyModule.claimIdempotencyKey;

/**
 * Creates a deterministic synchronization barrier at the database boundary.
 * Intercepts claimIdempotencyKey inside the active Prisma interactive transaction,
 * ensuring all participating workers are holding open PostgreSQL transactions
 * before any worker proceeds to execute SQL business operations.
 */
function createDatabaseBoundaryBarrier(targetKeys: string[], expectedCount = targetKeys.length, timeoutMs = 15000) {
  const keySet = new Set(targetKeys);
  let arrived = 0;
  let release: () => void;
  let timer: NodeJS.Timeout;

  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    timer = setTimeout(() => {
      reject(
        new Error(
          `Database boundary barrier timed out after ${timeoutMs}ms (arrived: ${arrived}/${expectedCount})`
        )
      );
    }, timeoutMs);
  });

  const spy = vi.spyOn(idempotencyModule, 'claimIdempotencyKey').mockImplementation(async (tx, params) => {
    if (keySet.has(params.key)) {
      arrived++;
      if (arrived >= expectedCount) {
        clearTimeout(timer);
        release();
      }
      await promise;
    }
    return originalClaim(tx, params);
  });

  return {
    wait: async () => await promise,
    restore: () => {
      clearTimeout(timer);
      spy.mockRestore();
    },
  };
}

describe('T06 Concurrency Races & DB Boundary Verification (E1)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const secondaryActor = createSyntheticActor({
    id: 'synthetic-lawyer-uuid-002',
    name: 'الأستاذة سارة المحامية',
    email: 'lawyer2@lawoffice.test',
  });

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdPracticeAreaIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  // =========================================================================
  // Race 1: Disjoint proceeding cycle race (A->B and B->A concurrent)
  // =========================================================================
  it('Race 1: Barrier-driven disjoint proceeding cycle race (A->B and B->A concurrent) with DB boundary overlap, rollback & retry', async () => {
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

    const key1 = `race-p1-${crypto.randomUUID()}`;
    const key2 = `race-p2-${crypto.randomUUID()}`;
    const barrier = createDatabaseBoundaryBarrier([key1, key2]);

    try {
      const worker1 = async () =>
        updateProceeding(actor, {
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
          idempotencyKey: key1,
        });

      const worker2 = async () =>
        updateProceeding(actor, {
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
          idempotencyKey: key2,
        });

      const results = await Promise.allSettled([worker1(), worker2()]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
      expect(
        rejectedError instanceof ProceedingCycleDetectedError ||
        rejectedError instanceof ConcurrencyConflictError
      ).toBe(true);

      // Verify DB cycle integrity: never both parent of each other
      const reloaded = await getMatter(matter.matter.id, actor);
      const dbProcA = reloaded.proceedings?.find((p) => p.id === procA.id);
      const dbProcB = reloaded.proceedings?.find((p) => p.id === procB.id);

      const aParent = dbProcA?.parentProceedingId;
      const bParent = dbProcB?.parentProceedingId;
      const isCycle = aParent === procB.id && bParent === procA.id;
      expect(isCycle).toBe(false);

      // Verify rollback of the rejected worker: the rejected proceeding parent was NOT updated
      if (aParent === procB.id) {
        expect(bParent).toBeNull();
      } else {
        expect(bParent).toBe(procA.id);
        expect(aParent).toBeNull();
      }

      // Verify subsequent retry of rejected worker with valid input (no cycle) succeeds cleanly
      barrier.restore();
      const retryKey = `race-p-retry-${crypto.randomUUID()}`;
      if (aParent === procB.id) {
        // procB was rejected; retry updating procB without setting parent to procA
        const reloadedB = await prisma.proceeding.findUniqueOrThrow({ where: { id: procB.id } });
        const retryRes = await updateProceeding(actor, {
          id: procB.id,
          matterId: matter.matter.id,
          expectedVersion: reloadedB.version,
          courtId: court.id,
          instance: 'APPEAL',
          parentProceedingId: null,
          numberText: '202-معدل',
          yearLabel: '2026',
          registerType: 'استئناف',
          status: 'DRAFT',
          idempotencyKey: retryKey,
        });
        expect(retryRes.numberText).toBe('202-معدل');
      } else {
        const reloadedA = await prisma.proceeding.findUniqueOrThrow({ where: { id: procA.id } });
        const retryRes = await updateProceeding(actor, {
          id: procA.id,
          matterId: matter.matter.id,
          expectedVersion: reloadedA.version,
          courtId: court.id,
          instance: 'FIRST_INSTANCE',
          parentProceedingId: null,
          numberText: '101-معدل',
          yearLabel: '2026',
          registerType: 'كلي',
          status: 'DRAFT',
          idempotencyKey: retryKey,
        });
        expect(retryRes.numberText).toBe('101-معدل');
      }
    } finally {
      barrier.restore();
    }
  });

  // =========================================================================
  // Race 2: Competing removal or demotion of clients on ACTIVE matter
  // =========================================================================
  it('Race 2: Barrier-driven competing client removal on ACTIVE matter with DB boundary overlap, rollback & retry', async () => {
    const party1 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'موكل سباق الإزالة 1',
      idempotencyKey: `party-client-race-1-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party1.party.id);

    const party2 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'موكل سباق الإزالة 2',
      idempotencyKey: `party-client-race-2-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party2.party.id);

    const matter = await openMatter(actor, {
      title: 'ملف سباق إزالة آخر موكل',
      kind: 'LITIGATION',
      idempotencyKey: `matter-client-race-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const mp1 = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: party1.party.id,
      role: 'CLIENT',
      idempotencyKey: `link-mp1-${crypto.randomUUID()}`,
    });

    const mp2 = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: party2.party.id,
      role: 'CLIENT',
      idempotencyKey: `link-mp2-${crypto.randomUUID()}`,
    });

    // Matter is updated to ACTIVE
    const reloadedM = await prisma.matter.findUniqueOrThrow({ where: { id: matter.matter.id } });
    await updateMatter(actor, {
      id: matter.matter.id,
      expectedVersion: reloadedM.version,
      title: reloadedM.title,
      kind: reloadedM.kind as MatterKind,
      status: 'ACTIVE',
      idempotencyKey: `act-matter-${crypto.randomUUID()}`,
    });

    const key1 = `race-unlink1-${crypto.randomUUID()}`;
    const key2 = `race-unlink2-${crypto.randomUUID()}`;
    const barrier = createDatabaseBoundaryBarrier([key1, key2]);

    try {
      const worker1 = async () =>
        unlinkMatterParty(actor, {
          id: mp1.id,
          matterId: matter.matter.id,
          expectedVersion: mp1.version,
          idempotencyKey: key1,
        });

      const worker2 = async () =>
        unlinkMatterParty(actor, {
          id: mp2.id,
          matterId: matter.matter.id,
          expectedVersion: mp2.version,
          idempotencyKey: key2,
        });

      const results = await Promise.allSettled([worker1(), worker2()]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly 1 client can be removed; the other must be rejected to prevent clientless ACTIVE matter
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejError = (rejected[0] as PromiseRejectedResult).reason;
      expect(
        rejError instanceof LastClientRequiredError ||
        rejError instanceof ConcurrencyConflictError
      ).toBe(true);

      // Verify DB integrity: ACTIVE matter retains at least 1 CLIENT
      const reloaded = await getMatter(matter.matter.id, actor);
      const remainingClients = reloaded.parties?.filter((p) => p.role === 'CLIENT') ?? [];
      expect(remainingClients.length).toBeGreaterThanOrEqual(1);

      // Rollback verification: failed worker's party remains active in DB
      const failedPartyId = remainingClients[0].partyId;
      expect([party1.party.id, party2.party.id]).toContain(failedPartyId);

      // Subsequent retry verification: link Party 3 as CLIENT first, then unlinking surviving party succeeds
      barrier.restore();
      const party3 = await saveParty(actor, {
        kind: 'PERSON',
        name: 'موكل ثالث إضافي للتمكين',
        idempotencyKey: `party-p3-${crypto.randomUUID()}`,
      });
      createdPartyIds.push(party3.party.id);

      await linkMatterParty(actor, {
        matterId: matter.matter.id,
        partyId: party3.party.id,
        role: 'CLIENT',
        idempotencyKey: `link-p3-${crypto.randomUUID()}`,
      });

      const remainingMp = remainingClients[0];
      const reloadedRemaining = await prisma.matterParty.findUniqueOrThrow({ where: { id: remainingMp.id } });
      await unlinkMatterParty(actor, {
        id: remainingMp.id,
        matterId: matter.matter.id,
        expectedVersion: reloadedRemaining.version,
        idempotencyKey: `retry-unlink-${crypto.randomUUID()}`,
      });
      const checkDeleted = await prisma.matterParty.findUnique({ where: { id: remainingMp.id } });
      expect(checkDeleted).toBeNull();
    } finally {
      barrier.restore();
    }
  });

  // =========================================================================
  // Race 3: Simultaneous primary-contact changes
  // =========================================================================
  it('Race 3: Barrier-driven simultaneous primary-contact changes with DB boundary overlap, rollback & retry', async () => {
    const party1 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طرف أول جهة اتصال',
      idempotencyKey: `party-prim-1-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party1.party.id);

    const party2 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طرف ثان جهة اتصال',
      idempotencyKey: `party-prim-2-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party2.party.id);

    const matter = await openMatter(actor, {
      title: 'ملف سباق جهة الاتصال الرئيسية',
      kind: 'LITIGATION',
      idempotencyKey: `matter-prim-race-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const mp1 = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: party1.party.id,
      role: 'CLIENT',
      isPrimaryContact: false,
      idempotencyKey: `link-prim-mp1-${crypto.randomUUID()}`,
    });

    const mp2 = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: party2.party.id,
      role: 'CLIENT',
      isPrimaryContact: false,
      idempotencyKey: `link-prim-mp2-${crypto.randomUUID()}`,
    });

    const key1 = `race-primary1-${crypto.randomUUID()}`;
    const key2 = `race-primary2-${crypto.randomUUID()}`;
    const barrier = createDatabaseBoundaryBarrier([key1, key2]);

    try {
      // Worker 1 promotes Party 1 to primary contact
      const worker1 = async () =>
        updateMatterParty(actor, {
          id: mp1.id,
          matterId: matter.matter.id,
          expectedVersion: mp1.version,
          role: 'CLIENT',
          isPrimaryContact: true,
          idempotencyKey: key1,
        });

      // Worker 2 simultaneously attempts to promote Party 2 to primary contact
      const worker2 = async () =>
        updateMatterParty(actor, {
          id: mp2.id,
          matterId: matter.matter.id,
          expectedVersion: mp2.version,
          role: 'CLIENT',
          isPrimaryContact: true,
          idempotencyKey: key2,
        });

      const results = await Promise.allSettled([worker1(), worker2()]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one succeeds, the other encounters PrimaryContactConflictError or ConcurrencyConflictError
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejError = (rejected[0] as PromiseRejectedResult).reason;
      expect(
        rejError instanceof PrimaryContactConflictError ||
        rejError instanceof ConcurrencyConflictError
      ).toBe(true);

      // Verify DB integrity: exactly ONE primary contact exists across the matter
      const reloaded = await getMatter(matter.matter.id, actor);
      const primaryParties = reloaded.parties?.filter((p) => p.isPrimaryContact) ?? [];
      expect(primaryParties).toHaveLength(1);

      // Rollback verification: failed worker's update rolled back cleanly
      barrier.restore();
      const winningMpId = primaryParties[0].id;
      const losingMpId = winningMpId === mp1.id ? mp2.id : mp1.id;
      const reloadedLosing = await prisma.matterParty.findUniqueOrThrow({ where: { id: losingMpId } });
      expect(reloadedLosing.isPrimaryContact).toBe(false);

      // Retry: losing worker fetches fresh version and executes cleanly without primary conflict
      const retryRes = await updateMatterParty(actor, {
        id: losingMpId,
        matterId: matter.matter.id,
        expectedVersion: reloadedLosing.version,
        role: 'CLIENT',
        isPrimaryContact: false,
        notes: 'ملاحظة بعد إعادة المحاولة النظيفة',
        idempotencyKey: `retry-prim-note-${crypto.randomUUID()}`,
      });
      expect(retryRes.notes).toBe('ملاحظة بعد إعادة المحاولة النظيفة');
    } finally {
      barrier.restore();
    }
  });

  // =========================================================================
  // Race 4: Same-key matching & changed payloads
  // =========================================================================
  it('Race 4: Barrier-driven same-key matching & changed payloads with DB boundary overlap, rollback & retry', async () => {
    // -----------------------------------------------------------------------
    // Part A: Matching payload concurrency -> exact replay resolution
    // -----------------------------------------------------------------------
    const sharedKey = `race-same-key-${crypto.randomUUID()}`;
    const barrierA = createDatabaseBoundaryBarrier([sharedKey], 2);

    try {
      const payloadA = {
        title: 'ملف متطابق كلياً متزامن',
        kind: 'LITIGATION' as const,
        idempotencyKey: sharedKey,
      };

      const [r1, r2] = await Promise.all([
        openMatter(actor, payloadA),
        openMatter(actor, payloadA),
      ]);

      expect(r1.matter.id).toBe(r2.matter.id);
      expect(r1.fileCode).toBe(r2.fileCode);
      createdMatterIds.push(r1.matter.id);

      // Exact DB row count: exactly 1 matter
      const countA = await prisma.matter.count({ where: { id: r1.matter.id } });
      expect(countA).toBe(1);

      // Exact audit event count: exactly 1 CREATE_MATTER audit event
      const auditCountA = await prisma.auditEvent.count({
        where: { entityId: r1.matter.id, action: 'CREATE_MATTER' },
      });
      expect(auditCountA).toBe(1);
    } finally {
      barrierA.restore();
    }

    // -----------------------------------------------------------------------
    // Part B: Changed payload concurrency -> mismatch error & rollback
    // -----------------------------------------------------------------------
    const mismatchKey = `race-mismatch-key-${crypto.randomUUID()}`;
    const barrierB = createDatabaseBoundaryBarrier([mismatchKey], 2);

    try {
      const payload1 = {
        title: 'ملف ألف بحمولة أولى',
        kind: 'LITIGATION' as const,
        idempotencyKey: mismatchKey,
      };
      const payload2 = {
        title: 'ملف باء بحمولة مغايرة تماماً',
        kind: 'CONSULTATION' as const,
        idempotencyKey: mismatchKey,
      };

      const results = await Promise.allSettled([
        openMatter(actor, payload1),
        openMatter(actor, payload2),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejErr = (rejected[0] as PromiseRejectedResult).reason;
      expect(
        rejErr instanceof IdempotencyPayloadMismatchError ||
        rejErr instanceof IdempotencyConcurrentConflictError
      ).toBe(true);

      const winningMatter = (fulfilled[0] as PromiseFulfilledResult<{ matter: { id: string; title: string } }>).value;
      createdMatterIds.push(winningMatter.matter.id);

      const winningTitle = winningMatter.matter.title;
      const losingTitle = winningTitle === payload1.title ? payload2.title : payload1.title;
      const losingKind = winningTitle === payload1.title ? payload2.kind : payload1.kind;

      // Verify winning matter was persisted
      const persistedWinner = await prisma.matter.findUnique({
        where: { id: winningMatter.matter.id },
      });
      expect(persistedWinner?.title).toBe(winningTitle);

      // Verify rollback: losing matter title was NOT persisted in DB
      const orphanMatter = await prisma.matter.findFirst({
        where: { title: losingTitle },
      });
      expect(orphanMatter).toBeNull();

      // Retry: losing payload retries with new distinct key and succeeds cleanly
      barrierB.restore();
      const distinctKey = `distinct-retry-${crypto.randomUUID()}`;
      const retryRes = await openMatter(actor, {
        title: losingTitle,
        kind: losingKind,
        idempotencyKey: distinctKey,
      });
      expect(retryRes.matter.id).toBeDefined();
      expect(retryRes.matter.title).toBe(losingTitle);
      createdMatterIds.push(retryRes.matter.id);

      const matterCount = await prisma.matter.count({
        where: { title: losingTitle },
      });
      expect(matterCount).toBe(1);
    } finally {
      barrierB.restore();
    }
  });

  // =========================================================================
  // Race 5: Actor & command scope concurrency
  // =========================================================================
  it('Race 5: Barrier-driven actor and command scope concurrency with DB boundary overlap', async () => {
    // -----------------------------------------------------------------------
    // Part A: Different actors, same key -> both succeed independently
    // -----------------------------------------------------------------------
    const actorSharedKey = `race-actor-scope-${crypto.randomUUID()}`;
    const barrierA = createDatabaseBoundaryBarrier([actorSharedKey], 2);

    try {
      const [mActor1, mActor2] = await Promise.all([
        openMatter(actor, {
          title: 'ملف المستخدم الأول',
          kind: 'LITIGATION',
          idempotencyKey: actorSharedKey,
        }),
        openMatter(secondaryActor, {
          title: 'ملف المستخدم الثاني',
          kind: 'LITIGATION',
          idempotencyKey: actorSharedKey,
        }),
      ]);

      expect(mActor1.matter.id).not.toBe(mActor2.matter.id);
      createdMatterIds.push(mActor1.matter.id, mActor2.matter.id);

      const audit1 = await prisma.auditEvent.findFirst({
        where: { entityId: mActor1.matter.id, action: 'CREATE_MATTER' },
      });
      const audit2 = await prisma.auditEvent.findFirst({
        where: { entityId: mActor2.matter.id, action: 'CREATE_MATTER' },
      });
      expect(audit1?.userId).toBe(actor.id);
      expect(audit2?.userId).toBe(secondaryActor.id);
    } finally {
      barrierA.restore();
    }

    // -----------------------------------------------------------------------
    // Part B: Different command types, same key -> both succeed independently
    // -----------------------------------------------------------------------
    const cmdSharedKey = `race-cmd-scope-${crypto.randomUUID()}`;
    const barrierB = createDatabaseBoundaryBarrier([cmdSharedKey], 2);

    try {
      const [matterRes, courtRes] = await Promise.all([
        openMatter(actor, {
          title: 'ملف لنطاق الأوامر المستقلة',
          kind: 'LITIGATION',
          idempotencyKey: cmdSharedKey,
        }),
        createReferenceItem(actor, {
          type: 'COURT',
          name: `محكمة أمر مستقل ${crypto.randomUUID().slice(0, 8)}`,
          idempotencyKey: cmdSharedKey,
        }),
      ]);

      expect(matterRes.matter.id).toBeDefined();
      expect(courtRes.id).toBeDefined();
      createdMatterIds.push(matterRes.matter.id);
      createdCourtIds.push(courtRes.id);

      // Verify both idempotency records coexist under different commandTypes
      const idempCount = await prisma.idempotencyRecord.count({
        where: { actorId: actor.id, key: cmdSharedKey },
      });
      expect(idempCount).toBe(2);
    } finally {
      barrierB.restore();
    }
  });

  // =========================================================================
  // Race 6: Inactive reference deactivation vs assignment race
  // =========================================================================
  it('Race 6: Barrier-driven inactive reference deactivation vs assignment race with DB boundary overlap, rollback & retry', async () => {
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

    const deactKey = `race-deact-court-${crypto.randomUUID()}`;
    const addProcKey = `race-add-proc-court-${crypto.randomUUID()}`;
    const barrier = createDatabaseBoundaryBarrier([deactKey, addProcKey]);

    try {
      const worker1 = async () =>
        updateReferenceItem(actor, {
          type: 'COURT',
          id: court.id,
          expectedVersion: court.version,
          name: court.name,
          isActive: false,
          idempotencyKey: deactKey,
        });

      const worker2 = async () =>
        addProceeding(actor, {
          matterId: matter.matter.id,
          courtId: court.id,
          instance: 'FIRST_INSTANCE',
          numberText: '303',
          yearLabel: '2026',
          registerType: 'مدني',
          idempotencyKey: addProcKey,
        });

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

        // Verify rollback: no orphan proceeding exists
        const orphanCount = await prisma.proceeding.count({
          where: { matterId: matter.matter.id, courtId: court.id },
        });
        expect(orphanCount).toBe(0);

        // Retry: create active court and add proceeding cleanly
        barrier.restore();
        const activeCourt = await createReferenceItem(actor, {
          type: 'COURT',
          name: `محكمة بديلة نشطة ${crypto.randomUUID().slice(0, 8)}`,
          idempotencyKey: `court-active-${crypto.randomUUID()}`,
        });
        createdCourtIds.push(activeCourt.id);

        const retryProc = await addProceeding(actor, {
          matterId: matter.matter.id,
          courtId: activeCourt.id,
          instance: 'FIRST_INSTANCE',
          numberText: '303',
          yearLabel: '2026',
          registerType: 'مدني',
          idempotencyKey: `proc-retry-${crypto.randomUUID()}`,
        });
        expect(retryProc.id).toBeDefined();
      }
    } finally {
      barrier.restore();
    }
  });

  // =========================================================================
  // Race 7: Optimistic concurrency version conflict on simultaneous matter updates
  // =========================================================================
  it('Race 7: Optimistic concurrency version conflict on simultaneous matter updates with DB boundary overlap, rollback & retry', async () => {
    const matter = await openMatter(actor, {
      title: 'ملف سباق تعارض الإصدارات التفاؤلية',
      kind: 'LITIGATION',
      idempotencyKey: `matter-version-race-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);
    expect(matter.matter.version).toBe(1);

    const key1 = `ver-race-w1-${crypto.randomUUID()}`;
    const key2 = `ver-race-w2-${crypto.randomUUID()}`;
    const barrier = createDatabaseBoundaryBarrier([key1, key2]);

    try {
      const worker1 = async () =>
        updateMatter(actor, {
          id: matter.matter.id,
          expectedVersion: 1,
          title: 'تعديل متزامن ألف',
          kind: 'LITIGATION',
          status: 'DRAFT',
          idempotencyKey: key1,
        });

      const worker2 = async () =>
        updateMatter(actor, {
          id: matter.matter.id,
          expectedVersion: 1,
          title: 'تعديل متزامن باء',
          kind: 'LITIGATION',
          status: 'DRAFT',
          idempotencyKey: key2,
        });

      const results = await Promise.allSettled([worker1(), worker2()]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rej = rejected[0] as PromiseRejectedResult;
      expect(rej.reason instanceof ConcurrencyConflictError).toBe(true);

      const reloaded = await getMatter(matter.matter.id, actor);
      expect(reloaded.version).toBe(2);
      expect(['تعديل متزامن ألف', 'تعديل متزامن باء']).toContain(reloaded.title);

      // Rollback verification: failed worker's title was NOT written
      const rejectedTitle = reloaded.title === 'تعديل متزامن ألف' ? 'تعديل متزامن باء' : 'تعديل متزامن ألف';
      const checkTitle = await prisma.matter.findFirst({ where: { id: matter.matter.id, title: rejectedTitle } });
      expect(checkTitle).toBeNull();

      // Retry: failed worker reads version 2 and updates with expectedVersion: 2
      barrier.restore();
      const retryRes = await updateMatter(actor, {
        id: matter.matter.id,
        expectedVersion: 2,
        title: `${rejectedTitle} - بعد إعادة المحاولة`,
        kind: 'LITIGATION',
        status: 'DRAFT',
        idempotencyKey: `ver-race-retry-${crypto.randomUUID()}`,
      });
      expect(retryRes.operationVersion).toBe(3);
      expect(retryRes.matter.version).toBe(3);
      expect(retryRes.matter.title).toBe(`${rejectedTitle} - بعد إعادة المحاولة`);
    } finally {
      barrier.restore();
    }
  });
});
