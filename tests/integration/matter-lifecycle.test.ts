import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  updateMatter,
  getMatter,
  linkMatterParty,
  unlinkMatterParty,
  updateMatterParty,
} from '@/modules/matters/matter-service';
import {
  MatterValidationError,
  LastClientRequiredError,
  ConcurrencyConflictError,
  UnsupportedTransitionError,
  MatterStatus,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';
import { saveParty } from '@/modules/parties/service';

describe('T06-01 & T06-06 & T06-10: Matter Lifecycle, Client Invariants & Concurrency', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    createdMatterIds.length = 0;
    createdPartyIds.length = 0;
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
  });

  it('T06-01: opens and reloads a DRAFT matter without an initial client', async () => {
    const result = await openMatter(actor, {
      title: 'دعوى صحة ونفاذ عقد بيع شقة المعادي',
      kind: 'LITIGATION',
      status: 'DRAFT',
      summary: 'ملف نزاع عقاري قيد إعداد المستندات',
      notes: 'في انتظار إحضار العقد الابتدائي من الموكل',
      idempotencyKey: `open-draft-${crypto.randomUUID()}`,
    });

    expect(result.matter.id).toBeDefined();
    expect(result.matter.title).toBe('دعوى صحة ونفاذ عقد بيع شقة المعادي');
    expect(result.matter.kind).toBe('LITIGATION');
    expect(result.matter.status).toBe('DRAFT');
    expect(result.matter.parties?.length).toBe(0);
    expect(result.matter.version).toBe(1);
    expect(result.fileCode).toMatch(/^\d{4}\/\d{4}$/);

    createdMatterIds.push(result.matter.id);

    // Reload from database
    const reloaded = await getMatter(result.matter.id, actor);
    expect(reloaded.id).toBe(result.matter.id);
    expect(reloaded.fileCode).toBe(result.fileCode);
    expect(reloaded.status).toBe('DRAFT');
    expect(reloaded.summary).toBe('ملف نزاع عقاري قيد إعداد المستندات');
  });

  it('T06-01: opens an ACTIVE matter with a linked client', async () => {
    const party = await saveParty(actor, {
      kind: 'PERSON',
      name: 'عبد الرحمن إبراهيم النجار',
      idempotencyKey: `client-party-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party.party.id);

    const result = await openMatter(actor, {
      title: 'استشارة صياغة اتفاقية شراكة تجارية',
      kind: 'CONSULTATION',
      status: 'ACTIVE',
      initialClientId: party.party.id,
      idempotencyKey: `open-active-${crypto.randomUUID()}`,
    });

    expect(result.matter.status).toBe('ACTIVE');
    expect(result.matter.parties?.length).toBe(1);
    expect(result.matter.parties?.[0].partyId).toBe(party.party.id);
    expect(result.matter.parties?.[0].role).toBe('CLIENT');
    expect(result.matter.parties?.[0].isPrimaryContact).toBe(true);

    createdMatterIds.push(result.matter.id);
  });

  it('T06-01 & T06-06: rejects opening an ACTIVE matter without a client', async () => {
    await expect(
      openMatter(actor, {
        title: 'ملف غير صالح',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        idempotencyKey: `invalid-active-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(LastClientRequiredError);
  });

  it('T06-01: rejects invalid inputs (missing title or oversize)', async () => {
    await expect(
      openMatter(actor, {
        title: '   ',
        kind: 'LITIGATION',
        idempotencyKey: `empty-title-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);

    await expect(
      openMatter(actor, {
        title: 'أ'.repeat(256),
        kind: 'LITIGATION',
        idempotencyKey: `oversize-title-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);
  });

  it('T06-01: rejects unsupported status transitions (ARCHIVED, DELETED)', async () => {
    const result = await openMatter(actor, {
      title: 'ملف تجريبي لفحص الانتقالات المرفوضة',
      kind: 'OTHER',
      idempotencyKey: `unsupported-init-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(result.matter.id);

    await expect(
      updateMatter(actor, {
        id: result.matter.id,
        expectedVersion: 1,
        title: result.matter.title,
        kind: result.matter.kind,
        status: 'ARCHIVED' as unknown as MatterStatus,
        idempotencyKey: `unsupported-arch-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(UnsupportedTransitionError);
  });

  it('T06-06: prevents demoting or removing the last CLIENT in an ACTIVE matter', async () => {
    const party1 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طارق عبد السلام الشريف',
      idempotencyKey: `client-p1-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party1.party.id);

    const matterRes = await openMatter(actor, {
      title: 'دعوى تعويض عن أضرار مادية',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: party1.party.id,
      idempotencyKey: `matter-last-client-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matterRes.matter.id);

    const clientLink = matterRes.matter.parties?.[0];
    expect(clientLink).toBeDefined();

    // Try to demote role from CLIENT to OPPONENT
    await expect(
      updateMatterParty(actor, {
        id: clientLink!.id,
        matterId: matterRes.matter.id,
        expectedVersion: clientLink!.version,
        role: 'OPPONENT',
        idempotencyKey: `demote-client-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(LastClientRequiredError);

    // Try to unlink the only CLIENT
    await expect(
      unlinkMatterParty(actor, {
        id: clientLink!.id,
        matterId: matterRes.matter.id,
        expectedVersion: clientLink!.version,
        idempotencyKey: `unlink-client-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(LastClientRequiredError);

    // Add a second client, then unlinking the first should succeed
    const party2 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'حسام الدين فؤاد الشريف',
      idempotencyKey: `client-p2-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party2.party.id);

    const secondLink = await linkMatterParty(actor, {
      matterId: matterRes.matter.id,
      partyId: party2.party.id,
      role: 'CLIENT',
      idempotencyKey: `link-p2-${crypto.randomUUID()}`,
    });
    expect(secondLink.id).toBeDefined();

    // Unlinking party1 now succeeds because party2 remains active CLIENT
    await expect(
      unlinkMatterParty(actor, {
        id: clientLink!.id,
        matterId: matterRes.matter.id,
        expectedVersion: clientLink!.version,
        idempotencyKey: `unlink-client-success-${crypto.randomUUID()}`,
      })
    ).resolves.toBeUndefined();
  });

  it('T06-10: enforces optimistic concurrency on Matter updates', async () => {
    const result = await openMatter(actor, {
      title: 'ملف اختبار تعارض التعديل المتزامن',
      kind: 'CONTRACT',
      idempotencyKey: `concurrency-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(result.matter.id);

    // Update with correct version
    const updated = await updateMatter(actor, {
      id: result.matter.id,
      expectedVersion: 1,
      title: 'ملف اختبار تم تعديله بنجاح',
      kind: 'CONTRACT',
      status: 'DRAFT',
      idempotencyKey: `update-v1-${crypto.randomUUID()}`,
    });
    expect(updated.operationVersion).toBe(2);

    // Stale update using old version 1 must reject with ConcurrencyConflictError
    await expect(
      updateMatter(actor, {
        id: result.matter.id,
        expectedVersion: 1, // Stale!
        title: 'محاولة تعديل متزامنة متأخرة',
        kind: 'CONTRACT',
        status: 'DRAFT',
        idempotencyKey: `stale-update-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);
  });
});

