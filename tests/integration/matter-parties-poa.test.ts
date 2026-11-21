import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  linkMatterParty,
  unlinkMatterParty,
  updateMatterParty,
  addProceeding,
  linkProceedingParty,
  linkMatterAuthorization,
  unlinkMatterAuthorization,
  getMatter,
} from '@/modules/matters/matter-service';
import { createReferenceItem } from '@/modules/settings/reference-service';
import { saveParty, savePowerOfAttorney, getClientProfile } from '@/modules/parties/service';
import {
  MatterValidationError,
  PrimaryContactConflictError,
  ClientPoaDependencyError,
  CrossMatterLinkForbiddenError,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  setupTestEncryptionKeys,
  cleanupPartyFixtures,
} from '../helpers/party-test-helper';
import {
  cleanupMatterFixtures,
  cleanupReferenceFixtures,
} from '../helpers/matter-test-helper';

describe('T06-03 & T06-07: Office Roles, Primary Contacts & POA Associations', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];

  let testCourtId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: 'محكمة الجيزة الابتدائية',
      code: 'GZ-01',
      idempotencyKey: `court-parties-${crypto.randomUUID()}`,
    });
    testCourtId = court.id;
    createdCourtIds.push(court.id);
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
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  it('T06-03: scopes office roles per matter without global Party mutation', async () => {
    const party = await saveParty(actor, {
      kind: 'PERSON',
      name: 'سامح لطفي الميرغني',
      idempotencyKey: `shared-party-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party.party.id);

    // Matter A: party is CLIENT
    const matterA = await openMatter(actor, {
      title: 'ملف دعوى تجارية للموكل سامح',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: party.party.id,
      idempotencyKey: `matter-a-client-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matterA.matter.id);

    // Matter B: party is OPPONENT
    const matterB = await openMatter(actor, {
      title: 'ملف نزاع عمالي مرفوع ضد سامح',
      kind: 'LITIGATION',
      idempotencyKey: `matter-b-opponent-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matterB.matter.id);

    const opponentLink = await linkMatterParty(actor, {
      matterId: matterB.matter.id,
      partyId: party.party.id,
      role: 'OPPONENT',
      idempotencyKey: `link-opponent-${crypto.randomUUID()}`,
    });

    expect(matterA.matter.parties?.[0].role).toBe('CLIENT');
    expect(opponentLink.role).toBe('OPPONENT');

    // Party record itself is unchanged (no global "client" flag)
    const partyProfile = await getClientProfile(actor, party.party.id);
    expect(partyProfile.id).toBe(party.party.id);
    expect(partyProfile.name).toBe('سامح لطفي الميرغني');
  });

  it('T06-03: enforces at most one primary contact per matter', async () => {
    const p1 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'أحمد كمال الدين',
      idempotencyKey: `p1-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(p1.party.id);

    const p2 = await saveParty(actor, {
      kind: 'PERSON',
      name: 'ياسر كمال الدين',
      idempotencyKey: `p2-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(p2.party.id);

    const matter = await openMatter(actor, {
      title: 'ملف ورثة تركة المرحوم كمال',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: p1.party.id, // p1 is created as primary contact
      idempotencyKey: `matter-primary-check-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    // Attempting to link p2 as primary contact must throw PrimaryContactConflictError
    await expect(
      linkMatterParty(actor, {
        matterId: matter.matter.id,
        partyId: p2.party.id,
        role: 'CLIENT',
        isPrimaryContact: true, // Conflict!
        idempotencyKey: `link-p2-primary-conflict-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(PrimaryContactConflictError);

    // Linking p2 with isPrimaryContact: false succeeds
    const linkP2 = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: p2.party.id,
      role: 'CLIENT',
      isPrimaryContact: false,
      idempotencyKey: `link-p2-ok-${crypto.randomUUID()}`,
    });
    expect(linkP2.isPrimaryContact).toBe(false);

    // Reject duplicate triple (matterId, partyId, role)
    await expect(
      linkMatterParty(actor, {
        matterId: matter.matter.id,
        partyId: p2.party.id,
        role: 'CLIENT', // Duplicate triple!
        idempotencyKey: `duplicate-triple-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);

    // Trying to update p2 to primary contact while p1 is still primary must throw conflict
    await expect(
      updateMatterParty(actor, {
        id: linkP2.id,
        matterId: matter.matter.id,
        expectedVersion: linkP2.version,
        role: 'CLIENT',
        isPrimaryContact: true,
        idempotencyKey: `update-p2-primary-conflict-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(PrimaryContactConflictError);

    // Unlinking non-last client succeeds cleanly
    await expect(
      unlinkMatterParty(actor, {
        id: linkP2.id,
        matterId: matter.matter.id,
        expectedVersion: linkP2.version,
        idempotencyKey: `unlink-p2-clean-${crypto.randomUUID()}`,
      })
    ).resolves.toBeUndefined();
  });

  it('T06-03 & T06-04: links proceeding legal capacities to matter parties within same matter', async () => {
    const clientParty = await saveParty(actor, {
      kind: 'PERSON',
      name: 'المدعي مجدي توفيق',
      idempotencyKey: `client-cap-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientParty.party.id);

    const opponentParty = await saveParty(actor, {
      kind: 'PERSON',
      name: 'المدعى عليه رمزي سلامة',
      idempotencyKey: `opponent-cap-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(opponentParty.party.id);

    const matter = await openMatter(actor, {
      title: 'دعوى فسخ عقد إيجار',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: clientParty.party.id,
      idempotencyKey: `matter-cap-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const opponentMatterParty = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: opponentParty.party.id,
      role: 'OPPONENT',
      idempotencyKey: `link-opp-cap-${crypto.randomUUID()}`,
    });

    const clientMatterParty = matter.matter.parties![0];

    const proceeding = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '334',
      yearLabel: '2026',
      registerType: 'إيجارات كلي',
      status: 'ACTIVE',
      idempotencyKey: `proc-cap-${crypto.randomUUID()}`,
    });

    // Link client as PLAINTIFF
    const clientCap = await linkProceedingParty(actor, {
      proceedingId: proceeding.id,
      matterPartyId: clientMatterParty.id,
      legalCapacity: 'PLAINTIFF',
      expectedVersion: proceeding.version,
      idempotencyKey: `link-plaintiff-${crypto.randomUUID()}`,
    });
    expect(clientCap.legalCapacity).toBe('PLAINTIFF');
    expect(clientCap.partyName).toBe('المدعي مجدي توفيق');

    // Link opponent as DEFENDANT
    const oppCap = await linkProceedingParty(actor, {
      proceedingId: proceeding.id,
      matterPartyId: opponentMatterParty.id,
      legalCapacity: 'DEFENDANT',
      expectedVersion: clientCap.version || 2,
      idempotencyKey: `link-defendant-${crypto.randomUUID()}`,
    });
    expect(oppCap.legalCapacity).toBe('DEFENDANT');
    expect(oppCap.partyName).toBe('المدعى عليه رمزي سلامة');

    // Linking proceeding party from a different matter must throw CrossMatterLinkForbiddenError
    const foreignMatter = await openMatter(actor, {
      title: 'ملف خارجي منفصل',
      kind: 'CONTRACT',
      idempotencyKey: `foreign-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(foreignMatter.matter.id);

    const foreignParty = await linkMatterParty(actor, {
      matterId: foreignMatter.matter.id,
      partyId: opponentParty.party.id,
      role: 'CLIENT',
      idempotencyKey: `foreign-link-${crypto.randomUUID()}`,
    });

    await expect(
      linkProceedingParty(actor, {
        proceedingId: proceeding.id,
        matterPartyId: foreignParty.id, // From foreign matter!
        legalCapacity: 'INTERVENOR',
        expectedVersion: oppCap.version || 3,
        idempotencyKey: `cross-matter-cap-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);
  });

  it('T06-07: links POA to matter only when holder is CLIENT in that matter', async () => {
    const client = await saveParty(actor, {
      kind: 'PERSON',
      name: 'شريف فوزي عبد الله',
      idempotencyKey: `poa-client-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(client.party.id);

    const opponent = await saveParty(actor, {
      kind: 'PERSON',
      name: 'سمير خليل مرقص',
      idempotencyKey: `poa-opp-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(opponent.party.id);

    // Save POA for client
    const clientPoa = await savePowerOfAttorney(actor, {
      partyId: client.party.id,
      poaNumberText: '5541/ب',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق الأهرام النموذجي',
      poaType: 'LITIGATION',
      idempotencyKey: `poa-record-client-${crypto.randomUUID()}`,
    });

    // Save POA for opponent
    const oppPoa = await savePowerOfAttorney(actor, {
      partyId: opponent.party.id,
      poaNumberText: '1102/أ',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق قصر النيل',
      poaType: 'GENERAL',
      idempotencyKey: `poa-record-opp-${crypto.randomUUID()}`,
    });

    const matter = await openMatter(actor, {
      title: 'ملف لفحص اشتراطات سند التوكيل',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: client.party.id,
      idempotencyKey: `matter-poa-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: opponent.party.id,
      role: 'OPPONENT',
      idempotencyKey: `link-opp-for-poa-${crypto.randomUUID()}`,
    });

    // 1. Linking opponent's POA to matter must fail with ClientPoaDependencyError
    await expect(
      linkMatterAuthorization(actor, {
        matterId: matter.matter.id,
        powerOfAttorneyId: oppPoa.id,
        idempotencyKey: `link-opp-poa-fail-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ClientPoaDependencyError);

    // 2. Linking client's POA to matter succeeds
    const authLink = await linkMatterAuthorization(actor, {
      matterId: matter.matter.id,
      powerOfAttorneyId: clientPoa.id,
      idempotencyKey: `link-client-poa-ok-${crypto.randomUUID()}`,
    });
    expect(authLink.powerOfAttorneyId).toBe(clientPoa.id);
    expect(authLink.partyName).toBe('شريف فوزي عبد الله');
    expect(authLink.humanReviewStatus).toBe('UNREVIEWED');

    // 3. Demoting or removing client who has linked POAs is strictly rejected
    const clientLink = matter.matter.parties![0];
    await expect(
      updateMatterParty(actor, {
        id: clientLink.id,
        matterId: matter.matter.id,
        expectedVersion: clientLink.version,
        role: 'OTHER',
        idempotencyKey: `demote-client-with-poa-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ClientPoaDependencyError);

    // 4. Unlinking authorization allows subsequent clean removal
    await unlinkMatterAuthorization(actor, {
      id: authLink.id,
      matterId: matter.matter.id,
      idempotencyKey: `unlink-auth-${crypto.randomUUID()}`,
    });

    const reloaded = await getMatter(matter.matter.id, actor);
    expect(reloaded.authorizations?.length).toBe(0);
  });
});

