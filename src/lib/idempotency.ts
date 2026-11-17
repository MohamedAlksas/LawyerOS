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
  const { actorId, commandType, key, payload } = params;
  const payloadHash = computePayloadHash(payload);

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
    if (existing.payloadHash !== payloadHash) {
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

