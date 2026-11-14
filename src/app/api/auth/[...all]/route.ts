import { auth, getPrismaClient } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/modules/identity/require-actor';
import { regenerateRecoveryCodes } from '@/modules/identity/recovery-codes';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';

const MAX_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;        // 30 minutes

async function handleAuthSecurityGuards(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;

  // R02: Block public sign-up unconditionally
  if (pathname.includes('/sign-up')) {
    return NextResponse.json(
      { error: 'التسجيل العام محظور في نظام LawOffice OS.' },
      { status: 403 }
    );
  }

  // R02: Block two-factor disable unconditionally for all clients
  if (pathname.includes('/two-factor/disable')) {
    return NextResponse.json(
      { error: 'تعطيل المصادقة الثنائية محظور في نظام LawOffice OS لحماية حساب المالك.' },
      { status: 403 }
    );
  }

  // R02: Strip trusted device cookies on sign-in
  if (pathname.includes('/sign-in')) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const cleaned = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .filter(
          (c) =>
            !c.startsWith('better-auth.trust_device=') &&
            !c.startsWith('__Secure-better-auth.trust_device=') &&
            !c.startsWith('better-auth.dont_remember_device=') &&
            !c.startsWith('__Secure-better-auth.dont_remember_device=')
        )
        .join('; ');
      request.headers.set('cookie', cleaned);
    }
  }

  // F10: Invalidate prior-password unfinished MFA challenges before provider processing
  if (
    pathname.includes('/two-factor/verify-totp') ||
    pathname.includes('/two-factor/verify-backup-code')
  ) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').map((c) => c.trim());
      const tfCookie = cookies.find(
        (c) =>
          c.startsWith('better-auth.two_factor=') ||
          c.startsWith('__Secure-better-auth.two_factor=')
      );
      if (tfCookie) {
        const cookieVal = tfCookie.split('=')[1] || '';
        const rawToken = cookieVal.split('.')[0];
        if (rawToken) {
          const prisma = getPrismaClient();
          const verifRecord = await prisma.verification.findFirst({
            where: {
              OR: [
                { identifier: rawToken },
                { identifier: decodeURIComponent(rawToken) },
                { identifier: cookieVal },
                { identifier: `two-factor-${rawToken}` },
              ],
            },
          });
          if (verifRecord) {
            const account = await prisma.account.findFirst({
              where: { userId: verifRecord.value, providerId: 'credential' },
            });
            if (account && new Date(verifRecord.createdAt) < new Date(account.updatedAt)) {
              // Stale challenge created under prior password! Delete and reject!
              await prisma.verification.delete({ where: { id: verifRecord.id } }).catch(() => {});
              return NextResponse.json(
                { error: 'تم تغيير كلمة المرور. تم إلغاء جلسة التحقق السابقة، يرجى تسجيل الدخول مجدداً بكلمة المرور الجديدة.' },
                { status: 401 }
              );
            }
          }
        }
      }
    }
  }

  // B1 / B2: Resolve verified session authoritatively through provider without refresh/cache
  const cookieHeader = request.headers.get('cookie');
  if (
    cookieHeader &&
    (cookieHeader.includes('better-auth.session_token') ||
      cookieHeader.includes('__Secure-better-auth.session_token'))
  ) {
    try {
      // Evaluate session using original request headers without synthetic cookie rewriting (R02, R03)
      // The guard and downstream provider handler must evaluate the exact same provider-configured session.
      const sessionData = await auth.api.getSession({
        headers: request.headers,
        query: {
          disableRefresh: true,
          disableCookieCache: true,
        },
      });

      if (sessionData && sessionData.session) {
        const { session } = sessionData;
        const now = Date.now();
        const sessionCreatedAt = new Date(session.createdAt).getTime();
        const sessionUpdatedAt = new Date(session.updatedAt).getTime();
        const sessionExpiresAt = new Date(session.expiresAt).getTime();

        const isExpired =
          sessionExpiresAt <= now ||
          now - sessionCreatedAt > MAX_SESSION_LIFETIME_MS;
        const isInactive = now - sessionUpdatedAt > INACTIVITY_TIMEOUT_MS;

        // Check if credential was changed after session creation (B3)
        let isCredentialInvalidated = false;
        const prisma = getPrismaClient();
        const account = await prisma.account.findFirst({
          where: { userId: session.userId, providerId: 'credential' },
        });
        if (account && sessionCreatedAt < new Date(account.updatedAt).getTime()) {
          isCredentialInvalidated = true;
        }

        if (isExpired || isInactive || isCredentialInvalidated) {
          // Immediately evict session from database so library handlers cannot revive it
          await prisma.session.delete({ where: { id: session.id } }).catch(() => {});

          const response = NextResponse.json(
            {
              error: isInactive
                ? 'تم قفل الجلسة لعدم النشاط لمدة تتجاوز 30 دقيقة.'
                : isCredentialInvalidated
                  ? 'تم تغيير كلمة المرور الخاصة بالحساب. يلزم إعادة تسجيل الدخول.'
                  : 'انتهت مدة صلاحية الجلسة (الحد الأقصى 12 ساعة).',
            },
            { status: 401 }
          );
          response.cookies.delete('better-auth.session_token');
          response.cookies.delete('__Secure-better-auth.session_token');
          return response;
        }
      }
    } catch {
      // Database not reachable or transient error: fail closed!
      return NextResponse.json(
        { error: 'حدث خطأ غير متوقع أثناء التحقق من أمان الجلسة.' },
        { status: 500 }
      );
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const blocked = await handleAuthSecurityGuards(request);
  if (blocked) return blocked;
  return auth.handler(request);
}

export async function POST(request: NextRequest) {
  const blocked = await handleAuthSecurityGuards(request);
  if (blocked) return blocked;

  const pathname = request.nextUrl.pathname;

  // F06: Intercept raw POST /api/auth/two-factor/generate-backup-codes to enforce
  // identical Identity authorization, password reauthentication, and atomic lockout budget
  if (pathname.includes('/two-factor/generate-backup-codes')) {
    try {
      const actor = await requireActor({ headers: request.headers });
      const body = await request.clone().json().catch(() => ({}));
      const password = body.currentPassword || body.password;
      if (!password || typeof password !== 'string' || password.trim().length === 0) {
        return NextResponse.json(
          { error: 'كلمة المرور الحالية مطلوبة لتأكيد الهوية.' },
          { status: 400 }
        );
      }

      const backupCodes = await regenerateRecoveryCodes(actor, password);
      return NextResponse.json({ backupCodes, status: true }, { status: 200 });
    } catch (err) {
      if (err instanceof AuthenticationError) {
        if (err.code === 'RATE_LIMITED') {
          return NextResponse.json({ error: err.message }, { status: 429 });
        }
        if (
          err.code === 'UNAUTHENTICATED' ||
          err.code === 'SESSION_EXPIRED' ||
          err.code === 'SESSION_INACTIVE'
        ) {
          return NextResponse.json({ error: err.message }, { status: 401 });
        }
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof AuthorizationError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      return NextResponse.json({ error: 'حدث خطأ غير متوقع أثناء معالجة رموز الاسترداد.' }, { status: 500 });
    }
  }

  let reqToExecute = request;
  if (pathname.includes('/change-password')) {
    try {
      const body = await request.clone().json();
      body.revokeOtherSessions = true;
      reqToExecute = new NextRequest(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
      });
    } catch {
      // Pass original request if not JSON
    }
  }

  const response = await auth.handler(reqToExecute);

  // R04 & F10: When password change succeeds, verify other sessions are evicted
  // and all unfinished prior-password MFA challenges are invalidated
  if (pathname.includes('/change-password') && response.status === 200) {
    try {
      const sessionData = await auth.api.getSession({
        headers: request.headers,
        query: {
          disableRefresh: true,
          disableCookieCache: true,
        },
      });
      if (sessionData && sessionData.session) {
        const prisma = getPrismaClient();
        const userId = sessionData.session.userId;
        const currentSessionId = sessionData.session.id;

        // Revoke all other sessions for this user (R04)
        await prisma.session.deleteMany({
          where: {
            userId,
            id: { not: currentSessionId },
          },
        });

        // Invalidate any unfinished MFA challenges created under the prior password (F10)
        await prisma.verification.deleteMany({
          where: {
            value: userId,
          },
        });
      }
    } catch {
      return NextResponse.json(
        { error: 'فشل في إنهاء الجلسات الأخرى للمستخدم بعد تغيير كلمة المرور.' },
        { status: 500 }
      );
    }
  }

  // F10: If two-factor verification endpoint succeeded, ensure newly created session
  // was not issued against a rotated credential
  if (
    (pathname.includes('/two-factor/verify-totp') ||
      pathname.includes('/two-factor/verify-backup-code')) &&
    response.status === 200
  ) {
    try {
      const setCookies = response.headers.getSetCookie?.() || [
        response.headers.get('set-cookie') || '',
      ];
      const sessionCookie = setCookies.find(
        (c) =>
          c.startsWith('better-auth.session_token=') ||
          c.startsWith('__Secure-better-auth.session_token=')
      );
      if (sessionCookie) {
        const rawCookiePart = sessionCookie.split(';')[0];
        const eqIdx = rawCookiePart.indexOf('=');
        const cookieVal = eqIdx !== -1 ? rawCookiePart.slice(eqIdx + 1) : '';
        const decodedVal = decodeURIComponent(cookieVal);
        const rawToken = decodedVal.split('.')[0];
        if (rawToken) {
          const prisma = getPrismaClient();
          const newSession = await prisma.session.findFirst({
            where: {
              OR: [
                { token: rawToken },
                { token: decodedVal },
                { token: cookieVal },
              ],
            },
          });
          if (newSession) {
            const account = await prisma.account.findFirst({
              where: { userId: newSession.userId, providerId: 'credential' },
            });
            if (account && new Date(newSession.createdAt) <= new Date(account.updatedAt)) {
              await prisma.session.delete({ where: { id: newSession.id } }).catch(() => {});
              const errRes = NextResponse.json(
                { error: 'تم تغيير كلمة المرور الخاصة بالحساب. يلزم إعادة تسجيل الدخول بكلمة المرور الجديدة.' },
                { status: 401 }
              );
              errRes.cookies.delete('better-auth.session_token');
              errRes.cookies.delete('__Secure-better-auth.session_token');
              return errRes;
            }
          }
        }
      }
    } catch {
      // Best-effort post-verification check
    }
  }

  return response;
}
