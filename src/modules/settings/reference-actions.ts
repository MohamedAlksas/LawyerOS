'use server';

import { verifyActionSecurity } from '@/modules/identity/action-security';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import {
  getOfficeSettings,
  updateOfficeSettings,
  listReferenceItems,
  createReferenceItem,
  updateReferenceItem,
} from './reference-service';
import {
  OfficeSettingsDTO,
  ReferenceItemDTO,
  UpdateOfficeSettingsInput,
  CreateReferenceItemInput,
  UpdateReferenceItemInput,
  ReferenceItemType,
  ReferenceValidationError,
  ConcurrencyConflictError,
  NotFoundError,
} from './reference-types';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyConcurrentConflictError,
} from '@/lib/idempotency';

export type ActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      code?: string;
      fieldErrors?: Record<string, string>;
    };

function handleActionError(error: unknown): ActionResult<never> {
  if (error instanceof ReferenceValidationError) {
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

  return {
    success: false,
    error: 'حدث خطأ غير متوقع أثناء معالجة الطلب. يرجى المحاولة مرة أخرى.',
    code: 'INTERNAL_ERROR',
  };
}

export async function getOfficeSettingsAction(): Promise<ActionResult<OfficeSettingsDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await getOfficeSettings(actor);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function updateOfficeSettingsAction(
  input: UpdateOfficeSettingsInput
): Promise<ActionResult<OfficeSettingsDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await updateOfficeSettings(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function listReferenceItemsAction(
  type?: ReferenceItemType,
  includeInactive?: boolean
): Promise<ActionResult<ReferenceItemDTO[]>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await listReferenceItems(type, includeInactive, actor);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function createReferenceItemAction(
  input: CreateReferenceItemInput
): Promise<ActionResult<ReferenceItemDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await createReferenceItem(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function updateReferenceItemAction(
  input: UpdateReferenceItemInput
): Promise<ActionResult<ReferenceItemDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await updateReferenceItem(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}