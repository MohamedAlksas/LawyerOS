import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Prisma, type PrismaClient, type UploadAttemptStatus } from '@prisma/client';
import { z } from 'zod';
import { getPrismaClient } from '@/lib/auth';
import { recordAuditEvent, sanitizeAuditPayload } from '@/lib/audit';
import { formatUtcDateToIsoDate, parseCalendarDateToUtcDate } from '@/lib/cairo-date';
import { isWorkerDispatchDisabled, redactErrorMessage } from '@/lib/env';
import {
  IdempotencyConcurrentConflictError,
  IdempotencyPayloadMismatchError,
  claimIdempotencyKey,
  completeIdempotencyKey,
  computePayloadHash,
  resolveConcurrentIdempotency,
  runWithIdempotencyRetry,
} from '@/lib/idempotency';
import { normalizeArabicText } from '@/lib/normalization';
import { assertAuthorized } from '@/modules/identity/authorize';
import type { Actor, Permission } from '@/modules/identity/types';
import {
  inspectFileContent,
  sanitizeDisplayFilename,
  validateMimeAndExtension,
} from './content-validator';
import {
  createLocalDocumentStorage,
  type DocumentStorageAdapter,
  type DocumentStorageSource,
  type StoredZoneFile,
} from './document-storage';
import {
  ALLOWED_DOCUMENT_MIMES,
  ConcurrencyConflictError,
  CrossMatterLinkForbiddenError,
  DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
  DocumentNotFoundError,
  DocumentNotReadyError,
  DocumentScanPolicyUnavailableError,
  DocumentStoragePathError,
  DocumentValidationError,
  DuplicateChecksumWarningError,
  MAX_DOCUMENT_BYTES,
  UPLOAD_ATTEMPT_EXPIRY_MS,
  UnauthorizedError,
  beginUploadSchema,
  beginVersionUploadSchema,
  finalizeUploadSchema,
  getScanStatusLabel,
  listDocumentsSchema,
  updateDocumentMetadataSchema,
  type BeginUploadInput,
  type BeginVersionUploadInput,
  type CleanupExpiredUploadsResult,
  type DocumentDTO,
  type DocumentDetailDTO,
  type DocumentVersionDTO,
  type DuplicateChecksumMatchDTO,
  type FinalizeUploadInput,
  type LinkableDocumentSummary,
  type ListDocumentsParams,
  type ListDocumentsResult,
  type PinDocumentVersionsResult,
  type ReconcileDocumentStorageResult,
  type ReleaseBackupFilePinsResult,
  type UpdateDocumentMetadataInput,
  type UploadAttemptDTO,
} from './document-types';
import { evaluateDocumentScanPolicy, type ScanPolicyMode } from './scan-policy';

export type { LinkableDocumentSummary };

export type DocumentLinkScope =
  | { kind: 'MATTER'; matterId: string; proceedingId?: string | null; hearingId?: string | null }
  | { kind: 'PARTY_POA'; partyId: string };

const GENERIC_UPLOAD_FAILURE_AR = 'تعذر إتمام معالجة الملف بسبب خطأ تقني مؤقت.';

function toSafeFailureReason(err: unknown): string {
  if (
    err instanceof DocumentValidationError ||
    err instanceof DocumentStoragePathError ||
    err instanceof CrossMatterLinkForbiddenError ||
    err instanceof DocumentNotFoundError ||
    err instanceof DocumentScanPolicyUnavailableError ||
    err instanceof ConcurrencyConflictError ||
    err instanceof IdempotencyPayloadMismatchError ||
    err instanceof IdempotencyConcurrentConflictError
  ) {
    return redactErrorMessage(err.message);
  }
  return GENERIC_UPLOAD_FAILURE_AR;
}

const prisma = new Proxy({} as ReturnType<typeof getPrismaClient>, {
  get(_target, prop) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

const uuidSchema = z.string().uuid('المعرف غير صالح.');

export interface DocumentServiceOptions {
  now?: Date;
  storage?: DocumentStorageAdapter;
  prismaOverride?: PrismaClient;
}

export interface FinalizeUploadOptions extends DocumentServiceOptions {
  scanPolicyMode?: ScanPolicyMode | string;
  beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void> | void;
  simulateDbFailure?: boolean;
}

export interface AuthorizeDownloadOptions extends DocumentServiceOptions {
  disposition?: 'inline' | 'attachment';
  requestId?: string | null;
}

export interface AuthorizedDownloadResult {
  document: DocumentDTO;
  version: DocumentVersionDTO;
  headers: Record<string, string>;
  openStream: () => Promise<Readable>;
  readBytes: () => Promise<Buffer>;
}

function getDb(options?: DocumentServiceOptions): PrismaClient {
  return options?.prismaOverride ?? (prisma as unknown as PrismaClient);
}

function getStorage(options?: DocumentServiceOptions): DocumentStorageAdapter {
  return options?.storage ?? createLocalDocumentStorage();
}

function assertActorAuthorized(actor: Actor | undefined | null, permission: Permission): Actor {
  if (!actor || !actor.id || !actor.role) {
    throw new UnauthorizedError('غير مصرح. يرجى تسجيل الدخول أولاً.');
  }
  assertAuthorized(actor, permission);
  return actor;
}

function parseOrThrow<T>(
  schema: {
    safeParse: (v: unknown) =>
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  },
  raw: unknown,
  fallbackMessage: string
): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map((segment) => String(segment)).join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new DocumentValidationError(fallbackMessage, fieldErrors);
  }
  return parsed.data;
}

function assertUuidOrThrow(value: string, label: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new DocumentValidationError(`معرف ${label} غير صالح.`);
  }
  return parsed.data;
}

function buildProceedingLabel(
  proceeding:
    | {
        court?: { name: string } | null;
        numberText?: string | null;
        yearLabel?: string | null;
      }
    | null
    | undefined
): string | null {
  if (!proceeding) return null;
  const court = proceeding.court?.name ?? 'محكمة غير محددة';
  const docket = proceeding.numberText
    ? `${proceeding.numberText}${proceeding.yearLabel ? ` / ${proceeding.yearLabel}` : ''}`
    : 'الرقم غير مستكمل';
  return `${court} — ${docket}`;
}

type DocumentVersionRow = Prisma.DocumentVersionGetPayload<object>;

type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: {
    matter: { select: { id: true; fileCode: true; title: true } };
    party: { select: { id: true; name: true } };
    proceeding: {
      select: {
        id: true;
        numberText: true;
        yearLabel: true;
        court: { select: { name: true } };
      };
    };
    hearing: { select: { id: true; hearingDate: true } };
    currentVersion: true;
    versions: true;
  };
}>;

/** List rows need the current version only; skip loading every version of every document. */
const documentListInclude = {
  matter: { select: { id: true, fileCode: true, title: true } },
  party: { select: { id: true, name: true } },
  proceeding: {
    select: {
      id: true,
      numberText: true,
      yearLabel: true,
      court: { select: { name: true } },
    },
  },
  hearing: { select: { id: true, hearingDate: true } },
  currentVersion: true,
} satisfies Prisma.DocumentInclude;

const documentInclude = {
  ...documentListInclude,
  versions: {
    orderBy: { versionNumber: 'desc' as const },
  },
} satisfies Prisma.DocumentInclude;

function mapVersionToDTO(ver: DocumentVersionRow): DocumentVersionDTO {
  const isReady =
    ver.uploadStatus === 'READY' &&
    (ver.scanStatus === 'NOT_SCANNED_POLICY' || ver.scanStatus === 'CLEAN');

  return {
    id: ver.id,
    documentId: ver.documentId,
    versionNumber: ver.versionNumber,
    originalFilename: ver.originalFilename,
    declaredMime: ver.declaredMime,
    detectedMime: ver.detectedMime,
    sizeBytes: ver.sizeBytes,
    sha256: ver.sha256,
    uploadStatus: ver.uploadStatus,
    scanStatus: ver.scanStatus,
    scanPolicyCode: ver.scanPolicyCode,
    scanPolicyVersion: ver.scanPolicyVersion,
    scanCheckedAt: ver.scanCheckedAt ? ver.scanCheckedAt.toISOString() : null,
    scanError: ver.scanError,
    scanStatusLabel: getScanStatusLabel(ver.scanStatus),
    isReady,
    createdAt: ver.createdAt.toISOString(),
    createdById: ver.createdById,
  };
}

function mapDocumentToDTO(
  doc: Omit<DocumentWithRelations, 'versions'> & { versions?: DocumentVersionRow[] },
  includeVersions = true
): DocumentDTO {
  return {
    id: doc.id,
    matterId: doc.matterId,
    matterFileCode: doc.matter?.fileCode ?? null,
    matterTitle: doc.matter?.title ?? null,
    partyId: doc.partyId,
    partyName: doc.party?.name ?? null,
    proceedingId: doc.proceedingId,
    proceedingLabel: buildProceedingLabel(doc.proceeding),
    hearingId: doc.hearingId,
    hearingDate: doc.hearing ? formatUtcDateToIsoDate(doc.hearing.hearingDate) : null,
    title: doc.title,
    documentType: doc.documentType,
    documentDate: formatUtcDateToIsoDate(doc.documentDate),
    description: doc.description,
    tags: doc.tags ?? [],
    originalLocation: doc.originalLocation,
    originalPresent: doc.originalPresent,
    sensitivity: doc.sensitivity,
    currentVersionId: doc.currentVersionId,
    currentVersion: doc.currentVersion ? mapVersionToDTO(doc.currentVersion) : null,
    ...(includeVersions ? { versions: (doc.versions ?? []).map(mapVersionToDTO) } : {}),
    archivedAt: doc.archivedAt ? doc.archivedAt.toISOString() : null,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    createdById: doc.createdById,
    updatedById: doc.updatedById,
    downloadDeviceNotice: DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
  };
}

function mapUploadAttemptToDTO(attempt: Prisma.UploadAttemptGetPayload<object>): UploadAttemptDTO {
  return {
    id: attempt.id,
    documentId: attempt.documentId,
    targetDocumentVersionId: attempt.targetDocumentVersionId,
    expectedDocumentVersion: attempt.expectedDocumentVersion,
    matterId: attempt.matterId,
    partyId: attempt.partyId,
    proceedingId: attempt.proceedingId,
    hearingId: attempt.hearingId,
    title: attempt.title,
    documentType: attempt.documentType,
    documentDate: formatUtcDateToIsoDate(attempt.documentDate),
    description: attempt.description,
    tags: attempt.tags ?? [],
    originalLocation: attempt.originalLocation,
    originalPresent: attempt.originalPresent,
    sensitivity: attempt.sensitivity,
    originalFilename: attempt.originalFilename,
    declaredMime: attempt.declaredMime,
    expectedSizeBytes: attempt.expectedSizeBytes,
    bytesWritten: attempt.bytesWritten,
    sha256: attempt.sha256,
    status: attempt.status,
    failureReason: attempt.failureReason,
    expiresAt: attempt.expiresAt.toISOString(),
    finalizedAt: attempt.finalizedAt ? attempt.finalizedAt.toISOString() : null,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

async function assertValidParentLinks(
  client: PrismaClient | Prisma.TransactionClient,
  links: {
    matterId?: string | null;
    partyId?: string | null;
    proceedingId?: string | null;
    hearingId?: string | null;
  },
  options?: { lockParents?: boolean }
): Promise<void> {
  const matterId = links.matterId ?? null;
  const partyId = links.partyId ?? null;
  const proceedingId = links.proceedingId ?? null;
  const hearingId = links.hearingId ?? null;
  const lockParents = options?.lockParents ?? false;

  if (Boolean(matterId) === Boolean(partyId)) {
    throw new DocumentValidationError(
      'يجب ربط المستند بملف قضية واحد أو بطرف واحد فقط.'
    );
  }

  if ((proceedingId || hearingId) && !matterId) {
    throw new CrossMatterLinkForbiddenError(
      'لا يمكن ربط القيد القضائي أو الجلسة بمستند غير تابع لملف قضية.'
    );
  }

  if (matterId) {
    const matter = lockParents
      ? (
          await client.$queryRaw<
            Array<{ id: string; status: string; archivedAt: Date | null }>
          >`
            SELECT "id", "status", "archivedAt"
            FROM "matter"
            WHERE "id" = ${matterId}
            FOR UPDATE
          `
        )[0] ?? null
      : await client.matter.findUnique({
          where: { id: matterId },
          select: { id: true, status: true, archivedAt: true },
        });
    if (!matter) {
      throw new DocumentNotFoundError('ملف القضية المحدد غير موجود.');
    }
    if (matter.archivedAt !== null || matter.status === 'ARCHIVED') {
      throw new DocumentValidationError('لا يمكن رفع مستند على ملف قضية مؤرشف.');
    }
  }

  if (partyId) {
    const party = lockParents
      ? (
          await client.$queryRaw<
            Array<{ id: string; archivedAt: Date | null }>
          >`
            SELECT "id", "archivedAt"
            FROM "party"
            WHERE "id" = ${partyId}
            FOR UPDATE
          `
        )[0] ?? null
      : await client.party.findUnique({
          where: { id: partyId },
          select: { id: true, archivedAt: true },
        });
    if (!party) {
      throw new DocumentNotFoundError('الطرف المحدد غير موجود.');
    }
    if (party.archivedAt !== null) {
      throw new DocumentValidationError('لا يمكن رفع مستند على طرف مؤرشف.');
    }
  }

  if (proceedingId) {
    const proceeding = lockParents
      ? (
          await client.$queryRaw<
            Array<{ id: string; matterId: string; archivedAt: Date | null }>
          >`
            SELECT "id", "matterId", "archivedAt"
            FROM "proceeding"
            WHERE "id" = ${proceedingId}
            FOR UPDATE
          `
        )[0] ?? null
      : await client.proceeding.findUnique({
          where: { id: proceedingId },
          select: { id: true, matterId: true, archivedAt: true },
        });
    if (!proceeding) {
      throw new DocumentNotFoundError('القيد القضائي المحدد غير موجود.');
    }
    if (proceeding.matterId !== matterId) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط المستند بقيد قضائي يتبع ملف قضية آخر.'
      );
    }
    if (proceeding.archivedAt !== null) {
      throw new DocumentValidationError('لا يمكن رفع مستند على قيد قضائي مؤرشف.');
    }
  }

  if (hearingId) {
    const hearing = await client.hearing.findUnique({
      where: { id: hearingId },
      select: {
        id: true,
        proceedingId: true,
        proceeding: { select: { id: true, matterId: true, archivedAt: true } },
      },
    });
    if (!hearing) {
      throw new DocumentNotFoundError('الجلسة المحددة غير موجودة.');
    }
    if (lockParents && !proceedingId) {
      const [lockedProceeding] = await client.$queryRaw<
        Array<{ id: string; matterId: string; archivedAt: Date | null }>
      >`
        SELECT "id", "matterId", "archivedAt"
        FROM "proceeding"
        WHERE "id" = ${hearing.proceedingId}
        FOR UPDATE
      `;
      if (!lockedProceeding) {
        throw new DocumentNotFoundError('القيد القضائي المحدد غير موجود.');
      }
      if (lockedProceeding.matterId !== matterId) {
        throw new CrossMatterLinkForbiddenError(
          'لا يمكن ربط المستند بجلسة تتبع ملف قضية آخر.'
        );
      }
      if (lockedProceeding.archivedAt !== null) {
        throw new DocumentValidationError('لا يمكن رفع مستند على جلسة في قيد قضائي مؤرشف.');
      }
    } else {
      if (hearing.proceeding.matterId !== matterId) {
        throw new CrossMatterLinkForbiddenError(
          'لا يمكن ربط المستند بجلسة تتبع ملف قضية آخر.'
        );
      }
      if (proceedingId && hearing.proceedingId !== proceedingId) {
        throw new CrossMatterLinkForbiddenError(
          'الجلسة المحددة لا تتبع القيد القضائي المختار.'
        );
      }
      if (hearing.proceeding.archivedAt !== null) {
        throw new DocumentValidationError('لا يمكن رفع مستند على جلسة في قيد قضائي مؤرشف.');
      }
    }
  }
}

