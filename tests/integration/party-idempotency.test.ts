import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  saveParty,
  addCommunicationNote,
  savePowerOfAttorney,
} from '@/modules/parties/service';
import { IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import type { SavePartyResult } from '@/modules/parties/types';
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
      address: 'شارع مصدق، الدقي، الجيزة',
      notes: 'ملاحظات سرية للغاية عن العميل لا يجب تخزينها في سجلات التكرار',
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

    // STD-01 / T05-05: Verify IdempotencyRecord.resultPayload contains ZERO confidential notes or address
    const idempRecord = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        actorId_commandType_key: {
          actorId: actor1.id,
          commandType: 'saveParty',
          key,
        },
      },
    });

    const storedPayload = idempRecord.resultPayload as Record<string, unknown>;
    expect(storedPayload.command).toBe('saveParty');
    expect(storedPayload.partyId).toBe(first.party.id);
    expect(storedPayload.notes).toBeUndefined();
    expect(storedPayload.address).toBeUndefined();
    expect(storedPayload.party).toBeUndefined(); // No nested full party DTO
    expect(JSON.stringify(storedPayload)).not.toContain('ملاحظات سرية للغاية');
  });

  it('guarantees zero confidential snapshots in idempotency storage across addCommunicationNote and savePowerOfAttorney', async () => {
    // 1. Setup base party
    const party = await saveParty(actor1, {
      kind: 'PERSON',
      name: 'عميل اختبار التكرار المحمي',
      idempotencyKey: `setup-party-${crypto.randomUUID()}`,
    });
    partyIds.push(party.party.id);

    // 2. Add Communication Note with sensitive details
    const commKey = `comm-idem-${crypto.randomUUID()}`;
    const commInstant = new Date().toISOString();
    const sensitiveSummary = 'جلسة استشارية سرية جداً بخصوص تفاوض تسوية مالية';
    const note1 = await addCommunicationNote(actor1, {
      partyId: party.party.id,
      communicationAt: commInstant,
      channel: 'IN_PERSON',
      summary: sensitiveSummary,
      followUpRequired: true,
      followUpDate: '2026-11-25',
      idempotencyKey: commKey,
    });

    // Verify raw idempotency storage contains zero sensitive summary
    const commIdemp = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        actorId_commandType_key: {
          actorId: actor1.id,
          commandType: 'addCommunicationNote',
          key: commKey,
        },
      },
    });
    const commPayload = commIdemp.resultPayload as Record<string, unknown>;
    expect(commPayload.command).toBe('addCommunicationNote');
    expect(commPayload.noteId).toBe(note1.id);
    expect(commPayload.summary).toBeUndefined();
    expect(JSON.stringify(commPayload)).not.toContain(sensitiveSummary);

    // Replay communication note and verify reconstructed result matches authorized note
    const noteReplay = await addCommunicationNote(actor1, {
      partyId: party.party.id,
      communicationAt: commInstant,
      channel: 'IN_PERSON',
      summary: sensitiveSummary,
      followUpRequired: true,
      followUpDate: '2026-11-25',
      idempotencyKey: commKey,
    });
    expect(noteReplay.id).toBe(note1.id);
    expect(noteReplay.summary).toBe(sensitiveSummary);

    // 3. Save Power of Attorney with confidential lawyer notes
    const poaKey = `poa-idem-${crypto.randomUUID()}`;
    const sensitivePoaNotes = 'التوكيل خاص بإجراءات التنازل فقط ولا يشمل قبض المبالغ';
    const poa1 = await savePowerOfAttorney(actor1, {
      partyId: party.party.id,
      poaNumberText: '9988/أ',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق شمال القاهرة',
      poaType: 'SPECIAL',
      issueDate: '2026-10-15',
      notes: sensitivePoaNotes,
      idempotencyKey: poaKey,
    });

    // Verify raw idempotency storage contains zero confidential POA notes
    const poaIdemp = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        actorId_commandType_key: {
          actorId: actor1.id,
          commandType: 'savePowerOfAttorney',
          key: poaKey,
        },
      },
    });
    const poaPayload = poaIdemp.resultPayload as Record<string, unknown>;
    expect(poaPayload.command).toBe('savePowerOfAttorney');
    expect(poaPayload.poaId).toBe(poa1.id);
    expect(poaPayload.notes).toBeUndefined();
    expect(JSON.stringify(poaPayload)).not.toContain(sensitivePoaNotes);

    // Replay POA and verify reconstructed response
    const poaReplay = await savePowerOfAttorney(actor1, {
      partyId: party.party.id,
      poaNumberText: '9988/أ',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق شمال القاهرة',
      poaType: 'SPECIAL',
      issueDate: '2026-10-15',
      notes: sensitivePoaNotes,
      idempotencyKey: poaKey,
    });
    expect(poaReplay.id).toBe(poa1.id);
    expect(poaReplay.notes).toBe(sensitivePoaNotes);
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

  it('replay after intervening edit returns operationVersion: 1 and currentVersion: 2 without misrepresenting state (R2-04)', async () => {
    const key1 = `idem-edit-orig-${crypto.randomUUID()}`;
    const key2 = `idem-edit-second-${crypto.randomUUID()}`;

    // 1. Create party at version 1 under key1
    const original = await saveParty(actor1, {
      kind: 'PERSON',
      name: 'طرف لاختبار التعديل المتداخل',
      idempotencyKey: key1,
    });
    partyIds.push(original.party.id);
    expect(original.party.version).toBe(1);

    // 2. Perform intervening update under key2 (advances to version 2)
    const updated = await saveParty(actor1, {
      id: original.party.id,
      kind: 'PERSON',
      name: 'طرف بعد التعديل المتداخل',
      expectedVersion: 1,
      idempotencyKey: key2,
    });
    expect(updated.party.version).toBe(2);

    // 3. Replay original key1
    const replayed = await saveParty(actor1, {
      kind: 'PERSON',
      name: 'طرف لاختبار التعديل المتداخل',
      idempotencyKey: key1,
    });
    expect(replayed.isReplay).toBe(true);
    expect(replayed.operationVersion).toBe(1);
    expect(replayed.currentVersion).toBe(2);
    // Callers cannot misrepresent later edits as the outcome of the original save
    expect(replayed.party.version).toBe(1);
    expect(replayed.party.id).toBe(original.party.id);
  });

  it('handles simultaneous identical-key requests via Promise.allSettled: both succeed, 1 initial and 1 replay (R2-05)', async () => {
    const sharedKey = `idem-concurrent-same-${crypto.randomUUID()}`;
    const payload = {
      kind: 'PERSON' as const,
      name: 'طرف للتسابق المتزامن بنفس المفتاح',
      primaryPhone: '01022334455',
      idempotencyKey: sharedKey,
    };

    // Fire both requests concurrently
    const [res1, res2] = await Promise.all([
      saveParty(actor1, payload),
      saveParty(actor1, payload),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.party.id).toBe(res2.party.id);

    const replayCount = (res1.isReplay ? 1 : 0) + (res2.isReplay ? 1 : 0);
    expect(replayCount).toBe(1); // Exactly one is the initial creator, and one is the concurrent replay!
    partyIds.push(res1.party.id);
  });

  it('handles simultaneous differing-payload requests on same key: rejects with IdempotencyPayloadMismatchError (R2-05)', async () => {
    const sharedKey = `idem-concurrent-diff-${crypto.randomUUID()}`;

    const payloadA = {
      kind: 'PERSON' as const,
      name: 'طرف أول متسابق',
      idempotencyKey: sharedKey,
    };

    const payloadB = {
      kind: 'PERSON' as const,
      name: 'طرف ثاني مختلف في نفس اللحظة',
      idempotencyKey: sharedKey,
    };

    const results = await Promise.allSettled([
      saveParty(actor1, payloadA),
      saveParty(actor1, payloadB),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<SavePartyResult> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejError = rejected[0]?.reason as Error | undefined;
    expect(rejError instanceof IdempotencyPayloadMismatchError || rejError?.name === 'IdempotencyPayloadMismatchError').toBe(true);

    const winningResult = fulfilled[0];
    if (winningResult) {
      partyIds.push(winningResult.value.party.id);
    }
  });
});

