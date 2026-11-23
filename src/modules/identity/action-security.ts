import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from './require-actor';
import { Actor, AuthorizationError, Permission } from './types';

export async function verifyActionSecurity(
  options: Permission | { requiredPermission?: Permission } = {}
): Promise<Actor> {
  const requiredPermission =
    typeof options === 'string' ? options : options.requiredPermission;
  try {
    const { headers: nextHeaders } = await import('next/headers');
    const reqHeaders = await nextHeaders();
    const origin = reqHeaders?.get('origin');
    if (origin && !getTrustedOrigins().has(origin)) {
      throw new AuthorizationError('غير مصرح بالوصول من هذا المصدر.');
    }
    if (reqHeaders?.get('sec-fetch-site') === 'cross-site') {
      throw new AuthorizationError('غير مصرح بالوصول من مصدر خارجي.');
    }
  } catch (err) {
    if (err instanceof AuthorizationError) {
      throw err;
    }
  }

  return await requireActor(requiredPermission ? { requiredPermission } : {});
}
