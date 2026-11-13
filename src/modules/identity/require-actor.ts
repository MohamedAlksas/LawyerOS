import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import crypto from 'crypto';
import { Actor, AuthenticationError, Permission, UserRole } from './types';
import { assertAuthorized } from './authorize';

export interface RequireActorOptions {
  headers?: Headers | null;
  sessionToken?: string;
  allowIncompleteMfa?: boolean;
  requiredPermission?: Permission;
}

const MAX_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;        // 30 minutes

function verifyAndExtractCookieToken(rawCookieValue: string): string {
  const decoded = decodeURIComponent(rawCookieValue);
  const lastDot = decoded.lastIndexOf('.');
  if (lastDot < 1) {
    throw new AuthenticationError('UNAUTHENTICATED', 'جلسة غير صالحة أو تم التلاعب بتوقيعها.');
  }

  const token = decoded.substring(0, lastDot);
  const signature = decoded.substring(lastDot + 1);

  if (signature.length !== 44 || !signature.endsWith('=')) {
    throw new AuthenticationError('UNAUTHENTICATED', 'جلسة غير صالحة أو تم التلاعب بتوقيعها.');
  }

  const env = getEnv();
  const expectedSignature = crypto
    .createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(token)
    .digest('base64');

  if (
    expectedSignature.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  ) {
    throw new AuthenticationError('UNAUTHENTICATED', 'جلسة غير صالحة أو تم التلاعب بتوقيعها.');
  }

  return token;
}

function extractCookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    // Matches both plain and __Secure- prefixed Better Auth session cookies
    if (cookie.startsWith('better-auth.session_token=')) {
      const val = cookie.substring('better-auth.session_token='.length);
      return verifyAndExtractCookieToken(val);
    }
    if (cookie.startsWith('__Secure-better-auth.session_token=')) {
      const val = cookie.substring('__Secure-better-auth.session_token='.length);
      return verifyAndExtractCookieToken(val);
    }
  }

  return null;
}

/**
 * Server-side extraction and authoritative validation of current verified session and actor.
 * Enforces:
 * 1. Valid non-revoked session record in database.
 * 2. 12-hour maximum lifetime bound (from creation time).
 * 3. 30-minute inactivity timeout (from last activity update).
 * 4. Completed Two-Factor Authentication (incomplete MFA rejected with MFA_REQUIRED).
 * 5. Optional granular permission authorization.
 */
export async function requireActor(options: RequireActorOptions = {}): Promise<Actor> {
  let token = options.sessionToken;

  if (!token) {
    let cookieHeader: string | null = null;
    if (options.headers) {
      cookieHeader = options.headers.get('cookie');
    } else {
      try {
        // Dynamic import next/headers so the module can still run in standalone test environments
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        const rawToken =
          cookieStore.get('better-auth.session_token')?.value ||
          cookieStore.get('__Secure-better-auth.session_token')?.value;
        if (rawToken) {
          token = verifyAndExtractCookieToken(rawToken);
        }
      } catch (err) {
        if (err instanceof AuthenticationError) {
          throw err;
        }
        // Not in Next.js request context (e.g. testing)
      }
    }

    if (!token && cookieHeader) {
      token = extractCookieToken(cookieHeader) || undefined;
    }
  }

  if (!token) {
    throw new AuthenticationError('UNAUTHENTICATED', 'يجب تسجيل الدخول للوصول إلى هذه الشاشة.');
  }

  const prisma = getPrismaClient();
  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          twoFactors: true,
        },
      },
    },
  });

  if (!session || !session.user) {
    throw new AuthenticationError('UNAUTHENTICATED', 'جلسة غير صالحة أو تم إنهاؤها.');
  }

  const { user } = session;

  const now = Date.now();

  // Expiration check from database
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError('SESSION_EXPIRED', 'انتهت صلاحية الجلسة. برجاء تسجيل الدخول مجدداً.');
  }

  // Maximum lifetime check (12 hours)
  const sessionAgeMs = now - session.createdAt.getTime();
  if (sessionAgeMs > MAX_SESSION_LIFETIME_MS) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError(
      'SESSION_EXPIRED',
      'انتهت مدة الجلسة القصوى (12 ساعة). برجاء تسجيل الدخول مجدداً.'
    );
  }

  // Inactivity timeout check (30 minutes)
  const inactivityMs = now - session.updatedAt.getTime();
  if (inactivityMs > INACTIVITY_TIMEOUT_MS) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new AuthenticationError(
      'SESSION_INACTIVE',
      'تم قفل الجلسة لعدم النشاط لمدة تتجاوز 30 دقيقة.'
    );
  }

  // Mandatory MFA enforcement check (R02):
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
    // If twoFactor is enabled on user but not verified, or no valid 2FA setup, reject
    if (!twoFactorRecord || twoFactorRecord.verified === false) {
      throw new AuthenticationError('MFA_REQUIRED', 'يلزم استكمال التحقق الثنائي (TOTP) للوصول.');
    }
  }

  // Update session updatedAt to slide the inactivity window
  await prisma.session.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  }).catch(() => {});

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