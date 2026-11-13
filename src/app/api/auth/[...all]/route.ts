import { auth, getPrismaClient } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

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
    const isHttps =
      request.url.startsWith('https://') ||
      request.headers.get('x-forwarded-proto') === 'https';

    let guardHeaders = request.headers;
    const secureCookie = request.cookies.get('__Secure-better-auth.session_token')?.value;
    if ((isHttps || secureCookie) && secureCookie) {
      const otherCookies = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .filter(
          (c) =>
            !c.startsWith('better-auth.session_token=') &&
            !c.startsWith('__Secure-better-auth.session_token=')
        );
      otherCookies.unshift(`better-auth.session_token=${secureCookie}`);
      otherCookies.unshift(`__Secure-better-auth.session_token=${secureCookie}`);
      guardHeaders = new Headers(request.headers);
      guardHeaders.set('cookie', otherCookies.join('; '));
    }

    try {
      const sessionData = await auth.api.getSession({
        headers: guardHeaders,
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

  // R04: When password change succeeds, verify other sessions are evicted
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
        await prisma.session.deleteMany({
          where: {
            userId: sessionData.session.userId,
            id: { not: sessionData.session.id },
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

  return response;
}