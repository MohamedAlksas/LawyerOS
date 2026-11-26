import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { IdempotencyPayloadMismatchError, IdempotencyConcurrentConflictError } from '@/lib/idempotency';
import { CalendarValidationError } from '@/lib/cairo-date';
import { CrossMatterLinkForbiddenError } from '@/modules/matters/matter-types';
import {
  DocumentNotFoundError,
  DocumentNotReadyError,
  DocumentValidationError,
} from '@/modules/documents/document-types';
import {
  SchedulingValidationError, ConcurrencyConflictError, NotFoundError, UnsupportedTransitionError,
  MatterArchivedError, ProceedingArchivedError, ActiveObligationError, UnauthorizedError, type ActionResult,
} from './hearing-types';

export function hearingError(error: unknown): ActionResult<never> {
  if (
    error instanceof SchedulingValidationError ||
    error instanceof DocumentValidationError ||
    error instanceof CalendarValidationError
  ) {
    return {
      success: false,
      error: error.message,
      code: 'VALIDATION_ERROR',
      fieldErrors: error.fieldErrors,
    };
  }

  if (error instanceof CrossMatterLinkForbiddenError) {
    return {
      success: false,
      error: error.message,
      code: 'CROSS_MATTER_LINK_FORBIDDEN',
    };
  }

  if (error instanceof DocumentNotReadyError) {
    return {
      success: false,
      error: error.message,
      code: 'DOCUMENT_NOT_READY',
    };
  }

  if (error instanceof ConcurrencyConflictError) {
    return {
      success: false,
      error: error.message,
      code: 'CONCURRENCY_CONFLICT',
    };
  }

  if (error instanceof NotFoundError || error instanceof DocumentNotFoundError) {
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
    error: 'حدث خطأ غير متوقع أثناء معالجة الجلسة. حاول مرة أخرى.',
    code: 'INTERNAL_ERROR',
  };
}
