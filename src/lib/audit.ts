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

    // Redact secret keys, passwords, tokens
    if (
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('encryptionkey') ||
      lowerKey.includes('ciphertext') ||
      lowerKey.includes('authtag') ||
      lowerKey.includes('iv')
    ) {
      sanitized[key] = '[REDACTED_SECRET]';
      continue;
    }

    // Redact raw identity numbers (preserve only type and masked lastFour)
    if (lowerKey === 'identity' && typeof value === 'object' && value !== null) {
      const idObj = value as Record<string, unknown>;
      sanitized[key] = {
        identificationType: idObj.identificationType,
        lastFour: idObj.lastFour ?? (typeof idObj.number === 'string' ? idObj.number.slice(-4) : '****'),
      };
      continue;
    }

    if (lowerKey === 'number' && typeof value === 'string' && value.length > 4) {
      sanitized[key] = `****${value.slice(-4)}`;
      continue;
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditPayload(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
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

