import crypto from 'node:crypto';
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
} from './document-storage';
import {
  ALLOWED_DOCUMENT_MIMES,
  ConcurrencyConflictError,
  CrossMatterLinkForbiddenError,
  DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
  DocumentNotFoundError,
  DocumentNotReadyError,
  DocumentScanPolicyUnavailableError,
  DocumentScanStatus,
  DocumentStoragePathError,
  DocumentValidationError,
  DuplicateChecksumWarningError,
  MAX_DOCUMENT_BYTES,
  UNSCANNED_POLICY_NOTICE_AR,
  UPLOAD_ATTEMPT_EXPIRY_MS,
  UnauthorizedError,
  beginUploadSchema,
  finalizeUploadSchema,
  listDocumentsSchema,
  type BeginUploadInput,
  type CleanupExpiredUploadsResult,
  type DocumentDTO,
  type DocumentVersionDTO,
  type DuplicateChecksumMatchDTO,
  type FinalizeUploadInput,
  type ListDocumentsParams,
  type ListDocumentsResult,
  type UploadAttemptDTO,
} from './document-types';
import { evaluateDocumentScanPolicy, type ScanPolicyMode } from './scan-policy';

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
  openStream: () => Readable;
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

function getScanStatusLabel(scanStatus: DocumentScanStatus): string {
  switch (scanStatus) {
    case 'NOT_SCANNED_POLICY':
      return UNSCANNED_POLICY_NOTICE_AR;
    case 'CLEAN':
      return 'تم الفحص — سليم';
    case 'PENDING':
      return 'بانتظار الفحص';
    case 'INFECTED':
      return 'مرفوض أمنياً';
    case 'FAILED':
      return 'فشل الفحص';
    case 'TIMEOUT':
      return 'انتهت مهلة الفحص';
    case 'STALE_DEFINITIONS':
      return 'تعريفات الفحص قديمة';
    default:
      return UNSCANNED_POLICY_NOTICE_AR;
  }
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
  }
): Promise<void> {
  const matterId = links.matterId ?? null;
  const partyId = links.partyId ?? null;
  const proceedingId = links.proceedingId ?? null;
  const hearingId = links.hearingId ?? null;

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
    const matter = await client.matter.findUnique({
      where: { id: matterId },
      select: { id: true, archivedAt: true },
    });
    if (!matter) {
      throw new DocumentNotFoundError('ملف القضية المحدد غير موجود.');
    }
    if (matter.archivedAt !== null) {
      throw new DocumentValidationError('لا يمكن رفع مستند على ملف قضية مؤرشف.');
    }
  }

  if (partyId) {
    const party = await client.party.findUnique({
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
    const proceeding = await client.proceeding.findUnique({
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
    where: { id: attempt.id, status: { in: OPEN_UPLOAD_STATUSES } },
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
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');
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
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');
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
    description: parsed.description ?? null,
    tags,
    originalLocation: parsed.originalLocation ?? null,
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
            proceedingId: parsed.proceedingId ?? null,
            hearingId: parsed.hearingId ?? null,
            title: parsed.title,
            documentType: parsed.documentType,
            documentDate,
            description: parsed.description ?? null,
            tags,
            originalLocation: parsed.originalLocation ?? null,
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
            proceedingId: parsed.proceedingId ?? null,
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

export async function uploadAttemptBytes(
  actor: Actor,
  attemptId: string,
  source: DocumentStorageSource,
  options?: DocumentServiceOptions
): Promise<UploadAttemptDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');
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

  let alreadyRecordedFailure = false;
  try {
    const written = await storage.writeQuarantineStream(
      attempt.quarantineKey,
      source,
      MAX_DOCUMENT_BYTES
    );

    if (written.bytesWritten !== attempt.expectedSizeBytes) {
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
        expiresAt: { gt: now },
      },
      data: {
        status: 'UPLOADED',
        bytesWritten: written.bytesWritten,
        sha256: written.sha256,
        failureReason: null,
      },
    });

    if (updatedRes.count === 0) {
      throw new ConcurrencyConflictError('تغيرت حالة محاولة الرفع أثناء استلام الملف. يرجى التحديث.');
    }

    const updated = await db.uploadAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    return mapUploadAttemptToDTO(updated);
  } catch (err) {
    if (alreadyRecordedFailure || err instanceof ConcurrencyConflictError) {
      throw err;
    }

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
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');
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

  // Atomically claim VALIDATING before reading quarantine bytes to eliminate TOCTOU races
  const claimValidating = await db.uploadAttempt.updateMany({
    where: {
      id: attempt.id,
      status: { in: ['UPLOADED', 'FAILED'] },
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

  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  let readyKey: string | null = null;
  let statusFinalizedOrReverted = false;

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
      await db.$transaction(async (tx) => {
        await tx.uploadAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'REJECTED',
            failureReason: safeReason,
          },
        });
        await recordAuditEvent(tx, {
          userId: actor.id,
          action: 'REJECT_DOCUMENT_UPLOAD',
          entityType: 'UploadAttempt',
          entityId: attempt.id,
          changedFields: {
            status: 'REJECTED',
            originalFilename: attempt.originalFilename,
            declaredMime: attempt.declaredMime,
            expectedSizeBytes: attempt.expectedSizeBytes,
          },
          reason: safeReason,
        });
      });
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

    // Check duplicate SHA-256 against existing READY DocumentVersions
    const duplicateVersions = await db.documentVersion.findMany({
      where: {
        sha256: inspected.sha256,
        uploadStatus: 'READY',
        document: { archivedAt: null },
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

    readyKey = storage.generateReadyKey(documentId, 1, inspected.extension, now);
    const titleNormalized = normalizeArabicText(attempt.title);

    // Promote the exact validated buffer in memory into private ready/ storage inside try/catch
    await storage.writeReadyBytes(readyKey, rawBytes);

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
            return { isReplay: true, documentId: claim.resultId };
          }

          const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "upload_attempt" WHERE "id" = ${attempt.id} FOR UPDATE
          `;
          if (lockedRows.length === 0) {
            throw new DocumentNotFoundError('محاولة الرفع غير موجودة.');
          }

          const lockedAttempt = await tx.uploadAttempt.findUniqueOrThrow({
            where: { id: attempt.id },
          });
          if (lockedAttempt.status === 'FINALIZED') {
            throw new ConcurrencyConflictError('تم اعتماد محاولة الرفع هذه مسبقاً.');
          }
          if (lockedAttempt.status === 'REJECTED') {
            throw new DocumentValidationError('تم رفض محاولة الرفع ولا يمكن اعتمادها.');
          }
          if (lockedAttempt.status !== 'VALIDATING') {
            throw new ConcurrencyConflictError('تغيرت حالة محاولة الرفع أثناء الاعتماد.');
          }
          if (lockedAttempt.sha256 && lockedAttempt.sha256 !== inspected.sha256) {
            throw new DocumentValidationError('بصمة الملف تغيرت أثناء المعالجة.');
          }

          // Re-validate parent links inside the DB transaction under lock
          await assertValidParentLinks(tx, {
            matterId: lockedAttempt.matterId,
            partyId: lockedAttempt.partyId,
            proceedingId: lockedAttempt.proceedingId,
            hearingId: lockedAttempt.hearingId,
          });

          await tx.document.create({
            data: {
              id: documentId,
              matterId: lockedAttempt.matterId,
              partyId: lockedAttempt.partyId,
              proceedingId: lockedAttempt.proceedingId,
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
              proceedingId: lockedAttempt.proceedingId,
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

          return { isReplay: false, documentId };
        }),
      async () => {
        const resolved = await resolveConcurrentIdempotency(db, {
          actorId: actor.id,
          commandType: 'finalizeDocumentUpload',
          key: idemKey,
          payload: payloadForIdempotency,
        });
        if (!resolved || !resolved.resultId) return { resolved: false };
        return { resolved: true, value: { isReplay: true, documentId: resolved.resultId } };
      }
    );

    statusFinalizedOrReverted = true;

    // Committed: from here no failure may delete the ready/ file this transaction (or its replay winner) owns.
    const promotedReadyKey = readyKey;
    readyKey = null;
    if (txResult.isReplay && txResult.documentId !== documentId) {
      await storage.deleteReady(promotedReadyKey).catch(() => false);
    } else {
      await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
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

    if (!statusFinalizedOrReverted && !(err instanceof ConcurrencyConflictError)) {
      // Idempotency conflicts say nothing about the bytes: return the attempt to UPLOADED so the caller can retry.
      const retryable =
        err instanceof IdempotencyPayloadMismatchError ||
        err instanceof IdempotencyConcurrentConflictError;
      await db.uploadAttempt
        .updateMany({
          where: { id: attempt.id, status: 'VALIDATING' },
          data: retryable
            ? { status: 'UPLOADED' }
            : { status: 'FAILED', failureReason: toSafeFailureReason(err) },
        })
        .catch(() => {});
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
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');
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

  const targetVersion = validVersionId
    ? doc.versions.find((v) => v.id === validVersionId)
    : doc.currentVersion ?? doc.versions[0] ?? null;

  if (!targetVersion) {
    throw new DocumentNotFoundError('نسخة المستند المطلوبة غير موجودة.');
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
  if (!fileStat) {
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
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');
  const parsed = parseOrThrow(listDocumentsSchema, params, 'معايير البحث في المستندات غير صالحة.');
  const db = getDb(options);

  const normalizedQuery = parsed.q ? normalizeArabicText(parsed.q) : '';

  const where: Prisma.DocumentWhereInput = {
    ...(parsed.includeArchived ? {} : { archivedAt: null }),
    ...(parsed.matterId ? { matterId: parsed.matterId } : {}),
    ...(parsed.partyId ? { partyId: parsed.partyId } : {}),
    ...(parsed.proceedingId ? { proceedingId: parsed.proceedingId } : {}),
    ...(parsed.hearingId ? { hearingId: parsed.hearingId } : {}),
    ...(parsed.documentType ? { documentType: parsed.documentType } : {}),
    ...(normalizedQuery
      ? {
          OR: [
            { titleNormalized: { contains: normalizedQuery, mode: 'insensitive' } },
            {
              currentVersion: {
                is: {
                  originalFilename: { contains: parsed.q!.trim(), mode: 'insensitive' },
                },
              },
            },
          ],
        }
      : {}),
  };

  const skip = (parsed.page - 1) * parsed.limit;
  const [total, rows] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      include: documentListInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip,
      take: parsed.limit,
    }),
  ]);

  return {
    documents: rows.map((row) => mapDocumentToDTO(row, false)),
    total,
    page: parsed.page,
    totalPages: Math.max(1, Math.ceil(total / parsed.limit)),
    limit: parsed.limit,
  };
}

export async function getDocument(
  actor: Actor,
  documentId: string,
  options?: DocumentServiceOptions
): Promise<DocumentDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');
  const validDocId = assertUuidOrThrow(documentId, 'المستند');
  const db = getDb(options);

  const doc = await db.document.findUnique({
    where: { id: validDocId },
    include: documentInclude,
  });

  if (!doc) {
    throw new DocumentNotFoundError('المستند المطلوب غير موجود.');
  }

  return mapDocumentToDTO(doc, true);
}

export async function getUploadAttempt(
  actor: Actor,
  attemptId: string,
  options?: DocumentServiceOptions
): Promise<UploadAttemptDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');
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

/** Open + REJECTED, plus EXPIRED (leftover quarantine files) and VALIDATING (crashed finalize) past expiry. */
const CLEANUP_ATTEMPT_STATUSES: UploadAttemptStatus[] = [
  ...OPEN_UPLOAD_STATUSES,
  'REJECTED',
  'EXPIRED',
  'VALIDATING',
];

export async function cleanupExpiredUploadAttempts(
  storage: DocumentStorageAdapter = createLocalDocumentStorage(),
  nowOrOptions?: Date | { now?: Date; gracePeriodMs?: number; prismaOverride?: PrismaClient }
): Promise<CleanupExpiredUploadsResult> {
  if (isWorkerDispatchDisabled()) {
    const restoreMode = isWorkerDispatchDisabled({ RESTORE_MODE: process.env.RESTORE_MODE });
    return {
      skipped: true,
      reason: restoreMode ? 'RESTORE_MODE' : 'REMINDER_DISPATCH_DISABLED',
      expiredAttemptCount: 0,
      deletedQuarantineCount: 0,
      skippedProtectedCount: 0,
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

  const protectedFilter: Prisma.UploadAttemptWhereInput = {
    targetDocumentVersion: {
      is: {
        OR: [
          { uploadStatus: 'READY' },
          { currentForDocument: { isNot: null } },
          { backupPins: { some: { releasedAt: null } } },
        ],
      },
    },
  };

  let skippedProtectedCount = await db.uploadAttempt.count({
    where: {
      status: { in: CLEANUP_ATTEMPT_STATUSES },
      expiresAt: { lte: cutoff },
      ...protectedFilter,
    },
  });

  const candidates = await db.uploadAttempt.findMany({
    where: {
      status: { in: CLEANUP_ATTEMPT_STATUSES },
      expiresAt: { lte: cutoff },
      NOT: protectedFilter,
    },
    // updatedAt: the claim below touches EXPIRED rows too, so already-clean ones rotate to the back.
    orderBy: { updatedAt: 'asc' },
    take: 200,
  });

  let expiredAttemptCount = 0;
  let deletedQuarantineCount = 0;

  for (const attempt of candidates) {
    // Defense-in-depth: ensure no READY or active-pinned DocumentVersion matches quarantineKey
    const matchingProtectedVersion = await db.documentVersion.findFirst({
      where: {
        objectKey: attempt.quarantineKey,
        OR: [
          { uploadStatus: 'READY' },
          { backupPins: { some: { releasedAt: null } } },
        ],
      },
      select: { id: true },
    });
    if (matchingProtectedVersion) {
      skippedProtectedCount++;
      continue;
    }

    // Atomically transition to EXPIRED before deleting quarantine bytes so finalized attempts cannot race
    const claimed = await db.uploadAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { in: CLEANUP_ATTEMPT_STATUSES },
        expiresAt: { lte: cutoff },
      },
      data: {
        status: 'EXPIRED',
        failureReason: attempt.failureReason ?? 'انتهت مهلة محاولة الرفع وتم تنظيف الملف المؤقت.',
      },
    });
    if (claimed.count === 0) {
      continue;
    }

    const deleted = await storage.deleteQuarantine(attempt.quarantineKey).catch(() => false);
    if (deleted) {
      deletedQuarantineCount++;
    }
    if (attempt.status !== 'EXPIRED') {
      expiredAttemptCount++;
    }
  }

  return {
    skipped: false,
    expiredAttemptCount,
    deletedQuarantineCount,
    skippedProtectedCount,
  };
}
