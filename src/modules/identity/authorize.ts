import { Actor, Permission, AuthorizationError } from './types';

/**
 * Checks whether the given actor is authorized for the requested permission.
 * Canonical Least-Privilege Policy:
 * - OWNER: Full administrative and operational access to matters, finance, documents, security, and exports.
 * - MAINTAINER: Restricted exclusively to operational health, system maintenance, and diagnostics.
 *   Strictly forbidden from reading or mutating client matters, court proceedings, documents, finance, or exports.
 */
export function authorize(actor: Actor, permission: Permission): boolean {
  if (!actor || !actor.role) {
    return false;
  }

  if (actor.role === 'OWNER') {
    return true;
  }

  if (actor.role === 'MAINTAINER') {
    return permission === 'READ_OPERATIONS' || permission === 'MANAGE_OPERATIONS';
  }

  return false;
}

/**
 * Asserts that the actor possesses the specified permission; throws an AuthorizationError otherwise.
 */
export function assertAuthorized(actor: Actor, permission: Permission): void {
  if (!authorize(actor, permission)) {
    throw new AuthorizationError(
      `غير مصرح لهذا الحساب بالوصول إلى هذه البيانات أو تنفيذ هذه العملية (${permission}).`
    );
  }
}