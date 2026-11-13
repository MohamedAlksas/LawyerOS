import { auth, getPrismaClient } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const MAX_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;        // 30 minutes

function extractSessionTokens(request: NextRequest): string[] {
  const tokens: string[] = [];
  const secureCookie = request.cookies.get('__Secure-better-auth.session_token')?.value;
  const plainCookie = request.cookies.get('better-auth.session_token')?.value;

  const isHttps =
    request.url.startsWith('https://') ||
    request.headers.get('x-forwarded-proto') === 'https';

  const orderedValues = isHttps
    ? [secureCookie, plainCookie]
    : [plainCookie, secureCookie];

  for (const raw of orderedValues) {
    if (raw) {
      const decoded = decodeURIComponent(raw.split('.')[0]);
      if (decoded && !tokens.includes(decoded)) {
        tokens.push(decoded);
      }
    }
  }

  return tokens;
}

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

  // R03: Intercept session cookies before library handlers touch them
  const tokens = extractSessionTokens(request);
  if (tokens.length > 0) {
    try {
      const prisma = getPrismaClient();
      for (const token of tokens) {
        const session = await prisma.session.findUnique({
          where: { token },
        });

        if (session) {
          const now = Date.now();
          const isExpired =
            session.expiresAt.getTime() <= now ||
            now - session.createdAt.getTime() > MAX_SESSION_LIFETIME_MS;
          const isInactive = now - session.updatedAt.getTime() > INACTIVITY_TIMEOUT_MS;

          // Check if credential was changed after session creation (B3)
          let isCredentialInvalidated = false;
          const account = await prisma.account.findFirst({
            where: { userId: session.userId, providerId: 'credential' },
          });
          if (account && session.createdAt.getTime() < account.updatedAt.getTime()) {
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
  const tokens = extractSessionTokens(request);
  const currentToken = tokens[0];

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

  // R04: When password change succeeds, revoke all other sessions for this user server-side
  if (pathname.includes('/change-password') && response.status === 200 && currentToken) {
    try {
      const prisma = getPrismaClient();
      const currentSession = await prisma.session.findUnique({
        where: { token: currentToken },
      });
      if (currentSession) {
        await prisma.session.deleteMany({
          where: {
            userId: currentSession.userId,
            id: { not: currentSession.id },
          },
        });
      }
    } catch {
      // Must fail closed (non-200) if other session revocation fails
      return NextResponse.json(
        { error: 'فشل في إنهاء الجلسات الأخرى للمستخدم بعد تغيير كلمة المرور.' },
        { status: 500 }
      );
    }
  }

  return response;
}