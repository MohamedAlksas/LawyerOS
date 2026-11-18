'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

interface TabletDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export function TabletDrawer({ isOpen, onClose, triggerRef }: TabletDrawerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setLogoutError(null);
    setIsLoggingOut(false);
    onClose();
  }, [onClose]);

  // Focus trap & Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    // Save previous active element to restore focus on close
    const previouslyFocused = triggerRef?.current || (document.activeElement as HTMLElement | null);

    // Focus close button initially via animation frame without arbitrary timeout
    const frameId = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const restoreFocus = () => {
      // Attempt restoring focus to trigger or previous active element if visible and focusable
      const target = triggerRef?.current || previouslyFocused;
      if (target && typeof target.focus === 'function') {
        const isVisible =
          target.offsetWidth > 0 ||
          target.offsetHeight > 0 ||
          target.getClientRects().length > 0;
        if (isVisible) {
          target.focus();
          if (document.activeElement === target) {
            return;
          }
        }
      }

      // Safe fallback to main content if trigger button is hidden or unfocused on desktop
      const mainContent = document.getElementById('main-content');
      if (mainContent && typeof mainContent.focus === 'function') {
        mainContent.focus();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        restoreFocus();
        return;
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !drawerRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement || !drawerRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      restoreFocus();
    };
  }, [isOpen, handleClose, triggerRef]);

  if (!isOpen) return null;

  const handleLogout = async () => {
    if (isLoggingOut) return;
    if (!window.confirm('هل ترغب في تسجيل الخروج من هذا الجهاز؟')) {
      return;
    }
    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      const res = await signOut();
      if (res?.error) {
        setLogoutError('فشل تسجيل الخروج من الخادم. جلستك الحالية ما زالت نشطة، يرجى التحقق من الاتصال والمحاولة مجدداً.');
        setIsLoggingOut(false);
        return;
      }
      onClose();
      router.push('/login');
    } catch {
      setLogoutError('فشل تسجيل الخروج من الخادم. جلستك الحالية ما زالت نشطة، يرجى المحاولة مجدداً.');
      setIsLoggingOut(false);
    }
  };

  const isHomeActive = pathname === '/';
  const isMattersActive = pathname === '/matters' || pathname.startsWith('/matters/');
  const isPartiesActive = pathname === '/parties' || pathname.startsWith('/parties/');
  const isSecurityActive = pathname === '/settings/security';
  const isReferenceActive = pathname === '/settings/reference';

  return (
    <div className="fixed inset-0 z-50 lg:hidden flex justify-end">
      {/* Backdrop */}
      <div
        data-testid="drawer-backdrop"
        aria-hidden="true"
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
      />

      {/* Drawer Dialog */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="قائمة التنقل"
        id="tablet-drawer"
        data-testid="tablet-drawer"
        className="relative w-full max-w-xs sm:w-80 bg-white h-full shadow-2xl z-10 flex flex-col justify-between p-4 overflow-y-auto"
      >
        <div>
          {/* Drawer Header */}
          <div className="flex items-center justify-between pb-4 border-b border-[#D5DFE3] mb-4">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-[6px] bg-[#14566B] flex items-center justify-center text-white font-bold text-sm select-none" aria-hidden="true">
                ⚖️
              </span>
              <span className="font-bold text-base text-[#172A35]">قائمة التنقل</span>
            </div>

            <button
              ref={closeButtonRef}
              type="button"
              aria-label="إغلاق القائمة"
              data-testid="drawer-close-button"
              onClick={handleClose}
              className="flex items-center justify-center w-11 h-11 rounded-[6px] border border-[#D5DFE3] text-[#172A35] hover:bg-[#E8EEF1] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px] transition-colors"
            >
              <span className="sr-only">إغلاق القائمة</span>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation Links */}
          <nav aria-label="التنقل الرئيسي" className="flex flex-col gap-2">
            <Link
              href="/"
              data-testid="nav-link-home"
              aria-current={isHomeActive ? 'page' : undefined}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
                isHomeActive
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span aria-hidden="true" className="text-base">📅</span>
              <span>الرئيسية / اليوم</span>
            </Link>

            <Link
              href="/matters"
              data-testid="nav-link-matters"
              aria-current={isMattersActive ? 'page' : undefined}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
                isMattersActive
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span aria-hidden="true" className="text-base">📁</span>
              <span>ملفات القضايا</span>
            </Link>

            <Link
              href="/parties"
              data-testid="nav-link-parties"
              aria-current={isPartiesActive ? 'page' : undefined}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
                isPartiesActive
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span aria-hidden="true" className="text-base">👥</span>
              <span>دليل الأطراف</span>
            </Link>

            <Link
              href="/settings/security"
              data-testid="nav-link-security"
              aria-current={isSecurityActive ? 'page' : undefined}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
                isSecurityActive
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span aria-hidden="true" className="text-base">🛡️</span>
              <span>إعدادات الأمان</span>
            </Link>

            <Link
              href="/settings/reference"
              data-testid="nav-link-reference"
              aria-current={isReferenceActive ? 'page' : undefined}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-sm font-medium transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 ${
                isReferenceActive
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span aria-hidden="true" className="text-base">⚙️</span>
              <span>إعدادات المراجع</span>
            </Link>

            {/* Future Modules */}
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

        {/* Drawer Footer / Logout */}
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
      </div>
    </div>
  );
}