function buildContentDisposition(
  disposition: 'inline' | 'attachment',
  originalFilename: string
): string {
  const safeBase = originalFilename
    .replace(/[\r\n\u0000-\u001f\u007f"/\\;]/g, '_')
    .trim();
  const dot = safeBase.lastIndexOf('.');
  const stem = dot > 0 ? safeBase.slice(0, dot) : safeBase;
  const ext = dot > 0 ? safeBase.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : '';
  const asciiStem = stem.replace(/[^\x20-\x7e]/g, '_').replace(/^[_ ]+|[_ ]+$/g, '');
  const asciiFallback = `${/[A-Za-z0-9]/.test(asciiStem) ? asciiStem : 'document'}${ext}`;
  const encodedUtf8 = encodeURIComponent(safeBase || 'document').replace(
    /['()*!]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

/** Attempt states that may still receive bytes and be expired/failed/rejected by an upload or cleanup. */
const OPEN_UPLOAD_STATUSES: UploadAttemptStatus[] = ['INITIATED', 'UPLOADED', 'FAILED'];

/**
 * Moves an open attempt to a terminal state, and unlinks its quarantine file ONLY when this call
 * made the transition, so a late failing upload can never delete bytes out from under a
 * concurrent VALIDATING finalize (or a FINALIZED/REJECTED attempt).
 */
async function closeOpenAttempt(
  db: PrismaClient,
  storage: DocumentStorageAdapter,
  attempt: { id: string; quarantineKey: string },
  data: Prisma.UploadAttemptUpdateManyMutationInput
): Promise<boolean> {
  const res = await db.uploadAttempt.updateMany({
    where: {
      id: attempt.id,
      status: { in: OPEN_UPLOAD_STATUSES },
      quarantineKey: attempt.quarantineKey,
    },
    data,
  });
  if (res.count > 0) {
    await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
  }
  return res.count > 0;
}

const EXPIRED_ATTEMPT_REASON_AR = 'انتهت صلاحية محاولة الرفع.';

async function loadOwnedAttempt(db: PrismaClient, actor: Actor, attemptId: string) {
  const attempt = await db.uploadAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) {
    throw new DocumentNotFoundError('محاولة الرفع غير موجودة.');
  }
  if (attempt.actorId !== actor.id && actor.role !== 'OWNER') {
    assertAuthorized(actor, 'MANAGE_SECURITY');
  }
  return attempt;
}

/**
 * Records an oversized `Content-Length` pre-check as a REJECTED attempt (same state a streamed
 * oversize produces) and throws the 413 `PAYLOAD_TOO_LARGE` validation error.
 */
export async function rejectOversizedUpload(
  actor: Actor,
  attemptId: string,
  options?: DocumentServiceOptions
): Promise<never> {
  assertActorAuthorized(actor, 'WRITE_DOCUMENTS');
  const validAttemptId = assertUuidOrThrow(attemptId, 'محاولة الرفع');
  const db = getDb(options);
  const attempt = await loadOwnedAttempt(db, actor, validAttemptId);
  const err = new DocumentValidationError(
    'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).',
    { file: 'حجم الملف يتجاوز 25 ميجابايت' },
    'PAYLOAD_TOO_LARGE'
  );
  await closeOpenAttempt(db, getStorage(options), attempt, {
    status: 'REJECTED',
    bytesWritten: 0,
    sha256: null,
    failureReason: toSafeFailureReason(err),
  });
  throw err;
}

export async function beginUpload(
  actor: Actor,
  input: BeginUploadInput,
  options?: DocumentServiceOptions
): Promise<UploadAttemptDTO> {
  assertActorAuthorized(actor, 'WRITE_DOCUMENTS');
  const parsed = parseOrThrow(beginUploadSchema, input, 'بيانات بدء رفع المستند غير صالحة.');

  const { displayFilename, extension } = sanitizeDisplayFilename(parsed.originalFilename);
  const declaredMime = validateMimeAndExtension(parsed.declaredMime, extension);
  const documentDate = parseCalendarDateToUtcDate(parsed.documentDate ?? null);
  const titleNormalized = normalizeArabicText(parsed.title);

  if (!titleNormalized) {
    throw new DocumentValidationError('عنوان المستند يجب أن يحتوي على أحرف أو أرقام صالحة.', {
      title: 'عنوان المستند غير صالح للبحث',
    });
  }

  const tags = Array.from(new Set(parsed.tags.map((t) => t.trim()).filter(Boolean)));
  const description = parsed.description || null;
  const originalLocation = parsed.originalLocation || null;
  const db = getDb(options);
  const storage = getStorage(options);
  const now = options?.now ?? new Date();

  const payloadForIdempotency = {
    matterId: parsed.matterId ?? null,
    partyId: parsed.partyId ?? null,
    proceedingId: parsed.proceedingId ?? null,
    hearingId: parsed.hearingId ?? null,
    title: parsed.title,
    documentType: parsed.documentType,
    documentDate: parsed.documentDate ?? null,
    description,
    tags,
    originalLocation,
    originalPresent: parsed.originalPresent,
    sensitivity: parsed.sensitivity,
    originalFilename: displayFilename,
    declaredMime,
    expectedSizeBytes: parsed.expectedSizeBytes,
  };

  const attemptId = await runWithIdempotencyRetry(
    async () =>
      await db.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'beginDocumentUpload',
          key: parsed.idempotencyKey,
          payload: payloadForIdempotency,
        });

        if (claim.isReplay && claim.resultId) {
          return claim.resultId;
        }

        await assertValidParentLinks(tx, {
          matterId: parsed.matterId,
          partyId: parsed.partyId,
          proceedingId: parsed.proceedingId,
          hearingId: parsed.hearingId,
        });

        let effectiveProceedingId = parsed.proceedingId ?? null;
        if (!effectiveProceedingId && parsed.hearingId) {
          const h = await tx.hearing.findUnique({
            where: { id: parsed.hearingId },
            select: { proceedingId: true },
          });
          if (h?.proceedingId) {
            effectiveProceedingId = h.proceedingId;
          }
        }

        const idemRecord = await tx.idempotencyRecord.findUniqueOrThrow({
          where: {
            actorId_commandType_key: {
              actorId: actor.id,
              commandType: 'beginDocumentUpload',
              key: parsed.idempotencyKey,
            },
          },
          select: { id: true },
        });

        const newAttemptId = crypto.randomUUID();
        const quarantineKey = storage.generateQuarantineKey(newAttemptId, extension, now);
        const expiresAt = new Date(now.getTime() + UPLOAD_ATTEMPT_EXPIRY_MS);

        await tx.uploadAttempt.create({
          data: {
            id: newAttemptId,
            idempotencyRecordId: idemRecord.id,
            actorId: actor.id,
            matterId: parsed.matterId ?? null,
            partyId: parsed.partyId ?? null,
            proceedingId: effectiveProceedingId,
            hearingId: parsed.hearingId ?? null,
            title: parsed.title,
            documentType: parsed.documentType,
            documentDate,
            description,
            tags,
            originalLocation,
            originalPresent: parsed.originalPresent,
            sensitivity: parsed.sensitivity,
            originalFilename: displayFilename,
            declaredMime,
            expectedSizeBytes: parsed.expectedSizeBytes,
            quarantineKey,
            bytesWritten: 0,
            status: 'INITIATED',
            expiresAt,
          },
        });

        await recordAuditEvent(tx, {
          userId: actor.id,
          action: 'INITIATE_DOCUMENT_UPLOAD',
          entityType: 'UploadAttempt',
          entityId: newAttemptId,
          changedFields: {
            matterId: parsed.matterId ?? null,
            partyId: parsed.partyId ?? null,
            proceedingId: effectiveProceedingId,
            hearingId: parsed.hearingId ?? null,
            documentType: parsed.documentType,
            originalFilename: displayFilename,
            declaredMime,
            expectedSizeBytes: parsed.expectedSizeBytes,
          },
        });

        await completeIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'beginDocumentUpload',
          key: parsed.idempotencyKey,
          resultType: 'UploadAttempt',
          resultId: newAttemptId,
          resultPayload: { attemptId: newAttemptId, status: 'INITIATED' },
        });

        return newAttemptId;
      }),
    async () => {
      const resolved = await resolveConcurrentIdempotency(db, {
        actorId: actor.id,
        commandType: 'beginDocumentUpload',
        key: parsed.idempotencyKey,
        payload: payloadForIdempotency,
      });
      if (!resolved || !resolved.resultId) return { resolved: false };
      return { resolved: true, value: resolved.resultId };
    }
  );

  const attempt = await db.uploadAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return mapUploadAttemptToDTO(attempt);
}

async function assertActiveDocumentParentForVersion(
  tx: Prisma.TransactionClient,
  doc: {
    matterId: string | null;
    partyId: string | null;
    proceedingId?: string | null;
    hearingId?: string | null;
  },
  options?: { actionLabel?: string; allowArchived?: boolean }
): Promise<void> {
  const actionLabel = options?.actionLabel ?? 'إضافة نسخة جديدة لمستند';
  const allowArchived = options?.allowArchived ?? false;

  if (doc.matterId) {
    const [matter] = await tx.$queryRaw<
      Array<{ id: string; status: string; archivedAt: Date | null }>
    >`
      SELECT "id", "status", "archivedAt"
      FROM "matter"
      WHERE "id" = ${doc.matterId}
      FOR UPDATE
    `;
    if (!matter) {
      throw new DocumentNotFoundError('ملف القضية المرتبط بالمستند غير موجود.');
    }
    if (!allowArchived && (matter.archivedAt !== null || matter.status === 'ARCHIVED')) {
      throw new DocumentValidationError(`لا يمكن ${actionLabel} في ملف قضية مؤرشف.`);
    }

    let proceedingIdToCheck = doc.proceedingId ?? null;
    if (!proceedingIdToCheck && doc.hearingId) {
      const hearing = await tx.hearing.findUnique({
        where: { id: doc.hearingId },
        select: { proceedingId: true },
      });
      if (!hearing) {
        throw new DocumentNotFoundError('الجلسة المرتبطة بالمستند غير موجودة.');
      }
      proceedingIdToCheck = hearing.proceedingId;
    }

    if (proceedingIdToCheck) {
      const [proceeding] = await tx.$queryRaw<
        Array<{ id: string; archivedAt: Date | null }>
      >`
        SELECT "id", "archivedAt"
        FROM "proceeding"
        WHERE "id" = ${proceedingIdToCheck}
        FOR UPDATE
      `;
      if (!proceeding) {
        throw new DocumentNotFoundError('القيد القضائي المرتبط بالمستند غير موجود.');
      }
      if (!allowArchived && proceeding.archivedAt !== null) {
        throw new DocumentValidationError(`لا يمكن ${actionLabel} في قيد قضائي مؤرشف.`);
      }
    }
  } else if (doc.partyId) {
    const [party] = await tx.$queryRaw<Array<{ id: string; archivedAt: Date | null }>>`
      SELECT "id", "archivedAt"
      FROM "party"
      WHERE "id" = ${doc.partyId}
      FOR UPDATE
    `;
    if (!party) {
      throw new DocumentNotFoundError('الطرف المرتبط بالمستند غير موجود.');
    }
    if (!allowArchived && party.archivedAt !== null) {
      throw new DocumentValidationError(`لا يمكن ${actionLabel} تابع لطرف مؤرشف.`);
    }
  }
}

