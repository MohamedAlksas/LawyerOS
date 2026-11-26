import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { test, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  ADR_0003_POLICY_CODE,
  ADR_0003_POLICY_VERSION,
  UNSCANNED_POLICY_NOTICE_AR,
  createLocalDocumentStorage,
} from '@/modules/documents';
import { seedT04Owner, deleteT04Owner, signInWithTotp, type T04Owner } from '../helpers/t04-auth';
import { cleanupTrackedFixtures, createValidatedTestPool } from '../helpers/test-db';
import { setupTestEncryptionKeys, cleanupPartyFixtures } from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import {
  expectNoElementOverflow,
  expectNoPageOverflow,
  expectShellReady,
  nextPaint,
} from '../helpers/t04-layout';
import {
  expectNoSensitiveValues,
  expectSessionCookiesHardened,
  sensitiveNeedles,
  snapshotCookies,
  snapshotStorage,
} from '../helpers/t04-storage';

const prisma = getPrismaClient();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function buildValidSyntheticPng(r: number, g: number, b: number, width = 100, height = 70): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = 1 + width * 3;
  const rawPixels = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride;
    rawPixels[rowStart] = 0x00;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowStart + 1 + x * 3;
      rawPixels[pxOffset] = r & 0xff;
      rawPixels[pxOffset + 1] = g & 0xff;
      rawPixels[pxOffset + 2] = b & 0xff;
    }
  }
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', zlib.deflateSync(rawPixels)),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildSyntheticPdf(marker: string): Buffer {
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj',
      `<< /Type /Catalog /Marker (${marker}) >>`,
      'endobj',
      'trailer',
      '<< /Root 1 0 R >>',
      'startxref',
      '9',
      '%%EOF',
      '',
    ].join('\n'),
    'ascii'
  );
}

function resolveE2EStorageRoot(): string {
  return process.env.DOCUMENTS_STORAGE_ROOT || path.resolve(process.cwd(), 'storage/t12-e2e');
}

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function seedReadyDocumentInDb(opts: {
  ownerId: string;
  matterId?: string | null;
  partyId?: string | null;
  proceedingId?: string | null;
  title: string;
  documentType?: DocumentType;
  originalPresent?: 'YES' | 'NO' | 'UNKNOWN';
  originalLocation?: string | null;
  versions: Array<{ filename: string; mime: 'application/pdf' | 'image/png'; bytes: Buffer }>;
}): Promise<{ documentId: string; versionIds: string[] }> {
  const storage = createLocalDocumentStorage(resolveE2EStorageRoot());
  const documentId = randomUUID();
  const versionIds: string[] = [];

  await prisma.document.create({
    data: {
      id: documentId,
      matterId: opts.matterId ?? null,
      partyId: opts.partyId ?? null,
      proceedingId: opts.proceedingId ?? null,
      title: opts.title,
      titleNormalized: opts.title,
      documentType: opts.documentType ?? 'CONTRACT',
      originalPresent: opts.originalPresent ?? 'UNKNOWN',
      originalLocation: opts.originalLocation ?? null,
      sensitivity: 'CONFIDENTIAL',
      createdById: opts.ownerId,
      updatedById: opts.ownerId,
    },
  });

  for (let i = 0; i < opts.versions.length; i++) {
    const v = opts.versions[i];
    const verId = randomUUID();
    const versionNumber = i + 1;
    const ext = v.mime === 'application/pdf' ? '.pdf' : '.png';
    const readyKey = storage.generateReadyKey(documentId, versionNumber, ext);
    await storage.writeReadyBytes(readyKey, v.bytes);

    await prisma.documentVersion.create({
      data: {
        id: verId,
        documentId,
        versionNumber,
        objectKey: readyKey,
        originalFilename: v.filename,
        declaredMime: v.mime,
        detectedMime: v.mime,
        sizeBytes: v.bytes.byteLength,
        sha256: sha256Hex(v.bytes),
        uploadStatus: 'READY',
        scanStatus: 'NOT_SCANNED_POLICY',
        scanPolicyCode: ADR_0003_POLICY_CODE,
        scanPolicyVersion: ADR_0003_POLICY_VERSION,
        scanCheckedAt: new Date(),
        createdById: opts.ownerId,
      },
    });
    versionIds.push(verId);
  }

  await prisma.document.update({
    where: { id: documentId },
    data: {
      currentVersionId: versionIds[versionIds.length - 1],
      version: opts.versions.length,
    },
  });

  return { documentId, versionIds };
}

