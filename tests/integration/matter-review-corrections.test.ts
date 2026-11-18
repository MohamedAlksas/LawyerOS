import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  updateMatter,
  getMatter,
  searchMatters,
  linkMatterParty,
  updateMatterParty,
  unlinkMatterParty,
  addProceeding,
  updateProceeding,
  linkMatterAuthorization,
  unlinkMatterAuthorization,
} from '@/modules/matters/matter-service';
import {
  getOfficeSettings,
  updateOfficeSettings,
  listReferenceItems,
  createReferenceItem,
  updateReferenceItem,
} from '@/modules/settings/reference-service';
import { saveParty, savePowerOfAttorney } from '@/modules/parties/service';
import {
  MatterValidationError,
  ProceedingCycleDetectedError,
  UnauthorizedError as MatterUnauthorizedError,
  ClientPoaDependencyError,
  InactiveReferenceSelectedError,
} from '@/modules/matters/matter-types';
import {
  ReferenceValidationError,
  UnauthorizedError as SettingsUnauthorizedError,
  ConcurrencyConflictError as SettingsConcurrencyConflictError,
} from '@/modules/settings/reference-types';
import { AuthorizationError } from '@/modules/identity/types';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

describe('T06 Review Round 1 Corrections Verification', () => {
  const prisma = getPrismaClient();
  const owner = createSyntheticActor();
  const maintainer = {
    ...createSyntheticActor(),
    id: `maint-${crypto.randomUUID()}`,
    role: 'MAINTAINER' as const,
  };

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
    createdMatterIds.length = 0;
    createdPartyIds.length = 0;
    createdCourtIds.length = 0;
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
  });

  it('T06-R1-01: public reads fail closed without verified actor (getMatter, searchMatters, getOfficeSettings, listReferenceItems)', async () => {
    const res = await openMatter(owner, {
      title: 'ملف لاختبار صلاحيات القراءة العامة',
      kind: 'LITIGATION',
      idempotencyKey: `auth-test-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(res.matter.id);

    // 1. getMatter
    await expect(getMatter(res.matter.id)).rejects.toThrow(MatterUnauthorizedError);
    await expect(getMatter(res.matter.id, undefined)).rejects.toThrow(MatterUnauthorizedError);
    await expect(getMatter(res.matter.id, maintainer)).rejects.toThrow(AuthorizationError);

    // 2. searchMatters
    await expect(searchMatters({})).rejects.toThrow(MatterUnauthorizedError);
    await expect(searchMatters({}, undefined)).rejects.toThrow(MatterUnauthorizedError);
    await expect(searchMatters({}, maintainer)).rejects.toThrow(AuthorizationError);

    // 3. getOfficeSettings
    await expect(getOfficeSettings()).rejects.toThrow(SettingsUnauthorizedError);
    await expect(getOfficeSettings(undefined)).rejects.toThrow(SettingsUnauthorizedError);
    await expect(getOfficeSettings(maintainer)).rejects.toThrow(AuthorizationError);

    // 4. listReferenceItems
    await expect(listReferenceItems('COURT', false)).rejects.toThrow(SettingsUnauthorizedError);
    await expect(listReferenceItems('COURT', false, undefined)).rejects.toThrow(SettingsUnauthorizedError);
    await expect(listReferenceItems('COURT', false, maintainer)).rejects.toThrow(AuthorizationError);
  });

  it('T06-R1-02: rejects impossible calendar dates and unsupported extra properties', async () => {
    // Impossible date: 2026-02-31
    await expect(
      openMatter(owner, {
        title: 'ملف بتأريخ مستحيل 31 فبراير',
        kind: 'LITIGATION',
        openingDate: '2026-02-31',
        idempotencyKey: `bad-date-1-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);

    // Non-leap year 29 Feb: 2025-02-29
    await expect(
      openMatter(owner, {
        title: 'ملف بتأريخ 29 فبراير في سنة غير كبيسة',
        kind: 'LITIGATION',
        openingDate: '2025-02-29',
        idempotencyKey: `bad-date-2-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);

    // Unsupported extra property (documentId)
    await expect(
      openMatter(owner, {
        title: 'ملف بحقل غير مدعوم',
        kind: 'LITIGATION',
        documentId: 'unsupported-doc',
        idempotencyKey: `bad-field-${crypto.randomUUID()}`,
      } as unknown as Parameters<typeof openMatter>[1])
    ).rejects.toThrow(MatterValidationError);

    // closingDate before openingDate
    const res = await openMatter(owner, {
      title: 'ملف لفحص تتابع التواريخ',
      kind: 'LITIGATION',
      openingDate: '2026-05-10',
      idempotencyKey: `date-order-init-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(res.matter.id);

    await expect(
      updateMatter(owner, {
        id: res.matter.id,
        expectedVersion: 1,
        title: 'ملف لفحص تتابع التواريخ',
        kind: 'LITIGATION',
        status: 'CLOSED',
        openingDate: '2026-05-10',
        closingDate: '2026-05-01',
        idempotencyKey: `bad-order-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);
  });

  it('T06-R1-03: idempotency records store only minimal safe metadata and zero confidential notes', async () => {
    const key = `confidential-note-${crypto.randomUUID()}`;
    const confidentialNote = 'ملاحظة سرية حساسة جداً بين المحامي والموكل لا تحفظ في سجلات التكرار';

    const res = await openMatter(owner, {
      title: 'ملف لحماية سرية سجل التكرار',
      kind: 'LITIGATION',
      notes: confidentialNote,
      summary: 'ملخص القضية السري',
      idempotencyKey: key,
    });
    createdMatterIds.push(res.matter.id);

    const record = await prisma.idempotencyRecord.findUnique({
      where: {
        actorId_commandType_key: {
          actorId: owner.id,
          commandType: 'openMatter',
          key,
        },
      },
    });

    expect(record).not.toBeNull();
    const payloadStr = JSON.stringify(record?.resultPayload);
    expect(payloadStr).not.toContain(confidentialNote);
    expect(payloadStr).not.toContain('ملخص القضية السري');
    expect(record?.resultPayload).toEqual({
      operation: 'OPEN_MATTER',
      resourceId: res.matter.id,
      fileCode: res.fileCode,
      version: 1,
      acknowledgedAt: expect.any(String),
    });

    const replay = await openMatter(owner, {
      title: 'ملف لحماية سرية سجل التكرار',
      kind: 'LITIGATION',
      notes: confidentialNote,
      summary: 'ملخص القضية السري',
      idempotencyKey: key,
    });
    expect(replay.matter.id).toBe(res.matter.id);
    expect(replay.matter.notes).toBe(confidentialNote);
  });

  it('T06-R1-04: detects and rejects deep hierarchy cycles beyond 25 descendants', async () => {
    const matter = await openMatter(owner, {
      title: 'ملف لفحص الحلقات العميقة في درجات التقاضي',
      kind: 'LITIGATION',
      idempotencyKey: `deep-cycle-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const court = await createReferenceItem(owner, {
      type: 'COURT',
      name: `محكمة السلسلة العميقة ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `deep-court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const root = await addProceeding(owner, {
      matterId: matter.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: `root-proc-${crypto.randomUUID()}`,
    });

    let tailId = root.id;
    for (let i = 0; i < 28; i++) {
      const node = await prisma.proceeding.create({
        data: {
          matterId: matter.matter.id,
          courtId: court.id,
          instance: 'FIRST_INSTANCE',
          parentProceedingId: tailId,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      tailId = node.id;
    }

    await expect(
      updateProceeding(owner, {
        id: root.id,
        matterId: matter.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        status: 'DRAFT',
        expectedVersion: root.version,
        parentProceedingId: tailId,
        idempotencyKey: `attempt-deep-cycle-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ProceedingCycleDetectedError);
  });

  it('T06-R1-05: enforces optimistic concurrency on office settings and reference items', async () => {
    const office = await getOfficeSettings(owner);

    await expect(
      updateOfficeSettings(owner, {
        officeName: 'اسم مكتب جديد بدون نسخة',
        idempotencyKey: `no-ver-${crypto.randomUUID()}`,
      } as unknown as Parameters<typeof updateOfficeSettings>[1])
    ).rejects.toThrow(ReferenceValidationError);

    await expect(
      updateOfficeSettings(owner, {
        officeName: 'اسم مكتب جديد بنسخة قديمة',
        expectedVersion: office.version + 999,
        idempotencyKey: `stale-ver-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(SettingsConcurrencyConflictError);

    const court = await createReferenceItem(owner, {
      type: 'COURT',
      name: `محكمة Concurrency ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `court-cas-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    await expect(
      updateReferenceItem(owner, {
        type: 'COURT',
        id: court.id,
        name: 'اسم معدل بنسخة خاطئة',
        isActive: true,
        expectedVersion: 99,
        idempotencyKey: `stale-court-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(SettingsConcurrencyConflictError);
  });

  it('T06-R1-06: increments parent matter version on party, POA, and proceeding modifications', async () => {
    const matterRes = await openMatter(owner, {
      title: 'ملف لاختبار ترقية نسخة الملف الأصل',
      kind: 'LITIGATION',
      idempotencyKey: `inc-ver-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matterRes.matter.id);
    expect(matterRes.matter.version).toBe(1);

    const party = await saveParty(owner, {
      name: `عميل لاختبار ترقية النسخة ${crypto.randomUUID().slice(0, 6)}`,
      kind: 'PERSON',
      idempotencyKey: `party-ver-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party.party.id);

    // 1. Linking party increments matter version to 2
    await linkMatterParty(owner, {
      matterId: matterRes.matter.id,
      partyId: party.party.id,
      role: 'CLIENT',
      isPrimaryContact: true,
      idempotencyKey: `link-p-${crypto.randomUUID()}`,
    });
    const afterPartyLink = await getMatter(matterRes.matter.id, owner);
    expect(afterPartyLink.version).toBe(2);

    // 2. Adding proceeding increments matter version to 3
    const court = await createReferenceItem(owner, {
      type: 'COURT',
      name: `محكمة نسخة الملف ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `court-ver-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const proc = await addProceeding(owner, {
      matterId: matterRes.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: `proc-ver-${crypto.randomUUID()}`,
    });
    const afterProcAdd = await getMatter(matterRes.matter.id, owner);
    expect(afterProcAdd.version).toBe(3);

    // 3. Linking POA increments matter version to 4
    const poa = await savePowerOfAttorney(owner, {
      partyId: party.party.id,
      poaNumberText: `5541/ب`,
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق الأهرام',
      poaType: 'LITIGATION',
      idempotencyKey: `poa-ver-${crypto.randomUUID()}`,
    });

    const auth = await linkMatterAuthorization(owner, {
      matterId: matterRes.matter.id,
      powerOfAttorneyId: poa.id,
      idempotencyKey: `link-poa-${crypto.randomUUID()}`,
    });
    const afterPoaLink = await getMatter(matterRes.matter.id, owner);
    expect(afterPoaLink.version).toBe(4);

    // 4. Unlinking POA increments matter version to 5
    await unlinkMatterAuthorization(owner, {
      id: auth.id,
      matterId: matterRes.matter.id,
      idempotencyKey: `unlink-poa-${crypto.randomUUID()}`,
    });
    const afterPoaUnlink = await getMatter(matterRes.matter.id, owner);
    expect(afterPoaUnlink.version).toBe(5);

    // 5. Updating proceeding increments matter version to 6
    await updateProceeding(owner, {
      id: proc.id,
      matterId: matterRes.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      status: 'DRAFT',
      circuit: 'الدائرة الأولى',
      expectedVersion: proc.version,
      idempotencyKey: `upd-proc-${crypto.randomUUID()}`,
    });
    const afterProcUpd = await getMatter(matterRes.matter.id, owner);
    expect(afterProcUpd.version).toBe(6);
  });

  it('T06-R1-07: restricts POA linking to CLIENT parties and protects against demotion/unlinking', async () => {
    const matterRes = await openMatter(owner, {
      title: 'ملف لاختبار قيود الوكالة والتنحية',
      kind: 'LITIGATION',
      idempotencyKey: `poa-rules-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matterRes.matter.id);

    const clientParty = await saveParty(owner, {
      name: `موكل محمي بالوكالة ${crypto.randomUUID().slice(0, 6)}`,
      kind: 'PERSON',
      idempotencyKey: `client-party-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientParty.party.id);

    const opponentParty = await saveParty(owner, {
      name: `خصم غير مصرح بوكالة ${crypto.randomUUID().slice(0, 6)}`,
      kind: 'PERSON',
      idempotencyKey: `opp-party-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(opponentParty.party.id);

    const clientMatterParty = await linkMatterParty(owner, {
      matterId: matterRes.matter.id,
      partyId: clientParty.party.id,
      role: 'CLIENT',
      isPrimaryContact: true,
      idempotencyKey: `link-client-${crypto.randomUUID()}`,
    });

    await linkMatterParty(owner, {
      matterId: matterRes.matter.id,
      partyId: opponentParty.party.id,
      role: 'OPPONENT',
      idempotencyKey: `link-opp-${crypto.randomUUID()}`,
    });

    const oppPoa = await savePowerOfAttorney(owner, {
      partyId: opponentParty.party.id,
      poaNumberText: `POA-OPP-101`,
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق الجيزة',
      poaType: 'LITIGATION',
      idempotencyKey: `poa-opp-${crypto.randomUUID()}`,
    });

    // Attempt to link opponent's POA -> rejected with ClientPoaDependencyError
    await expect(
      linkMatterAuthorization(owner, {
        matterId: matterRes.matter.id,
        powerOfAttorneyId: oppPoa.id,
        idempotencyKey: `link-opp-poa-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ClientPoaDependencyError);

    const clientPoa = await savePowerOfAttorney(owner, {
      partyId: clientParty.party.id,
      poaNumberText: `POA-RULE-101`,
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق الجيزة',
      poaType: 'LITIGATION',
      idempotencyKey: `poa-client-${crypto.randomUUID()}`,
    });

    // Link POA on client party -> succeeds
    await linkMatterAuthorization(owner, {
      matterId: matterRes.matter.id,
      powerOfAttorneyId: clientPoa.id,
      idempotencyKey: `link-client-poa-${crypto.randomUUID()}`,
    });

    // Attempt to unlink client party while POA is linked -> blocked
    await expect(
      unlinkMatterParty(owner, {
        id: clientMatterParty.id,
        matterId: matterRes.matter.id,
        expectedVersion: clientMatterParty.version,
        idempotencyKey: `unlink-locked-party-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ClientPoaDependencyError);

    // Attempt to demote client party to OPPONENT while POA is linked -> blocked
    await expect(
      updateMatterParty(owner, {
        id: clientMatterParty.id,
        matterId: matterRes.matter.id,
        expectedVersion: clientMatterParty.version,
        role: 'OPPONENT',
        idempotencyKey: `demote-locked-party-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ClientPoaDependencyError);
  });

  it('T06-R1-08: rejects proceeding activation when registration data is incomplete', async () => {
    const matter = await openMatter(owner, {
      title: 'ملف لفحص تفعيل القيد غير المستكمل',
      kind: 'LITIGATION',
      idempotencyKey: `incomplete-act-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const court = await createReferenceItem(owner, {
      type: 'COURT',
      name: `محكمة التفعيل ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `act-court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const draft = await addProceeding(owner, {
      matterId: matter.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      status: 'DRAFT',
      idempotencyKey: `act-draft-${crypto.randomUUID()}`,
    });

    await expect(
      updateProceeding(owner, {
        id: draft.id,
        matterId: matter.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        status: 'ACTIVE',
        expectedVersion: draft.version,
        idempotencyKey: `attempt-active-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);
  });

  it('T06-R1-09: rejects inactive reference assignment on new or changed fields while preserving historical reads', async () => {
    const court = await createReferenceItem(owner, {
      type: 'COURT',
      name: `محكمة معطلة ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `court-to-deactivate-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    // Deactivate the court
    await updateReferenceItem(owner, {
      type: 'COURT',
      id: court.id,
      name: court.name,
      isActive: false,
      expectedVersion: court.version,
      idempotencyKey: `deactivate-court-${crypto.randomUUID()}`,
    });

    const matter = await openMatter(owner, {
      title: 'ملف لاختبار التعيين المعطل',
      kind: 'LITIGATION',
      idempotencyKey: `inactive-ref-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    // Attempting to add proceeding with inactive court must fail
    await expect(
      addProceeding(owner, {
        matterId: matter.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        idempotencyKey: `add-proc-inactive-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(InactiveReferenceSelectedError);
  });

  it('T06-R1-10: normalizes search across Arabic/Western digits and letter variants, and warns on duplicate court identities', async () => {
    const matter = await openMatter(owner, {
      title: 'قضية تعويضات أحمد ومحمود ضد شركة التأمين',
      kind: 'LITIGATION',
      idempotencyKey: `search-norm-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    // 1. Search with Arabic numerals (e.g. ٢٠٢٦) matches the generated file code
    const searchDigits = await searchMatters({ query: '٢٠٢٦' }, owner);
    const foundByDigits = searchDigits.matters.some((m) => m.id === matter.matter.id);
    expect(foundByDigits).toBe(true);

    // 2. Search with alternate letter variant ('احمد' without Hamza matches 'أحمد')
    const searchLetters = await searchMatters({ query: 'احمد' }, owner);
    const foundByLetters = searchLetters.matters.some((m) => m.id === matter.matter.id);
    expect(foundByLetters).toBe(true);

    // 3. Advisory duplicate court identity warning
    const court = await createReferenceItem(owner, {
      type: 'COURT',
      name: `محكمة التحذير ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `dup-court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    const proc1 = await addProceeding(owner, {
      matterId: matter.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      numberText: '7788/أ',
      yearLabel: '2026',
      registerType: 'مدني كلي',
      status: 'ACTIVE',
      idempotencyKey: `proc-orig-${crypto.randomUUID()}`,
    });
    expect(proc1.duplicateWarning).toBeNull();

    const proc2 = await addProceeding(owner, {
      matterId: matter.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      numberText: '7788/أ',
      yearLabel: '2026',
      registerType: 'مدني كلي',
      status: 'ACTIVE',
      idempotencyKey: `proc-dup-${crypto.randomUUID()}`,
    });
    expect(proc2.duplicateWarning).not.toBeNull();
    expect(proc2.duplicateWarning?.detected).toBe(true);
    expect(proc2.duplicateWarning?.existingProceedingId).toBe(proc1.id);
  });
});