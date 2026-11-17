'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';

export function SessionExpiredAlert() {
  const searchParams = useSearchParams();
  const isExpired = searchParams.get('error') === 'session_expired';

  if (!isExpired) return null;

  return (
    <div
      role="alert"
      data-testid="session-expired-alert"
      className="fixed top-4 inset-x-4 max-w-md mx-auto z-50 p-3.5 bg-amber-50 border border-amber-300 text-[#7A4A00] rounded-[6px] shadow-md flex items-center justify-center gap-2 text-sm font-semibold"
    >
      انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.
    </div>
  );
}
