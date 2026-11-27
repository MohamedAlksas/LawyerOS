'use client';

import React, { useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { twoFactor } from '@/lib/auth-client';
import { parseAndValidateOtp } from '@/modules/identity/otp-input';
import { sanitizeReturnTo } from '@/lib/sanitize-return-to';

function formatVerifyError(error: { status?: number; code?: string }, fallback: string): string {
  if (
    error.status === 429 ||
    error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' ||
    error.code === 'ACCOUNT_TEMPORARILY_LOCKED'
  ) {
    return 'تم تجاوز الحد المسموح به من المحاولات. برجاء الانتظار قليلاً والمحاولة لاحقاً.';
  }
  if (error.code === 'INVALID_TWO_FACTOR_COOKIE' || (error.status === 401 && !error.code)) {
    return 'انتهت صلاحية جلسة التحقق الثنائي. برجاء العودة لتسجيل الدخول مجدداً.';
  }
  return fallback;
}

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const [method, setMethod] = useState<'totp' | 'backup'>('totp');
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const totpTabRef = useRef<HTMLButtonElement>(null);
  const backupTabRef = useRef<HTMLButtonElement>(null);

  const handleMethodTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextMethod: 'totp' | 'backup' | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      nextMethod = method === 'totp' ? 'backup' : 'totp';
    } else if (e.key === 'Home') {
      nextMethod = 'totp';
    } else if (e.key === 'End') {
      nextMethod = 'backup';
    }
    if (!nextMethod) return;
    e.preventDefault();
    setMethod(nextMethod);
    setError(null);
    if (nextMethod === 'totp') totpTabRef.current?.focus();
    else backupTabRef.current?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (method === 'totp') {
      const validation = parseAndValidateOtp(totpCode);
      if (!validation.valid) {
        setError(validation.message);
        return;
      }

      setIsLoading(true);
      try {
        const res = await twoFactor.verifyTotp({
          code: validation.normalizedCode,
        });

        if (res.error) {
          setError(formatVerifyError(res.error, 'رمز التحقق غير صحيح أو انتهت صلاحيته.'));
          setIsLoading(false);
          return;
        }

        router.push(returnTo);
      } catch {
        setError('حدث خطأ أثناء الاتصال بالخادم للتحقق من الرمز. برجاء المحاولة مجدداً.');
        setIsLoading(false);
      }
    } else {
      const trimmed = backupCode.trim();
      if (!trimmed) {
        setError('يرجى إدخال رمز الاسترداد.');
        return;
      }

      setIsLoading(true);
      try {
        const res = await twoFactor.verifyBackupCode({
          code: trimmed,
        });

        if (res.error) {
          setError(formatVerifyError(res.error, 'رمز الاسترداد غير صحيح أو تم استخدامه مسبقاً.'));
          setIsLoading(false);
          return;
        }

        router.push(returnTo);
      } catch {
        setError('حدث خطأ أثناء الاتصال بالخادم للتحقق من الرمز. برجاء المحاولة مجدداً.');
        setIsLoading(false);
      }
    }
  };

  return (
    <main className="min-h-screen bg-[#F4F6F7] flex items-center justify-center p-4" dir="rtl" lang="ar-EG">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-[#D5DFE3] p-6 sm:p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#172A35]">التحقق الثنائي</h1>
          <p className="text-sm text-[#4D606A] mt-1">تأكيد الهوية عبر خطوة أمان إضافية</p>
        </div>

        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-4 p-3 bg-red-50 border border-red-200 text-[#A4262C] text-sm rounded flex items-center gap-2"
          >
            <span>{error}</span>
          </div>
        )}

        <div className="flex border-b border-[#D5DFE3] mb-5" role="tablist" aria-label="طريقة التحقق">
          <button
            ref={totpTabRef}
            id="verify-tab-totp"
            type="button"
            role="tab"
            aria-selected={method === 'totp'}
            aria-controls={method === 'totp' ? 'verify-panel-totp' : undefined}
            tabIndex={method === 'totp' ? 0 : -1}
            onClick={() => {
              setMethod('totp');
              setError(null);
            }}
            onKeyDown={handleMethodTabKeyDown}
            className={`flex-1 py-2 text-sm font-medium border-b-2 text-center transition-colors min-h-[44px] ${
              method === 'totp'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            رمز تطبيق المصادقة (TOTP)
          </button>
          <button
            ref={backupTabRef}
            id="verify-tab-backup"
            type="button"
            role="tab"
            aria-selected={method === 'backup'}
            aria-controls={method === 'backup' ? 'verify-panel-backup' : undefined}
            tabIndex={method === 'backup' ? 0 : -1}
            onClick={() => {
              setMethod('backup');
              setError(null);
            }}
            onKeyDown={handleMethodTabKeyDown}
            className={`flex-1 py-2 text-sm font-medium border-b-2 text-center transition-colors min-h-[44px] ${
              method === 'backup'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            رمز استرداد للطوارئ
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {method === 'totp' ? (
            <div id="verify-panel-totp" role="tabpanel" aria-labelledby="verify-tab-totp">
              <label htmlFor="totpCode" className="block text-sm font-medium text-[#172A35] mb-1">
                رمز التحقق المكوّن من 6 أرقام
              </label>
              <input
                id="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                dir="ltr"
                value={totpCode}
                onChange={(e) => {
                  setTotpCode(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] text-center tracking-widest text-xl font-mono bg-white focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent min-h-[44px]"
                placeholder="123456"
              />
              <div className="flex justify-between items-center text-xs text-[#4D606A] mt-1.5">
                <span>أدخل الرمز من تطبيق المصادقة (يدعم الأرقام العربية والإنجليزية).</span>
                {totpCode.length > 0 && (
                  <span className="font-mono text-[#14566B] font-medium" dir="ltr">
                    <bdi dir="ltr">{totpCode.length}/6</bdi>
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div id="verify-panel-backup" role="tabpanel" aria-labelledby="verify-tab-backup">
              <label htmlFor="backupCode" className="block text-sm font-medium text-[#172A35] mb-1">
                رمز الاسترداد المطبوع
              </label>
              <input
                id="backupCode"
                type="text"
                required
                autoFocus
                dir="ltr"
                value={backupCode}
                onChange={(e) => {
                  setBackupCode(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] text-center font-mono text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent min-h-[44px]"
                placeholder="xxxxx-xxxxx"
              />
              <p className="text-xs text-[#4D606A] mt-1.5">
                تنبيه: رموز الاسترداد صالحة للاستخدام مرة واحدة فقط للطوارئ.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-[#14566B] hover:bg-[#0f4354] disabled:opacity-50 text-white font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
          >
            {isLoading ? 'جارٍ التحقق...' : 'تأكيد ومتابعة'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() =>
              router.push(returnTo !== '/' ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login')
            }
            className="text-xs text-[#14566B] hover:underline min-h-[44px] inline-flex items-center justify-center p-2"
          >
            العودة إلى شاشة تسجيل الدخول
          </button>
        </div>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}