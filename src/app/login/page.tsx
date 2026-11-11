'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });

      if (res.error) {
        if (res.error.status === 429) {
          setError('تم تجاوز الحد المسموح به من المحاولات. برجاء الانتظار قليلاً والمحاولة لاحقاً.');
        } else {
          // Generic sanitized error message (never reveals whether account exists)
          setError('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
        }
        setIsLoading(false);
        return;
      }

      // Check if two factor redirect is required
      if (res.data && 'twoFactorRedirect' in res.data && res.data.twoFactorRedirect) {
        router.push('/verify');
        return;
      }

      router.push('/');
    } catch {
      setError('حدث خطأ أثناء محاولة تسجيل الدخول. برجاء المحاولة مجدداً.');
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F4F6F7] flex items-center justify-center p-4" dir="rtl" lang="ar-EG">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-[#D5DFE3] p-6 sm:p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#172A35]">تسجيل الدخول</h1>
          <p className="text-sm text-[#4D606A] mt-1">نظام إدارة مكتب المحاماة — LawOffice OS</p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 p-3 bg-red-50 border border-red-200 text-[#A4262C] text-sm rounded flex items-center gap-2"
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#172A35] mb-1">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] bg-white focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent text-left"
              placeholder="lawyer@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#172A35] mb-1">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] bg-white focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-[#14566B] hover:bg-[#0f4354] disabled:opacity-50 text-white font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            {isLoading ? 'جارٍ التحقق...' : 'تسجيل الدخول'}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-[#4D606A]">
          المصادقة محمية ومشفرة وفق أعلى معايير أمان الهوية والجلسات.
        </div>
      </div>
    </main>
  );
}