import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { saveParty, searchParties } from '@/modules/parties/service';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

describe('T05-02: Party Search & Duplicate Warnings (Integration)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const partyIds: string[] = [];

  beforeAll(async () => {
    setupTestEncryptionKeys();

    // Seed synthetic parties with various typographic variations
    const p1 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'أحمد إبراهيم علي',
      primaryPhone: '01012345678',
      idempotencyKey: `seed-search-1-${crypto.randomUUID()}`,
    });
    partyIds.push(p1.party.id);

    const p2 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'فاطمة مصطفى حسن',
      primaryPhone: '01122334455',
      idempotencyKey: `seed-search-2-${crypto.randomUUID()}`,
    });
    partyIds.push(p2.party.id);

    const p3 = await saveParty(actor, {
      kind: 'ORGANIZATION',
      name: 'شركة النور للمقاولات والتجارة',
      primaryPhone: '0223456789',
      idempotencyKey: `seed-search-3-${crypto.randomUUID()}`,
    });
    partyIds.push(p3.party.id);
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  it('matches Alef and Tashkeel variants across search queries', async () => {
    // Searching for "احمد" without Hamza matches "أحمد"
    const res1 = await searchParties(actor, { query: 'احمد' });
    expect(res1.parties.some((p) => p.name === 'أحمد إبراهيم علي')).toBe(true);

    // Searching with diacritics "إِبْرَاهِيم" matches
    const res2 = await searchParties(actor, { query: 'إِبْرَاهِيم' });
    expect(res2.parties.some((p) => p.name === 'أحمد إبراهيم علي')).toBe(true);

    // Searching "فاطمه" with Haa matches "فاطمة" with Taa Marbuta
    const res3 = await searchParties(actor, { query: 'فاطمه' });
    expect(res3.parties.some((p) => p.name === 'فاطمة مصطفى حسن')).toBe(true);

    // Searching "مصطفي" with Yaa matches "مصطفى" with Alif Maqsura
    const res4 = await searchParties(actor, { query: 'مصطفي' });
    expect(res4.parties.some((p) => p.name === 'فاطمة مصطفى حسن')).toBe(true);
  });

  it('matches phone numbers entered with Eastern Arabic-Indic digits or international prefix', async () => {
    // Search using Eastern Arabic-Indic digits "٠١٠١٢٣٤٥٦٧٨"
    const res1 = await searchParties(actor, { query: '٠١٠١٢٣٤٥٦٧٨' });
    expect(res1.parties.some((p) => p.name === 'أحمد إبراهيم علي')).toBe(true);

    // Search using international prefix "+20 10 1234 5678"
    const res2 = await searchParties(actor, { query: '+20 10 1234 5678' });
    expect(res2.parties.some((p) => p.name === 'أحمد إبراهيم علي')).toBe(true);
  });

  it('filters results by kind', async () => {
    const resOrgs = await searchParties(actor, { kind: 'ORGANIZATION' });
    expect(resOrgs.parties.every((p) => p.kind === 'ORGANIZATION')).toBe(true);
    expect(resOrgs.parties.some((p) => p.name === 'شركة النور للمقاولات والتجارة')).toBe(true);

    const resPersons = await searchParties(actor, { kind: 'PERSON' });
    expect(resPersons.parties.every((p) => p.kind === 'PERSON')).toBe(true);
  });

  it('returns advisory duplicate warning without blocking creation of distinct party', async () => {
    // Attempting to create a party with the exact same name as p1
    const duplicateCheck = await saveParty(actor, {
      kind: 'PERSON',
      name: 'أحمد إبراهيم علي',
      primaryPhone: '01599887766', // Different phone
      idempotencyKey: `duplicate-test-1-${crypto.randomUUID()}`,
    });

    expect(duplicateCheck.success).toBe(true);
    partyIds.push(duplicateCheck.party.id);

    // Advisory duplicate warning is returned
    expect(duplicateCheck.duplicateWarnings.length).toBeGreaterThan(0);
    const warning = duplicateCheck.duplicateWarnings.find((w) => w.name === 'أحمد إبراهيم علي');
    expect(warning).toBeDefined();
    expect(warning?.matchType).toBe('NAME');

    // Both parties exist distinctly in the database (no auto-merge)
    const allMatches = await searchParties(actor, { query: 'أحمد إبراهيم علي' });
    const matchingIds = allMatches.parties.filter((p) => p.name === 'أحمد إبراهيم علي').map((p) => p.id);
    expect(matchingIds).toContain(partyIds[0]);
    expect(matchingIds).toContain(duplicateCheck.party.id);
    expect(partyIds[0]).not.toBe(duplicateCheck.party.id);
  });

  it('supports bounded pagination with totalCount and totalPages', async () => {
    const paged = await searchParties(actor, { page: 1, limit: 2 });
    expect(paged.parties.length).toBeLessThanOrEqual(2);
    expect(paged.page).toBe(1);
    expect(paged.totalCount).toBeGreaterThanOrEqual(3);
    expect(paged.totalPages).toBe(Math.ceil(paged.totalCount / 2));
  });
});


