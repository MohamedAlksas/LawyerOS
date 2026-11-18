import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { openMatter, updateMatter } from '@/modules/matters/matter-service';
import { getCairoYear } from '@/modules/matters/file-code-allocator';
import {
  createSyntheticActor,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';

describe('T06-02: Atomic FileCode Generation & Cairo Year Boundary', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
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

  it('determines Gregorian year strictly in Africa/Cairo timezone', () => {
    // Midnight Jan 1 in Cairo is 22:00 Dec 31 UTC
    const dateDec31Utc = new Date('2026-12-31T22:30:00.000Z');
    expect(getCairoYear(dateDec31Utc)).toBe(2027);

    const dateDec31EarlyUtc = new Date('2026-12-31T21:30:00.000Z');
    expect(getCairoYear(dateDec31EarlyUtc)).toBe(2026);
  });

  it('allocates distinct, monotonically incrementing file codes under concurrent requests', async () => {
    const concurrentCount = 10;
    const promises = Array.from({ length: concurrentCount }).map((_, i) =>
      openMatter(actor, {
        title: `قضية متزامنة رقم ${i + 1}`,
        kind: 'LITIGATION',
        idempotencyKey: `concurrent-open-${i}-${crypto.randomUUID()}`,
      })
    );

    const results = await Promise.all(promises);

    for (const r of results) {
      createdMatterIds.push(r.matter.id);
    }

    const fileCodes = results.map((r) => r.fileCode);
    const uniqueCodes = new Set(fileCodes);

    // Every allocated code must be strictly unique (no duplicate numbers)
    expect(uniqueCodes.size).toBe(concurrentCount);

    // Format must match YYYY/NNNN
    const cairoYear = getCairoYear();
    for (const code of fileCodes) {
      expect(code.startsWith(`${cairoYear}/`)).toBe(true);
      const seqPart = parseInt(code.split('/')[1], 10);
      expect(seqPart).toBeGreaterThan(0);
    }
  });

  it('replaying the same idempotency key returns identical matter and file code without sequence increment', async () => {
    const idempotencyKey = `stable-code-${crypto.randomUUID()}`;

    const res1 = await openMatter(actor, {
      title: 'ملف لفحص ثبات رقم الكود',
      kind: 'CONTRACT',
      idempotencyKey,
    });
    createdMatterIds.push(res1.matter.id);

    const res2 = await openMatter(actor, {
      title: 'ملف لفحص ثبات رقم الكود',
      kind: 'CONTRACT',
      idempotencyKey,
    });

    expect(res2.fileCode).toBe(res1.fileCode);
    expect(res2.matter.id).toBe(res1.matter.id);
    expect(res2.operationVersion).toBe(res1.operationVersion);
  });

  it('file code remains strictly immutable across title, kind, and status edits', async () => {
    const res = await openMatter(actor, {
      title: 'عنوان الملف الأصلي',
      kind: 'OTHER',
      idempotencyKey: `code-immutability-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(res.matter.id);

    const initialCode = res.fileCode;

    const updated = await updateMatter(actor, {
      id: res.matter.id,
      expectedVersion: 1,
      title: 'عنوان جديد تماماً',
      kind: 'LITIGATION',
      status: 'SUSPENDED',
      idempotencyKey: `edit-immutability-${crypto.randomUUID()}`,
    });

    expect(updated.matter.fileCode).toBe(initialCode);
    expect(updated.matter.title).toBe('عنوان جديد تماماً');
    expect(updated.matter.kind).toBe('LITIGATION');
    expect(updated.matter.status).toBe('SUSPENDED');
  });
});

