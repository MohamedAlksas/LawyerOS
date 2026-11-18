import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  addProceeding,
  updateProceeding,
  getMatter,
} from '@/modules/matters/matter-service';
import { createReferenceItem } from '@/modules/settings/reference-service';
import {
  CrossMatterLinkForbiddenError,
  ProceedingCycleDetectedError,
  MatterValidationError,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import {
  cleanupMatterFixtures,
  cleanupReferenceFixtures,
} from '../helpers/matter-test-helper';

describe('T06-04 & T06-05: Court Proceedings, Instances & Cycle Invariants', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdCourtIds: string[] = [];

  let testCourt1Id: string;
  let testCourt2Id: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    const court1 = await createReferenceItem(actor, {
      type: 'COURT',
      name: 'محكمة شمال القاهرة الابتدائية',
      code: 'NC-01',
      idempotencyKey: `court-setup-1-${crypto.randomUUID()}`,
    });
    testCourt1Id = court1.id;
    createdCourtIds.push(court1.id);

    const court2 = await createReferenceItem(actor, {
      type: 'COURT',
      name: 'محكمة استئناف القاهرة - مأمورية شمال',
      code: 'CA-02',
      idempotencyKey: `court-setup-2-${crypto.randomUUID()}`,
    });
    testCourt2Id = court2.id;
    createdCourtIds.push(court2.id);
  });

  afterEach(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    createdMatterIds.length = 0;
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  it('T06-04: requires courtId for adding proceeding, rejecting missing court', async () => {
    const matter = await openMatter(actor, {
      title: 'ملف لفحص اشتراط المحكمة',
      kind: 'LITIGATION',
      idempotencyKey: `matter-no-court-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    await expect(
      addProceeding(actor, {
        matterId: matter.matter.id,
        courtId: '',
        instance: 'FIRST_INSTANCE',
        idempotencyKey: `proc-no-court-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);
  });

  it('T06-04: marks incomplete proceeding as DRAFT and complete proceeding as ACTIVE', async () => {
    const matter = await openMatter(actor, {
      title: 'ملف لفحص اكتمال بيانات القيد',
      kind: 'LITIGATION',
      idempotencyKey: `matter-docket-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    // Incomplete data (missing number and year) requested as ACTIVE remains DRAFT ("الرقم غير مستكمل")
    const proc1 = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: testCourt1Id,
      instance: 'FIRST_INSTANCE',
      status: 'ACTIVE',
      idempotencyKey: `proc-incomplete-${crypto.randomUUID()}`,
    });
    expect(proc1.status).toBe('DRAFT');
    expect(proc1.numberText).toBeNull();
    expect(proc1.yearLabel).toBeNull();

    // Complete data with exact Arabic/Latin typography and leading zeros
    const proc2 = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: testCourt1Id,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      circuit: 'الدائرة 14 تعويضات',
      numberText: '0045/ب',
      yearLabel: '2026',
      status: 'ACTIVE',
      idempotencyKey: `proc-complete-${crypto.randomUUID()}`,
    });
    expect(proc2.status).toBe('ACTIVE');
    expect(proc2.numberText).toBe('0045/ب');
    expect(proc2.yearLabel).toBe('2026');
    expect(proc2.registerType).toBe('مدني كلي');
    expect(proc2.circuit).toBe('الدائرة 14 تعويضات');
  });

  it('T06-05: links appeal to first instance proceeding within same matter', async () => {
    const matter = await openMatter(actor, {
      title: 'نزاع تجاري درجات تقاضي متعددة',
      kind: 'LITIGATION',
      idempotencyKey: `matter-hierarchy-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    // First instance
    const firstInstance = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: testCourt1Id,
      instance: 'FIRST_INSTANCE',
      numberText: '1001/تجاري',
      yearLabel: '2025',
      registerType: 'تجاري كلي',
      status: 'JUDGMENT_ISSUED',
      idempotencyKey: `proc-first-inst-${crypto.randomUUID()}`,
    });

    // Appeal linked to first instance
    const appeal = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: testCourt2Id,
      instance: 'APPEAL',
      parentProceedingId: firstInstance.id,
      numberText: '205/ق',
      yearLabel: '2026',
      registerType: 'استئناف تجاري',
      status: 'ACTIVE',
      idempotencyKey: `proc-appeal-${crypto.randomUUID()}`,
    });

    expect(appeal.parentProceedingId).toBe(firstInstance.id);
    expect(appeal.instance).toBe('APPEAL');

    const reloaded = await getMatter(matter.matter.id, actor);
    expect(reloaded.proceedings?.length).toBe(2);
    const appealInMatter = reloaded.proceedings?.find((p) => p.id === appeal.id);
    expect(appealInMatter?.parentProceedingId).toBe(firstInstance.id);
  });

  it('T06-05: rejects cross-matter parent proceeding link', async () => {
    const matterA = await openMatter(actor, {
      title: 'ملف أ',
      kind: 'LITIGATION',
      idempotencyKey: `matter-a-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matterA.matter.id);

    const matterB = await openMatter(actor, {
      title: 'ملف ب',
      kind: 'LITIGATION',
      idempotencyKey: `matter-b-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matterB.matter.id);

    const procInA = await addProceeding(actor, {
      matterId: matterA.matter.id,
      courtId: testCourt1Id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: `proc-in-a-${crypto.randomUUID()}`,
    });

    // Try linking proceeding in matter B to parent proceeding in matter A
    await expect(
      addProceeding(actor, {
        matterId: matterB.matter.id,
        courtId: testCourt2Id,
        instance: 'APPEAL',
        parentProceedingId: procInA.id,
        idempotencyKey: `cross-matter-proc-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);
  });

  it('T06-05: rejects self-parent and circular parent hierarchies', async () => {
    const matter = await openMatter(actor, {
      title: 'ملف فحص الحلقات الدائرية',
      kind: 'LITIGATION',
      idempotencyKey: `matter-cycles-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const procA = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: testCourt1Id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: `proc-cycle-a-${crypto.randomUUID()}`,
    });

    // 1. Self-parenting must reject
    await expect(
      updateProceeding(actor, {
        id: procA.id,
        matterId: matter.matter.id,
        expectedVersion: procA.version,
        courtId: testCourt1Id,
        instance: 'FIRST_INSTANCE',
        parentProceedingId: procA.id, // Self!
        status: 'DRAFT',
        idempotencyKey: `self-parent-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ProceedingCycleDetectedError);

    // 2. A -> B -> A cycle
    const procB = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: testCourt2Id,
      instance: 'APPEAL',
      parentProceedingId: procA.id,
      idempotencyKey: `proc-cycle-b-${crypto.randomUUID()}`,
    });

    // Attempting to set procA parent to procB creates a 2-node cycle (A -> B -> A)
    await expect(
      updateProceeding(actor, {
        id: procA.id,
        matterId: matter.matter.id,
        expectedVersion: procA.version,
        courtId: testCourt1Id,
        instance: 'FIRST_INSTANCE',
        parentProceedingId: procB.id, // Cycle!
        status: 'DRAFT',
        idempotencyKey: `circular-parent-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ProceedingCycleDetectedError);
  });
});

