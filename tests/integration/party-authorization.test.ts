import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  saveParty,
  searchParties,
  getClientProfile,
  addCommunicationNote,
  savePowerOfAttorney,
  revealPartyIdentity,
} from '@/modules/parties/service';
import { AuthorizationError } from '@/modules/identity/types';
import {
  createSyntheticActor,
  createSyntheticMaintainer,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

describe('T05-06: Server-Side Authorization & Role Access Controls (Integration)', () => {
  const prisma = getPrismaClient();
  const owner = createSyntheticActor();
  const maintainer = createSyntheticMaintainer();
  const partyIds: string[] = [];
  let existingPartyId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    const party = await saveParty(owner, {
      kind: 'PERSON',
      name: 'عميل اختبار الصلاحيات',
      primaryPhone: '01099887766',
      identity: {
        identificationType: 'NATIONAL_ID',
        number: '28001011234567',
      },
      idempotencyKey: `auth-test-setup-1-${crypto.randomUUID()}`,
    });
    existingPartyId = party.party.id;
    partyIds.push(existingPartyId);
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  describe('MAINTAINER Role Policy Checks', () => {
    it('strictly forbids MAINTAINER from creating new party records', async () => {
      await expect(
        saveParty(maintainer, {
          kind: 'PERSON',
          name: 'محاولة اختراق الصيانة',
          idempotencyKey: 'maint-create-attempt',
        })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from searching parties', async () => {
      await expect(
        searchParties(maintainer, { query: 'عميل' })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from viewing client profile', async () => {
      await expect(
        getClientProfile(maintainer, existingPartyId)
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from adding communication notes', async () => {
      await expect(
        addCommunicationNote(maintainer, {
          partyId: existingPartyId,
          communicationAt: new Date().toISOString(),
          channel: 'PHONE',
          summary: 'ملاحظة صيانة غير مصرح بها',
          idempotencyKey: 'maint-comm-attempt',
        })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from saving powers of attorney', async () => {
      await expect(
        savePowerOfAttorney(maintainer, {
          partyId: existingPartyId,
          poaNumberText: '001/أ',
          poaYearLabel: '2026',
          notarizationOffice: 'مكتب التوثيق',
          poaType: 'GENERAL',
          idempotencyKey: 'maint-poa-attempt',
        })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from revealing identity numbers', async () => {
      await expect(
        revealPartyIdentity(maintainer, existingPartyId, 'محاولة غير مصرحة')
      ).rejects.toThrowError(AuthorizationError);
    });
  });

  describe('OWNER Role Execution', () => {
    it('allows verified OWNER to search, view profile, and add communication note', async () => {
      const searchRes = await searchParties(owner, { query: 'عميل اختبار' });
      expect(searchRes.parties.length).toBeGreaterThan(0);

      const profile = await getClientProfile(owner, existingPartyId);
      expect(profile.name).toBe('عميل اختبار الصلاحيات');

      const note = await addCommunicationNote(owner, {
        partyId: existingPartyId,
        communicationAt: new Date().toISOString(),
        channel: 'PHONE',
        summary: 'ملاحظة تواصل مصرح بها من المالك',
        idempotencyKey: `owner-comm-allowed-${crypto.randomUUID()}`,
      });
      expect(note.id).toBeDefined();
    });
  });
});