/**
 * Canonical lock order: read parent IDs without locking -> lock matter -> proceeding (or party)
 * FOR UPDATE -> lock document FOR UPDATE LAST -> re-read locked document and assert active state.
 */
async function lockActiveDocumentForMutation(
  tx: Prisma.TransactionClient,
  documentId: string,
  options?: {
    actionLabel?: string;
    archivedDocumentMessage?: string;
    allowArchived?: boolean;
  }
) {
  const actionLabel = options?.actionLabel ?? 'إضافة نسخة جديدة لمستند';
  const archivedDocumentMessage =
    options?.archivedDocumentMessage ?? 'لا يمكن إضافة نسخة جديدة لمستند مؤرشف.';
  const allowArchived = options?.allowArchived ?? false;

  const docRef = await tx.document.findUnique({
    where: { id: documentId },
    select: { id: true, matterId: true, partyId: true, proceedingId: true, hearingId: true },
  });
  if (!docRef) {
    throw new DocumentNotFoundError('المستند المطلوب غير موجود.');
  }

  await assertActiveDocumentParentForVersion(tx, docRef, { actionLabel, allowArchived });

  const lockedDocs = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "document" WHERE "id" = ${documentId} FOR UPDATE
  `;
  if (lockedDocs.length === 0) {
    throw new DocumentNotFoundError('المستند المطلوب غير موجود.');
  }

  const lockedDoc = await tx.document.findUniqueOrThrow({
    where: { id: documentId },
  });
  if (!allowArchived && lockedDoc.archivedAt !== null) {
    throw new DocumentValidationError(archivedDocumentMessage);
  }
  if (
    lockedDoc.matterId !== docRef.matterId ||
    lockedDoc.partyId !== docRef.partyId ||
    lockedDoc.proceedingId !== docRef.proceedingId ||
    lockedDoc.hearingId !== docRef.hearingId
  ) {
    await assertActiveDocumentParentForVersion(tx, lockedDoc, { actionLabel, allowArchived });
  }

  return lockedDoc;
}

export async function beginVersionUpload(
  actor: Actor,
  input: BeginVersionUploadInput,
  options?: DocumentServiceOptions
): Promise<UploadAttemptDTO> {
  assertActorAuthorized(actor, 'WRITE_DOCUMENTS');
  const parsed = parseOrThrow(
    beginVersionUploadSchema,
    input,
    'بيانات بدء رفع نسخة جديدة غير صالحة.'
  );

  const { displayFilename, extension } = sanitizeDisplayFilename(parsed.originalFilename);
  const declaredMime = validateMimeAndExtension(parsed.declaredMime, extension);
  const db = getDb(options);
  const storage = getStorage(options);
  const now = options?.now ?? new Date();

  const payloadForIdempotency = {
    documentId: parsed.documentId,
    expectedDocumentVersion: parsed.expectedDocumentVersion,
    originalFilename: displayFilename,
    declaredMime,
    expectedSizeBytes: parsed.expectedSizeBytes,
  };

  const attemptId = await runWithIdempotencyRetry(
    async () =>
      await db.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'beginDocumentVersionUpload',
          key: parsed.idempotencyKey,
          payload: payloadForIdempotency,
        });

        if (claim.isReplay && claim.resultId) {
          return claim.resultId;
        }

        const doc = await lockActiveDocumentForMutation(tx, parsed.documentId);

        if (doc.version !== parsed.expectedDocumentVersion) {
          throw new ConcurrencyConflictError(
            'تم تعديل حالة المستند من جلسة أخرى. يرجى التحديث وإعادة المحاولة.'
          );
        }

        const idemRecord = await tx.idempotencyRecord.findUniqueOrThrow({
          where: {
            actorId_commandType_key: {
              actorId: actor.id,
              commandType: 'beginDocumentVersionUpload',
              key: parsed.idempotencyKey,
            },
          },
          select: { id: true },
        });

        const newAttemptId = crypto.randomUUID();
        const quarantineKey = storage.generateQuarantineKey(newAttemptId, extension, now);
        const expiresAt = new Date(now.getTime() + UPLOAD_ATTEMPT_EXPIRY_MS);

        await tx.uploadAttempt.create({
          data: {
            id: newAttemptId,
            documentId: doc.id,
            expectedDocumentVersion: parsed.expectedDocumentVersion,
            idempotencyRecordId: idemRecord.id,
            actorId: actor.id,
            matterId: doc.matterId,
            partyId: doc.partyId,
            proceedingId: doc.proceedingId,
            hearingId: doc.hearingId,
            title: doc.title,
            documentType: doc.documentType,
            documentDate: doc.documentDate,
            description: doc.description,
            tags: doc.tags,
            originalLocation: doc.originalLocation,
            originalPresent: doc.originalPresent,
            sensitivity: doc.sensitivity,
            originalFilename: displayFilename,
            declaredMime,
            expectedSizeBytes: parsed.expectedSizeBytes,
            quarantineKey,
            bytesWritten: 0,
            status: 'INITIATED',
            expiresAt,
          },
        });

        await recordAuditEvent(tx, {
          userId: actor.id,
          action: 'INITIATE_DOCUMENT_VERSION_UPLOAD',
          entityType: 'UploadAttempt',
          entityId: newAttemptId,
          changedFields: {
            documentId: doc.id,
            expectedDocumentVersion: parsed.expectedDocumentVersion,
            originalFilename: displayFilename,
            declaredMime,
            expectedSizeBytes: parsed.expectedSizeBytes,
          },
        });

        await completeIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'beginDocumentVersionUpload',
          key: parsed.idempotencyKey,
          resultType: 'UploadAttempt',
          resultId: newAttemptId,
          resultPayload: {
            attemptId: newAttemptId,
            documentId: doc.id,
            status: 'INITIATED',
          },
        });

        return newAttemptId;
      }),
    async () => {
      const resolved = await resolveConcurrentIdempotency(db, {
        actorId: actor.id,
        commandType: 'beginDocumentVersionUpload',
        key: parsed.idempotencyKey,
        payload: payloadForIdempotency,
      });
      if (!resolved || !resolved.resultId) return { resolved: false };
      return { resolved: true, value: resolved.resultId };
    }
  );

  const attempt = await db.uploadAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return mapUploadAttemptToDTO(attempt);
}

export async function uploadAttemptBytes(
  actor: Actor,
  attemptId: string,
  source: DocumentStorageSource,
  options?: DocumentServiceOptions
): Promise<UploadAttemptDTO> {
  assertActorAuthorized(actor, 'WRITE_DOCUMENTS');
  const validAttemptId = assertUuidOrThrow(attemptId, 'محاولة الرفع');

  const db = getDb(options);
  const storage = getStorage(options);
  const now = options?.now ?? new Date();

  const attempt = await loadOwnedAttempt(db, actor, validAttemptId);

  // Terminal/in-flight states win over expiry so lazy expiry never overwrites them.
  if (attempt.status === 'FINALIZED') {
    throw new ConcurrencyConflictError('تم اعتماد محاولة الرفع هذه مسبقاً ولا يمكن تعديل بياناتها.');
  }

  if (attempt.status === 'VALIDATING') {
    throw new ConcurrencyConflictError('محاولة الرفع قيد التحقق والاعتماد حالياً، لا يمكن تعديل بياناتها.');
  }

  if (attempt.status === 'REJECTED') {
    throw new DocumentValidationError(
      attempt.failureReason || 'تم رفض محاولة الرفع هذه ولا يمكن إعادة استخدامها.'
    );
  }

  if (attempt.status === 'EXPIRED' || attempt.expiresAt.getTime() <= now.getTime()) {
    await closeOpenAttempt(db, storage, attempt, {
      status: 'EXPIRED',
      failureReason: EXPIRED_ATTEMPT_REASON_AR,
    });
    throw new DocumentValidationError('انتهت صلاحية محاولة الرفع. يرجى بدء محاولة رفع جديدة.');
  }

  if (!OPEN_UPLOAD_STATUSES.includes(attempt.status)) {
    throw new DocumentValidationError('حالة محاولة الرفع لا تسمح باستقبال البيانات حالياً.');
  }

  const { extension } = sanitizeDisplayFilename(attempt.originalFilename);
  const newQuarantineKey = storage.generateQuarantineKey(attempt.id, extension, now);

  let alreadyRecordedFailure = false;
  try {
    const written = await storage.writeQuarantineStream(
      newQuarantineKey,
      source,
      MAX_DOCUMENT_BYTES
    );

    if (written.bytesWritten !== attempt.expectedSizeBytes) {
      await storage.deleteQuarantine(newQuarantineKey).catch(() => false);
      const mismatchMsg =
        written.bytesWritten < attempt.expectedSizeBytes
          ? 'انقطع الرفع أو لم يكتمل حجم الملف المتوقع في الحجر.'
          : 'حجم البيانات المستلمة لا يطابق الحجم المتوقع للملف.';
      await closeOpenAttempt(db, storage, attempt, {
        status: 'FAILED',
        bytesWritten: 0,
        sha256: null,
        failureReason: mismatchMsg,
      });
      alreadyRecordedFailure = true;
      throw new DocumentValidationError(mismatchMsg, { file: mismatchMsg });
    }

    const updatedRes = await db.uploadAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { in: OPEN_UPLOAD_STATUSES },
        quarantineKey: attempt.quarantineKey,
        expiresAt: { gt: now },
      },
      data: {
        status: 'UPLOADED',
        quarantineKey: newQuarantineKey,
        bytesWritten: written.bytesWritten,
        sha256: written.sha256,
        failureReason: null,
      },
    });

    if (updatedRes.count === 0) {
      await storage.deleteQuarantine(newQuarantineKey).catch(() => false);
      throw new ConcurrencyConflictError('تغيرت حالة محاولة الرفع أثناء استلام الملف. يرجى التحديث.');
    }

    if (attempt.quarantineKey !== newQuarantineKey) {
      await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
    }

    const updated = await db.uploadAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    return mapUploadAttemptToDTO(updated);
  } catch (err) {
    if (alreadyRecordedFailure || err instanceof ConcurrencyConflictError) {
      throw err;
    }

    await storage.deleteQuarantine(newQuarantineKey).catch(() => false);

    const isOversized =
      err instanceof DocumentValidationError && err.reasonCode === 'PAYLOAD_TOO_LARGE';

    await closeOpenAttempt(db, storage, attempt, {
      status: isOversized ? 'REJECTED' : 'FAILED',
      bytesWritten: 0,
      sha256: null,
      failureReason: toSafeFailureReason(err),
    }).catch(() => false);

    throw err;
  }
}
export async function finalizeUpload(
  actor: Actor,
  input: FinalizeUploadInput,
  options?: FinalizeUploadOptions
): Promise<DocumentDTO> {
  assertActorAuthorized(actor, 'WRITE_DOCUMENTS');
  const parsed = parseOrThrow(finalizeUploadSchema, input, 'بيانات اعتماد المستند غير صالحة.');

  const db = getDb(options);
  const storage = getStorage(options);
  const now = options?.now ?? new Date();
  const idemKey = parsed.idempotencyKey ?? parsed.attemptId;
  const payloadForIdempotency = {
    attemptId: parsed.attemptId,
    confirmDuplicate: parsed.confirmDuplicate,
  };
  const expectedHash = computePayloadHash(payloadForIdempotency);

  // Fast replay check before claiming VALIDATING
  const existingIdem = await db.idempotencyRecord.findUnique({
    where: {
      actorId_commandType_key: {
        actorId: actor.id,
        commandType: 'finalizeDocumentUpload',
        key: idemKey,
      },
    },
  });

  if (existingIdem) {
    if (existingIdem.payloadHash !== expectedHash) {
      throw new IdempotencyPayloadMismatchError();
    }
    if (existingIdem.status === 'COMPLETED' && existingIdem.resultId) {
      const existingDoc = await db.document.findUnique({
        where: { id: existingIdem.resultId },
        include: documentInclude,
      });
      if (existingDoc) {
        return mapDocumentToDTO(existingDoc);
      }
    }
  }

  const attempt = await db.uploadAttempt.findUnique({ where: { id: parsed.attemptId } });
  if (!attempt) {
    throw new DocumentNotFoundError('محاولة الرفع غير موجودة.');
  }

  if (attempt.actorId !== actor.id && actor.role !== 'OWNER') {
    assertAuthorized(actor, 'MANAGE_SECURITY');
  }

  if (attempt.status === 'FINALIZED') {
    throw new ConcurrencyConflictError('تم اعتماد محاولة الرفع هذه مسبقاً.');
  }

  if (attempt.status === 'REJECTED') {
    throw new DocumentValidationError(
      attempt.failureReason || 'تم رفض هذا الملف مسبقاً ولا يمكن اعتماده.'
    );
  }

  if (attempt.status === 'VALIDATING') {
    throw new ConcurrencyConflictError('محاولة الرفع قيد التحقق والاعتماد حالياً، يرجى الانتظار.');
  }

  if (attempt.status === 'EXPIRED' || attempt.expiresAt.getTime() <= now.getTime()) {
    await closeOpenAttempt(db, storage, attempt, {
      status: 'EXPIRED',
      failureReason: EXPIRED_ATTEMPT_REASON_AR,
    });
    throw new DocumentValidationError('انتهت صلاحية محاولة الرفع. يرجى بدء رفع جديد.');
  }
  if (attempt.status !== 'UPLOADED' && attempt.status !== 'FAILED') {
    throw new DocumentValidationError(
      'لم يكتمل رفع بيانات الملف إلى الحجر بعد (الرفع غير مكتمل).'
    );
  }

  if (attempt.status === 'FAILED' && attempt.bytesWritten === 0) {
    throw new DocumentValidationError(
      'فشلت محاولة الرفع السابقة قبل كتابة أي بيانات. يرجى إعادة محاولة رفع الملف أولاً.'
    );
  }

  // Atomically claim VALIDATING before reading quarantine bytes to eliminate TOCTOU races
  const claimValidating = await db.uploadAttempt.updateMany({
    where: {
      id: attempt.id,
      OR: [
        { status: 'UPLOADED' },
        { status: 'FAILED', bytesWritten: { gt: 0 } },
      ],
      quarantineKey: attempt.quarantineKey,
      expiresAt: { gt: now },
    },
    data: { status: 'VALIDATING' },
  });

  if (claimValidating.count === 0) {
    const replayAfterRace = await db.idempotencyRecord.findUnique({
      where: {
        actorId_commandType_key: {
          actorId: actor.id,
          commandType: 'finalizeDocumentUpload',
          key: idemKey,
        },
      },
    });
    if (replayAfterRace?.status === 'COMPLETED' && replayAfterRace.resultId && replayAfterRace.payloadHash === expectedHash) {
      const existingDoc = await db.document.findUnique({
        where: { id: replayAfterRace.resultId },
        include: documentInclude,
      });
      if (existingDoc) {
        return mapDocumentToDTO(existingDoc);
      }
    }
    throw new ConcurrencyConflictError('محاولة الرفع قيد المعالجة أو تم اعتمادها في طلب متزامن.');
  }

  const isVersionUpload = attempt.documentId !== null;
  const documentId = attempt.documentId ?? crypto.randomUUID();
  const versionId = crypto.randomUUID();
  let readyKey: string | null = null;
  let statusFinalizedOrReverted = false;
  let ownsValidatingClaim = true;

  try {
    const qStat = await storage.stat('quarantine', attempt.quarantineKey);
    if (!qStat || qStat.sizeBytes <= 0 || qStat.sizeBytes !== attempt.expectedSizeBytes) {
      throw new DocumentValidationError(
        'بيانات الملف في الحجر مفقودة أو غير مكتملة. يرجى إعادة رفع الملف.'
      );
    }

    const rawBytes = await storage.readQuarantineBytes(attempt.quarantineKey, MAX_DOCUMENT_BYTES);

    let inspected;
    try {
      inspected = inspectFileContent(rawBytes, {
        originalFilename: attempt.originalFilename,
        declaredMime: attempt.declaredMime,
        maxBytes: MAX_DOCUMENT_BYTES,
      });
    } catch (err) {
      const safeReason = toSafeFailureReason(err);
      const rejected = await db.$transaction(async (tx) => {
        const res = await tx.uploadAttempt.updateMany({
          where: { id: attempt.id, status: 'VALIDATING' },
          data: {
            status: 'REJECTED',
            failureReason: safeReason,
          },
        });
        if (res.count === 0) {
          return false;
        }
        await recordAuditEvent(tx, {
          userId: actor.id,
          action: 'REJECT_DOCUMENT_UPLOAD',
          entityType: 'UploadAttempt',
          entityId: attempt.id,
          changedFields: {
            status: 'REJECTED',
            documentId: attempt.documentId ?? null,
            originalFilename: attempt.originalFilename,
            declaredMime: attempt.declaredMime,
            expectedSizeBytes: attempt.expectedSizeBytes,
          },
          reason: safeReason,
        });
        return true;
      });
      if (rejected) {
        await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
      }
      statusFinalizedOrReverted = true;
      throw err;
    }

    if (attempt.sha256 && attempt.sha256 !== inspected.sha256) {
      throw new DocumentValidationError('بصمة الملف الفعلي لا تطابق الملف المرفوع.');
    }

    // Evaluate ADR 0003 scan policy (fails closed if REQUIRED); revert VALIDATING -> UPLOADED on policy block
    let scanPolicy;
    try {
      scanPolicy = evaluateDocumentScanPolicy(options?.scanPolicyMode, now);
    } catch (err) {
      await db.uploadAttempt
        .updateMany({
          where: { id: attempt.id, status: 'VALIDATING' },
          data: { status: 'UPLOADED' },
        })
        .catch(() => {});
      statusFinalizedOrReverted = true;
      throw err;
    }

    // Check duplicate SHA-256 against existing READY DocumentVersions of non-archived documents/parents
    const duplicateVersions = await db.documentVersion.findMany({
      where: {
        sha256: inspected.sha256,
        uploadStatus: 'READY',
        document: {
          archivedAt: null,
          AND: [
            { OR: [{ matterId: null }, { matter: { archivedAt: null, status: { not: 'ARCHIVED' } } }] },
            { OR: [{ partyId: null }, { party: { archivedAt: null } }] },
            { OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }] },
            { OR: [{ hearingId: null }, { hearing: { proceeding: { archivedAt: null } } }] },
          ],
        },
      },
      include: {
        document: {
          include: {
            matter: { select: { id: true, fileCode: true, title: true } },
            party: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (duplicateVersions.length > 0 && !parsed.confirmDuplicate) {
      const matches: DuplicateChecksumMatchDTO[] = duplicateVersions.map((dv) => ({
        documentId: dv.document.id,
        title: dv.document.title,
        documentType: dv.document.documentType,
        matterId: dv.document.matterId,
        matterFileCode: dv.document.matter?.fileCode ?? null,
        partyId: dv.document.partyId,
        partyName: dv.document.party?.name ?? null,
        versionId: dv.id,
        originalFilename: dv.originalFilename,
        createdAt: dv.createdAt.toISOString(),
      }));
      await db.uploadAttempt
        .updateMany({
          where: { id: attempt.id, status: 'VALIDATING' },
          data: { status: 'UPLOADED' },
        })
        .catch(() => {});
      statusFinalizedOrReverted = true;
      throw new DuplicateChecksumWarningError(matches, inspected.sha256);
    }

    const titleNormalized = normalizeArabicText(attempt.title);
    let tentativeVersionNumber = 1;
    if (!isVersionUpload) {
      readyKey = storage.generateReadyKey(documentId, 1, inspected.extension, now);
      // Promote the exact validated buffer in memory into private ready/ storage inside try/catch
      await storage.writeReadyBytes(readyKey, rawBytes);
    } else {
      if (attempt.expectedDocumentVersion == null) {
        throw new DocumentValidationError(
          'رقم إصدار المستند المتوقع مفقود في محاولة رفع النسخة.'
        );
      }
      const targetDoc = await db.document.findUnique({
        where: { id: documentId },
        include: {
          matter: { select: { id: true, status: true, archivedAt: true } },
          party: { select: { id: true, archivedAt: true } },
          proceeding: { select: { id: true, archivedAt: true } },
          hearing: {
            select: {
              id: true,
              proceeding: { select: { id: true, archivedAt: true } },
            },
          },
        },
      });
      if (!targetDoc) {
        throw new DocumentNotFoundError('المستند المطلوب غير موجود.');
      }
      if (targetDoc.archivedAt !== null) {
        throw new DocumentValidationError('لا يمكن إضافة نسخة جديدة لمستند مؤرشف.');
      }
      if (targetDoc.matterId) {
        if (!targetDoc.matter) {
          throw new DocumentNotFoundError('ملف القضية المرتبط بالمستند غير موجود.');
        }
        if (targetDoc.matter.archivedAt !== null || targetDoc.matter.status === 'ARCHIVED') {
          throw new DocumentValidationError('لا يمكن إضافة نسخة جديدة لمستند في ملف قضية مؤرشف.');
        }
        if (targetDoc.proceedingId) {
          if (!targetDoc.proceeding) {
            throw new DocumentNotFoundError('القيد القضائي المرتبط بالمستند غير موجود.');
          }
          if (targetDoc.proceeding.archivedAt !== null) {
            throw new DocumentValidationError('لا يمكن إضافة نسخة جديدة لمستند في قيد قضائي مؤرشف.');
          }
        } else if (targetDoc.hearingId) {
          if (!targetDoc.hearing) {
            throw new DocumentNotFoundError('الجلسة المرتبطة بالمستند غير موجودة.');
          }
          if (targetDoc.hearing.proceeding.archivedAt !== null) {
            throw new DocumentValidationError('لا يمكن إضافة نسخة جديدة لمستند في قيد قضائي مؤرشف.');
          }
        }
      } else if (targetDoc.partyId) {
        if (!targetDoc.party) {
          throw new DocumentNotFoundError('الطرف المرتبط بالمستند غير موجود.');
        }
        if (targetDoc.party.archivedAt !== null) {
          throw new DocumentValidationError('لا يمكن إضافة نسخة جديدة لمستند تابع لطرف مؤرشف.');
        }
      }
      if (targetDoc.version !== attempt.expectedDocumentVersion) {
        throw new ConcurrencyConflictError(
          'تم تعديل حالة المستند من جلسة أخرى قبل اعتماد النسخة الجديدة. يرجى إعادة المحاولة.'
        );
      }

      const maxVersionAgg = await db.documentVersion.aggregate({
        where: { documentId: targetDoc.id },
        _max: { versionNumber: true },
      });
      tentativeVersionNumber = (maxVersionAgg._max.versionNumber ?? 0) + 1;
      const versionReadyKey = storage.generateReadyKey(
        targetDoc.id,
        tentativeVersionNumber,
        inspected.extension,
        now
      );
      readyKey = versionReadyKey;
      // Write candidate bytes before opening the DB transaction so fsync never holds row locks.
      await storage.writeReadyBytes(versionReadyKey, rawBytes);
    }

    const txResult = await runWithIdempotencyRetry(
      async () =>
        await db.$transaction(async (tx) => {
          const claim = await claimIdempotencyKey(tx, {
            actorId: actor.id,
            commandType: 'finalizeDocumentUpload',
            key: idemKey,
            payload: payloadForIdempotency,
          });

          if (claim.isReplay && claim.resultId) {
            return {
              isReplay: true,
              documentId: claim.resultId,
              quarantineKey: attempt.quarantineKey,
            };
          }

          const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "upload_attempt" WHERE "id" = ${attempt.id} FOR UPDATE
          `;
          if (lockedRows.length === 0) {
            ownsValidatingClaim = false;
            throw new DocumentNotFoundError('محاولة الرفع غير موجودة.');
          }

          const lockedAttempt = await tx.uploadAttempt.findUniqueOrThrow({
            where: { id: attempt.id },
          });
          if (lockedAttempt.status === 'FINALIZED') {
            ownsValidatingClaim = false;
            throw new ConcurrencyConflictError('تم اعتماد محاولة الرفع هذه مسبقاً.');
          }
          if (lockedAttempt.status === 'REJECTED') {
            ownsValidatingClaim = false;
            throw new DocumentValidationError('تم رفض محاولة الرفع ولا يمكن اعتمادها.');
          }
          if (lockedAttempt.status !== 'VALIDATING') {
            ownsValidatingClaim = false;
            throw new ConcurrencyConflictError('تغيرت حالة محاولة الرفع أثناء الاعتماد.');
          }
          if (lockedAttempt.quarantineKey !== attempt.quarantineKey) {
            ownsValidatingClaim = false;
            throw new ConcurrencyConflictError('تغيرت بيانات محاولة الرفع أثناء المعالجة.');
          }
          if (lockedAttempt.sha256 && lockedAttempt.sha256 !== inspected.sha256) {
            throw new DocumentValidationError('بصمة الملف تغيرت أثناء المعالجة.');
          }

          if (lockedAttempt.documentId != null) {
            const lockedDoc = await lockActiveDocumentForMutation(tx, lockedAttempt.documentId);

            if (lockedAttempt.expectedDocumentVersion == null) {
              throw new DocumentValidationError(
                'رقم إصدار المستند المتوقع مفقود في محاولة رفع النسخة.'
              );
            }
            if (lockedDoc.version !== lockedAttempt.expectedDocumentVersion) {
              throw new ConcurrencyConflictError(
                'تم تعديل حالة المستند من جلسة أخرى قبل اعتماد النسخة الجديدة. يرجى إعادة المحاولة.'
              );
            }

            const maxVersionAgg = await tx.documentVersion.aggregate({
              where: { documentId: lockedDoc.id },
              _max: { versionNumber: true },
            });
            const nextVersionNumber = (maxVersionAgg._max.versionNumber ?? 0) + 1;
            if (nextVersionNumber !== tentativeVersionNumber) {
              throw new ConcurrencyConflictError(
                'تم تسجيل إصدار أحدث للمستند بالتزامن. يرجى إعادة المحاولة.'
              );
            }
            const versionReadyKey = readyKey!;

            await tx.documentVersion.create({
              data: {
                id: versionId,
                documentId: lockedDoc.id,
                versionNumber: nextVersionNumber,
                objectKey: versionReadyKey,
                originalFilename: inspected.displayFilename,
                declaredMime: inspected.declaredMime,
                detectedMime: inspected.detectedMime,
                sizeBytes: inspected.sizeBytes,
                sha256: inspected.sha256,
                uploadStatus: 'READY',
                scanStatus: scanPolicy.scanStatus,
                scanPolicyCode: scanPolicy.policyCode,
                scanPolicyVersion: scanPolicy.policyVersion,
                scanCheckedAt: scanPolicy.checkedAt,
                createdById: actor.id,
              },
            });

            await tx.document.update({
              where: { id: lockedDoc.id },
              data: {
                currentVersionId: versionId,
                version: { increment: 1 },
                updatedById: actor.id,
              },
            });

            await tx.uploadAttempt.update({
              where: { id: lockedAttempt.id },
              data: {
                status: 'FINALIZED',
                documentId: lockedDoc.id,
                targetDocumentVersionId: versionId,
                bytesWritten: inspected.sizeBytes,
                sha256: inspected.sha256,
                finalizedAt: now,
                failureReason: null,
              },
            });

            await recordAuditEvent(tx, {
              userId: actor.id,
              action: 'ADD_DOCUMENT_VERSION',
              entityType: 'Document',
              entityId: lockedDoc.id,
              changedFields: {
                versionId,
                versionNumber: nextVersionNumber,
                previousVersionId: lockedDoc.currentVersionId,
                previousDocumentVersion: lockedDoc.version,
                newDocumentVersion: lockedDoc.version + 1,
                originalFilename: inspected.displayFilename,
                detectedMime: inspected.detectedMime,
                sizeBytes: inspected.sizeBytes,
                sha256: inspected.sha256,
                uploadStatus: 'READY',
                scanStatus: scanPolicy.scanStatus,
                scanPolicyCode: scanPolicy.policyCode,
                scanPolicyVersion: scanPolicy.policyVersion,
                duplicateConfirmed: parsed.confirmDuplicate,
                duplicateMatchCount: duplicateVersions.length,
              },
            });

            await completeIdempotencyKey(tx, {
              actorId: actor.id,
              commandType: 'finalizeDocumentUpload',
              key: idemKey,
              resultType: 'Document',
              resultId: lockedDoc.id,
              resultPayload: {
                documentId: lockedDoc.id,
                versionId,
                versionNumber: nextVersionNumber,
                sha256: inspected.sha256,
                scanStatus: scanPolicy.scanStatus,
                scanPolicyCode: scanPolicy.policyCode,
              },
            });

            if (options?.simulateDbFailure) {
              throw new Error('SIMULATED_DB_FINALIZATION_FAILURE');
            }
            if (options?.beforeCommit) {
              await options.beforeCommit(tx);
            }

            return {
              isReplay: false,
              documentId: lockedDoc.id,
              quarantineKey: lockedAttempt.quarantineKey,
            };
          }

          let finalProceedingId = lockedAttempt.proceedingId;
          if (!finalProceedingId && lockedAttempt.hearingId) {
            const h = await tx.hearing.findUnique({
              where: { id: lockedAttempt.hearingId },
              select: { proceedingId: true },
            });
            if (h?.proceedingId) {
              finalProceedingId = h.proceedingId;
            }
          }

          // Re-validate and lock parent links inside the DB transaction (matter -> proceeding)
          await assertValidParentLinks(
            tx,
            {
              matterId: lockedAttempt.matterId,
              partyId: lockedAttempt.partyId,
              proceedingId: finalProceedingId,
              hearingId: lockedAttempt.hearingId,
            },
            { lockParents: true }
          );

          await tx.document.create({
            data: {
              id: documentId,
              matterId: lockedAttempt.matterId,
              partyId: lockedAttempt.partyId,
              proceedingId: finalProceedingId,
              hearingId: lockedAttempt.hearingId,
              title: lockedAttempt.title,
              titleNormalized,
              documentType: lockedAttempt.documentType,
              documentDate: lockedAttempt.documentDate,
              description: lockedAttempt.description,
              tags: lockedAttempt.tags,
              originalLocation: lockedAttempt.originalLocation,
              originalPresent: lockedAttempt.originalPresent,
              sensitivity: lockedAttempt.sensitivity,
              currentVersionId: null,
              version: 1,
              createdById: actor.id,
              updatedById: actor.id,
            },
          });

          await tx.documentVersion.create({
            data: {
              id: versionId,
              documentId,
              versionNumber: 1,
              objectKey: readyKey!,
              originalFilename: inspected.displayFilename,
              declaredMime: inspected.declaredMime,
              detectedMime: inspected.detectedMime,
              sizeBytes: inspected.sizeBytes,
              sha256: inspected.sha256,
              uploadStatus: 'READY',
              scanStatus: scanPolicy.scanStatus,
              scanPolicyCode: scanPolicy.policyCode,
              scanPolicyVersion: scanPolicy.policyVersion,
              scanCheckedAt: scanPolicy.checkedAt,
              createdById: actor.id,
            },
          });

          await tx.document.update({
            where: { id: documentId },
            data: { currentVersionId: versionId },
          });

          await tx.uploadAttempt.update({
            where: { id: lockedAttempt.id },
            data: {
              status: 'FINALIZED',
              documentId,
              targetDocumentVersionId: versionId,
              bytesWritten: inspected.sizeBytes,
              sha256: inspected.sha256,
              finalizedAt: now,
              failureReason: null,
            },
          });

          await recordAuditEvent(tx, {
            userId: actor.id,
            action: 'CREATE_DOCUMENT',
            entityType: 'Document',
            entityId: documentId,
            changedFields: {
              versionId,
              versionNumber: 1,
              matterId: lockedAttempt.matterId,
              partyId: lockedAttempt.partyId,
              proceedingId: finalProceedingId,
              hearingId: lockedAttempt.hearingId,
              documentType: lockedAttempt.documentType,
              originalFilename: inspected.displayFilename,
              detectedMime: inspected.detectedMime,
              sizeBytes: inspected.sizeBytes,
              sha256: inspected.sha256,
              uploadStatus: 'READY',
              scanStatus: scanPolicy.scanStatus,
              scanPolicyCode: scanPolicy.policyCode,
              scanPolicyVersion: scanPolicy.policyVersion,
              duplicateConfirmed: parsed.confirmDuplicate,
              duplicateMatchCount: duplicateVersions.length,
            },
          });

          await completeIdempotencyKey(tx, {
            actorId: actor.id,
            commandType: 'finalizeDocumentUpload',
            key: idemKey,
            resultType: 'Document',
            resultId: documentId,
            resultPayload: {
              documentId,
              versionId,
              sha256: inspected.sha256,
              scanStatus: scanPolicy.scanStatus,
              scanPolicyCode: scanPolicy.policyCode,
            },
          });

          if (options?.simulateDbFailure) {
            throw new Error('SIMULATED_DB_FINALIZATION_FAILURE');
          }
          if (options?.beforeCommit) {
            await options.beforeCommit(tx);
          }

          return { isReplay: false, documentId, quarantineKey: lockedAttempt.quarantineKey };
        }),
      async () => {
        const resolved = await resolveConcurrentIdempotency(db, {
          actorId: actor.id,
          commandType: 'finalizeDocumentUpload',
          key: idemKey,
          payload: payloadForIdempotency,
        });
        if (!resolved || !resolved.resultId) return { resolved: false };
        return {
          resolved: true,
          value: {
            isReplay: true,
            documentId: resolved.resultId,
            quarantineKey: attempt.quarantineKey,
          },
        };
      }
    );

    statusFinalizedOrReverted = true;

    // Committed: from here no failure may delete the ready/ file this transaction (or its replay winner) owns.
    const promotedReadyKey = readyKey;
    readyKey = null;
    if (txResult.isReplay) {
      if (promotedReadyKey) {
        await storage.deleteReady(promotedReadyKey).catch(() => false);
      }
    } else {
      await storage.deleteQuarantine(txResult.quarantineKey).catch(() => false);
    }

    const committedDoc = await db.document.findUniqueOrThrow({
      where: { id: txResult.documentId },
      include: documentInclude,
    });
    return mapDocumentToDTO(committedDoc);
  } catch (err) {
    if (readyKey) {
      // Delete any promoted ready file so no orphan ready file remains on disk
      await storage.deleteReady(readyKey).catch(() => false);
    }

    if (!statusFinalizedOrReverted && ownsValidatingClaim) {
      // Idempotency conflicts say nothing about the bytes: return the attempt to UPLOADED so the caller can retry.
      const retryable =
        err instanceof IdempotencyPayloadMismatchError ||
        err instanceof IdempotencyConcurrentConflictError;
      // Stale expectedDocumentVersion / missing or archived parents cannot succeed on retry.
      const terminalRejected =
        err instanceof ConcurrencyConflictError ||
        err instanceof DocumentNotFoundError ||
        err instanceof CrossMatterLinkForbiddenError ||
        err instanceof DocumentValidationError;
      const updated = await db.uploadAttempt
        .updateMany({
          where: { id: attempt.id, status: 'VALIDATING' },
          data: retryable
            ? { status: 'UPLOADED' }
            : {
                status: terminalRejected ? 'REJECTED' : 'FAILED',
                failureReason: toSafeFailureReason(err),
              },
        })
        .catch(() => ({ count: 0 }));
      if (terminalRejected && updated.count > 0) {
        await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
        await recordAuditEvent(db, {
          userId: actor.id,
          action: 'REJECT_DOCUMENT_UPLOAD',
          entityType: 'UploadAttempt',
          entityId: attempt.id,
          changedFields: {
            status: 'REJECTED',
            documentId: attempt.documentId ?? null,
            failureReason: toSafeFailureReason(err),
          },
        }).catch(() => false);
      }
    }

    throw err;
  }
}

