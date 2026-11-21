import crypto from 'crypto';
import { Prisma } from '@prisma/client';

export class IdempotencyPayloadMismatchError extends Error {
  constructor(message = 'لا يمكن إعادة استخدام مفتاح التكرار نفسه مع بيانات مختلفة.') {
    super(message);
    this.name = 'IdempotencyPayloadMismatchError';
  }
}

export class IdempotencyConcurrentConflictError extends Error {
  constructor(message = 'هناك عملية قيد التنفيذ حالياً بنفس مفتاح التكرار، يرجى الانتظار.') {
    super(message);
    this.name = 'IdempotencyConcurrentConflictError';
  }
}

/**
 * Checks whether an error is a Prisma unique constraint violation (P2002) on IdempotencyRecord.
 */
export function isIdempotencyUniqueConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const meta = error.meta as { target?: string[] | string; modelName?: string } | undefined;
    if (meta?.modelName === 'IdempotencyRecord') {
      return true;
    }
    const targetStr = Array.isArray(meta?.target) ? meta.target.join(',') : String(meta?.target || '');
    if (targetStr.includes('key') || targetStr.includes('actorId') || targetStr.includes('commandType')) {
      return true;
    }
    if (error.message.includes('idempotency_record') || error.message.includes('actorId_commandType_key')) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministically canonicalizes a JavaScript value to JSON (keys sorted alphabetically).
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalizeJson(item)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = sortedKeys.map(
      (k) => `${JSON.stringify(k)}:${canonicalizeJson((value as Record<string, unknown>)[k])}`
    );
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Computes SHA-256 hash of canonicalized payload.
 */
