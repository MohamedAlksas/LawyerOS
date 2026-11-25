import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from './require-actor';
import { Actor, AuthorizationError, Permission } from './types';

const ALLOWED_ACTION_FETCH_SITES = new Set(['same-origin', 'none']);

export async function verifyActionSecurity(
  options: Permission | { requiredPermission?: Permission } = {}
): Promise<Actor> {
  const requiredPermission =
    typeof options === 'string' ? options : options.requiredPermission;

  let reqHeaders: Headers | null = null;
  try {
    const { headers: nextHeaders } = await import('next/headers');
    reqHeaders = await nextHeaders();
  } catch {
    // Non-request caller (e.g. direct unit/integration invocation without Next request context)
  }

  if (reqHeaders) {
    const trustedOrigins = getTrustedOrigins();
    const origin = reqHeaders.get('origin');
    if (origin && !trustedOrigins.has(origin)) {
      throw new AuthorizationError('غير مصرح بالوصول من هذا المصدر.');
    }

    const secFetchSite = reqHeaders.get('sec-fetch-site');
    if (secFetchSite !== null) {
      const normalized = secFetchSite.trim().toLowerCase();
      if (!ALLOWED_ACTION_FETCH_SITES.has(normalized)) {
        throw new AuthorizationError('غير مصرح بالوصول من مصدر خارجي.');
      }
    }
  }

  return await requireActor(requiredPermission ? { requiredPermission } : {});
}