async function cleanupScopedT12Data(opts: {
  ownerIds?: string[];
  matterIds?: string[];
  partyIds?: string[];
  courtIds?: string[];
  documentIds?: string[];
}) {
  const storage = createLocalDocumentStorage(resolveE2EStorageRoot());

  if (opts.matterIds && opts.matterIds.length > 0) {
    const [hearings, deadlines] = await Promise.all([
      prisma.hearing.findMany({
        where: { proceeding: { matterId: { in: opts.matterIds } } },
        select: { id: true },
      }),
      prisma.deadline.findMany({
        where: { matterId: { in: opts.matterIds } },
        select: { id: true },
      }),
    ]);
    const hearingIds = hearings.map((h) => h.id);
    const deadlineIds = deadlines.map((d) => d.id);
    if (hearingIds.length > 0) {
      await prisma.hearingResult.deleteMany({ where: { hearingId: { in: hearingIds } } });
      await prisma.jobRun.deleteMany({
        where: { sourceType: 'Hearing', sourceId: { in: hearingIds } },
      });
    }
    if (deadlineIds.length > 0) {
      await prisma.jobRun.deleteMany({
        where: { sourceType: 'Deadline', sourceId: { in: deadlineIds } },
      });
      await prisma.deadline.deleteMany({ where: { id: { in: deadlineIds } } });
    }
  }

  if (opts.partyIds && opts.partyIds.length > 0) {
    await prisma.powerOfAttorney.deleteMany({ where: { partyId: { in: opts.partyIds } } });
  }

  const docIds = new Set<string>(opts.documentIds ?? []);
  if (opts.matterIds && opts.matterIds.length > 0) {
    const matterDocs = await prisma.document.findMany({
      where: { matterId: { in: opts.matterIds } },
      select: { id: true },
    });
    for (const d of matterDocs) docIds.add(d.id);
  }
  if (opts.partyIds && opts.partyIds.length > 0) {
    const partyDocs = await prisma.document.findMany({
      where: { partyId: { in: opts.partyIds } },
      select: { id: true },
    });
    for (const d of partyDocs) docIds.add(d.id);
  }
  if (opts.ownerIds && opts.ownerIds.length > 0) {
    const ownerDocs = await prisma.document.findMany({
      where: { createdById: { in: opts.ownerIds } },
      select: { id: true },
    });
    for (const d of ownerDocs) docIds.add(d.id);
  }

  const allDocIds = Array.from(docIds);
  const allAttemptIds = new Set<string>();
  if (allDocIds.length > 0) {
    const linkedAttempts = await prisma.uploadAttempt.findMany({
      where: { documentId: { in: allDocIds } },
      select: { id: true },
    });
    for (const a of linkedAttempts) allAttemptIds.add(a.id);
  }
  if (opts.ownerIds && opts.ownerIds.length > 0) {
    const ownerAttempts = await prisma.uploadAttempt.findMany({
      where: { actorId: { in: opts.ownerIds } },
      select: { id: true },
    });
    for (const a of ownerAttempts) allAttemptIds.add(a.id);
  }

  const attemptIdList = Array.from(allAttemptIds);
  if (attemptIdList.length > 0) {
    const attempts = await prisma.uploadAttempt.findMany({
      where: { id: { in: attemptIdList } },
      select: { id: true, quarantineKey: true },
    });
    for (const attempt of attempts) {
      await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
    }
    await prisma.uploadAttempt.deleteMany({ where: { id: { in: attemptIdList } } });
  }

  if (allDocIds.length > 0) {
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: { in: allDocIds } },
      select: { id: true, objectKey: true },
    });
    const versionIds = versions.map((v) => v.id);
    if (versionIds.length > 0) {
      await prisma.backupFilePin.deleteMany({ where: { documentVersionId: { in: versionIds } } });
    }
    for (const ver of versions) {
      await storage.deleteReady(ver.objectKey).catch(() => false);
    }
    await prisma.document.updateMany({
      where: { id: { in: allDocIds } },
      data: { currentVersionId: null },
    });
    await prisma.documentVersion.deleteMany({ where: { documentId: { in: allDocIds } } });
    await prisma.document.deleteMany({ where: { id: { in: allDocIds } } });
  }

  const entityIds = [...allDocIds, ...attemptIdList, ...(opts.matterIds ?? [])];
  if (entityIds.length > 0) {
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: entityIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { resultId: { in: entityIds } } });
  }
  if (opts.ownerIds && opts.ownerIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: { in: opts.ownerIds } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: opts.ownerIds } } });
  }
  if (opts.matterIds && opts.matterIds.length > 0) {
    await cleanupMatterFixtures(prisma, opts.matterIds);
  }
  if (opts.partyIds && opts.partyIds.length > 0) {
    await cleanupPartyFixtures(prisma, opts.partyIds);
  }
  if (opts.courtIds && opts.courtIds.length > 0) {
    await cleanupReferenceFixtures(prisma, { courtIds: opts.courtIds });
  }
}