export function computePayloadHash(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface ClaimIdempotencyParams {
  actorId: string;
  commandType: string;
  key: string;
  payload: unknown;
  privateHashSecret?: string;
  legacyPayload?: unknown;
  digestVersion?: 'poa-v2';
}

function commandPayloadHashes(params: ClaimIdempotencyParams) {
  const { actorId, commandType, key, payload, privateHashSecret, legacyPayload, digestVersion } = params;
  const currentHash = computePayloadHash(payload);
  const legacyHash = legacyPayload === undefined ? currentHash : computePayloadHash(legacyPayload);
  if (!privateHashSecret) {
    return { legacyHash, payloadHash: digestVersion ? `${digestVersion}:${currentHash}` : currentHash };
  }

  const digest = crypto.createHmac('sha256', privateHashSecret)
    .update('lawoffice/idempotency/v1\0')
    .update(canonicalizeJson([actorId, commandType, key, currentHash]))
    .digest('hex');
  return { legacyHash, payloadHash: `hmac-v1:${digest}` };
}

export type ClaimIdempotencyResult =
  | { isReplay: false; payloadHash: string }
  | {
      isReplay: true;
      payloadHash: string;
      resultType: string | null;
      resultId: string | null;
      resultPayload: unknown;
    };

/**
 * Claims or checks an idempotency token within the database transaction.
 * 1. Checks existing record for (actorId, commandType, key).
 * 2. If present and payload hash differs -> throws IdempotencyPayloadMismatchError.
 * 3. If present and completed -> returns existing result payload.
 * 4. If present and in progress -> throws IdempotencyConcurrentConflictError.
 * 5. If not present -> creates in-progress record.
 */
export async function claimIdempotencyKey(
  tx: Prisma.TransactionClient,
  params: ClaimIdempotencyParams
): Promise<ClaimIdempotencyResult> {
  const { actorId, commandType, key } = params;
  const { legacyHash, payloadHash } = commandPayloadHashes(params);

  const existing = await tx.idempotencyRecord.findUnique({
    where: {
      actorId_commandType_key: {
        actorId,
        commandType,
        key,
      },
    },
  });

  if (existing) {
    if (existing.payloadHash !== payloadHash && existing.payloadHash !== legacyHash) {
      throw new IdempotencyPayloadMismatchError();
    }

    if (existing.status === 'COMPLETED') {
      if (params.privateHashSecret && existing.payloadHash !== payloadHash) {
        await tx.idempotencyRecord.updateMany({
          where: { id: existing.id, payloadHash: legacyHash },
          data: { payloadHash },
        });
      }
      return {
        isReplay: true,
        payloadHash,
        resultType: existing.resultType,
        resultId: existing.resultId,
        resultPayload: existing.resultPayload,
      };
    }

    throw new IdempotencyConcurrentConflictError();
  }

  // Record is new, insert as IN_PROGRESS
  await tx.idempotencyRecord.create({
    data: {
      actorId,
      commandType,
      key,
      payloadHash,
      status: 'IN_PROGRESS',
    },
  });

  return { isReplay: false, payloadHash };
}

export interface CompleteIdempotencyParams {
  actorId: string;
  commandType: string;
  key: string;
  resultType: string;
  resultId: string;
  resultPayload: unknown;
}

/**
 * Marks an in-progress idempotency record as COMPLETED and attaches the sanitized result summary.
 */
export async function completeIdempotencyKey(
  tx: Prisma.TransactionClient,
  params: CompleteIdempotencyParams
): Promise<void> {
  const { actorId, commandType, key, resultType, resultId, resultPayload } = params;

  await tx.idempotencyRecord.update({
    where: {
      actorId_commandType_key: {
        actorId,
        commandType,
        key,
      },
    },
    data: {
      status: 'COMPLETED',
      resultType,
      resultId,
      resultPayload: (resultPayload ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

export interface ResolveConcurrentOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Resolves concurrent same-key idempotency collisions outside the aborted transaction (R2-05).
 * When racing transactions hit a P2002 conflict on IdempotencyRecord:
 * 1. Checks the state of the winning record.
 * 2. If record is absent (winner rolled back): returns null to trigger clean retry.
 * 3. If payloadHash mismatches: throws IdempotencyPayloadMismatchError.
 * 4. If status === 'COMPLETED': returns the completed replay payload.
 * 5. If status === 'IN_PROGRESS': waits and re-polls; if still in progress, throws IdempotencyConcurrentConflictError.
 */
export type ClaimReplayResult = {
  isReplay: true;
  payloadHash: string;
  resultType: string | null;
  resultId: string | null;
  resultPayload: unknown;
};

export async function resolveConcurrentIdempotency(
  prisma: {
    idempotencyRecord: {
      findUnique: (args: Prisma.IdempotencyRecordFindUniqueArgs) => Promise<Prisma.IdempotencyRecordGetPayload<object> | null>;
    };
  },
  params: ClaimIdempotencyParams,
  options: ResolveConcurrentOptions = {}
): Promise<ClaimReplayResult | null> {
  const { actorId, commandType, key } = params;
  const { legacyHash, payloadHash } = commandPayloadHashes(params);
  const maxRetries = options.maxRetries ?? 8;
  const retryDelayMs = options.retryDelayMs ?? 100;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const existing = await prisma.idempotencyRecord.findUnique({
      where: {
        actorId_commandType_key: {
          actorId,
          commandType,
          key,
        },
      },
    });

    if (!existing) {
      // Winner transaction rolled back and un-inserted the record. Caller can retry cleanly!
      return null;
    }

    if (existing.payloadHash !== payloadHash && existing.payloadHash !== legacyHash) {
      throw new IdempotencyPayloadMismatchError();
    }

    if (existing.status === 'COMPLETED') {
      return {
        isReplay: true,
        payloadHash,
        resultType: existing.resultType,
        resultId: existing.resultId,
        resultPayload: existing.resultPayload,
      };
    }

    // Status is IN_PROGRESS — wait for winner to commit or abort
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  // Still in progress after max attempts
  throw new IdempotencyConcurrentConflictError();
}


