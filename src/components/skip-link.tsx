import React from 'react';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      data-testid="skip-to-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#14566B] focus:text-white focus:rounded-[6px] focus:shadow-md focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] inline-flex items-center text-sm font-medium"
    >
      تجاوز إلى المحتوى الرئيسي
    </a>
  );
}