test.describe('T12 E2E: Document Versions, Paper Originals, Links & Search', () => {
  const runId = randomUUID().slice(0, 6);
  let owner: T04Owner;
  let testCourtId: string;

  const createdCourtIds: string[] = [];

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: `t12-${runId}`, name: `طارق المحامي T12 ${runId}` });

    const court = await prisma.court.create({
      data: {
        name: `محكمة القاهرة الابتدائية T12 ${runId}`,
        code: `T12E-${runId}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testCourtId = court.id;
    createdCourtIds.push(court.id);
  });

  test.afterAll(async () => {
    const storageRoot = resolveE2EStorageRoot();
    try {
      await cleanupScopedT12Data({
        ownerIds: owner?.id ? [owner.id] : [],
        courtIds: createdCourtIds,
      });
      if (owner?.id) {
        await deleteT04Owner(owner.id);
      }
    } finally {
      if (storageRoot && fs.existsSync(storageRoot)) {
        fs.rmSync(storageRoot, { recursive: true, force: true });
      }
    }
  });

  test('T12-TC-01 & T12-TC-03: Add v2, download v1 from history, and toggle originalPresent YES/location -> NO with intact scan @t12 @documents', async ({
    page,
  }) => {
    const localMatterIds: string[] = [];
    const localDocIds: string[] = [];

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-T12-${runId}-01`,
          title: `ملف إصدارات المستندات ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const v1Bytes = buildSyntheticPdf(`T12-E2E-V1-${runId}`);
      const v1Hash = sha256Hex(v1Bytes);
      const v2Bytes = buildValidSyntheticPng(20, 100, 130);
      const v2Hash = sha256Hex(v2Bytes);

      const seeded = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter.id,
        title: `عقد إدارة وتشغيل T12 ${runId}`,
        documentType: 'CONTRACT',
        originalPresent: 'UNKNOWN',
        originalLocation: null,
        versions: [{ filename: `contract_v1_${runId}.pdf`, mime: 'application/pdf', bytes: v1Bytes }],
      });
      localDocIds.push(seeded.documentId);
      const v1Id = seeded.versionIds[0];

      await signInWithTotp(page, owner);
      await page.goto(`/documents/${seeded.documentId}`);
      await expectShellReady(page);

      await expect(page.getByTestId('detail-current-version-badge')).toContainText('الإصدار الحالي: 1');
      await expect(page.getByTestId('detail-original-presence')).toContainText('غير معروف');
      await expect(page.getByTestId('version-scan-badge-1')).toContainText(UNSCANNED_POLICY_NOTICE_AR);

      // T12-TC-01: Add version 2 via UI
      await page.getByTestId('version-file-input').setInputFiles({
        name: `contract_v2_${runId}.png`,
        mimeType: 'image/png',
        buffer: v2Bytes,
      });
      await expect(page.getByTestId('version-candidate-status')).toHaveText('في قائمة الانتظار');
      await page.getByTestId('version-upload-submit').click();

      await expect(page.getByTestId('version-upload-success')).toContainText('الإصدار رقم 2');
      await expect(page.getByTestId('detail-current-version-badge')).toContainText('الإصدار الحالي: 2');
      await expect(page.getByTestId('detail-sha256')).toContainText(v2Hash);
      await expect(page.getByTestId('version-current-badge-2')).toHaveText('الحالي');
      await expect(page.getByTestId('version-scan-badge-2')).toContainText(UNSCANNED_POLICY_NOTICE_AR);
      await expect(page.getByTestId('version-scan-badge-1')).toContainText(UNSCANNED_POLICY_NOTICE_AR);

      // Preview & download v1 explicitly from history
      await page.getByTestId('version-preview-btn-1').click();
      await expect(page.getByTestId('preview-active-version-label')).toContainText('الإصدار رقم 1');
      await expect(page.getByTestId('preview-return-current-button')).toBeVisible();

      const v1Href = await page.getByTestId('version-download-link-1').getAttribute('href');
      expect(v1Href).toContain(`versionId=${v1Id}`);
      const v1DownloadRes = await page.request.get(v1Href!);
      expect(v1DownloadRes.status()).toBe(200);
      expect(sha256Hex(Buffer.from(await v1DownloadRes.body()))).toBe(v1Hash);

      await page.getByTestId('preview-return-current-button').click();
      await expect(page.getByTestId('preview-active-version-label')).toContainText('الإصدار رقم 2');

      // T12-TC-03: Update paper original state UNKNOWN -> YES + location -> NO while digital scan stays intact
      const locationText = `دولاب العقود الرئيسي — رف ${runId}`;
      await page.getByTestId('metadata-original-present-select').selectOption('YES');
      await page.getByTestId('metadata-original-location-input').fill(locationText);
      await page.getByTestId('metadata-save-button').click();

      await expect(page.getByTestId('metadata-save-success')).toBeVisible();
      await expect(page.getByTestId('detail-original-presence')).toContainText('موجود بالمكتب');
      await expect(page.getByTestId('detail-original-location')).toContainText(locationText);

      // Update to NO and clear location; digital v2 checksum & download bytes remain unchanged
      await page.getByTestId('metadata-original-present-select').selectOption('NO');
      await page.getByTestId('metadata-original-location-input').fill('');
      await page.getByTestId('metadata-save-button').click();

      await expect(page.getByTestId('metadata-save-success')).toBeVisible();
      await expect(page.getByTestId('detail-original-presence')).toContainText('غير موجود بالمكتب');
      await expect(page.getByTestId('detail-original-location')).toHaveCount(0);
      await expect(page.getByTestId('detail-sha256')).toContainText(v2Hash);

      const v2Href = await page.getByTestId('version-download-link-2').getAttribute('href');
      const v2DownloadRes = await page.request.get(v2Href!);
      expect(v2DownloadRes.status()).toBe(200);
      expect(sha256Hex(Buffer.from(await v2DownloadRes.body()))).toBe(v2Hash);
    } finally {
      await cleanupScopedT12Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        documentIds: localDocIds,
      });
    }
  });

  test('T12-TC-05: S12 unified search matches metadata only (not PDF body) and direct old-version download fails closed without permission @t12 @documents', async ({
    page,
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const localMatterIds: string[] = [];
    const localDocIds: string[] = [];
    const maintainerId = randomUUID();

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-T12-${runId}-05`,
          title: `ملف البحث الموحد للمستندات ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const bodyOnlyPhrase = `T12_BODY_ONLY_MARKER_${runId}_ZZ`;
      const docTitle = `مذكرة دفاع ختامية للبحث ${runId}`;
      const v1Pdf = buildSyntheticPdf(bodyOnlyPhrase);
      const v2Pdf = buildSyntheticPdf(`T12_V2_CLEAN_${runId}`);

      const seeded = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter.id,
        title: docTitle,
        documentType: 'MEMORANDUM',
        versions: [
          { filename: `memo_v1_${runId}.pdf`, mime: 'application/pdf', bytes: v1Pdf },
          { filename: `memo_v2_${runId}.pdf`, mime: 'application/pdf', bytes: v2Pdf },
        ],
      });
      localDocIds.push(seeded.documentId);
      const v1Id = seeded.versionIds[0];

      // 1) Owner searches on S12 /search by title -> finds document without exposing storage keys
      await signInWithTotp(page, owner);
      await page.goto('/search');
      await expectShellReady(page);

      await page.getByTestId('unified-search-input').fill(docTitle);
      await page.getByTestId('search-submit-button').click();

      await expect(page.getByTestId(`search-result-${seeded.documentId}`)).toBeVisible();
      await page.getByTestId('tab-document').click();
      await expect(page.getByTestId(`search-result-${seeded.documentId}`)).toBeVisible();

      const resultsText = await page.getByTestId('search-results-list').innerText();
      expect(resultsText).not.toContain('objectKey');
      expect(resultsText).not.toContain('quarantineKey');
      expect(resultsText).not.toContain('t12-e2e');

      // 2) PDF-body-only phrase returns zero results
      await page.getByTestId('unified-search-input').fill(bodyOnlyPhrase);
      await page.getByTestId('search-submit-button').click();
      await expect(page.getByTestId('empty-search-container')).toBeVisible();
      await expect(page.getByTestId(`search-result-${seeded.documentId}`)).toHaveCount(0);

      // 3) Unauthenticated direct historical download fails closed (401)
      const unauthCtx = await browser.newContext({ baseURL });
      const unauthPage = await unauthCtx.newPage();
      try {
        const unauthRes = await unauthPage.request.get(
          `/api/documents/${seeded.documentId}/content?versionId=${v1Id}&disposition=attachment`
        );
        expect(unauthRes.status()).toBe(401);
        expect(unauthRes.headers()['cache-control']).toBe('private, no-store');
      } finally {
        await unauthCtx.close();
      }

      // 4) MAINTAINER direct historical download fails closed (403)
      const maintainerEmail = `t12.maintainer.${runId}.${maintainerId.slice(0, 6)}@office.test`;
      const maintainerPass = `MntT12!${runId}99`;
      const hashed = await hashPassword(maintainerPass);
      const { pool } = createValidatedTestPool();
      const client = await pool.connect();
      try {
        await client.query(
          'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, false, NOW(), NOW())',
          [maintainerId, 'مسؤول الصيانة T12', maintainerEmail, 'MAINTAINER']
        );
        await client.query(
          'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
          [randomUUID(), maintainerId, 'credential', maintainerId, hashed]
        );
      } finally {
        client.release();
        await pool.end();
      }

      const maintCtx = await browser.newContext({ baseURL });
      const maintPage = await maintCtx.newPage();
      try {
        await maintPage.goto('/login');
        await maintPage.locator('#email').fill(maintainerEmail);
        await maintPage.locator('#password').fill(maintainerPass);
        await maintPage.locator('button[type="submit"]').click();
        await expect(maintPage).not.toHaveURL(/\/login(?:[/?]|$)/);

        const maintRes = await maintPage.request.get(
          `/api/documents/${seeded.documentId}/content?versionId=${v1Id}&disposition=attachment`
        );
        expect(maintRes.status()).toBe(403);
        expect(maintRes.headers()['cache-control']).toBe('private, no-store');
      } finally {
        await maintCtx.close();
      }
    } finally {
      await cleanupScopedT12Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        documentIds: localDocIds,
      });
      const { pool: cleanupPool } = createValidatedTestPool();
      try {
        await cleanupTrackedFixtures(cleanupPool, { userIds: [maintainerId] });
      } finally {
        await cleanupPool.end();
      }
    }
  });

  test('T12-TC-04 UI: Link READY documents from POA, Hearing Result, and Deadline forms without auto-approval @t12 @documents', async ({
    page,
  }) => {
    const localMatterIds: string[] = [];
    const localPartyIds: string[] = [];
    const localDocIds: string[] = [];

    try {
      const party = await prisma.party.create({
        data: {
          kind: 'PERSON',
          name: `موكل ربط المستندات T12 ${runId}`,
          nameNormalized: `موكل ربط المستندات T12 ${runId}`,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localPartyIds.push(party.id);

      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-T12-${runId}-04`,
          title: `قضية ربط المستندات ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
          parties: {
            create: {
              partyId: party.id,
              role: 'CLIENT',
              isPrimaryContact: true,
              createdById: owner.id,
              updatedById: owner.id,
            },
          },
        },
      });
      localMatterIds.push(matter.id);

      const proceeding = await prisma.proceeding.create({
        data: {
          matterId: matter.id,
          courtId: testCourtId,
          instance: 'FIRST_INSTANCE',
          numberText: `5501-${runId}`,
          yearLabel: '2027',
          registerType: 'مدني كلي',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const hearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date('2027-09-10T00:00:00.000Z'),
          status: 'SCHEDULED',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const poaDoc = await seedReadyDocumentInDb({
        ownerId: owner.id,
        partyId: party.id,
        title: `صورة توكيل الموكل ${runId}`,
        documentType: 'POA_COPY',
        versions: [
          {
            filename: `poa_${runId}.pdf`,
            mime: 'application/pdf',
            bytes: buildSyntheticPdf(`T12-POA-DOC-${runId}`),
          },
        ],
      });
      localDocIds.push(poaDoc.documentId);

      const decisionDoc = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter.id,
        proceedingId: proceeding.id,
        title: `صورة محضر قرار الجلسة ${runId}`,
        documentType: 'JUDGMENT',
        versions: [
          {
            filename: `decision_${runId}.pdf`,
            mime: 'application/pdf',
            bytes: buildSyntheticPdf(`T12-DECISION-DOC-${runId}`),
          },
        ],
      });
      localDocIds.push(decisionDoc.documentId);

      await signInWithTotp(page, owner);

      // 1) Link POA document on /parties/[id] -> remains UNREVIEWED
      await page.goto(`/parties/${party.id}`);
      await expectShellReady(page);
      await page.getByTestId('add-poa-button').click();
      await page.getByTestId('poa-number-input').fill(`0909-${runId}`);
      await page.getByTestId('poa-year-input').fill('2027');
      await page.getByTestId('poa-office-input').fill('مكتب توثيق مصر الجديدة');
      await page.getByTestId('poa-type-select').selectOption('GENERAL');
      await page.getByTestId('poa-document-select').selectOption(poaDoc.documentId);
      await page.getByTestId('save-poa-button').click();

      const poaRow = page.getByTestId('poa-item').first();
      await expect(poaRow).toBeVisible();
      await expect(poaRow.getByTestId('poa-review-status-badge')).toHaveText('قيد المراجعة');
      const savedPoa = await prisma.powerOfAttorney.findFirstOrThrow({
        where: { partyId: party.id, poaNumberText: `0909-${runId}` },
      });
      await expect(page.getByTestId(`poa-linked-document-${savedPoa.id}`)).toHaveAttribute(
        'href',
        `/documents/${poaDoc.documentId}`
      );

      // 2) Link decision document on /hearings/[id]/result
      await page.goto(`/hearings/${hearing.id}/result`);
      await expectShellReady(page);
      await page
        .getByTestId('hearing-decision-textarea')
        .fill(`حكم تمهيدي مرفق به صورة القرار ${runId}`);
      await page.getByTestId('hearing-decision-document-select').selectOption(decisionDoc.documentId);
      await page.getByText('لا توجد جلسة أخرى (حكم منهي للخصومة)').click();
      await page.getByTestId('save-hearing-result-btn').click();

      await expect(page.getByTestId('save-success-banner')).toBeVisible();
      await expect(page.getByTestId('hearing-decision-document-link').first()).toHaveAttribute(
        'href',
        `/documents/${decisionDoc.documentId}`
      );

      // 3) Link source document on /deadlines as DRAFT -> remains DRAFT
      await page.goto('/deadlines');
      await expectShellReady(page);
      await page.getByTestId('new-deadline-button').click();
      const deadlineTitle = `ميعاد طعن مرتبط بمستند ${runId}`;
      await page.getByTestId('deadline-title-input').fill(deadlineTitle);
      await page.getByTestId('deadline-matter-select').selectOption(matter.id);
      const docSelect = page.getByTestId('deadline-source-document-select');
      await expect(docSelect.locator(`option[value="${decisionDoc.documentId}"]`)).toHaveCount(1);
      await docSelect.selectOption(decisionDoc.documentId);
      await page.getByTestId('save-deadline-draft-button').click();

      await expect(page.getByTestId('deadline-status-notice')).toBeVisible();
      const savedDeadline = await prisma.deadline.findFirstOrThrow({
        where: { matterId: matter.id, title: deadlineTitle },
      });
      await expect(page.getByTestId(`deadline-status-badge-${savedDeadline.id}`)).toHaveText(
        'مسودة تحتاج مراجعة'
      );
      await expect(
        page.getByTestId(`deadline-source-document-link-${savedDeadline.id}`)
      ).toHaveAttribute('href', `/documents/${decisionDoc.documentId}`);
    } finally {
      await cleanupScopedT12Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        partyIds: localPartyIds,
        documentIds: localDocIds,
      });
    }
  });

  test('T12-TC-07: Keyboard nav, failed candidate Arabic error preserving prior version, 390/768/1440px + 200% zoom, and privacy @t12 @documents @responsive @a11y', async ({
    page,
  }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1440;
    const tag = `${runId}-w${width}`;
    const screenshotDir = path.resolve(process.cwd(), 'test-results/t12');
    fs.mkdirSync(screenshotDir, { recursive: true });

    const localMatterIds: string[] = [];
    const localDocIds: string[] = [];

    try {
      const matterTitle = `ملف صلاحية الإتاحة T12 ${tag}`;
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-${tag}`,
          title: matterTitle,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const v1Bytes = buildSyntheticPdf(`T12-TC07-V1-${tag}`);
      const v2Bytes = buildValidSyntheticPng(15, 95, 115);
      const docTitle = `مستند سجل الإصدارات المتجاوب ${tag}`;
      const seeded = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter.id,
        title: docTitle,
        originalPresent: 'YES',
        originalLocation: 'خزينة 1',
        versions: [
          { filename: `v1_${tag}.pdf`, mime: 'application/pdf', bytes: v1Bytes },
          { filename: `v2_${tag}.png`, mime: 'image/png', bytes: v2Bytes },
        ],
      });
      localDocIds.push(seeded.documentId);

      await signInWithTotp(page, owner);
      await page.goto(`/documents/${seeded.documentId}`);
      await expectShellReady(page);

      // Keyboard navigation: focus version 1 preview button and press Enter
      const previewV1Btn = page.getByTestId('version-preview-btn-1');
      await previewV1Btn.focus();
      await expect(previewV1Btn).toBeFocused();
      await previewV1Btn.press('Enter');
      await expect(page.getByTestId('preview-active-version-label')).toContainText('الإصدار رقم 1');

      // Keyboard navigation: focus original location editor and save via Enter on save button
      const originalLocationInput = page.getByTestId('metadata-original-location-input');
      await originalLocationInput.focus();
      await expect(originalLocationInput).toBeFocused();
      await originalLocationInput.fill(`خزينة 2 — ${tag}`);
      const saveMetaBtn = page.getByTestId('metadata-save-button');
      await saveMetaBtn.focus();
      await expect(saveMetaBtn).toBeFocused();
      await saveMetaBtn.press('Enter');
      await expect(page.getByTestId('metadata-save-success')).toBeVisible();

      // Simulate failed version validation (disguised .jpg) -> Arabic error while prior versions remain accessible
      await page.getByTestId('version-file-input').setInputFiles({
        name: `disguised_${tag}.jpg`,
        mimeType: 'image/jpeg',
        buffer: Buffer.from(`Plain text disguised as JPEG (${tag})`, 'utf-8'),
      });
      await page.getByTestId('version-upload-submit').click();

      await expect(page.getByTestId('version-candidate-status')).toHaveText('مرفوض');
      await expect(page.getByTestId('version-candidate-error')).toContainText('تعذر اعتماد الملف');
      await expect(page.getByTestId('version-candidate-error')).toContainText(
        'لم يتم المساس بالإصدار الحالي المعتمد'
      );

      // Prior versions stay accessible
      await expect(page.getByTestId('detail-current-version-badge')).toContainText('الإصدار الحالي: 2');
      await expect(page.getByTestId('version-download-link-1')).toBeVisible();
      await expect(page.getByTestId('version-download-link-2')).toBeVisible();

      // Normal scale overflow check + screenshot
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));
      await page.screenshot({
        path: path.join(screenshotDir, `t12-document-detail-${width}.png`),
        fullPage: true,
      });

      // 200% text scaling check with zero overflow
      const baseFontSize = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      );
      await page.addStyleTag({
        content: `html { font-size: ${baseFontSize * 2}px !important; }`,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await nextPaint(page);
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      // Privacy & session cookie hardening checks
      const cookies = await snapshotCookies(page);
      expectSessionCookiesHardened(cookies);
      const storageSnap = await snapshotStorage(page);
      const rawCookies = await page.context().cookies();
      expectNoSensitiveValues(storageSnap, [
        ...sensitiveNeedles(owner, rawCookies),
        { label: 'secret matter title', value: matterTitle },
        { label: 'secret doc title', value: docTitle },
      ]);
    } finally {
      await cleanupScopedT12Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        documentIds: localDocIds,
      });
    }
  });
});
