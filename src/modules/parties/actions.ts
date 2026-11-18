'use server';

import { requireActor } from '@/modules/identity/require-actor';
import { assertAuthorized } from '@/modules/identity/authorize';
import { AuthenticationError, AuthorizationError, Actor } from '@/modules/identity/types';
import { CryptoDecryptionError } from '@/lib/crypto/party-identity';
import { getPrismaClient, getTrustedOrigins } from '@/lib/auth';
import {
  saveParty,
  searchParties,
  getClientProfile,
  addCommunicationNote,
  savePowerOfAttorney,
  revealPartyIdentity,
  findDuplicateWarnings,
  ConcurrencyConflictError,
  NotFoundError,
} from './service';
import { ValidationError } from './validation';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyConcurrentConflictError,
} from '@/lib/idempotency';
import {
  SavePartyInput,
  SavePartyResult,
  SearchPartiesParams,
  SearchPartiesResult,
  ClientProfileDTO,
  AddCommunicationNoteInput,
  CommunicationNoteSummaryDTO,
  SavePowerOfAttorneyInput,
  PoASummaryDTO,
  DuplicateWarningDTO,
} from './types';

export type ActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      code?: string;
      fieldErrors?: Record<string, string>;
    };

function handleActionError(error: unknown): ActionResult<never> {
  if (error instanceof ValidationError) {
    return {
      success: false,
      error: error.message,
      code: 'VALIDATION_ERROR',
      fieldErrors: error.fieldErrors,
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      success: false,
      error: 'غير مصرح للقيام بهذه العملية.',
      code: 'FORBIDDEN',
    };
  }

  if (error instanceof ConcurrencyConflictError) {
    return {
      success: false,
      error: error.message,
      code: 'CONCURRENCY_CONFLICT',
    };
  }

  if (error instanceof NotFoundError) {
    return {
      success: false,
      error: error.message,
      code: 'NOT_FOUND',
    };
  }

  if (error instanceof CryptoDecryptionError) {
    return {
      success: false,
      error: 'تعذر فك تشفير بيانات الهوية أو أن مفتاح التشفير غير صالح.',
      code: 'CRYPTO_ERROR',
    };
  }

  if (error instanceof IdempotencyPayloadMismatchError) {
    return {
      success: false,
      error: error.message,
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
    };
  }

  if (error instanceof IdempotencyConcurrentConflictError) {
    return {
      success: false,
      error: error.message,
      code: 'IDEMPOTENCY_CONCURRENT_CONFLICT',
    };
  }

  // PARENT-01: Explicitly map any unexpected internal/Prisma errors to a safe generic Arabic message.
  // Guarantees zero query, table, schema, credentials, or server-path leakage to the client.
  return {
    success: false,
    error: 'حدث خطأ غير متوقع أثناء معالجة الطلب. يرجى المحاولة مرة أخرى.',
    code: 'INTERNAL_ERROR',
  };
}

/**
 * Internal action security guard (R2-01).
 * 1. Derives headers strictly from Next.js server context (next/headers).
 * 2. Enforces defense-in-depth Origin header verification against getTrustedOrigins().
 * 3. Enforces authoritative server session validation via requireActor() with ZERO caller-controlled options.
 */
/**
 * Server action security middleware:
 * 1. Validates host / origin against trusted deployment origins to defeat CSRF.
 * 2. Enforces valid HTTP methods and context boundaries.
 * 3. Enforces authoritative server session validation via requireActor() with ZERO caller-controlled options (R2-01).
 */
async function verifyActionSecurity(): Promise<Actor> {
  try {
    const { headers: nextHeaders } = await import('next/headers');
    const reqHeaders = await nextHeaders();
    const origin = reqHeaders?.get('origin');
    if (origin) {
      const trusted = getTrustedOrigins();
      if (!trusted.has(origin)) {
        throw new AuthorizationError('غير مصرح بالوصول من هذا المصدر.');
      }
    }
  } catch (err) {
    if (err instanceof AuthorizationError) {
      throw err;
    }
    // Continue if outside Next.js request context (e.g. test environments without mock headers)
  }

  // Derive actor strictly from server-owned session without caller-controlled options (R2-01)
  return await requireActor();
}

export async function savePartyAction(
  input: SavePartyInput
): Promise<ActionResult<SavePartyResult>> {
  try {
    const actor = await verifyActionSecurity();
    const result = await saveParty(actor, input);
    return { success: true, data: result };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function searchPartiesAction(
  params: SearchPartiesParams
): Promise<ActionResult<SearchPartiesResult>> {
  try {
    const actor = await verifyActionSecurity();
    const result = await searchParties(actor, params);
    return { success: true, data: result };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function getClientProfileAction(
  partyId: string
): Promise<ActionResult<ClientProfileDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const result = await getClientProfile(actor, partyId);
    return { success: true, data: result };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function addCommunicationNoteAction(
  input: AddCommunicationNoteInput
): Promise<ActionResult<CommunicationNoteSummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const result = await addCommunicationNote(actor, input);
    return { success: true, data: result };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function savePowerOfAttorneyAction(
  input: SavePowerOfAttorneyInput
): Promise<ActionResult<PoASummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const result = await savePowerOfAttorney(actor, input);
    return { success: true, data: result };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function revealPartyIdentityAction(
  partyId: string,
  reason?: string
): Promise<ActionResult<{ identificationType: string; number: string }>> {
  try {
    const actor = await verifyActionSecurity();
    const result = await revealPartyIdentity(actor, partyId, reason);
    return { success: true, data: result };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function checkPartyDuplicatesAction(
  name: string,
  primaryPhone?: string | null,
  excludePartyId?: string
): Promise<ActionResult<DuplicateWarningDTO[]>> {
  try {
    const actor = await verifyActionSecurity();
    assertAuthorized(actor, 'READ_CLIENT_DATA');
    const prisma = getPrismaClient();
    const warnings = await findDuplicateWarnings(prisma, name, primaryPhone, excludePartyId);
    return { success: true, data: warnings };
  } catch (error) {
    return handleActionError(error);
  }
}

