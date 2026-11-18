import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { saveParty, getClientProfile } from '@/modules/parties/service';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

describe('T05-01: Basic Party Records & Contacts Persistence (Integration)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdPartyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    await cleanupPartyFixtures(prisma, createdPartyIds);
    createdPartyIds.length = 0;
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, createdPartyIds);
  });

  it('persists and reloads PERSON without phone or identity number', async () => {
    const result = await saveParty(actor, {
      kind: 'PERSON',
      name: 'محمود عبد الرازق حسن',
      idempotencyKey: `basic-person-${crypto.randomUUID()}`,
    });

    expect(result.success).toBe(true);
    expect(result.party.id).toBeDefined();
    expect(result.party.kind).toBe('PERSON');
    expect(result.party.name).toBe('محمود عبد الرازق حسن');
    expect(result.party.primaryPhone).toBeNull();
    expect(result.party.identityMask).toBeNull();
    expect(result.party.version).toBe(1);

    createdPartyIds.push(result.party.id);

    // Reload from database
    const profile = await getClientProfile(actor, result.party.id);
    expect(profile.id).toBe(result.party.id);
    expect(profile.name).toBe('محمود عبد الرازق حسن');
    expect(profile.primaryPhone).toBeNull();
    expect(profile.identityMask).toBeNull();
    expect(profile.version).toBe(1);
  });

  it('persists and reloads ORGANIZATION with full optional contact details', async () => {
    const result = await saveParty(actor, {
      kind: 'ORGANIZATION',
      name: 'شركة القاهرة للمقاولات العامة ش.م.م',
      primaryPhone: '01012345678',
      additionalPhones: ['01198765432', '0223456789'],
      email: 'info@cairo-contracting.test',
      address: '١٥ شارع طلعت حرب، وسط البلد، القاهرة',
      notes: 'شركة مقاولات قطاع خاص، قيد التأسيس من ٢٠١٠',
      idempotencyKey: `basic-org-${crypto.randomUUID()}`,
    });

    expect(result.success).toBe(true);
    createdPartyIds.push(result.party.id);

    const profile = await getClientProfile(actor, result.party.id);
    expect(profile.kind).toBe('ORGANIZATION');
    expect(profile.name).toBe('شركة القاهرة للمقاولات العامة ش.م.م');
    expect(profile.primaryPhone).toBe('01012345678');
    expect(profile.additionalPhones).toEqual(['01198765432', '0223456789']);
    expect(profile.email).toBe('info@cairo-contracting.test');
    expect(profile.address).toBe('١٥ شارع طلعت حرب، وسط البلد، القاهرة');
    expect(profile.notes).toBe('شركة مقاولات قطاع خاص، قيد التأسيس من ٢٠١٠');
  });

  it('preserves exact Arabic typography, leading zeros, and mixed text round-trip', async () => {
    const specialName = 'د. أحمد سمير (المستشار القانوني) - 007';
    const result = await saveParty(actor, {
      kind: 'PERSON',
      name: specialName,
      primaryPhone: '+20 10 0012 3456',
      notes: 'مرجع العميل: كود 0045/أ',
      idempotencyKey: `basic-typography-${crypto.randomUUID()}`,
    });

    createdPartyIds.push(result.party.id);

    const dbRow = await prisma.party.findUniqueOrThrow({
      where: { id: result.party.id },
    });

    // Original string is preserved unaltered
    expect(dbRow.name).toBe(specialName);
    expect(dbRow.primaryPhone).toBe('+20 10 0012 3456');
    expect(dbRow.notes).toBe('مرجع العميل: كود 0045/أ');

    // Normalized search fields derived correctly
    expect(dbRow.nameNormalized).toContain('احمد سمير');
    expect(dbRow.primaryPhoneNormalized).toBe('01000123456');
  });
});


