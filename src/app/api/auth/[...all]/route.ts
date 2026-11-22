import { auth, getPrismaClient, getTrustedOrigins } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/modules/identity/require-actor';
import { regenerateRecoveryCodes } from '@/modules/identity/recovery-codes';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { recordAuditEvent } from '@/lib/audit';
import { randomUUID } from 'crypto';
import {
  getUserCredentialVersion,
  getUserCredentialVersionByEmail,
  setSessionCredentialVersion,
  isSessionCredentialVersionMismatched,
} from '@/modules/identity/credential-version';

import { MAX_SESSION_LIFETIME_MS, INACTIVITY_TIMEOUT_MS } from '@/modules/identity/session-limits';

async function auditIdentityOutcome(userId: string, action: string) {
  try {
    await recordAuditEvent(getPrismaClient(), {
      userId,
      action,
      entityType: 'User',
      entityId: userId,
    });
  } catch {
    console.error('[Identity Audit] Failed to persist authentication outcome');
  }
}

function auditSignInMfa(userId: string, accepted: boolean) {
  return auditIdentityOutcome(userId, accepted ? 'VERIFY_SIGN_IN_MFA' : 'REJECT_SIGN_IN_MFA');
}

function extractRawTokens(cookiePart: string): {
  rawToken: string;
  candidateIdentifiers: string[];
} {
  const eqIdx = cookiePart.indexOf('=');
  const cookieVal = eqIdx !== -1 ? cookiePart.slice(eqIdx + 1) : '';
  const decodedVal = decodeURIComponent(cookieVal);
  const withoutPrefix = decodedVal.startsWith('s:') ? decodedVal.slice(2) : decodedVal;
  const dotIdx = withoutPrefix.lastIndexOf('.');
  const rawToken = dotIdx !== -1 ? withoutPrefix.substring(0, dotIdx) : withoutPrefix.split('.')[0];
  const bareToken = rawToken.startsWith('2fa-') ? rawToken.slice(4) : rawToken;

  const candidateIdentifiers = Array.from(
    new Set(
      [
        rawToken,
        bareToken,
        `2fa-${rawToken}`,
        `2fa-${bareToken}`,
        `two-factor-${rawToken}`,
        `two-factor-${bareToken}`,
        decodedVal,
        withoutPrefix,
        cookieVal,
      ].filter(Boolean)
    )
  );

  return { rawToken: bareToken || rawToken, candidateIdentifiers };
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

async function privateAuthResponse(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  if (!response.body || !headers.get('content-type')?.includes('application/json')) {
    return new Response(response.body, { status: response.status, headers });
  }
  const data: unknown = await response.json();
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(JSON.stringify(data, (key, value) => key === 'token' ? undefined : value), {
    status: response.status,
    headers,
  });
}

export async function GET(request: NextRequest) {
  const blocked = await handleAuthSecurityGuards(request);
  if (blocked) return blocked;
  return privateAuthResponse(await auth.handler(request));
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

      // Cookie-bearing requests strictly require Origin or Referer
      if (!origin && !referer) {
        return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
      }

      const allowedOrigins = getTrustedOrigins();

      const host = request.headers.get('host');
      if (host) {
        const isTrustedHost = Array.from(allowedOrigins).some((to) => {
          try {
            return new URL(to).host === host;
          } catch {
            return false;
          }
        });
        if (!isTrustedHost) {
          return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
        }
      }

      if (origin === 'null') {
        let reqOrigin: string;
        try {
          reqOrigin = new URL(request.url).origin;
        } catch {
          return NextResponse.json({ error: 'Origin غير صالح أو غير موثوق.' }, { status: 403 });
        }

        // R12-04: Validate complete inferred destination origin (scheme, host, port) from request.url
        // Reject untrusted scheme/destination even if Host header matches a trusted host,
        // and reject untrusted Host header even if request.url was constructed with trusted base
        if (
          !allowedOrigins.has(reqOrigin) ||
          request.headers.get('sec-fetch-site') !== 'same-origin'
        ) {
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

  // R11-01 & R13-01: In POST /api/auth/sign-in/email:
  // Capture user's current credentialVersion before Better Auth executes.
  // Fail closed immediately with HTTP 500 if database query throws.
  let signInUserCredentialVersion: number | null = null;
  if (pathname.includes('/sign-in/email')) {
    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    let email: unknown;
    if (contentType === 'application/x-www-form-urlencoded') {
      const emailFields = await request.clone().formData().then((body) => body.getAll('email')).catch(() => []);
      if (emailFields.length > 1) {
        return NextResponse.json({ error: 'أدخل عنوان بريد إلكتروني واحداً.' }, { status: 400 });
      }
      email = emailFields[0];
    } else {
      email = (await request.clone().json().catch(() => null))?.email;
    }
    if (typeof email === 'string' && email) {
      try {
        signInUserCredentialVersion = await getUserCredentialVersionByEmail(email);
      } catch {
        return NextResponse.json(
          { error: 'فشل في قراءة حالة أمان الحساب. يرجى إعادة المحاولة.' },
          { status: 500 }
        );
      }
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
        const { rawToken, candidateIdentifiers } = extractRawTokens(tfCookie);
        if (rawToken) {
          mfaRawToken = rawToken;
          const prisma = getPrismaClient();
          const verifRecord = await prisma.verification.findFirst({
            where: { identifier: { in: candidateIdentifiers } },
          });
          if (verifRecord) {
            challengeCreatedAt = new Date(verifRecord.createdAt);
            targetUserId = verifRecord.value;

            // Load companion 2fa-cred-ver-${rawToken}
            const companionCandidates = candidateIdentifiers.map((id) => `2fa-cred-ver-${id}`);
            const credVerRecord = await prisma.verification.findFirst({
              where: { identifier: { in: companionCandidates } },
            });

            let currentCredVer: number;
            try {
              currentCredVer = await getUserCredentialVersion(targetUserId);
              expectedCredVer = currentCredVer;
            } catch {
              // Fail closed if version resolution fails
              await prisma.verification.deleteMany({
                where: {
                  OR: [
                    { id: verifRecord.id },
                    { identifier: { in: candidateIdentifiers } },
                    { identifier: { in: companionCandidates } },
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
              await auditSignInMfa(targetUserId, false);
              return errRes;
            }

            const account = await prisma.account.findFirst({
              where: { userId: targetUserId, providerId: 'credential' },
            });

            const isStaleByAccount =
              account && challengeCreatedAt < new Date(account.updatedAt);
            const isStaleByCredVer =
              !credVerRecord || Number(credVerRecord.value) !== currentCredVer;

            // R12-01: Enforce credVerRecord presence: if missing, mismatched, or stale, fail closed
            if (!credVerRecord || isStaleByAccount || isStaleByCredVer) {
              // Stale challenge created under prior password or missing companion record! Delete and reject fail-closed!
              await prisma.verification.deleteMany({
                where: {
                  OR: [
                    { id: verifRecord.id },
                    { identifier: { in: candidateIdentifiers } },
                    { identifier: { in: companionCandidates } },
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
              await auditSignInMfa(targetUserId, false);
              return errRes;
            }
          }
        }
      }
    }
  }

  // R10-01: Change password pre-handler: ensure Better Auth receives revokeOtherSessions flag
  let reqToExecute = request;
  let passwordChangeActorId: string | undefined;

  if (pathname.includes('/change-password')) {
    const actor = await requireActor({ headers: request.headers, touchSession: false }).catch(() => null);
    passwordChangeActorId = actor?.id;
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
  if (passwordChangeActorId && !response.ok) {
    await auditIdentityOutcome(passwordChangeActorId, 'REJECT_PASSWORD_CHANGE');
  }

  // R11-01 & R12-01: In POST /api/auth/sign-in/email:
  // When Better Auth issues a 2FA challenge cookie, stamp companion record in verification:
  // identifier: '2fa-cred-ver-' + rawToken, value: String(userCredentialVersion), with matching expiresAt.
  if (pathname.includes('/sign-in/email')) {
    const setCookies = response.headers.getSetCookie?.() || [
      response.headers.get('set-cookie') || '',
    ];
    const tfCookie = setCookies.find(
      (c) =>
        c.startsWith('better-auth.two_factor=') ||
        c.startsWith('__Secure-better-auth.two_factor=')
    );
    if (tfCookie) {
      const { rawToken, candidateIdentifiers } = extractRawTokens(tfCookie);
      const companionCandidates = candidateIdentifiers.map((id) => `2fa-cred-ver-${id}`);
      if (rawToken) {
        const prisma = getPrismaClient();
        let verifRecordId: string | null = null;
        let verifUserId: string | null = null;
        try {
          const verifRecord = await prisma.verification.findFirst({
            where: { identifier: { in: candidateIdentifiers } },
          });
          if (!verifRecord) {
            throw new Error(`Verification challenge record not found for token ${rawToken}`);
          }
          verifRecordId = verifRecord.id;
          verifUserId = verifRecord.value;

          const expiresAt =
            verifRecord.expiresAt || new Date(Date.now() + 10 * 60 * 1000);

          // R13-01: Fail closed if credential version was not captured before authentication.
          // NEVER reconstruct or read credential version after provider authentication!
          if (signInUserCredentialVersion === null || signInUserCredentialVersion === undefined) {
            throw new Error('Credential version not captured before authentication');
          }
          const credVer = signInUserCredentialVersion;

          await prisma.verification.deleteMany({
            where: { identifier: { in: companionCandidates } },
          });

          await prisma.verification.create({
            data: {
              id: randomUUID(),
              identifier: `2fa-cred-ver-${rawToken}`,
              value: String(credVer),
              expiresAt,
            },
          });
        } catch {
          // R12-01: Prevent companion insert failure suppression!
          // If inserting 2fa-cred-ver-${rawToken} fails, clean up created verification record,
          // clear 2FA cookies, and return HTTP 500 fail-closed
          await prisma.verification.deleteMany({
            where: {
              OR: [
                ...(verifRecordId ? [{ id: verifRecordId }] : []),
                ...(verifUserId ? [{ value: verifUserId }] : []),
                { identifier: { in: candidateIdentifiers } },
                { identifier: { in: companionCandidates } },
              ],
            },
          }).catch(() => {});

          const errRes = NextResponse.json(
            { error: 'فشل في تهيئة سياق أمان التحقق الثنائي.' },
            { status: 500 }
          );
          errRes.cookies.delete('better-auth.two_factor');
          errRes.cookies.delete('__Secure-better-auth.two_factor');
          return errRes;
        }
      }
    }

    // Also if a direct session was issued without 2FA:
    const sessionCookie = setCookies.find(
      (c) =>
        c.startsWith('better-auth.session_token=') ||
        c.startsWith('__Secure-better-auth.session_token=')
    );
    if (sessionCookie && signInUserCredentialVersion !== null) {
      try {
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
      } catch {
        // Best-effort sign-in metadata stamping
      }
    }
  }

  // F10, R10-01, R11-01 & R13-01: Two-factor verification post-handler:
  // When MFA succeeds, assert user's version hasn't rotated while completing;
  // verify newly issued session.credentialVersion in PostgreSQL matches expectedCredVer.
  if (
    (pathname.includes('/two-factor/verify-totp') ||
      pathname.includes('/two-factor/verify-backup-code')) &&
    response.status === 200
  ) {
    let newSessionId: string | null = null;
    const prisma = getPrismaClient();
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
        const { rawToken, candidateIdentifiers } = extractRawTokens(sessionCookie);
        if (rawToken) {
          const newSession = await prisma.session.findFirst({
            where: {
              OR: candidateIdentifiers.map((t) => ({ token: t })),
            },
          });
          if (!newSession) {
            throw new Error('Issued session not found in database');
          }
          newSessionId = newSession.id;

          const uid = targetUserId || newSession.userId;
          const postCredVer = await getUserCredentialVersion(uid);

          if (
            expectedCredVer === null ||
            postCredVer !== expectedCredVer ||
            newSession.credentialVersion !== expectedCredVer
          ) {
            // Credential was rotated while completing MFA or session version mismatch! Evict session and fail closed!
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
            await auditSignInMfa(uid, false);
            return errRes;
          }

          // Clean up companion verification record
          if (mfaRawToken) {
            await prisma.verification.deleteMany({
              where: {
                OR: [
                  { identifier: `2fa-cred-ver-${mfaRawToken}` },
                  { identifier: `2fa-cred-ver-2fa-${mfaRawToken}` },
                ],
              },
            }).catch(() => {});
          }
        }
      }
    } catch {
      // R13-01: Fail closed if post-MFA security verification fails
      if (newSessionId) {
        await prisma.session.delete({ where: { id: newSessionId } }).catch(() => {});
      }
      const errRes = NextResponse.json(
        { error: 'حدث خطأ غير متوقع أثناء التحقق من أمان الجلسة.' },
        { status: 500 }
      );
      errRes.cookies.delete('better-auth.session_token');
      errRes.cookies.delete('__Secure-better-auth.session_token');
      errRes.cookies.delete('better-auth.two_factor');
      errRes.cookies.delete('__Secure-better-auth.two_factor');
      return errRes;
    }
  }

  if (targetUserId && /(verify-totp|verify-backup-code)$/.test(pathname)) {
    await auditSignInMfa(targetUserId, response.ok);
  }
  return privateAuthResponse(response);
}

