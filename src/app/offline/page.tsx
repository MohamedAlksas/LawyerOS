'use client';

import React from 'react';
import { IconWarning } from '@/components/stitch-icons';

export default function OfflinePage() {
  return (
    <main
      role="main"
      className="min-h-screen bg-[#F4F6F7] flex items-center justify-center p-4 text-[#172A35]"
      dir="rtl"
      lang="ar-EG"
    >
      <div
        role="alert"
        data-testid="error-container"
        className="w-full max-w-md bg-white rounded-[6px] shadow-xs border border-[#D5DFE3] p-6 sm:p-8 text-center space-y-6"
      >
        <div
          className="w-14 h-14 mx-auto rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] flex items-center justify-center text-[#7A4A00]"
          aria-hidden="true"
        >
          <IconWarning className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-[#172A35]">
            انقطع الاتصال — غير متصل بالشبكة
          </h1>
          <div
            role="status"
            aria-live="polite"
            data-testid="connectivity-banner"
            className="bg-[#FFF8E1] border border-[#FFE082] text-[#7A4A00] p-2.5 rounded-[4px] text-sm font-semibold"
          >
            انقطع الاتصال بالإنترنت. التعديلات غير محفوظة
          </div>
          <p className="text-sm text-[#4D606A] leading-relaxed pt-2">
            أنت تعمل حالياً دون اتصال بالشبكة. حفاظاً على سرية وسلامة بيانات القضايا والموكلين، لا يتم حفظ أي تعديلات محلياً أثناء انقطاع الشبكة.
          </p>
        </div>

        <button
          type="button"
          data-testid="error-retry-button"
          onClick={() => window.location.reload()}
          className="w-full py-2.5 px-4 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          إعادة المحاولة
        </button>
      </div>
    </main>
  );
}
