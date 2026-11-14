import { auth, getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
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

  // F06 & R10-03: Intercept raw POST /api/auth/two-factor/generate-backup-codes to enforce
  // Origin/CSRF validation, identical Identity authorization, password reauthentication, and atomic lockout budget
  if (pathname.includes('/two-factor/generate-backup-codes')) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      if (request.headers.get('sec-fetch-site') === 'cross-site') {
        return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
      }

      const origin = request.headers.get('origin');
      const referer = request.headers.get('referer');
      let originToValidate: string | null = origin;
      if (!originToValidate && referer) {
        try {
          originToValidate = new URL(referer).origin;
        } catch {
          originToValidate = null;
        }
      }
      if (!originToValidate && !referer && !request.headers.get('sec-fetch-site')) {
        originToValidate = request.nextUrl.origin;
      }

      if (origin === 'null' && request.headers.get('sec-fetch-site') === 'same-origin') {
        // Allowed (e.g. privacy mode / sandbox with verified same-origin fetch)
      } else if (!originToValidate || originToValidate === 'null') {
        return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
      } else {
        const env = getEnv();
        const baseOrigin = new URL(env.BETTER_AUTH_URL).origin;
        const allowedOrigins = new Set<string>([baseOrigin]);
        try {
          const parsedBase = new URL(env.BETTER_AUTH_URL);
          const portStr = parsedBase.port ? `:${parsedBase.port}` : '';
          if (parsedBase.hostname === '127.0.0.1') {
            allowedOrigins.add(`${parsedBase.protocol}//localhost${portStr}`);
          } else if (parsedBase.hostname === 'localhost') {
            allowedOrigins.add(`${parsedBase.protocol}//127.0.0.1${portStr}`);
          }
        } catch {
          // Ignore URL parsing errors
        }

        const hostHeader = request.headers.get('host');
        if (hostHeader) {
          const proto =
            request.headers.get('x-forwarded-proto') ||
            (request.url.startsWith('https:') ? 'https' : 'http');
          allowedOrigins.add(`${proto}://${hostHeader}`);
        }

        if (!allowedOrigins.has(originToValidate)) {
          return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
        }
      }
    }

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

  // F10 & R10-01: Two-factor challenge pre-handler: capture challenge metadata and reject stale challenges
  let challengeCreatedAt: Date | null = null;
  let targetUserId: string | null = null;

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
        const rawCookiePart = tfCookie.split(';')[0];
        const eqIdx = rawCookiePart.indexOf('=');
        const cookieVal = eqIdx !== -1 ? rawCookiePart.slice(eqIdx + 1) : '';
        const decodedVal = decodeURIComponent(cookieVal);
        const rawToken = decodedVal.split('.')[0];
        if (rawToken) {
          const prisma = getPrismaClient();
          const verifRecord = await prisma.verification.findFirst({
            where: {
              OR: [
                { identifier: rawToken },
                { identifier: decodedVal },
                { identifier: cookieVal },
                { identifier: `two-factor-${rawToken}` },
              ],
            },
          });
          if (verifRecord) {
            challengeCreatedAt = new Date(verifRecord.createdAt);
            targetUserId = verifRecord.value;

            const account = await prisma.account.findFirst({
              where: { userId: targetUserId, providerId: 'credential' },
            });
            if (account && challengeCreatedAt < new Date(account.updatedAt)) {
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

  // F10 & R10-01: Change password pre-handler: resolve current session before auth.handler modifies it
  let changePasswordUserId: string | null = null;
  let originalSessionId: string | null = null;
  let reqToExecute = request;

  if (pathname.includes('/change-password')) {
    try {
      const sessionData = await auth.api.getSession({
        headers: request.headers,
        query: {
          disableRefresh: true,
          disableCookieCache: true,
        },
      });
      if (sessionData && sessionData.session) {
        changePasswordUserId = sessionData.session.userId;
        originalSessionId = sessionData.session.id;
      }

      const body = await request.clone().json();
      body.revokeOtherSessions = true;
      reqToExecute = new NextRequest(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
      });
    } catch {
      // Pass original request if not JSON or session resolution fails
    }
  }

  const response = await auth.handler(reqToExecute);

  // R04, F10 & R10-01: When password change succeeds, delete all sessions for user except replacement session,
  // and delete all pending verification challenges for that user.
  if (pathname.includes('/change-password') && response.status === 200) {
    try {
      const prisma = getPrismaClient();
      const setCookies = response.headers.getSetCookie?.() || [
        response.headers.get('set-cookie') || '',
      ];
      const sessionCookie = setCookies.find(
        (c) =>
          c.startsWith('better-auth.session_token=') ||
          c.startsWith('__Secure-better-auth.session_token=')
      );
      let replacementSessionId: string | null = null;
      if (sessionCookie) {
        const rawCookiePart = sessionCookie.split(';')[0];
        const eqIdx = rawCookiePart.indexOf('=');
        const cookieVal = eqIdx !== -1 ? rawCookiePart.slice(eqIdx + 1) : '';
        const decodedVal = decodeURIComponent(cookieVal);
        const rawToken = decodedVal.split('.')[0];
        if (rawToken) {
          const replacementSession = await prisma.session.findFirst({
            where: {
              OR: [
                { token: rawToken },
                { token: decodedVal },
                { token: cookieVal },
              ],
            },
          });
          if (replacementSession) {
            replacementSessionId = replacementSession.id;
          }
        }
      }

      const keepSessionId = replacementSessionId || originalSessionId;
      const targetUid = changePasswordUserId;
      if (targetUid) {
        await prisma.session.deleteMany({
          where: {
            userId: targetUid,
            ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
          },
        });

        // Invalidate any unfinished MFA challenges created under the prior password (F10)
        await prisma.verification.deleteMany({
          where: {
            value: targetUid,
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

  // F10 & R10-01: Two-factor verification post-handler:
  // Ensure newly created session was not issued against a rotated credential
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
            const uid = targetUserId || newSession.userId;
            const account = await prisma.account.findFirst({
              where: { userId: uid, providerId: 'credential' },
            });
            const accountUpdatedAt = account ? new Date(account.updatedAt).getTime() : 0;
            const challengeTime = challengeCreatedAt ? challengeCreatedAt.getTime() : new Date(newSession.createdAt).getTime();

            if (account && challengeTime <= accountUpdatedAt) {
              await prisma.session.delete({ where: { id: newSession.id } }).catch(() => {});
              const errRes = NextResponse.json(
                { error: 'تم تغيير كلمة المرور. تم إلغاء جلسة التحقق السابقة، يرجى تسجيل الدخول مجدداً بكلمة المرور الجديدة.' },
                { status: 401 }
              );
              errRes.cookies.delete('better-auth.session_token');
              errRes.cookies.delete('__Secure-better-auth.session_token');
              return errRes;
            } else if (challengeCreatedAt) {
              // Valid: update newSession.createdAt = challengeCreatedAt so the session's recorded authentication age matches the proof age
              await prisma.session.update({
                where: { id: newSession.id },
                data: { createdAt: challengeCreatedAt },
              }).catch(() => {});
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
