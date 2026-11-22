'use client';

import React, { useState } from 'react';
import { GuardedLink as Link, useCanLeavePage } from './navigation-guard';
import { usePathname } from 'next/navigation';
import { signOutAndReset } from '@/lib/auth-client';

export function DesktopSidebar() {
  const pathname = usePathname();
  const canLeavePage = useCanLeavePage();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleLogout = async () => {
    if (isLoggingOut || !canLeavePage()) return;
    if (!window.confirm('هل ترغب في تسجيل الخروج من هذا الجهاز؟')) {
      return;
    }
    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      const res = await signOutAndReset();
      if (res?.error) {
        setLogoutError('فشل تسجيل الخروج من الخادم. جلستك الحالية ما زالت نشطة، يرجى التحقق من الاتصال والمحاولة مجدداً.');
        setIsLoggingOut(false);
        return;
      }
    } catch {
      setLogoutError('فشل تسجيل الخروج من الخادم. جلستك الحالية ما زالت نشطة، يرجى المحاولة مجدداً.');
      setIsLoggingOut(false);
    }
  };

  const isHomeActive = pathname === '/';
  const isSearchActive = pathname === '/search' || pathname.startsWith('/search');
  const isMattersActive = pathname === '/matters' || pathname.startsWith('/matters/');
  const isPartiesActive = pathname === '/parties' || pathname.startsWith('/parties/');
  const isSecurityActive = pathname === '/settings/security';
  const isReferenceActive = pathname === '/settings/reference';

  return (
    <aside
      role="navigation"
      aria-label="التنقل الرئيسي"
      data-testid="desktop-sidebar"
      className="hidden lg:flex flex-col justify-between w-[232px] shrink-0 fixed top-14 right-0 bottom-0 bg-white border-l border-[#D5DFE3] p-4 select-none z-10"
    >
      <div className="space-y-6">
        <nav aria-label="التنقل الرئيسي" data-testid="desktop-nav" className="flex flex-col gap-1.5">
          {/* Home / Today */}
          <Link
            href="/"
            data-testid="nav-link-home"
            aria-current={isHomeActive ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
              isHomeActive
                ? 'bg-[#14566B] text-white shadow-xs'
                : 'text-[#172A35] hover:bg-[#E8EEF1]'
            }`}
          >
            <span aria-hidden="true" className="text-base">📅</span>
            <span>الرئيسية / اليوم</span>
          </Link>

          {/* Matters Directory */}
          <Link
            href="/matters"
            data-testid="nav-link-matters"
            aria-current={isMattersActive ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
              isMattersActive
                ? 'bg-[#14566B] text-white shadow-xs'
                : 'text-[#172A35] hover:bg-[#E8EEF1]'
            }`}
          >
            <span aria-hidden="true" className="text-base">📁</span>
            <span>ملفات القضايا</span>
          </Link>

          {/* Parties Directory */}
          <Link
            href="/parties"
            data-testid="nav-link-parties"
            aria-current={isPartiesActive ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
              isPartiesActive
                ? 'bg-[#14566B] text-white shadow-xs'
                : 'text-[#172A35] hover:bg-[#E8EEF1]'
            }`}
          >
            <span aria-hidden="true" className="text-base">👥</span>
            <span>دليل الأطراف</span>
          </Link>

          {/* Security Settings */}
          <Link
            href="/settings/security"
            data-testid="nav-link-security"
            aria-current={isSecurityActive ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
              isSecurityActive
                ? 'bg-[#14566B] text-white shadow-xs'
                : 'text-[#172A35] hover:bg-[#E8EEF1]'
            }`}
          >
            <span aria-hidden="true" className="text-base">🛡️</span>
            <span>إعدادات الأمان</span>
          </Link>

          {/* Unified Search */}
          <Link
            href="/search"
            data-testid="nav-link-search"
            aria-current={isSearchActive ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
              isSearchActive
                ? 'bg-[#14566B] text-white shadow-xs'
                : 'text-[#172A35] hover:bg-[#E8EEF1]'
            }`}
          >
            <span aria-hidden="true" className="text-base">🔍</span>
            <span>البحث الموحد</span>
          </Link>

          {/* Reference Settings */}
          <Link
            href="/settings/reference"
            data-testid="nav-link-reference"
            aria-current={isReferenceActive ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
              isReferenceActive
                ? 'bg-[#14566B] text-white shadow-xs'
                : 'text-[#172A35] hover:bg-[#E8EEF1]'
            }`}
          >
            <span aria-hidden="true" className="text-base">⚙️</span>
            <span>إعدادات المراجع</span>
          </Link>

          {/* Future Modules Indicator Section (Contract 2.2: strictly non-interactive, no fake metrics) */}
          <div className="pt-4 mt-2 border-t border-[#D5DFE3]">
            <span className="block px-3 text-xs font-semibold text-[#4D606A] mb-2">
              الوحدات القادمة
            </span>
            <div className="space-y-1">
              <div
                aria-disabled="true"
                className="flex items-center justify-between px-3 py-2 rounded-[6px] text-xs font-medium text-[#4D606A] bg-[#F4F6F7] opacity-75 cursor-not-allowed select-none min-h-[40px]"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">⚖️</span>
                  <span>الجلسات والنتائج</span>
                </div>
                <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">قريباً</span>
              </div>

              <div
                aria-disabled="true"
                className="flex items-center justify-between px-3 py-2 rounded-[6px] text-xs font-medium text-[#4D606A] bg-[#F4F6F7] opacity-75 cursor-not-allowed select-none min-h-[40px]"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">💰</span>
                  <span>حسابات الموكلين</span>
                </div>
                <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">قريباً</span>
              </div>
            </div>
          </div>
        </nav>
      </div>

      {/* Logout Action */}
      <div className="pt-4 border-t border-[#D5DFE3] space-y-2">
        {logoutError && (
          <div
            role="alert"
            data-testid="logout-error-alert"
            className="p-2 text-xs text-[#A4262C] bg-red-50 border border-red-200 rounded leading-snug"
          >
            {logoutError}
          </div>
        )}
        <button
          type="button"
          data-testid="nav-button-logout"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-busy={isLoggingOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium text-[#A4262C] hover:bg-red-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#A4262C] focus:ring-offset-2 transition-colors min-h-[44px]"
        >
          <span aria-hidden="true" className="text-base">🚪</span>
          <span>{isLoggingOut ? 'جارٍ تسجيل الخروج...' : 'تسجيل الخروج'}</span>
        </button>
      </div>
    </aside>
  );
}
