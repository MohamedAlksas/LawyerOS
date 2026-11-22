'use server';

import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import {
  scheduleHearing,
  recordHearingResult,
  rescheduleHearing,
  cancelHearing,
  correctHearingResult,
} from './hearing-service';
import {
  HearingDTO,
  HearingResultDTO,
  RecordHearingResultResult,
  RescheduleHearingResult,
  ScheduleHearingInput,
  RecordHearingResultInput,
  RescheduleHearingInput,
  CancelHearingInput,
  CorrectHearingResultInput,
  SchedulingValidationError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  ActiveObligationError,
  UnauthorizedError,
  ActionResult,
} from './hearing-types';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyConcurrentConflictError,
} from '@/lib/idempotency';

function handleActionError(error: unknown): ActionResult<never> {
  if (error instanceof SchedulingValidationError) {
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

  if (error instanceof UnsupportedTransitionError) {
    return {
      success: false,
      error: error.message,
      code: 'UNSUPPORTED_TRANSITION',
    };
  }

  if (error instanceof MatterArchivedError) {
    return {
      success: false,
      error: error.message,
      code: 'MATTER_ARCHIVED',
    };
  }

  if (error instanceof ProceedingArchivedError) {
    return {
      success: false,
      error: error.message,
      code: 'PROCEEDING_ARCHIVED',
    };
  }

  if (error instanceof ActiveObligationError) {
    return {
      success: false,
      error: error.message,
      code: 'ACTIVE_OBLIGATION',
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

  if (error instanceof AuthenticationError || error instanceof UnauthorizedError) {
    return {
      success: false,
      error: error.message || 'يجب تسجيل الدخول لإتمام هذه العملية.',
      code: 'UNAUTHORIZED',
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      success: false,
      error: 'غير مصرح للقيام بهذه العملية.',
      code: 'FORBIDDEN',
    };
  }

  const errMessage = error instanceof Error ? error.message : 'حدث خطأ غير متوقع أثناء معالجة الجلسة.';
  return {
    success: false,
    error: errMessage,
    code: 'INTERNAL_ERROR',
  };
}

export async function scheduleHearingAction(
  input: ScheduleHearingInput
): Promise<ActionResult<HearingDTO>> {
  try {
    const actor = await requireActor();
    const data = await scheduleHearing(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function recordHearingResultAction(
  input: RecordHearingResultInput
): Promise<ActionResult<RecordHearingResultResult>> {
  try {
    const actor = await requireActor();
    const data = await recordHearingResult(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function rescheduleHearingAction(
  input: RescheduleHearingInput
): Promise<ActionResult<RescheduleHearingResult>> {
  try {
    const actor = await requireActor();
    const data = await rescheduleHearing(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function cancelHearingAction(
  input: CancelHearingInput
): Promise<ActionResult<HearingDTO>> {
  try {
    const actor = await requireActor();
    const data = await cancelHearing(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function correctHearingResultAction(
  input: CorrectHearingResultInput
): Promise<ActionResult<HearingResultDTO>> {
  try {
    const actor = await requireActor();
    const data = await correctHearingResult(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}