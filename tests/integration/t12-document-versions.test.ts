import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DocumentType } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getAuth, getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import * as identityAuthorize from '@/modules/identity/authorize';
import {
  ADR_0003_POLICY_CODE,
  ADR_0003_POLICY_VERSION,
  ConcurrencyConflictError,
  CrossMatterLinkForbiddenError,
  DocumentNotReadyError,
  DocumentScanPolicyUnavailableError,
  DocumentValidationError,
  authorizeDownload,
  beginUpload,
  beginVersionUpload,
  createLocalDocumentStorage,
  finalizeUpload,
  getDocumentDetail,
  listDocuments,
  pinDocumentVersionsForBackup,
  reconcileAndCleanupDocumentStorage,
  releaseBackupFilePins,
  updateDocumentMetadata,
  uploadAttemptBytes,
} from '@/modules/documents';
import { AuthorizationError, type UserRole } from '@/modules/identity/types';
import {
  addProceeding,
  archiveMatter,
  archiveProceeding,
  linkMatterParty,
  openMatter,
  unifiedSearch,
} from '@/modules/matters/matter-service';
import { savePowerOfAttorney } from '@/modules/parties/service';
import { listAgenda } from '@/modules/productivity/productivity-service';
import {
  confirmDeadline,
  correctHearingResult,
  recordHearingResult,
  scheduleHearing,
  updateDeadlineDraft,
} from '@/modules/scheduling';
import { GET as listDocumentsRoute } from '@/app/api/documents/route';
import { GET as getDocumentRoute, PATCH as patchDocumentRoute } from '@/app/api/documents/[id]/route';
import {
  GET as getDocumentContentRoute,
  HEAD as headDocumentContentRoute,
} from '@/app/api/documents/[id]/content/route';
import { POST as postDocumentVersionRoute } from '@/app/api/documents/[id]/versions/route';
import { POST as postHearingResultRoute } from '@/app/api/scheduling/hearings/[id]/result/route';
import { POST as postDeadlinesRoute } from '@/app/api/deadlines/route';
import { PATCH as patchDeadlineRoute } from '@/app/api/deadlines/[id]/route';
import {
  cleanupPartyFixtures,
  createSyntheticActor,
  createSyntheticMaintainer,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { createDedicatedTestDatabase } from '../helpers/test-db';
import { buildSyntheticPdf, buildSyntheticPng } from '../helpers/synthetic-files';

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function formatOffsetYmd(daysFromNow: number, base: Date = new Date()): string {
  return new Date(base.getTime() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

describe('T12 Integration Tests: Document Versions, Paper Originals, Links, Search & Cleanup (PG)', () => {
  const prisma = getPrismaClient();
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const owner = createSyntheticActor({
    id: `t12-owner-${runSuffix}`,
    name: `الأستاذ طارق المحامي اختبار T12 ${runSuffix}`,
    email: `t12.owner.${runSuffix}@lawoffice.test`,
  });
  const maintainer = createSyntheticMaintainer({
    id: `t12-maintainer-${runSuffix}`,
    email: `t12.maintainer.${runSuffix}@lawoffice.test`,
  });

  let storageRoot: string;
  let prevStorageRootEnv: string | undefined;
  let trustedOrigin: string;
  let ownerCookie: string;
  let revokedOwnerCookie: string;
  let maintainerCookie: string;

  let courtId: string;
  let partyClientAId: string;
  let partyClientBId: string;
  let partyOtherId: string;
  let matterAId: string;
  let proceedingA1Id: string;
  let proceedingA2Id: string;
  let hearingA1Id: string;
  let hearingA2Id: string;
  let matterBId: string;
  let proceedingBId: string;
  let hearingBId: string;

  const createdUserIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdMatterIds: string[] = [];
  const createdDocumentIds: string[] = [];
  const createdAttemptIds: string[] = [];
  const createdPoaIds: string[] = [];
  const createdDeadlineIds: string[] = [];
  const createdHearingIds: string[] = [];
  const createdHearingResultIds: string[] = [];
  const createdBackupIds: string[] = [];

  async function createReadyMatterDocument(opts: {
    matterId: string;
    proceedingId?: string | null;
    hearingId?: string | null;
    title: string;
    documentType?: DocumentType;
    documentDate?: string | null;
    tags?: string[];
    originalPresent?: 'YES' | 'NO' | 'UNKNOWN';
    originalLocation?: string | null;
    filename?: string;
    bytes: Buffer;
  }) {
    const attempt = await beginUpload(owner, {
      matterId: opts.matterId,
      proceedingId: opts.proceedingId ?? null,
      hearingId: opts.hearingId ?? null,
      title: opts.title,
      documentType: opts.documentType ?? 'CONTRACT',
      documentDate: opts.documentDate ?? null,
      tags: opts.tags ?? [],
      originalPresent: opts.originalPresent ?? 'UNKNOWN',
      originalLocation: opts.originalLocation ?? null,
      originalFilename: opts.filename ?? 'doc-v1.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: opts.bytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(attempt.id);
    await uploadAttemptBytes(owner, attempt.id, opts.bytes);
    const doc = await finalizeUpload(owner, { attemptId: attempt.id, confirmDuplicate: true });
    createdDocumentIds.push(doc.id);
    return doc;
  }

  beforeAll(async () => {
    setupTestEncryptionKeys();
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lawoffice-t12-int-${runSuffix}-`));
    prevStorageRootEnv = process.env.DOCUMENTS_STORAGE_ROOT;
    process.env.DOCUMENTS_STORAGE_ROOT = storageRoot;

    getAuth();
    const env = getEnv();
    const secret = env.BETTER_AUTH_SECRET;
    trustedOrigin = new URL(env.BETTER_AUTH_URL).origin;

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
        secret: 'SYNTHETIC_T12_TOTP_SECRET',
        backupCodes: '[]',
        verified: true,
      },
    });

    const ownerToken = crypto.randomBytes(24).toString('hex');
    const revokedToken = crypto.randomBytes(24).toString('hex');
    const maintainerToken = crypto.randomBytes(24).toString('hex');
    const futureExp = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const revokedSessionId = crypto.randomUUID();

    await prisma.session.createMany({
      data: [
        {
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
          userId: maintainer.id,
          token: maintainerToken,
          expiresAt: futureExp,
          credentialVersion: 1,
        },
      ],
    });
    await prisma.session.delete({ where: { id: revokedSessionId } });

    ownerCookie = signSessionTokenCookie(ownerToken, secret);
    revokedOwnerCookie = signSessionTokenCookie(revokedToken, secret);
    maintainerCookie = signSessionTokenCookie(maintainerToken, secret);

    const court = await prisma.court.create({
      data: {
        name: `محكمة استئناف الجيزة اختبار T12 ${runSuffix}`,
        code: `T12-${runSuffix.slice(0, 6)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    courtId = court.id;
    createdCourtIds.push(courtId);

    const [pA, pB, pOther] = await Promise.all([
      prisma.party.create({
        data: {
          kind: 'PERSON',
          name: `الموكل الأول T12 ${runSuffix}`,
          nameNormalized: `الموكل الاول T12 ${runSuffix}`,
          createdById: owner.id,
          updatedById: owner.id,
        },
      }),
      prisma.party.create({
        data: {
          kind: 'PERSON',
          name: `الموكل الثاني T12 ${runSuffix}`,
          nameNormalized: `الموكل الثاني T12 ${runSuffix}`,
          createdById: owner.id,
          updatedById: owner.id,
        },
      }),
      prisma.party.create({
        data: {
          kind: 'PERSON',
          name: `طرف مستقل T12 ${runSuffix}`,
          nameNormalized: `طرف مستقل T12 ${runSuffix}`,
          createdById: owner.id,
          updatedById: owner.id,
        },
      }),
    ]);
    partyClientAId = pA.id;
    partyClientBId = pB.id;
    partyOtherId = pOther.id;
    createdPartyIds.push(partyClientAId, partyClientBId, partyOtherId);

    const mA = await openMatter(owner, {
      title: `ملف القضية أ اختبار T12 ${runSuffix}`,
      kind: 'LITIGATION',
      initialClientId: partyClientAId,
      idempotencyKey: crypto.randomUUID(),
    });
    matterAId = mA.matter.id;
    createdMatterIds.push(matterAId);

    const pA1 = await addProceeding(owner, {
      matterId: matterAId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: `1201-${runSuffix}`,
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
      numberText: `1202-${runSuffix}`,
      yearLabel: '2026',
      registerType: 'استئناف مدني',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingA2Id = pA2.id;

    const hA1 = await scheduleHearing(owner, {
      proceedingId: proceedingA1Id,
      hearingDate: formatOffsetYmd(30),
      idempotencyKey: crypto.randomUUID(),
    });
    hearingA1Id = hA1.id;

    const hA2 = await scheduleHearing(owner, {
      proceedingId: proceedingA2Id,
      hearingDate: formatOffsetYmd(45),
      idempotencyKey: crypto.randomUUID(),
    });
    hearingA2Id = hA2.id;

    const mB = await openMatter(owner, {
      title: `ملف القضية ب اختبار T12 ${runSuffix}`,
      kind: 'LITIGATION',
      initialClientId: partyClientBId,
      idempotencyKey: crypto.randomUUID(),
    });
    matterBId = mB.matter.id;
    createdMatterIds.push(matterBId);

    const pB1 = await addProceeding(owner, {
      matterId: matterBId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: `2201-${runSuffix}`,
      yearLabel: '2026',
      registerType: 'تجاري',
      idempotencyKey: crypto.randomUUID(),
    });
    proceedingBId = pB1.id;

    const hB = await scheduleHearing(owner, {
      proceedingId: proceedingBId,
      hearingDate: formatOffsetYmd(60),
      idempotencyKey: crypto.randomUUID(),
    });
    hearingBId = hB.id;
  }, 60_000);

  afterAll(async () => {
    try {
      const actorIds = [owner.id, maintainer.id];

      if (createdHearingResultIds.length > 0) {
        await prisma.hearingResult.deleteMany({
          where: { id: { in: createdHearingResultIds } },
        });
      }
      if (createdDeadlineIds.length > 0) {
        await prisma.jobRun.deleteMany({
          where: { sourceType: 'Deadline', sourceId: { in: createdDeadlineIds } },
        });
        await prisma.deadline.deleteMany({
          where: { id: { in: createdDeadlineIds } },
        });
      }
      if (createdPoaIds.length > 0) {
        await prisma.powerOfAttorney.deleteMany({
          where: { id: { in: createdPoaIds } },
        });
      }

      const hearingIds = [hearingA1Id, hearingA2Id, hearingBId, ...createdHearingIds].filter(Boolean);
      if (hearingIds.length > 0) {
        await prisma.jobRun.deleteMany({
          where: { sourceType: 'Hearing', sourceId: { in: hearingIds } },
        });
      }

      const ownedDocs = await prisma.document.findMany({
        where: {
          OR: [
            ...(createdDocumentIds.length > 0 ? [{ id: { in: createdDocumentIds } }] : []),
            { createdById: { in: actorIds } },
          ],
        },
        select: { id: true },
      });
      const allDocIds = ownedDocs.map((d) => d.id);

      if (allDocIds.length > 0 || createdBackupIds.length > 0) {
        await prisma.backupFilePin.deleteMany({
          where: {
            OR: [
              ...(allDocIds.length > 0
                ? [{ documentVersion: { documentId: { in: allDocIds } } }]
                : []),
              ...(createdBackupIds.length > 0 ? [{ backupId: { in: createdBackupIds } }] : []),
            ],
          },
        });
      }

      await prisma.uploadAttempt.deleteMany({
        where: {
          OR: [
            ...(createdAttemptIds.length > 0 ? [{ id: { in: createdAttemptIds } }] : []),
            ...(allDocIds.length > 0 ? [{ documentId: { in: allDocIds } }] : []),
            { actorId: { in: actorIds } },
          ],
        },
      });

      if (allDocIds.length > 0) {
        await prisma.document.updateMany({
          where: { id: { in: allDocIds } },
          data: { currentVersionId: null },
        });
        await prisma.documentVersion.deleteMany({ where: { documentId: { in: allDocIds } } });
        await prisma.document.deleteMany({ where: { id: { in: allDocIds } } });
      }

      await prisma.auditEvent.deleteMany({
        where: {
          OR: [
            { userId: { in: actorIds } },
            ...(allDocIds.length > 0 ? [{ entityType: 'Document', entityId: { in: allDocIds } }] : []),
            ...(createdAttemptIds.length > 0
              ? [{ entityType: 'UploadAttempt', entityId: { in: createdAttemptIds } }]
              : []),
            ...(createdBackupIds.length > 0
              ? [{ entityType: 'BackupFilePin', entityId: { in: createdBackupIds } }]
              : []),
          ],
        },
      });

      await prisma.idempotencyRecord.deleteMany({
        where: { actorId: { in: actorIds } },
      });

      await cleanupMatterFixtures(prisma, createdMatterIds);
      await cleanupPartyFixtures(prisma, createdPartyIds);
      await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });

      if (createdUserIds.length > 0) {
        await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.twoFactor.deleteMany({ where: { userId: { in: createdUserIds } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    } finally {
      if (prevStorageRootEnv === undefined) {
        delete process.env.DOCUMENTS_STORAGE_ROOT;
      } else {
        process.env.DOCUMENTS_STORAGE_ROOT = prevStorageRootEnv;
      }
      if (storageRoot && fs.existsSync(storageRoot)) {
        fs.rmSync(storageRoot, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it('T12-MIGRATION: Deploys 20261126000000_t12_document_versions_and_links onto populated pre-T12 DB and enforces CHECK + 3 FKs', async () => {
    const db = await createDedicatedTestDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-t12-mig-'));
    try {
      const migrationsSrc = path.resolve(process.cwd(), 'prisma/migrations');
      const preT12MigrationsDir = path.join(tempDir, 'migrations');
      fs.mkdirSync(preT12MigrationsDir, { recursive: true });
      fs.copyFileSync(
        path.join(migrationsSrc, 'migration_lock.toml'),
        path.join(preT12MigrationsDir, 'migration_lock.toml')
      );
      for (const entry of fs.readdirSync(migrationsSrc)) {
        if (
          entry === 'migration_lock.toml' ||
          entry >= '20261126000000_t12_document_versions_and_links'
        ) {
          continue;
        }
        const full = path.join(migrationsSrc, entry);
        if (fs.statSync(full).isDirectory()) {
          fs.cpSync(full, path.join(preT12MigrationsDir, entry), { recursive: true });
        }
      }
      const tempSchema = path.join(tempDir, 'schema.prisma');
      fs.copyFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), tempSchema);

      runPrismaMigrateDeploy(db.url, tempSchema);

      // Seed populated pre-T12/T11 operational rows before deploying T12 migration
      const seedUserId = crypto.randomUUID();
      const seedCourtId = crypto.randomUUID();
      const seedPartyId = crypto.randomUUID();
      const seedMatterId = crypto.randomUUID();
      const seedProcId = crypto.randomUUID();
      const seedHearingId = crypto.randomUUID();
      const seedPoaId = crypto.randomUUID();
      const seedHrId = crypto.randomUUID();
      const seedDeadlineId = crypto.randomUUID();
      const seedDocId = crypto.randomUUID();
      const seedVerId = crypto.randomUUID();

      await db.pool.query(
        `INSERT INTO "court" ("id", "name", "isActive", "createdById", "updatedById", "updatedAt")
         VALUES ($1, 'محكمة ترقية T12', true, $2, $2, NOW())`,
        [seedCourtId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "createdById", "updatedById", "updatedAt")
         VALUES ($1, 'PERSON', 'موكل قبل T12', 'موكل قبل T12', $2, $2, NOW())`,
        [seedPartyId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "matter" ("id", "fileCode", "title", "kind", "status", "createdById", "updatedById", "updatedAt")
         VALUES ($1, 'LO-2026-T12MIG', 'ملف قبل T12', 'LITIGATION', 'ACTIVE', $2, $2, NOW())`,
        [seedMatterId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "proceeding" ("id", "matterId", "courtId", "instance", "numberText", "yearLabel", "registerType", "status", "createdById", "updatedById", "updatedAt")
         VALUES ($1, $2, $3, 'FIRST_INSTANCE', '991', '2026', 'مدني', 'ACTIVE', $4, $4, NOW())`,
        [seedProcId, seedMatterId, seedCourtId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "hearing" ("id", "proceeding_id", "hearing_date", "status", "created_by_id", "updated_by_id", "updated_at")
         VALUES ($1, $2, $3::date, 'COMPLETED', $4, $4, NOW())`,
        [seedHearingId, seedProcId, formatOffsetYmd(20), seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "power_of_attorney" ("id", "partyId", "poaNumberText", "poaYearLabel", "notarizationOffice", "poaType", "createdById", "updatedById", "updatedAt")
         VALUES ($1, $2, '0011', '2026', 'مكتب التوثيق', 'GENERAL', $3, $3, NOW())`,
        [seedPoaId, seedPartyId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "hearing_result" ("id", "hearing_id", "decision_text", "next_date_disposition", "recorded_at", "created_by_id", "updated_by_id", "updated_at")
         VALUES ($1, $2, 'قرار قبل T12', 'NONE', NOW(), $3, $3, NOW())`,
        [seedHrId, seedHearingId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "deadline" ("id", "matter_id", "proceeding_id", "title", "status", "created_by_id", "updated_by_id", "updated_at")
         VALUES ($1, $2, $3, 'ميعاد قبل T12', 'DRAFT', $4, $4, NOW())`,
        [seedDeadlineId, seedMatterId, seedProcId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "document" ("id", "matter_id", "party_id", "title", "title_normalized", "document_type", "created_by_id", "updated_by_id")
         VALUES ($1, $2, NULL, 'مستند ترقية T12', 'مستند ترقيه T12', 'CONTRACT', $3, $3)`,
        [seedDocId, seedMatterId, seedUserId]
      );
      await db.pool.query(
        `INSERT INTO "document_version" ("id", "document_id", "version_number", "object_key", "original_filename", "size_bytes", "upload_status", "scan_status", "created_by_id")
         VALUES ($1, $2, 1, 'ready/mig-v1.pdf', 'mig-v1.pdf', 120, 'READY', 'NOT_SCANNED_POLICY', $3)`,
        [seedVerId, seedDocId, seedUserId]
      );

      // Deploy T12 migration forward
      runPrismaMigrateDeploy(db.url);

      // Verify pre-existing rows survived with nullable new link columns
      const poaPre = await db.pool.query(
        `SELECT "document_id" FROM "power_of_attorney" WHERE "id" = $1`,
        [seedPoaId]
      );
      expect(poaPre.rows[0].document_id).toBeNull();
      const hrPre = await db.pool.query(
        `SELECT "decision_document_id" FROM "hearing_result" WHERE "id" = $1`,
        [seedHrId]
      );
      expect(hrPre.rows[0].decision_document_id).toBeNull();

      // Verify upload_attempt_expected_document_version_check accepts NULL and >= 1 while rejecting <= 0
      const nullVerAttemptId = crypto.randomUUID();
      const posVerAttemptId = crypto.randomUUID();
      await db.pool.query(
        `INSERT INTO "upload_attempt" ("id", "idempotency_record_id", "actor_id", "matter_id", "title", "document_type", "original_filename", "declared_mime", "expected_size_bytes", "quarantine_key", "expected_document_version", "expires_at")
         VALUES ($1, $2, $3, $4, 'إصدار فارغ', 'OTHER', 'vnull.pdf', 'application/pdf', 100, 'q/vnull.pdf', NULL, NOW() + interval '1 day')`,
        [nullVerAttemptId, crypto.randomUUID(), seedUserId, seedMatterId]
      );
      await db.pool.query(
        `INSERT INTO "upload_attempt" ("id", "idempotency_record_id", "actor_id", "matter_id", "title", "document_type", "original_filename", "declared_mime", "expected_size_bytes", "quarantine_key", "expected_document_version", "expires_at")
         VALUES ($1, $2, $3, $4, 'إصدار موجب', 'OTHER', 'v1.pdf', 'application/pdf', 100, 'q/v1.pdf', 1, NOW() + interval '1 day')`,
        [posVerAttemptId, crypto.randomUUID(), seedUserId, seedMatterId]
      );
      const validAttemptsRes = await db.pool.query(
        `SELECT "id", "expected_document_version" FROM "upload_attempt" WHERE "id" IN ($1, $2) ORDER BY "original_filename"`,
        [nullVerAttemptId, posVerAttemptId]
      );
      expect(validAttemptsRes.rows).toEqual([
        { id: posVerAttemptId, expected_document_version: 1 },
        { id: nullVerAttemptId, expected_document_version: null },
      ]);

      await expect(
        db.pool.query(
          `INSERT INTO "upload_attempt" ("id", "idempotency_record_id", "actor_id", "matter_id", "title", "document_type", "original_filename", "declared_mime", "expected_size_bytes", "quarantine_key", "expected_document_version", "expires_at")
           VALUES ($1, $2, $3, $4, 'إصدار صفر', 'OTHER', 'v0.pdf', 'application/pdf', 100, 'q/v0.pdf', 0, NOW() + interval '1 day')`,
          [crypto.randomUUID(), crypto.randomUUID(), seedUserId, seedMatterId]
        )
      ).rejects.toThrow(/upload_attempt_expected_document_version_check/);

      await expect(
        db.pool.query(
          `INSERT INTO "upload_attempt" ("id", "idempotency_record_id", "actor_id", "matter_id", "title", "document_type", "original_filename", "declared_mime", "expected_size_bytes", "quarantine_key", "expected_document_version", "expires_at")
           VALUES ($1, $2, $3, $4, 'إصدار سالب', 'OTHER', 'vneg.pdf', 'application/pdf', 100, 'q/vneg.pdf', -1, NOW() + interval '1 day')`,
          [crypto.randomUUID(), crypto.randomUUID(), seedUserId, seedMatterId]
        )
      ).rejects.toThrow(/upload_attempt_expected_document_version_check/);

      // Verify all 3 new FKs exist in pg_constraint, reject dangling document_id, and ON DELETE SET NULL works
      const fkRes = await db.pool.query(`
        SELECT conname
        FROM pg_constraint
        WHERE conname IN (
          'power_of_attorney_document_id_fkey',
          'hearing_result_decision_document_id_fkey',
          'deadline_source_document_id_fkey'
        )
        ORDER BY conname;
      `);
      expect(fkRes.rows.map((r: { conname: string }) => r.conname)).toEqual([
        'deadline_source_document_id_fkey',
        'hearing_result_decision_document_id_fkey',
        'power_of_attorney_document_id_fkey',
      ]);

      const danglingDocId = crypto.randomUUID();
      await expect(
        db.pool.query(
          `UPDATE "power_of_attorney" SET "document_id" = $1 WHERE "id" = $2`,
          [danglingDocId, seedPoaId]
        )
      ).rejects.toThrow(/power_of_attorney_document_id_fkey/);

      await expect(
        db.pool.query(
          `UPDATE "hearing_result" SET "decision_document_id" = $1 WHERE "id" = $2`,
          [danglingDocId, seedHrId]
        )
      ).rejects.toThrow(/hearing_result_decision_document_id_fkey/);

      await expect(
        db.pool.query(
          `UPDATE "deadline" SET "source_document_id" = $1 WHERE "id" = $2`,
          [danglingDocId, seedDeadlineId]
        )
      ).rejects.toThrow(/deadline_source_document_id_fkey/);

      // Valid links + ON DELETE SET NULL preservation
      await db.pool.query(`UPDATE "power_of_attorney" SET "document_id" = $1 WHERE "id" = $2`, [
        seedDocId,
        seedPoaId,
      ]);
      await db.pool.query(`UPDATE "hearing_result" SET "decision_document_id" = $1 WHERE "id" = $2`, [
        seedDocId,
        seedHrId,
      ]);
      await db.pool.query(`UPDATE "deadline" SET "source_document_id" = $1 WHERE "id" = $2`, [
        seedDocId,
        seedDeadlineId,
      ]);

      await db.pool.query(`DELETE FROM "document_version" WHERE "document_id" = $1`, [seedDocId]);
      await db.pool.query(`DELETE FROM "document" WHERE "id" = $1`, [seedDocId]);

      expect(
        (await db.pool.query(`SELECT "document_id" FROM "power_of_attorney" WHERE "id" = $1`, [seedPoaId]))
          .rows[0].document_id
      ).toBeNull();
      expect(
        (
          await db.pool.query(
            `SELECT "decision_document_id" FROM "hearing_result" WHERE "id" = $1`,
            [seedHrId]
          )
        ).rows[0].decision_document_id
      ).toBeNull();
      expect(
        (
          await db.pool.query(
            `SELECT "source_document_id" FROM "deadline" WHERE "id" = $1`,
            [seedDeadlineId]
          )
        ).rows[0].source_document_id
      ).toBeNull();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await db.drop();
    }
  }, 90000);

  it('T12-TC-01: addVersion promotes v2 READY with distinct key/checksum/ADR-0003 policy and preserves v1 historical download', async () => {
    const v1Bytes = buildSyntheticPdf(`T12-TC01-V1-${runSuffix}`);
    const v1Hash = sha256Hex(v1Bytes);
    const v2Bytes = buildSyntheticPng(0x7a);
    const v2Hash = sha256Hex(v2Bytes);

    const docV1 = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: proceedingA1Id,
      title: `عقد بيع ابتدائي T12 ${runSuffix}`,
      filename: 'contract-v1.pdf',
      bytes: v1Bytes,
    });
    const v1Id = docV1.currentVersionId!;
    expect(docV1.version).toBe(1);
    expect(docV1.currentVersion?.versionNumber).toBe(1);
    expect(docV1.currentVersion?.scanStatus).toBe('NOT_SCANNED_POLICY');
    expect(docV1.currentVersion?.scanPolicyCode).toBe(ADR_0003_POLICY_CODE);
    expect(docV1.currentVersion?.scanPolicyVersion).toBe(ADR_0003_POLICY_VERSION);

    // Begin version 2 upload via HTTP POST /api/documents/[id]/versions
    const beginVerReq = new Request(`${trustedOrigin}/api/documents/${docV1.id}/versions`, {
      method: 'POST',
      headers: {
        origin: trustedOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        cookie: ownerCookie,
      },
      body: JSON.stringify({
        expectedDocumentVersion: docV1.version,
        originalFilename: 'contract-v2.png',
        declaredMime: 'image/png',
        expectedSizeBytes: v2Bytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const beginVerRes = await postDocumentVersionRoute(beginVerReq, {
      params: Promise.resolve({ id: docV1.id }),
    });
    expect(beginVerRes.status).toBe(201);
    const beginVerJson = (await beginVerRes.json()) as {
      success: boolean;
      data: { id: string; documentId: string; status: string };
    };
    expect(beginVerJson.success).toBe(true);
    expect(beginVerJson.data.documentId).toBe(docV1.id);
    const attemptV2Id = beginVerJson.data.id;
    createdAttemptIds.push(attemptV2Id);

    // Upload bytes to quarantine — currentVersionId must still be v1 until READY finalization
    await uploadAttemptBytes(owner, attemptV2Id, v2Bytes);
    const beforeFinalize = await getDocumentDetail(owner, docV1.id);
    expect(beforeFinalize.currentVersionId).toBe(v1Id);
    expect(beforeFinalize.versions).toHaveLength(1);

    // Finalize v2
    const docV2 = await finalizeUpload(owner, { attemptId: attemptV2Id });
    expect(docV2.version).toBe(2);
    expect(docV2.currentVersionId).not.toBe(v1Id);
    expect(docV2.currentVersion?.versionNumber).toBe(2);
    expect(docV2.currentVersion?.uploadStatus).toBe('READY');
    expect(docV2.currentVersion?.sha256).toBe(v2Hash);
    expect(docV2.currentVersion?.scanStatus).toBe('NOT_SCANNED_POLICY');
    expect(docV2.currentVersion?.scanPolicyCode).toBe(ADR_0003_POLICY_CODE);
    expect(docV2.currentVersion?.scanPolicyVersion).toBe(ADR_0003_POLICY_VERSION);
    expect(docV2.currentVersion?.scanCheckedAt).toBeTruthy();

    const detail = await getDocumentDetail(owner, docV1.id);
    expect(detail.versions.map((v) => v.versionNumber)).toEqual([2, 1]);

    // Verify distinct objectKeys and exact bytes on disk
    const [ver1Row, ver2Row] = await Promise.all([
      prisma.documentVersion.findUniqueOrThrow({ where: { id: v1Id } }),
      prisma.documentVersion.findUniqueOrThrow({ where: { id: docV2.currentVersionId! } }),
    ]);
    expect(ver1Row.objectKey).not.toBe(ver2Row.objectKey);
    expect(ver1Row.sha256).toBe(v1Hash);
    expect(ver2Row.sha256).toBe(v2Hash);
    expect(ver1Row.scanStatus).toBe('NOT_SCANNED_POLICY');
    expect(ver2Row.scanStatus).toBe('NOT_SCANNED_POLICY');
    expect(ver1Row.scanPolicyCode).toBe(ADR_0003_POLICY_CODE);
    expect(ver2Row.scanPolicyCode).toBe(ADR_0003_POLICY_CODE);

    // Download v1 explicitly from history (service + HTTP route) and current v2
    const dlV1 = await authorizeDownload(owner, docV1.id, v1Id);
    expect(await dlV1.readBytes()).toEqual(v1Bytes);

    const httpV1Res = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${docV1.id}/content?versionId=${v1Id}`, {
        headers: { cookie: ownerCookie, 'sec-fetch-site': 'same-origin' },
      }),
      { params: Promise.resolve({ id: docV1.id }) }
    );
    expect(httpV1Res.status).toBe(200);
    expect(sha256Hex(Buffer.from(await httpV1Res.arrayBuffer()))).toBe(v1Hash);

    const dlV2 = await authorizeDownload(owner, docV1.id);
    expect(await dlV2.readBytes()).toEqual(v2Bytes);
  }, 60_000);

  it('T12-TC-02: rejected candidate, injected DB failure, archived parents, and concurrent addVersion race preserve currentVersionId and block stale overwrite', async () => {
    const v1Bytes = buildSyntheticPdf(`T12-TC02-V1-${runSuffix}`);
    const v1Hash = sha256Hex(v1Bytes);
    const doc = await createReadyMatterDocument({
      matterId: matterAId,
      title: `محضر تعارض الإصدارات T12 ${runSuffix}`,
      filename: 'race-v1.pdf',
      bytes: v1Bytes,
    });
    const v1Id = doc.currentVersionId!;

    // 1) Rejected candidate (disguised text as .jpg)
    const badAttempt = await beginVersionUpload(owner, {
      documentId: doc.id,
      expectedDocumentVersion: doc.version,
      originalFilename: 'forged.jpg',
      declaredMime: 'image/jpeg',
      expectedSizeBytes: 32,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(badAttempt.id);
    const forgedBytes = Buffer.from('THIS_IS_TEXT_NOT_A_JPEG_IMAGE!!!', 'ascii');
    await uploadAttemptBytes(owner, badAttempt.id, forgedBytes);
    await expect(finalizeUpload(owner, { attemptId: badAttempt.id })).rejects.toThrow(
      DocumentValidationError
    );

    const afterRejected = await getDocumentDetail(owner, doc.id);
    expect(afterRejected.currentVersionId).toBe(v1Id);
    expect(afterRejected.version).toBe(1);
    expect(afterRejected.versions).toHaveLength(1);
    expect(sha256Hex(await (await authorizeDownload(owner, doc.id)).readBytes())).toBe(v1Hash);

    // 2) Pre-tx writeReadyBytes + injected DB failure during version finalization deletes ready/ on rollback
    const storage = createLocalDocumentStorage(storageRoot);
    const readyKeysBeforeDbFail = (await storage.listKeys!('ready')).map((f) => f.key);
    let wroteReadyKey: string | null = null;
    const spiedStorage = {
      ...storage,
      async writeReadyBytes(key: string, bytes: Buffer) {
        wroteReadyKey = key;
        return storage.writeReadyBytes(key, bytes);
      },
    };
    const v2FailBytes = buildSyntheticPdf(`T12-TC02-DBFAIL-${runSuffix}`);
    const failAttempt = await beginVersionUpload(owner, {
      documentId: doc.id,
      expectedDocumentVersion: doc.version,
      originalFilename: 'dbfail-v2.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: v2FailBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(failAttempt.id);
    await uploadAttemptBytes(owner, failAttempt.id, v2FailBytes);
    await expect(
      finalizeUpload(owner, { attemptId: failAttempt.id }, { simulateDbFailure: true, storage: spiedStorage })
    ).rejects.toThrow('SIMULATED_DB_FINALIZATION_FAILURE');

    expect(wroteReadyKey).not.toBeNull();
    expect(await storage.exists('ready', wroteReadyKey!)).toBe(false);
    const readyKeysAfterDbFail = (await storage.listKeys!('ready')).map((f) => f.key);
    expect(readyKeysAfterDbFail).toEqual(readyKeysBeforeDbFail);

    const afterDbFail = await getDocumentDetail(owner, doc.id);
    expect(afterDbFail.currentVersionId).toBe(v1Id);
    expect(afterDbFail.version).toBe(1);
    expect(afterDbFail.versions).toHaveLength(1);
    expect(sha256Hex(await (await authorizeDownload(owner, doc.id)).readBytes())).toBe(v1Hash);

    // 2b) REQUIRED scan-policy failure on version finalizeUpload leaves currentVersionId unchanged
    const policyFailBytes = buildSyntheticPdf(`T12-TC02-POLICYFAIL-${runSuffix}`);
    const policyAttempt = await beginVersionUpload(owner, {
      documentId: doc.id,
      expectedDocumentVersion: doc.version,
      originalFilename: 'policy-fail-v2.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: policyFailBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(policyAttempt.id);
    await uploadAttemptBytes(owner, policyAttempt.id, policyFailBytes);
    await expect(
      finalizeUpload(
        owner,
        { attemptId: policyAttempt.id },
        { scanPolicyMode: 'REQUIRED', storage }
      )
    ).rejects.toThrow(DocumentScanPolicyUnavailableError);
    const afterPolicyFail = await getDocumentDetail(owner, doc.id);
    expect(afterPolicyFail.currentVersionId).toBe(v1Id);
    expect(afterPolicyFail.version).toBe(1);
    const policyAttemptAfter = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: policyAttempt.id },
    });
    expect(policyAttemptAfter.status).toBe('UPLOADED');

    // 2c) Archived parents (proceeding, hearingId->archived proceeding, Matter, Party, Document) reject addVersion
    const disposableProc = await addProceeding(owner, {
      matterId: matterAId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: `1299-${runSuffix}`,
      yearLabel: '2026',
      registerType: 'مدني',
      idempotencyKey: crypto.randomUUID(),
    });
    const disposableHearing = await scheduleHearing(owner, {
      proceedingId: disposableProc.id,
      hearingDate: formatOffsetYmd(25),
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(disposableHearing.id);
    const procDoc = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: disposableProc.id,
      title: `مستند قيد سيؤرشف T12 ${runSuffix}`,
      filename: 'proc-v1.pdf',
      bytes: buildSyntheticPdf(`T12-TC02-PROC-${runSuffix}`),
    });
    const hearingDoc = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: null,
      hearingId: disposableHearing.id,
      title: `مستند جلسة قيد سيؤرشف T12 ${runSuffix}`,
      filename: 'hearing-proc-v1.pdf',
      bytes: buildSyntheticPdf(`T12-TC02-HEAR-PROC-${runSuffix}`),
    });
    const preArchivedAttempt = await beginVersionUpload(owner, {
      documentId: procDoc.id,
      expectedDocumentVersion: procDoc.version,
      originalFilename: 'proc-v2.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: policyFailBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(preArchivedAttempt.id);
    await uploadAttemptBytes(owner, preArchivedAttempt.id, policyFailBytes);
    const disposableHr = await recordHearingResult(owner, {
      hearingId: disposableHearing.id,
      expectedVersion: 1,
      decision: 'قفل الجلسة تمهيداً لأرشفة القيد',
      nextDateDisposition: 'NONE',
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingResultIds.push(disposableHr.resultId);
    await archiveProceeding(owner, {
      proceedingId: disposableProc.id,
      matterId: matterAId,
      expectedVersion: disposableProc.version,
      reason: 'أرشفة لاختبار رفض إضافة نسخة جديدة',
      idempotencyKey: crypto.randomUUID(),
    });
    for (const targetId of [procDoc.id, hearingDoc.id]) {
      await expect(
        beginVersionUpload(owner, {
          documentId: targetId,
          expectedDocumentVersion: 1,
          originalFilename: 'proc-v2-after.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 256,
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toThrow(DocumentValidationError);
    }
    await expect(
      finalizeUpload(owner, { attemptId: preArchivedAttempt.id }, { storage })
    ).rejects.toThrow(DocumentValidationError);

    // Archived Matter rejects addVersion
    const archMatter = await openMatter(owner, {
      title: `قضية أرشفة إضافة نسخة ${runSuffix}`,
      kind: 'LITIGATION',
      initialClientId: partyClientAId,
      idempotencyKey: crypto.randomUUID(),
    });
    createdMatterIds.push(archMatter.matter.id);
    const archMatterDoc = await createReadyMatterDocument({
      matterId: archMatter.matter.id,
      title: `مستند قضية مؤرشفة ${runSuffix}`,
      bytes: buildSyntheticPdf(`T12-TC02-ARCH-MATTER-${runSuffix}`),
    });
    await archiveMatter(owner, {
      matterId: archMatter.matter.id,
      expectedVersion: archMatter.matter.version,
      reason: 'أرشفة القضية لمنع إضافة نسخ',
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      beginVersionUpload(owner, {
        documentId: archMatterDoc.id,
        expectedDocumentVersion: 1,
        originalFilename: 'arch-matter-v2.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 256,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(DocumentValidationError);

    // Archived Party rejects addVersion
    const archParty = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `طرف مؤرشف إضافة نسخة ${runSuffix}`,
        nameNormalized: `طرف مؤرشف اضافه نسخه ${runSuffix}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(archParty.id);
    const archPartyBytes = buildSyntheticPdf(`T12-TC02-ARCH-PARTY-${runSuffix}`);
    const archPartyInit = await beginUpload(owner, {
      partyId: archParty.id,
      title: `مستند طرف سيؤرشف ${runSuffix}`,
      documentType: 'ID_COPY',
      originalFilename: 'party-v1.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: archPartyBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(archPartyInit.id);
    await uploadAttemptBytes(owner, archPartyInit.id, archPartyBytes);
    const archPartyDoc = await finalizeUpload(owner, { attemptId: archPartyInit.id });
    createdDocumentIds.push(archPartyDoc.id);
    await prisma.party.update({
      where: { id: archParty.id },
      data: { archivedAt: new Date() },
    });
    await expect(
      beginVersionUpload(owner, {
        documentId: archPartyDoc.id,
        expectedDocumentVersion: 1,
        originalFilename: 'arch-party-v2.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 256,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(DocumentValidationError);

    // Archived Document itself rejects addVersion
    const archSelfDoc = await createReadyMatterDocument({
      matterId: matterAId,
      title: `مستند ذاته مؤرشف ${runSuffix}`,
      bytes: buildSyntheticPdf(`T12-TC02-ARCH-DOC-${runSuffix}`),
    });
    await prisma.document.update({
      where: { id: archSelfDoc.id },
      data: { archivedAt: new Date() },
    });
    await expect(
      beginVersionUpload(owner, {
        documentId: archSelfDoc.id,
        expectedDocumentVersion: 1,
        originalFilename: 'arch-doc-v2.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 256,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(DocumentValidationError);

    // 3) Concurrent addVersion race from the same expectedDocumentVersion
    const winnerBytes = buildSyntheticPdf(`T12-TC02-RACE-A-${runSuffix}`);
    const loserBytes = buildSyntheticPdf(`T12-TC02-RACE-B-${runSuffix}`);

    const [attemptA, attemptB] = await Promise.all([
      beginVersionUpload(owner, {
        documentId: doc.id,
        expectedDocumentVersion: 1,
        originalFilename: 'race-a.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: winnerBytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      }),
      beginVersionUpload(owner, {
        documentId: doc.id,
        expectedDocumentVersion: 1,
        originalFilename: 'race-b.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: loserBytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    createdAttemptIds.push(attemptA.id, attemptB.id);

    await Promise.all([
      uploadAttemptBytes(owner, attemptA.id, winnerBytes),
      uploadAttemptBytes(owner, attemptB.id, loserBytes),
    ]);

    const raceResults = await Promise.allSettled([
      finalizeUpload(owner, { attemptId: attemptA.id }),
      finalizeUpload(owner, { attemptId: attemptB.id }),
    ]);

    const fulfilled = raceResults.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof finalizeUpload>>> =>
        r.status === 'fulfilled'
    );
    const rejected = raceResults.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConcurrencyConflictError);

    const raceAttempts = await prisma.uploadAttempt.findMany({
      where: { id: { in: [attemptA.id, attemptB.id] } },
    });
    expect(raceAttempts.map((a) => a.status).sort()).toEqual(['FINALIZED', 'REJECTED']);

    const winnerDoc = fulfilled[0].value;
    expect(winnerDoc.version).toBe(2);
    expect(winnerDoc.currentVersion?.versionNumber).toBe(2);

    const afterRace = await getDocumentDetail(owner, doc.id);
    expect(afterRace.version).toBe(2);
    expect(afterRace.currentVersionId).toBe(winnerDoc.currentVersionId);
    expect(afterRace.versions).toHaveLength(2);
    const currentBytesHash = sha256Hex(await (await authorizeDownload(owner, doc.id)).readBytes());
    expect(currentBytesHash).toBe(afterRace.currentVersion?.sha256);

    // Explicit stale expectedDocumentVersion at finalizeUpload leaves attempt 'REJECTED' and cleans quarantine
    const staleBytes = buildSyntheticPdf(`T12-TC02-STALE-FIN-${runSuffix}`);
    const advanceBytes = buildSyntheticPdf(`T12-TC02-ADVANCE-V3-${runSuffix}`);
    const staleFinAttempt = await beginVersionUpload(owner, {
      documentId: doc.id,
      expectedDocumentVersion: 2,
      originalFilename: 'stale-fin.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: staleBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(staleFinAttempt.id);
    await uploadAttemptBytes(owner, staleFinAttempt.id, staleBytes);

    const advanceAttempt = await beginVersionUpload(owner, {
      documentId: doc.id,
      expectedDocumentVersion: 2,
      originalFilename: 'advance-v3.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: advanceBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(advanceAttempt.id);
    await uploadAttemptBytes(owner, advanceAttempt.id, advanceBytes);
    await finalizeUpload(owner, { attemptId: advanceAttempt.id });

    await expect(
      finalizeUpload(owner, { attemptId: staleFinAttempt.id }, { storage })
    ).rejects.toThrow(ConcurrencyConflictError);
    const staleAttemptRow = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: staleFinAttempt.id },
    });
    expect(staleAttemptRow.status).toBe('REJECTED');
    expect(await storage.exists('quarantine', staleAttemptRow.quarantineKey)).toBe(false);

    // HTTP beginVersionUpload with stale expectedDocumentVersion must return 409
    const staleBeginRes = await postDocumentVersionRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}/versions`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          expectedDocumentVersion: 1,
          originalFilename: 'stale-v3.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 512,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(staleBeginRes.status).toBe(409);
  }, 60_000);

  it('T12-TC-03: updateDocumentMetadata updates originalPresent & location independently of immutable bytes, enforces expectedVersion, idempotency, archive & auth boundaries', async () => {
    const v1Bytes = buildSyntheticPdf(`T12-TC03-ORIGINAL-${runSuffix}`);
    const v1Hash = sha256Hex(v1Bytes);

    const doc = await createReadyMatterDocument({
      matterId: matterAId,
      title: `حافظة أصل ورقي T12 ${runSuffix}`,
      originalPresent: 'UNKNOWN',
      originalLocation: null,
      filename: 'original-check.pdf',
      bytes: v1Bytes,
    });
    expect(doc.originalPresent).toBe('UNKNOWN');
    expect(doc.originalLocation).toBeNull();
    const versionRowBefore = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: doc.currentVersionId! },
    });

    // Empty no-op PATCH payload must reject with 400
    const emptyPatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          expectedVersion: doc.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(emptyPatchRes.status).toBe(400);

    // UNKNOWN -> YES + paper location
    const yesUpdated = await updateDocumentMetadata(owner, {
      documentId: doc.id,
      expectedVersion: doc.version,
      idempotencyKey: crypto.randomUUID(),
      originalPresent: 'YES',
      originalLocation: 'خزينة العقود الرئيسية — دولاب 2 — رف ب',
    });
    expect(yesUpdated.originalPresent).toBe('YES');
    expect(yesUpdated.originalLocation).toBe('خزينة العقود الرئيسية — دولاب 2 — رف ب');
    expect(yesUpdated.version).toBe(2);
    expect(yesUpdated.currentVersionId).toBe(doc.currentVersionId);

    // YES -> NO via PATCH /api/documents/[id] + verify idempotency replay & mismatch
    const noPatchIdemKey = crypto.randomUUID();
    const noPatchPayload = {
      expectedVersion: yesUpdated.version,
      idempotencyKey: noPatchIdemKey,
      originalPresent: 'NO',
      originalLocation: null,
    };
    const patchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify(noPatchPayload),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as {
      success: boolean;
      data: { originalPresent: string; originalLocation: string | null; version: number };
    };
    expect(patchJson.success).toBe(true);
    expect(patchJson.data.originalPresent).toBe('NO');
    expect(patchJson.data.originalLocation).toBeNull();
    expect(patchJson.data.version).toBe(3);

    const replayPatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify(noPatchPayload),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(replayPatchRes.status).toBe(200);
    const replayPatchJson = (await replayPatchRes.json()) as {
      success: boolean;
      data: { version: number; originalPresent: string };
    };
    expect(replayPatchJson.data.version).toBe(3);
    expect(replayPatchJson.data.originalPresent).toBe('NO');

    const mismatchPatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          ...noPatchPayload,
          originalPresent: 'UNKNOWN',
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(mismatchPatchRes.status).toBe(409);

    // NO -> UNKNOWN via PATCH /api/documents/[id]
    const unknownPatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          expectedVersion: 3,
          idempotencyKey: crypto.randomUUID(),
          originalPresent: 'UNKNOWN',
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(unknownPatchRes.status).toBe(200);
    const unknownPatchJson = (await unknownPatchRes.json()) as {
      success: boolean;
      data: { originalPresent: string; version: number };
    };
    expect(unknownPatchJson.data.originalPresent).toBe('UNKNOWN');
    expect(unknownPatchJson.data.version).toBe(4);

    // Stale expectedVersion returns 409
    const stalePatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          expectedVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          originalPresent: 'YES',
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(stalePatchRes.status).toBe(409);

    // Auth & cross-site boundaries on PATCH /api/documents/[id]
    const unauthPatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expectedVersion: 4,
          idempotencyKey: crypto.randomUUID(),
          originalPresent: 'YES',
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(unauthPatchRes.status).toBe(401);

    const revokedPatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: revokedOwnerCookie,
        },
        body: JSON.stringify({
          expectedVersion: 4,
          idempotencyKey: crypto.randomUUID(),
          originalPresent: 'YES',
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(revokedPatchRes.status).toBe(401);

    const maintPatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: maintainerCookie,
        },
        body: JSON.stringify({
          expectedVersion: 4,
          idempotencyKey: crypto.randomUUID(),
          originalPresent: 'YES',
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(maintPatchRes.status).toBe(403);

    const crossSitePatchRes = await patchDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          expectedVersion: 4,
          idempotencyKey: crypto.randomUUID(),
          originalPresent: 'YES',
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(crossSitePatchRes.status).toBe(403);

    // Archived Matter, Proceeding, Party, and Document reject PATCH /api/documents/[id]
    const patchArchMatter = await openMatter(owner, {
      title: `قضية أرشفة تعديل مستند ${runSuffix}`,
      kind: 'LITIGATION',
      initialClientId: partyClientAId,
      idempotencyKey: crypto.randomUUID(),
    });
    createdMatterIds.push(patchArchMatter.matter.id);
    const patchArchProc = await addProceeding(owner, {
      matterId: matterAId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: `3301-${runSuffix}`,
      yearLabel: '2026',
      registerType: 'مدني',
      idempotencyKey: crypto.randomUUID(),
    });
    const patchArchParty = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `طرف أرشفة تعديل ${runSuffix}`,
        nameNormalized: `طرف ارشفه تعديل ${runSuffix}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(patchArchParty.id);

    const docOnArchMatter = await createReadyMatterDocument({
      matterId: patchArchMatter.matter.id,
      title: `مستند قضية ستؤرشف للتعديل ${runSuffix}`,
      bytes: buildSyntheticPdf(`T12-TC03-ARCH-M-${runSuffix}`),
    });
    const docOnArchProc = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: patchArchProc.id,
      title: `مستند قيد سيؤرشف للتعديل ${runSuffix}`,
      bytes: buildSyntheticPdf(`T12-TC03-ARCH-PR-${runSuffix}`),
    });
    const archPartyPatchBytes = buildSyntheticPdf(`T12-TC03-ARCH-PA-${runSuffix}`);
    const archPartyPatchAttempt = await beginUpload(owner, {
      partyId: patchArchParty.id,
      title: `مستند طرف سيؤرشف للتعديل ${runSuffix}`,
      documentType: 'ID_COPY',
      originalFilename: 'party-meta.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: archPartyPatchBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(archPartyPatchAttempt.id);
    await uploadAttemptBytes(owner, archPartyPatchAttempt.id, archPartyPatchBytes);
    const docOnArchParty = await finalizeUpload(owner, { attemptId: archPartyPatchAttempt.id });
    createdDocumentIds.push(docOnArchParty.id);

    const docArchSelf = await createReadyMatterDocument({
      matterId: matterAId,
      title: `مستند ذاته سيؤرشف للتعديل ${runSuffix}`,
      bytes: buildSyntheticPdf(`T12-TC03-ARCH-SELF-${runSuffix}`),
    });

    await archiveMatter(owner, {
      matterId: patchArchMatter.matter.id,
      expectedVersion: patchArchMatter.matter.version,
      reason: 'أرشفة لاختبار PATCH',
      idempotencyKey: crypto.randomUUID(),
    });
    await archiveProceeding(owner, {
      proceedingId: patchArchProc.id,
      matterId: matterAId,
      expectedVersion: patchArchProc.version,
      reason: 'أرشفة لاختبار PATCH',
      idempotencyKey: crypto.randomUUID(),
    });
    await prisma.party.update({
      where: { id: patchArchParty.id },
      data: { archivedAt: new Date() },
    });
    await prisma.document.update({
      where: { id: docArchSelf.id },
      data: { archivedAt: new Date() },
    });

    for (const archivedTargetId of [
      docOnArchMatter.id,
      docOnArchProc.id,
      docOnArchParty.id,
      docArchSelf.id,
    ]) {
      const archivedPatchRes = await patchDocumentRoute(
        new Request(`${trustedOrigin}/api/documents/${archivedTargetId}`, {
          method: 'PATCH',
          headers: {
            origin: trustedOrigin,
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
            cookie: ownerCookie,
          },
          body: JSON.stringify({
            expectedVersion: 1,
            idempotencyKey: crypto.randomUUID(),
            originalPresent: 'YES',
          }),
        }),
        { params: Promise.resolve({ id: archivedTargetId }) }
      );
      expect(archivedPatchRes.status).toBe(400);
    }

    // Verify immutable digital version bytes/checksum/objectKey
    const versionRowAfter = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: doc.currentVersionId! },
    });
    expect(versionRowAfter.objectKey).toBe(versionRowBefore.objectKey);
    expect(versionRowAfter.sha256).toBe(v1Hash);
    expect(sha256Hex(await (await authorizeDownload(owner, doc.id)).readBytes())).toBe(v1Hash);
  }, 60_000);

  it('T12-TC-04: validates matter/principal/READY/archive lineage for HearingResult, Deadline, and POA links without auto-approval', async () => {
    const docABytes = buildSyntheticPdf(`T12-TC04-MATTER-A-${runSuffix}`);
    const docBBytes = buildSyntheticPdf(`T12-TC04-MATTER-B-${runSuffix}`);
    const partyABytes = buildSyntheticPdf(`T12-TC04-PARTY-A-${runSuffix}`);
    const partyOtherBytes = buildSyntheticPdf(`T12-TC04-PARTY-OTHER-${runSuffix}`);

    const docMatterA = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: proceedingA1Id,
      title: `قرار جلسة ملف أ T12 ${runSuffix}`,
      documentType: 'JUDGMENT',
      bytes: docABytes,
    });
    const docMatterB = await createReadyMatterDocument({
      matterId: matterBId,
      proceedingId: proceedingBId,
      title: `مستند ملف ب T12 ${runSuffix}`,
      documentType: 'JUDGMENT',
      bytes: docBBytes,
    });

    // Party-owned POA documents for partyClientA and partyOther
    const attemptPartyA = await beginUpload(owner, {
      partyId: partyClientAId,
      title: `صورة توكيل الموكل أ T12 ${runSuffix}`,
      documentType: 'POA_COPY',
      originalFilename: 'poa-a.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: partyABytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(attemptPartyA.id);
    await uploadAttemptBytes(owner, attemptPartyA.id, partyABytes);
    const docPartyA = await finalizeUpload(owner, { attemptId: attemptPartyA.id });
    createdDocumentIds.push(docPartyA.id);

    const attemptPartyOther = await beginUpload(owner, {
      partyId: partyOtherId,
      title: `صورة توكيل طرف آخر T12 ${runSuffix}`,
      documentType: 'POA_COPY',
      originalFilename: 'poa-other.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: partyOtherBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(attemptPartyOther.id);
    await uploadAttemptBytes(owner, attemptPartyOther.id, partyOtherBytes);
    const docPartyOther = await finalizeUpload(owner, { attemptId: attemptPartyOther.id });
    createdDocumentIds.push(docPartyOther.id);

    // Non-READY (QUARANTINED) and Archived documents on matterA
    const quarantinedDocId = crypto.randomUUID();
    const quarantinedVerId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: quarantinedDocId,
        matterId: matterAId,
        title: `مستند غير جاهز T12 ${runSuffix}`,
        titleNormalized: `مستند غير جاهز T12 ${runSuffix}`,
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
        objectKey: `q/t12-unready-${quarantinedVerId}.pdf`,
        originalFilename: 'unready.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 128,
        uploadStatus: 'QUARANTINED',
        scanStatus: 'PENDING',
        createdById: owner.id,
      },
    });
    await prisma.document.update({
      where: { id: quarantinedDocId },
      data: { currentVersionId: quarantinedVerId },
    });

    const archivedDoc = await createReadyMatterDocument({
      matterId: matterAId,
      title: `مستند مؤرشف T12 ${runSuffix}`,
      bytes: buildSyntheticPdf(`T12-TC04-ARCHIVED-${runSuffix}`),
    });
    await prisma.document.update({
      where: { id: archivedDoc.id },
      data: { archivedAt: new Date() },
    });

    // 1) HearingResult.decisionDocumentId: reject wrong matter (403), non-READY (409), archived (400), then accept valid matterA doc
    const badHearingWrongMatter = await postHearingResultRoute(
      new Request(`${trustedOrigin}/api/scheduling/hearings/${hearingA1Id}/result`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          hearingId: hearingA1Id,
          expectedVersion: 1,
          decision: 'تأجيل لتقديم المذكرات',
          nextDateDisposition: 'NONE',
          decisionDocumentId: docMatterB.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: hearingA1Id }) }
    );
    expect(badHearingWrongMatter.status).toBe(403);

    const badHearingNotReady = await postHearingResultRoute(
      new Request(`${trustedOrigin}/api/scheduling/hearings/${hearingA1Id}/result`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          hearingId: hearingA1Id,
          expectedVersion: 1,
          decision: 'تأجيل لتقديم المذكرات',
          nextDateDisposition: 'NONE',
          decisionDocumentId: quarantinedDocId,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: hearingA1Id }) }
    );
    expect(badHearingNotReady.status).toBe(409);

    const badHearingArchived = await postHearingResultRoute(
      new Request(`${trustedOrigin}/api/scheduling/hearings/${hearingA1Id}/result`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          hearingId: hearingA1Id,
          expectedVersion: 1,
          decision: 'تأجيل لتقديم المذكرات',
          nextDateDisposition: 'NONE',
          decisionDocumentId: archivedDoc.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: hearingA1Id }) }
    );
    expect(badHearingArchived.status).toBe(400);

    const validHearingRes = await postHearingResultRoute(
      new Request(`${trustedOrigin}/api/scheduling/hearings/${hearingA1Id}/result`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          hearingId: hearingA1Id,
          expectedVersion: 1,
          decision: 'تأجيل لتقديم المذكرات والمستندات',
          nextDateDisposition: 'NONE',
          decisionDocumentId: docMatterA.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: hearingA1Id }) }
    );
    expect(validHearingRes.status).toBe(200);
    const validHearingJson = (await validHearingRes.json()) as {
      success: boolean;
      data: { resultId: string; result: { decisionDocumentId: string | null } };
    };
    expect(validHearingJson.success).toBe(true);
    expect(validHearingJson.data.result.decisionDocumentId).toBe(docMatterA.id);
    createdHearingResultIds.push(validHearingJson.data.resultId);

    // 2) Deadline.sourceDocumentId: reject wrong matter (403), non-READY (409), archived (400); valid link stays DRAFT!
    const badDeadlineWrongMatter = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: 'ميعاد استئناف مرتبط بمستند خاطئ',
          sourceDocumentId: docMatterB.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(badDeadlineWrongMatter.status).toBe(403);

    const badDeadlineNotReady = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: 'ميعاد مرتبط بمستند غير جاهز',
          sourceDocumentId: quarantinedDocId,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(badDeadlineNotReady.status).toBe(409);

    const badDeadlineArchived = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: 'ميعاد مرتبط بمستند مؤرشف',
          sourceDocumentId: archivedDoc.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(badDeadlineArchived.status).toBe(400);

    // Cross-proceeding doc linked via hearingId-only (proceedingId=null, hearingId=hearingA1Id)
    const hearingOnlyDoc = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: null,
      hearingId: hearingA1Id,
      title: `مستند مرتبط بالجلسة فقط T12 ${runSuffix}`,
      documentType: 'MEMORANDUM',
      bytes: buildSyntheticPdf(`T12-TC04-HEARING-ONLY-${runSuffix}`),
    });

    // correctHearingResult on hearingA2Id: reject wrong-matter doc, then accept valid matterA/proceedingA2 doc
    const hrA2 = await recordHearingResult(owner, {
      hearingId: hearingA2Id,
      expectedVersion: 1,
      decision: 'حجز للحكم المبدئي',
      nextDateDisposition: 'NONE',
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingResultIds.push(hrA2.resultId);

    const docProceedingA2 = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: proceedingA2Id,
      title: `قرار قيد أ2 T12 ${runSuffix}`,
      documentType: 'JUDGMENT',
      bytes: buildSyntheticPdf(`T12-TC04-PROC-A2-${runSuffix}`),
    });

    await expect(
      correctHearingResult(owner, {
        hearingId: hearingA2Id,
        expectedVersion: 1,
        currentResultId: hrA2.resultId,
        decision: 'تصحيح بمستند خاطئ',
        reason: 'اختبار رفض مستند قضية أخرى عند التصحيح',
        decisionDocumentId: docMatterB.id,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    const correctedHrA2 = await correctHearingResult(owner, {
      hearingId: hearingA2Id,
      expectedVersion: 1,
      currentResultId: hrA2.resultId,
      decision: 'تصحيح بمستند صحيح',
      reason: 'إرفاق صورة القرار الصحيحة',
      decisionDocumentId: docProceedingA2.id,
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingResultIds.push(correctedHrA2.id);
    expect(correctedHrA2.decisionDocumentId).toBe(docProceedingA2.id);

    const validDeadlineRes = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: 'ميعاد استئناف بمستند مصدر صريح',
          sourceDocumentId: docMatterA.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(validDeadlineRes.status).toBe(200);
    const validDeadlineJson = (await validDeadlineRes.json()) as {
      success: boolean;
      data: {
        id: string;
        status: string;
        needsReview: boolean;
        sourceDocumentId: string | null;
        version: number;
      };
    };
    expect(validDeadlineJson.success).toBe(true);
    expect(validDeadlineJson.data.sourceDocumentId).toBe(docMatterA.id);
    // Attaching a source document must NEVER auto-confirm a DRAFT deadline
    expect(validDeadlineJson.data.status).toBe('DRAFT');
    expect(validDeadlineJson.data.needsReview).toBe(true);
    createdDeadlineIds.push(validDeadlineJson.data.id);

    // updateDeadlineDraft & confirmDeadline reject wrong-matter and cross-proceeding (hearingId-only) sourceDocumentId
    const draftOnProcA2Res = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA2Id,
          title: 'ميعاد قيد أ2 لاختبار المنع العابر',
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(draftOnProcA2Res.status).toBe(200);
    const draftOnProcA2 = ((await draftOnProcA2Res.json()) as { data: { id: string; version: number } }).data;
    createdDeadlineIds.push(draftOnProcA2.id);

    await expect(
      updateDeadlineDraft(owner, {
        deadlineId: draftOnProcA2.id,
        expectedVersion: draftOnProcA2.version,
        sourceDocumentId: docMatterB.id,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    await expect(
      updateDeadlineDraft(owner, {
        deadlineId: draftOnProcA2.id,
        expectedVersion: draftOnProcA2.version,
        sourceDocumentId: hearingOnlyDoc.id,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    await expect(
      confirmDeadline(owner, {
        deadlineId: draftOnProcA2.id,
        expectedVersion: draftOnProcA2.version,
        dueDate: '2027-07-15',
        source: 'اختبار',
        basisNotes: 'اختبار',
        sourceDocumentId: docMatterB.id,
        confirmationAccepted: true,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    await expect(
      confirmDeadline(owner, {
        deadlineId: draftOnProcA2.id,
        expectedVersion: draftOnProcA2.version,
        dueDate: '2027-07-15',
        source: 'اختبار',
        basisNotes: 'اختبار',
        sourceDocumentId: hearingOnlyDoc.id,
        confirmationAccepted: true,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    // Updating draft and confirming with valid sourceDocumentId keeps link intact
    const dueYmd = formatOffsetYmd(45);
    const agendaAnchorYmd = formatOffsetYmd(0);
    const updatedDraft = await updateDeadlineDraft(owner, {
      deadlineId: validDeadlineJson.data.id,
      expectedVersion: validDeadlineJson.data.version,
      sourceDocumentId: docMatterA.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(updatedDraft.status).toBe('DRAFT');
    expect(updatedDraft.sourceDocumentId).toBe(docMatterA.id);

    const confirmedDeadline = await confirmDeadline(owner, {
      deadlineId: updatedDraft.id,
      expectedVersion: updatedDraft.version,
      dueDate: dueYmd,
      source: 'ملف القضية وصورة الحكم المرفقة',
      basisNotes: 'تم احتساب الميعاد يدوياً بعد مراجعة صورة الحكم',
      sourceDocumentId: docMatterA.id,
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(confirmedDeadline.status).toBe('CONFIRMED');
    expect(confirmedDeadline.sourceDocumentId).toBe(docMatterA.id);

    // Different-hearing same-proceeding document is rejected on HearingResult
    const hearingA1Alt = await scheduleHearing(owner, {
      proceedingId: proceedingA1Id,
      hearingDate: formatOffsetYmd(31),
      idempotencyKey: crypto.randomUUID(),
    });
    const hearingA1Target = await scheduleHearing(owner, {
      proceedingId: proceedingA1Id,
      hearingDate: formatOffsetYmd(32),
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(hearingA1Alt.id, hearingA1Target.id);
    const docAltHearing = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: proceedingA1Id,
      hearingId: hearingA1Alt.id,
      title: `مستند جلسة أخرى نفس القيد T12 ${runSuffix}`,
      documentType: 'JUDGMENT',
      bytes: buildSyntheticPdf(`T12-TC04-ALT-HEARING-${runSuffix}`),
    });
    await expect(
      recordHearingResult(owner, {
        hearingId: hearingA1Target.id,
        expectedVersion: 1,
        decision: 'محاولة ربط مستند جلسة أخرى',
        nextDateDisposition: 'NONE',
        decisionDocumentId: docAltHearing.id,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    // 3) PowerOfAttorney.documentId: party-owned + client-matter-linked accepted (staying UNREVIEWED); wrong principal / OPPONENT / non-READY / archived rejected
    await linkMatterParty(owner, {
      matterId: matterAId,
      partyId: partyOtherId,
      role: 'OPPONENT',
      isPrimaryContact: false,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      savePowerOfAttorney(owner, {
        partyId: partyOtherId,
        documentId: docMatterA.id,
        poaNumberText: '9000',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق الجيزة',
        poaType: 'GENERAL',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    await expect(
      savePowerOfAttorney(owner, {
        partyId: partyClientAId,
        documentId: docPartyOther.id,
        poaNumberText: '9001',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق الجيزة',
        poaType: 'GENERAL',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    await expect(
      savePowerOfAttorney(owner, {
        partyId: partyClientAId,
        documentId: docMatterB.id,
        poaNumberText: '9002',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق الجيزة',
        poaType: 'GENERAL',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    await expect(
      savePowerOfAttorney(owner, {
        partyId: partyClientAId,
        documentId: quarantinedDocId,
        poaNumberText: '9003',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق الجيزة',
        poaType: 'GENERAL',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(DocumentNotReadyError);

    await expect(
      savePowerOfAttorney(owner, {
        partyId: partyClientAId,
        documentId: archivedDoc.id,
        poaNumberText: '9004',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق الجيزة',
        poaType: 'GENERAL',
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(DocumentValidationError);

    const poaPartyOwned = await savePowerOfAttorney(owner, {
      partyId: partyClientAId,
      documentId: docPartyA.id,
      poaNumberText: `0771-${runSuffix}`,
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق الدقي',
      poaType: 'GENERAL',
      idempotencyKey: crypto.randomUUID(),
    });
    createdPoaIds.push(poaPartyOwned.id);
    expect(poaPartyOwned.documentId).toBe(docPartyA.id);
    // Linking a document must NEVER auto-validate an UNREVIEWED POA
    expect(poaPartyOwned.humanReviewStatus).toBe('UNREVIEWED');

    const poaMatterLinked = await savePowerOfAttorney(owner, {
      partyId: partyClientAId,
      documentId: docMatterA.id,
      poaNumberText: `0772-${runSuffix}`,
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب توثيق المعادي',
      poaType: 'LITIGATION',
      idempotencyKey: crypto.randomUUID(),
    });
    createdPoaIds.push(poaMatterLinked.id);
    expect(poaMatterLinked.documentId).toBe(docMatterA.id);
    expect(poaMatterLinked.humanReviewStatus).toBe('UNREVIEWED');

    // savePowerOfAttorney UPDATE path must reject wrong-principal documentId
    await expect(
      savePowerOfAttorney(owner, {
        id: poaPartyOwned.id,
        expectedVersion: poaPartyOwned.version,
        partyId: partyClientAId,
        documentId: docPartyOther.id,
        poaNumberText: poaPartyOwned.poaNumberText,
        poaYearLabel: poaPartyOwned.poaYearLabel,
        notarizationOffice: poaPartyOwned.notarizationOffice,
        poaType: poaPartyOwned.poaType,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    // 4) listAgenda sourceDocumentId visibility & READ_DOCUMENTS clearance requirement
    const agendaAuthorized = await listAgenda(owner, { view: 'list', anchorDate: agendaAnchorYmd });
    const agendaItemAuthorized = agendaAuthorized.confirmedDeadlines.find(
      (d) => d.id === confirmedDeadline.id
    );
    expect(agendaItemAuthorized?.sourceDocumentId).toBe(docMatterA.id);

    const draftForClearRes = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: `مسودة لاختبار فك الربط ${runSuffix}`,
          sourceDocumentId: docMatterA.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    expect(draftForClearRes.status).toBe(200);
    const draftForClear = (
      (await draftForClearRes.json()) as { data: { id: string; version: number } }
    ).data;
    createdDeadlineIds.push(draftForClear.id);

    const realAuthorize = identityAuthorize.authorize;
    const realAssertAuthorized = identityAuthorize.assertAuthorized;
    const authSpy = vi
      .spyOn(identityAuthorize, 'authorize')
      .mockImplementation((actor, perm) => (perm === 'READ_DOCUMENTS' ? false : realAuthorize(actor, perm)));
    const assertSpy = vi
      .spyOn(identityAuthorize, 'assertAuthorized')
      .mockImplementation((actor, perm) => {
        if (perm === 'READ_DOCUMENTS') {
          throw new AuthorizationError('غير مصرح بقراءة المستندات.');
        }
        return realAssertAuthorized(actor, perm);
      });
    try {
      const agendaNoDocs = await listAgenda(owner, { view: 'list', anchorDate: agendaAnchorYmd });
      const agendaItemNoDocs = agendaNoDocs.confirmedDeadlines.find(
        (d) => d.id === confirmedDeadline.id
      );
      expect(agendaItemNoDocs?.sourceDocumentId).toBeNull();
      const agendaDraftNoDocs = agendaNoDocs.draftDeadlines.find((d) => d.id === draftForClear.id);
      expect(agendaDraftNoDocs?.sourceDocumentId).toBeNull();

      await expect(
        savePowerOfAttorney(owner, {
          id: poaPartyOwned.id,
          expectedVersion: poaPartyOwned.version,
          partyId: partyClientAId,
          documentId: null,
          poaNumberText: poaPartyOwned.poaNumberText,
          poaYearLabel: poaPartyOwned.poaYearLabel,
          notarizationOffice: poaPartyOwned.notarizationOffice,
          poaType: poaPartyOwned.poaType,
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        updateDeadlineDraft(owner, {
          deadlineId: draftForClear.id,
          expectedVersion: draftForClear.version,
          sourceDocumentId: null,
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toThrow(AuthorizationError);

      const clearViaHttpDenied = await patchDeadlineRoute(
        new Request(`${trustedOrigin}/api/deadlines/${draftForClear.id}`, {
          method: 'PATCH',
          headers: {
            origin: trustedOrigin,
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
            cookie: ownerCookie,
          },
          body: JSON.stringify({
            deadlineId: draftForClear.id,
            expectedVersion: draftForClear.version,
            sourceDocumentId: null,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
        { params: Promise.resolve({ id: draftForClear.id }) }
      );
      expect(clearViaHttpDenied.status).toBe(403);

      await expect(
        confirmDeadline(owner, {
          deadlineId: draftForClear.id,
          expectedVersion: draftForClear.version,
          dueDate: dueYmd,
          source: 'سند',
          basisNotes: 'ملاحظات',
          sourceDocumentId: null,
          confirmationAccepted: true,
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toThrow(AuthorizationError);

      await expect(
        correctHearingResult(owner, {
          hearingId: hearingA1Id,
          expectedVersion: 1,
          currentResultId: validHearingJson.data.resultId,
          decision: 'محاولة إزالة مستند القرار بدون صلاحية',
          reason: 'اختبار صلاحية READ_DOCUMENTS',
          decisionDocumentId: null,
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toThrow(AuthorizationError);
    } finally {
      authSpy.mockRestore();
      assertSpy.mockRestore();
    }

    // 5) Idempotency hash distinguishes omitted (undefined) vs explicit null
    const idemDraftKey = crypto.randomUUID();
    const draftOmitRes = await updateDeadlineDraft(owner, {
      deadlineId: draftForClear.id,
      expectedVersion: draftForClear.version,
      title: `مسودة مقارنة التطابق ${runSuffix}`,
      idempotencyKey: idemDraftKey,
    });
    expect(draftOmitRes.sourceDocumentId).toBe(docMatterA.id);
    await expect(
      updateDeadlineDraft(owner, {
        deadlineId: draftForClear.id,
        expectedVersion: draftForClear.version,
        title: `مسودة مقارنة التطابق ${runSuffix}`,
        sourceDocumentId: null,
        idempotencyKey: idemDraftKey,
      })
    ).rejects.toThrow(IdempotencyPayloadMismatchError);

    const idemConfirmKey = crypto.randomUUID();
    const confirmOmit = await confirmDeadline(owner, {
      deadlineId: draftForClear.id,
      expectedVersion: draftOmitRes.version,
      dueDate: dueYmd,
      source: 'مصدر الاعتماد',
      basisNotes: 'مراجعة الاعتماد',
      confirmationAccepted: true,
      idempotencyKey: idemConfirmKey,
    });
    expect(confirmOmit.sourceDocumentId).toBe(docMatterA.id);
    await expect(
      confirmDeadline(owner, {
        deadlineId: draftForClear.id,
        expectedVersion: draftOmitRes.version,
        dueDate: dueYmd,
        source: 'مصدر الاعتماد',
        basisNotes: 'مراجعة الاعتماد',
        sourceDocumentId: null,
        confirmationAccepted: true,
        idempotencyKey: idemConfirmKey,
      })
    ).rejects.toThrow(IdempotencyPayloadMismatchError);

    const idemCorrectKey = crypto.randomUUID();
    const correctOmit = await correctHearingResult(owner, {
      hearingId: hearingA2Id,
      expectedVersion: correctedHrA2.revision,
      currentResultId: correctedHrA2.id,
      decision: 'تصويب مع إبقاء المستند',
      reason: 'اختبار بصمة التكرار',
      idempotencyKey: idemCorrectKey,
    });
    createdHearingResultIds.push(correctOmit.id);
    expect(correctOmit.decisionDocumentId).toBe(docProceedingA2.id);
    await expect(
      correctHearingResult(owner, {
        hearingId: hearingA2Id,
        expectedVersion: correctedHrA2.revision,
        currentResultId: correctedHrA2.id,
        decision: 'تصويب مع إبقاء المستند',
        reason: 'اختبار بصمة التكرار',
        decisionDocumentId: null,
        idempotencyKey: idemCorrectKey,
      })
    ).rejects.toThrow(IdempotencyPayloadMismatchError);

    // 6) Unchanged existing link on an archived doc allows unrelated POA/Deadline/Correction edits while cross-proceeding change rejects
    const archivableDoc = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: proceedingA1Id,
      title: `مستند مرتبط سيؤرشف لاحقاً ${runSuffix}`,
      documentType: 'CONTRACT',
      bytes: buildSyntheticPdf(`T12-TC04-ARCH-LATER-${runSuffix}`),
    });
    const poaArch = await savePowerOfAttorney(owner, {
      partyId: partyClientAId,
      documentId: archivableDoc.id,
      poaNumberText: `0773-${runSuffix}`,
      poaYearLabel: '2026',
      notarizationOffice: 'مكتب التوثيق',
      poaType: 'GENERAL',
      idempotencyKey: crypto.randomUUID(),
    });
    createdPoaIds.push(poaArch.id);
    const dlArchRes = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: `مسودة بمستند سيؤرشف ${runSuffix}`,
          sourceDocumentId: archivableDoc.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    const dlArch = ((await dlArchRes.json()) as { data: { id: string; version: number } }).data;
    createdDeadlineIds.push(dlArch.id);

    const hArch = await scheduleHearing(owner, {
      proceedingId: proceedingA1Id,
      hearingDate: formatOffsetYmd(33),
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(hArch.id);
    const hrArch = await recordHearingResult(owner, {
      hearingId: hArch.id,
      expectedVersion: 1,
      decision: 'قرار مرتبط بمستند سيؤرشف',
      nextDateDisposition: 'NONE',
      decisionDocumentId: archivableDoc.id,
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingResultIds.push(hrArch.resultId);

    await prisma.document.update({
      where: { id: archivableDoc.id },
      data: { archivedAt: new Date() },
    });

    const poaArchSaved = await savePowerOfAttorney(owner, {
      id: poaArch.id,
      expectedVersion: poaArch.version,
      partyId: partyClientAId,
      documentId: archivableDoc.id,
      poaNumberText: poaArch.poaNumberText,
      poaYearLabel: poaArch.poaYearLabel,
      notarizationOffice: poaArch.notarizationOffice,
      poaType: poaArch.poaType,
      notes: 'تعديل ملاحظة مع إبقاء المستند المؤرشف',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(poaArchSaved.documentId).toBe(archivableDoc.id);

    const dlArchUpdated = await updateDeadlineDraft(owner, {
      deadlineId: dlArch.id,
      expectedVersion: dlArch.version,
      title: `تعديل عنوان مع بقاء المستند المؤرشف ${runSuffix}`,
      sourceDocumentId: archivableDoc.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(dlArchUpdated.sourceDocumentId).toBe(archivableDoc.id);

    await expect(
      updateDeadlineDraft(owner, {
        deadlineId: dlArch.id,
        expectedVersion: dlArchUpdated.version,
        proceedingId: proceedingA2Id,
        idempotencyKey: crypto.randomUUID(),
      })
    ).rejects.toThrow(CrossMatterLinkForbiddenError);

    const dlArchConfirmed = await confirmDeadline(owner, {
      deadlineId: dlArch.id,
      expectedVersion: dlArchUpdated.version,
      dueDate: dueYmd,
      source: 'ملف القضية',
      basisNotes: 'اعتماد مع إبقاء المستند المؤرشف',
      sourceDocumentId: archivableDoc.id,
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(dlArchConfirmed.sourceDocumentId).toBe(archivableDoc.id);

    const hrArchCorrected = await correctHearingResult(owner, {
      hearingId: hArch.id,
      expectedVersion: 1,
      currentResultId: hrArch.resultId,
      decision: 'تصحيح منطوق مع إبقاء المستند المؤرشف',
      reason: 'تصحيح صياغة فقط',
      decisionDocumentId: archivableDoc.id,
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingResultIds.push(hrArchCorrected.id);
    expect(hrArchCorrected.decisionDocumentId).toBe(archivableDoc.id);

    // 7) Authorized unlinking via explicit null across POA, Deadline (draft + confirm), and HearingResult correction
    const poaCleared = await savePowerOfAttorney(owner, {
      id: poaPartyOwned.id,
      expectedVersion: poaPartyOwned.version,
      partyId: partyClientAId,
      documentId: null,
      poaNumberText: poaPartyOwned.poaNumberText,
      poaYearLabel: poaPartyOwned.poaYearLabel,
      notarizationOffice: poaPartyOwned.notarizationOffice,
      poaType: poaPartyOwned.poaType,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(poaCleared.documentId).toBeNull();
    expect(poaCleared.linkedDocument).toBeNull();

    const dlUnlinkRes = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: `مسودة لفك الربط بنجاح ${runSuffix}`,
          sourceDocumentId: docMatterA.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    const dlUnlink = ((await dlUnlinkRes.json()) as { data: { id: string; version: number } }).data;
    createdDeadlineIds.push(dlUnlink.id);
    const dlUnlinkedDraft = await updateDeadlineDraft(owner, {
      deadlineId: dlUnlink.id,
      expectedVersion: dlUnlink.version,
      sourceDocumentId: null,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(dlUnlinkedDraft.sourceDocumentId).toBeNull();

    const dlConfirmUnlinkRes = await postDeadlinesRoute(
      new Request(`${trustedOrigin}/api/deadlines`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          matterId: matterAId,
          proceedingId: proceedingA1Id,
          title: `مسودة لفك الربط عند الاعتماد ${runSuffix}`,
          sourceDocumentId: docMatterA.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
    );
    const dlConfirmUnlink = (
      (await dlConfirmUnlinkRes.json()) as { data: { id: string; version: number } }
    ).data;
    createdDeadlineIds.push(dlConfirmUnlink.id);
    const dlConfirmedNull = await confirmDeadline(owner, {
      deadlineId: dlConfirmUnlink.id,
      expectedVersion: dlConfirmUnlink.version,
      dueDate: dueYmd,
      source: 'مراجعة يدوية',
      basisNotes: 'تمت المراجعة وفك المستند المصدري',
      sourceDocumentId: null,
      confirmationAccepted: true,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(dlConfirmedNull.sourceDocumentId).toBeNull();

    const hrUnlinked = await correctHearingResult(owner, {
      hearingId: hArch.id,
      expectedVersion: hrArchCorrected.revision,
      currentResultId: hrArchCorrected.id,
      decision: 'تصحيح مع فك ربط المستند',
      reason: 'إلغاء ربط المستند المصرح به',
      decisionDocumentId: null,
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingResultIds.push(hrUnlinked.id);
    expect(hrUnlinked.decisionDocumentId).toBeNull();

    // READ_DOCUMENTS & WRITE_DOCUMENTS authorization checks fail closed for MAINTAINER
    await expect(getDocumentDetail(maintainer, docMatterA.id)).rejects.toThrow(AuthorizationError);
    await expect(authorizeDownload(maintainer, docMatterA.id)).rejects.toThrow(AuthorizationError);
    const maintListRes = await listDocumentsRoute(
      new Request(`${trustedOrigin}/api/documents?matterId=${matterAId}`, {
        headers: { cookie: maintainerCookie, 'sec-fetch-site': 'same-origin' },
      })
    );
    expect(maintListRes.status).toBe(403);
    const maintDetailRes = await getDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${docMatterA.id}`, {
        headers: { cookie: maintainerCookie, 'sec-fetch-site': 'same-origin' },
      }),
      { params: Promise.resolve({ id: docMatterA.id }) }
    );
    expect(maintDetailRes.status).toBe(403);
    const maintVerRes = await postDocumentVersionRoute(
      new Request(`${trustedOrigin}/api/documents/${docMatterA.id}/versions`, {
        method: 'POST',
        headers: {
          origin: trustedOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: maintainerCookie,
        },
        body: JSON.stringify({
          expectedDocumentVersion: 1,
          originalFilename: 'blocked.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 128,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: docMatterA.id }) }
    );
    expect(maintVerRes.status).toBe(403);
  }, 60_000);

  it('T12-TC-05: unifiedSearch returns authorized metadata without PDF-body matches or storage keys, filters archived parents, and download routes fail closed', async () => {
    const bodyOnlyPhrase = `SECRET_PDF_BODY_ONLY_TOKEN_${runSuffix}`;
    const v1Bytes = buildSyntheticPdf(bodyOnlyPhrase);
    const v2Bytes = buildSyntheticPdf(`V2_UPDATED_CONTENT_${runSuffix}`);
    const searchableTitle = `عقد إيجار تجاري للبحث التلقائي ${runSuffix}`;
    const docTag = `وسم_${runSuffix}`;

    const doc = await createReadyMatterDocument({
      matterId: matterAId,
      title: searchableTitle,
      documentType: 'JUDGMENT',
      documentDate: '2026-10-15',
      tags: [docTag],
      filename: 'lease-search-v1.pdf',
      bytes: v1Bytes,
    });
    const v1Id = doc.currentVersionId!;

    // Add v2 so v1 becomes historical version
    const verAttempt = await beginVersionUpload(owner, {
      documentId: doc.id,
      expectedDocumentVersion: doc.version,
      originalFilename: 'lease-search-v2.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: v2Bytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(verAttempt.id);
    await uploadAttemptBytes(owner, verAttempt.id, v2Bytes);
    await finalizeUpload(owner, { attemptId: verAttempt.id });

    // Also seed a non-READY (QUARANTINED) document that must NEVER appear in unifiedSearch
    const unreadyTitle = `مستند محجور مستبعد من البحث ${runSuffix}`;
    const unreadyDocId = crypto.randomUUID();
    const unreadyVerId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: unreadyDocId,
        matterId: matterAId,
        title: unreadyTitle,
        titleNormalized: unreadyTitle,
        documentType: 'OTHER',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(unreadyDocId);
    await prisma.documentVersion.create({
      data: {
        id: unreadyVerId,
        documentId: unreadyDocId,
        versionNumber: 1,
        objectKey: `q/search-unready-${unreadyVerId}.pdf`,
        originalFilename: 'unready.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 100,
        uploadStatus: 'QUARANTINED',
        scanStatus: 'PENDING',
        createdById: owner.id,
      },
    });
    await prisma.document.update({
      where: { id: unreadyDocId },
      data: { currentVersionId: unreadyVerId },
    });

    // 1) Authorized search in DOCUMENT tab & ALL tab matches title, documentType, documentDate, and tags
    const docTabRes = await unifiedSearch(
      { query: searchableTitle, type: 'DOCUMENT' },
      owner
    );
    expect(docTabRes.items.some((item) => item.id === doc.id && item.entityType === 'DOCUMENT')).toBe(
      true
    );
    expect(docTabRes.counts.documents).toBeGreaterThanOrEqual(1);
    const serializedDocRes = JSON.stringify(docTabRes);
    expect(serializedDocRes).not.toContain('objectKey');
    expect(serializedDocRes).not.toContain('quarantineKey');
    expect(serializedDocRes).not.toContain(storageRoot);

    const byTypeRes = await unifiedSearch({ query: 'صورة حكم', type: 'DOCUMENT' }, owner);
    expect(byTypeRes.items.some((item) => item.id === doc.id)).toBe(true);

    const byDateRes = await unifiedSearch({ query: '2026-10-15', type: 'DOCUMENT' }, owner);
    expect(byDateRes.items.some((item) => item.id === doc.id)).toBe(true);

    const byTagRes = await unifiedSearch({ query: docTag, type: 'DOCUMENT' }, owner);
    expect(byTagRes.items.some((item) => item.id === doc.id)).toBe(true);

    const allTabRes = await unifiedSearch({ query: searchableTitle, type: 'ALL' }, owner);
    expect(allTabRes.items.some((item) => item.id === doc.id && item.entityType === 'DOCUMENT')).toBe(
      true
    );

    // 2) PDF-body-only phrase returns ZERO matches
    const bodyOnlyAll = await unifiedSearch({ query: bodyOnlyPhrase, type: 'ALL' }, owner);
    expect(bodyOnlyAll.items).toHaveLength(0);
    expect(bodyOnlyAll.counts.documents).toBe(0);

    const bodyOnlyDocTab = await unifiedSearch(
      { query: bodyOnlyPhrase, type: 'DOCUMENT' },
      owner
    );
    expect(bodyOnlyDocTab.items).toHaveLength(0);

    // 3) Non-READY (QUARANTINED, UPLOADING+PENDING scanStatus, FAILED) and archived docs/parents excluded
    const unreadySearch = await unifiedSearch({ query: unreadyTitle, type: 'DOCUMENT' }, owner);
    expect(unreadySearch.items).toHaveLength(0);

    const uploadingPendingTitle = `مستند قيد الرفع وبانتظار الفحص للبحث ${runSuffix}`;
    const uploadingPendingDocId = crypto.randomUUID();
    const uploadingPendingVerId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: uploadingPendingDocId,
        matterId: matterAId,
        title: uploadingPendingTitle,
        titleNormalized: uploadingPendingTitle,
        documentType: 'OTHER',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(uploadingPendingDocId);
    await prisma.documentVersion.create({
      data: {
        id: uploadingPendingVerId,
        documentId: uploadingPendingDocId,
        versionNumber: 1,
        objectKey: `q/search-uploading-pending-${uploadingPendingVerId}.pdf`,
        originalFilename: 'uploading-pending.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 100,
        uploadStatus: 'UPLOADING',
        scanStatus: 'PENDING',
        createdById: owner.id,
      },
    });
    await prisma.document.update({
      where: { id: uploadingPendingDocId },
      data: { currentVersionId: uploadingPendingVerId },
    });
    expect(
      (await unifiedSearch({ query: uploadingPendingTitle, type: 'DOCUMENT' }, owner)).items
    ).toHaveLength(0);

    const failedScanTitle = `مستند فشل الفحص مستبعد من البحث ${runSuffix}`;
    const failedScanDocId = crypto.randomUUID();
    const failedScanVerId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: failedScanDocId,
        matterId: matterAId,
        title: failedScanTitle,
        titleNormalized: failedScanTitle,
        documentType: 'OTHER',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(failedScanDocId);
    await prisma.documentVersion.create({
      data: {
        id: failedScanVerId,
        documentId: failedScanDocId,
        versionNumber: 1,
        objectKey: `q/search-failed-${failedScanVerId}.pdf`,
        originalFilename: 'failed.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 100,
        uploadStatus: 'FAILED',
        scanStatus: 'FAILED',
        createdById: owner.id,
      },
    });
    await prisma.document.update({
      where: { id: failedScanDocId },
      data: { currentVersionId: failedScanVerId },
    });
    expect(
      (await unifiedSearch({ query: failedScanTitle, type: 'DOCUMENT' }, owner)).items
    ).toHaveLength(0);

    const archivedSearchTitle = `مستند مؤرشف للبحث المشروط ${runSuffix}`;
    const archivedSearchDoc = await createReadyMatterDocument({
      matterId: matterAId,
      title: archivedSearchTitle,
      bytes: buildSyntheticPdf(`T12-TC05-ARCHIVED-${runSuffix}`),
    });
    await prisma.document.update({
      where: { id: archivedSearchDoc.id },
      data: { archivedAt: new Date() },
    });
    expect(
      (await unifiedSearch({ query: archivedSearchTitle, type: 'DOCUMENT' }, owner)).items
    ).toHaveLength(0);
    const archivedIncludedRes = await unifiedSearch(
      { query: archivedSearchTitle, type: 'DOCUMENT', includeArchived: true },
      owner
    );
    expect(
      archivedIncludedRes.items.some(
        (item) => item.id === archivedSearchDoc.id && item.entityType === 'DOCUMENT'
      )
    ).toBe(true);

    // Docs in archived Matter, archived Proceeding, and archived Party are excluded from unifiedSearch & listDocuments
    const searchArchMatter = await openMatter(owner, {
      title: `قضية أرشفة البحث ${runSuffix}`,
      kind: 'LITIGATION',
      initialClientId: partyClientAId,
      idempotencyKey: crypto.randomUUID(),
    });
    createdMatterIds.push(searchArchMatter.matter.id);
    const searchArchProc = await addProceeding(owner, {
      matterId: matterAId,
      courtId,
      instance: 'FIRST_INSTANCE',
      numberText: `4401-${runSuffix}`,
      yearLabel: '2026',
      registerType: 'مدني',
      idempotencyKey: crypto.randomUUID(),
    });
    const searchArchParty = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `طرف أرشفة البحث ${runSuffix}`,
        nameNormalized: `طرف ارشفه البحث ${runSuffix}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(searchArchParty.id);

    const docInArchMatterTitle = `مستند ضمن قضية مؤرشفة ${runSuffix}`;
    const docInArchProcTitle = `مستند ضمن قيد مؤرشف ${runSuffix}`;
    const docInArchPartyTitle = `مستند ضمن طرف مؤرشف ${runSuffix}`;
    const docInArchMatter = await createReadyMatterDocument({
      matterId: searchArchMatter.matter.id,
      title: docInArchMatterTitle,
      bytes: buildSyntheticPdf(`T12-TC05-ARCHM-${runSuffix}`),
    });
    const docInArchProc = await createReadyMatterDocument({
      matterId: matterAId,
      proceedingId: searchArchProc.id,
      title: docInArchProcTitle,
      bytes: buildSyntheticPdf(`T12-TC05-ARCHPR-${runSuffix}`),
    });
    const partySearchBytes = buildSyntheticPdf(`T12-TC05-ARCHPA-${runSuffix}`);
    const partySearchAttempt = await beginUpload(owner, {
      partyId: searchArchParty.id,
      title: docInArchPartyTitle,
      documentType: 'ID_COPY',
      originalFilename: 'search-party.pdf',
      declaredMime: 'application/pdf',
      expectedSizeBytes: partySearchBytes.byteLength,
      idempotencyKey: crypto.randomUUID(),
    });
    createdAttemptIds.push(partySearchAttempt.id);
    await uploadAttemptBytes(owner, partySearchAttempt.id, partySearchBytes);
    const docInArchParty = await finalizeUpload(owner, { attemptId: partySearchAttempt.id });
    createdDocumentIds.push(docInArchParty.id);

    await archiveMatter(owner, {
      matterId: searchArchMatter.matter.id,
      expectedVersion: searchArchMatter.matter.version,
      reason: 'أرشفة قضية البحث',
      idempotencyKey: crypto.randomUUID(),
    });
    await archiveProceeding(owner, {
      proceedingId: searchArchProc.id,
      matterId: matterAId,
      expectedVersion: searchArchProc.version,
      reason: 'أرشفة قيد البحث',
      idempotencyKey: crypto.randomUUID(),
    });
    await prisma.party.update({
      where: { id: searchArchParty.id },
      data: { archivedAt: new Date() },
    });

    for (const [excludedId, excludedTitle] of [
      [docInArchMatter.id, docInArchMatterTitle],
      [docInArchProc.id, docInArchProcTitle],
      [docInArchParty.id, docInArchPartyTitle],
    ] as const) {
      expect((await unifiedSearch({ query: excludedTitle, type: 'DOCUMENT' }, owner)).items).toHaveLength(0);
      expect((await listDocuments(owner, { q: excludedTitle })).documents).toHaveLength(0);
      expect(
        (await unifiedSearch({ query: excludedTitle, type: 'DOCUMENT', includeArchived: true }, owner)).items.some(
          (i) => i.id === excludedId
        )
      ).toBe(true);
      expect(
        (await listDocuments(owner, { q: excludedTitle, includeArchived: true })).documents.some(
          (d) => d.id === excludedId
        )
      ).toBe(true);
    }

    // 4) MAINTAINER (lacks READ_CLIENT_DATA & READ_DOCUMENTS) fails closed on unifiedSearch
    await expect(
      unifiedSearch({ query: searchableTitle, type: 'DOCUMENT' }, maintainer)
    ).rejects.toThrow(AuthorizationError);

    // 5) authorizeDownload fails closed (409) when currentVersionId is null, blank ?versionId= returns 400, HEAD returns 405 with nosniff
    const nullCurDocId = crypto.randomUUID();
    const nullCurVerId = crypto.randomUUID();
    await prisma.document.create({
      data: {
        id: nullCurDocId,
        matterId: matterAId,
        title: `مستند بدون نسخة حالية ${runSuffix}`,
        titleNormalized: `مستند بدون نسخه حاليه ${runSuffix}`,
        documentType: 'OTHER',
        currentVersionId: null,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(nullCurDocId);
    await prisma.documentVersion.create({
      data: {
        id: nullCurVerId,
        documentId: nullCurDocId,
        versionNumber: 1,
        objectKey: `ready/null-current-${nullCurVerId}.pdf`,
        originalFilename: 'orphan-ready.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: 100,
        uploadStatus: 'READY',
        scanStatus: 'NOT_SCANNED_POLICY',
        createdById: owner.id,
      },
    });
    await expect(authorizeDownload(owner, nullCurDocId)).rejects.toThrow(DocumentNotReadyError);
    const nullCurHttpRes = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${nullCurDocId}/content`, {
        headers: { cookie: ownerCookie, 'sec-fetch-site': 'same-origin' },
      }),
      { params: Promise.resolve({ id: nullCurDocId }) }
    );
    expect(nullCurHttpRes.status).toBe(409);

    const blankVerRes = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}/content?versionId=%20%20`, {
        headers: { cookie: ownerCookie, 'sec-fetch-site': 'same-origin' },
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(blankVerRes.status).toBe(400);

    const headRes = headDocumentContentRoute();
    expect(headRes.status).toBe(405);
    expect(headRes.headers.get('allow')).toBe('GET');
    expect(headRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(headRes.headers.get('cache-control')).toBe('private, no-store');

    // Cross-document versionId mismatch fails closed (404)
    const otherDoc = await createReadyMatterDocument({
      matterId: matterBId,
      title: `مستند قضية ب للمطابقة ${runSuffix}`,
      bytes: buildSyntheticPdf(`T12-TC05-DOCB-${runSuffix}`),
    });
    const crossDocVersionRes = await getDocumentContentRoute(
      new Request(
        `${trustedOrigin}/api/documents/${doc.id}/content?versionId=${otherDoc.currentVersionId}`,
        { headers: { cookie: ownerCookie, 'sec-fetch-site': 'same-origin' } }
      ),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(crossDocVersionRes.status).toBe(404);
    expect(crossDocVersionRes.headers.get('cache-control')).toBe('private, no-store');
    expect(crossDocVersionRes.headers.get('x-content-type-options')).toBe('nosniff');

    // 6) Direct historical version download without permission fails closed (401/403) with private headers
    const unauthV1Res = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}/content?versionId=${v1Id}`),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(unauthV1Res.status).toBe(401);
    expect(unauthV1Res.headers.get('cache-control')).toBe('private, no-store');
    expect(unauthV1Res.headers.get('x-content-type-options')).toBe('nosniff');

    const revokedV1Res = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}/content?versionId=${v1Id}`, {
        headers: { cookie: revokedOwnerCookie },
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(revokedV1Res.status).toBe(401);

    const maintV1Res = await getDocumentContentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}/content?versionId=${v1Id}`, {
        headers: { cookie: maintainerCookie },
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(maintV1Res.status).toBe(403);
    expect(maintV1Res.headers.get('cache-control')).toBe('private, no-store');
    expect(maintV1Res.headers.get('x-content-type-options')).toBe('nosniff');

    // Also verify GET /api/documents/[id] does not expose objectKey/quarantineKey
    const detailHttpRes = await getDocumentRoute(
      new Request(`${trustedOrigin}/api/documents/${doc.id}`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: doc.id }) }
    );
    expect(detailHttpRes.status).toBe(200);
    const detailText = await detailHttpRes.text();
    expect(detailText).not.toContain('objectKey');
    expect(detailText).not.toContain('quarantineKey');
  }, 60_000);

  it('T12-TC-06: pin/release and reconcileAndCleanupDocumentStorage protect READY, pinned, linked, .part- < grace, Phase-1 protected attempts & TOCTOU saves, while draining >200 batches and blocking RESTORE_MODE', async () => {
    const storage = createLocalDocumentStorage(storageRoot);
    const now = new Date();
    const pastGraceDate = new Date(now.getTime() - 10 * 60_000);
    const insideGraceDate = new Date(now.getTime() - 60_000);

    // 1) Two-version READY document (v1 prior + v2 current)
    const v1Bytes = buildSyntheticPdf(`T12-TC06-V1-${runSuffix}`);
    const v2Bytes = buildSyntheticPdf(`T12-TC06-V2-${runSuffix}`);
    const doc = await createReadyMatterDocument({
      matterId: matterAId,
      title: `مستند دورة حياة التنظيف T12 ${runSuffix}`,
      filename: 'cleanup-v1.pdf',
      bytes: v1Bytes,
    });
    const v1Id = doc.currentVersionId!;
    const v2Attempt = await beginVersionUpload(
      owner,
      {
        documentId: doc.id,
        expectedDocumentVersion: doc.version,
        originalFilename: 'cleanup-v2.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: v2Bytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      },
      { now, storage }
    );
    createdAttemptIds.push(v2Attempt.id);
    await uploadAttemptBytes(owner, v2Attempt.id, v2Bytes, { now, storage });
    const docV2 = await finalizeUpload(owner, { attemptId: v2Attempt.id }, { now, storage });
    const v2Id = docV2.currentVersionId!;

    const [v1Row, v2Row] = await Promise.all([
      prisma.documentVersion.findUniqueOrThrow({ where: { id: v1Id } }),
      prisma.documentVersion.findUniqueOrThrow({ where: { id: v2Id } }),
    ]);

    // Pin READY versions under a releasable backup, then release it
    const releasableBackupId = `t12-bkp-rel-${runSuffix}`;
    createdBackupIds.push(releasableBackupId);
    const pinReadyRes = await pinDocumentVersionsForBackup(
      { backupId: releasableBackupId, documentVersionIds: [v1Id, v2Id], actor: owner },
      { now }
    );
    expect(pinReadyRes.pinnedCount).toBe(2);
    const releaseRes = await releaseBackupFilePins(
      { backupId: releasableBackupId, releasedAt: now, actor: owner },
      { now }
    );
    expect(releaseRes.releasedCount).toBe(2);

    // 2) Pinned orphan (non-READY version with an active BackupFilePin releasedAt: null)
    const orphanDocId = crypto.randomUUID();
    const orphanVerId = crypto.randomUUID();
    const orphanBytes = buildSyntheticPdf(`T12-TC06-PINNED-ORPHAN-${runSuffix}`);
    const orphanKey = `orphan/t12-pinned-${orphanVerId}.pdf`;
    await storage.writeReadyBytes(orphanKey, orphanBytes);
    await fs.promises.utimes(path.join(storage.readyDir, orphanKey), pastGraceDate, pastGraceDate);

    await prisma.document.create({
      data: {
        id: orphanDocId,
        matterId: matterAId,
        title: `مستند يتيم مثبت T12 ${runSuffix}`,
        titleNormalized: `مستند يتيم مثبت T12 ${runSuffix}`,
        documentType: 'OTHER',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(orphanDocId);
    await prisma.documentVersion.create({
      data: {
        id: orphanVerId,
        documentId: orphanDocId,
        versionNumber: 1,
        objectKey: orphanKey,
        originalFilename: 'pinned-orphan.pdf',
        declaredMime: 'application/pdf',
        sizeBytes: orphanBytes.byteLength,
        sha256: sha256Hex(orphanBytes),
        uploadStatus: 'FAILED',
        scanStatus: 'FAILED',
        createdById: owner.id,
      },
    });
    const activeBackupId = `t12-bkp-active-${runSuffix}`;
    createdBackupIds.push(activeBackupId);
    const pinOrphanRes = await pinDocumentVersionsForBackup(
      { backupId: activeBackupId, documentVersionIds: [orphanVerId], actor: owner },
      { now }
    );
    expect(pinOrphanRes.pinnedCount).toBe(1);

    // 2b) Phase-1 protected expired attempt (targetDocumentVersionId -> READY/BackupFilePin) survives BOTH Phase 1 and Phase 2
    const extraReadyVerId = crypto.randomUUID();
    const extraReadyBytes = buildSyntheticPdf(`P1-EXTRA-READY-${runSuffix}`);
    const extraReadyKey = storage.generateReadyKey(doc.id, 3, '.pdf', now);
    await storage.writeReadyBytes(extraReadyKey, extraReadyBytes);
    await prisma.documentVersion.create({
      data: {
        id: extraReadyVerId,
        documentId: doc.id,
        versionNumber: 3,
        objectKey: extraReadyKey,
        originalFilename: 'p1-extra-ready.pdf',
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
        sizeBytes: extraReadyBytes.byteLength,
        sha256: sha256Hex(extraReadyBytes),
        uploadStatus: 'READY',
        scanStatus: 'NOT_SCANNED_POLICY',
        scanPolicyCode: ADR_0003_POLICY_CODE,
        scanPolicyVersion: ADR_0003_POLICY_VERSION,
        scanCheckedAt: now,
        createdById: owner.id,
      },
    });

    const phase1ProtReadyAttemptId = crypto.randomUUID();
    const phase1ProtReadyQKey = `q/t12-phase1-ready-prot-${phase1ProtReadyAttemptId}.pdf`;
    const phase1ProtPinAttemptId = crypto.randomUUID();
    const phase1ProtPinQKey = `q/t12-phase1-pin-prot-${phase1ProtPinAttemptId}.pdf`;
    await storage.writeQuarantineStream(phase1ProtReadyQKey, buildSyntheticPdf(`P1-READY-${runSuffix}`));
    await storage.writeQuarantineStream(phase1ProtPinQKey, buildSyntheticPdf(`P1-PIN-${runSuffix}`));
    await fs.promises.utimes(path.join(storage.quarantineDir, phase1ProtReadyQKey), pastGraceDate, pastGraceDate);
    await fs.promises.utimes(path.join(storage.quarantineDir, phase1ProtPinQKey), pastGraceDate, pastGraceDate);

    await prisma.uploadAttempt.createMany({
      data: [
        {
          id: phase1ProtReadyAttemptId,
          documentId: doc.id,
          targetDocumentVersionId: extraReadyVerId,
          idempotencyRecordId: crypto.randomUUID(),
          actorId: owner.id,
          matterId: matterAId,
          title: 'محاولة محمية بإصدار جاهز',
          documentType: 'OTHER',
          originalFilename: 'p1-ready.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 100,
          quarantineKey: phase1ProtReadyQKey,
          status: 'UPLOADED',
          expiresAt: pastGraceDate,
        },
        {
          id: phase1ProtPinAttemptId,
          documentId: orphanDocId,
          targetDocumentVersionId: orphanVerId,
          idempotencyRecordId: crypto.randomUUID(),
          actorId: owner.id,
          matterId: matterAId,
          title: 'محاولة محمية بتثبيت احتياطي',
          documentType: 'OTHER',
          originalFilename: 'p1-pin.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 100,
          quarantineKey: phase1ProtPinQKey,
          status: 'UPLOADED',
          expiresAt: pastGraceDate,
        },
      ],
    });
    createdAttemptIds.push(phase1ProtReadyAttemptId, phase1ProtPinAttemptId);

    // 2c) Non-READY versions on linked POA, HearingResult, and Deadline survive cleanup
    const makeLinkedNonReady = async (label: string) => {
      const dId = crypto.randomUUID();
      const vId = crypto.randomUUID();
      const k = `orphan/t12-linked-${label}-${vId}.pdf`;
      const b = buildSyntheticPdf(`T12-LINKED-NONREADY-${label}-${runSuffix}`);
      await storage.writeReadyBytes(k, b);
      await fs.promises.utimes(path.join(storage.readyDir, k), pastGraceDate, pastGraceDate);
      await prisma.document.create({
        data: {
          id: dId,
          matterId: matterAId,
          title: `مستند غير جاهز مرتبط ${label} ${runSuffix}`,
          titleNormalized: `مستند غير جاهز مرتبط ${label} ${runSuffix}`,
          documentType: 'OTHER',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      createdDocumentIds.push(dId);
      await prisma.documentVersion.create({
        data: {
          id: vId,
          documentId: dId,
          versionNumber: 1,
          objectKey: k,
          originalFilename: `${label}.pdf`,
          declaredMime: 'application/pdf',
          sizeBytes: b.byteLength,
          sha256: sha256Hex(b),
          uploadStatus: 'FAILED',
          scanStatus: 'FAILED',
          createdById: owner.id,
        },
      });
      return { docId: dId, key: k };
    };

    const linkedPoaNonReady = await makeLinkedNonReady('poa');
    const linkedHrNonReady = await makeLinkedNonReady('hr');
    const linkedDlNonReady = await makeLinkedNonReady('dl');

    const linkedPoaRec = await prisma.powerOfAttorney.create({
      data: {
        partyId: partyClientAId,
        documentId: linkedPoaNonReady.docId,
        poaNumberText: `8801-${runSuffix}`,
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب التوثيق',
        poaType: 'GENERAL',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPoaIds.push(linkedPoaRec.id);

    const linkedHrHearing = await scheduleHearing(owner, {
      proceedingId: proceedingA1Id,
      hearingDate: formatOffsetYmd(34),
      idempotencyKey: crypto.randomUUID(),
    });
    createdHearingIds.push(linkedHrHearing.id);
    const linkedHrRec = await prisma.hearingResult.create({
      data: {
        hearingId: linkedHrHearing.id,
        decisionDocumentId: linkedHrNonReady.docId,
        decisionText: 'قرار مرتبط بمستند غير جاهز للحماية',
        nextDateDisposition: 'NONE',
        recordedAt: now,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdHearingResultIds.push(linkedHrRec.id);

    const linkedDlRec = await prisma.deadline.create({
      data: {
        matterId: matterAId,
        proceedingId: proceedingA1Id,
        sourceDocumentId: linkedDlNonReady.docId,
        title: `ميعاد مرتبط بمستند غير جاهز ${runSuffix}`,
        status: 'DRAFT',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDeadlineIds.push(linkedDlRec.id);

    // 3) Active un-expired upload in quarantine
    const activeBytes = buildSyntheticPdf(`T12-TC06-ACTIVE-${runSuffix}`);
    const activeAttempt = await beginUpload(
      owner,
      {
        matterId: matterAId,
        title: `رفع نشط محمي T12 ${runSuffix}`,
        documentType: 'OTHER',
        originalFilename: 'active.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: activeBytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      },
      { now, storage }
    );
    createdAttemptIds.push(activeAttempt.id);
    await uploadAttemptBytes(owner, activeAttempt.id, activeBytes, {
      now,
      storage,
    });
    const activeAttemptRow = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: activeAttempt.id },
    });

    // 4) Expired temporary upload in quarantine
    const expiredBytes = buildSyntheticPdf(`T12-TC06-EXPIRED-${runSuffix}`);
    const expiredAttempt = await beginUpload(
      owner,
      {
        matterId: matterAId,
        title: `رفع منتهي للتنظيف T12 ${runSuffix}`,
        documentType: 'OTHER',
        originalFilename: 'expired-temp.pdf',
        declaredMime: 'application/pdf',
        expectedSizeBytes: expiredBytes.byteLength,
        idempotencyKey: crypto.randomUUID(),
      },
      { now, storage }
    );
    createdAttemptIds.push(expiredAttempt.id);
    const expiredUploaded = await uploadAttemptBytes(owner, expiredAttempt.id, expiredBytes, {
      now,
      storage,
    });
    await prisma.uploadAttempt.update({
      where: { id: expiredUploaded.id },
      data: { expiresAt: new Date(now.getTime() - 60_000) },
    });
    const expiredAttemptRow = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: expiredUploaded.id },
    });

    // 5) Fresh unreferenced files & .part- inside grace survive; stale unreferenced orphans & stale .part- past grace deleted
    const freshReadyOrphanKey = `orphan/t12-fresh-ready-${runSuffix}.pdf`;
    const freshQuarantineOrphanKey = `orphan-t12-fresh-q-${runSuffix}.bin`;
    const staleReadyOrphanKey = `orphan/t12-stale-ready-${runSuffix}.pdf`;
    const staleQuarantineOrphanKey = `orphan-t12-stale-q-${runSuffix}.bin`;
    const freshPartKey = `q/t12-fresh.pdf.part-${runSuffix}`;
    const stalePartKey = `q/t12-stale.pdf.part-${runSuffix}`;

    await storage.writeReadyBytes(freshReadyOrphanKey, buildSyntheticPdf(`FRESH-READY-${runSuffix}`));
    await storage.writeQuarantineStream(freshQuarantineOrphanKey, Buffer.from('FRESH-Q'));
    await storage.writeReadyBytes(staleReadyOrphanKey, buildSyntheticPdf(`STALE-READY-${runSuffix}`));
    await storage.writeQuarantineStream(staleQuarantineOrphanKey, Buffer.from('STALE-Q'));

    await fs.promises.mkdir(path.join(storage.quarantineDir, 'q'), { recursive: true });
    await fs.promises.writeFile(path.join(storage.quarantineDir, freshPartKey), 'PART-FRESH');
    await fs.promises.writeFile(path.join(storage.quarantineDir, stalePartKey), 'PART-STALE');
    await fs.promises.utimes(path.join(storage.readyDir, freshReadyOrphanKey), insideGraceDate, insideGraceDate);
    await fs.promises.utimes(path.join(storage.quarantineDir, freshQuarantineOrphanKey), insideGraceDate, insideGraceDate);
    await fs.promises.utimes(path.join(storage.quarantineDir, freshPartKey), insideGraceDate, insideGraceDate);
    await fs.promises.utimes(path.join(storage.readyDir, staleReadyOrphanKey), pastGraceDate, pastGraceDate);
    await fs.promises.utimes(path.join(storage.quarantineDir, staleQuarantineOrphanKey), pastGraceDate, pastGraceDate);
    await fs.promises.utimes(path.join(storage.quarantineDir, stalePartKey), pastGraceDate, pastGraceDate);

    // 5b) TOCTOU fresh DB re-check: file present at disk list but committed in DB before unlink runs
    const toctouDocId = crypto.randomUUID();
    const toctouBytes = buildSyntheticPdf(`T12-TOCTOU-${runSuffix}`);
    const toctouSavedKey = `orphan/z-t12-toctou-${runSuffix}.pdf`;
    await storage.writeReadyBytes(toctouSavedKey, toctouBytes);
    await fs.promises.utimes(path.join(storage.readyDir, toctouSavedKey), pastGraceDate, pastGraceDate);
    await prisma.document.create({
      data: {
        id: toctouDocId,
        matterId: matterAId,
        title: `مستند سباق TOCTOU ${runSuffix}`,
        titleNormalized: `مستند سباق TOCTOU ${runSuffix}`,
        documentType: 'OTHER',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdDocumentIds.push(toctouDocId);

    let toctouInjected = false;
    const toctouAwareStorage = {
      ...storage,
      async computeSha256(zone: 'quarantine' | 'ready', key: string) {
        if (!toctouInjected && zone === 'ready' && key === orphanKey) {
          toctouInjected = true;
          await prisma.documentVersion.create({
            data: {
              id: crypto.randomUUID(),
              documentId: toctouDocId,
              versionNumber: 1,
              objectKey: toctouSavedKey,
              originalFilename: 'toctou.pdf',
              declaredMime: 'application/pdf',
              sizeBytes: toctouBytes.byteLength,
              sha256: sha256Hex(toctouBytes),
              uploadStatus: 'READY',
              scanStatus: 'NOT_SCANNED_POLICY',
              createdById: owner.id,
            },
          });
        }
        return storage.computeSha256!(zone, key);
      },
    };

    // Verify MANAGE_OPERATIONS authorization denial on pin, release, and reconcile
    const unauthorizedOpsActor = {
      ...owner,
      role: 'STAFF_NO_OPS' as unknown as UserRole,
    };
    await expect(
      pinDocumentVersionsForBackup({
        backupId: `unauth-${runSuffix}`,
        documentVersionIds: [v1Id],
        actor: unauthorizedOpsActor,
      })
    ).rejects.toThrow(AuthorizationError);
    await expect(
      releaseBackupFilePins({
        backupId: activeBackupId,
        actor: unauthorizedOpsActor,
      })
    ).rejects.toThrow(AuthorizationError);
    await expect(
      reconcileAndCleanupDocumentStorage(storage, { now, actor: unauthorizedOpsActor })
    ).rejects.toThrow(AuthorizationError);

    // Verify RESTORE_MODE=true blocks pinDocumentVersionsForBackup, releaseBackupFilePins, AND cleanup
    const prevRestore = process.env.RESTORE_MODE;
    process.env.RESTORE_MODE = 'true';
    try {
      await expect(
        pinDocumentVersionsForBackup({
          backupId: `restore-blocked-${runSuffix}`,
          documentVersionIds: [v1Id],
          actor: owner,
        })
      ).rejects.toThrow(DocumentValidationError);
      await expect(
        releaseBackupFilePins({
          backupId: activeBackupId,
          actor: owner,
        })
      ).rejects.toThrow(DocumentValidationError);

      const blocked = await reconcileAndCleanupDocumentStorage(storage, { now, actor: owner });
      expect(blocked.skipped).toBe(true);
      expect(blocked.reason).toBe('RESTORE_MODE');
      expect(blocked.deletedKeys).toEqual([]);
      expect(await storage.exists('quarantine', expiredAttemptRow.quarantineKey)).toBe(true);
    } finally {
      if (prevRestore === undefined) delete process.env.RESTORE_MODE;
      else process.env.RESTORE_MODE = prevRestore;
    }

    // Run normal reconciliation/cleanup (gracePeriodMs: 60_000 -> pastGraceDate is past max(60s, 5m))
    const reconcileRes = await reconcileAndCleanupDocumentStorage(toctouAwareStorage, {
      now,
      gracePeriodMs: 60_000,
      actor: owner,
    });
    expect(reconcileRes.skipped).toBe(false);
    expect(reconcileRes.expiredAttemptCount).toBe(1);
    // 1 expired attempt in Phase 1 + 2 quarantine deletions in Phase 2 (staleQuarantineOrphanKey + stalePartKey)
    expect(reconcileRes.deletedQuarantineCount).toBe(3);

    expect(reconcileRes.deletedKeys).toContain(expiredAttemptRow.quarantineKey);
    expect(reconcileRes.deletedKeys).toContain(staleReadyOrphanKey);
    expect(reconcileRes.deletedKeys).toContain(staleQuarantineOrphanKey);
    expect(reconcileRes.deletedKeys).toContain(stalePartKey);
    expect(reconcileRes.deletedKeys).not.toContain(freshReadyOrphanKey);
    expect(reconcileRes.deletedKeys).not.toContain(freshQuarantineOrphanKey);
    expect(reconcileRes.deletedKeys).not.toContain(freshPartKey);
    expect(reconcileRes.deletedKeys).not.toContain(v1Row.objectKey);
    expect(reconcileRes.deletedKeys).not.toContain(v2Row.objectKey);
    expect(reconcileRes.deletedKeys).not.toContain(orphanKey);
    expect(reconcileRes.deletedKeys).not.toContain(activeAttemptRow.quarantineKey);
    expect(reconcileRes.deletedKeys).not.toContain(phase1ProtReadyQKey);
    expect(reconcileRes.deletedKeys).not.toContain(phase1ProtPinQKey);
    expect(reconcileRes.deletedKeys).not.toContain(linkedPoaNonReady.key);
    expect(reconcileRes.deletedKeys).not.toContain(linkedHrNonReady.key);
    expect(reconcileRes.deletedKeys).not.toContain(linkedDlNonReady.key);
    expect(reconcileRes.deletedKeys).not.toContain(toctouSavedKey);

    expect(await storage.exists('quarantine', expiredAttemptRow.quarantineKey)).toBe(false);
    expect(await storage.exists('ready', staleReadyOrphanKey)).toBe(false);
    expect(await storage.exists('quarantine', staleQuarantineOrphanKey)).toBe(false);
    expect(await storage.exists('quarantine', stalePartKey)).toBe(false);
    expect(await storage.exists('ready', freshReadyOrphanKey)).toBe(true);
    expect(await storage.exists('quarantine', freshQuarantineOrphanKey)).toBe(true);
    expect(await storage.exists('quarantine', freshPartKey)).toBe(true);
    expect(await storage.exists('ready', v1Row.objectKey)).toBe(true);
    expect(await storage.exists('ready', v2Row.objectKey)).toBe(true);
    expect(await storage.exists('ready', orphanKey)).toBe(true);
    expect(await storage.exists('quarantine', phase1ProtReadyQKey)).toBe(true);
    expect(await storage.exists('quarantine', phase1ProtPinQKey)).toBe(true);
    expect(await storage.exists('ready', linkedPoaNonReady.key)).toBe(true);
    expect(await storage.exists('ready', linkedHrNonReady.key)).toBe(true);
    expect(await storage.exists('ready', linkedDlNonReady.key)).toBe(true);
    expect(await storage.exists('ready', toctouSavedKey)).toBe(true);

    const activeRow = await prisma.uploadAttempt.findUniqueOrThrow({
      where: { id: activeAttempt.id },
    });
    expect(await storage.exists('quarantine', activeRow.quarantineKey)).toBe(true);

    // Verify protectedKeys and checksums
    for (const expectedProtected of [
      v1Row.objectKey,
      v2Row.objectKey,
      orphanKey,
      activeRow.quarantineKey,
      phase1ProtReadyQKey,
      phase1ProtPinQKey,
      linkedPoaNonReady.key,
      linkedHrNonReady.key,
      linkedDlNonReady.key,
      toctouSavedKey,
    ]) {
      expect(reconcileRes.protectedKeys).toContain(expectedProtected);
    }
    expect(reconcileRes.checksums[v1Row.objectKey]).toBe(sha256Hex(v1Bytes));
    expect(reconcileRes.checksums[v2Row.objectKey]).toBe(sha256Hex(v2Bytes));
    expect(reconcileRes.checksums[orphanKey]).toBe(sha256Hex(orphanBytes));
    expect(reconcileRes.checksums[activeRow.quarantineKey]).toBe(sha256Hex(activeBytes));
    expect(reconcileRes.checksums[toctouSavedKey]).toBe(sha256Hex(toctouBytes));

    // Verify RECONCILE_DOCUMENT_STORAGE AuditEvent recorded when actor passed
    const reconcileAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        userId: owner.id,
        action: 'RECONCILE_DOCUMENT_STORAGE',
        entityType: 'DocumentStorage',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(reconcileAudit.changedFields).toMatchObject({
      deletedCount: reconcileRes.deletedKeys.length,
      protectedCount: reconcileRes.protectedKeys.length,
      expiredAttemptCount: reconcileRes.expiredAttemptCount,
      deletedQuarantineCount: reconcileRes.deletedQuarantineCount,
      skippedProtectedCount: reconcileRes.skippedProtectedCount,
    });

    // Releasing activeBackupId makes its previously pinned non-READY orphan eligible for deletion
    const releaseActiveRes = await releaseBackupFilePins(
      { backupId: activeBackupId, releasedAt: now, actor: owner },
      { now }
    );
    expect(releaseActiveRes.releasedCount).toBe(1);

    const reconcileAfterRelease = await reconcileAndCleanupDocumentStorage(storage, {
      now,
      gracePeriodMs: 60_000,
      actor: owner,
    });
    expect(reconcileAfterRelease.deletedKeys).toContain(orphanKey);
    expect(await storage.exists('ready', orphanKey)).toBe(false);
    expect(await storage.exists('ready', v1Row.objectKey)).toBe(true);
    expect(await storage.exists('ready', v2Row.objectKey)).toBe(true);

    // Batch drain > 200 expired attempts (CLEANUP_BATCH_SIZE = 200) drains all 205 rows without stranding #201+
    const batchAttemptIds = Array.from({ length: 205 }, () => crypto.randomUUID());
    await prisma.uploadAttempt.createMany({
      data: batchAttemptIds.map((id, idx) => ({
        id,
        idempotencyRecordId: crypto.randomUUID(),
        actorId: owner.id,
        matterId: matterAId,
        title: `دفعة منتهية ${idx}`,
        documentType: 'OTHER',
        originalFilename: `batch-${idx}.pdf`,
        declaredMime: 'application/pdf',
        expectedSizeBytes: 100,
        quarantineKey: `q/batch-drain-${runSuffix}-${idx}.pdf`,
        status: 'INITIATED',
        expiresAt: pastGraceDate,
      })),
    });
    const drainRes = await reconcileAndCleanupDocumentStorage(storage, {
      now,
      gracePeriodMs: 60_000,
      actor: owner,
    });
    expect(drainRes.expiredAttemptCount).toBe(205);
    const remainingOpenBatch = await prisma.uploadAttempt.count({
      where: { id: { in: batchAttemptIds }, status: { not: 'EXPIRED' } },
    });
    expect(remainingOpenBatch).toBe(0);
  }, 60_000);
});
