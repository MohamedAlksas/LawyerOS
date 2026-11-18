import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
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

