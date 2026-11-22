import { getAuth, getPrismaClient } from '@/lib/auth';
import { Actor, AuthenticationError, Permission, UserRole } from './types';
import { assertAuthorized } from './authorize';

export interface RequireActorOptions {
  headers?: Headers | null;
  allowIncompleteMfa?: boolean;
  requiredPermission?: Permission;
  touchSession?: boolean;
}

import { MAX_SESSION_LIFETIME_MS, INACTIVITY_TIMEOUT_MS } from './session-limits';

/**
 * Server-side extraction and authoritative validation of current verified session and actor.
 * Uses Better Auth's supported verification facility (auth.api.getSession) with:
 * - disableRefresh: true
 * - disableCookieCache: true
 *
 * Then applies application-level policy checks:
 * 1. 12-hour maximum lifetime bound (from creation time).
 * 2. 30-minute inactivity timeout (from last activity update).
 * 3. Mandatory MFA for OWNER role.
 * 4. Completed Two-Factor Authentication (incomplete MFA rejected with MFA_REQUIRED).
 * 5. Credential invalidation (session.createdAt < account.updatedAt).
 * 6. Slide inactivity window ONLY after all checks pass.
 * 7. Optional granular permission authorization.
 */
export async function requireActor(options: RequireActorOptions = {}): Promise<Actor> {
  let headers = options.headers;

  if (!headers) {
    try {
      const { headers: nextHeaders } = await import('next/headers');
      headers = await nextHeaders();
    } catch {
      // Not in Next.js request context (e.g. testing)
    }
  }

  if (!headers) {
    throw new AuthenticationError('UNAUTHENTICATED', 'يجب تسجيل الدخول للوصول إلى هذه الشاشة.');
  }

  const auth = getAuth();
  let sessionData;
  try {
    sessionData = await auth.api.getSession({
      headers,
      query: {
        disableRefresh: true,
        disableCookieCache: true,
      },
    });
  } catch {
    throw new AuthenticationError('UNAUTHENTICATED', 'جلسة غير صالحة أو تم إنهاؤها.');
  }

  if (!sessionData || !sessionData.session || !sessionData.user) {
    throw new AuthenticationError('UNAUTHENTICATED', 'جلسة غير صالحة أو تم إنهاؤها.');
  }

  const { session } = sessionData;
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id: sessionData.user.id },
    include: {
      twoFactors: true,
    },
  });

  if (!user) {
    throw new AuthenticationError('UNAUTHENTICATED', 'المستخدم المرتبط بهذه الجلسة غير موجود.');
  }

  const now = Date.now();
  const sessionCreatedAt = new Date(session.createdAt).getTime();
  const sessionUpdatedAt = new Date(session.updatedAt).getTime();
  const sessionExpiresAt = new Date(session.expiresAt).getTime();

  // Expiration check
  if (sessionExpiresAt <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError('SESSION_EXPIRED', 'انتهت صلاحية الجلسة. برجاء تسجيل الدخول مجدداً.');
  }

  // Maximum lifetime check (12 hours)
  if (now - sessionCreatedAt > MAX_SESSION_LIFETIME_MS) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError(
      'SESSION_EXPIRED',
      'انتهت مدة الجلسة القصوى (12 ساعة). برجاء تسجيل الدخول مجدداً.'
    );
  }

  // Inactivity timeout check (30 minutes)
  if (now - sessionUpdatedAt > INACTIVITY_TIMEOUT_MS) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError(
      'SESSION_INACTIVE',
      'تم قفل الجلسة لعدم النشاط لمدة تتجاوز 30 دقيقة.'
    );
  }

  // Mandatory MFA enforcement check:
  // For OWNER role, Two-Factor Authentication is non-negotiable and strictly mandatory.
  if (user.role === 'OWNER' && user.twoFactorEnabled !== true) {
    throw new AuthenticationError(
      'MFA_REQUIRED',
      'المصادقة الثنائية إلزامية لحساب المالك ولا يمكن تعطيلها أو تجاوزها.'
    );
  }

  const is2faEnabled = Boolean(user.twoFactorEnabled);
  const twoFactorRecord = user.twoFactors?.[0];

  if (is2faEnabled && !options.allowIncompleteMfa) {
    if (!twoFactorRecord || twoFactorRecord.verified === false) {
      throw new AuthenticationError('MFA_REQUIRED', 'يلزم استكمال التحقق الثنائي (TOTP) للوصول.');
    }
  }

  // Enforce session.credentialVersion === user.credentialVersion fail-closed (R12-01)
  const dbSession = await prisma.session.findUnique({
    where: { id: session.id },
    select: { credentialVersion: true },
  });

  if (
    !dbSession ||
    dbSession.credentialVersion === null ||
    dbSession.credentialVersion === undefined ||
    user.credentialVersion === null ||
    user.credentialVersion === undefined ||
    dbSession.credentialVersion !== user.credentialVersion
  ) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError(
      'SESSION_EXPIRED',
      'تم تغيير كلمة المرور أو إثبات الهوية. يلزم إعادة تسجيل الدخول.'
    );
  }

  // Check if credentials were changed after session creation (B3 defense-in-depth)
  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  });

  if (account && sessionCreatedAt < new Date(account.updatedAt).getTime()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError(
      'SESSION_EXPIRED',
      'تم تغيير كلمة المرور الخاصة بالحساب. يلزم إعادة تسجيل الدخول.'
    );
  }

  // Update session updatedAt to slide the inactivity window ONLY after all checks pass
  if (options.touchSession !== false) {
    await prisma.session.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    }).catch(() => {});
  }

  const actor: Actor = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    sessionId: session.id,
    twoFactorVerified: is2faEnabled ? Boolean(twoFactorRecord?.verified) : true,
  };

  if (options.requiredPermission) {
    assertAuthorized(actor, options.requiredPermission);
  }

  return actor;
}
