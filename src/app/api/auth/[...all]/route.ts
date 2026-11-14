import { auth, getPrismaClient, getTrustedOrigins } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/modules/identity/require-actor';
import { regenerateRecoveryCodes } from '@/modules/identity/recovery-codes';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { randomUUID } from 'crypto';
import {
  getUserCredentialVersion,
  getUserCredentialVersionByEmail,
  incrementUserCredentialVersion,
  setSessionCredentialVersion,
  evictOlderSessions,
  isSessionCredentialVersionMismatched,
} from '@/modules/identity/credential-version';

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

        // Check if credential was changed after session creation (B3 & R11-01)
        let isCredentialInvalidated = false;
        const prisma = getPrismaClient();
        const account = await prisma.account.findFirst({
          where: { userId: session.userId, providerId: 'credential' },
        });
        if (account && sessionCreatedAt < new Date(account.updatedAt).getTime()) {
          isCredentialInvalidated = true;
        }

        // R11-01: Enforce session.credentialVersion === user.credentialVersion
        const isVersionMismatched = await isSessionCredentialVersionMismatched(
          session.userId,
          session.id
        );
        if (isVersionMismatched) {
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

  // F06 & R11-03: Intercept raw POST /api/auth/two-factor/generate-backup-codes to enforce
  // Pinned Provider Trusted-Origin Parity without Host expansion, identical Identity authorization,
  // password reauthentication, and atomic lockout budget
  if (pathname.includes('/two-factor/generate-backup-codes')) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      if (request.headers.get('sec-fetch-site') === 'cross-site') {
        return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
      }

      const origin = request.headers.get('origin');
      const referer = request.headers.get('referer');
      const host = request.headers.get('host');

      // Cookie-bearing requests strictly require Origin or Referer
      if (!origin && !referer) {
        return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
      }

      const allowedOrigins = getTrustedOrigins();

      if (origin === 'null') {
        // If origin === 'null', strictly verify if host header matches a trusted origin
        const isTrustedHost = Array.from(allowedOrigins).some((to) => {
          try {
            return new URL(to).host === host;
          } catch {
            return false;
          }
        });
        if (!isTrustedHost || request.headers.get('sec-fetch-site') !== 'same-origin') {
          return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
        }
      } else {
        let originToValidate: string | null = origin;
        if (!originToValidate && referer) {
          try {
            originToValidate = new URL(referer).origin;
          } catch {
            originToValidate = null;
          }
        }

        // Do NOT synthesize origin from request.nextUrl.origin
        // Do NOT add request Host or forwarded headers (x-forwarded-proto) to allowed origins
        if (!originToValidate || !allowedOrigins.has(originToValidate)) {
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
      return NextResponse.json(
        { error: 'حدث خطأ غير متوقع أثناء معالجة رموز الاسترداد.' },
        { status: 500 }
      );
    }
  }

  // R11-01: In POST /api/auth/sign-in/email:
  // Capture user's current credentialVersion before Better Auth executes
  let signInUserCredentialVersion: number | null = null;
  if (pathname.includes('/sign-in/email')) {
    try {
      const body = await request.clone().json().catch(() => ({}));
      if (body.email && typeof body.email === 'string') {
        signInUserCredentialVersion = await getUserCredentialVersionByEmail(body.email);
      }
    } catch {
      // Ignore body parsing errors
    }
  }

  // F10, R10-01 & R11-01: Two-factor challenge pre-handler: capture challenge metadata and reject stale challenges
  let challengeCreatedAt: Date | null = null;
  let targetUserId: string | null = null;
  let expectedCredVer: number | null = null;
  let mfaRawToken: string | null = null;

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
          mfaRawToken = rawToken;
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

            // Load companion 2fa-cred-ver-${rawToken}
            const credVerRecord = await prisma.verification.findFirst({
              where: { identifier: `2fa-cred-ver-${rawToken}` },
            });

            const currentCredVer = await getUserCredentialVersion(targetUserId);
            expectedCredVer = currentCredVer;

            const account = await prisma.account.findFirst({
              where: { userId: targetUserId, providerId: 'credential' },
            });

            const isStaleByAccount =
              account && challengeCreatedAt < new Date(account.updatedAt);
            const isStaleByCredVer =
              credVerRecord && Number(credVerRecord.value) !== currentCredVer;

            if (isStaleByAccount || isStaleByCredVer) {
              // Stale challenge created under prior password! Delete and reject fail-closed!
              await prisma.verification.deleteMany({
                where: {
                  OR: [
                    { id: verifRecord.id },
                    { identifier: `2fa-cred-ver-${rawToken}` },
                  ],
                },
              }).catch(() => {});

              const errRes = NextResponse.json(
                {
                  error:
                    'تم تغيير كلمة المرور. تم إلغاء جلسة التحقق السابقة، يرجى تسجيل الدخول مجدداً بكلمة المرور الجديدة.',
                },
                { status: 401 }
              );
              errRes.cookies.delete('better-auth.two_factor');
              errRes.cookies.delete('__Secure-better-auth.two_factor');
              return errRes;
            }
          }
        }
      }
    }
  }

  // F10, R10-01 & R11-01: Change password pre-handler: resolve current session before auth.handler modifies it
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

  // R11-01: In POST /api/auth/sign-in/email:
  // When Better Auth issues a 2FA challenge cookie, stamp companion record in verification:
  // identifier: '2fa-cred-ver-' + rawToken, value: String(userCredentialVersion), with matching expiresAt.
  if (pathname.includes('/sign-in/email') && signInUserCredentialVersion !== null) {
    try {
      const setCookies = response.headers.getSetCookie?.() || [
        response.headers.get('set-cookie') || '',
      ];
      const tfCookie = setCookies.find(
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
          const expiresAt =
            verifRecord?.expiresAt || new Date(Date.now() + 10 * 60 * 1000);

          await prisma.verification.deleteMany({
            where: { identifier: `2fa-cred-ver-${rawToken}` },
          }).catch(() => {});

          await prisma.verification.create({
            data: {
              id: randomUUID(),
              identifier: `2fa-cred-ver-${rawToken}`,
              value: String(signInUserCredentialVersion),
              expiresAt,
            },
          }).catch(() => {});
        }
      }

      // Also if a direct session was issued without 2FA:
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
          const session = await prisma.session.findFirst({
            where: {
              OR: [
                { token: rawToken },
                { token: decodedVal },
                { token: cookieVal },
              ],
            },
          });
          if (session) {
            await setSessionCredentialVersion(
              prisma,
              session.id,
              signInUserCredentialVersion
            );
          }
        }
      }
    } catch {
      // Best-effort sign-in metadata stamping
    }
  }

  // R04, F10, R10-01 & R11-01: When password change succeeds:
  // In PostgreSQL transaction: increment user.credentialVersion = user.credentialVersion + 1,
  // evict all sessions for that user with older credentialVersion,
  // permanently purge all verification records for that user,
  // set replacement session's credentialVersion = newVersion. Fail closed with HTTP 500 on error.
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

      let targetUid = changePasswordUserId;
      if (!targetUid && replacementSessionId) {
        const s = await prisma.session.findUnique({
          where: { id: replacementSessionId },
          select: { userId: true },
        });
        targetUid = s?.userId || null;
      }

      if (targetUid) {
        const keepSessionId = replacementSessionId || originalSessionId;

        await prisma.$transaction(async (tx) => {
          // 1. Increment user.credentialVersion
          const newVersion = await incrementUserCredentialVersion(tx, targetUid!);

          // 2. Set replacement session's credentialVersion = newVersion
          if (keepSessionId) {
            await setSessionCredentialVersion(tx, keepSessionId, newVersion);
          }

          // 3. Evict all sessions for that user with older credentialVersion
          await evictOlderSessions(tx, targetUid!, newVersion, keepSessionId);

          // 4. Permanently purge all verification records for that user and companion records
          await tx.verification.deleteMany({
            where: {
              OR: [
                { value: targetUid! },
                { identifier: { startsWith: '2fa-cred-ver-' } },
              ],
            },
          });
        });
      }
    } catch {
      return NextResponse.json(
        {
          error:
            'فشل في تحديث حالة أمان الاعتماد وإنهاء الجلسات الأخرى بعد تغيير كلمة المرور.',
        },
        { status: 500 }
      );
    }
  }

  // F10, R10-01 & R11-01: Two-factor verification post-handler:
  // When MFA succeeds, assert user's version hasn't rotated while completing;
  // update newly issued session.credentialVersion = user.credentialVersion.
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
            const postCredVer = await getUserCredentialVersion(uid);

            if (expectedCredVer !== null && postCredVer !== expectedCredVer) {
              // Credential was rotated while completing MFA! Evict session and fail closed!
              await prisma.session.delete({ where: { id: newSession.id } }).catch(() => {});
              const errRes = NextResponse.json(
                {
                  error:
                    'تم تغيير كلمة المرور. تم إلغاء جلسة التحقق السابقة، يرجى تسجيل الدخول مجدداً بكلمة المرور الجديدة.',
                },
                { status: 401 }
              );
              errRes.cookies.delete('better-auth.session_token');
              errRes.cookies.delete('__Secure-better-auth.session_token');
              errRes.cookies.delete('better-auth.two_factor');
              errRes.cookies.delete('__Secure-better-auth.two_factor');
              return errRes;
            }

            // Update newly issued session.credentialVersion = postCredVer
            await setSessionCredentialVersion(prisma, newSession.id, postCredVer);

            // Clean up companion verification record
            if (mfaRawToken) {
              await prisma.verification.deleteMany({
                where: { identifier: `2fa-cred-ver-${mfaRawToken}` },
              }).catch(() => {});
            }

            // Also keep the session's recorded authentication age matching the proof age if challengeCreatedAt is present
            if (challengeCreatedAt) {
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