export async function authorizeDownload(
  actor: Actor,
  documentId: string,
  versionId?: string,
  options?: AuthorizeDownloadOptions
): Promise<AuthorizedDownloadResult> {
  assertActorAuthorized(actor, 'READ_DOCUMENTS');
  const validDocId = assertUuidOrThrow(documentId, 'المستند');
  const validVersionId = versionId ? assertUuidOrThrow(versionId, 'نسخة المستند') : undefined;

  const db = getDb(options);
  const storage = getStorage(options);

  const doc = await db.document.findUnique({
    where: { id: validDocId },
    include: documentInclude,
  });

  if (!doc) {
    throw new DocumentNotFoundError('المستند المطلوب غير موجود.');
  }

  let targetVersion: DocumentVersionRow | null = null;
  if (validVersionId) {
    targetVersion = doc.versions.find((v) => v.id === validVersionId) ?? null;
    if (!targetVersion) {
      throw new DocumentNotFoundError('نسخة المستند المطلوبة غير موجودة.');
    }
  } else {
    if (!doc.currentVersion) {
      throw new DocumentNotReadyError(
        'المستند غير جاهز للعرض أو التحميل بعد (لم تكتمل مرحلة التحقق والاعتماد).'
      );
    }
    targetVersion = doc.currentVersion;
  }

  const isScanApproved =
    targetVersion.scanStatus === 'NOT_SCANNED_POLICY' ||
    targetVersion.scanStatus === 'CLEAN';

  if (targetVersion.uploadStatus !== 'READY' || !isScanApproved) {
    throw new DocumentNotReadyError(
      'المستند غير جاهز للعرض أو التحميل بعد (لم تكتمل مرحلة التحقق والاعتماد).'
    );
  }

  const fileStat = await storage.stat('ready', targetVersion.objectKey);
  if (!fileStat || fileStat.sizeBytes <= 0) {
    throw new DocumentNotFoundError('تعذر العثور على ملف المستند في التخزين الخاص.');
  }

  const detectedMime = targetVersion.detectedMime ?? 'application/octet-stream';
  const isSafePreviewMime = (ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(detectedMime);
  const requestedDisposition = options?.disposition === 'inline' ? 'inline' : 'attachment';
  const effectiveDisposition =
    requestedDisposition === 'inline' && isSafePreviewMime ? 'inline' : 'attachment';

  await db.auditEvent.create({
    data: {
      userId: actor.id,
      action: 'DOWNLOAD_DOCUMENT',
      entityType: 'Document',
      entityId: doc.id,
      changedFields: sanitizeAuditPayload({
        versionId: targetVersion.id,
        versionNumber: targetVersion.versionNumber,
        disposition: effectiveDisposition,
        detectedMime,
        sizeBytes: targetVersion.sizeBytes,
        scanStatus: targetVersion.scanStatus,
        scanPolicyCode: targetVersion.scanPolicyCode,
      }),
      requestId: options?.requestId ?? null,
    },
  });

  const isInlinePdf =
    effectiveDisposition === 'inline' && detectedMime === 'application/pdf';
  const contentSecurityPolicy = isInlinePdf
    ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
    : "default-src 'none'; sandbox; frame-ancestors 'self'";

  const headers: Record<string, string> = {
    'Content-Type': detectedMime,
    'Content-Length': String(fileStat.sizeBytes),
    'Content-Disposition': buildContentDisposition(
      effectiveDisposition,
      targetVersion.originalFilename
    ),
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': contentSecurityPolicy,
  };

  return {
    document: mapDocumentToDTO(doc),
    version: mapVersionToDTO(targetVersion),
    headers,
    openStream: () => storage.readReadyStream(targetVersion.objectKey),
    readBytes: () => storage.readReadyBytes(targetVersion.objectKey),
  };
}

export async function listDocuments(
  actor: Actor,
  params: ListDocumentsParams = {},
  options?: DocumentServiceOptions
): Promise<ListDocumentsResult> {
  assertActorAuthorized(actor, 'READ_DOCUMENTS');
  const parsed = parseOrThrow(listDocumentsSchema, params, 'معايير البحث في المستندات غير صالحة.');
  const db = getDb(options);

  const normalizedQuery = parsed.q ? normalizeArabicText(parsed.q) : '';

  if (parsed.q?.trim() && !normalizedQuery) {
    return {
      documents: [],
      total: 0,
      page: 1,
      totalPages: 1,
      limit: parsed.limit,
    };
  }

  const andClauses: Prisma.DocumentWhereInput[] = [];
  if (!parsed.includeArchived) {
    andClauses.push({
      archivedAt: null,
      AND: [
        { OR: [{ matterId: null }, { matter: { archivedAt: null, status: { not: 'ARCHIVED' } } }] },
        { OR: [{ partyId: null }, { party: { archivedAt: null } }] },
        { OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }] },
        { OR: [{ hearingId: null }, { hearing: { proceeding: { archivedAt: null } } }] },
      ],
    });
  }

  if (parsed.proceedingId) {
    andClauses.push({
      OR: [
        { proceedingId: parsed.proceedingId },
        { hearing: { proceedingId: parsed.proceedingId } },
      ],
    });
  }

  if (normalizedQuery) {
    andClauses.push({
      OR: [
        { titleNormalized: { contains: normalizedQuery } },
        {
          currentVersion: {
            is: {
              originalFilename: { contains: parsed.q!.trim(), mode: 'insensitive' },
            },
          },
        },
      ],
    });
  }

  const where: Prisma.DocumentWhereInput = {
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
    ...(parsed.matterId ? { matterId: parsed.matterId } : {}),
    ...(parsed.partyId ? { partyId: parsed.partyId } : {}),
    ...(parsed.hearingId ? { hearingId: parsed.hearingId } : {}),
    ...(parsed.documentType ? { documentType: parsed.documentType } : {}),
  };

  const total = await db.document.count({ where });
  const totalPages = Math.max(1, Math.min(1000, Math.ceil(total / parsed.limit)));
  const page = Math.min(parsed.page, totalPages);
  const skip = (page - 1) * parsed.limit;
  const rows = await db.document.findMany({
    where,
    include: documentListInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip,
    take: parsed.limit,
  });

  return {
    documents: rows.map((row) => mapDocumentToDTO(row, false)),
    total,
    page,
    totalPages,
    limit: parsed.limit,
  };
}

