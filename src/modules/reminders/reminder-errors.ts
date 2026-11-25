import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { IdempotencyConcurrentConflictError, IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import { CalendarValidationError } from '@/lib/cairo-date';
import { SchedulingValidationError } from '@/modules/scheduling/hearing-types';
import {
  ConcurrencyConflictError,
  NotFoundError,
  ReminderValidationError,
  UnauthorizedError,
  UnsupportedTransitionError,
  type ActionResult,
} from './reminder-types';

export function reminderError(error: unknown): ActionResult<never> {
  if (
    error instanceof ReminderValidationError ||
    error instanceof CalendarValidationError ||
    error instanceof SchedulingValidationError
  ) {
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
      code: error instanceof AuthenticationError ? error.code : 'UNAUTHENTICATED',
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      success: false,
      error: 'غير مصرح للقيام بهذه العملية.',
      code: 'FORBIDDEN',
    };
  }

  return {
    success: false,
    error: 'حدث خطأ غير متوقع أثناء معالجة صندوق التنبيهات. يرجى المحاولة مجدداً.',
    code: 'INTERNAL_ERROR',
  };
}