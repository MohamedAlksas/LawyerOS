import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { saveParty, revealPartyIdentity } from '@/modules/parties/service';
import { CryptoDecryptionError } from '@/lib/crypto/party-identity';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
  SYNTHETIC_ENCRYPTION_KEY,
  SYNTHETIC_KEY_ID,
} from '../helpers/party-test-helper';

describe('T05-08: Disaster Recovery & Key Custody Simulation (Integration)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const partyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  it('restores and decrypts identity in simulated new context with matching key (keyId: k2026_01)', async () => {
    const rawNationalId = '28701011234567';

    // 1. Party encrypted under initial context
    const party = await saveParty(actor, {
      kind: 'PERSON',
      name: 'محمود المليجي',
      identity: {
        identificationType: 'NATIONAL_ID',
        number: rawNationalId,
      },
      idempotencyKey: `recovery-test-${crypto.randomUUID()}`,
    });
    partyIds.push(party.party.id);

    // 2. Simulate process restart / disaster recovery context:
    // Reset process environment, then supply the exact same external backup key
    delete process.env.PARTY_IDENTITY_ENCRYPTION_KEY;
    delete process.env.PARTY_IDENTITY_KEY_ID;

    // In a restored context with matching key
    process.env.PARTY_IDENTITY_ENCRYPTION_KEY = SYNTHETIC_ENCRYPTION_KEY;
    process.env.PARTY_IDENTITY_KEY_ID = SYNTHETIC_KEY_ID;

    // Decryption must succeed cleanly
    const revealed = await revealPartyIdentity(actor, party.party.id, 'استعادة بعد التعافي');
    expect(revealed.number).toBe(rawNationalId);
    expect(revealed.identificationType).toBe('NATIONAL_ID');
  });

  it('fails closed when key is missing or wrong in recovery context without corrupting database row', async () => {
    const rawNationalId = '29301011234567';

    const party = await saveParty(actor, {
      kind: 'PERSON',
      name: 'رشدي أباظة',
      identity: {
        identificationType: 'NATIONAL_ID',
        number: rawNationalId,
      },
      idempotencyKey: `recovery-fail-${crypto.randomUUID()}`,
    });
    partyIds.push(party.party.id);

    // Provide a wrong key in recovery context
    process.env.PARTY_IDENTITY_ENCRYPTION_KEY =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    // Attempting to reveal must fail closed
    await expect(
      revealPartyIdentity(actor, party.party.id, 'محاولة بمفتاح خاطئ')
    ).rejects.toThrowError(CryptoDecryptionError);

    // Ensure database record was NOT corrupted, deleted, or altered
    const dbRecord = await prisma.partyIdentity.findFirstOrThrow({
      where: { partyId: party.party.id },
    });
    expect(dbRecord.lastFour).toBe('4567');
    expect(dbRecord.keyId).toBe(SYNTHETIC_KEY_ID);

    // Restore correct key and verify it can now decrypt successfully
    process.env.PARTY_IDENTITY_ENCRYPTION_KEY = SYNTHETIC_ENCRYPTION_KEY;
    process.env.PARTY_IDENTITY_KEY_ID = SYNTHETIC_KEY_ID;

    const revealed = await revealPartyIdentity(actor, party.party.id, 'محاولة بالمفتاح السليم');
    expect(revealed.number).toBe(rawNationalId);
  });
});

