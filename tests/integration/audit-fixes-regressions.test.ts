import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { POST as authRoutePOST } from '@/app/api/auth/[...all]/route';
import {
  openMatter,
  updateMatter,
  addProceeding,
  updateProceeding,
  archiveProceeding,
  linkMatterParty,
  updateMatterParty,
  linkMatterAuthorization,
  searchMatters,
  unifiedSearch,
} from '@/modules/matters/matter-service';
import { MatterValidationError } from '@/modules/matters/matter-types';
import { saveParty, searchParties, savePowerOfAttorney, revealPartyIdentity } from '@/modules/parties/service';
import {
  getOfficeSettings,
  updateOfficeSettings,
  createReferenceItem,
  updateReferenceItem,
} from '@/modules/settings/reference-service';
import {
  scheduleHearing,
  recordHearingResult,
  rescheduleHearing,
  listHearingsForProceeding,
} from '@/modules/scheduling';
import {
  createSyntheticActor,
  setupTestEncryptionKeys,
  cleanupPartyFixtures,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

describe('Full-App Audit Integration Regressions', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdPracticeAreaIds: string[] = [];
  const createdStorageLocationIds: string[] = [];
  const createdHearingIds: string[] = [];
  const createdIdempotencyKeys: string[] = [];

  let initialOfficeSettings: Awaited<ReturnType<typeof prisma.officeSettings.findUnique>> = null;
  let sharedCourtId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();
    initialOfficeSettings = await prisma.officeSettings.findUnique({ where: { id: 'singleton' } });

    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: `محكمة استئناف القاهرة الاختبارية ${Date.now()}`,
      code: `AUD-${Date.now().toString().slice(-4)}`,
      notes: 'ملاحظة مبدئية',
      idempotencyKey: `audit-init-court-${crypto.randomUUID()}`,
    });
    sharedCourtId = court.id;
    createdCourtIds.push(court.id);
  });

  afterEach(async () => {
    if (createdHearingIds.length > 0) {
      await prisma.jobRun.deleteMany({
        where: { sourceType: 'Hearing', sourceId: { in: createdHearingIds } },
      });
      createdHearingIds.length = 0;
    }
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    createdMatterIds.length = 0;
    createdPartyIds.length = 0;
  });

  afterAll(async () => {
    if (createdIdempotencyKeys.length > 0) {
      await prisma.idempotencyRecord.deleteMany({
        where: { key: { in: createdIdempotencyKeys } },
      });
    }
    if (initialOfficeSettings) {
      await prisma.officeSettings.update({
        where: { id: 'singleton' },
        data: {
          officeName: initialOfficeSettings.officeName,
          lawyerName: initialOfficeSettings.lawyerName,
          phone: initialOfficeSettings.phone,
          email: initialOfficeSettings.email,
          address: initialOfficeSettings.address,
          taxNumber: initialOfficeSettings.taxNumber,
          version: initialOfficeSettings.version,
        },
      });
    } else {
      await prisma.officeSettings.deleteMany({ where: { id: 'singleton' } });
    }
    await cleanupReferenceFixtures(prisma, {
      courtIds: createdCourtIds,
      practiceAreaIds: createdPracticeAreaIds,
      storageLocationIds: createdStorageLocationIds,
    });
  });

  it('tracks open follow-up tasks across chained hearing reschedules (H1 -> H2 -> H3 -> H4)', async () => {
    const matter = await openMatter(actor, {
      title: `ملف سلسلة تأجيل الجلسات ${Date.now()}`,
      kind: 'LITIGATION',
      idempotencyKey: `aud-chain-m-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const proc = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: sharedCourtId,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      numberText: '9101',
      yearLabel: '2027',
      status: 'ACTIVE',
      idempotencyKey: `aud-chain-p-${crypto.randomUUID()}`,
    });

    const h1 = await scheduleHearing(actor, {
      proceedingId: proc.id,
      hearingDate: '2027-04-01',
      idempotencyKey: `aud-chain-h1-${crypto.randomUUID()}`,
    });
    createdHearingIds.push(h1.id);

    const h1Result = await recordHearingResult(actor, {
      hearingId: h1.id,
      expectedVersion: h1.version,
      decisionText: 'تأجيل لتقديم حافظة مستندات',
      nextDateDisposition: 'KNOWN',
      nextHearingDate: '2027-04-15',
      tasks: [
        { title: 'تقديم حافظة المستندات الأصلية' },
        { title: 'مهمة أرشيفية قديمة' },
      ],
      idempotencyKey: `aud-chain-r1-${crypto.randomUUID()}`,
    });
    const h2 = h1Result.nextHearing!;
    createdHearingIds.push(h2.id);

    const h1Tasks = await prisma.task.findMany({
      where: { hearingId: h1.id },
    });
    const createdTask = h1Tasks.find((t) => t.title === 'تقديم حافظة المستندات الأصلية')!;
    const unmovedOlderTask = h1Tasks.find((t) => t.title === 'مهمة أرشيفية قديمة')!;

    // Reschedule H2 -> H3 without specifying taskChanges
    const r23 = await rescheduleHearing(actor, {
      hearingId: h2.id,
      expectedVersion: h2.version,
      newHearingDate: '2027-04-22',
      reason: 'تأجيل إداري أول',
      idempotencyKey: `aud-chain-r23-${crypto.randomUUID()}`,
    });
    const h3 = r23.replacementHearing;
    createdHearingIds.push(h3.id);

    // listHearingsForProceeding should surface H1's follow-up tasks on H3 across H1 -> H2 -> H3
    const hearingsAtH3 = await listHearingsForProceeding(actor, proc.id);
    const listedH3 = hearingsAtH3.find((h) => h.id === h3.id);
    expect(listedH3?.followUpTasks?.map((t) => t.id)).toContain(createdTask.id);
    expect(listedH3?.followUpTasks?.map((t) => t.id)).toContain(unmovedOlderTask.id);

    // Reschedule H3 -> H4 explicitly moving the inherited task's dueDate (leaving unmovedOlderTask on H1)
    const r34 = await rescheduleHearing(actor, {
      hearingId: h3.id,
      expectedVersion: h3.version,
      newHearingDate: '2027-05-03',
      reason: 'تعديل الموعد ونقل المهمة',
      taskChanges: [{ taskId: createdTask.id, expectedVersion: createdTask.version, dueDate: '2027-04-30' }],
      idempotencyKey: `aud-chain-r34-${crypto.randomUUID()}`,
    });
    const h4 = r34.replacementHearing;
    createdHearingIds.push(h4.id);

    const movedTask = await prisma.task.findUniqueOrThrow({ where: { id: createdTask.id } });
    expect(movedTask.hearingId).toBe(h4.id);
    expect(movedTask.dueDate?.toISOString().slice(0, 10)).toBe('2027-04-30');

    // Complete H4 -> H5 with a new task T2 and confirm unmovedOlderTask (on H1) does not leak across H4 -> H5
    const h4Result = await recordHearingResult(actor, {
      hearingId: h4.id,
      expectedVersion: h4.version,
      decisionText: 'تأجيل ثانٍ لاستكمال المستندات',
      nextDateDisposition: 'KNOWN',
      nextHearingDate: '2027-05-20',
      tasks: [{ title: 'متابعة القرار الأحدث' }],
      idempotencyKey: `aud-chain-r45-${crypto.randomUUID()}`,
    });
    const h5 = h4Result.nextHearing!;
    createdHearingIds.push(h5.id);
    const taskT2 = await prisma.task.findFirstOrThrow({ where: { hearingId: h4.id, title: 'متابعة القرار الأحدث' } });

    const hearingsAfterH4 = await listHearingsForProceeding(actor, proc.id);
    const listedH5 = hearingsAfterH4.find((h) => h.id === h5.id);
    const h5TaskIds = listedH5?.followUpTasks?.map((t) => t.id) ?? [];
    expect(h5TaskIds).toContain(taskT2.id);
    expect(h5TaskIds).toContain(movedTask.id);
    expect(h5TaskIds).not.toContain(unmovedOlderTask.id);
  });

  it('matches formatted phone queries in unifiedSearch via phone normalization', async () => {
    const suffix = Date.now().toString().slice(-6);
    const rawPhone = `0109${suffix}`;
    const party = await saveParty(actor, {
      kind: 'PERSON',
      name: `طرف هاتف منسق ${suffix}`,
      primaryPhone: rawPhone,
      idempotencyKey: `aud-phone-p-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party.party.id);

    const dashedIntl = `+20 109-${suffix.slice(0, 3)}-${suffix.slice(3)}`;
    const spacedLocal = `0109 ${suffix.slice(0, 3)} ${suffix.slice(3)}`;

    const intlRes = await unifiedSearch({ query: dashedIntl, type: 'PARTY' }, actor);
    expect(intlRes.items.map((item) => item.id)).toContain(party.party.id);

    const spacedRes = await unifiedSearch({ query: spacedLocal, type: 'ALL' }, actor);
    expect(spacedRes.items.map((item) => item.id)).toContain(party.party.id);
  });

  it('preserves omitted undefined fields and clears explicit null fields across partial updates', async () => {
    const party = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طرف اختبار الحفظ الجزئي',
      idempotencyKey: `aud-partial-party-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party.party.id);

    // 1. Power of Attorney partial update
    const poa = await savePowerOfAttorney(actor, {
      partyId: party.party.id,
      poaNumberText: '770/أ',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق المعادي',
      poaType: 'LITIGATION',
      issueDate: '2026-03-10',
      notes: 'ملاحظة توكيل محفوظة',
      idempotencyKey: `aud-poa-c-${crypto.randomUUID()}`,
    });

    const poaUpdated = await savePowerOfAttorney(actor, {
      id: poa.id,
      partyId: party.party.id,
      expectedVersion: poa.version,
      poaNumberText: '770/أ',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق المعادي المطور',
      poaType: 'LITIGATION',
      // issueDate and notes omitted (undefined)
      idempotencyKey: `aud-poa-u1-${crypto.randomUUID()}`,
    });
    expect(poaUpdated.issueDate).toBe('2026-03-10');
    expect(poaUpdated.notes).toBe('ملاحظة توكيل محفوظة');

    const poaCleared = await savePowerOfAttorney(actor, {
      id: poa.id,
      partyId: party.party.id,
      expectedVersion: poaUpdated.version,
      poaNumberText: '770/أ',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق المعادي المطور',
      poaType: 'LITIGATION',
      issueDate: null,
      notes: null,
      idempotencyKey: `aud-poa-u2-${crypto.randomUUID()}`,
    });
    expect(poaCleared.issueDate).toBeNull();
    expect(poaCleared.notes).toBeNull();

    // 2. Matter partial update
    const area = await createReferenceItem(actor, {
      type: 'PRACTICE_AREA',
      name: `تخصص اختباري ${Date.now()}`,
      idempotencyKey: `aud-pa-${crypto.randomUUID()}`,
    });
    createdPracticeAreaIds.push(area.id);

    const loc = await createReferenceItem(actor, {
      type: 'STORAGE_LOCATION',
      name: `دولاب اختباري ${Date.now()}`,
      idempotencyKey: `aud-loc-${crypto.randomUUID()}`,
    });
    createdStorageLocationIds.push(loc.id);

    const openedMatter = await openMatter(actor, {
      title: 'ملف الحفظ الجزئي',
      kind: 'LITIGATION',
      practiceAreaId: area.id,
      paperLocationId: loc.id,
      notes: 'ملاحظات ملف محفوظة',
      idempotencyKey: `aud-m-c-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(openedMatter.matter.id);

    const matterUpdated = await updateMatter(actor, {
      id: openedMatter.matter.id,
      expectedVersion: openedMatter.matter.version,
      title: 'ملف الحفظ الجزئي - محدث',
      kind: 'LITIGATION',
      status: 'DRAFT',
      // notes, practiceAreaId, and paperLocationId omitted (undefined)
      idempotencyKey: `aud-m-u1-${crypto.randomUUID()}`,
    });
    expect(matterUpdated.matter.notes).toBe('ملاحظات ملف محفوظة');
    expect(matterUpdated.matter.practiceAreaId).toBe(area.id);
    expect(matterUpdated.matter.paperLocationId).toBe(loc.id);

    const matterCleared = await updateMatter(actor, {
      id: openedMatter.matter.id,
      expectedVersion: matterUpdated.matter.version,
      title: 'ملف الحفظ الجزئي - محدث',
      kind: 'LITIGATION',
      status: 'DRAFT',
      practiceAreaId: null,
      paperLocationId: null,
      notes: null,
      idempotencyKey: `aud-m-u2-${crypto.randomUUID()}`,
    });
    expect(matterCleared.matter.practiceAreaId).toBeNull();
    expect(matterCleared.matter.paperLocationId).toBeNull();
    expect(matterCleared.matter.notes).toBeNull();

    // 3. Proceeding partial update
    const proc = await addProceeding(actor, {
      matterId: openedMatter.matter.id,
      courtId: sharedCourtId,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      circuit: 'الدائرة الثانية',
      numberText: '501/م',
      yearLabel: '2026',
      status: 'ACTIVE',
      idempotencyKey: `aud-proc-c-${crypto.randomUUID()}`,
    });

    const procUpdated = await updateProceeding(actor, {
      id: proc.id,
      matterId: openedMatter.matter.id,
      expectedVersion: proc.version,
      courtId: sharedCourtId,
      instance: 'FIRST_INSTANCE',
      status: 'ACTIVE',
      circuit: 'الدائرة الثالثة المعدلة',
      // numberText, yearLabel, registerType omitted (undefined)
      idempotencyKey: `aud-proc-u1-${crypto.randomUUID()}`,
    });
    expect(procUpdated.numberText).toBe('501/م');
    expect(procUpdated.yearLabel).toBe('2026');
    expect(procUpdated.registerType).toBe('مدني كلي');
    expect(procUpdated.circuit).toBe('الدائرة الثالثة المعدلة');

    // 4. Reference item partial update
    const refCourt = await createReferenceItem(actor, {
      type: 'COURT',
      name: `محكمة جزئية اختبار ${Date.now()}`,
      code: 'REF-10',
      notes: 'ملاحظة مرجعية',
      idempotencyKey: `aud-ref-c-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(refCourt.id);

    const refUpdated = await updateReferenceItem(actor, {
      type: 'COURT',
      id: refCourt.id,
      expectedVersion: refCourt.version,
      name: `${refCourt.name} محدثة`,
      isActive: true,
      // code and notes omitted (undefined)
      idempotencyKey: `aud-ref-u1-${crypto.randomUUID()}`,
    });
    expect(refUpdated.code).toBe('REF-10');
    expect(refUpdated.notes).toBe('ملاحظة مرجعية');

    const refCleared = await updateReferenceItem(actor, {
      type: 'COURT',
      id: refCourt.id,
      expectedVersion: refUpdated.version,
      name: refUpdated.name,
      code: null,
      notes: null,
      isActive: true,
      idempotencyKey: `aud-ref-u2-${crypto.randomUUID()}`,
    });
    expect(refCleared.code).toBeNull();
    expect(refCleared.notes).toBeNull();

    // 5. OfficeSettings partial update
    const currentSettings = await getOfficeSettings(actor);
    const keySet1 = `aud-set-1-${crypto.randomUUID()}`;
    createdIdempotencyKeys.push(keySet1);
    const s1 = await updateOfficeSettings(actor, {
      officeName: 'مكتب اختبار الحفظ الجزئي',
      lawyerName: 'أستاذ أحمد',
      phone: '01001112223',
      taxNumber: 'TAX-99',
      expectedVersion: currentSettings.version,
      idempotencyKey: keySet1,
    });
    expect(s1.lawyerName).toBe('أستاذ أحمد');
    expect(s1.taxNumber).toBe('TAX-99');

    const keySet2 = `aud-set-2-${crypto.randomUUID()}`;
    createdIdempotencyKeys.push(keySet2);
    const s2 = await updateOfficeSettings(actor, {
      officeName: 'مكتب اختبار الحفظ الجزئي المطور',
      expectedVersion: s1.version,
      // optional fields omitted (undefined)
      idempotencyKey: keySet2,
    });
    expect(s2.lawyerName).toBe('أستاذ أحمد');
    expect(s2.phone).toBe('01001112223');
    expect(s2.taxNumber).toBe('TAX-99');

    const keySet3 = `aud-set-3-${crypto.randomUUID()}`;
    createdIdempotencyKeys.push(keySet3);
    const s3 = await updateOfficeSettings(actor, {
      officeName: s2.officeName,
      taxNumber: null,
      expectedVersion: s2.version,
      idempotencyKey: keySet3,
    });
    expect(s3.lawyerName).toBe('أستاذ أحمد');
    expect(s3.taxNumber).toBeNull();
  });

  it('rejects archived party links and converts duplicate role/POA links to MatterValidationError', async () => {
    const partyA = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طرف نشط للازدواجية',
      idempotencyKey: `aud-dup-a-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(partyA.party.id);

    const archivedParty = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طرف مؤرشف مسبقاً',
      idempotencyKey: `aud-arch-p-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(archivedParty.party.id);
    await prisma.party.update({
      where: { id: archivedParty.party.id },
      data: { archivedAt: new Date() },
    });

    const matter = await openMatter(actor, {
      title: 'ملف فحص قيود الأطراف والتوكيلات',
      kind: 'LITIGATION',
      initialClientId: partyA.party.id,
      idempotencyKey: `aud-dup-m-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    // 1. Linking archived party fails with MatterValidationError
    await expect(
      linkMatterParty(actor, {
        matterId: matter.matter.id,
        partyId: archivedParty.party.id,
        role: 'OPPONENT',
        idempotencyKey: `aud-link-arch-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);

    // 2. Updating a secondary link to a duplicate (matterId, partyId, role) throws MatterValidationError
    const otherLink = await linkMatterParty(actor, {
      matterId: matter.matter.id,
      partyId: partyA.party.id,
      role: 'OTHER',
      idempotencyKey: `aud-link-other-${crypto.randomUUID()}`,
    });

    await expect(
      updateMatterParty(actor, {
        id: otherLink.id,
        matterId: matter.matter.id,
        expectedVersion: otherLink.version,
        role: 'CLIENT',
        idempotencyKey: `aud-upd-dup-role-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);

    // 3. Duplicate POA link throws MatterValidationError instead of raw Prisma P2002
    const poa = await savePowerOfAttorney(actor, {
      partyId: partyA.party.id,
      poaNumberText: '8812/ج',
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق الزمالك',
      poaType: 'LITIGATION',
      idempotencyKey: `aud-poa-dup-${crypto.randomUUID()}`,
    });

    await linkMatterAuthorization(actor, {
      matterId: matter.matter.id,
      powerOfAttorneyId: poa.id,
      idempotencyKey: `aud-auth-1-${crypto.randomUUID()}`,
    });

    await expect(
      linkMatterAuthorization(actor, {
        matterId: matter.matter.id,
        powerOfAttorneyId: poa.id,
        idempotencyKey: `aud-auth-2-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterValidationError);
  });

  it('excludes archived proceedings from searchMatters courtId and incompleteData filters unless includeArchived is true', async () => {
    const uniqueCourt = await createReferenceItem(actor, {
      type: 'COURT',
      name: `محكمة عزل الأرشيف ${Date.now()}`,
      idempotencyKey: `aud-arch-court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(uniqueCourt.id);

    const storageLoc = await createReferenceItem(actor, {
      type: 'STORAGE_LOCATION',
      name: `مكان حفظ عزل الأرشيف ${Date.now()}`,
      idempotencyKey: `aud-arch-loc-${crypto.randomUUID()}`,
    });
    createdStorageLocationIds.push(storageLoc.id);

    const clientParty = await saveParty(actor, {
      kind: 'PERSON',
      name: `موكل بحث الأرشيف ${Date.now()}`,
      idempotencyKey: `aud-af-c-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientParty.party.id);

    const tag = `ArchFilter_${Date.now()}`;
    const m = await openMatter(actor, {
      title: `ملف ${tag}`,
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: clientParty.party.id,
      paperLocationId: storageLoc.id,
      idempotencyKey: `aud-af-m-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const draftProc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: uniqueCourt.id,
      instance: 'FIRST_INSTANCE',
      status: 'DRAFT',
      idempotencyKey: `aud-af-p-${crypto.randomUUID()}`,
    });

    const beforeArchiveIncomplete = await searchMatters(
      { incompleteData: true, includeArchived: false, query: tag },
      actor
    );
    expect(beforeArchiveIncomplete.matters.map((x) => x.id)).toContain(m.matter.id);

    await archiveProceeding(actor, {
      matterId: m.matter.id,
      proceedingId: draftProc.id,
      expectedVersion: draftProc.version,
      reason: 'أرشفة القيد غير المستكمل للاختبار',
      idempotencyKey: `aud-af-arch-${crypto.randomUUID()}`,
    });

    const activeCourtRes = await searchMatters(
      { courtId: uniqueCourt.id, includeArchived: false, query: tag },
      actor
    );
    expect(activeCourtRes.matters.map((x) => x.id)).not.toContain(m.matter.id);

    const archivedCourtRes = await searchMatters(
      { courtId: uniqueCourt.id, includeArchived: true, query: tag },
      actor
    );
    expect(archivedCourtRes.matters.map((x) => x.id)).toContain(m.matter.id);

    const incompleteRes = await searchMatters(
      { incompleteData: true, includeArchived: false, query: tag },
      actor
    );
    expect(incompleteRes.matters.map((x) => x.id)).not.toContain(m.matter.id);
  });

  it('clamps out-of-range and NaN searchParties page inputs without crashing', async () => {
    const hugePage = await searchParties(actor, { page: 1e9, limit: 10 });
    expect(Array.isArray(hugePage.parties)).toBe(true);
    expect(hugePage.page).toBeLessThanOrEqual(1000);

    const nanPage = await searchParties(actor, { page: Number.NaN, limit: 10 });
    expect(Array.isArray(nanPage.parties)).toBe(true);
    expect(nanPage.page).toBe(1);
  });

  it('sets Cache-Control no-store on POST auth endpoints', async () => {
    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const signUpReq = new NextRequest(`${testOrigin}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testOrigin },
      body: JSON.stringify({}),
    });

    const res = await authRoutePOST(signUpReq);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('preserves fixed UI Arabic reason in revealPartyIdentity audit log while normalizing free text', async () => {
    const saved = await saveParty(actor, {
      kind: 'PERSON',
      name: `طرف فحص كشف الهوية ${Date.now()}`,
      identity: { identificationType: 'NATIONAL_ID', number: '29901011234567' },
      idempotencyKey: `aud-reveal-p-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(saved.party.id);
    const idRecord = await prisma.partyIdentity.findFirstOrThrow({
      where: { partyId: saved.party.id },
    });

    try {
      await revealPartyIdentity(
        actor,
        saved.party.id,
        'استعراض رقم الهوية لأغراض التحقق القانوني بالمكتب'
      );
      await revealPartyIdentity(actor, saved.party.id, 'سبب نصي حر يحتوي على بيانات شخصية');

      const logs = await prisma.auditEvent.findMany({
        where: { entityType: 'PartyIdentity', entityId: idRecord.id, action: 'REVEAL_IDENTITY' },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.reason)).toEqual([
        'استعراض رقم الهوية لأغراض التحقق القانوني بالمكتب',
        'Authoritative identity view',
      ]);
    } finally {
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'PartyIdentity', entityId: idRecord.id },
      });
    }
  });

  it('rejects non-JSON or array payloads on POST /api/auth/change-password with 400 and no-store', async () => {
    const testOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const textReq = new NextRequest(`${testOrigin}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: testOrigin },
      body: 'not json',
    });
    const textRes = await authRoutePOST(textReq);
    expect(textRes.status).toBe(400);
    expect(textRes.headers.get('cache-control')).toContain('no-store');

    const arrayReq = new NextRequest(`${testOrigin}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testOrigin },
      body: '[]',
    });
    const arrayRes = await authRoutePOST(arrayReq);
    expect(arrayRes.status).toBe(400);
    expect(arrayRes.headers.get('cache-control')).toContain('no-store');
  });

  it('T08-RESCHED-HALL: inherits courtHall when omitted and clears courtHall to null when explicitly cleared', async () => {
    const matter = await openMatter(actor, {
      title: `ملف اختبار إخلاء قاعة الجلسة ${Date.now()}`,
      kind: 'LITIGATION',
      idempotencyKey: `aud-hall-m-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    const proc = await addProceeding(actor, {
      matterId: matter.matter.id,
      courtId: sharedCourtId,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      numberText: '9202',
      yearLabel: '2027',
      status: 'ACTIVE',
      idempotencyKey: `aud-hall-p-${crypto.randomUUID()}`,
    });

    const initial = await scheduleHearing(actor, {
      proceedingId: proc.id,
      hearingDate: '2027-08-10',
      courtHall: 'قاعة 7 - الدور الثالث',
      idempotencyKey: `aud-hall-sched-${crypto.randomUUID()}`,
    });
    createdHearingIds.push(initial.id);
    expect(initial.courtHall).toBe('قاعة 7 - الدور الثالث');

    const inherited = await rescheduleHearing(actor, {
      hearingId: initial.id,
      expectedVersion: initial.version,
      newHearingDate: '2027-08-24',
      reason: 'تعديل موعد مع بقاء نفس القاعة',
      idempotencyKey: `aud-hall-inh-${crypto.randomUUID()}`,
    });
    createdHearingIds.push(inherited.replacementHearing.id);
    expect(inherited.replacementHearing.courtHall).toBe('قاعة 7 - الدور الثالث');

    const cleared = await rescheduleHearing(actor, {
      hearingId: inherited.replacementHearing.id,
      expectedVersion: inherited.replacementHearing.version,
      newHearingDate: '2027-09-07',
      reason: 'تعديل موعد مع إخلاء القاعة لحين التحديد',
      locationRoom: null,
      idempotencyKey: `aud-hall-clr-${crypto.randomUUID()}`,
    });
    createdHearingIds.push(cleared.replacementHearing.id);
    expect(cleared.replacementHearing.courtHall).toBeNull();
  });
});
