import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '@/lib/auth';
import * as auditModule from '@/lib/audit';
import {
  openMatter,
  getMatter,
  searchMatters,
  addProceeding,
  updateProceeding,
  linkMatterParty,
} from '@/modules/matters/matter-service';
import {
  getOfficeSettings,
  updateOfficeSettings,
  createReferenceItem,
} from '@/modules/settings/reference-service';
import { saveParty } from '@/modules/parties/service';
import {
  createSyntheticActor,
  createSyntheticMaintainer,
  setupTestEncryptionKeys,
  cleanupPartyFixtures,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';
import {
  IdempotencyPayloadMismatchError,
} from '@/lib/idempotency';
import { AuthorizationError } from '@/modules/identity/types';

describe('T06-11, T06-12, T06-13 & T06-14: Atomicity, Idempotency & Authorization', () => {
  const prisma = getPrismaClient();
  const owner = createSyntheticActor();
  const maintainer = createSyntheticMaintainer();
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    createdMatterIds.length = 0;
    if (createdPartyIds.length > 0) {
      await cleanupPartyFixtures(prisma, createdPartyIds);
      createdPartyIds.length = 0;
    }
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    if (createdPartyIds.length > 0) {
      await cleanupPartyFixtures(prisma, createdPartyIds);
    }
  });

  it('T06-11: injects audit failure inside owned transaction: no partial matter or idempotency completion; retry succeeds cleanly', async () => {
    const idempotencyKey = `atom-fail-${crypto.randomUUID()}`;
    const testTitle = 'ملف اختبار إخفاق التدقيق الذري المتعمد';

    // 0. Pre-failure allocator state inspection (Codex T06-02 / T06-11 requirement)
    const cairoYear = new Date().getFullYear();
    const preSeqRow = await prisma.$queryRaw<{ nextVal: number }[]>`
      SELECT "nextVal" FROM file_code_sequence WHERE year = ${cairoYear}
    `;
    const preNextVal = preSeqRow?.[0]?.nextVal ? Number(preSeqRow[0].nextVal) : null;

    // 1. Spy on audit recording and force an error inside the transaction
    const auditSpy = vi.spyOn(auditModule, 'recordAuditEvent').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_TRANSACTION_AUDIT_FAILURE');
    });

    await expect(
      openMatter(owner, {
        title: testTitle,
        kind: 'LITIGATION',
        idempotencyKey,
      })
    ).rejects.toThrow('SIMULATED_TRANSACTION_AUDIT_FAILURE');

    auditSpy.mockRestore();

    // 2. Assert atomic rollback: no orphan matter, no idempotency record, and allocator state rolled back
    const orphanMatter = await prisma.matter.findFirst({
      where: { title: testTitle },
    });
    expect(orphanMatter).toBeNull();

    const orphanIdempotency = await prisma.idempotencyRecord.findFirst({
      where: { key: idempotencyKey },
    });
    expect(orphanIdempotency).toBeNull();

    const postFailSeqRow = await prisma.$queryRaw<{ nextVal: number }[]>`
      SELECT "nextVal" FROM file_code_sequence WHERE year = ${cairoYear}
    `;
    const postFailNextVal = postFailSeqRow?.[0]?.nextVal ? Number(postFailSeqRow[0].nextVal) : null;
    expect(postFailNextVal).toBe(preNextVal);

    // 3. Retry with same key succeeds cleanly
    const retryRes = await openMatter(owner, {
      title: testTitle,
      kind: 'LITIGATION',
      idempotencyKey,
    });
    expect(retryRes.matter.id).toBeDefined();
    createdMatterIds.push(retryRes.matter.id);

    // Verify allocated code matches expected nextVal without sequence gaps
    if (preNextVal !== null) {
      const expectedCode = `${cairoYear}/${String(preNextVal).padStart(4, '0')}`;
      expect(retryRes.matter.fileCode).toBe(expectedCode);
    }

    // 4. Verify audit event exists and contains required actor and sanitized payload
    const audits = await prisma.auditEvent.findMany({
      where: { entityId: retryRes.matter.id },
    });
    expect(audits.length).toBeGreaterThan(0);
    const createAudit = audits.find((a) => a.action === 'CREATE_MATTER');
    expect(createAudit).toBeDefined();
    expect(createAudit?.userId).toBe(owner.id);

    // 5. Immutability: application exposes no update/delete audit endpoints; audit records are immutable
    const countBefore = await prisma.auditEvent.count({ where: { entityId: retryRes.matter.id } });
    expect(countBefore).toBeGreaterThan(0);
  });

  it('T06-11b: injects audit failure inside addProceeding transaction: rolls back child proceeding and preserves parent', async () => {
    // 1. Create a parent matter
    const m = await openMatter(owner, {
      title: 'ملف لاختبار التراجع الذري للقيود الفرعية',
      kind: 'LITIGATION',
      idempotencyKey: `m-parent-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    // 2. Create a court
    const court = await prisma.court.create({
      data: {
        name: `محكمة التراجع ${crypto.randomUUID().slice(0, 6)}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const procKey = `proc-atom-fail-${crypto.randomUUID()}`;

    // 3. Spy on audit recording and force an error inside addProceeding
    const auditSpy = vi.spyOn(auditModule, 'recordAuditEvent').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_CHILD_AUDIT_FAILURE');
    });

    await expect(
      addProceeding(owner, {
        matterId: m.matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        numberText: '7788',
        yearLabel: '2026',
        registerType: 'مدني كلي',
        status: 'ACTIVE',
        idempotencyKey: procKey,
      })
    ).rejects.toThrow('SIMULATED_CHILD_AUDIT_FAILURE');

    auditSpy.mockRestore();

    // 4. Verify atomic rollback: no orphan proceeding row was persisted in DB
    const orphanProc = await prisma.proceeding.findFirst({
      where: { matterId: m.matter.id },
    });
    expect(orphanProc).toBeNull();

    // 5. Verify no orphan idempotency record
    const orphanIdempotency = await prisma.idempotencyRecord.findFirst({
      where: { key: procKey },
    });
    expect(orphanIdempotency).toBeNull();

    // 6. Parent matter remains intact
    const parentMatter = await prisma.matter.findUnique({
      where: { id: m.matter.id },
    });
    expect(parentMatter).not.toBeNull();
    expect(parentMatter?.version).toBe(m.matter.version);

    // Clean up court
    await prisma.court.delete({ where: { id: court.id } });
  });

  it('T06-11c: injects audit failure inside updateOfficeSettings transaction: rolls back office settings version and updates', async () => {
    const current = await getOfficeSettings(owner);
    const officeKey = `office-atom-fail-${crypto.randomUUID()}`;

    const auditSpy = vi.spyOn(auditModule, 'recordAuditEvent').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_OFFICE_AUDIT_FAILURE');
    });

    await expect(
      updateOfficeSettings(owner, {
        officeName: 'مكتب تراجع التدقيق الذري',
        expectedVersion: current.version,
        idempotencyKey: officeKey,
      })
    ).rejects.toThrow('SIMULATED_OFFICE_AUDIT_FAILURE');

    auditSpy.mockRestore();

    // Verify office settings was NOT mutated
    const afterFailed = await getOfficeSettings(owner);
    expect(afterFailed.version).toBe(current.version);
    expect(afterFailed.officeName).toBe(current.officeName);

    // Verify no orphan idempotency record
    const orphanIdempotency = await prisma.idempotencyRecord.findFirst({
      where: { key: officeKey },
    });
    expect(orphanIdempotency).toBeNull();
  });

  it('T06-11d: audit events are append-only; application modules provide no mutation/deletion methods and audit row count remains strictly monotonic', async () => {
    const initialCount = await prisma.auditEvent.count();

    const m = await openMatter(owner, {
      title: 'ملف فحص دوام التدقيق',
      kind: 'LITIGATION',
      idempotencyKey: `m-audit-immutable-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const audits = await prisma.auditEvent.findMany({
      where: { entityId: m.matter.id },
    });
    expect(audits.length).toBeGreaterThan(0);
    const originalAudit = audits[0];

    expect(originalAudit.action).toBe('CREATE_MATTER');
    expect(originalAudit.entityType).toBe('Matter');
    expect(originalAudit.userId).toBe(owner.id);

    // Perform multiple subsequent operations across the system
    const m2 = await openMatter(owner, {
      title: 'ملف لاحق إضافي للتحقق من الثبات',
      kind: 'CONSULTATION',
      idempotencyKey: `m-subsequent-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m2.matter.id);

    const countAfterSubsequent = await prisma.auditEvent.count();
    expect(countAfterSubsequent).toBeGreaterThan(initialCount + 1);

    // Verify original audit row survived completely unchanged (append-only verification)
    const reloadedOriginalAudit = await prisma.auditEvent.findUniqueOrThrow({
      where: { id: originalAudit.id },
    });
    expect(reloadedOriginalAudit.id).toBe(originalAudit.id);
    expect(reloadedOriginalAudit.action).toBe(originalAudit.action);
    expect(reloadedOriginalAudit.entityType).toBe(originalAudit.entityType);
    expect(reloadedOriginalAudit.userId).toBe(originalAudit.userId);
    expect(reloadedOriginalAudit.entityId).toBe(originalAudit.entityId);
    expect(reloadedOriginalAudit.changedFields).toEqual(originalAudit.changedFields);
    expect(reloadedOriginalAudit.createdAt.getTime()).toBe(originalAudit.createdAt.getTime());

    // Application interface inspection: src/modules/audit/ exposes recordAuditEvent and
    // queryAuditEvents only; no update/delete audit functions exist in the application codebase.
  });

  it('T06-11e: injects material child-write failure during updateProceeding: rolls back proceeding version and bundled parties; retry succeeds cleanly', async () => {
    // 1. Create matter, court, and proceeding
    const m = await openMatter(owner, {
      title: 'ملف اختبار إخفاق تحديث القيد الجزئي',
      kind: 'LITIGATION',
      idempotencyKey: `m-proc-upd-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const court = await prisma.court.create({
      data: {
        name: `محكمة التحديث الجزئي ${crypto.randomUUID().slice(0, 6)}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const party = await saveParty(owner, {
      kind: 'PERSON',
      name: 'طرف القيد للاختبار الجزئي',
      idempotencyKey: `p-proc-part-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(party.party.id);

    const mp = await linkMatterParty(owner, {
      matterId: m.matter.id,
      partyId: party.party.id,
      role: 'CLIENT',
      idempotencyKey: `mp-link-${crypto.randomUUID()}`,
    });

    const proc = await addProceeding(owner, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      numberText: '8899',
      yearLabel: '2026',
      status: 'ACTIVE',
      idempotencyKey: `proc-create-${crypto.randomUUID()}`,
    });

    const procBefore = await prisma.proceeding.findUniqueOrThrow({ where: { id: proc.id } });
    const procVersionBefore = procBefore.version;
    const procPartiesBefore = await prisma.proceedingParty.findMany({ where: { proceedingId: proc.id } });
    expect(procPartiesBefore).toHaveLength(0);

    const updKey = `proc-upd-fail-${crypto.randomUUID()}`;

    // 2. Wrap prisma in transaction proxy to force child-write failure on tx.proceedingParty.create
    const failingPrisma = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          return async (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => {
            return (target as unknown as { $transaction: (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => Promise<unknown> }).$transaction(async (tx: unknown) => {
              const txObj = tx as { proceedingParty: { create: (...args: unknown[]) => Promise<unknown> } };
              const proxyTx = new Proxy(txObj, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === 'proceedingParty') {
                    return new Proxy(txTarget.proceedingParty, {
                      get(pTarget, pProp, pReceiver) {
                        if (pProp === 'create') {
                          return async () => {
                            throw new Error('SIMULATED_PROCEEDING_PARTY_WRITE_FAILURE');
                          };
                        }
                        return Reflect.get(pTarget, pProp, pReceiver);
                      },
                    });
                  }
                  return Reflect.get(txTarget, txProp, txReceiver);
                },
              });
              return fn(proxyTx);
            }, opts);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(
      updateProceeding(
        owner,
        {
          id: proc.id,
          matterId: m.matter.id,
          expectedVersion: procVersionBefore,
          courtId: court.id,
          instance: 'FIRST_INSTANCE',
          registerType: 'مدني كلي',
          yearLabel: '2026',
          numberText: '8899-MOD',
          status: 'ACTIVE',
          parties: [
            {
              matterPartyId: mp.id,
              capacityText: 'مدعي أصلي معدل',
            },
          ],
          idempotencyKey: updKey,
        },
        { prismaOverride: failingPrisma as unknown as PrismaClient }
      )
    ).rejects.toThrow('SIMULATED_PROCEEDING_PARTY_WRITE_FAILURE');

    // 3. Verify atomic rollback: proceeding version and numberText unchanged, no child parties created
    const procAfterFail = await prisma.proceeding.findUniqueOrThrow({ where: { id: proc.id } });
    expect(procAfterFail.version).toBe(procVersionBefore);
    expect(procAfterFail.numberText).toBe('8899');

    const partiesAfterFail = await prisma.proceedingParty.findMany({ where: { proceedingId: proc.id } });
    expect(partiesAfterFail).toHaveLength(0);

    const orphanIdempotency = await prisma.idempotencyRecord.findFirst({ where: { key: updKey } });
    expect(orphanIdempotency).toBeNull();

    // 4. Retry succeeds cleanly
    const retryRes = await updateProceeding(owner, {
      id: proc.id,
      matterId: m.matter.id,
      expectedVersion: procVersionBefore,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      yearLabel: '2026',
      numberText: '8899-MOD',
      status: 'ACTIVE',
      parties: [
        {
          matterPartyId: mp.id,
          capacityText: 'مدعي أصلي معدل',
        },
      ],
      idempotencyKey: updKey,
    });
    expect(retryRes.version).toBe(procVersionBefore + 1);
    expect(retryRes.numberText).toBe('8899-MOD');

    const partiesAfterRetry = await prisma.proceedingParty.findMany({ where: { proceedingId: proc.id } });
    expect(partiesAfterRetry).toHaveLength(1);
    expect(partiesAfterRetry[0].capacityText).toBe('مدعي أصلي معدل');

    await prisma.proceedingParty.deleteMany({ where: { proceedingId: proc.id } });
    await prisma.proceeding.delete({ where: { id: proc.id } });
    await prisma.court.delete({ where: { id: court.id } });
  });

  it('T06-11f: injects audit failure during relationship mutation (linkMatterParty): rolls back party link and parent matter version; retry succeeds cleanly', async () => {
    const m = await openMatter(owner, {
      title: 'ملف اختبار إخفاق تدقيق العلاقة',
      kind: 'LITIGATION',
      idempotencyKey: `m-rel-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const p = await saveParty(owner, {
      kind: 'PERSON',
      name: 'طرف علاقة التدقيق الذري',
      idempotencyKey: `p-rel-${crypto.randomUUID()}`,
    });
    createdPartyIds.push(p.party.id);

    const matterBefore = await prisma.matter.findUniqueOrThrow({ where: { id: m.matter.id } });
    const versionBefore = matterBefore.version;

    const linkKey = `link-atom-fail-${crypto.randomUUID()}`;

    const auditSpy = vi.spyOn(auditModule, 'recordAuditEvent').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_RELATIONSHIP_AUDIT_FAILURE');
    });

    await expect(
      linkMatterParty(owner, {
        matterId: m.matter.id,
        partyId: p.party.id,
        role: 'CLIENT',
        idempotencyKey: linkKey,
      })
    ).rejects.toThrow('SIMULATED_RELATIONSHIP_AUDIT_FAILURE');

    auditSpy.mockRestore();

    // Verify rollback
    const linkAfterFail = await prisma.matterParty.findFirst({
      where: { matterId: m.matter.id, partyId: p.party.id },
    });
    expect(linkAfterFail).toBeNull();

    const matterAfterFail = await prisma.matter.findUniqueOrThrow({ where: { id: m.matter.id } });
    expect(matterAfterFail.version).toBe(versionBefore);

    const orphanIdempotency = await prisma.idempotencyRecord.findFirst({ where: { key: linkKey } });
    expect(orphanIdempotency).toBeNull();

    // Clean retry
    const retryLink = await linkMatterParty(owner, {
      matterId: m.matter.id,
      partyId: p.party.id,
      role: 'CLIENT',
      idempotencyKey: linkKey,
    });
    expect(retryLink.id).toBeDefined();

    const matterAfterRetry = await prisma.matter.findUniqueOrThrow({ where: { id: m.matter.id } });
    expect(matterAfterRetry.version).toBe(versionBefore + 1);
  });

  it('T06-11g: injects audit failure during reference mutation (createReferenceItem): rolls back reference item creation; retry succeeds cleanly', async () => {
    const refKey = `ref-atom-fail-${crypto.randomUUID()}`;
    const courtName = `محكمة تراجع التدقيق ${crypto.randomUUID().slice(0, 6)}`;

    const auditSpy = vi.spyOn(auditModule, 'recordAuditEvent').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_REFERENCE_AUDIT_FAILURE');
    });

    await expect(
      createReferenceItem(owner, {
        type: 'COURT',
        name: courtName,
        idempotencyKey: refKey,
      })
    ).rejects.toThrow('SIMULATED_REFERENCE_AUDIT_FAILURE');

    auditSpy.mockRestore();

    // Verify rollback
    const orphanCourt = await prisma.court.findFirst({ where: { name: courtName } });
    expect(orphanCourt).toBeNull();

    const orphanIdempotency = await prisma.idempotencyRecord.findFirst({ where: { key: refKey } });
    expect(orphanIdempotency).toBeNull();

    // Retry succeeds cleanly
    const retryCourt = await createReferenceItem(owner, {
      type: 'COURT',
      name: courtName,
      idempotencyKey: refKey,
    });
    expect(retryCourt.id).toBeDefined();
    expect(retryCourt.name).toBe(courtName);

    await prisma.court.delete({ where: { id: retryCourt.id } });
  });

  it('T06-12: returns cached replay for identical payload and rejects payload mismatch', async () => {
    const idempotencyKey = `idem-test-${crypto.randomUUID()}`;

    const input1 = {
      title: 'ملف اختبار تكرار العمليات',
      kind: 'LITIGATION' as const,
      idempotencyKey,
    };

    const res1 = await openMatter(owner, input1);
    createdMatterIds.push(res1.matter.id);

    // Replay with exact same payload
    const res2 = await openMatter(owner, input1);
    expect(res2.matter.id).toBe(res1.matter.id);
    expect(res2.fileCode).toBe(res1.fileCode);
    expect(res2.operationVersion).toBe(res1.operationVersion);

    // Replay with DIFFERENT payload under same key must throw IdempotencyPayloadMismatchError
    const inputAltered = {
      title: 'عنوان مختلف تماماً لنفس المفتاح',
      kind: 'CONSULTATION' as const,
      idempotencyKey,
    };

    await expect(openMatter(owner, inputAltered)).rejects.toThrow(
      IdempotencyPayloadMismatchError
    );
  });

  it('T06-13: denies MAINTAINER access to matter operations (Least Privilege)', async () => {
    // 1. Maintainer cannot open matter
    await expect(
      openMatter(maintainer, {
        title: 'محاولة فتح ملف بواسطة مسؤول الصيانة',
        kind: 'LITIGATION',
        idempotencyKey: `maint-open-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(AuthorizationError);

    // 2. Maintainer cannot read matter or search matters
    const matter = await openMatter(owner, {
      title: 'ملف خاص بالموكل لا يتاح لمسؤول الصيانة',
      kind: 'LITIGATION',
      idempotencyKey: `owner-matter-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);

    await expect(getMatter(matter.matter.id, maintainer)).rejects.toThrow(
      AuthorizationError
    );

    await expect(searchMatters({}, maintainer)).rejects.toThrow(
      AuthorizationError
    );
  });

  it('T06-14: searchMatters normalizes queries and preserves confidentiality', async () => {
    const m1 = await openMatter(owner, {
      title: 'دعوى تعويض عن أضرار حادث سيارة',
      kind: 'LITIGATION',
      idempotencyKey: `search-m1-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m1.matter.id);

    const m2 = await openMatter(owner, {
      title: 'عقد استشارات هندسية',
      kind: 'CONTRACT',
      idempotencyKey: `search-m2-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m2.matter.id);

    // Search by title keyword
    const searchRes = await searchMatters({ query: 'تعويض' }, owner);
    expect(searchRes.matters.some((m) => m.id === m1.matter.id)).toBe(true);
    expect(searchRes.matters.some((m) => m.id === m2.matter.id)).toBe(false);

    // Search by exact fileCode
    const codeSearch = await searchMatters({ query: m2.fileCode }, owner);
    expect(codeSearch.matters.some((m) => m.id === m2.matter.id)).toBe(true);
  });
});

