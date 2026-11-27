'use client';

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export function SessionExpiredAlert() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  const isExpired = searchParams.get('error') === 'session_expired';

  if (!isExpired || dismissed) return null;

  return (
    <div
      role="alert"
      data-testid="session-expired-alert"
      style={{ top: 'calc(var(--shell-top-height, 0px) + 1rem)' }}
      className="fixed inset-x-4 max-w-md mx-auto z-50 p-3.5 bg-amber-50 border border-amber-300 text-[#7A4A00] rounded-[6px] shadow-md flex items-center justify-between gap-2 text-sm font-semibold"
    >
      <span>انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.</span>
      <button
        type="button"
        data-testid="session-expired-dismiss-button"
        onClick={() => setDismissed(true)}
        aria-label="إغلاق التنبيه"
        className="text-[#7A4A00] hover:text-[#5A3600] p-1 rounded focus:outline-none focus:ring-2 focus:ring-[#7A4A00] min-h-[32px] min-w-[32px] flex items-center justify-center shrink-0"
      >
        <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
