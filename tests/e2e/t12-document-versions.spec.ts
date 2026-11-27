import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { test, expect } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { getPrismaClient } from '@/lib/auth';
import { normalizeArabicText } from '@/lib/normalization';
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
  expectNotCovered,
  expectScrollSettledAndNotCovered,
  expectShellReady,
  expectTouchTarget,
  expectVisibleFocus,
  nextPaint,
  tabToTestId,
} from '../helpers/t04-layout';
import {
  expectNoSensitiveValues,
  expectSessionCookiesHardened,
  sensitiveNeedles,
  snapshotCookies,
  snapshotStorage,
} from '../helpers/t04-storage';
import { buildSyntheticPdf, buildSyntheticPng } from '../helpers/synthetic-files';
import { formatCairoOffsetYmd, getCairoYear } from '../helpers/cairo-test-date';

const prisma = getPrismaClient();

function resolveE2EStorageRoot(): string {
  return (
    process.env.T12_E2E_STORAGE_ROOT ||
    process.env.DOCUMENTS_STORAGE_ROOT ||
    path.join(os.tmpdir(), 'lawoffice-t12-e2e')
  );
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
      titleNormalized: normalizeArabicText(opts.title),
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
    await cleanupScopedT12Data({
      ownerIds: owner?.id ? [owner.id] : [],
      courtIds: createdCourtIds,
    });
    if (owner?.id) {
      await deleteT04Owner(owner.id);
    }
  });

  test('T12-TC-01 & T12-TC-03: Add v2, download v1 from history, preserve dirty metadata, retry duplicate confirm, and toggle originalPresent @t12 @documents', async ({
    page,
  }) => {
    const localMatterIds: string[] = [];
    const localDocIds: string[] = [];
    const currentYear = String(getCairoYear());

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-${currentYear}-T12-${runId}-01`,
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
      const v2Bytes = buildSyntheticPng({ r: 20, g: 100, b: 130 });
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

      // Make dirty unsaved metadata edit before v2 upload completes to verify dirty state is preserved
      const unsavedDraftNote = `مسودة وصف غير محفوظة ${runId}`;
      await page.getByTestId('metadata-description-input').fill(unsavedDraftNote);

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
      await expect(page.getByTestId('metadata-description-input')).toHaveValue(unsavedDraftNote);
      await page.getByTestId('metadata-reset-button').click();
      await expect(page.getByTestId('metadata-description-input')).toHaveValue('');

      // Preview & download v1 explicitly from history
      await page.getByTestId('version-preview-btn-1').click();
      await expect(page.getByTestId('preview-active-version-label')).toContainText('الإصدار رقم 1');
      await expect(page.getByTestId('preview-version-scan-badge')).toContainText(UNSCANNED_POLICY_NOTICE_AR);
      await expect(page.getByTestId('document-preview-iframe')).toHaveAttribute(
        'src',
        new RegExp(`versionId=${v1Id}`)
      );
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

      // Browser 409 conflict UX test on DocumentDetailView:
      // Edit metadata fields, simulate CONCURRENCY_CONFLICT 409 on PATCH, verify error banner and preserved inputs, then recover with metadata-conflict-refresh
      let triggerConflictOnce = true;
      await page.route(`**/api/documents/${seeded.documentId}`, async (route) => {
        if (triggerConflictOnce && route.request().method() === 'PATCH') {
          triggerConflictOnce = false;
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              code: 'CONCURRENCY_CONFLICT',
              error: 'تم تعديل بيانات المستند من جلسة أخرى. حدّث بيانات المستند ثم أعد المحاولة.',
            }),
          });
          return;
        }
        await route.continue();
      });

      const conflictTitle = `عنوان معدل أثناء التعارض ${runId}`;
      const conflictLocation = `خزينة النزاع رقم 9 — ${runId}`;
      await page.getByTestId('metadata-title-input').fill(conflictTitle);
      await page.getByTestId('metadata-original-location-input').fill(conflictLocation);
      await page.getByTestId('metadata-save-button').click();

      await expect(page.getByTestId('metadata-save-error')).toBeVisible();
      await expect(page.getByTestId('metadata-save-error')).toContainText(
        'تم تعديل بيانات المستند من جلسة أخرى'
      );
      // Verify unsaved form inputs are preserved
      await expect(page.getByTestId('metadata-title-input')).toHaveValue(conflictTitle);
      await expect(page.getByTestId('metadata-original-location-input')).toHaveValue(conflictLocation);

      const conflictRefreshBtn = page.getByTestId('metadata-conflict-refresh');
      await expect(conflictRefreshBtn).toBeVisible();
      await conflictRefreshBtn.click();
      await expect(page.getByTestId('metadata-save-error')).toHaveCount(0);
      await page.unroute(`**/api/documents/${seeded.documentId}`);

      // Duplicate-confirm retry after INCOMPLETE failure preserves confirmDuplicate: true & same idempotencyKey
      await page.getByTestId('version-file-input').setInputFiles({
        name: `contract_v3_dup_${runId}.pdf`,
        mimeType: 'application/pdf',
        buffer: v1Bytes,
      });
      await page.getByTestId('version-upload-submit').click();
      await expect(page.getByTestId('version-duplicate-warning')).toBeVisible();

      const confirmPayloads: Array<{ confirmDuplicate?: boolean; idempotencyKey?: string }> = [];
      let failDuplicateOnce = true;
      await page.route('**/api/documents/uploads/*/finalize', async (route) => {
        if (route.request().method() === 'POST') {
          const parsed = route.request().postDataJSON() as {
            confirmDuplicate?: boolean;
            idempotencyKey?: string;
          };
          confirmPayloads.push(parsed);
          if (failDuplicateOnce) {
            failDuplicateOnce = false;
            await route.abort('failed');
            return;
          }
        }
        await route.continue();
      });

      await page.getByTestId('version-confirm-duplicate').click();
      await expect(page.getByTestId('version-candidate-status')).toHaveText('الرفع غير مكتمل');
      await page.getByTestId('version-upload-retry').click();
      await expect(page.getByTestId('version-upload-success')).toContainText('الإصدار رقم 3');
      await expect(page.getByTestId('detail-current-version-badge')).toContainText('الإصدار الحالي: 3');
      await page.unroute('**/api/documents/uploads/*/finalize');

      expect(confirmPayloads).toHaveLength(2);
      expect(confirmPayloads[0].confirmDuplicate).toBe(true);
      expect(confirmPayloads[1].confirmDuplicate).toBe(true);
      expect(confirmPayloads[1].idempotencyKey).toBe(confirmPayloads[0].idempotencyKey);
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
    const currentYear = String(getCairoYear());

    try {
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-${currentYear}-T12-${runId}-05`,
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

      const searchActionResPromise = page.waitForResponse(
        (res) => res.url().endsWith('/search') && res.request().method() === 'POST'
      );
      await page.getByTestId('unified-search-input').fill(docTitle);
      await page.getByTestId('search-submit-button').click();
      const searchActionRes = await searchActionResPromise;
      expect(searchActionRes.status()).toBe(200);
      const searchActionBody = await searchActionRes.text();
      expect(searchActionBody).not.toContain('objectKey');
      expect(searchActionBody).not.toContain('quarantineKey');
      expect(searchActionBody).not.toContain('t12-e2e');

      await expect(page.getByTestId(`search-result-${seeded.documentId}`)).toBeVisible();
      await page.getByTestId('tab-document').click();
      await expect(page.getByTestId(`search-result-${seeded.documentId}`)).toBeVisible();

      const resultsText = await page.getByTestId('search-results-list').innerText();
      expect(resultsText).not.toContain('objectKey');
      expect(resultsText).not.toContain('quarantineKey');
      expect(resultsText).not.toContain('t12-e2e');

      // 1b) Owner visits /documents, performs filter search, verify ?q= is kept OUT of browser URL
      await page.goto('/documents');
      await expectShellReady(page);
      await expect(page.getByTestId('open-upload-form-button')).toBeVisible();
      const docsSearchInput = page.getByTestId('documents-search-input');
      await docsSearchInput.fill(docTitle);
      await page.getByTestId('documents-filter-submit').click();
      await expect(page.getByTestId(`document-card-${seeded.documentId}`)).toBeVisible();
      expect(page.url()).not.toContain('?q=');
      expect(page.url()).not.toContain('&q=');

      // 2) PDF-body-only phrase returns zero results
      await page.goto('/search');
      await expectShellReady(page);
      await page.getByTestId('unified-search-input').fill(bodyOnlyPhrase);
      await page.getByTestId('search-submit-button').click();
      await expect(page.getByTestId('empty-search-container')).toBeVisible();
      await expect(page.getByTestId(`search-result-${seeded.documentId}`)).toHaveCount(0);

      // 2b) Cross-document ?versionId= fails closed (404) even for authorized Owner
      const otherDoc = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter.id,
        title: `مستند آخر لفحص التطابق ${runId}`,
        documentType: 'CONTRACT',
        versions: [
          {
            filename: `other_v1_${runId}.pdf`,
            mime: 'application/pdf',
            bytes: buildSyntheticPdf(`T12-OTHER-DOC-${runId}`),
          },
        ],
      });
      localDocIds.push(otherDoc.documentId);
      const crossDocRes = await page.request.get(
        `/api/documents/${seeded.documentId}/content?versionId=${otherDoc.versionIds[0]}`
      );
      expect(crossDocRes.status()).toBe(404);
      expect(crossDocRes.headers()['cache-control']).toBe('private, no-store');

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

        // MAINTAINER is also denied on /search
        await maintPage.goto('/search');
        await expectShellReady(maintPage);
        await expect(maintPage.getByText('وصول مرفوض')).toBeVisible();
        await expect(maintPage.getByText('لا تمتلك الصلاحيات الكافية لاستخدام البحث الموحد.')).toBeVisible();
        await expect(maintPage.getByTestId(`search-result-${seeded.documentId}`)).toHaveCount(0);

        // MAINTAINER visits /documents: open-upload-form-button is hidden because !canWriteDocuments
        await maintPage.goto('/documents');
        await expectShellReady(maintPage);
        await expect(maintPage.getByTestId('open-upload-form-button')).toHaveCount(0);
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

  test('T12-TC-04 UI: Link READY documents from POA, Hearing Result, and Deadline forms, preserve archived links, and support updateAndConfirm @t12 @documents', async ({
    page,
  }) => {
    const localMatterIds: string[] = [];
    const localPartyIds: string[] = [];
    const localDocIds: string[] = [];
    const currentYear = String(getCairoYear());
    const futureHearingYmd = formatCairoOffsetYmd(30);
    const futureDueDateYmd = formatCairoOffsetYmd(45);

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
          fileCode: `LO-${currentYear}-T12-${runId}-04`,
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
          yearLabel: currentYear,
          registerType: 'مدني كلي',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const proceeding2 = await prisma.proceeding.create({
        data: {
          matterId: matter.id,
          courtId: testCourtId,
          instance: 'APPEAL',
          parentProceedingId: proceeding.id,
          numberText: `5502-${runId}`,
          yearLabel: currentYear,
          registerType: 'استئناف مدني',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const hearing = await prisma.hearing.create({
        data: {
          proceedingId: proceeding.id,
          hearingDate: new Date(`${futureHearingYmd}T00:00:00.000Z`),
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

      const decisionDoc2 = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter.id,
        proceedingId: proceeding2.id,
        title: `صورة مستند قيد الاستئناف ${runId}`,
        documentType: 'PLEADING',
        versions: [
          {
            filename: `appeal_doc_${runId}.pdf`,
            mime: 'application/pdf',
            bytes: buildSyntheticPdf(`T12-PROC2-DOC-${runId}`),
          },
        ],
      });
      localDocIds.push(decisionDoc2.documentId);

      // Seed ineligible documents (archived, quarantined, wrong-matter, wrong-party)
      const archivedDoc = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter.id,
        proceedingId: proceeding.id,
        title: `مستند مؤرشف مستبعد ${runId}`,
        documentType: 'OTHER',
        versions: [
          {
            filename: `archived_${runId}.pdf`,
            mime: 'application/pdf',
            bytes: buildSyntheticPdf(`T12-ARCHIVED-${runId}`),
          },
        ],
      });
      localDocIds.push(archivedDoc.documentId);
      await prisma.document.update({
        where: { id: archivedDoc.documentId },
        data: { archivedAt: new Date() },
      });

      const quarantinedDocId = randomUUID();
      const quarantinedVerId = randomUUID();
      await prisma.document.create({
        data: {
          id: quarantinedDocId,
          matterId: matter.id,
          proceedingId: proceeding.id,
          title: `مستند محجور مستبعد ${runId}`,
          titleNormalized: `مستند محجور مستبعد ${runId}`,
          documentType: 'OTHER',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localDocIds.push(quarantinedDocId);
      await prisma.documentVersion.create({
        data: {
          id: quarantinedVerId,
          documentId: quarantinedDocId,
          versionNumber: 1,
          objectKey: `q/e2e-quarantined-${quarantinedVerId}.pdf`,
          originalFilename: 'quarantined.pdf',
          declaredMime: 'application/pdf',
          sizeBytes: 120,
          uploadStatus: 'QUARANTINED',
          scanStatus: 'PENDING',
          createdById: owner.id,
        },
      });
      await prisma.document.update({
        where: { id: quarantinedDocId },
        data: { currentVersionId: quarantinedVerId },
      });

      const otherParty = await prisma.party.create({
        data: {
          kind: 'PERSON',
          name: `طرف آخر غير مرتبط T12 ${runId}`,
          nameNormalized: `طرف اخر غير مرتبط T12 ${runId}`,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localPartyIds.push(otherParty.id);
      const otherPartyDoc = await seedReadyDocumentInDb({
        ownerId: owner.id,
        partyId: otherParty.id,
        title: `مستند طرف آخر ${runId}`,
        documentType: 'POA_COPY',
        versions: [
          {
            filename: `other_party_${runId}.pdf`,
            mime: 'application/pdf',
            bytes: buildSyntheticPdf(`T12-OTHER-PARTY-${runId}`),
          },
        ],
      });
      localDocIds.push(otherPartyDoc.documentId);

      const otherMatter = await prisma.matter.create({
        data: {
          fileCode: `LO-${currentYear}-T12-${runId}-04B`,
          title: `قضية أخرى مستبعدة ${runId}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(otherMatter.id);
      const otherMatterDoc = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: otherMatter.id,
        title: `مستند قضية أخرى ${runId}`,
        documentType: 'JUDGMENT',
        versions: [
          {
            filename: `other_matter_${runId}.pdf`,
            mime: 'application/pdf',
            bytes: buildSyntheticPdf(`T12-OTHER-MATTER-${runId}`),
          },
        ],
      });
      localDocIds.push(otherMatterDoc.documentId);

      await signInWithTotp(page, owner);

      // 1) Link POA document on /parties/[id] -> excludes ineligible docs & remains UNREVIEWED across reload
      await page.goto(`/parties/${party.id}`);
      await expectShellReady(page);
      await page.getByTestId('add-poa-button').click();
      const poaDocSelect = page.getByTestId('poa-document-select');
      await expect(poaDocSelect.locator(`option[value="${poaDoc.documentId}"]`)).toHaveCount(1);
      await expect(poaDocSelect.locator(`option[value="${archivedDoc.documentId}"]`)).toHaveCount(0);
      await expect(poaDocSelect.locator(`option[value="${quarantinedDocId}"]`)).toHaveCount(0);
      await expect(poaDocSelect.locator(`option[value="${otherPartyDoc.documentId}"]`)).toHaveCount(0);
      await expect(poaDocSelect.locator(`option[value="${otherMatterDoc.documentId}"]`)).toHaveCount(0);

      await page.getByTestId('poa-number-input').fill(`0909-${runId}`);
      await page.getByTestId('poa-year-input').fill(currentYear);
      await page.getByTestId('poa-office-input').fill('مكتب توثيق مصر الجديدة');
      await page.getByTestId('poa-type-select').selectOption('GENERAL');
      await poaDocSelect.selectOption(poaDoc.documentId);
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
      await page.reload();
      await expectShellReady(page);
      await expect(page.getByTestId('poa-item').first().getByTestId('poa-review-status-badge')).toHaveText(
        'قيد المراجعة'
      );
      await expect(page.getByTestId(`poa-linked-document-${savedPoa.id}`)).toHaveAttribute(
        'href',
        `/documents/${poaDoc.documentId}`
      );

      // Archive linked POA doc -> editing POA preserves "(مؤرشف)" option and allows saving unrelated notes
      await prisma.document.update({
        where: { id: poaDoc.documentId },
        data: { archivedAt: new Date() },
      });
      await page.reload();
      await expectShellReady(page);
      await page.getByRole('button', { name: 'تعديل التوكيل' }).first().click();
      await expect(
        page.getByTestId('poa-document-select').locator(`option[value="${poaDoc.documentId}"]`)
      ).toContainText('(مؤرشف)');
      await page.getByTestId('poa-notes-input').fill(`ملاحظة مع بقاء المستند المؤرشف ${runId}`);
      await page.getByTestId('save-poa-button').click();
      await expect(page.getByTestId(`poa-linked-document-${savedPoa.id}`)).toHaveAttribute(
        'href',
        `/documents/${poaDoc.documentId}`
      );

      // 2) Link decision document on /hearings/[id]/result -> excludes ineligible docs & persists across reload
      await page.goto(`/hearings/${hearing.id}/result`);
      await expectShellReady(page);
      const hearingDocSelect = page.getByTestId('hearing-decision-document-select');
      await expect(hearingDocSelect.locator(`option[value="${decisionDoc.documentId}"]`)).toHaveCount(1);
      await expect(hearingDocSelect.locator(`option[value="${archivedDoc.documentId}"]`)).toHaveCount(0);
      await expect(hearingDocSelect.locator(`option[value="${quarantinedDocId}"]`)).toHaveCount(0);
      await expect(hearingDocSelect.locator(`option[value="${otherMatterDoc.documentId}"]`)).toHaveCount(0);

      await page
        .getByTestId('hearing-decision-textarea')
        .fill(`حكم تمهيدي مرفق به صورة القرار ${runId}`);
      await hearingDocSelect.selectOption(decisionDoc.documentId);
      await page.getByText('لا توجد جلسة أخرى (حكم منهي للخصومة)').click();
      await page.getByTestId('save-hearing-result-btn').click();

      await expect(page.getByTestId('save-success-banner')).toBeVisible();
      await expect(page.getByTestId('hearing-decision-document-link').first()).toHaveAttribute(
        'href',
        `/documents/${decisionDoc.documentId}`
      );
      await page.reload();
      await expectShellReady(page);
      await expect(page.getByTestId('persisted-decision-text')).toContainText(runId);
      await expect(page.getByTestId('hearing-decision-document-link').first()).toHaveAttribute(
        'href',
        `/documents/${decisionDoc.documentId}`
      );

      // 3) Link source document on /deadlines as DRAFT -> excludes ineligible docs, no storage key leaks in API, & remains DRAFT across reload
      await page.goto('/deadlines');
      await expectShellReady(page);
      await page.getByTestId('new-deadline-button').click();
      const deadlineTitle = `ميعاد طعن مرتبط بمستند ${runId}`;
      await page.getByTestId('deadline-title-input').fill(deadlineTitle);
      const docsApiResPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/documents?matterId=${encodeURIComponent(matter.id)}`) &&
          res.request().method() === 'GET'
      );
      await page.getByTestId('deadline-matter-select').selectOption(matter.id);
      const docsApiRes = await docsApiResPromise;
      expect(docsApiRes.status()).toBe(200);
      const docsApiText = await docsApiRes.text();
      expect(docsApiText).not.toContain('objectKey');
      expect(docsApiText).not.toContain('quarantineKey');
      expect(docsApiText).not.toContain('t12-e2e');

      await page.getByTestId('deadline-proceeding-select').selectOption(proceeding.id);
      const docSelect = page.getByTestId('deadline-source-document-select');
      await expect(docSelect.locator(`option[value="${decisionDoc.documentId}"]`)).toHaveCount(1);
      await expect(docSelect.locator(`option[value="${archivedDoc.documentId}"]`)).toHaveCount(0);
      await expect(docSelect.locator(`option[value="${quarantinedDocId}"]`)).toHaveCount(0);
      await expect(docSelect.locator(`option[value="${otherMatterDoc.documentId}"]`)).toHaveCount(0);
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
      await page.reload();
      await expectShellReady(page);
      await expect(page.getByTestId(`deadline-status-badge-${savedDeadline.id}`)).toHaveText(
        'مسودة تحتاج مراجعة'
      );
      await expect(
        page.getByTestId(`deadline-source-document-link-${savedDeadline.id}`)
      ).toHaveAttribute('href', `/documents/${decisionDoc.documentId}`);

      // Archive linked deadline doc -> opening draft preserves "(مؤرشف)" option; clearing via updateDraft removes link;
      // then updateAndConfirm reassigns proceedingId & attaches new doc cleanly.
      await prisma.document.update({
        where: { id: decisionDoc.documentId },
        data: { archivedAt: new Date() },
      });
      await page.reload();
      await expectShellReady(page);
      await page.getByTestId(`open-deadline-button-${savedDeadline.id}`).click();
      await expect(
        page
          .getByTestId('deadline-source-document-select')
          .locator(`option[value="${decisionDoc.documentId}"]`)
      ).toContainText('(مؤرشف)');
      await page.getByTestId('deadline-source-document-select').selectOption('');
      await page.getByTestId('save-deadline-draft-button').click();
      await expect(page.getByTestId(`deadline-source-document-link-${savedDeadline.id}`)).toHaveCount(0);

      await page.getByTestId(`open-deadline-button-${savedDeadline.id}`).click();
      await page.getByTestId('deadline-proceeding-select').selectOption(proceeding2.id);
      await expect(
        page
          .getByTestId('deadline-source-document-select')
          .locator(`option[value="${decisionDoc2.documentId}"]`)
      ).toHaveCount(1);
      await page.getByTestId('deadline-source-document-select').selectOption(decisionDoc2.documentId);
      await page.getByTestId('deadline-date-input').fill(futureDueDateYmd);
      await page.getByTestId('deadline-source-input').fill('إعلان رسمي محدث');
      await page.getByTestId('deadline-basis-input').fill('احتساب الميعاد بعد تحديث القيد والمستند');
      await page.getByTestId('deadline-review-checkbox').check();
      await page.getByTestId('confirm-deadline-button').click();

      await expect(page.getByTestId(`deadline-status-badge-${savedDeadline.id}`)).toHaveText('مؤكد');
      await expect(
        page.getByTestId(`deadline-source-document-link-${savedDeadline.id}`)
      ).toHaveAttribute('href', `/documents/${decisionDoc2.documentId}`);
      await page.reload();
      await expectShellReady(page);
      await expect(page.getByTestId(`deadline-status-badge-${savedDeadline.id}`)).toHaveText('مؤكد');
      await expect(
        page.getByTestId(`deadline-source-document-link-${savedDeadline.id}`)
      ).toHaveAttribute('href', `/documents/${decisionDoc2.documentId}`);
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
    const currentYear = String(getCairoYear());

    const localMatterIds: string[] = [];
    const localDocIds: string[] = [];

    try {
      const matterTitle = `ملف صلاحية الإتاحة T12 ${tag}`;
      const matter = await prisma.matter.create({
        data: {
          fileCode: `LO-${currentYear}-${tag}`,
          title: matterTitle,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter.id);

      const matter2 = await prisma.matter.create({
        data: {
          fileCode: `LO-${currentYear}-${tag}-2`,
          title: `ملف ثانٍ لاختبار انقطاع الشبكة ${tag}`,
          kind: 'LITIGATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      localMatterIds.push(matter2.id);

      const v1Bytes = buildSyntheticPdf(`T12-TC07-V1-${tag}`);
      const v2Bytes = buildSyntheticPng({ r: 15, g: 95, b: 115 });
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

      const seeded2 = await seedReadyDocumentInDb({
        ownerId: owner.id,
        matterId: matter2.id,
        title: `مستند الملف الثاني ${tag}`,
        versions: [
          { filename: `m2_${tag}.pdf`, mime: 'application/pdf', bytes: buildSyntheticPdf(`M2-${tag}`) },
        ],
      });
      localDocIds.push(seeded2.documentId);

      await signInWithTotp(page, owner);
      await page.goto(`/documents/${seeded.documentId}`);
      await expectShellReady(page);

      // Touch target checks across key controls at 390/768/1440px
      const backLink = page.getByTestId('back-to-documents-link');
      const previewV1Btn = page.getByTestId('version-preview-btn-1');
      const downloadV1Link = page.getByTestId('version-download-link-1');
      const versionFileInput = page.getByTestId('version-file-input');
      const versionFileLabel = page.locator('label[for="document-new-version-input"]');
      const originalLocationInput = page.getByTestId('metadata-original-location-input');
      const saveMetaBtn = page.getByTestId('metadata-save-button');
      const previewHeading = page.locator('#document-preview-heading');

      await expectTouchTarget(backLink, 44);
      await expectTouchTarget(previewV1Btn, 44);
      await expectTouchTarget(downloadV1Link, 44);
      await expectTouchTarget(versionFileLabel, 44);
      await expectTouchTarget(saveMetaBtn, 44);

      // Real keyboard Tab / Enter navigation across links, version history, hidden file-input label/control, and metadata form
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      expect(await tabToTestId(page, 'back-to-documents-link', 40)).toBe(true);
      await expectVisibleFocus(page, backLink);

      expect(await tabToTestId(page, 'version-preview-btn-1', 20)).toBe(true);
      await expectVisibleFocus(page, previewV1Btn);
      await expectNotCovered(page, previewV1Btn);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('preview-active-version-label')).toContainText('الإصدار رقم 1');
      await expect(page.getByTestId('document-preview-iframe')).toHaveAttribute(
        'src',
        new RegExp(`versionId=${seeded.versionIds[0]}`)
      );

      expect(await tabToTestId(page, 'version-download-link-1', 8)).toBe(true);
      await expectVisibleFocus(page, downloadV1Link);

      expect(await tabToTestId(page, 'version-file-input', 8)).toBe(true);
      await expect(versionFileInput).toBeFocused();
      const labelFocusShadow = await versionFileLabel.evaluate(
        (el) => getComputedStyle(el).boxShadow
      );
      expect(labelFocusShadow).not.toBe('none');
      expect(labelFocusShadow).toMatch(/(?:^|[,\s])(?:[2-9]|\d{2,})(?:\.\d+)?px/);

      expect(await tabToTestId(page, 'metadata-original-location-input', 12)).toBe(true);
      await expectVisibleFocus(page, originalLocationInput);
      await expectNotCovered(page, originalLocationInput);
      await originalLocationInput.fill(`خزينة 2 — ${tag}`);

      expect(await tabToTestId(page, 'metadata-save-button', 6)).toBe(true);
      await expectVisibleFocus(page, saveMetaBtn);
      await expectNotCovered(page, saveMetaBtn);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('metadata-save-success')).toBeVisible();

      // Verify preview scroll (scroll-padding-top) keeps #document-preview-heading uncovered by sticky header
      await previewV1Btn.click();
      await nextPaint(page);
      await expectScrollSettledAndNotCovered(page, previewHeading);

      // Failed version candidate INCOMPLETE -> retry recovery to v3 READY
      let abortBeginOnce = true;
      await page.route(`**/api/documents/${seeded.documentId}/versions`, async (route) => {
        if (abortBeginOnce && route.request().method() === 'POST') {
          abortBeginOnce = false;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });

      const v3Bytes = buildSyntheticPdf(`T12-TC07-V3-RETRY-${tag}`);
      await versionFileInput.setInputFiles({
        name: `retry_v3_${tag}.pdf`,
        mimeType: 'application/pdf',
        buffer: v3Bytes,
      });
      await page.getByTestId('version-upload-submit').click();

      await expect(page.getByTestId('version-candidate-status')).toHaveText('الرفع غير مكتمل');
      await expect(page.getByTestId('version-candidate-error')).toContainText(
        'لم يتم المساس بالإصدار الحالي المعتمد'
      );
      const retryVersionBtn = page.getByTestId('version-upload-retry');
      await expect(retryVersionBtn).toBeVisible();
      await expectTouchTarget(retryVersionBtn, 44);
      await retryVersionBtn.click();

      await expect(page.getByTestId('version-upload-success')).toContainText('الإصدار رقم 3');
      await expect(page.getByTestId('detail-current-version-badge')).toContainText('الإصدار الحالي: 3');
      await page.unroute(`**/api/documents/${seeded.documentId}/versions`);

      // Simulate failed version validation (disguised .jpg -> REJECTED) while prior versions remain accessible
      await versionFileInput.setInputFiles({
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
      await expect(page.getByTestId('detail-current-version-badge')).toContainText('الإصدار الحالي: 3');
      await expect(page.getByTestId('version-download-link-1')).toBeVisible();
      await expect(page.getByTestId('version-download-link-2')).toBeVisible();
      await expect(page.getByTestId('version-download-link-3')).toBeVisible();

      // Normal scale overflow check + screenshot
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));
      const detailScreenshot = testInfo.outputPath(`t12-document-detail-${width}.png`);
      await page.screenshot({
        path: detailScreenshot,
        fullPage: true,
      });
      await testInfo.attach(`t12-document-detail-${width}`, {
        path: detailScreenshot,
        contentType: 'image/png',
      });

      // 200% text scaling check with zero overflow, uncovered controls, and screenshot
      const baseFontSize = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      );
      await page.addStyleTag({
        content: `html { font-size: ${baseFontSize * 2}px !important; }`,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      await nextPaint(page);
      await expectNoPageOverflow(page);
      await expectNoElementOverflow(page.getByTestId('main-content'));
      await expectNotCovered(page, previewV1Btn);
      await expectNotCovered(page, saveMetaBtn);
      const zoomScreenshot = testInfo.outputPath(`t12-document-detail-zoom200-${width}.png`);
      await page.screenshot({
        path: zoomScreenshot,
        fullPage: true,
      });
      await testInfo.attach(`t12-document-detail-zoom200-${width}`, {
        path: zoomScreenshot,
        contentType: 'image/png',
      });

      // DeadlinesView doc-load 503 failure + retry disappears error, plus network error branch
      let failDocsMode: '503' | 'abort' | 'none' = '503';
      await page.route('**/api/documents?*', async (route) => {
        if (route.request().method() === 'GET' && failDocsMode === '503') {
          failDocsMode = 'none';
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'تعذر تحميل مستندات القضية مؤقتاً.' }),
          });
          return;
        }
        if (route.request().method() === 'GET' && failDocsMode === 'abort') {
          failDocsMode = 'none';
          await route.abort('failed');
          return;
        }
        await route.continue();
      });

      await page.goto('/deadlines');
      await expectShellReady(page);
      await page.getByTestId('new-deadline-button').click();
      await page.getByTestId('deadline-matter-select').selectOption(matter.id);
      await expect(page.getByTestId('deadline-source-docs-error')).toBeVisible();
      const docsRetryBtn = page.getByTestId('deadline-source-docs-retry');
      await expectTouchTarget(docsRetryBtn, 44);
      await docsRetryBtn.click();
      await expect(page.getByTestId('deadline-source-docs-error')).toHaveCount(0);
      await expect(
        page.getByTestId('deadline-source-document-select').locator(`option[value="${seeded.documentId}"]`)
      ).toHaveCount(1);

      // Network abort branch -> retry clears error and loads matter2 docs
      failDocsMode = 'abort';
      await page.getByTestId('deadline-matter-select').selectOption(matter2.id);
      await expect(page.getByTestId('deadline-source-docs-error')).toBeVisible();
      await page.getByTestId('deadline-source-docs-retry').click();
      await expect(page.getByTestId('deadline-source-docs-error')).toHaveCount(0);
      await expect(
        page.getByTestId('deadline-source-document-select').locator(`option[value="${seeded2.documentId}"]`)
      ).toHaveCount(1);
      await expectNoPageOverflow(page);
      await page.unroute('**/api/documents?*');

      // Invalid-UUID detail URL returns the Arabic 404 page without uncaught browser errors
      const notFoundPageErrors: string[] = [];
      const onNotFoundPageError = (err: Error) => {
        notFoundPageErrors.push(err.message);
      };
      page.on('pageerror', onNotFoundPageError);
      try {
        const notFoundRes = await page.goto('/hearings/not-a-uuid');
        expect(notFoundRes?.status()).toBe(404);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(
          page.getByRole('heading', { level: 1, name: 'الصفحة أو السجل غير موجود' })
        ).toBeVisible();
        await expect(page.getByRole('link', { name: 'العودة إلى الرئيسية' })).toBeVisible();
        expect(notFoundPageErrors).toEqual([]);
      } finally {
        page.off('pageerror', onNotFoundPageError);
      }

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
