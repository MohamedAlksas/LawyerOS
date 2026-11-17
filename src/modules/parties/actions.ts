'use server';

import { requireActor } from '@/modules/identity/require-actor';
import {
  saveParty,
  searchParties,
  getClientProfile,
  addCommunicationNote,
  savePowerOfAttorney,
  revealPartyIdentity,
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

  const message = error instanceof Error ? error.message : 'حدث خطأ غير متوقع في الخادم.';
  return {
    success: false,
    error: message,
    code: 'INTERNAL_ERROR',
  };
}

export async function savePartyAction(
  input: SavePartyInput
): Promise<ActionResult<SavePartyResult>> {
  try {
    const actor = await requireActor();
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
    const actor = await requireActor();
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
    const actor = await requireActor();
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
    const actor = await requireActor();
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
    const actor = await requireActor();
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
    const actor = await requireActor();
    const result = await revealPartyIdentity(actor, partyId, reason);
    return { success: true, data: result };
  } catch (error) {
    return handleActionError(error);
  }
}