export async function getDocumentDetail(
  actor: Actor,
  documentId: string,
  options?: DocumentServiceOptions
): Promise<DocumentDetailDTO> {
  assertActorAuthorized(actor, 'READ_DOCUMENTS');
  const validDocId = assertUuidOrThrow(documentId, 'المستند');
  const db = getDb(options);

  const doc = await db.document.findUnique({
    where: { id: validDocId },
    include: documentInclude,
  });

  if (!doc) {
    throw new DocumentNotFoundError('المستند المطلوب غير موجود.');
  }

  return mapDocumentToDTO(doc, true) as DocumentDetailDTO;
}

export async function getDocument(
  actor: Actor,
  documentId: string,
  options?: DocumentServiceOptions
): Promise<DocumentDetailDTO> {
  return await getDocumentDetail(actor, documentId, options);
}

export async function updateDocumentMetadata(
  actor: Actor,
  input: UpdateDocumentMetadataInput,
  options?: DocumentServiceOptions
): Promise<DocumentDetailDTO> {
  assertActorAuthorized(actor, 'WRITE_DOCUMENTS');
  const parsed = parseOrThrow(
    updateDocumentMetadataSchema,
    input,
    'بيانات تحديث المستند غير صالحة.'
  );

  let titleNormalized: string | undefined;
  if (parsed.title !== undefined) {
    titleNormalized = normalizeArabicText(parsed.title);
    if (!titleNormalized) {
      throw new DocumentValidationError('عنوان المستند يجب أن يحتوي على أحرف أو أرقام صالحة.', {
        title: 'عنوان المستند غير صالح للبحث',
      });
    }
  }

  const documentDate =
    parsed.documentDate === undefined
      ? undefined
      : parseCalendarDateToUtcDate(parsed.documentDate);
  const description =
    parsed.description === undefined ? undefined : parsed.description || null;
  const originalLocation =
    parsed.originalLocation === undefined ? undefined : parsed.originalLocation || null;
  const tags =
    parsed.tags === undefined
      ? undefined
      : Array.from(new Set(parsed.tags.map((t) => t.trim()).filter(Boolean)));

  const db = getDb(options);
  const payloadForIdempotency = {
    documentId: parsed.documentId,
    expectedVersion: parsed.expectedVersion,
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.documentType !== undefined ? { documentType: parsed.documentType } : {}),
    ...(parsed.documentDate !== undefined ? { documentDate: parsed.documentDate } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(originalLocation !== undefined ? { originalLocation } : {}),
    ...(parsed.originalPresent !== undefined ? { originalPresent: parsed.originalPresent } : {}),
    ...(parsed.sensitivity !== undefined ? { sensitivity: parsed.sensitivity } : {}),
  };

  const updatedDocId = await runWithIdempotencyRetry(
    async () =>
      await db.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'updateDocumentMetadata',
          key: parsed.idempotencyKey,
          payload: payloadForIdempotency,
        });

        if (claim.isReplay && claim.resultId) {
          return claim.resultId;
        }

        const existing = await lockActiveDocumentForMutation(tx, parsed.documentId, {
          actionLabel: 'تعديل بيانات مستند',
          archivedDocumentMessage: 'لا يمكن تعديل بيانات مستند مؤرشف.',
        });
        if (existing.version !== parsed.expectedVersion) {
          throw new ConcurrencyConflictError(
            'تم تعديل بيانات المستند من جلسة أخرى. يرجى تحديث البيانات والمحاولة مجدداً.'
          );
        }

        const updateData: Prisma.DocumentUpdateManyMutationInput = {
          ...(parsed.title !== undefined ? { title: parsed.title, titleNormalized } : {}),
          ...(parsed.documentType !== undefined ? { documentType: parsed.documentType } : {}),
          ...(documentDate !== undefined ? { documentDate } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(originalLocation !== undefined ? { originalLocation } : {}),
          ...(parsed.originalPresent !== undefined
            ? { originalPresent: parsed.originalPresent }
            : {}),
          ...(parsed.sensitivity !== undefined ? { sensitivity: parsed.sensitivity } : {}),
          version: { increment: 1 },
          updatedById: actor.id,
        };

        const updateRes = await tx.document.updateMany({
          where: { id: existing.id, version: parsed.expectedVersion },
          data: updateData,
        });
        if (updateRes.count !== 1) {
          throw new ConcurrencyConflictError(
            'تم تعديل بيانات المستند من جلسة أخرى. يرجى تحديث البيانات والمحاولة مجدداً.'
          );
        }

        await recordAuditEvent(tx, {
          userId: actor.id,
          action: 'UPDATE_DOCUMENT_METADATA',
          entityType: 'Document',
          entityId: existing.id,
          changedFields: {
            previousVersion: existing.version,
            newVersion: existing.version + 1,
            ...(parsed.title !== undefined
              ? { title: { before: existing.title, after: parsed.title } }
              : {}),
            ...(parsed.documentType !== undefined
              ? { documentType: { before: existing.documentType, after: parsed.documentType } }
              : {}),
            ...(documentDate !== undefined
              ? {
                  documentDate: {
                    before: formatUtcDateToIsoDate(existing.documentDate),
                    after: parsed.documentDate ?? null,
                  },
                }
              : {}),
            ...(description !== undefined
              ? { description: { before: existing.description, after: description } }
              : {}),
            ...(tags !== undefined ? { tags: { before: existing.tags, after: tags } } : {}),
            ...(originalLocation !== undefined
              ? { originalLocation: { before: existing.originalLocation, after: originalLocation } }
              : {}),
            ...(parsed.originalPresent !== undefined
              ? {
                  originalPresent: {
                    before: existing.originalPresent,
                    after: parsed.originalPresent,
                  },
                }
              : {}),
            ...(parsed.sensitivity !== undefined
              ? { sensitivity: { before: existing.sensitivity, after: parsed.sensitivity } }
              : {}),
          },
        });

        await completeIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'updateDocumentMetadata',
          key: parsed.idempotencyKey,
          resultType: 'Document',
          resultId: existing.id,
          resultPayload: {
            documentId: existing.id,
            version: existing.version + 1,
          },
        });

        return existing.id;
      }),
    async () => {
      const resolved = await resolveConcurrentIdempotency(db, {
        actorId: actor.id,
        commandType: 'updateDocumentMetadata',
        key: parsed.idempotencyKey,
        payload: payloadForIdempotency,
      });
      if (!resolved || !resolved.resultId) return { resolved: false };
      return { resolved: true, value: resolved.resultId };
    }
  );

  const doc = await db.document.findUniqueOrThrow({
    where: { id: updatedDocId },
    include: documentInclude,
  });
  return mapDocumentToDTO(doc, true) as DocumentDetailDTO;
}

