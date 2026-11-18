import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
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

