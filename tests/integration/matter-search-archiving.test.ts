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
  linkProceedingParty,
} from '@/modules/matters/matter-service';
import {
  MatterArchivedError,
  MatterValidationError,
  ProceedingArchivedError,
  ConcurrencyConflictError,
  UnsupportedTransitionError,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { saveParty, getClientProfile } from '@/modules/parties/service';
import { createTask } from '@/modules/productivity/productivity-service';
import { formatCairoOffsetYmd } from '../helpers/cairo-test-date';

describe('T07 Integration Tests: Search, Filters, Pagination, and Safe Archiving', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  let testCourtId: string;
  let createdCourtId: string | null = null;

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
      createdCourtId = court.id;
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
    if (createdCourtId) {
      await cleanupReferenceFixtures(prisma, { courtIds: [createdCourtId] });
    }
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
    const archiveAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: 'Matter', entityId: opened.matter.id, action: 'ARCHIVE_MATTER' },
    });
    expect(archiveAudit.changedFields).toMatchObject({
      archiveReason: 'أرشفة مؤقتة',
      archivedAt: arch.archivedAt,
    });

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
      registerType: 'مدني',
      status: 'CLOSED',
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
    const archivedMatter = await archiveMatter(actor, {
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

    await reopenMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: archivedMatter.version,
      reason: 'متابعة الملف بعد انتهاء المراجعة',
      idempotencyKey: `reopen-parent-m-${crypto.randomUUID()}`,
    });
    const reopened = await reopenProceeding(actor, {
      proceedingId: proc.id,
      matterId: opened.matter.id,
      expectedVersion: archProc.version,
      reason: 'إتاحة القيد المغلق للمراجعة',
      idempotencyKey: `reopen-proc-${crypto.randomUUID()}`,
    });
    expect(reopened.status).toBe('CLOSED');
    expect(reopened.archivedAt).toBeNull();
    const archiveAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: 'Proceeding', entityId: proc.id, action: 'ARCHIVE_PROCEEDING' },
    });
    expect(archiveAudit.changedFields).toMatchObject({
      archiveReason: 'صدور حكم قطعي في الدرجة الابتدائية',
      archivedAt: archProc.archivedAt,
    });
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
      title: 'قضية شركة للمقاولات',
      kind: 'CONTRACT',
      initialClientId: p.party.id,
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
    expect((await searchMatters({ query: uniqueTerm }, actor)).matters.map(({ id }) => id)).toEqual([m.matter.id]);
    expect((await unifiedSearch({ query: uniqueTerm, type: 'MATTER' }, actor)).items.map(({ id }) => id)).toEqual([m.matter.id]);
  });

  it('matches the complete docket pair in both digit systems without matching a different year', async () => {
    const opened = await openMatter(actor, {
      title: 'ملف فحص الرقم والسنة معاً', kind: 'LITIGATION', idempotencyKey: crypto.randomUUID(),
    });
    const matterId = opened.matter.id;
    createdMatterIds.push(matterId);
    const addDocket = (yearLabel: string) => addProceeding(actor, {
      matterId, courtId: testCourtId, instance: 'FIRST_INSTANCE', status: 'DRAFT',
      numberText: '007788', yearLabel, idempotencyKey: crypto.randomUUID(),
    });
    const correct = await addDocket('2026');
    const other = await addDocket('2027');
    for (const query of ['007788/2026', '٠٠٧٧٨٨/٢٠٢٦']) {
      const directory = (await searchProceedings({ query }, actor)).proceedings.map(({ id }) => id);
      const global = (await unifiedSearch({ query, type: 'PROCEEDING' }, actor)).items.map(({ id }) => id);
      expect(directory).toContain(correct.id);
      expect(directory).not.toContain(other.id);
      expect(global).toContain(correct.id);
      expect(global).not.toContain(other.id);
    }
  });

  it('stores private note revisions and audits only references and paper location changes', async () => {
    const location = await prisma.storageLocation.create({
      data: { name: 'مكان ورقي للاختبار', createdById: actor.id, updatedById: actor.id },
    });
    const beforeText = 'ملاحظات خاصة قبل التعديل';
    const updatedText = 'ملاحظات خاصة بعد التعديل';
    let matterId: string | undefined;
    try {
      const opened = await openMatter(actor, {
        title: 'ملف اختبار مراجعات الملاحظات', kind: 'OTHER', notes: beforeText, idempotencyKey: crypto.randomUUID(),
      });
      matterId = opened.matter.id;
      const base = { id: matterId, title: opened.matter.title, kind: opened.matter.kind, status: opened.matter.status };
      const moved = await updateMatter(actor, {
        ...base, expectedVersion: opened.matter.version, paperLocationId: location.id, idempotencyKey: crypto.randomUUID(),
      });
      expect(moved.matter.notes).toBe(beforeText);
      const changed = await updateMatter(actor, {
        ...base, expectedVersion: moved.matter.version, notes: updatedText, idempotencyKey: crypto.randomUUID(),
      });
      expect(changed.matter.paperLocationId).toBe(location.id);
      expect((await getMatter(matterId, actor)).noteRevisions).toBeUndefined();
      const revisions = (await getMatter(matterId, actor, true)).noteRevisions;
      expect(revisions?.map(({ notes, version, changedById }) => ({ notes, version, changedById }))).toEqual([
        { notes: updatedText, version: changed.matter.version, changedById: actor.id },
        { notes: beforeText, version: opened.matter.version, changedById: actor.id },
      ]);
      for (const row of revisions ?? []) expect(new Date(row.createdAt).toISOString()).toBe(row.createdAt);
      const audit = await prisma.auditEvent.findMany({
        where: { entityId: matterId, action: 'UPDATE_MATTER' }, select: { changedFields: true },
      });
      expect(audit).toHaveLength(2);
      expect(audit.map(({ changedFields }) => changedFields)).toEqual(expect.arrayContaining([
        expect.objectContaining({ paperLocationId: { from: null, to: location.id } }),
        expect.objectContaining({ noteRevision: changed.matter.version }),
      ]));
      expect(JSON.stringify(audit)).not.toContain(beforeText);
      expect(JSON.stringify(audit)).not.toContain(updatedText);
    } finally {
      if (matterId) await cleanupMatterFixtures(prisma, [matterId]);
      await prisma.storageLocation.delete({ where: { id: location.id } });
    }
  });

  it('requires complete Proceeding registration in every non-draft state', async () => {
    const opened = await openMatter(actor, {
      title: 'ملف لاختبار اكتمال القيد', kind: 'LITIGATION', idempotencyKey: crypto.randomUUID(),
    });
    const matterId = opened.matter.id;
    createdMatterIds.push(matterId);
    const input = {
      matterId, courtId: testCourtId, instance: 'FIRST_INSTANCE' as const, numberText: '222', yearLabel: '2026',
    };
    const draft = await addProceeding(actor, { ...input, status: 'DRAFT', idempotencyKey: crypto.randomUUID() });
    for (const status of ['ACTIVE', 'AWAITING_JUDGMENT', 'DECIDED', 'CLOSED'] as const) {
      await expect(addProceeding(actor, { ...input, status, idempotencyKey: crypto.randomUUID() })).rejects.toThrow(MatterValidationError);
      await expect(updateProceeding(actor, {
        ...input, id: draft.id, expectedVersion: draft.version, status, idempotencyKey: crypto.randomUUID(),
      })).rejects.toThrow(MatterValidationError);
    }
    expect(await prisma.proceeding.count({ where: { matterId } })).toBe(1);
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

  it('T07-12: Standards 1 — Invalid source state rejects on all 4 lifecycle commands with UnsupportedTransitionError', async () => {
    // 1. Open active matter
    const clientRes = await saveParty(actor, {
      kind: 'PERSON',
      name: 'عمرو دياب العميل للاختبار',
      idempotencyKey: `client-inv-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientRes.party.id);

    const m = await openMatter(actor, {
      title: 'ملف اختبار الحالات غير الصالحة لدورة الحياة',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: clientRes.party.id,
      idempotencyKey: `open-inv-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const proc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '5566',
      yearLabel: '2024',
      status: 'DRAFT',
      idempotencyKey: `proc-inv-${crypto.randomUUID()}`,
    });

    // 1a. Reopen a non-archived matter -> must reject
    const freshMatter = await getMatter(m.matter.id, actor);
    const reopenNonArchKey = `reopen-nonarch-${crypto.randomUUID()}`;
    await expect(
      reopenMatter(actor, {
        matterId: m.matter.id,
        expectedVersion: freshMatter.version,
        reason: 'محاولة إعادة فتح ملف غير مؤرشف',
        idempotencyKey: reopenNonArchKey,
      })
    ).rejects.toThrow(UnsupportedTransitionError);

    // Verify claim, audit, and version remain unchanged
    const matterAfterFailedReopen = await getMatter(m.matter.id, actor);
    expect(matterAfterFailedReopen.version).toBe(freshMatter.version);
    const reopenClaims = await prisma.idempotencyRecord.findMany({ where: { key: reopenNonArchKey } });
    expect(reopenClaims.length).toBe(0);

    // 1b. Reopen a non-archived proceeding -> must reject
    const freshProc = await prisma.proceeding.findUniqueOrThrow({ where: { id: proc.id } });
    const reopenProcNonArchKey = `reopen-p-nonarch-${crypto.randomUUID()}`;
    await expect(
      reopenProceeding(actor, {
        matterId: m.matter.id,
        proceedingId: proc.id,
        expectedVersion: freshProc.version,
        reason: 'محاولة إعادة فتح قيد غير مؤرشف',
        idempotencyKey: reopenProcNonArchKey,
      })
    ).rejects.toThrow(UnsupportedTransitionError);

    // 1c. Archive matter
    const archResult = await archiveMatter(actor, {
      matterId: m.matter.id,
      expectedVersion: freshMatter.version,
      reason: 'أرشفة شرعية أولى',
      idempotencyKey: `arch-legit-${crypto.randomUUID()}`,
    });
    expect(archResult.status).toBe('ARCHIVED');

    // 1d. Archive an already archived matter -> must reject
    const reArchiveKey = `arch-again-${crypto.randomUUID()}`;
    await expect(
      archiveMatter(actor, {
        matterId: m.matter.id,
        expectedVersion: archResult.version,
        reason: 'محاولة أرشفة ملف مؤرشف بالفعل',
        idempotencyKey: reArchiveKey,
      })
    ).rejects.toThrow(UnsupportedTransitionError);

    const reArchClaims = await prisma.idempotencyRecord.findMany({ where: { key: reArchiveKey } });
    expect(reArchClaims.length).toBe(0);

    // 1e. Reopen matter to test proceeding archive states
    await reopenMatter(actor, {
      matterId: m.matter.id,
      expectedVersion: archResult.version,
      reason: 'إعادة فتح الملف الشرعية',
      idempotencyKey: `reopen-legit-${crypto.randomUUID()}`,
    });

    // 1f. Archive proceeding
    const archProcResult = await archiveProceeding(actor, {
      matterId: m.matter.id,
      proceedingId: proc.id,
      expectedVersion: proc.version,
      reason: 'أرشفة قيد قضائي شرعية',
      idempotencyKey: `arch-p-legit-${crypto.randomUUID()}`,
    });
    expect(archProcResult.archivedAt).toBeTruthy();

    // 1g. Archive an already archived proceeding -> must reject
    const reArchProcKey = `arch-p-again-${crypto.randomUUID()}`;
    await expect(
      archiveProceeding(actor, {
        matterId: m.matter.id,
        proceedingId: proc.id,
        expectedVersion: archProcResult.version,
        reason: 'محاولة أرشفة قيد مؤرشف بالفعل',
        idempotencyKey: reArchProcKey,
      })
    ).rejects.toThrow(UnsupportedTransitionError);
  });

  it('T07-13: Standards 2 — unlinkMatterParty rejects with ProceedingArchivedError if linked to an archived proceeding', async () => {
    // 1. Create client and matter
    const clientRes = await saveParty(actor, {
      kind: 'PERSON',
      name: 'سليمان عبد الحميد التاجر',
      idempotencyKey: `party-unlink-arch-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientRes.party.id);

    const secondParty = await saveParty(actor, {
      kind: 'PERSON',
      name: 'هيثم عبد الجواد الخصم',
      idempotencyKey: `party-unlink-2-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(secondParty.party.id);

    const m = await openMatter(actor, {
      title: 'نزاع تجاري متعدد الأطراف والقيود',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: clientRes.party.id,
      idempotencyKey: `open-m-unlink-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    // Link second party to matter
    const linkedSecond = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: secondParty.party.id,
      role: 'OPPONENT',
      idempotencyKey: `link-sec-${crypto.randomUUID()}`,
    });

    // Create a proceeding
    const proc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '7788',
      yearLabel: '2024',
      status: 'DRAFT',
      idempotencyKey: `proc-unlink-${crypto.randomUUID()}`,
    });

    // Link the second matter party to the proceeding
    await linkProceedingParty(actor, {
      proceedingId: proc.id,
      matterPartyId: linkedSecond.id,
      legalCapacity: 'DEFENDANT',
      expectedVersion: proc.version,
      idempotencyKey: `link-proc-party-${crypto.randomUUID()}`,
    });

    // Archive the proceeding
    await archiveProceeding(actor, {
      matterId: m.matter.id,
      proceedingId: proc.id,
      expectedVersion: proc.version + 1,
      reason: 'أرشفة القيد قبل فك ارتباط الطرف',
      idempotencyKey: `arch-proc-for-unlink-${crypto.randomUUID()}`,
    });

    // Try to unlink the second party from the parent matter
    // This must be REJECTED because the party is in an archived proceeding!
    const unlinkKey = `unlink-blocked-arch-${crypto.randomUUID()}`;
    await expect(
      unlinkMatterParty(actor, {
        matterId: m.matter.id,
        id: linkedSecond.id,
        expectedVersion: linkedSecond.version,
        idempotencyKey: unlinkKey,
      })
    ).rejects.toThrow(ProceedingArchivedError);

    // Assert matter party, proceeding party, audit, and claim rows are completely intact
    const survivingMatterParty = await prisma.matterParty.findUnique({
      where: { id: linkedSecond.id },
    });
    expect(survivingMatterParty).toBeTruthy();

    const survivingProceedingParty = await prisma.proceedingParty.findFirst({
      where: { matterPartyId: linkedSecond.id },
    });
    expect(survivingProceedingParty).toBeTruthy();

    const failedClaims = await prisma.idempotencyRecord.findMany({ where: { key: unlinkKey } });
    expect(failedClaims.length).toBe(0);
  });

  it('T07-14: Standards 4 — Lifecycle idempotency replay returns original committed LifecycleCommandResult even after opposite transition', async () => {
    const clientRes = await saveParty(actor, {
      kind: 'PERSON',
      name: 'معتز الشريف الموكل',
      idempotencyKey: `party-replay-opp-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(clientRes.party.id);

    const m = await openMatter(actor, {
      title: 'ملف اختبار إرجاع النتيجة الأصلية عند إعادة التشغيل',
      kind: 'CONTRACT',
      status: 'ACTIVE',
      initialClientId: clientRes.party.id,
      idempotencyKey: `open-replay-opp-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const archiveKey = `archive-cmd-${crypto.randomUUID()}`;
    const archiveResult = await archiveMatter(actor, {
      matterId: m.matter.id,
      expectedVersion: m.matter.version,
      reason: 'أرشفة أولية للاختبار',
      idempotencyKey: archiveKey,
    });
    expect(archiveResult.status).toBe('ARCHIVED');
    expect(archiveResult.version).toBe(m.matter.version + 1);

    // Later: reopen the matter with a different idempotency key
    const reopenKey = `reopen-cmd-${crypto.randomUUID()}`;
    const reopenResult = await reopenMatter(actor, {
      matterId: m.matter.id,
      expectedVersion: archiveResult.version,
      reason: 'إعادة الفتح بعد فترة',
      idempotencyKey: reopenKey,
    });
    expect(reopenResult.status).toBe('ACTIVE');
    expect(reopenResult.version).toBe(archiveResult.version + 1);

    // Now replay the ORIGINAL archive request with key `archiveKey`:
    // It MUST return the archived state (version N, status ARCHIVED), NOT the newly reopened ACTIVE state!
    const replayedArchive = await archiveMatter(actor, {
      matterId: m.matter.id,
      expectedVersion: m.matter.version,
      reason: 'أرشفة أولية للاختبار',
      idempotencyKey: archiveKey,
    });
    expect(replayedArchive.status).toBe('ARCHIVED');
    expect(replayedArchive.version).toBe(archiveResult.version);
    expect(replayedArchive.archivedAt).toBe(archiveResult.archivedAt);
    expect(replayedArchive.operationVersion).toBe(archiveResult.version);

    // And replay the reopen request:
    // It MUST return the reopen state (version N+1, status ACTIVE, archivedAt null)!
    const replayedReopen = await reopenMatter(actor, {
      matterId: m.matter.id,
      expectedVersion: archiveResult.version,
      reason: 'إعادة الفتح بعد فترة',
      idempotencyKey: reopenKey,
    });
    expect(replayedReopen.status).toBe('ACTIVE');
    expect(replayedReopen.version).toBe(reopenResult.version);
    expect(replayedReopen.archivedAt).toBeNull();
  });

  it('T07-15: Spec 1 & Spec 3 — Unified search returns accurate category counts regardless of tab, bounded paging, and correct links', async () => {
    const batchTag = `batch_${Date.now()}`;

    // Create 3 parties
    for (let i = 1; i <= 3; i++) {
      const p = await saveParty(actor, {
        kind: 'PERSON',
        name: `طرف مجمع ${batchTag} رقم ${i}`,
        idempotencyKey: `p-uni-${batchTag}-${i}`,
      });
      createdPartyIds.push(p.party.id);
    }

    // Create 2 matters
    for (let i = 1; i <= 2; i++) {
      const mat = await openMatter(actor, {
        title: `قضية مجمعة ${batchTag} رقم ${i}`,
        kind: 'LITIGATION',
        status: 'DRAFT',
        idempotencyKey: `m-uni-${batchTag}-${i}`,
      });
      createdMatterIds.push(mat.matter.id);
    }

    // Create 2 proceedings under matter 1
    const firstMatterId = createdMatterIds[0];
    const createdProcIds: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const pr = await addProceeding(actor, {
        matterId: firstMatterId,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        circuit: `دائرة ${batchTag}`,
        numberText: `90${i}`,
        yearLabel: '2025',
        status: 'DRAFT',
        idempotencyKey: `pr-uni-${batchTag}-${i}`,
      });
      createdProcIds.push(pr.id);
    }

    // 1. Search with type = 'MATTER': verify that counts for ALL categories are still accurate!
    const matterTabSearch = await unifiedSearch({
      query: batchTag,
      type: 'MATTER',
      limit: 10,
    }, actor);
    expect(matterTabSearch.counts.matters).toBe(2);
    expect(matterTabSearch.counts.parties).toBe(3);
    expect(matterTabSearch.counts.proceedings).toBe(2);
    expect(matterTabSearch.counts.all).toBe(7);
    expect(matterTabSearch.total).toBe(2);
    expect(matterTabSearch.items.length).toBe(2);
    expect(matterTabSearch.items.every((it) => it.entityType === 'MATTER')).toBe(true);

    // 2. Search with type = 'ALL' and limit = 4: Page 1 and Page 2 must have disjoint IDs
    const page1 = await unifiedSearch({
      query: batchTag,
      type: 'ALL',
      page: 1,
      limit: 4,
    }, actor);
    expect(page1.items.length).toBe(4);
    expect(page1.total).toBe(7);
    expect(page1.totalPages).toBe(2);

    const page2 = await unifiedSearch({
      query: batchTag,
      type: 'ALL',
      page: 2,
      limit: 4,
    }, actor);
    expect(page2.items.length).toBe(3); // 7 - 4 = 3 items remaining

    const p1Ids = new Set(page1.items.map((i) => i.id));
    for (const item of page2.items) {
      expect(p1Ids.has(item.id)).toBe(false);
    }

    // 3. Spec 3: Verify proceeding result link format: /matters/${matterId}/proceedings/${procId}
    const procTabSearch = await unifiedSearch({
      query: batchTag,
      type: 'PROCEEDING',
      limit: 10,
    }, actor);
    expect(procTabSearch.items.length).toBe(2);
    for (const pItem of procTabSearch.items) {
      expect(pItem.href).toBe(`/matters/${firstMatterId}/proceedings/${pItem.id}`);
    }

    // 4. Spec 3: Archived Party profile retrieval via getClientProfile
    const partyToArchive = createdPartyIds[0];
    await prisma.party.update({
      where: { id: partyToArchive },
      data: { archivedAt: new Date() },
    });

    const archivedProfile = await getClientProfile(actor, partyToArchive);
    expect(archivedProfile.id).toBe(partyToArchive);
    expect(archivedProfile.archivedAt).toBeTruthy();
  });

  it('T07-16: Spec 5 — searchMatters incompleteData filter properly matches active matters missing paper location, matters without client, and matters with draft proceedings', async () => {
    const incTag = `inc_${Date.now()}`;

    // 1. Client party for testing
    const validClient = await saveParty(actor, {
      kind: 'PERSON',
      name: `موكل كامل ${incTag}`,
      idempotencyKey: `p-full-${incTag}`,
    });
    createdPartyIds.push(validClient.party.id);

    // Create a paper location
    let paperLoc = await prisma.storageLocation.findFirst({ where: { isActive: true } });
    if (!paperLoc) {
      paperLoc = await prisma.storageLocation.create({
        data: {
          name: `موقع حفظ ${incTag}`,
          code: `LOC-${incTag}`,
          isActive: true,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
    }

    // 2. Incomplete Matter 1: ACTIVE but paperLocationId is null
    const mActiveNoLoc = await openMatter(actor, {
      title: `قضية نشطة بدون موقع حفظ ${incTag}`,
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: validClient.party.id,
      idempotencyKey: `m-no-loc-${incTag}`,
    });
    createdMatterIds.push(mActiveNoLoc.matter.id);

    // 3. Incomplete Matter 2: DRAFT without client
    const mNoClient = await openMatter(actor, {
      title: `قضية بدون موكل ${incTag}`,
      kind: 'CONSULTATION',
      status: 'DRAFT',
      idempotencyKey: `m-no-client-${incTag}`,
    });
    createdMatterIds.push(mNoClient.matter.id);

    // 4. Incomplete Matter 3: Has a DRAFT proceeding
    const mWithDraftProc = await openMatter(actor, {
      title: `قضية بقيد مسودة ${incTag}`,
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: validClient.party.id,
      paperLocationId: paperLoc.id,
      idempotencyKey: `m-draft-proc-${incTag}`,
    });
    createdMatterIds.push(mWithDraftProc.matter.id);

    await addProceeding(actor, {
      matterId: mWithDraftProc.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '1122',
      yearLabel: '2025',
      status: 'DRAFT',
      idempotencyKey: `proc-draft-${incTag}`,
    });

    // 5. Complete Matter: ACTIVE, has client, has paper location, and NO draft proceeding
    const mComplete = await openMatter(actor, {
      title: `قضية مكتملة البيانات ${incTag}`,
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: validClient.party.id,
      paperLocationId: paperLoc.id,
      idempotencyKey: `m-complete-${incTag}`,
    });
    createdMatterIds.push(mComplete.matter.id);

    // Add an ACTIVE (not DRAFT) proceeding to the complete matter
    await addProceeding(actor, {
      matterId: mComplete.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      numberText: '3344',
      yearLabel: '2025',
      status: 'ACTIVE',
      idempotencyKey: `proc-active-${incTag}`,
    });

    // Query with incompleteData: true
    const searchInc = await searchMatters({
      query: incTag,
      incompleteData: true,
      limit: 20,
    }, actor);

    const incIds = new Set(searchInc.matters.map((m) => m.id));
    expect(incIds.has(mActiveNoLoc.matter.id)).toBe(true);
    expect(incIds.has(mNoClient.matter.id)).toBe(true);
    expect(incIds.has(mWithDraftProc.matter.id)).toBe(true);
    expect(incIds.has(mComplete.matter.id)).toBe(false);
  });

  it('reopenMatter and reopenProceeding re-enqueue open future tasks over CANCELLED archive jobs without P2002 and skip sibling archived proceedings', async () => {
    const clientRes = await saveParty(actor, {
      kind: 'PERSON',
      name: `موكل إعادة فتح تذكيرات ${Date.now()}`,
      idempotencyKey: crypto.randomUUID(),
    });
    createdPartyIds.push(clientRes.party.id);

    const opened = await openMatter(actor, {
      title: `ملف إعادة فتح مع مهام مؤجلة ${Date.now()}`,
      kind: 'LITIGATION',
      status: 'ACTIVE',
      initialClientId: clientRes.party.id,
      idempotencyKey: crypto.randomUUID(),
    });
    createdMatterIds.push(opened.matter.id);

    const procActive = await addProceeding(actor, {
      matterId: opened.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '8101',
      yearLabel: '2027',
      registerType: 'مدني كلي',
      status: 'ACTIVE',
      idempotencyKey: crypto.randomUUID(),
    });

    const procArchivedSibling = await addProceeding(actor, {
      matterId: opened.matter.id,
      courtId: testCourtId,
      instance: 'FIRST_INSTANCE',
      numberText: '8102',
      yearLabel: '2027',
      registerType: 'مدني كلي',
      status: 'ACTIVE',
      idempotencyKey: crypto.randomUUID(),
    });

    const taskActive = await createTask(actor, {
      title: 'مهمة قيد نشط لإعادة الفتح',
      matterId: opened.matter.id,
      proceedingId: procActive.id,
      dueDate: formatCairoOffsetYmd(15),
      idempotencyKey: crypto.randomUUID(),
    });

    const taskSibling = await createTask(actor, {
      title: 'مهمة قيد شقيق مؤرشف',
      matterId: opened.matter.id,
      proceedingId: procArchivedSibling.id,
      dueDate: formatCairoOffsetYmd(20),
      idempotencyKey: crypto.randomUUID(),
    });

    // Archive sibling proceeding first -> cancels taskSibling's JobRun
    const archivedSibling = await archiveProceeding(actor, {
      matterId: opened.matter.id,
      proceedingId: procArchivedSibling.id,
      expectedVersion: procArchivedSibling.version,
      reason: 'أرشفة القيد الشقيق قبل أرشفة الملف',
      idempotencyKey: crypto.randomUUID(),
    });

    // Archive matter -> cancels taskActive's JobRun
    const currentMatter = await getMatter(opened.matter.id, actor);
    const archivedMatter = await archiveMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: currentMatter.version,
      reason: 'أرشفة الملف مع مهام مستقبلية مفتوحة',
      idempotencyKey: crypto.randomUUID(),
    });

    const cancelledActiveCount = await prisma.jobRun.count({
      where: { sourceType: 'Task', sourceId: taskActive.id, status: 'CANCELLED' },
    });
    const cancelledSiblingCount = await prisma.jobRun.count({
      where: { sourceType: 'Task', sourceId: taskSibling.id, status: 'CANCELLED' },
    });
    expect(cancelledActiveCount).toBeGreaterThanOrEqual(1);
    expect(cancelledSiblingCount).toBeGreaterThanOrEqual(1);

    // Reopen matter -> succeeds without P2002, creates reopen-scoped PENDING JobRun for taskActive,
    // and does NOT re-enqueue taskSibling belonging to the still-archived sibling proceeding
    const reopenedMatter = await reopenMatter(actor, {
      matterId: opened.matter.id,
      expectedVersion: archivedMatter.version,
      reason: 'إعادة فتح الملف للعمل',
      idempotencyKey: crypto.randomUUID(),
    });

    const reopenedActiveJobs = await prisma.jobRun.findMany({
      where: { sourceType: 'Task', sourceId: taskActive.id, status: 'PENDING' },
    });
    expect(reopenedActiveJobs).toHaveLength(1);
    expect(reopenedActiveJobs[0]!.deduplicationKey).toBe(
      `task_reminder_${taskActive.id}_v${taskActive.version}_reopen_m${reopenedMatter.version}`
    );

    const siblingPendingAfterMatterReopen = await prisma.jobRun.count({
      where: { sourceType: 'Task', sourceId: taskSibling.id, status: 'PENDING' },
    });
    expect(siblingPendingAfterMatterReopen).toBe(0);

    // Reopen the archived sibling proceeding -> succeeds without P2002 and creates reopen-scoped PENDING JobRun for taskSibling
    const reopenedSibling = await reopenProceeding(actor, {
      matterId: opened.matter.id,
      proceedingId: procArchivedSibling.id,
      expectedVersion: archivedSibling.version,
      reason: 'إعادة فتح القيد الشقيق',
      idempotencyKey: crypto.randomUUID(),
    });

    const reopenedSiblingJobs = await prisma.jobRun.findMany({
      where: { sourceType: 'Task', sourceId: taskSibling.id, status: 'PENDING' },
    });
    expect(reopenedSiblingJobs).toHaveLength(1);
    expect(reopenedSiblingJobs[0]!.deduplicationKey).toBe(
      `task_reminder_${taskSibling.id}_v${taskSibling.version}_reopen_p${reopenedSibling.version}`
    );
  });
});
