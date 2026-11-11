import { auth, getPrismaClient } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const MAX_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;        // 30 minutes

function extractSessionToken(request: NextRequest): string | null {
  const raw =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value;
  if (!raw) return null;
  return decodeURIComponent(raw.split('.')[0]);
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

  // R03: Intercept session cookie before library handlers touch it
  const token = extractSessionToken(request);
  if (token) {
    try {
      const prisma = getPrismaClient();
      const session = await prisma.session.findUnique({
        where: { token },
      });

      if (session) {
        const now = Date.now();
        const isExpired =
          session.expiresAt.getTime() <= now ||
          now - session.createdAt.getTime() > MAX_SESSION_LIFETIME_MS;
        const isInactive = now - session.updatedAt.getTime() > INACTIVITY_TIMEOUT_MS;

        if (isExpired || isInactive) {
          // Immediately evict session from database so library handlers cannot revive it
          await prisma.session.delete({ where: { id: session.id } }).catch(() => {});

          const response = NextResponse.json(
            {
              error: isInactive
                ? 'تم قفل الجلسة لعدم النشاط لمدة تتجاوز 30 دقيقة.'
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
      // Database not reachable or in standalone test mode without DB
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
  const token = extractSessionToken(request);

  const response = await auth.handler(request);

  // R04: When password change succeeds, revoke all other sessions for this user server-side
  if (pathname.includes('/change-password') && response.status === 200 && token) {
    try {
      const prisma = getPrismaClient();
      const currentSession = await prisma.session.findUnique({
        where: { token },
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
      // Non-fatal if session already revoked or during mock
    }
  }

  return response;
}