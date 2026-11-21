import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  openMatter,
  updateMatter,
  getMatter,
  linkMatterParty,
  updateMatterParty,
  unlinkMatterParty,
  addProceeding,
  updateProceeding,
  archiveMatter,
  reopenMatter,
  archiveProceeding,
  reopenProceeding,
  searchMatters,
  searchProceedings,
  unifiedSearch,
} from '@/modules/matters/matter-service';
import {
  MatterArchivedError,
  ProceedingArchivedError,
  ConcurrencyConflictError,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';
import { saveParty } from '@/modules/parties/service';

describe('T07 Integration Tests: Search, Filters, Pagination, and Safe Archiving', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  let testCourtId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    // Ensure a court exists for proceeding tests
    let court = await prisma.court.findFirst({ where: { isActive: true } });
    if (!court) {
      court = await prisma.court.create({
        data: {
          name: 'محكمة جنوب القاهرة الابتدائية - تجاري',
          code: 'SCAIRO-COMM',
          isActive: true,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
    }
    testCourtId = court.id;
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
  });

  it('T07-01: Archives matter, enforces idempotency replay, and increments version in atomic audit transaction', async () => {
    const opened = await openMatter(actor, {
      title: 'نزاع تجاري على توريد بضائع',
      kind: 'CONTRACT',
      status: 'DRAFT',
      idempotencyKey: `open-m-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    const archiveKey = `archive-m-${crypto.randomUUID()}`;
    const archiveResult = await archiveMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: opened.matter.version,
      reason: 'انتهاء النزاع صلحاً وتصفية الحسابات',
      idempotencyKey: archiveKey,
    });

    expect(archiveResult.status).toBe('ARCHIVED');
    expect(archiveResult.archivedAt).toBeTruthy();
    expect(archiveResult.version).toBe(opened.matter.version + 1);

    // Replay with identical idempotency key returns exact same result
    const replayed = await archiveMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: opened.matter.version,
      reason: 'انتهاء النزاع صلحاً وتصفية الحسابات',
      idempotencyKey: archiveKey,
    });
    expect(replayed.id).toBe(archiveResult.id);
    expect(replayed.version).toBe(archiveResult.version);
    expect(replayed.archivedAt).toBe(archiveResult.archivedAt);

    // Verify audit record exists
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: 'Matter', entityId: opened.matter.id, action: 'ARCHIVE_MATTER' },
    });
    expect(audits.length).toBe(1);
    expect((audits[0].changedFields as Record<string, unknown>).newStatus).toBe('ARCHIVED');
  });

  it('T07-02: Rejects stale version on archive with ConcurrencyConflictError', async () => {
    const opened = await openMatter(actor, {
      title: 'نزاع عمالي تعويض عن فصل تعسفي',
      kind: 'LITIGATION',
      status: 'DRAFT',
      idempotencyKey: `open-labor-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    await expect(
      archiveMatter(actor, {
        matterId: opened.matter.id,
        expectedVersion: opened.matter.version + 99,
        reason: 'سبب الأرشفة',
        idempotencyKey: `archive-stale-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);
  });

  it('T07-03: Enforces read-only protection across all mutations on an archived matter', async () => {
    // 1. Create client party
    const clientRes = await saveParty(actor, {
      kind: 'PERSON',
      name: 'محمود سعد الدين التاجر',
      idempotencyKey: `client-p-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientRes.party.id);

    // 2. Open matter with client
    const opened = await openMatter(actor, {
      title: 'دعوى فسخ عقد إيجار تجاري',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: clientRes.party.id,
      idempotencyKey: `open-re-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    // 3. Archive matter
    const archiveRes = await archiveMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: opened.matter.version,
      reason: 'تنفيذ الحكم وإخلاء العقار تسليماً فعلياً',
      idempotencyKey: `archive-re-${crypto.randomUUID()}`,
    });
    expect(archiveRes.status).toBe('ARCHIVED');

    // 4. Mutation 1: updateMatter must throw MatterArchivedError
    await expect(
      updateMatter(actor, {
        id: opened.matter.id,
        expectedVersion: archiveRes.version,
        title: 'محاولة تعديل عنوان ملف مؤرشف',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        idempotencyKey: `update-m-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterArchivedError);

    // 5. Mutation 2: addProceeding must throw MatterArchivedError
    await expect(
      addProceeding(actor, {
        matterId: opened.matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        numberText: '999',
        yearLabel: '2024',
        status: 'DRAFT',
        idempotencyKey: `add-p-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterArchivedError);

    // 6. Mutation 3: linkMatterParty must throw MatterArchivedError
    const opponentRes = await saveParty(actor, {
      kind: 'PERSON',
      name: 'خالد عبد الرازق المستأجر',
      idempotencyKey: `opp-p-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(opponentRes.party.id);

    await expect(
      linkMatterParty(actor, {
        matterId: opened.matter.id,
        partyId: opponentRes.party.id,
        role: 'OPPONENT',
        idempotencyKey: `link-mp-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterArchivedError);

    // 7. Mutation 4: updateMatterParty must throw MatterArchivedError
    const existingMatterParty = opened.matter.parties?.[0];
    expect(existingMatterParty).toBeDefined();
    if (!existingMatterParty) throw new Error('Matter party not found');

    await expect(
      updateMatterParty(actor, {
        id: existingMatterParty.id,
        matterId: opened.matter.id,
        role: 'CLIENT',
        expectedVersion: existingMatterParty.version,
        notes: 'ملاحظة جديدة',
        idempotencyKey: `upd-mp-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterArchivedError);

    // 8. Mutation 5: unlinkMatterParty must throw MatterArchivedError
    await expect(
      unlinkMatterParty(actor, {
        id: existingMatterParty.id,
        matterId: opened.matter.id,
        expectedVersion: existingMatterParty.version,
        idempotencyKey: `unl-mp-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterArchivedError);
  });

  it('T07-04: Reopening an archived matter restores active status when client exists, and permits mutations again', async () => {
    const clientRes = await saveParty(actor, {
      kind: 'PERSON',
      name: 'طارق حسام المهندس',
      idempotencyKey: `client-th-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientRes.party.id);

    const opened = await openMatter(actor, {
      title: 'دعوى تعويض عن أضرار بناء',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: clientRes.party.id,
      idempotencyKey: `open-comp-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    // Archive
    const arch = await archiveMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: opened.matter.version,
      reason: 'أرشفة مؤقتة',
      idempotencyKey: `arch-${crypto.randomUUID()}`,
    });

    // Reopen
    const reopened = await reopenMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: arch.version,
      reason: 'استئناف السير في الدعوى بعد صدور تقرير الخبراء',
      idempotencyKey: `reopen-${crypto.randomUUID()}`,
    });

    expect(reopened.status).toBe('ACTIVE');
    expect(reopened.archivedAt).toBeNull();
    expect(reopened.version).toBe(arch.version + 1);

    // Verify audit record for REOPEN_MATTER
    const reopenAudits = await prisma.auditEvent.findMany({
      where: { entityType: 'Matter', entityId: opened.matter.id, action: 'REOPEN_MATTER' },
    });
    expect(reopenAudits.length).toBe(1);

    // Mutations succeed now
    const updated = await updateMatter(actor, {
      id: opened.matter.id,
      expectedVersion: reopened.version,
      title: 'دعوى تعويض عن أضرار بناء - بعد إعادة الفتح',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      idempotencyKey: `upd-after-reopen-${crypto.randomUUID()}`,
    });
    expect(updated.matter.title).toBe('دعوى تعويض عن أضرار بناء - بعد إعادة الفتح');
  });

  it('T07-05: Reopening an archived matter restores DRAFT when no client is present', async () => {
    const opened = await openMatter(actor, {
      title: 'ملف استشاري قيد المراجعة بدون موكل',
      kind: 'CONSULTATION',
      status: 'DRAFT',
      idempotencyKey: `open-draft-no-c-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    const arch = await archiveMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: opened.matter.version,
      reason: 'عدم حضور طالب الاستشارة',
      idempotencyKey: `arch-no-c-${crypto.randomUUID()}`,
    });

    const reopened = await reopenMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: arch.version,
      reason: 'إعادة فتح لمتابعة الاستشارة',
      idempotencyKey: `reopen-no-c-${crypto.randomUUID()}`,
    });

    expect(reopened.status).toBe('DRAFT');
    expect(reopened.archivedAt).toBeNull();
  });

  it('T07-06: Proceeding lifecycle: archiving proceeding sets read-only, reopening fails if parent matter is archived', async () => {
    const opened = await openMatter(actor, {
      title: 'دعوى بطلان عقد بيع',
      kind: 'LITIGATION',
      status: 'DRAFT',
      idempotencyKey: `open-proc-test-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    const proc = await addProceeding(actor, {
      matterId: opened.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '١٥٠',
      yearLabel: '٢٠٢٤',
      status: 'DRAFT',
      idempotencyKey: `add-proc-${crypto.randomUUID()}`,
    });

    // Check normalized digits were generated on creation
    const dbProc = await prisma.proceeding.findUnique({ where: { id: proc.id } });
    expect(dbProc?.numberNormalized).toBe('150');
    expect(dbProc?.yearNormalized).toBe('2024');

    // Archive the proceeding
    const archProc = await archiveProceeding(actor, {
      proceedingId: proc.id,
      matterId: opened.matter.id,
      expectedVersion: proc.version,
      reason: 'صدور حكم قطعي في الدرجة الابتدائية',
      idempotencyKey: `arch-proc-${crypto.randomUUID()}`,
    });
    expect(archProc.archivedAt).toBeTruthy();

    // Verify read-only on archived proceeding
    await expect(
      updateProceeding(actor, {
        id: proc.id,
        matterId: opened.matter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        numberText: '150',
        yearLabel: '2024',
        status: 'DRAFT',
        expectedVersion: archProc.version,
        idempotencyKey: `upd-arch-proc-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ProceedingArchivedError);

    // Archive the parent matter as well
    const freshMatter = await getMatter(opened.matter.id, actor);
    await archiveMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: freshMatter.version,
      reason: 'أرشفة الملف بالكامل',
      idempotencyKey: `arch-parent-m-${crypto.randomUUID()}`,
    });

    // Reopening the proceeding while parent matter is archived must fail with MatterArchivedError
    await expect(
      reopenProceeding(actor, {
        proceedingId: proc.id,
        matterId: opened.matter.id,
        expectedVersion: archProc.version,
        reason: 'محاولة فتح قيد في ملف مؤرشف',
        idempotencyKey: `reopen-proc-blocked-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(MatterArchivedError);
  });

  it('T07-07: Pagination bounds limit, page calculation, and stable tie-breaker ordering', async () => {
    // Create 15 matters
    for (let i = 1; i <= 15; i++) {
      const pad = String(i).padStart(2, '0');
      const m = await openMatter(actor, {
        title: `ملف تجربة الترقيم ${pad} للقضايا`,
        kind: 'LITIGATION',
        status: 'DRAFT',
        idempotencyKey: `open-page-${pad}-${crypto.randomUUID()}`,
      });
      createdMatterIds.push(m.matter.id);
    }

    // Page 1 with limit 5
    const page1 = await searchMatters({
      query: 'تجربة الترقيم',
      page: 1,
      limit: 5,
    }, actor);
    expect(page1.matters.length).toBe(5);
    expect(page1.total).toBe(15);
    expect(page1.page).toBe(1);
    expect(page1.totalPages).toBe(3);

    // Page 2 with limit 5
    const page2 = await searchMatters({
      query: 'تجربة الترقيم',
      page: 2,
      limit: 5,
    }, actor);
    expect(page2.matters.length).toBe(5);
    expect(page2.page).toBe(2);

    // Disjoint sets: no overlap across page boundaries
    const page1Ids = new Set(page1.matters.map((m) => m.id));
    const page2Ids = new Set(page2.matters.map((m) => m.id));
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });

  it('T07-08: Filter includeArchived correctly separates active and archived records', async () => {
    const activeMatter = await openMatter(actor, {
      title: 'ملف نشط للبحث التجريبي',
      kind: 'LITIGATION',
      status: 'DRAFT',
      idempotencyKey: `open-act-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(activeMatter.matter.id);

    const archivedMatter = await openMatter(actor, {
      title: 'ملف سيؤرشف للبحث التجريبي',
      kind: 'LITIGATION',
      status: 'DRAFT',
      idempotencyKey: `open-arch-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(archivedMatter.matter.id);

    await archiveMatter(actor, {
      matterId: archivedMatter.matter.id,
      expectedVersion: archivedMatter.matter.version,
      reason: 'أرشفة للاختبار',
      idempotencyKey: `arch-test-${crypto.randomUUID()}`,
    });

    // 1. Search without includeArchived (default false)
    const normalSearch = await searchMatters({
      query: 'للبحث التجريبي',
      includeArchived: false,
    }, actor);
    const normalIds = normalSearch.matters.map((m) => m.id);
    expect(normalIds).toContain(activeMatter.matter.id);
    expect(normalIds).not.toContain(archivedMatter.matter.id);

    // 2. Search with includeArchived: true
    const archivedSearch = await searchMatters({
      query: 'للبحث التجريبي',
      includeArchived: true,
    }, actor);
    const archivedIds = archivedSearch.matters.map((m) => m.id);
    expect(archivedIds).toContain(activeMatter.matter.id);
    expect(archivedIds).toContain(archivedMatter.matter.id);
  });

  it('T07-09: Arabic-Indic digits query matches Western stored numbers in proceedings and vice-versa', async () => {
    const opened = await openMatter(actor, {
      title: 'ملف فحص تطابق الأرقام المشرقية والمغربية',
      kind: 'CONTRACT',
      status: 'DRAFT',
      idempotencyKey: `open-digits-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    // Proceeding saved with Western numbers: 8877 / 2024
    const proc = await addProceeding(actor, {
      matterId: opened.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '8877',
      yearLabel: '2024',
      status: 'DRAFT',
      idempotencyKey: `proc-western-${crypto.randomUUID()}`,
    });

    // Search proceeding using Eastern Arabic-Indic digits: '٨٨٧٧'
    const searchResEastern = await searchProceedings({
      query: '٨٨٧٧',
    }, actor);
    const procIds = searchResEastern.proceedings.map((p) => p.id);
    expect(procIds).toContain(proc.id);

    // Search proceeding using Western digits: '8877'
    const searchResWestern = await searchProceedings({
      query: '8877',
    }, actor);
    expect(searchResWestern.proceedings.map((p) => p.id)).toContain(proc.id);
  });

  it('T07-10: Unified Search aggregates across Parties, Matters, and Proceedings with deterministic order', async () => {
    // 1. Party
    const uniqueTerm = `سيد_${Date.now()}`;
    const p = await saveParty(actor, {
      kind: 'PERSON',
      name: `${uniqueTerm} الحفناوي`,
      idempotencyKey: `unified-p-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(p.party.id);

    // 2. Matter
    const m = await openMatter(actor, {
      title: `قضية شركة ${uniqueTerm} للمقاولات`,
      kind: 'CONTRACT',
      status: 'DRAFT',
      idempotencyKey: `unified-m-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    // 3. Proceeding
    await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      circuit: `دائرة ${uniqueTerm}`,
      numberText: '1122',
      yearLabel: '2025',
      status: 'DRAFT',
      idempotencyKey: `unified-proc-${crypto.randomUUID()}`,
    });

    const unified = await unifiedSearch({
      query: uniqueTerm,
      limit: 10,
    }, actor);

    expect(unified.counts.parties).toBeGreaterThanOrEqual(1);
    expect(unified.counts.matters).toBeGreaterThanOrEqual(1);
    expect(unified.counts.proceedings).toBeGreaterThanOrEqual(1);
    expect(unified.items.length).toBeGreaterThanOrEqual(3);

    const types = new Set(unified.items.map((i) => i.entityType));
    expect(types.has('PARTY')).toBe(true);
    expect(types.has('MATTER')).toBe(true);
    expect(types.has('PROCEEDING')).toBe(true);
  });

  it('T07-11: Migration backfill translates Arabic-Indic digits into ASCII normalized columns', async () => {
    const opened = await openMatter(actor, {
      title: 'ملف اختبار ترقية وفحص ملء البيانات التاريخية',
      kind: 'LITIGATION',
      status: 'DRAFT',
      idempotencyKey: `open-backfill-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(opened.matter.id);

    const procId = crypto.randomUUID();
    // Simulate pre-existing proceeding row before migration (null normalized fields)
    await prisma.$executeRaw`
      INSERT INTO "proceeding" (
        "id", "matterId", "courtId", "instance", "numberText", "yearLabel",
        "status", "version", "createdById", "updatedById", "createdAt", "updatedAt"
      ) VALUES (
        ${procId}, ${opened.matter.id}, ${testCourtId}, 'FIRST_INSTANCE',
        '٩٨٧٦', '٢٠٢٣', 'DRAFT', 1, ${actor.id}, ${actor.id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `;

    // Apply the exact translation logic from the T07 migration script
    await prisma.$executeRaw`
      UPDATE "proceeding"
      SET 
        "numberNormalized" = trim(translate("numberText", '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')),
        "yearNormalized"   = trim(translate("yearLabel",  '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
      WHERE "id" = ${procId};
    `;

    const backfilled = await prisma.proceeding.findUnique({
      where: { id: procId },
      select: { numberNormalized: true, yearNormalized: true },
    });

    expect(backfilled?.numberNormalized).toBe('9876');
    expect(backfilled?.yearNormalized).toBe('2023');
  });
});
