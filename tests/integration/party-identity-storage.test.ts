import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { computePayloadHash } from '@/lib/idempotency';
import {
  saveParty,
  getClientProfile,
  revealPartyIdentity,
} from '@/modules/parties/service';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
  SYNTHETIC_KEY_ID,
} from '../helpers/party-test-helper';

describe('T05-07: Party Identity Storage, Masking & Audited Reveal (Integration)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const partyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  it('stores identity as ciphertext envelope and guarantees zero plaintext leakage in database', async () => {
    const rawNationalId = '29508151234567';
    const partyName = 'إسماعيل ياسين';

    const result = await saveParty(actor, {
      kind: 'PERSON',
      name: partyName,
      identity: {
        identificationType: 'NATIONAL_ID',
        number: rawNationalId,
      },
      idempotencyKey: `identity-storage-${crypto.randomUUID()}`,
    });
    partyIds.push(result.party.id);

    // 1. Inspect direct database record
    const identityRow = await prisma.partyIdentity.findFirstOrThrow({
      where: { partyId: result.party.id },
    });

    expect(identityRow.identificationType).toBe('NATIONAL_ID');
    expect(identityRow.keyId).toBe(SYNTHETIC_KEY_ID);
    expect(identityRow.encryptionVersion).toBe(1);
    expect(identityRow.lastFour).toBe('4567');
    expect(identityRow.iv).toBeDefined();
    expect(identityRow.authTag).toBeDefined();
    expect(identityRow.ciphertext).toBeDefined();

    // Verify plaintext raw national ID is NOT present in any column
    expect(identityRow.ciphertext).not.toBe(rawNationalId);
    expect(identityRow.iv).not.toBe(rawNationalId);
    expect(identityRow.authTag).not.toBe(rawNationalId);

    // Verify party table does not store identity
    const partyRow = await prisma.party.findUniqueOrThrow({
      where: { id: result.party.id },
    });
    const partyString = JSON.stringify(partyRow);
    expect(partyString).not.toContain(rawNationalId);
  });

  it('getClientProfile returns only masked identity and never exposes plaintext', async () => {
    const rawPassport = 'A12345678';
    const result = await saveParty(actor, {
      kind: 'PERSON',
      name: 'نجيب محفوظ',
      identity: {
        identificationType: 'PASSPORT',
        number: rawPassport,
      },
      idempotencyKey: `identity-mask-${crypto.randomUUID()}`,
    });
    partyIds.push(result.party.id);

    const profile = await getClientProfile(actor, result.party.id);
    expect(profile.identityMask).toBeDefined();
    expect(profile.identityMask?.identificationType).toBe('PASSPORT');
    expect(profile.identityMask?.lastFour).toBe('5678');

    // DTO serialization does not contain full plaintext passport
    const profileJson = JSON.stringify(profile);
    expect(profileJson).not.toContain(rawPassport);
  });

  it('suppresses complete short identifiers in stored masks and redacts reveal audit data', async () => {
    const number = 'Z9L2';
    const input = {
      kind: 'PERSON' as const,
      name: 'صاحب وثيقة اختبارية',
      identity: { identificationType: 'PASSPORT' as const, number },
      idempotencyKey: `short-identity-${crypto.randomUUID()}`,
    };
    const result = await saveParty(actor, input);
    partyIds.push(result.party.id);
    const identity = await prisma.partyIdentity.findFirstOrThrow({ where: { partyId: result.party.id } });
    expect(identity.lastFour).toBe('');
    expect(result.party.identityMask?.lastFour).toBe('');
    // Legacy records can contain the entire identifier in their display suffix.
    await prisma.partyIdentity.update({ where: { id: identity.id }, data: { lastFour: number } });
    expect((await getClientProfile(actor, result.party.id)).identityMask?.lastFour).toBe('');
    expect((await revealPartyIdentity(actor, result.party.id, number)).number).toBe(number);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: identity.id, action: 'REVEAL_IDENTITY' },
    });
    expect(JSON.stringify([audit.reason, audit.changedFields])).not.toContain(number);
    const claim = await prisma.idempotencyRecord.findFirstOrThrow({ where: { key: input.idempotencyKey } });
    expect(claim.payloadHash).toMatch(/^hmac-v1:[a-f0-9]{64}$/);
    expect(claim.payloadHash).not.toBe(computePayloadHash(input));
    expect((await saveParty(actor, input)).party.id).toBe(result.party.id);
  });

  it('revealPartyIdentity decrypts full number for authorized owner and writes audit trail', async () => {
    const rawNationalId = '29901011234999';
    const result = await saveParty(actor, {
      kind: 'PERSON',
      name: 'توفيق الحكيم',
      identity: {
        identificationType: 'NATIONAL_ID',
        number: rawNationalId,
      },
      idempotencyKey: `identity-reveal-${crypto.randomUUID()}`,
    });
    partyIds.push(result.party.id);

    const revealResult = await revealPartyIdentity(
      actor,
      result.party.id,
      'عرض رسمي للتحقق أمام المحكمة'
    );

    expect(revealResult.identificationType).toBe('NATIONAL_ID');
    expect(revealResult.number).toBe(rawNationalId);

    // Verify audit event was recorded for identity reveal
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        action: 'REVEAL_IDENTITY',
        entityType: 'PartyIdentity',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(audit.userId).toBe(actor.id);
    expect(audit.reason).toBe('عرض رسمي للتحقق أمام المحكمة');
    // Audit payload must NOT leak full number
    expect(JSON.stringify(audit)).not.toContain(rawNationalId);
  });
});

