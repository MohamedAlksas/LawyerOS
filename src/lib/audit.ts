import { Prisma } from '@prisma/client';

export interface RecordAuditParams {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changedFields?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
}

export interface AuditExecutionOptions {
  simulateFailure?: boolean;
}

function sanitizeAuditValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }
    seen.add(value);
    try {
      return value.map((item) => sanitizeAuditValue(item, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeAuditRecord(value as Record<string, unknown>, seen);
  }
  return value;
}

function sanitizeAuditRecord(
  payload: Record<string, unknown>,
  seen: WeakSet<object>
): Record<string, unknown> {
  if (seen.has(payload)) {
    return { circular: '[CIRCULAR]' };
  }
  seen.add(payload);

  try {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();
      const normalizedKey = lowerKey.replace(/[_-]/g, '');

      // Redact secret keys, passwords, tokens, MFA secrets, auth headers, storage keys, and sensitive identity keys
      if (
        normalizedKey.includes('secret') ||
        normalizedKey.includes('password') ||
        normalizedKey.includes('token') ||
        normalizedKey.includes('encryptionkey') ||
        normalizedKey.includes('apikey') ||
        normalizedKey.includes('privatekey') ||
        normalizedKey.includes('objectkey') ||
        normalizedKey.includes('quarantinekey') ||
        normalizedKey.includes('storagekey') ||
        normalizedKey.includes('ciphertext') ||
        normalizedKey.includes('authtag') ||
        normalizedKey.includes('backupcode') ||
        normalizedKey.includes('recoverycode') ||
        normalizedKey.includes('totp') ||
        normalizedKey.includes('cookie') ||
        normalizedKey.includes('authorization') ||
        normalizedKey.includes('nationalid') ||
        normalizedKey.includes('passport') ||
        normalizedKey.includes('identificationnumber') ||
        normalizedKey === 'iv' ||
        normalizedKey === 'initializationvector'
      ) {
        sanitized[key] = '[REDACTED_SECRET]';
        continue;
      }

      // Keep only the identity document type in audit history.
      if (normalizedKey === 'identity' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const idObj = value as Record<string, unknown>;
        sanitized[key] = {
          identificationType: idObj.identificationType,
        };
        continue;
      }

      if (normalizedKey === 'number' && typeof value === 'string') {
        sanitized[key] = value.length > 4 ? `****${value.slice(-4)}` : '****';
        continue;
      }

      sanitized[key] = sanitizeAuditValue(value, seen);
    }

    return sanitized;
  } finally {
    seen.delete(payload);
  }
}

/**
 * Redacts potentially sensitive values from audit event metadata.
 * Explicitly guards against leaking plaintext national IDs, passports,
 * crypto keys, passwords, or tokens into the immutable audit trail.
 */
export function sanitizeAuditPayload(payload?: Record<string, unknown> | null): Prisma.InputJsonValue | undefined {
  if (!payload) return undefined;
  return sanitizeAuditRecord(payload, new WeakSet<object>()) as Prisma.InputJsonValue;
}

/**
 * Records an immutable audit event atomically within an existing Prisma transaction.
 * If the audit insert fails (or simulateFailure is triggered), the entire transaction aborts.
 */
export async function recordAuditEvent(
  tx: Prisma.TransactionClient,
  params: RecordAuditParams,
  options: AuditExecutionOptions = {}
): Promise<void> {
  if (options.simulateFailure) {
    throw new Error('SIMULATED_AUDIT_TRANSACTION_FAILURE');
  }

  const sanitizedChanges = sanitizeAuditPayload(params.changedFields);

  await tx.auditEvent.create({
    data: {
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      changedFields: sanitizedChanges,
      reason: params.reason ?? null,
      requestId: params.requestId ?? null,
    },
  });
}

