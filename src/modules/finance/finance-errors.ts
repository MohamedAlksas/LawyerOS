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
  AlreadyPostedError,
  ConcurrencyConflictError,
  ExcessAllocationError,
  FinanceValidationError,
  ImmutablePostedRecordError,
  MatterArchivedError,
  NotFoundError,
  ScopeMismatchError,
  UnauthorizedError,
  UnsupportedTransactionKindError,
  UnsupportedTransitionError,
  type FinanceActionResult,
} from './finance-types';

export function financeError(error: unknown): FinanceActionResult<never> {
  if (error instanceof UnsupportedTransactionKindError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  if (
    error instanceof FinanceValidationError ||
    error instanceof DocumentValidationError ||
    error instanceof CalendarValidationError
  ) {
    return {
      success: false,
      error: error.message,
      code: (error instanceof FinanceValidationError && error.code) || 'VALIDATION_ERROR',
      fieldErrors: error.fieldErrors,
    };
  }

  if (error instanceof ScopeMismatchError || error instanceof CrossMatterLinkForbiddenError) {
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

  if (error instanceof ExcessAllocationError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  if (error instanceof ImmutablePostedRecordError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  if (error instanceof AlreadyPostedError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  if (error instanceof ConcurrencyConflictError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
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
      code: error.code,
    };
  }

  if (error instanceof MatterArchivedError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
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
      error: 'غير مصرح للقيام بهذه العملية المالية.',
      code: 'FORBIDDEN',
    };
  }

  return {
    success: false,
    error: 'حدث خطأ غير متوقع أثناء معالجة العملية المالية. حاول مرة أخرى.',
    code: 'INTERNAL_ERROR',
  };
}