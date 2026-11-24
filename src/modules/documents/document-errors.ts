import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { IdempotencyConcurrentConflictError, IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import { CalendarValidationError } from '@/lib/cairo-date';
import {
  ConcurrencyConflictError,
  CrossMatterLinkForbiddenError,
  DocumentNotFoundError,
  DocumentNotReadyError,
  DocumentScanPolicyUnavailableError,
  DocumentStoragePathError,
  DocumentValidationError,
  DuplicateChecksumWarningError,
  UnauthorizedError,
  type DocumentActionResult,
  type DocumentErrorCode,
} from './document-types';

export function documentError(error: unknown): DocumentActionResult<never> {
  if (error instanceof DocumentValidationError || error instanceof CalendarValidationError) {
    return {
      success: false,
      error: error.message,
      code: 'VALIDATION_ERROR',
      fieldErrors: error.fieldErrors,
    };
  }

  if (error instanceof DocumentStoragePathError) {
    return {
      success: false,
      error: error.message,
      code: 'VALIDATION_ERROR',
    };
  }

  if (error instanceof CrossMatterLinkForbiddenError) {
    return {
      success: false,
      error: error.message,
      code: 'CROSS_MATTER_LINK_FORBIDDEN',
    };
  }

  if (error instanceof DocumentNotFoundError) {
    return {
      success: false,
      error: error.message,
      code: 'NOT_FOUND',
    };
  }

  if (error instanceof DocumentNotReadyError) {
    return {
      success: false,
      error: error.message,
      code: 'DOCUMENT_NOT_READY',
    };
  }

  if (error instanceof DuplicateChecksumWarningError) {
    return {
      success: false,
      error: error.message,
      code: 'DUPLICATE_CHECKSUM_WARNING',
      existingDocuments: error.existingDocuments,
    };
  }

  if (error instanceof ConcurrencyConflictError) {
    return {
      success: false,
      error: error.message,
      code: 'CONCURRENCY_CONFLICT',
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

  if (error instanceof DocumentScanPolicyUnavailableError) {
    return {
      success: false,
      error: error.message,
      code: 'SCAN_POLICY_UNAVAILABLE',
    };
  }

  if (error instanceof AuthenticationError || error instanceof UnauthorizedError) {
    let code: DocumentErrorCode = 'UNAUTHENTICATED';
    if (error instanceof AuthenticationError) {
      if (
        error.code === 'UNAUTHENTICATED' ||
        error.code === 'MFA_REQUIRED' ||
        error.code === 'SESSION_EXPIRED' ||
        error.code === 'SESSION_INACTIVE'
      ) {
        code = error.code;
      }
    }
    return {
      success: false,
      error: error.message || 'يجب تسجيل الدخول للوصول إلى المستندات.',
      code,
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      success: false,
      error: 'غير مصرح للقيام بهذه العملية على المستندات.',
      code: 'FORBIDDEN',
    };
  }

  return {
    success: false,
    error: 'حدث خطأ غير متوقع أثناء معالجة المستند. حاول مرة أخرى.',
    code: 'INTERNAL_ERROR',
  };
}

export function documentStatusFromErrorCode(code: DocumentErrorCode | string | undefined): number {
  if (code === 'FORBIDDEN') return 403;
  if (['UNAUTHENTICATED', 'MFA_REQUIRED', 'SESSION_EXPIRED', 'SESSION_INACTIVE'].includes(code ?? '')) {
    return 401;
  }
  if (code === 'NOT_FOUND') return 404;
  if (
    [
      'CONCURRENCY_CONFLICT',
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      'IDEMPOTENCY_CONCURRENT_CONFLICT',
      'DUPLICATE_CHECKSUM_WARNING',
      'DOCUMENT_NOT_READY',
    ].includes(code ?? '')
  ) {
    return 409;
  }
  if (code === 'SCAN_POLICY_UNAVAILABLE') return 503;
  if (code === 'INTERNAL_ERROR') return 500;
  return 400;
}