export async function assertLinkableDocument(
  tx: Prisma.TransactionClient,
  documentId: string,
  scope: DocumentLinkScope,
  options?: { allowExistingArchived?: boolean }
): Promise<LinkableDocumentSummary> {
  const validDocId = assertUuidOrThrow(documentId, 'المستند');
  const allowExistingArchived = options?.allowExistingArchived ?? false;
  if (scope.kind === 'MATTER') {
    assertUuidOrThrow(scope.matterId, 'ملف القضية');
    if (scope.proceedingId) {
      assertUuidOrThrow(scope.proceedingId, 'القيد القضائي');
    }
    if (scope.hearingId) {
      assertUuidOrThrow(scope.hearingId, 'الجلسة');
    }
  } else {
    assertUuidOrThrow(scope.partyId, 'الطرف');
  }

  const linkableInclude = {
    currentVersion: true,
    matter: { select: { id: true, status: true, archivedAt: true } },
    party: { select: { id: true, archivedAt: true } },
    proceeding: { select: { id: true, archivedAt: true } },
    hearing: {
      select: {
        id: true,
        proceedingId: true,
        proceeding: { select: { id: true, archivedAt: true } },
      },
    },
  } as const;

  // Verify scope ownership before locking so cross-matter/cross-principal checks fail fast without foreign locks.
  const preDoc = await tx.document.findUnique({
    where: { id: validDocId },
    include: linkableInclude,
  });
  if (!preDoc) {
    throw new DocumentNotFoundError('المستند المحدد غير موجود.');
  }

  let scopeProceedingId: string | null = null;
  if (scope.kind === 'MATTER') {
    if (preDoc.matterId !== scope.matterId) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط مستند لا يتبع ملف القضية المحدد.'
      );
    }
    scopeProceedingId = scope.proceedingId ?? null;
    if (!scopeProceedingId && scope.hearingId) {
      const scopeHearing = await tx.hearing.findUnique({
        where: { id: scope.hearingId },
        select: { proceedingId: true },
      });
      scopeProceedingId = scopeHearing?.proceedingId ?? null;
    }
    const preDocProceedingId = preDoc.proceedingId ?? preDoc.hearing?.proceedingId ?? null;
    if (preDocProceedingId && scopeProceedingId && preDocProceedingId !== scopeProceedingId) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط مستند مرتبط بقيد قضائي مختلف.'
      );
    }
    if (preDoc.hearingId && scope.hearingId && preDoc.hearingId !== scope.hearingId) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط مستند مرتبط بجلسة مختلفة.'
      );
    }
  } else if (preDoc.partyId !== scope.partyId) {
    if (preDoc.matterId === null) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط مستند يخص طرفاً آخر بهذا التوكيل.'
      );
    }
    const clientLink = await tx.matterParty.findFirst({
      where: {
        matterId: preDoc.matterId,
        partyId: scope.partyId,
        role: 'CLIENT',
      },
      select: { id: true },
    });
    if (!clientLink) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط هذا المستند بالتوكيل لأنه لا يتبع الموكل أو ملف قضية يمثله الموكل.'
      );
    }
  }

  await lockActiveDocumentForMutation(tx, validDocId, {
    actionLabel: 'ربط مستند',
    archivedDocumentMessage: 'لا يمكن ربط مستند مؤرشف.',
    allowArchived: allowExistingArchived,
  });

  const doc = await tx.document.findUnique({
    where: { id: validDocId },
    include: linkableInclude,
  });

  if (!doc) {
    throw new DocumentNotFoundError('المستند المحدد غير موجود.');
  }

  if (!allowExistingArchived) {
    if (doc.archivedAt !== null) {
      throw new DocumentValidationError('لا يمكن ربط مستند مؤرشف.');
    }
    if (doc.matter && (doc.matter.archivedAt !== null || doc.matter.status === 'ARCHIVED')) {
      throw new DocumentValidationError('لا يمكن ربط مستند تابع لملف قضية مؤرشف.');
    }
    if (doc.party && doc.party.archivedAt !== null) {
      throw new DocumentValidationError('لا يمكن ربط مستند تابع لطرف مؤرشف.');
    }
    if (doc.proceeding && doc.proceeding.archivedAt !== null) {
      throw new DocumentValidationError('لا يمكن ربط مستند تابع لقيد قضائي مؤرشف.');
    }
    if (doc.hearing?.proceeding && doc.hearing.proceeding.archivedAt !== null) {
      throw new DocumentValidationError('لا يمكن ربط مستند تابع لجلسة في قيد قضائي مؤرشف.');
    }
  }

  const ver = doc.currentVersion;
  const isScanApproved =
    ver !== null &&
    (ver.scanStatus === 'NOT_SCANNED_POLICY' || ver.scanStatus === 'CLEAN');

  if (!doc.currentVersionId || !ver || ver.uploadStatus !== 'READY' || !isScanApproved) {
    throw new DocumentNotReadyError(
      'المستند المحدد غير جاهز للربط بعد (لم تكتمل مرحلة التحقق والاعتماد).'
    );
  }

  if (scope.kind === 'MATTER') {
    if (doc.matterId !== scope.matterId) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط مستند لا يتبع ملف القضية المحدد.'
      );
    }
    const docProceedingId = doc.proceedingId ?? doc.hearing?.proceedingId ?? null;
    if (docProceedingId && scopeProceedingId && docProceedingId !== scopeProceedingId) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط مستند مرتبط بقيد قضائي مختلف.'
      );
    }
    if (doc.hearingId && scope.hearingId && doc.hearingId !== scope.hearingId) {
      throw new CrossMatterLinkForbiddenError(
        'لا يمكن ربط مستند مرتبط بجلسة مختلفة.'
      );
    }
  } else {
    if (doc.partyId !== scope.partyId) {
      if (doc.matterId === null) {
        throw new CrossMatterLinkForbiddenError(
          'لا يمكن ربط مستند يخص طرفاً آخر بهذا التوكيل.'
        );
      }
      const clientLink = await tx.matterParty.findFirst({
        where: {
          matterId: doc.matterId,
          partyId: scope.partyId,
          role: 'CLIENT',
          ...(allowExistingArchived
            ? {}
            : {
                matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
                party: { archivedAt: null },
              }),
        },
        select: { id: true },
      });
      if (!clientLink) {
        throw new CrossMatterLinkForbiddenError(
          'لا يمكن ربط هذا المستند بالتوكيل لأنه لا يتبع الموكل أو ملف قضية يمثله الموكل.'
        );
      }
    }
  }

  return {
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    proceedingId: doc.proceedingId ?? null,
    hearingId: doc.hearingId ?? null,
    currentVersionId: doc.currentVersionId,
    scanStatus: ver.scanStatus,
    scanStatusLabel: getScanStatusLabel(ver.scanStatus),
  };
}

