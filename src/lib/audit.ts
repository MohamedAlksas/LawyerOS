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

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeAuditPayload(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Redacts potentially sensitive values from audit event metadata.
 * Explicitly guards against leaking plaintext national IDs, passports,
 * crypto keys, passwords, or tokens into the immutable audit trail.
 */
export function sanitizeAuditPayload(payload?: Record<string, unknown> | null): Prisma.InputJsonValue | undefined {
  if (!payload) return undefined;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    const normalizedKey = lowerKey.replace(/[_-]/g, '');

    // Redact secret keys, passwords, tokens, MFA secrets, auth headers, and sensitive identity keys
    if (
      normalizedKey.includes('secret') ||
      normalizedKey.includes('password') ||
      normalizedKey.includes('token') ||
      normalizedKey.includes('encryptionkey') ||
      normalizedKey.includes('ciphertext') ||
      normalizedKey.includes('authtag') ||
      normalizedKey.includes('backupcode') ||
      normalizedKey.includes('recoverycode') ||
      normalizedKey.includes('totp') ||
      normalizedKey.includes('cookie') ||
      normalizedKey.includes('authorization') ||
      normalizedKey.includes('nationalid') ||
      normalizedKey.includes('passport') ||
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

    if (normalizedKey === 'number' && typeof value === 'string' && value.length > 4) {
      sanitized[key] = `****${value.slice(-4)}`;
      continue;
    }

    sanitized[key] = sanitizeAuditValue(value);
  }

  return sanitized as Prisma.InputJsonValue;
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

