import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { saveParty } from '@/modules/parties/service';
import { IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

describe('T05-04: Scoped Idempotency & Replay Mechanics (Integration)', () => {
  const prisma = getPrismaClient();
  const actor1 = createSyntheticActor({ id: 'actor-owner-1', email: 'owner1@test.local' });
  const actor2 = createSyntheticActor({ id: 'actor-owner-2', email: 'owner2@test.local' });
  const partyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  it('sequential duplicate submission returns existing result with isReplay: true without creating duplicates', async () => {
    const key = `idem-seq-${crypto.randomUUID()}`;
    const payload = {
      kind: 'PERSON' as const,
      name: 'هشام طلعت مصطفى',
      primaryPhone: '01011112222',
      idempotencyKey: key,
    };

    const first = await saveParty(actor1, payload);
    expect(first.success).toBe(true);
    expect(first.isReplay).toBeFalsy();
    partyIds.push(first.party.id);

    const second = await saveParty(actor1, payload);
    expect(second.success).toBe(true);
    expect(second.isReplay).toBe(true);
    expect(second.party.id).toBe(first.party.id);

    // Verify exactly ONE party was inserted
    const count = await prisma.party.count({
      where: { name: 'هشام طلعت مصطفى' },
    });
    expect(count).toBe(1);

    // Verify exactly ONE audit record was created
    const auditCount = await prisma.auditEvent.count({
      where: { entityId: first.party.id, action: 'CREATE_PARTY' },
    });
    expect(auditCount).toBe(1);
  });

  it('rejects reusing the same idempotency key with a differing payload', async () => {
    const key = `idem-mismatch-${crypto.randomUUID()}`;

    const first = await saveParty(actor1, {
      kind: 'PERSON',
      name: 'كريم عبد العزيز',
      idempotencyKey: key,
    });
    partyIds.push(first.party.id);

    // Attempting to use same key with different name
    await expect(
      saveParty(actor1, {
        kind: 'PERSON',
        name: 'كريم عبد العزيز المختلف',
        idempotencyKey: key,
      })
    ).rejects.toThrowError(IdempotencyPayloadMismatchError);
  });

  it('scopes idempotency keys by actor ID — different actors using same key do not collide', async () => {
    const sharedKey = `shared-key-across-actors-${crypto.randomUUID()}`;

    const p1 = await saveParty(actor1, {
      kind: 'PERSON',
      name: 'عميل المالك الأول',
      idempotencyKey: sharedKey,
    });
    partyIds.push(p1.party.id);

    const p2 = await saveParty(actor2, {
      kind: 'PERSON',
      name: 'عميل المالك الثاني',
      idempotencyKey: sharedKey,
    });
    partyIds.push(p2.party.id);

    expect(p1.party.id).not.toBe(p2.party.id);
    expect(p1.party.name).toBe('عميل المالك الأول');
    expect(p2.party.name).toBe('عميل المالك الثاني');
  });
});

