import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { saveParty, ConcurrencyConflictError } from '@/modules/parties/service';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

describe('T05-03: Version Conflicts & Optimistic Concurrency (Integration)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const partyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  it('atomically increments version from 1 to 2 on successful update', async () => {
    const created = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طارق حسام الدين',
      idempotencyKey: `concurrency-init-${crypto.randomUUID()}`,
    });
    partyIds.push(created.party.id);
    expect(created.party.version).toBe(1);

    const updated = await saveParty(actor, {
      id: created.party.id,
      kind: 'PERSON',
      name: 'طارق حسام الدين المعدل',
      expectedVersion: 1,
      idempotencyKey: `concurrency-update-${crypto.randomUUID()}`,
    });

    expect(updated.party.version).toBe(2);
    expect(updated.party.name).toBe('طارق حسام الدين المعدل');
  });

  it('rejects update with stale expectedVersion and throws ConcurrencyConflictError', async () => {
    const created = await saveParty(actor, {
      kind: 'PERSON',
      name: 'ياسر كمال',
      idempotencyKey: `concurrency-stale-${crypto.randomUUID()}`,
    });
    partyIds.push(created.party.id);

    // Update 1: version goes to 2
    await saveParty(actor, {
      id: created.party.id,
      kind: 'PERSON',
      name: 'ياسر كمال - تعديل أول',
      expectedVersion: 1,
      idempotencyKey: `concurrency-stale-2-${crypto.randomUUID()}`,
    });

    // Update 2 with old version 1 must fail
    await expect(
      saveParty(actor, {
        id: created.party.id,
        kind: 'PERSON',
        name: 'ياسر كمال - تعديل متأخر',
        expectedVersion: 1, // Stale!
        idempotencyKey: `concurrency-stale-3-${crypto.randomUUID()}`,
      })
    ).rejects.toThrowError(ConcurrencyConflictError);

    // Verify database record has not been overwritten by stale update
    const current = await prisma.party.findUniqueOrThrow({
      where: { id: created.party.id },
    });
    expect(current.version).toBe(2);
    expect(current.name).toBe('ياسر كمال - تعديل أول');
  });

  it('resolves concurrent updates from same version: exactly 1 succeeds and 1 fails with conflict', async () => {
    const created = await saveParty(actor, {
      kind: 'PERSON',
      name: 'نبيل سعيد',
      idempotencyKey: `concurrency-race-init-${crypto.randomUUID()}`,
    });
    partyIds.push(created.party.id);

    // Both concurrent requests start with expectedVersion = 1
    const promise1 = saveParty(actor, {
      id: created.party.id,
      kind: 'PERSON',
      name: 'نبيل سعيد - المتسابق أ',
      expectedVersion: 1,
      idempotencyKey: `concurrency-race-1-${crypto.randomUUID()}`,
    });

    const promise2 = saveParty(actor, {
      id: created.party.id,
      kind: 'PERSON',
      name: 'نبيل سعيد - المتسابق ب',
      expectedVersion: 1,
      idempotencyKey: `concurrency-race-2-${crypto.randomUUID()}`,
    });

    const results = await Promise.allSettled([promise1, promise2]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const rejectedError = (failures[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(ConcurrencyConflictError);

    // Final record version is exactly 2
    const finalRecord = await prisma.party.findUniqueOrThrow({
      where: { id: created.party.id },
    });
    expect(finalRecord.version).toBe(2);
  });
});


