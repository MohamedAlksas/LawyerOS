import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  ADR_0003_POLICY_CODE,
  ADR_0003_POLICY_VERSION,
  DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
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
  expectTouchTarget,
  nextPaint,
} from '../helpers/t04-layout';
import {
  expectNoSensitiveValues,
  expectSessionCookiesHardened,
  sensitiveNeedles,
  snapshotCookies,
  snapshotStorage,
} from '../helpers/t04-storage';

/**
 * T11 E2E Browser Test Suite: Private Document Upload, ADR 0003 Validation, and Authorized Preview.
 *
 * Covers browser & HTTP acceptance cases:
 * - T11-TC-01: Valid PDF + PNG upload -> ready -> truthful "لم يُفحص ضد الفيروسات" -> preview + download matching SHA-256 + duplicate confirm (T11-TC-07)
 * - T11-TC-04: Disconnect/abort upload PUT mid-flight -> incomplete UI state -> restore & retry succeeds once
 * - T11-TC-05: Unauthenticated redirect / 401, MAINTAINER 403 UI/API, quarantined 409, private no-store & nosniff headers
 * - T11-TC-06: Multi-photo separate upload (no merge), disguised .jpg rejection, 1440/768/390px + 200% zoom, keyboard focus, & browser privacy
 */

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
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function buildValidSyntheticPng(r: number, g: number, b: number, width = 120, height = 80): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = 1 + width * 3;
  const rawPixels = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride;
    rawPixels[rowStart] = 0x00; // filter None
    const isBorder = y < 4 || y >= height - 4;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowStart + 1 + x * 3;
      const borderX = x < 4 || x >= width - 4;
      if (isBorder || borderX) {
        rawPixels[pxOffset] = 20;
        rawPixels[pxOffset + 1] = 86;
        rawPixels[pxOffset + 2] = 107;
      } else {
        rawPixels[pxOffset] = r & 0xff;
        rawPixels[pxOffset + 1] = g & 0xff;
        rawPixels[pxOffset + 2] = b & 0xff;
      }
    }
  }
  const idatData = zlib.deflateSync(rawPixels);
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idatData),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildSyntheticPdf(marker: string): Buffer {
  const content = [
    '%PDF-1.4',
    '1 0 obj',
    `<< /Type /Catalog /Marker (${marker}) >>`,
    'endobj',
    'trailer',
    '<< /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(content, 'ascii');
}

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function cleanupScopedT11Data(opts: {
  ownerIds?: string[];
  matterIds?: string[];
  partyIds?: string[];
  courtIds?: string[];
  documentIds?: string[];
  attemptIds?: string[];
}) {
  const storageRoot = path.resolve(process.cwd(), 'storage/t11-e2e');
  const storage = createLocalDocumentStorage(storageRoot);

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
  const allAttemptIds = new Set<string>(opts.attemptIds ?? []);
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

test.describe('T11 E2E: Private Document Upload, ADR 0003 Status & Authorized Preview', () => {
  const runId = randomUUID().slice(0, 6);
  let owner: T04Owner;
  let testCourtId: string;
  let testPartyId: string;

  const createdCourtIds: string[] = [];
  const createdPartyIds: string[] = [];

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: `t11-${runId}`, name: `أحمد المحامي T11 ${runId}` });

    const court = await prisma.court.create({
      data: {
        name: `محكمة جنوب القاهرة اختبار T11 ${runId}`,
        code: `T11E-${runId}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testCourtId = court.id;
    createdCourtIds.push(court.id);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `موكل أرشيف المستندات ${runId}`,
        nameNormalized: `موكل أرشيف المستندات ${runId}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testPartyId = party.id;
    createdPartyIds.push(party.id);
  });

  test.afterAll(async () => {
    await cleanupScopedT11Data({
      ownerIds: [owner.id],
      partyIds: createdPartyIds,
      courtIds: createdCourtIds,
    });
    await deleteT04Owner(owner.id);
  });

  test('T11-TC-01 & T11-TC-07: Valid PDF and PNG upload -> NOT_SCANNED_POLICY -> preview, matching SHA-256 download, and duplicate confirm @t11 @documents', async ({
    page,
  }) => {
    const localMatterIds: string[] = [];
    const localDocIds: string[] = [];

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-T11-${runId}-01`,
          title: `ملف مستندات التأسيس ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const proceeding = await prisma.proceeding.create({
        data: {
          matterId: matter.id,
          courtId: testCourtId,
          instance: 'FIRST_INSTANCE',
          numberText: `901-${runId}`,
          yearLabel: '2027',
          registerType: 'مدني كلي',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const pdfBuffer = buildSyntheticPdf(`T11-E2E-PDF-${runId}`);
      const pdfHash = sha256Hex(pdfBuffer);
      const pngBuffer = buildValidSyntheticPng(20, 86, 107);
      const pngHash = sha256Hex(pngBuffer);

      await signInWithTotp(page, owner);
      await page.goto('/');
      await expectShellReady(page);

      // Navigate via sidebar link to /documents
      await page.getByTestId('nav-link-documents').click();
      await expect(page).toHaveURL(/\/documents$/);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
      await expect(page.getByTestId('documents-adr0003-banner')).toContainText(
        UNSCANNED_POLICY_NOTICE_AR
      );

      // Open upload form and verify pre-selection limits notice
      await page.getByTestId('open-upload-form-button').click();
      await expect(page.getByTestId('document-upload-section')).toBeVisible();
      await expect(page.getByTestId('upload-limits-notice')).toContainText('25 ميجابايت');
      await expect(page.getByTestId('upload-limits-notice')).toContainText('PDF / JPEG / PNG');

      // 1) Upload valid PDF linked to Matter + Proceeding
      await page.getByTestId('upload-file-input').setInputFiles({
        name: `pleading_${runId}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });

      await expect(page.getByTestId('upload-title-input')).toHaveValue(`pleading ${runId}`);
      const pdfTitle = `صحيفة دعوى أصلية ${runId}`;
      await page.getByTestId('upload-title-input').fill(pdfTitle);
      await page.getByTestId('upload-matter-select').selectOption(matter.id);
      await page.getByTestId('upload-proceeding-select').selectOption(proceeding.id);
      await page.getByTestId('upload-type-select').selectOption('PLEADING');
      await page.getByTestId('upload-original-present-select').selectOption('YES');
      await page.getByTestId('upload-original-location-input').fill('خزينة الأصول — ملف 1');

      await page.getByTestId('upload-submit-button').click();

      await expect(page.getByTestId('queue-item-status-0')).toHaveText('جاهز');
      await expect(page.getByTestId('queue-item-scan-badge-0')).toContainText(
        UNSCANNED_POLICY_NOTICE_AR
      );
      await expect(page.getByTestId('queue-item-scan-badge-0')).not.toContainText('سليم');

      // Open detail view for uploaded PDF
      await page.getByTestId('queue-ready-link-0').click();
      await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
      const pdfDocId = page.url().split('/').pop()!;
      localDocIds.push(pdfDocId);

      await expect(page.getByTestId('document-detail-title')).toHaveText(pdfTitle);
      await expect(page.getByTestId('detail-scan-status-badge')).toContainText(
        UNSCANNED_POLICY_NOTICE_AR
      );
      await expect(page.getByTestId('detail-adr0003-notice')).toContainText(
        UNSCANNED_POLICY_NOTICE_AR
      );
      await expect(page.getByTestId('device-retention-notice')).toContainText(
        DOWNLOAD_DEVICE_RETENTION_NOTICE_AR
      );
      await expect(page.getByTestId('detail-sha256')).toContainText(pdfHash);
      await expect(page.getByTestId('document-preview-iframe')).toBeVisible();

      // Verify no raw objectKey or filesystem path leaked
      const detailText = await page.getByTestId('document-detail-view').innerText();
      expect(detailText).not.toContain('storage');
      expect(detailText).not.toContain('ready');

      // Verify inline preview headers and authorized download bytes match SHA-256
      const inlineRes = await page.request.get(
        `/api/documents/${pdfDocId}/content?disposition=inline`
      );
      expect(inlineRes.status()).toBe(200);
      expect(inlineRes.headers()['content-disposition']).toContain('inline');
      expect(inlineRes.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
      const xfo = inlineRes.headers()['x-frame-options'];
      if (xfo && xfo.toUpperCase() === 'DENY') {
        console.warn('[T11 OBSERVATION] /api/documents/[id]/content carries X-Frame-Options: DENY from next.config.ts');
      }

      const downloadRes = await page.request.get(
        `/api/documents/${pdfDocId}/content?disposition=attachment`
      );
      expect(downloadRes.status()).toBe(200);
      expect(downloadRes.headers()['cache-control']).toBe('private, no-store, max-age=0');
      expect(downloadRes.headers()['x-content-type-options']).toBe('nosniff');
      expect(downloadRes.headers()['content-type']).toBe('application/pdf');
      const downloadedPdfBuf = Buffer.from(await downloadRes.body());
      expect(sha256Hex(downloadedPdfBuf)).toBe(pdfHash);

      // 2) Return to /documents and upload valid PNG linked to Party with pre-upload preview
      await page.getByTestId('back-to-documents-link').click();
      await expect(page).toHaveURL(/\/documents$/);
      await page.getByTestId('open-upload-form-button').click();

      await page.getByTestId('upload-file-input').setInputFiles({
        name: `id_scan_${runId}.png`,
        mimeType: 'image/png',
        buffer: pngBuffer,
      });

      const queueImg = page.getByTestId('queue-image-preview-0');
      await expect(queueImg).toBeVisible();
      const preNaturalWidth = await queueImg.evaluate(
        (img) => (img as HTMLImageElement).naturalWidth
      );
      expect(preNaturalWidth).toBeGreaterThan(0);

      await page.getByRole('radio', { name: 'طرف / موكل' }).check();
      await page.getByTestId('upload-party-select').selectOption(testPartyId);
      const pngTitle = `صورة إثبات هوية ${runId}`;
      await page.getByTestId('upload-title-input').fill(pngTitle);
      await page.getByTestId('upload-type-select').selectOption('ID_COPY');

      await page.getByTestId('upload-submit-button').click();
      await expect(page.getByTestId('queue-item-status-0')).toHaveText('جاهز');
      await expect(page.getByTestId('queue-item-scan-badge-0')).toContainText(
        UNSCANNED_POLICY_NOTICE_AR
      );

      await page.getByTestId('queue-ready-link-0').click();
      await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
      const pngDocId = page.url().split('/').pop()!;
      localDocIds.push(pngDocId);

      const detailImg = page.getByTestId('document-preview-image');
      await expect(detailImg).toBeVisible();
      await expect
        .poll(() => detailImg.evaluate((img) => (img as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);

      const pngDownloadRes = await page.request.get(
        `/api/documents/${pngDocId}/content?disposition=attachment`
      );
      expect(pngDownloadRes.status()).toBe(200);
      expect(pngDownloadRes.headers()['content-type']).toBe('image/png');
      expect(sha256Hex(Buffer.from(await pngDownloadRes.body()))).toBe(pngHash);

      // 3) T11-TC-07: Duplicate checksum warning + explicit confirm separate copy
      await page.getByTestId('back-to-documents-link').click();
      await expect(page).toHaveURL(/\/documents$/);
      await page.getByTestId('open-upload-form-button').click();

      await page.getByTestId('upload-file-input').setInputFiles({
        name: `pleading_copy_${runId}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });
      await page.getByTestId('upload-matter-select').selectOption(matter.id);
      await page.getByTestId('upload-title-input').fill(`نسخة منفصلة ${runId}`);
      await page.getByTestId('upload-submit-button').click();

      await expect(page.getByTestId('queue-duplicate-warning-0')).toBeVisible();
      await expect(page.getByTestId('queue-duplicate-warning-0')).toContainText(pdfTitle);

      await page.getByTestId('queue-confirm-duplicate-0').click();
      await expect(page.getByTestId('queue-item-status-0')).toHaveText('جاهز');
      const dupHref = await page.getByTestId('queue-ready-link-0').getAttribute('href');
      expect(dupHref).toBeTruthy();
      const dupDocId = dupHref!.split('/').pop()!;
      expect(dupDocId).not.toBe(pdfDocId);
      localDocIds.push(dupDocId);
    } finally {
      await cleanupScopedT11Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
        documentIds: localDocIds,
      });
    }
  });

  test('T11-TC-04: Aborted upload PUT shows incomplete state without false success and recovers cleanly on retry @t11 @documents', async ({
    page,
  }) => {
    const localMatterIds: string[] = [];

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-T11-${runId}-04`,
          title: `ملف استرداد انقطاع الرفع ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const pdfBuffer = buildSyntheticPdf(`T11-TC04-RETRY-${runId}`);
      const retryTitle = `مذكرة اختبار الانقطاع ${runId}`;

      await signInWithTotp(page, owner);
      await page.goto('/documents');
      await expectShellReady(page);
      await page.getByTestId('open-upload-form-button').click();

      await page.getByTestId('upload-file-input').setInputFiles({
        name: `retry_${runId}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });
      await page.getByTestId('upload-matter-select').selectOption(matter.id);
      await page.getByTestId('upload-title-input').fill(retryTitle);

      // Abort the PUT /content request mid-flight to simulate network drop
      await page.route('**/api/documents/uploads/*/content', (route) => route.abort('failed'));
      await page.getByTestId('upload-submit-button').click();

      await expect(page.getByTestId('queue-item-status-0')).toHaveText('الرفع غير مكتمل');
      await expect(page.getByTestId('queue-item-error-0')).toContainText(
        'الاتصال انقطع، البيانات لسه ما اتحفظتش'
      );
      await expect(page.getByTestId('queue-retry-0')).toBeVisible();
      await expect(page.getByTestId('queue-ready-summary-0')).toHaveCount(0);

      // Verify zero READY documents were created in DB before retry
      const countBeforeRetry = await prisma.document.count({
        where: { matterId: matter.id, title: retryTitle },
      });
      expect(countBeforeRetry).toBe(0);

      // Restore connection and click retry
      await page.unroute('**/api/documents/uploads/*/content');
      await page.getByTestId('queue-retry-0').click();

      await expect(page.getByTestId('queue-item-status-0')).toHaveText('جاهز');
      await expect(page.getByTestId('queue-item-scan-badge-0')).toContainText(
        UNSCANNED_POLICY_NOTICE_AR
      );

      const countAfterRetry = await prisma.document.count({
        where: { matterId: matter.id, title: retryTitle },
      });
      expect(countAfterRetry).toBe(1);
    } finally {
      await cleanupScopedT11Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
      });
    }
  });

  test('T11-TC-05: Unauthenticated, MAINTAINER, and quarantined access boundaries + security headers @t11 @documents', async ({
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const localMatterIds: string[] = [];
    const localDocIds: string[] = [];
    const maintainerId = randomUUID();

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-T11-${runId}-05`,
          title: `ملف اختبار الصلاحيات ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const storageRoot = path.resolve(process.cwd(), 'storage/t11-e2e');
      const storage = createLocalDocumentStorage(storageRoot);
      const readyBytes = buildSyntheticPdf(`T11-AUTH-READY-${runId}`);
      const readyId = randomUUID();
      const readyVerId = randomUUID();
      const readyKey = storage.generateReadyKey(readyId, 1, '.pdf');
      const qKey = storage.generateQuarantineKey(randomUUID(), '.pdf');
      await storage.writeQuarantineStream(qKey, readyBytes);
      await storage.promoteToReady(qKey, readyKey);
      await storage.deleteQuarantine(qKey);

      await prisma.document.create({
        data: {
          id: readyId,
          matterId: matter.id,
          title: `مستند جاهز للصلاحيات ${runId}`,
          titleNormalized: `مستند جاهز للصلاحيات ${runId}`,
          documentType: 'CONTRACT',
          originalPresent: 'YES',
          sensitivity: 'CONFIDENTIAL',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      await prisma.documentVersion.create({
        data: {
          id: readyVerId,
          documentId: readyId,
          versionNumber: 1,
          objectKey: readyKey,
          originalFilename: 'auth_check.pdf',
          declaredMime: 'application/pdf',
          detectedMime: 'application/pdf',
          sizeBytes: readyBytes.length,
          sha256: sha256Hex(readyBytes),
          uploadStatus: 'READY',
          scanStatus: 'NOT_SCANNED_POLICY',
          scanPolicyCode: ADR_0003_POLICY_CODE,
          scanPolicyVersion: ADR_0003_POLICY_VERSION,
          scanCheckedAt: new Date(),
          createdById: owner.id,
        },
      });
      await prisma.document.update({
        where: { id: readyId },
        data: { currentVersionId: readyVerId },
      });
      localDocIds.push(readyId);

      // Seed one QUARANTINED document that must remain unavailable even to Owner
      const quarantinedId = randomUUID();
      const quarantinedVerId = randomUUID();
      await prisma.document.create({
        data: {
          id: quarantinedId,
          matterId: matter.id,
          title: `مستند قيد الحجر ${runId}`,
          titleNormalized: `مستند قيد الحجر ${runId}`,
          documentType: 'OTHER',
          originalPresent: 'UNKNOWN',
          sensitivity: 'CONFIDENTIAL',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      await prisma.documentVersion.create({
        data: {
          id: quarantinedVerId,
          documentId: quarantinedId,
          versionNumber: 1,
          objectKey: `v1/2027/01/quarantined-${quarantinedVerId}.pdf`,
          originalFilename: 'quarantined.pdf',
          declaredMime: 'application/pdf',
          detectedMime: 'application/pdf',
          sizeBytes: readyBytes.length,
          sha256: sha256Hex(readyBytes),
          uploadStatus: 'QUARANTINED',
          scanStatus: 'PENDING',
          createdById: owner.id,
        },
      });
      await prisma.document.update({
        where: { id: quarantinedId },
        data: { currentVersionId: quarantinedVerId },
      });
      localDocIds.push(quarantinedId);

      // 1) Unauthenticated browser checks
      const unauthCtx = await browser.newContext({ baseURL });
      const unauthPage = await unauthCtx.newPage();
      try {
        await unauthPage.goto('/documents');
        await expect(unauthPage).toHaveURL((u) => u.pathname === '/login');

        await unauthPage.goto(`/documents/${readyId}`);
        await expect(unauthPage).toHaveURL((u) => u.pathname === '/login');

        const contentUnauth = await unauthPage.request.get(
          `/api/documents/${readyId}/content?disposition=attachment`
        );
        expect(contentUnauth.status()).toBe(401);
        expect(contentUnauth.headers()['cache-control']).toBe('private, no-store');
        expect(contentUnauth.headers()['x-content-type-options']).toBe('nosniff');
      } finally {
        await unauthCtx.close();
      }

      // 2) MAINTAINER role checks
      const maintainerEmail = `t11.maintainer.${runId}.${maintainerId.slice(0, 6)}@office.test`;
      const maintainerPass = `MntT11!${runId}99`;
      const hashed = await hashPassword(maintainerPass);
      const { pool } = createValidatedTestPool();
      const client = await pool.connect();
      try {
        await client.query(
          'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, false, NOW(), NOW())',
          [maintainerId, 'مسؤول الصيانة T11', maintainerEmail, 'MAINTAINER']
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

        await maintPage.goto('/documents');
        await expect(maintPage.getByRole('heading', { level: 1 })).toHaveText('وصول مرفوض');

        await maintPage.goto(`/documents/${readyId}`);
        await expect(maintPage.getByRole('heading', { level: 1 })).toHaveText('وصول مرفوض');

        const maintContentApi = await maintPage.request.get(
          `/api/documents/${readyId}/content?disposition=attachment`
        );
        expect(maintContentApi.status()).toBe(403);
        expect(maintContentApi.headers()['cache-control']).toBe('private, no-store');
        expect(maintContentApi.headers()['x-content-type-options']).toBe('nosniff');

        const maintUploadApi = await maintPage.request.post('/api/documents/uploads', {
          headers: { Origin: baseURL, 'Content-Type': 'application/json' },
          data: {},
        });
        expect(maintUploadApi.status()).toBe(403);
      } finally {
        await maintCtx.close();
      }

      // 3) Owner can read READY content with hardened headers, while QUARANTINED returns 409
      const ownerCtx = await browser.newContext({ baseURL });
      const ownerPage = await ownerCtx.newPage();
      try {
        await signInWithTotp(ownerPage, owner);

        const readyContentRes = await ownerPage.request.get(
          `/api/documents/${readyId}/content?disposition=attachment`
        );
        expect(readyContentRes.status()).toBe(200);
        expect(readyContentRes.headers()['cache-control']).toBe('private, no-store, max-age=0');
        expect(readyContentRes.headers()['x-content-type-options']).toBe('nosniff');
        expect(readyContentRes.headers()['content-security-policy']).toContain(
          "frame-ancestors 'self'"
        );

        const quarantinedRes = await ownerPage.request.get(
          `/api/documents/${quarantinedId}/content?disposition=attachment`
        );
        expect(quarantinedRes.status()).toBe(409);
        expect(quarantinedRes.headers()['cache-control']).toBe('private, no-store');
      } finally {
        await ownerCtx.close();
      }
    } finally {
      await cleanupScopedT11Data({
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

  test('T11-TC-06: Multi-photo separate uploads, disguised .jpg rejection, filters, 390/768/1440px + 200% zoom, and privacy @t11 @documents @responsive @a11y', async ({
    page,
  }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1440;
    const tag = `${runId}-w${width}`;
    const secretMatterTitle = `ملف سري خاص بالمستندات ${tag}`;
    const screenshotDir = path.resolve(process.cwd(), 'test-results/t11');
    fs.mkdirSync(screenshotDir, { recursive: true });

    const localMatterIds: string[] = [];

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-2027-${tag}`,
          title: secretMatterTitle,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const photo1 = buildValidSyntheticPng(10, 120, 80);
      const photo2 = buildValidSyntheticPng(200, 50, 40);
      const disguisedJpg = Buffer.from(
        `This is plain text disguised as a JPEG image (${tag})`,
        'utf-8'
      );

      await signInWithTotp(page, owner);

      // Verify dashboard quick link to /documents
      await page.goto('/');
      await expectShellReady(page);
      await expect(page.getByTestId('dashboard-documents-link')).toBeVisible();
      await page.getByTestId('dashboard-documents-link').click();
      await expect(page).toHaveURL(/\/documents$/);

      // Verify navigation visibility on desktop sidebar / tablet drawer
      if (width >= 1024) {
        await expect(page.getByTestId('nav-link-documents')).toBeVisible();
        await expect(page.getByTestId('nav-link-documents')).toHaveAttribute(
          'aria-current',
          'page'
        );
      } else if (width >= 640) {
        await page.getByTestId('drawer-toggle-button').click();
        const drawer = page.getByTestId('tablet-drawer');
        await expect(drawer).toBeVisible();
        await expect(drawer.getByTestId('nav-link-documents')).toBeVisible();
        await page.getByTestId('drawer-close-button').click();
        await expect(drawer).toHaveCount(0);
      }

      // Open upload form
      const openUploadBtn = page.getByTestId('open-upload-form-button');
      await expectTouchTarget(openUploadBtn);
      await openUploadBtn.click();

      // Upload 2 valid PNG photos + 1 disguised .jpg together
      await page.getByTestId('upload-file-input').setInputFiles([
        {
          name: `evidence_1_${tag}.png`,
          mimeType: 'image/png',
          buffer: photo1,
        },
        {
          name: `evidence_2_${tag}.png`,
          mimeType: 'image/png',
          buffer: photo2,
        },
        {
          name: `disguised_${tag}.jpg`,
          mimeType: 'image/jpeg',
          buffer: disguisedJpg,
        },
      ]);

      await expect(page.getByTestId('upload-queue-item-0')).toBeVisible();
      await expect(page.getByTestId('upload-queue-item-1')).toBeVisible();
      await expect(page.getByTestId('upload-queue-item-2')).toBeVisible();

      // Verify legibility previews render for valid images before sending
      await expect
        .poll(() =>
          page
            .getByTestId('queue-image-preview-0')
            .evaluate((img) => (img as HTMLImageElement).naturalWidth)
        )
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          page
            .getByTestId('queue-image-preview-1')
            .evaluate((img) => (img as HTMLImageElement).naturalWidth)
        )
        .toBeGreaterThan(0);

      await page.getByTestId('upload-matter-select').selectOption(matter.id);
      await page.getByTestId('upload-title-input').fill(`مستند مرفق ${tag}`);
      await page.getByTestId('upload-type-select').selectOption('EVIDENCE');

      await page.getByTestId('upload-submit-button').click();

      // Photos remain 2 separate READY documents; disguised .jpg is REJECTED
      await expect(page.getByTestId('queue-item-status-0')).toHaveText('جاهز');
      await expect(page.getByTestId('queue-item-status-1')).toHaveText('جاهز');
      await expect(page.getByTestId('queue-item-status-2')).toHaveText('مرفوض');
      await expect(page.getByTestId('queue-item-error-2')).toContainText('محتوى الملف الفعلي');

      const readyLink0 = await page.getByTestId('queue-ready-link-0').getAttribute('href');
      const readyLink1 = await page.getByTestId('queue-ready-link-1').getAttribute('href');
      expect(readyLink0).toBeTruthy();
      expect(readyLink1).toBeTruthy();
      expect(readyLink0).not.toBe(readyLink1);

      // Verify exactly 2 separate Document rows in DB for this matter (not merged)
      const persistedDocs = await prisma.document.findMany({
        where: { matterId: matter.id },
        select: { id: true, title: true },
      });
      expect(persistedDocs).toHaveLength(2);

      // Verify layout at normal scale and capture documents list + queue screenshot
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      await page.screenshot({
        path: path.join(screenshotDir, `t11-documents-${width}.png`),
        fullPage: true,
      });

      // Verify keyboard focus indicator on filter search input
      const searchInput = page.getByTestId('documents-search-input');
      await searchInput.focus();
      await expect(searchInput).toBeFocused();
      const focusStyle = await searchInput.evaluate((el) => {
        const s = getComputedStyle(el);
        return { boxShadow: s.boxShadow, outlineStyle: s.outlineStyle };
      });
      expect(focusStyle.boxShadow !== 'none' || focusStyle.outlineStyle !== 'none').toBe(true);

      // Filter search & empty filtered state check
      await searchInput.fill(`غير-موجود-${tag}`);
      await page.getByTestId('documents-filter-submit').click();
      await expect(page.getByTestId('documents-empty-state')).toContainText(
        'لا توجد مستندات مطابقة حالياً'
      );

      await page.getByTestId('documents-clear-filters').click();
      await expect(page.getByTestId(`document-card-${persistedDocs[0].id}`)).toBeVisible();
      await expect(page.getByTestId(`document-card-${persistedDocs[1].id}`)).toBeVisible();

      // 200% text scaling check on /documents
      const baselineFontSize = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      );
      await page.addStyleTag({
        content: `html { font-size: ${baselineFontSize * 2}px !important; }`,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await nextPaint(page);
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      // Navigate to detail page and verify responsive + screenshot + 200% zoom
      await page.goto(readyLink0!);
      await expectShellReady(page);
      await expect(page.getByTestId('detail-scan-status-badge')).toContainText(
        UNSCANNED_POLICY_NOTICE_AR
      );
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));

      await page.screenshot({
        path: path.join(screenshotDir, `t11-document-detail-${width}.png`),
        fullPage: true,
      });

      // Privacy & cookie hardening assertions
      const cookies = await snapshotCookies(page);
      expectSessionCookiesHardened(cookies);
      const storage = await snapshotStorage(page);
      const rawCookies = await page.context().cookies();
      const needles = [
        ...sensitiveNeedles(owner, rawCookies),
        { label: 'secret matter title', value: secretMatterTitle },
        { label: 'secret doc title', value: `مستند مرفق ${tag}` },
      ];
      expectNoSensitiveValues(storage, needles);
    } finally {
      await cleanupScopedT11Data({
        ownerIds: [owner.id],
        matterIds: localMatterIds,
      });
    }
  });
});
