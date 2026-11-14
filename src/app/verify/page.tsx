'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { twoFactor } from '@/lib/auth-client';

/**
 * Normalizes Eastern Arabic-Indic digits (٠-٩) and Persian digits (۰-۹) to standard ASCII (0-9)
 * and strips any non-numeric characters.
 */
export function normalizeOtpDigits(input: string): string {
  if (!input) return '';
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
}

export default function VerifyPage() {
  const router = useRouter();
  const [method, setMethod] = useState<'totp' | 'backup'>('totp');
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (method === 'totp') {
      const normalized = normalizeOtpDigits(totpCode);
      if (!normalized) {
        setError('يرجى إدخال رمز التحقق المكوّن من 6 أرقام.');
        return;
      }
      if (normalized.length < 6) {
        setError(`رمز التحقق غير مكتمل (${normalized.length} من 6 أرقام). يرجى إدخال 6 أرقام.`);
        return;
      }
      if (normalized.length > 6) {
        setError('رمز التحقق يجب ألا يتجاوز 6 أرقام.');
        return;
      }

      setIsLoading(true);
      try {
        const res = await twoFactor.verifyTotp({
          code: normalized,
        });

        if (res.error) {
          setError('رمز التحقق غير صحيح أو انتهت صلاحيته.');
          setIsLoading(false);
          return;
        }

        router.push('/');
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
          setError('رمز الاسترداد غير صحيح أو تم استخدامه مسبقاً.');
          setIsLoading(false);
          return;
        }

        router.push('/');
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
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className="flex border-b border-[#D5DFE3] mb-5">
          <button
            type="button"
            onClick={() => {
              setMethod('totp');
              setError(null);
            }}
            className={`flex-1 py-2 text-sm font-medium border-b-2 text-center transition-colors ${
              method === 'totp'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            رمز تطبيق المصادقة (TOTP)
          </button>
          <button
            type="button"
            onClick={() => {
              setMethod('backup');
              setError(null);
            }}
            className={`flex-1 py-2 text-sm font-medium border-b-2 text-center transition-colors ${
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
            <div>
              <label htmlFor="totpCode" className="block text-sm font-medium text-[#172A35] mb-1">
                رمز التحقق المكوّن من 6 أرقام
              </label>
              <input
                id="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                dir="ltr"
                value={totpCode}
                onChange={(e) => {
                  const normalized = normalizeOtpDigits(e.target.value).slice(0, 6);
                  setTotpCode(normalized);
                  if (error) setError(null);
                }}
                className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] text-center tracking-widest text-xl font-mono bg-white focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent"
                placeholder="123456"
              />
              <div className="flex justify-between items-center text-xs text-[#4D606A] mt-1.5">
                <span>أدخل الرمز من تطبيق المصادقة (يدعم الأرقام العربية والإنجليزية).</span>
                {totpCode.length > 0 && (
                  <span className="font-mono text-[#14566B] font-medium" dir="ltr">
                    {totpCode.length}/6
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div>
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
                className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] text-center font-mono text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent"
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
            className="w-full py-2.5 px-4 bg-[#14566B] hover:bg-[#0f4354] disabled:opacity-50 text-white font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            {isLoading ? 'جارٍ التحقق...' : 'تأكيد ومتابعة'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="text-xs text-[#14566B] hover:underline"
          >
            العودة إلى شاشة تسجيل الدخول
          </button>
        </div>
      </div>
    </main>
  );
}