export async function getUploadAttempt(
  actor: Actor,
  attemptId: string,
  options?: DocumentServiceOptions
): Promise<UploadAttemptDTO> {
  assertActorAuthorized(actor, 'READ_DOCUMENTS');
  const validAttemptId = assertUuidOrThrow(attemptId, 'محاولة الرفع');
  const db = getDb(options);

  const attempt = await db.uploadAttempt.findUnique({
    where: { id: validAttemptId },
  });

  if (!attempt) {
    throw new DocumentNotFoundError('محاولة الرفع غير موجودة.');
  }

  if (attempt.actorId !== actor.id && actor.role !== 'OWNER') {
    assertAuthorized(actor, 'MANAGE_SECURITY');
  }

  return mapUploadAttemptToDTO(attempt);
}

function assertValidBackupId(backupId: string): string {
  if (typeof backupId !== 'string') {
    throw new DocumentValidationError('معرف النسخة الاحتياطية مطلوب.', {
      backupId: 'معرف النسخة الاحتياطية غير صالح',
    });
  }
  const trimmed = backupId.trim();
  if (!trimmed || trimmed.length > 128) {
    throw new DocumentValidationError('معرف النسخة الاحتياطية غير صالح.', {
      backupId: 'معرف النسخة الاحتياطية مطلوب ولا يتجاوز 128 حرفاً',
    });
  }
  return trimmed;
}

function isRestoreModeEnabled(): boolean {
  return isWorkerDispatchDisabled({ RESTORE_MODE: process.env.RESTORE_MODE });
}

export async function pinDocumentVersionsForBackup(
  params: { backupId: string; documentVersionIds?: string[]; actor?: Actor },
  options?: DocumentServiceOptions
): Promise<PinDocumentVersionsResult> {
  if (params.actor !== undefined) {
    assertActorAuthorized(params.actor, 'MANAGE_OPERATIONS');
  }
  const backupId = assertValidBackupId(params.backupId);
  const requestedIds =
    params.documentVersionIds !== undefined
      ? Array.from(
          new Set(params.documentVersionIds.map((id) => assertUuidOrThrow(id, 'نسخة المستند')))
        )
      : undefined;

  if (isRestoreModeEnabled()) {
    throw new DocumentValidationError(
      'لا يمكن تعديل تثبيتات النسخ الاحتياطي أثناء تفعيل وضع الاستعادة (RESTORE_MODE).'
    );
  }

  const db = getDb(options);
  const now = options?.now ?? new Date();

  const targetIds = await db.$transaction(async (tx) => {
    const versionClient = tx.documentVersion;

    let resolvedIds: string[];
    if (requestedIds !== undefined) {
      if (requestedIds.length > 0) {
        const found = await versionClient.findMany({
          where: { id: { in: requestedIds } },
          select: { id: true },
        });
        if (found.length !== requestedIds.length) {
          throw new DocumentNotFoundError(
            'إحدى نسخ المستندات المطلوب تثبيتها للنسخة الاحتياطية غير موجودة.'
          );
        }
      }
      resolvedIds = requestedIds;
    } else {
      const activeVersions = await versionClient.findMany({
        where: {
          OR: [{ uploadStatus: 'READY' }, { currentForDocument: { isNot: null } }],
        },
        select: { id: true },
      });
      resolvedIds = activeVersions.map((v) => v.id);
    }

    if (resolvedIds.length > 0) {
      await tx.backupFilePin.createMany({
        data: resolvedIds.map((documentVersionId) => ({
          backupId,
          documentVersionId,
          pinnedAt: now,
          releasedAt: null,
        })),
        skipDuplicates: true,
      });

      await tx.backupFilePin.updateMany({
        where: {
          backupId,
          documentVersionId: { in: resolvedIds },
          releasedAt: { not: null },
        },
        data: {
          pinnedAt: now,
          releasedAt: null,
        },
      });
    }

    if (params.actor) {
      await recordAuditEvent(tx, {
        userId: params.actor.id,
        action: 'PIN_DOCUMENT_VERSIONS_FOR_BACKUP',
        entityType: 'BackupFilePin',
        entityId: backupId,
        changedFields: {
          backupId,
          pinnedCount: resolvedIds.length,
        },
      });
    }

    return resolvedIds;
  });

  return {
    backupId,
    pinnedCount: targetIds.length,
    documentVersionIds: targetIds,
  };
}

export async function releaseBackupFilePins(
  params: { backupId: string; releasedAt?: Date; actor?: Actor },
  options?: DocumentServiceOptions
): Promise<ReleaseBackupFilePinsResult> {
  if (params.actor !== undefined) {
    assertActorAuthorized(params.actor, 'MANAGE_OPERATIONS');
  }
  const backupId = assertValidBackupId(params.backupId);
  if (isRestoreModeEnabled()) {
    throw new DocumentValidationError(
      'لا يمكن تحرير تثبيتات النسخ الاحتياطي أثناء تفعيل وضع الاستعادة (RESTORE_MODE).'
    );
  }
  const db = getDb(options);
  const releasedAt = params.releasedAt ?? options?.now ?? new Date();

  const res = await db.$transaction(async (tx) => {
    const updated = await tx.backupFilePin.updateMany({
      where: {
        backupId,
        releasedAt: null,
      },
      data: { releasedAt },
    });

    if (params.actor) {
      await recordAuditEvent(tx, {
        userId: params.actor.id,
        action: 'RELEASE_BACKUP_FILE_PINS',
        entityType: 'BackupFilePin',
        entityId: backupId,
        changedFields: {
          backupId,
          releasedCount: updated.count,
          releasedAt: releasedAt.toISOString(),
        },
      });
    }
    return updated;
  });

  return {
    backupId,
    releasedCount: res.count,
    releasedAt: releasedAt.toISOString(),
  };
}

/** Open statuses + VALIDATING stale window that transition to EXPIRED during cleanup. */
const STALE_VALIDATING_MIN_WINDOW_MS = 5 * 60_000;
const DEFAULT_RECONCILE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 200;
const MAX_CLEANUP_BATCHES = 500;

/**
 * Protect ALL current & prior READY DocumentVersions, ANY DocumentVersion with an active BackupFilePin
 * (even orphan or non-READY), and any DocumentVersion belonging to a linked reference document.
 */
const protectedVersionWhere: Prisma.DocumentVersionWhereInput = {
  OR: [
    { uploadStatus: 'READY' },
    { currentForDocument: { isNot: null } },
    { backupPins: { some: { releasedAt: null } } },
    {
      document: {
        OR: [
          { powersOfAttorney: { some: {} } },
          { hearingResultDecisions: { some: {} } },
          { deadlineSources: { some: {} } },
          { feeAgreements: { some: {} } },
        ],
      },
    },
  ],
};

const protectedAttemptWhere: Prisma.UploadAttemptWhereInput = {
  targetDocumentVersion: {
    is: protectedVersionWhere,
  },
};

