import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { getAuth, getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { AuthorizationError } from '@/modules/identity/types';
import { addProceeding, openMatter } from '@/modules/matters/matter-service';
import { scheduleHearing } from '@/modules/scheduling';
import {
  ADR_0003_POLICY_CODE,
  ADR_0003_POLICY_VERSION,
  ConcurrencyConflictError,
  CrossMatterLinkForbiddenError,
  DocumentNotReadyError,
  DocumentScanPolicyUnavailableError,
  DocumentValidationError,
  DuplicateChecksumWarningError,
  MAX_DOCUMENT_BYTES,
  UNSCANNED_POLICY_NOTICE_AR,
  UnauthorizedError,
  authorizeDownload,
  beginUpload,
  cleanupExpiredUploadAttempts,
  createLocalDocumentStorage,
  finalizeUpload,
  getDocument,
  listDocuments,
  uploadAttemptBytes,
} from '@/modules/documents';
import { GET as listDocumentsRoute } from '@/app/api/documents/route';
import { POST as beginUploadRoute } from '@/app/api/documents/uploads/route';
import { GET as getUploadAttemptRoute } from '@/app/api/documents/uploads/[attemptId]/route';
import { PUT as putUploadContentRoute } from '@/app/api/documents/uploads/[attemptId]/content/route';
import { POST as postFinalizeUploadRoute } from '@/app/api/documents/uploads/[attemptId]/finalize/route';
import { GET as getDocumentRoute } from '@/app/api/documents/[id]/route';
import { GET as getDocumentContentRoute } from '@/app/api/documents/[id]/content/route';
import {
  cleanupPartyFixtures,
  createSyntheticActor,
  createSyntheticMaintainer,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { createDedicatedTestDatabase } from '../helpers/test-db';

function buildSyntheticPdf(marker: string, padBytes = 0): Buffer {
  const header = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Marker (${marker}) >>\nendobj\n`, 'ascii');
  const footer = Buffer.from('\ntrailer\n<<>>\n%%EOF', 'ascii');
  if (padBytes <= 0) {
    return Buffer.concat([header, footer]);
  }
  return Buffer.concat([header, Buffer.alloc(padBytes, 0x20), footer]);
}

function buildSyntheticJpeg(marker: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, marker & 0xff, (marker >> 8) & 0xff, 0xff, 0xd9,
  ]);
}

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

function buildSyntheticPng(markerByte: number): Buffer {
  const ihdr = Buffer.from([
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00,
  ]);
  const idat = zlib.deflateSync(Buffer.from([0x00, markerByte & 0xff, 0x10, 0x20]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function signSessionTokenCookie(token: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(token).digest('base64');
  return `better-auth.session_token=${encodeURIComponent(`${token}.${sig}`)}`;
}

function runPrismaMigrateDeploy(dbUrl: string, schema?: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(
    process.execPath,
    [prismaJs, 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])],
    {
      env: { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'test' },
      encoding: 'utf-8',
    }
  );
  if (res.status !== 0) {
    throw new Error(`Prisma migrate deploy failed (${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  return res;
}

describe('T11 Integration Tests: Private Upload, ADR 0003 Validation, Atomic Finalization & Auth (PG)', () => {
  const prisma = getPrismaClient();
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const owner = createSyntheticActor({
    id: `t11-owner-${runSuffix}`,
    name: 'الأستاذ أحمد المحامي اختبار T11',
    email: `t11.owner.${runSuffix}@lawoffice.test`,
  });
  const maintainer = createSyntheticMaintainer({
    id: `t11-maintainer-${runSuffix}`,
    email: `t11.maintainer.${runSuffix}@lawoffice.test`,
  });

  let storageRoot: string;
  let prevStorageRootEnv: string | undefined;

  let courtId: string;
  let partyId: string;
  let matterAId: string;
  let proceedingA1Id: string;
  let proceedingA2Id: string;
  let hearingA1Id: string;
  let hearingA2Id: string;
  let matterBId: string;
  let proceedingBId: string;
  let hearingBId: string;

  let ownerCookie: string;
  let revokedOwnerCookie: string;
  let maintainerCookie: string;
  const createdSessionIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdDocumentIds: string[] = [];
  const createdAttemptIds: string[] = [];

  beforeAll(async () => {
    setupTestEncryptionKeys();
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lawoffice-t11-int-${runSuffix}-`));
    prevStorageRootEnv = process.env.DOCUMENTS_STORAGE_ROOT;
    process.env.DOCUMENTS_STORAGE_ROOT = storageRoot;

    // Ensure Better Auth singleton initializes before inserting sessions
    getAuth();
    const secret = getEnv().BETTER_AUTH_SECRET;

    // Seed real Owner (with verified TOTP) and Maintainer users + sessions for HTTP route checks
    await prisma.user.createMany({
      data: [
        {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          emailVerified: true,
          role: 'OWNER',
          twoFactorEnabled: true,
          credentialVersion: 1,
        },
        {
          id: maintainer.id,
          name: maintainer.name,
          email: maintainer.email,
          emailVerified: true,
          role: 'MAINTAINER',
          twoFactorEnabled: false,
          credentialVersion: 1,
        },
      ],
    });
    createdUserIds.push(owner.id, maintainer.id);

    await prisma.twoFactor.create({
      data: {
        id: crypto.randomUUID(),
        userId: owner.id,
        secret: 'SYNTHETIC_T11_TOTP_SECRET',
        backupCodes: '[]',
        verified: true,
      },
    });

    const ownerToken = crypto.randomBytes(24).toString('hex');
    const revokedToken = crypto.randomBytes(24).toString('hex');
    const maintainerToken = crypto.randomBytes(24).toString('hex');
    const ownerSessionId = crypto.randomUUID();
    const revokedSessionId = crypto.randomUUID();
    const maintainerSessionId = crypto.randomUUID();
    const futureExp = new Date(Date.now() + 6 * 60 * 60 * 1000);

    await prisma.session.createMany({
      data: [
        {
          id: ownerSessionId,
          userId: owner.id,
          token: ownerToken,
          expiresAt: futureExp,
          credentialVersion: 1,
        },
        {
          id: revokedSessionId,
          userId: owner.id,
          token: revokedToken,
          expiresAt: futureExp,
          credentialVersion: 1,
        },
        {
          id: maintainerSessionId,
          userId: maintainer.id,
          token: maintainerToken,
          expiresAt: futureExp,
          credentialVersion: 1,
        },
      ],
    });
    // Revoke the second owner session right away to test revoked session rejection
    await prisma.session.delete({ where: { id: revokedSessionId } });
    createdSessionIds.push(ownerSessionId, maintainerSessionId);

    ownerCookie = signSessionTokenCookie(ownerToken, secret);
    revokedOwnerCookie = signSessionTokenCookie(revokedToken, secret);
    maintainerCookie = signSessionTokenCookie(maintainerToken, secret);

    const ts = Date.now();
    const court = await prisma.court.create({
      data: {
        name: `محكمة استئناف القاهرة اختبار T11 ${ts}`,
        code: `T11-${ts.toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    courtId = court.id;
    createdCourtIds.push(courtId);

    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `موكل اختبار المستندات T11 ${ts}`,
        nameNormalized: `موكل اختبار المستندات T11 ${ts}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    partyId = party.id;
    createdPartyIds.push(partyId);

    const mA = await openMatter(owner, {
      title: `ملف قضية المستندات أ T11 ${ts}`,
      kind: 'LITIGATION',
      initialClientId: partyId,
      idempotencyKey: crypto.randomUUID(),
    });
    matterAId = mA.matter.id;
    createdMatterIds.push(matterAId);

    const pA1 = await addProceeding(owner, {
      matterId: matterAId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: '1101',
      yearLabel: '2026',
      registerType: 'مدني كلي',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingA1Id = pA1.id;

    const pA2 = await addProceeding(owner, {
      matterId: matterAId,
      courtId,
      instance: 'APPEAL',
      parentProceedingId: proceedingA1Id,
      numberText: '2202',
      yearLabel: '2026',
      registerType: 'استئناف عالي',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingA2Id = pA2.id;

    const hA1 = await scheduleHearing(owner, {
      proceedingId: proceedingA1Id,
      hearingDate: '2027-06-15',
      idempotencyKey: crypto.randomUUID(),
    });
    hearingA1Id = hA1.id;

    const hA2 = await scheduleHearing(owner, {
      proceedingId: proceedingA2Id,
      hearingDate: '2027-07-20',
      idempotencyKey: crypto.randomUUID(),
    });
    hearingA2Id = hA2.id;

    const mB = await openMatter(owner, {
      title: `ملف قضية المستندات ب T11 ${ts}`,
      kind: 'LITIGATION',
      initialClientId: partyId,
      idempotencyKey: crypto.randomUUID(),
    });
    matterBId = mB.matter.id;
    createdMatterIds.push(matterBId);

    const pB = await addProceeding(owner, {
      matterId: matterBId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: '3303',
      yearLabel: '2026',
      registerType: 'تجاري',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingBId = pB.id;

    const hB = await scheduleHearing(owner, {
      proceedingId: proceedingBId,
      hearingDate: '2027-08-10',
      idempotencyKey: crypto.randomUUID(),
    });
    hearingBId = hB.id;
  });

  afterAll(async () => {
    if (prevStorageRootEnv === undefined) {
      delete process.env.DOCUMENTS_STORAGE_ROOT;
    } else {
      process.env.DOCUMENTS_STORAGE_ROOT = prevStorageRootEnv;
    }

    // Release any backup file pins created during cleanup tests so versions can be cleaned up
    if (createdDocumentIds.length > 0) {
      await prisma.backupFilePin.deleteMany({
        where: { documentVersion: { documentId: { in: createdDocumentIds } } },
      });
      await prisma.document.deleteMany({ where: { id: { in: createdDocumentIds } } });
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'Document', entityId: { in: createdDocumentIds } },
      });
    }

    if (createdAttemptIds.length > 0) {
      await prisma.uploadAttempt.deleteMany({ where: { id: { in: createdAttemptIds } } });
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'UploadAttempt', entityId: { in: createdAttemptIds } },
      });
    }

    await prisma.idempotencyRecord.deleteMany({
      where: { actorId: { in: [owner.id, maintainer.id] } },
    });
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupPartyFixtures(prisma, createdPartyIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });

    if (createdUserIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.twoFactor.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    if (storageRoot && fs.existsSync(storageRoot)) {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('T11-MIGRATION: Deploys forward cleanly onto a populated T10 database and enforces all 5 PostgreSQL CHECK constraints', async () => {
    const db = await createDedicatedTestDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-t11-mig-'));
    try {
      // Deploy all migrations EXCEPT T11 into temp schema dir to simulate an operational T10 DB
      const migrationsSrc = path.resolve(process.cwd(), 'prisma/migrations');
      const preT11MigrationsDir = path.join(tempDir, 'migrations');
      fs.mkdirSync(preT11MigrationsDir, { recursive: true });
      fs.copyFileSync(
        path.join(migrationsSrc, 'migration_lock.toml'),
        path.join(preT11MigrationsDir, 'migration_lock.toml')
      );
      for (const entry of fs.readdirSync(migrationsSrc)) {
        if (entry === 'migration_lock.toml' || entry === '20261124120000_t11_private_documents_and_uploads') {
          continue;
        }
        const full = path.join(migrationsSrc, entry);
        if (fs.statSync(full).isDirectory()) {
          fs.cpSync(full, path.join(preT11MigrationsDir, entry), { recursive: true });
        }
      }
      const tempSchema = path.join(tempDir, 'schema.prisma');
      fs.copyFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), tempSchema);

      runPrismaMigrateDeploy(db.url, tempSchema);

      // Seed synthetic T10 Matter & Party before running T11 migration
      const seedPartyId = crypto.randomUUID();
      const seedMatterId = crypto.randomUUID();
      const seedUserId = crypto.randomUUID();
      await db.pool.query(
        `INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "createdById", "updatedById", "updatedAt") VALUES ($1, 'PERSON', 'موكل ترقية', 'موكل ترقيه', $2, $2, NOW())`,
        [seedPartyId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "createdById", "updatedById", "updatedAt") VALUES ($1, 'LO-2026-9901', 'ملف قبل T11', 'LITIGATION', 'ACTIVE', $2, $2, NOW())`,
        [seedMatterId, seedUserId]
      );

      // Now deploy full migrations including T11
      runPrismaMigrateDeploy(db.url);

      // Verify CHECK 1: matter_id XOR party_id on document and upload_attempt
      await expect(
        db.pool.query(
          `INSERT INTO "document" ("id", "matter_id", "party_id", "title", "title_normalized", "document_type", "created_by_id", "updated_by_id")
           VALUES ($1, NULL, NULL, 'بدون مالك', 'بدون مالك', 'OTHER', $2, $2)`,
          [crypto.randomUUID(), seedUserId]
        )
      ).rejects.toThrow(/document_owner_xor_check/);

      await expect(
        db.pool.query(
          `INSERT INTO "document" ("id", "matter_id", "party_id", "title", "title_normalized", "document_type", "created_by_id", "updated_by_id")
           VALUES ($1, $2, $3, 'مالكان معاً', 'مالكان معا', 'OTHER', $4, $4)`,
          [crypto.randomUUID(), seedMatterId, seedPartyId, seedUserId]
        )
      ).rejects.toThrow(/document_owner_xor_check/);

      // Verify CHECK 2: proceeding_id/hearing_id requires matter_id
      await expect(
        db.pool.query(
          `INSERT INTO "document" ("id", "matter_id", "party_id", "proceeding_id", "title", "title_normalized", "document_type", "created_by_id", "updated_by_id")
           VALUES ($1, NULL, $2, $3, 'قيد مع طرف', 'قيد مع طرف', 'OTHER', $4, $4)`,
          [crypto.randomUUID(), seedPartyId, crypto.randomUUID(), seedUserId]
        )
      ).rejects.toThrow(/document_matter_scope_check/);

      // Verify CHECK 3: expected_size_bytes range (1..26214400) on upload_attempt
      await expect(
        db.pool.query(
          `INSERT INTO "upload_attempt" ("id", "idempotency_record_id", "actor_id", "matter_id", "title", "document_type", "original_filename", "declared_mime", "expected_size_bytes", "quarantine_key", "expires_at")
           VALUES ($1, $2, $3, $4, 'تجاوز الحد', 'OTHER', 'big.pdf', 'application/pdf', 26214401, 'q/big.pdf', NOW() + interval '1 day')`,
          [crypto.randomUUID(), crypto.randomUUID(), seedUserId, seedMatterId]
        )
      ).rejects.toThrow(/upload_attempt_expected_size_range_check/);

      // Verify CHECK 4 & CHECK 5 on document_version
      const validDocId = crypto.randomUUID();
      await db.pool.query(
        `INSERT INTO "document" ("id", "matter_id", "party_id", "title", "title_normalized", "document_type", "created_by_id", "updated_by_id")
         VALUES ($1, $2, NULL, 'مستند اختبار قيود', 'مستند اختبار قيود', 'CONTRACT', $3, $3)`,
        [validDocId, seedMatterId, seedUserId]
      );

      await expect(
        db.pool.query(
          `INSERT INTO "document_version" ("id", "document_id", "version_number", "object_key", "original_filename", "size_bytes", "upload_status", "scan_status", "created_by_id")
           VALUES ($1, $2, 1, 'v1/bad-size.pdf', 'a.pdf', 0, 'READY', 'NOT_SCANNED_POLICY', $3)`,
          [crypto.randomUUID(), validDocId, seedUserId]
        )
      ).rejects.toThrow(/document_version_size_bytes_range_check/);

      await expect(
        db.pool.query(
          `INSERT INTO "document_version" ("id", "document_id", "version_number", "object_key", "original_filename", "size_bytes", "upload_status", "scan_status", "created_by_id")
           VALUES ($1, $2, 1, 'v1/bad-scan.pdf', 'a.pdf', 100, 'READY', 'PENDING', $3)`,
          [crypto.randomUUID(), validDocId, seedUserId]
        )
      ).rejects.toThrow(/document_version_ready_scan_policy_check/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await db.drop();
    }
  }, 60000);

  it('T11-TC-01: Uploads valid PDF, JPEG, and PNG via module and HTTP routes with ADR 0003 NOT_SCANNED_POLICY and Owner download verification', async () => {
    const trustedOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const pdfBytes = buildSyntheticPdf('TC01-PDF');
    const pdfSha = crypto.createHash('sha256').update(pdfBytes).digest('hex');

    // 1. Full HTTP API flow for PDF attached to Matter A + Proceeding A1 + Hearing A1
    const beginRes = await beginUploadRoute(
      new Request(`${trustedOrigin}/api/documents/uploads`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          cookie: ownerCookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          hearingId: hearingA1Id,
          title: 'صحيفة افتتاح الدعوى PDF',
          documentType: 'PLEADING',
          documentDate: '2026-11-20',
          originalLocation: 'دولاب ١ — رف ٢',
          originalPresent: 'YES',
          originalFilename: 'صحيفة_الدعوى.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: pdfBytes.byteLength,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(beginRes.status).toBe(201);
    expect(beginRes.headers.get('cache-control')).toBe('private, no-store');
    const beginJson = (await beginRes.json()) as { success: true; data: { id: string; status: string } };
    const attemptPdfId = beginJson.data.id;
    createdAttemptIds.push(attemptPdfId);
    expect(Object.hasOwn(beginJson.data, 'quarantineKey')).toBe(false);
    expect(beginJson.data.status).toBe('INITIATED');

    const putRes = await putUploadContentRoute(
      new Request(`${trustedOrigin}/api/documents/uploads/${attemptPdfId}/content`, {
        method: 'PUT',
        headers: {
          origin: trustedOrigin,
          cookie: ownerCookie,
          'content-type': 'application/pdf',
        },
        body: new Uint8Array(pdfBytes),
      }),
      { params: Promise.resolve({ attemptId: attemptPdfId }) }
    );
    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as {
      success: true;
      data: { status: string; bytesWritten: number; sha256: string };
    };
    expect(putJson.data.status).toBe('UPLOADED');
    expect(putJson.data.bytesWritten).toBe(pdfBytes.byteLength);
    expect(putJson.data.sha256).toBe(pdfSha);

    const checkAttemptRes = await getUploadAttemptRoute(
      new Request(`${trustedOrigin}/api/documents/uploads/${attemptPdfId}`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ attemptId: attemptPdfId }) }
    );
    expect(checkAttemptRes.status).toBe(200);

    const finalizeRes = await postFinalizeUploadRoute(
      new Request(`${trustedOrigin}/api/documents/uploads/${attemptPdfId}/finalize`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          cookie: ownerCookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirmDuplicate: false }),
      }),
      { params: Promise.resolve({ attemptId: attemptPdfId }) }
    );
    expect(finalizeRes.status).toBe(200);
    const finalizedJson = (await finalizeRes.json()) as {
      success: true;
      data: Awaited<ReturnType<typeof getDocument>>;
    };
    const pdfDoc = finalizedJson.data;
    createdDocumentIds.push(pdfDoc.id);

    expect(pdfDoc.currentVersion).not.toBeNull();
    expect(pdfDoc.currentVersion!.uploadStatus).toBe('READY');
    expect(pdfDoc.currentVersion!.scanStatus).toBe('NOT_SCANNED_POLICY');
    expect(pdfDoc.currentVersion!.scanStatus).not.toBe('CLEAN');
    expect(pdfDoc.currentVersion!.scanPolicyCode).toBe(ADR_0003_POLICY_CODE);
    expect(pdfDoc.currentVersion!.scanPolicyVersion).toBe(ADR_0003_POLICY_VERSION);
    expect(pdfDoc.currentVersion!.scanStatusLabel).toContain(UNSCANNED_POLICY_NOTICE_AR);
    expect(pdfDoc.currentVersion!.sha256).toBe(pdfSha);
    expect(pdfDoc.originalPresent).toBe('YES');
    expect(pdfDoc.originalLocation).toBe('دولاب ١ — رف ٢');
    expect(Object.hasOwn(pdfDoc.currentVersion!, 'objectKey')).toBe(false);

    // Verify private storage key lives strictly under storageRoot/ready/ and quarantine was cleaned up
    const dbVer = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: pdfDoc.currentVersionId! },
    });
    expect(dbVer.objectKey.startsWith('v1/')).toBe(true);
    const storage = createLocalDocumentStorage(storageRoot);
    expect(await storage.exists('ready', dbVer.objectKey)).toBe(true);
    const dbAttempt = await prisma.uploadAttempt.findUniqueOrThrow({ where: { id: attemptPdfId } });
    expect(await storage.exists('quarantine', dbAttempt.quarantineKey)).toBe(false);

    // 2. Upload JPEG to Matter A and PNG to Party A via module interface
    const jpegBytes = buildSyntheticJpeg(0x1122);
    const jpegSha = crypto.createHash('sha256').update(jpegBytes).digest('hex');
    const jpegAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'صورة ضوئية محضر إعلان',
      documentType: 'EVIDENCE',
      originalFilename: 'محضر_إعلان.jpeg',
      declaredMime: 'image/jpeg',
      expectedSizeBytes: jpegBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(jpegAttempt.id);
    await uploadAttemptBytes(owner, jpegAttempt.id, jpegBytes);
    const jpegDoc = await finalizeUpload(owner, { attemptId: jpegAttempt.id });
    createdDocumentIds.push(jpegDoc.id);
    expect(jpegDoc.currentVersion!.detectedMime).toBe('image/jpeg');
    expect(jpegDoc.currentVersion!.sha256).toBe(jpegSha);
    expect(jpegDoc.currentVersion!.scanStatus).toBe('NOT_SCANNED_POLICY');

    const pngBytes = buildSyntheticPng(0x07);
    const pngSha = crypto.createHash('sha256').update(pngBytes).digest('hex');
    const pngAttempt = await beginUpload(owner, {
      partyId,
      title: 'صورة بطاقة الرقم القومي للموكل',
      documentType: 'ID_COPY',
      sensitivity: 'RESTRICTED',
      originalFilename: 'بطاقة_الموكل.png',
      declaredMime: 'image/png',
      expectedSizeBytes: pngBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(pngAttempt.id);
    await uploadAttemptBytes(owner, pngAttempt.id, pngBytes);
    const pngDoc = await finalizeUpload(owner, { attemptId: pngAttempt.id });
    createdDocumentIds.push(pngDoc.id);
    expect(pngDoc.partyId).toBe(partyId);
    expect(pngDoc.matterId).toBeNull();
    expect(pngDoc.sensitivity).toBe('RESTRICTED');
    expect(pngDoc.currentVersion!.detectedMime).toBe('image/png');
    expect(pngDoc.currentVersion!.sha256).toBe(pngSha);
    expect(pngDoc.currentVersion!.scanStatus).toBe('NOT_SCANNED_POLICY');

    // 3. List & search documents (normalized Arabic digits/text) and download bytes
    const listRes = await listDocumentsRoute(
      new Request(`${trustedOrigin}/api/documents?matterId=${matterAId}&q=صحيفه`, {
        headers: { cookie: ownerCookie },
      })
    );
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      success: true;
      data: { documents: Array<{ id: string }>; total: number };
    };
    expect(listJson.data.documents.map((d) => d.id)).toContain(pdfDoc.id);
    expect(listJson.data.documents.map((d) => d.id)).not.toContain(pngDoc.id);

    const docMetaRes = await getDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${pdfDoc.id}`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: pdfDoc.id }) }
    );
    expect(docMetaRes.status).toBe(200);

    const dl = await authorizeDownload(owner, pngDoc.id, undefined, { disposition: 'inline' });
    expect(await dl.readBytes()).toEqual(pngBytes);

    const dlAudit = await prisma.auditEvent.findFirst({
      where: { entityType: 'Document', entityId: pngDoc.id, action: 'DOWNLOAD_DOCUMENT' },
    });
    expect(dlAudit).not.toBeNull();
  });

  it('T11-TC-02: Enforces 25 MiB boundary, rejects oversized & disguised files, and fails closed when scan policy REQUIRED', async () => {
    const trustedOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const overhead = buildSyntheticPdf('BOUNDARY', 0).byteLength;
    const exact25MiB = buildSyntheticPdf('BOUNDARY', MAX_DOCUMENT_BYTES - overhead);
    expect(exact25MiB.byteLength).toBe(MAX_DOCUMENT_BYTES);

    // Exact 25 MiB succeeds
    const exactAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'ملف حد 25 ميجابايت بالضبط',
      documentType: 'OTHER',
      originalFilename: 'exact-25mib.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: MAX_DOCUMENT_BYTES,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(exactAttempt.id);
    await uploadAttemptBytes(owner, exactAttempt.id, exact25MiB);
    const exactDoc = await finalizeUpload(owner, { attemptId: exactAttempt.id });
    createdDocumentIds.push(exactDoc.id);
    expect(exactDoc.currentVersion!.sizeBytes).toBe(MAX_DOCUMENT_BYTES);
    expect(exactDoc.currentVersion!.uploadStatus).toBe('READY');

    // 25 MiB + 1 byte rejected on beginUpload
    await expect(
      beginUpload(owner, {
        matterId: matterAId,
        title: 'ملف أكبر من الحد',
        documentType: 'OTHER',
        originalFilename: 'too-big.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: MAX_DOCUMENT_BYTES + 1,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(DocumentValidationError);

    // Forged small expectedSizeBytes followed by > 25 MiB stream over HTTP PUT fails closed
    const forgedAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'ملف يزور الحجم المعلن',
      documentType: 'OTHER',
      originalFilename: 'forged-size.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: 512,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(forgedAttempt.id);

    const overStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 * 1024));
        controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
        controller.close();
      },
    });
    const overPutRes = await putUploadContentRoute(
      new Request(`${trustedOrigin}/api/documents/uploads/${forgedAttempt.id}/content`, {
        method: 'PUT',
        headers: {
          origin: trustedOrigin,
          cookie: ownerCookie,
          'content-type': 'application/pdf',
        },
        body: overStream,
        duplex: 'half',
      } as RequestInit),
      { params: Promise.resolve({ attemptId: forgedAttempt.id }) }
    );
    expect(overPutRes.status).toBe(400);
    const forgedRow = await prisma.uploadAttempt.findUniqueOrThrow({ where: { id: forgedAttempt.id } });
    expect(forgedRow.status).toBe('REJECTED');
    expect(forgedRow.documentId).toBeNull();

    // Disguised HTML pretending to be PDF -> rejected at finalizeUpload and audited as REJECT_DOCUMENT_UPLOAD
    const htmlDisguised = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');
    const disguisedAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'ملف HTML متنكر كملف PDF',
      documentType: 'OTHER',
      originalFilename: 'disguised.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: htmlDisguised.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(disguisedAttempt.id);
    await uploadAttemptBytes(owner, disguisedAttempt.id, htmlDisguised);

    await expect(finalizeUpload(owner, { attemptId: disguisedAttempt.id })).rejects.toThrow(
      DocumentValidationError
    );
    const rejectedAttempt = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: disguisedAttempt.id },
    });
    expect(rejectedAttempt.status).toBe('REJECTED');
    expect(rejectedAttempt.documentId).toBeNull();

    const rejectAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: 'UploadAttempt',
        entityId: disguisedAttempt.id,
        action: 'REJECT_DOCUMENT_UPLOAD',
      },
    });
    expect(rejectAudit).not.toBeNull();

    // PNG bytes uploaded as JPEG -> rejected
    const pngBytes = buildSyntheticPng(0x09);
    const mismatchAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'ملف PNG بصيغة JPEG',
      documentType: 'EVIDENCE',
      originalFilename: 'fake.jpg',
      declaredMime: 'image/jpeg',
      expectedSizeBytes: pngBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(mismatchAttempt.id);
    await uploadAttemptBytes(owner, mismatchAttempt.id, pngBytes);
    await expect(finalizeUpload(owner, { attemptId: mismatchAttempt.id })).rejects.toThrow(
      DocumentValidationError
    );

    // ADR 0003 fail-closed when DOCUMENT_SCAN_POLICY_MODE=REQUIRED
    const validPdf = buildSyntheticPdf('REQUIRED-POLICY-FAIL-CLOSED');
    const reqPolicyAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'اختبار فشل إغلاق سياسة الفحص الإلزامية',
      documentType: 'CONTRACT',
      originalFilename: 'policy-check.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: validPdf.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(reqPolicyAttempt.id);
    await uploadAttemptBytes(owner, reqPolicyAttempt.id, validPdf);

    await expect(
      finalizeUpload(owner, { attemptId: reqPolicyAttempt.id }, { scanPolicyMode: 'REQUIRED' })
    ).rejects.toThrow(DocumentScanPolicyUnavailableError);

    const stillNotReadyAttempt = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: reqPolicyAttempt.id },
    });
    expect(stillNotReadyAttempt.status).toBe('UPLOADED');
    expect(stillNotReadyAttempt.documentId).toBeNull();
  }, 20000);

  it('T11-TC-03: Rejects path-traversal filenames and cross-matter Proceeding/Hearing references', async () => {
    for (const unsafeName of ['../../etc/passwd.pdf', 'C:\\secret\\evil.pdf', 'nested/file.png']) {
      await expect(
        beginUpload(owner, {
          matterId: matterAId,
          title: 'اسم ملف خطر',
          documentType: 'OTHER',
          originalFilename: unsafeName,
          declaredMime: unsafeName.endsWith('.png') ? 'image/png' : 'application/pdf',
          expectedSizeBytes: 128,
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toThrow(DocumentValidationError);
    }

    // Matter A + Proceeding B (Matter B) -> CrossMatterLinkForbiddenError
    await expect(
      beginUpload(owner, {
        matterId: matterAId,
        proceedingId: proceedingBId,
        title: 'ربط بقيد ملف آخر',
        documentType: 'PLEADING',
        originalFilename: 'doc.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 128,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    // Matter A + Hearing B (Matter B) -> CrossMatterLinkForbiddenError
    await expect(
      beginUpload(owner, {
        matterId: matterAId,
        hearingId: hearingBId,
        title: 'ربط بجلسة ملف آخر',
        documentType: 'PLEADING',
        originalFilename: 'doc.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 128,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    // Matter A + Proceeding A1 + Hearing A2 (Hearing A2 belongs to Proceeding A2) -> CrossMatterLinkForbiddenError
    await expect(
      beginUpload(owner, {
        matterId: matterAId,
        proceedingId: proceedingA1Id,
        hearingId: hearingA2Id,
        title: 'ربط جلسة بقيد مختلف في نفس الملف',
        documentType: 'PLEADING',
        originalFilename: 'doc.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 128,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    // Transactional assertValidParentLinks inside finalizeUpload rejects if parent matter is archived before commit
    const tempMatter = await openMatter(owner, {
      title: 'ملف مؤقت لاختبار أرشفة الأب أثناء الاعتماد',
      kind: 'CONSULTATION',
      initialClientId: partyId,
      idempotencyKey: crypto.randomUUID(),
    });
    createdMatterIds.push(tempMatter.matter.id);
    const archivedPdf = buildSyntheticPdf('TC03-ARCHIVED-TX');
    const archivedAttempt = await beginUpload(owner, {
      matterId: tempMatter.matter.id,
      title: 'مستند ملف سيُؤرشف قبل الاعتماد',
      documentType: 'OTHER',
      originalFilename: 'archived-tx.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: archivedPdf.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(archivedAttempt.id);
    await uploadAttemptBytes(owner, archivedAttempt.id, archivedPdf);

    await prisma.matter.update({
      where: { id: tempMatter.matter.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      finalizeUpload(owner, { attemptId: archivedAttempt.id })
    ).rejects.toThrow(DocumentValidationError);
    expect(
      await prisma.document.count({ where: { matterId: tempMatter.matter.id } })
    ).toBe(0);
  });

  it('T11-TC-04: Leaves no READY artifact on interrupted upload or simulated DB failure, and idempotently recovers on retry', async () => {
    const storage = createLocalDocumentStorage(storageRoot);

    // 1. Interrupted upload stream
    const interruptedAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'رفع منقطع منتصف البث',
      documentType: 'MEMORANDUM',
      originalFilename: 'interrupted.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: 500,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(interruptedAttempt.id);

    async function* failingStream(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('%PDF-1.4\n', 'ascii');
      throw new Error('ECONNRESET_SIMULATED');
    }

    await expect(
      uploadAttemptBytes(owner, interruptedAttempt.id, failingStream())
    ).rejects.toThrow(/ECONNRESET_SIMULATED/);

    const afterInterrupt = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: interruptedAttempt.id },
    });
    expect(afterInterrupt.status).toBe('FAILED');
    expect(afterInterrupt.bytesWritten).toBe(0);
    // Sanitized failureReason never leaks raw OS/internal error strings
    expect(afterInterrupt.failureReason).toBe('تعذر إتمام معالجة الملف بسبب خطأ تقني مؤقت.');
    expect(afterInterrupt.failureReason).not.toContain('ECONNRESET_SIMULATED');
    expect(await storage.exists('quarantine', afterInterrupt.quarantineKey)).toBe(false);
    await expect(finalizeUpload(owner, { attemptId: interruptedAttempt.id })).rejects.toThrow(
      DocumentValidationError
    );

    // 2. Valid upload with injected DB finalization failure -> zero READY rows, zero orphan ready files
    const pdfBytes = buildSyntheticPdf('TC04-DB-FAILURE-RETRY');
    const attempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'مستند اختبار استعادة فشل قاعدة البيانات',
      documentType: 'JUDGMENT',
      originalFilename: 'judgment-retry.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: pdfBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(attempt.id);
    await uploadAttemptBytes(owner, attempt.id, pdfBytes);

    const readyDirSnapshotBefore = fs.existsSync(storage.readyDir)
      ? fs.readdirSync(storage.readyDir, { recursive: true })
      : [];

    const finalizeKey = crypto.randomUUID();
    await expect(
      finalizeUpload(
        owner,
        { attemptId: attempt.id, idempotencyKey: finalizeKey },
        { simulateDbFailure: true }
      )
    ).rejects.toThrow(/SIMULATED_DB_FINALIZATION_FAILURE/);

    const failedAttempt = await prisma.uploadAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(failedAttempt.status).toBe('FAILED');
    expect(failedAttempt.failureReason).toBe('تعذر إتمام معالجة الملف بسبب خطأ تقني مؤقت.');
    expect(failedAttempt.failureReason).not.toContain('SIMULATED_DB_FINALIZATION_FAILURE');
    expect(failedAttempt.failureReason).not.toContain(storageRoot);
    expect(failedAttempt.documentId).toBeNull();
    expect(failedAttempt.targetDocumentVersionId).toBeNull();
    expect(await storage.exists('quarantine', failedAttempt.quarantineKey)).toBe(true);

    const readyDirSnapshotDuringFail = fs.existsSync(storage.readyDir)
      ? fs.readdirSync(storage.readyDir, { recursive: true }).filter((p) => !String(p).includes('part-'))
      : [];
    expect(readyDirSnapshotDuringFail).toEqual(readyDirSnapshotBefore);
    expect(
      await prisma.document.count({ where: { matterId: matterAId, title: attempt.title } })
    ).toBe(0);

    // 3. Concurrent finalizeUpload race on the same attempt -> 1 winner, 1 clean ConcurrencyConflictError (zero ENOENT 500)
    const racePdfBytes = buildSyntheticPdf('TC04-CONCURRENT-FINALIZE-RACE');
    const raceAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'اختبار تزامن اعتماد الرفع',
      documentType: 'MEMORANDUM',
      originalFilename: 'race-check.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: racePdfBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(raceAttempt.id);
    await uploadAttemptBytes(owner, raceAttempt.id, racePdfBytes);

    const raceOutcomes = await Promise.allSettled([
      finalizeUpload(owner, { attemptId: raceAttempt.id, idempotencyKey: crypto.randomUUID() }),
      finalizeUpload(owner, { attemptId: raceAttempt.id, idempotencyKey: crypto.randomUUID() }),
    ]);
    const raceSuccesses = raceOutcomes.filter((r) => r.status === 'fulfilled');
    const raceFailures = raceOutcomes.filter((r) => r.status === 'rejected');
    expect(raceSuccesses).toHaveLength(1);
    expect(raceFailures).toHaveLength(1);
    expect((raceFailures[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflictError);
    createdDocumentIds.push(
      (raceSuccesses[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof getDocument>>>).value.id
    );

    // 4. Retry with same attemptId & idempotencyKey -> succeeds cleanly with exactly 1 Document, 1 Version, 1 AuditEvent
    const recoveredDoc = await finalizeUpload(owner, {
      attemptId: attempt.id,
      idempotencyKey: finalizeKey,
    });
    createdDocumentIds.push(recoveredDoc.id);
    expect(recoveredDoc.currentVersion!.uploadStatus).toBe('READY');
    expect(recoveredDoc.currentVersion!.scanStatus).toBe('NOT_SCANNED_POLICY');

    // Replay same finalizeKey -> returns identical doc, zero duplicate versions or audit events
    const replayedDoc = await finalizeUpload(owner, {
      attemptId: attempt.id,
      idempotencyKey: finalizeKey,
    });
    expect(replayedDoc.id).toBe(recoveredDoc.id);
    expect(replayedDoc.currentVersionId).toBe(recoveredDoc.currentVersionId);

    expect(
      await prisma.document.count({ where: { matterId: matterAId, title: attempt.title } })
    ).toBe(1);
    expect(
      await prisma.documentVersion.count({ where: { documentId: recoveredDoc.id } })
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { entityType: 'Document', entityId: recoveredDoc.id, action: 'CREATE_DOCUMENT' },
      })
    ).toBe(1);
    // Calling finalize with a different key on already FINALIZED attempt is rejected
    await expect(
      finalizeUpload(owner, { attemptId: attempt.id, idempotencyKey: crypto.randomUUID() })
    ).rejects.toThrow(ConcurrencyConflictError);
  });

  it('T11-TC-05: Enforces Owner-only access, rejects unauth/revoked/Maintainer/cross-origin/quarantined content, and sets strict security headers', async () => {
    const trustedOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const pdfBytes = buildSyntheticPdf('TC05-AUTH-HEADERS');

    const readyAttempt = await beginUpload(owner, {
      matterId: matterAId,
      title: 'مستند فحص التصاريح والترويسات',
      documentType: 'CONTRACT',
      originalFilename: 'عقد_اختبار_500.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: pdfBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(readyAttempt.id);
    await uploadAttemptBytes(owner, readyAttempt.id, pdfBytes);
    const readyDoc = await finalizeUpload(owner, { attemptId: readyAttempt.id });
    createdDocumentIds.push(readyDoc.id);

    // Owner inline preview & attachment download over real HTTP route
    const ownerInlineRes = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${readyDoc.id}/content?disposition=inline`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: readyDoc.id }) }
    );
    expect(ownerInlineRes.status).toBe(200);
    expect(ownerInlineRes.headers.get('content-type')).toBe('application/pdf');
    expect(ownerInlineRes.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(ownerInlineRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ownerInlineRes.headers.get('content-security-policy')).toBe(
      "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
    );
    expect(ownerInlineRes.headers.get('content-disposition')).toContain('inline;');
    expect(ownerInlineRes.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    const streamedBytes = Buffer.from(await ownerInlineRes.arrayBuffer());
    expect(streamedBytes).toEqual(pdfBytes);

    // Attachment download keeps sandbox CSP, and next.config.ts scopes X-Frame-Options: SAMEORIGIN solely to /api/documents/:id/content
    const ownerAttachmentRes = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${readyDoc.id}/content?disposition=attachment`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: readyDoc.id }) }
    );
    expect(ownerAttachmentRes.status).toBe(200);
    expect(ownerAttachmentRes.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'self'"
    );
    expect(ownerAttachmentRes.headers.get('content-disposition')).toContain('attachment;');

    const headerRules = await nextConfig.headers!();
    const globalRule = headerRules.find((r) => r.source === '/(.*)');
    const contentFrameRule = headerRules.find((r) => r.source === '/api/documents/:id/content');
    expect(globalRule?.headers.find((h) => h.key === 'X-Frame-Options')?.value).toBe('DENY');
    expect(contentFrameRule?.headers.find((h) => h.key === 'X-Frame-Options')?.value).toBe('SAMEORIGIN');
    expect(headerRules.some((r) => r.source === '/documents')).toBe(true);
    expect(headerRules.some((r) => r.source === '/documents/:path*')).toBe(true);

    // Unauthenticated requests -> 401 with private no-store
    const unauthContent = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${readyDoc.id}/content`),
      { params: Promise.resolve({ id: readyDoc.id }) }
    );
    expect(unauthContent.status).toBe(401);
    expect(unauthContent.headers.get('cache-control')).toBe('private, no-store');

    const unauthList = await listDocumentsRoute(new Request(`${trustedOrigin}/api/documents`));
    expect(unauthList.status).toBe(401);

    // Revoked session -> 401
    const revokedContent = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${readyDoc.id}/content`, {
        headers: { cookie: revokedOwnerCookie },
      }),
      { params: Promise.resolve({ id: readyDoc.id }) }
    );
    expect(revokedContent.status).toBe(401);

    // Maintainer -> 403 FORBIDDEN on service and HTTP routes
    await expect(listDocuments(maintainer)).rejects.toThrow(AuthorizationError);
    await expect(authorizeDownload(maintainer, readyDoc.id)).rejects.toThrow(AuthorizationError);
    await expect(
      beginUpload(maintainer, {
        matterId: matterAId,
        title: 'ممنوع للصيانة',
        documentType: 'OTHER',
        originalFilename: 'x.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 100,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(AuthorizationError);
    await expect(
      authorizeDownload(null as unknown as typeof owner, readyDoc.id)
    ).rejects.toThrow(UnauthorizedError);

    const maintContentRes = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${readyDoc.id}/content`, {
        headers: { cookie: maintainerCookie },
      }),
      { params: Promise.resolve({ id: readyDoc.id }) }
    );
    expect(maintContentRes.status).toBe(403);
    expect(maintContentRes.headers.get('cache-control')).toBe('private, no-store');

    const maintMetaRes = await getDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${readyDoc.id}`, {
        headers: { cookie: maintainerCookie },
      }),
      { params: Promise.resolve({ id: readyDoc.id }) }
    );
    expect(maintMetaRes.status).toBe(403);

    // Cross-origin / cross-site rejection -> 403
    const crossSiteContent = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${readyDoc.id}/content`, {
        headers: { cookie: ownerCookie, 'sec-fetch-site': 'cross-site' },
      }),
      { params: Promise.resolve({ id: readyDoc.id }) }
    );
    expect(crossSiteContent.status).toBe(403);

    // Quarantined DocumentVersion must NEVER be downloadable even by Owner
    const quarantinedDocId = crypto.randomUUID();
    const quarantinedVerId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: quarantinedDocId,
        matterId: matterAId,
        title: 'مستند قيد الحجر غير معتمد',
        titleNormalized: 'مستند قيد الحجر غير معتمد',
        documentType: 'OTHER',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(quarantinedDocId);
    await prisma.documentVersion.create({
      data: {
        id: quarantinedVerId,
        documentId: quarantinedDocId,
        versionNumber: 1,
        objectKey: `q/quarantined-${quarantinedVerId}.pdf`,
        originalFilename: 'quarantined.pdf',
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
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

    await expect(authorizeDownload(owner, quarantinedDocId)).rejects.toThrow(DocumentNotReadyError);

    const quarantinedHttpRes = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${quarantinedDocId}/content`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: quarantinedDocId }) }
    );
    expect(quarantinedHttpRes.status).toBe(409);
    const quarantinedBody = (await quarantinedHttpRes.json()) as { code: string };
    expect(quarantinedBody.code).toBe('DOCUMENT_NOT_READY');
  });

  it('T11-TC-07: Emits DUPLICATE_CHECKSUM_WARNING on matching SHA-256 and creates a distinct second document after confirmation', async () => {
    const trustedOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
    const sharedBytes = buildSyntheticPdf('TC07-DUPLICATE-SHA256-BYTES');

    // First document finalized cleanly
    const attempt1 = await beginUpload(owner, {
      matterId: matterAId,
      title: 'النسخة الأولى الأصلية من العقد',
      documentType: 'CONTRACT',
      originalFilename: 'contract-original.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: sharedBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(attempt1.id);
    await uploadAttemptBytes(owner, attempt1.id, sharedBytes);
    const doc1 = await finalizeUpload(owner, { attemptId: attempt1.id });
    createdDocumentIds.push(doc1.id);

    // Second upload with identical bytes
    const attempt2 = await beginUpload(owner, {
      matterId: matterBId,
      title: 'نسخة مقصودة مرفوعة لملف آخر',
      documentType: 'CONTRACT',
      originalFilename: 'contract-copy.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: sharedBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(attempt2.id);
    await uploadAttemptBytes(owner, attempt2.id, sharedBytes);

    // Without confirmDuplicate -> DuplicateChecksumWarningError (HTTP 409)
    try {
      await finalizeUpload(owner, { attemptId: attempt2.id, confirmDuplicate: false });
      throw new Error('Expected DuplicateChecksumWarningError');
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateChecksumWarningError);
      const dupErr = err as DuplicateChecksumWarningError;
      expect(dupErr.existingDocuments.some((d) => d.documentId === doc1.id)).toBe(true);
    }

    const warnHttpRes = await postFinalizeUploadRoute(
      new Request(`${trustedOrigin}/api/documents/uploads/${attempt2.id}/finalize`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          cookie: ownerCookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirmDuplicate: false }),
      }),
      { params: Promise.resolve({ attemptId: attempt2.id }) }
    );
    expect(warnHttpRes.status).toBe(409);
    const warnJson = (await warnHttpRes.json()) as {
      code: string;
      existingDocuments: Array<{ documentId: string }>;
    };
    expect(warnJson.code).toBe('DUPLICATE_CHECKSUM_WARNING');
    expect(warnJson.existingDocuments.some((d) => d.documentId === doc1.id)).toBe(true);

    // Confirm duplicate -> creates second independent document while original stays intact
    const confirmHttpRes = await postFinalizeUploadRoute(
      new Request(`${trustedOrigin}/api/documents/uploads/${attempt2.id}/finalize`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          cookie: ownerCookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirmDuplicate: true, idempotencyKey: crypto.randomUUID() }),
      }),
      { params: Promise.resolve({ attemptId: attempt2.id }) }
    );
    expect(confirmHttpRes.status).toBe(200);
    const confirmJson = (await confirmHttpRes.json()) as {
      success: true;
      data: Awaited<ReturnType<typeof getDocument>>;
    };
    const doc2 = confirmJson.data;
    createdDocumentIds.push(doc2.id);

    expect(doc2.id).not.toBe(doc1.id);
    expect(doc2.currentVersionId).not.toBe(doc1.currentVersionId);
    expect(doc2.currentVersion!.sha256).toBe(doc1.currentVersion!.sha256);

    const ver1 = await prisma.documentVersion.findUniqueOrThrow({ where: { id: doc1.currentVersionId! } });
    const ver2 = await prisma.documentVersion.findUniqueOrThrow({ where: { id: doc2.currentVersionId! } });
    expect(ver2.objectKey).not.toBe(ver1.objectKey);

    expect(await (await authorizeDownload(owner, doc1.id)).readBytes()).toEqual(sharedBytes);
    expect(await (await authorizeDownload(owner, doc2.id)).readBytes()).toEqual(sharedBytes);
  });

  it('T11-LIFECYCLE: Protects BackupFilePin, READY versions, and active uploads from cleanup, and skips cleanup in RESTORE_MODE', async () => {
    const storage = createLocalDocumentStorage(storageRoot);
    const now = new Date('2026-11-24T15:00:00.000Z');

    // 1. Active non-expired upload (expires in future)
    const activeBytes = buildSyntheticPdf('ACTIVE-UPLOAD');
    const activeAttempt = await beginUpload(
      owner,
      {
        matterId: matterAId,
        title: 'محاولة رفع نشطة غير منتهية',
        documentType: 'OTHER',
        originalFilename: 'active.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: activeBytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      },
      { now }
    );
    createdAttemptIds.push(activeAttempt.id);
    await uploadAttemptBytes(owner, activeAttempt.id, activeBytes, { now });

    // 2. Expired unpinned upload (backdate expiresAt)
    const expiredBytes = buildSyntheticPdf('EXPIRED-UPLOAD');
    const expiredAttempt = await beginUpload(
      owner,
      {
        matterId: matterAId,
        title: 'محاولة رفع منتهية للتنظيف',
        documentType: 'OTHER',
        originalFilename: 'expired.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: expiredBytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      },
      { now }
    );
    createdAttemptIds.push(expiredAttempt.id);
    await uploadAttemptBytes(owner, expiredAttempt.id, expiredBytes, { now });
    await prisma.uploadAttempt.update({
      where: { id: expiredAttempt.id },
      data: { expiresAt: new Date(now.getTime() - 60_000) },
    });

    // 3. READY document + active BackupFilePin
    const pinnedBytes = buildSyntheticPdf('BACKUP-PINNED');
    const pinnedAttempt = await beginUpload(
      owner,
      {
        matterId: matterAId,
        title: 'مستند مثبت في نسخة احتياطية',
        documentType: 'CONTRACT',
        originalFilename: 'pinned.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: pinnedBytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      },
      { now }
    );
    createdAttemptIds.push(pinnedAttempt.id);
    await uploadAttemptBytes(owner, pinnedAttempt.id, pinnedBytes, { now });
    const pinnedDoc = await finalizeUpload(owner, { attemptId: pinnedAttempt.id }, { now });
    createdDocumentIds.push(pinnedDoc.id);

    const backupId = `bkp-${runSuffix}`;
    await prisma.backupFilePin.create({
      data: {
        backupId,
        documentVersionId: pinnedDoc.currentVersionId!,
      },
    });

    // Verify DB FK Restrict prevents deleting pinned DocumentVersion
    await expect(
      prisma.documentVersion.delete({ where: { id: pinnedDoc.currentVersionId! } })
    ).rejects.toThrow();

    // 4. Also create an expired UploadAttempt linked to a separate pinned QUARANTINED DocumentVersion to verify cleanup skips pinned versions
    const pinnedQuarantineDocId = crypto.randomUUID();
    const pinnedQuarantineVerId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: pinnedQuarantineDocId,
        matterId: matterAId,
        title: 'مستند في الحجر مثبت بنسخة احتياطية',
        titleNormalized: 'مستند في الحجر مثبت بنسخه احتياطيه',
        documentType: 'CONTRACT',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(pinnedQuarantineDocId);
    await prisma.documentVersion.create({
      data: {
        id: pinnedQuarantineVerId,
        documentId: pinnedQuarantineDocId,
        versionNumber: 1,
        objectKey: `q/pinned-ver-${pinnedQuarantineVerId}.pdf`,
        originalFilename: 'pinned-quarantine.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 120,
        uploadStatus: 'QUARANTINED',
        scanStatus: 'PENDING',
        createdById: owner.id,
      },
    });
    await prisma.backupFilePin.create({
      data: {
        backupId: `${backupId}-q`,
        documentVersionId: pinnedQuarantineVerId,
      },
    });

    const pinnedExpiredAttemptId = crypto.randomUUID();
    const pinnedQKey = storage.generateQuarantineKey(pinnedExpiredAttemptId, '.pdf', now);
    const pinnedAttemptBytes = buildSyntheticPdf('PINNED-ATTEMPT');
    await storage.writeQuarantineStream(pinnedQKey, pinnedAttemptBytes);
    await prisma.uploadAttempt.create({
      data: {
        id: pinnedExpiredAttemptId,
        documentId: pinnedQuarantineDocId,
        targetDocumentVersionId: pinnedQuarantineVerId,
        idempotencyRecordId: crypto.randomUUID(),
        actorId: owner.id,
        matterId: matterAId,
        title: 'محاولة مرتبطة بنسخة مثبتة',
        documentType: 'CONTRACT',
        originalFilename: 'pinned-attempt.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: pinnedAttemptBytes.byteLength,
        quarantineKey: pinnedQKey,
        bytesWritten: pinnedAttemptBytes.byteLength,
        status: 'FAILED',
        expiresAt: new Date(now.getTime() - 60_000),
      },
    });
    createdAttemptIds.push(pinnedExpiredAttemptId);

    const expiredAttemptRowBefore = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: expiredAttempt.id },
    });

    // Test RESTORE_MODE skips cleanup completely
    const prevRestore = process.env.RESTORE_MODE;
    process.env.RESTORE_MODE = 'true';
    try {
      const skippedRes = await cleanupExpiredUploadAttempts(storage, { now });
      expect(skippedRes.skipped).toBe(true);
      expect(skippedRes.reason).toBe('RESTORE_MODE');
      expect(skippedRes.deletedQuarantineCount).toBe(0);
      expect(await storage.exists('quarantine', expiredAttemptRowBefore.quarantineKey)).toBe(true);
    } finally {
      if (prevRestore === undefined) delete process.env.RESTORE_MODE;
      else process.env.RESTORE_MODE = prevRestore;
    }

    // Normal cleanup cleans ONLY expired unpinned attempt, preserving active, READY, and pinned!
    const cleanupRes = await cleanupExpiredUploadAttempts(storage, { now });
    expect(cleanupRes.skipped).toBe(false);
    expect(cleanupRes.expiredAttemptCount).toBeGreaterThanOrEqual(1);
    expect(cleanupRes.deletedQuarantineCount).toBeGreaterThanOrEqual(1);
    expect(cleanupRes.skippedProtectedCount).toBeGreaterThanOrEqual(1);

    const expiredAfter = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: expiredAttempt.id },
    });
    expect(expiredAfter.status).toBe('EXPIRED');
    const expiredDbQ = await prisma.uploadAttempt.findUniqueOrThrow({ where: { id: expiredAttempt.id } });
    expect(await storage.exists('quarantine', expiredDbQ.quarantineKey)).toBe(false);

    // Active upload remains intact
    const activeDbQ = await prisma.uploadAttempt.findUniqueOrThrow({ where: { id: activeAttempt.id } });
    expect(activeDbQ.status).toBe('UPLOADED');
    expect(await storage.exists('quarantine', activeDbQ.quarantineKey)).toBe(true);

    // Pinned READY version & its pinned quarantine reference remain intact
    const pinnedVer = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: pinnedDoc.currentVersionId! },
    });
    expect(await storage.exists('ready', pinnedVer.objectKey)).toBe(true);
    expect(await storage.exists('quarantine', pinnedQKey)).toBe(true);
  });
});
