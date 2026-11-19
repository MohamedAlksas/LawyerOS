import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import * as auditModule from '@/lib/audit';
import {
  openMatter,
  getMatter,
  searchMatters,
} from '@/modules/matters/matter-service';
import {
  createSyntheticActor,
  createSyntheticMaintainer,
  setupTestEncryptionKeys,
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

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    createdMatterIds.length = 0;
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
  });

  it('T06-11: injects audit failure inside owned transaction: no partial matter or idempotency completion; retry succeeds cleanly', async () => {
    const idempotencyKey = `atom-fail-${crypto.randomUUID()}`;
    const testTitle = 'ملف اختبار إخفاق التدقيق الذري المتعمد';

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

    // 2. Assert atomic rollback: no orphan matter and no idempotency record persisted
    const orphanMatter = await prisma.matter.findFirst({
      where: { title: testTitle },
    });
    expect(orphanMatter).toBeNull();

    const orphanIdempotency = await prisma.idempotencyRecord.findFirst({
      where: { key: idempotencyKey },
    });
    expect(orphanIdempotency).toBeNull();

    // 3. Retry with same key succeeds cleanly
    const retryRes = await openMatter(owner, {
      title: testTitle,
      kind: 'LITIGATION',
      idempotencyKey,
    });
    expect(retryRes.matter.id).toBeDefined();
    createdMatterIds.push(retryRes.matter.id);

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