async function runExpiredUploadAttemptCleanup(
  storage: DocumentStorageAdapter,
  nowOrOptions?:
    | Date
    | { now?: Date; gracePeriodMs?: number; prismaOverride?: PrismaClient }
): Promise<CleanupExpiredUploadsResult & { deletedKeys: string[] }> {
  if (isRestoreModeEnabled()) {
    return {
      skipped: true,
      reason: 'RESTORE_MODE',
      expiredAttemptCount: 0,
      deletedQuarantineCount: 0,
      skippedProtectedCount: 0,
      deletedKeys: [],
    };
  }

  const now =
    nowOrOptions instanceof Date
      ? nowOrOptions
      : (nowOrOptions?.now ?? new Date());
  const gracePeriodMs =
    nowOrOptions instanceof Date ? 0 : (nowOrOptions?.gracePeriodMs ?? 0);
  const db =
    nowOrOptions instanceof Date
      ? (prisma as unknown as PrismaClient)
      : getDb({ prismaOverride: nowOrOptions?.prismaOverride });

  const cutoff = new Date(now.getTime() - Math.max(0, gracePeriodMs));
  const staleValidatingCutoff = new Date(
    now.getTime() - Math.max(Math.max(0, gracePeriodMs), STALE_VALIDATING_MIN_WINDOW_MS)
  );
  const expirableCleanupWhere: Prisma.UploadAttemptWhereInput = {
    expiresAt: { lte: cutoff },
    OR: [
      { status: { in: OPEN_UPLOAD_STATUSES } },
      { status: 'VALIDATING', updatedAt: { lte: staleValidatingCutoff } },
    ],
  };
  const cleanupEligibilityWhere: Prisma.UploadAttemptWhereInput = {
    expiresAt: { lte: cutoff },
    OR: [
      { status: { in: [...OPEN_UPLOAD_STATUSES, 'EXPIRED', 'REJECTED'] } },
      { status: 'VALIDATING', updatedAt: { lte: staleValidatingCutoff } },
    ],
  };

  let skippedProtectedCount = await db.uploadAttempt.count({
    where: {
      AND: [cleanupEligibilityWhere, protectedAttemptWhere],
    },
  });

  let expiredAttemptCount = 0;
  let deletedQuarantineCount = 0;
  const deletedKeys: string[] = [];

  async function findProtectedQuarantineKeySet(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await db.documentVersion.findMany({
      where: {
        AND: [{ objectKey: { in: keys } }, protectedVersionWhere],
      },
      select: { objectKey: true },
    });
    return new Set(rows.map((v) => v.objectKey));
  }

  // Phase 1A: Drain all eligible open and stale-VALIDATING expired attempts in bounded cursor batches
  // so >200 rows are never stranded non-EXPIRED before Phase 2 reconciliation runs.
  let cursorId: string | undefined;
  for (let batchIdx = 0; batchIdx < MAX_CLEANUP_BATCHES; batchIdx++) {
    const candidates = await db.uploadAttempt.findMany({
      where: {
        AND: [
          expirableCleanupWhere,
          { NOT: protectedAttemptWhere },
          ...(cursorId ? [{ id: { gt: cursorId } }] : []),
        ],
      },
      orderBy: { id: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    cursorId = candidates[candidates.length - 1].id;

    const protectedKeySet = await findProtectedQuarantineKeySet(
      Array.from(new Set(candidates.map((a) => a.quarantineKey)))
    );

    for (const attempt of candidates) {
      if (protectedKeySet.has(attempt.quarantineKey)) {
        skippedProtectedCount++;
        continue;
      }

      const claimed = await db.uploadAttempt.updateMany({
        where: {
          id: attempt.id,
          quarantineKey: attempt.quarantineKey,
          ...expirableCleanupWhere,
        },
        data: {
          status: 'EXPIRED',
          failureReason: attempt.failureReason ?? 'انتهت مهلة محاولة الرفع وتم تنظيف الملف المؤقت.',
        },
      });
      if (claimed.count === 0) {
        continue;
      }

      expiredAttemptCount++;
      const deleted = await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
      if (deleted) {
        deletedQuarantineCount++;
        deletedKeys.push(attempt.quarantineKey);
      }
    }

    if (candidates.length < CLEANUP_BATCH_SIZE) break;
  }

  // Phase 1B: Unlink leftover quarantine bytes for already-EXPIRED / REJECTED rows ONLY when the key
  // still exists on disk, avoiding repeatedly touching already-cleaned terminal rows.
  const qFilesOnDisk = storage.listKeys
    ? await storage.listKeys('quarantine')
    : await listZoneFilesFallback(storage.quarantineDir);
  const candidateDiskKeys = Array.from(
    new Set(qFilesOnDisk.filter((f) => !f.key.includes('.part-')).map((f) => f.key))
  );

  for (let offset = 0; offset < candidateDiskKeys.length; offset += CLEANUP_BATCH_SIZE) {
    const keyChunk = candidateDiskKeys.slice(offset, offset + CLEANUP_BATCH_SIZE);
    const terminalAttempts = await db.uploadAttempt.findMany({
      where: {
        AND: [
          {
            status: { in: ['EXPIRED', 'REJECTED'] },
            expiresAt: { lte: cutoff },
            quarantineKey: { in: keyChunk },
          },
          { NOT: protectedAttemptWhere },
        ],
      },
    });
    if (terminalAttempts.length === 0) continue;

    const protectedKeySet = await findProtectedQuarantineKeySet(
      Array.from(new Set(terminalAttempts.map((a) => a.quarantineKey)))
    );

    for (const attempt of terminalAttempts) {
      if (protectedKeySet.has(attempt.quarantineKey)) {
        skippedProtectedCount++;
        continue;
      }

      const claimed = await db.uploadAttempt.updateMany({
        where: {
          id: attempt.id,
          status: attempt.status,
          quarantineKey: attempt.quarantineKey,
          expiresAt: { lte: cutoff },
        },
        data: { status: attempt.status },
      });
      if (claimed.count === 0) {
        continue;
      }

      const deleted = await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
      if (deleted) {
        deletedQuarantineCount++;
        deletedKeys.push(attempt.quarantineKey);
      }
    }
  }

  return {
    skipped: false,
    expiredAttemptCount,
    deletedQuarantineCount,
    skippedProtectedCount,
    deletedKeys,
  };
}

export async function cleanupExpiredUploadAttempts(
  storage: DocumentStorageAdapter = createLocalDocumentStorage(),
  nowOrOptions?: Date | { now?: Date; gracePeriodMs?: number; prismaOverride?: PrismaClient }
): Promise<CleanupExpiredUploadsResult> {
  const res = await runExpiredUploadAttemptCleanup(storage, nowOrOptions);
  return {
    skipped: res.skipped,
    ...(res.reason !== undefined ? { reason: res.reason } : {}),
    expiredAttemptCount: res.expiredAttemptCount,
    deletedQuarantineCount: res.deletedQuarantineCount,
    skippedProtectedCount: res.skippedProtectedCount,
  };
}

async function listZoneFilesFallback(baseDir: string): Promise<StoredZoneFile[]> {
  const results: StoredZoneFile[] = [];
  async function walk(currentDir: string, relPrefix: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relKey = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, relKey);
      } else if (entry.isFile()) {
        let st: fs.Stats;
        try {
          st = await fs.promises.lstat(fullPath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') continue;
          throw err;
        }
        if (st.isFile()) {
          results.push({ key: relKey, sizeBytes: st.size, mtimeMs: st.mtimeMs });
        }
      }
    }
  }
  await walk(baseDir, '');
  results.sort((a, b) => a.key.localeCompare(b.key));
  return results;
}

async function computeZoneSha256(
  storage: DocumentStorageAdapter,
  zone: 'quarantine' | 'ready',
  key: string
): Promise<string | null> {
  if (storage.computeSha256) {
    return await storage.computeSha256(zone, key);
  }
  try {
    const bytes =
      zone === 'ready'
        ? await storage.readReadyBytes(key)
        : await storage.readQuarantineBytes(key);
    return crypto.createHash('sha256').update(bytes).digest('hex');
  } catch {
    return null;
  }
}

export async function reconcileAndCleanupDocumentStorage(
  storage: DocumentStorageAdapter = createLocalDocumentStorage(),
  options?: { now?: Date; gracePeriodMs?: number; prismaOverride?: PrismaClient; actor?: Actor }
): Promise<ReconcileDocumentStorageResult> {
  if (options?.actor !== undefined) {
    assertActorAuthorized(options.actor, 'MANAGE_OPERATIONS');
  }

  if (isRestoreModeEnabled()) {
    return {
      skipped: true,
      reason: 'RESTORE_MODE',
      deletedKeys: [],
      protectedKeys: [],
      expiredAttemptCount: 0,
      deletedQuarantineCount: 0,
      skippedProtectedCount: 0,
      checksums: {},
    };
  }

  const now = options?.now ?? new Date();
  const gracePeriodMs = options?.gracePeriodMs ?? DEFAULT_RECONCILE_GRACE_PERIOD_MS;

  const cleanupRes = await runExpiredUploadAttemptCleanup(storage, {
    now,
    gracePeriodMs,
    prismaOverride: options?.prismaOverride,
  });
  if (cleanupRes.skipped) {
    return {
      skipped: true,
      ...(cleanupRes.reason !== undefined ? { reason: cleanupRes.reason } : {}),
      deletedKeys: [],
      protectedKeys: [],
      expiredAttemptCount: 0,
      deletedQuarantineCount: 0,
      skippedProtectedCount: 0,
      checksums: {},
    };
  }

  const db = getDb({ prismaOverride: options?.prismaOverride });
  const cutoff = new Date(now.getTime() - Math.max(0, gracePeriodMs));
  const staleValidatingCutoff = new Date(
    now.getTime() - Math.max(Math.max(0, gracePeriodMs), STALE_VALIDATING_MIN_WINDOW_MS)
  );

  // List disk keys BEFORE querying DB so concurrent finalizeUpload writes/commits cannot fall
  // between an earlier DB snapshot and a later disk scan.
  const quarantineFiles = storage.listKeys
    ? await storage.listKeys('quarantine')
    : await listZoneFilesFallback(storage.quarantineDir);
  const readyFiles = storage.listKeys
    ? await storage.listKeys('ready')
    : await listZoneFilesFallback(storage.readyDir);

  // Protect Phase-1 protected attempts, active un-expired UploadAttempts, and non-stale VALIDATING attempts.
  const activeAttemptWhere: Prisma.UploadAttemptWhereInput = {
    OR: [
      protectedAttemptWhere,
      {
        status: { in: OPEN_UPLOAD_STATUSES },
        expiresAt: { gt: cutoff },
      },
      {
        status: 'VALIDATING',
        OR: [
          { expiresAt: { gt: cutoff } },
          { updatedAt: { gt: staleValidatingCutoff } },
        ],
      },
    ],
  };

  async function loadAllProtectedVersionKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    let cursorId: string | undefined;
    while (true) {
      const rows = await db.documentVersion.findMany({
        where: cursorId
          ? { AND: [protectedVersionWhere, { id: { gt: cursorId } }] }
          : protectedVersionWhere,
        select: { id: true, objectKey: true },
        orderBy: { id: 'asc' },
        take: 500,
      });
      for (const r of rows) keys.add(r.objectKey);
      if (rows.length < 500) break;
      cursorId = rows[rows.length - 1].id;
    }
    return keys;
  }

  async function loadAllActiveQuarantineKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    let cursorId: string | undefined;
    while (true) {
      const rows = await db.uploadAttempt.findMany({
        where: cursorId
          ? { AND: [activeAttemptWhere, { id: { gt: cursorId } }] }
          : activeAttemptWhere,
        select: { id: true, quarantineKey: true },
        orderBy: { id: 'asc' },
        take: 500,
      });
      for (const r of rows) keys.add(r.quarantineKey);
      if (rows.length < 500) break;
      cursorId = rows[rows.length - 1].id;
    }
    return keys;
  }

  const [protectedVersionKeySet, activeQuarantineKeySet] = await Promise.all([
    loadAllProtectedVersionKeys(),
    loadAllActiveQuarantineKeys(),
  ]);

  const deletedKeys = [...cleanupRes.deletedKeys];
  let deletedQuarantineCount = cleanupRes.deletedQuarantineCount;
  const protectedKeySet = new Set<string>();
  const checksums: Record<string, string> = {};
  const refNowMs = now.getTime();
  const graceWindowMs = Math.max(Math.max(0, gracePeriodMs), STALE_VALIDATING_MIN_WINDOW_MS);
  const activePartThresholdMs = refNowMs - graceWindowMs;
  const unreferencedGraceThresholdMs = refNowMs - graceWindowMs;

  async function isKeyReferencedInDb(zone: 'quarantine' | 'ready', key: string): Promise<boolean> {
    if (zone === 'ready') {
      const versionMatch = await db.documentVersion.findFirst({
        where: {
          AND: [{ objectKey: key }, protectedVersionWhere],
        },
        select: { id: true },
      });
      return Boolean(versionMatch);
    }
    const attemptMatch = await db.uploadAttempt.findFirst({
      where: {
        AND: [{ quarantineKey: key }, activeAttemptWhere],
      },
      select: { id: true },
    });
    if (attemptMatch) return true;
    const versionMatch = await db.documentVersion.findFirst({
      where: {
        AND: [{ objectKey: key }, protectedVersionWhere],
      },
      select: { id: true },
    });
    return Boolean(versionMatch);
  }

  async function recordProtectedFile(zone: 'quarantine' | 'ready', key: string): Promise<void> {
    protectedKeySet.add(key);
    const sha = await computeZoneSha256(storage, zone, key);
    if (sha) {
      checksums[key] = sha;
    }
  }

  async function unlinkZoneFile(zone: 'quarantine' | 'ready', key: string): Promise<void> {
    const deleted =
      zone === 'ready'
        ? await storage.deleteReady(key).catch(() => false)
        : await storage.deleteQuarantine(key).catch(() => false);
    if (deleted) {
      deletedKeys.push(key);
      if (zone === 'quarantine') {
        deletedQuarantineCount++;
      }
    }
  }

  async function reconcileZoneFiles(
    zone: 'quarantine' | 'ready',
    files: StoredZoneFile[]
  ): Promise<void> {
    for (const file of files) {
      if (file.key.includes('.part-')) {
        if (file.mtimeMs > activePartThresholdMs) {
          continue;
        }
        await unlinkZoneFile(zone, file.key);
        continue;
      }

      const isInitiallyProtected =
        (zone === 'ready' && protectedVersionKeySet.has(file.key)) ||
        (zone === 'quarantine' && (activeQuarantineKeySet.has(file.key) || protectedVersionKeySet.has(file.key)));
      if (isInitiallyProtected) {
        await recordProtectedFile(zone, file.key);
        continue;
      }

      // Skip unreferenced files newer than the conservative mtime grace window so concurrent
      // finalizeUpload writes/moves cannot be deleted before their DB commit becomes visible.
      if (file.mtimeMs > unreferencedGraceThresholdMs) {
        continue;
      }

      if (await isKeyReferencedInDb(zone, file.key)) {
        await recordProtectedFile(zone, file.key);
        continue;
      }

      await unlinkZoneFile(zone, file.key);
    }
  }

  await reconcileZoneFiles('quarantine', quarantineFiles);
  await reconcileZoneFiles('ready', readyFiles);

  const uniqueDeletedKeys = Array.from(new Set(deletedKeys)).sort();
  const sortedProtectedKeys = Array.from(protectedKeySet).sort();

  if (options?.actor) {
    await recordAuditEvent(db, {
      userId: options.actor.id,
      action: 'RECONCILE_DOCUMENT_STORAGE',
      entityType: 'DocumentStorage',
      entityId: 'document-storage',
      changedFields: {
        deletedCount: uniqueDeletedKeys.length,
        protectedCount: sortedProtectedKeys.length,
        expiredAttemptCount: cleanupRes.expiredAttemptCount,
        deletedQuarantineCount,
        skippedProtectedCount: cleanupRes.skippedProtectedCount,
      },
    });
  }

  return {
    skipped: false,
    deletedKeys: uniqueDeletedKeys,
    protectedKeys: sortedProtectedKeys,
    expiredAttemptCount: cleanupRes.expiredAttemptCount,
    deletedQuarantineCount,
    skippedProtectedCount: cleanupRes.skippedProtectedCount,
    checksums,
  };
}
