import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      dir="rtl"
      lang="ar-EG"
      className="max-w-3xl mx-auto py-12 px-4"
    >
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 sm:p-12 text-center space-y-4 shadow-xs">
        <h1 className="text-xl sm:text-2xl font-bold text-[#172A35]">
          الصفحة أو السجل غير موجود
        </h1>
        <p className="text-sm text-[#4D606A] max-w-md mx-auto leading-relaxed">
          تعذر العثور على الصفحة أو السجل المطلوب. قد يكون الرابط غير صحيح أو تم نقل السجل.
        </p>
        <div className="pt-2 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] min-h-[44px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            العودة إلى الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
