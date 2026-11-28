'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { UserRole } from '@/modules/identity/types';
import { GuardedLink as Link, useCanLeavePage } from './navigation-guard';
import { usePathname } from 'next/navigation';
import { signOutAndReset } from '@/lib/auth-client';
import {
  IconCalendar,
  IconDashboard,
  IconDeadline,
  IconDocument,
  IconFolder,
  IconLogout,
  IconSearch,
  IconSettings,
  IconShield,
  IconTask,
  IconToday,
  IconUsers,
  IconWallet,
} from './stitch-icons';

interface TabletDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  userRole?: UserRole;
}

export function TabletDrawer({ isOpen, onClose, triggerRef, userRole }: TabletDrawerProps) {
  const pathname = usePathname();
  const canLeavePage = useCanLeavePage();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const isMaintainer = userRole === 'MAINTAINER';
  const prevPathnameRef = useRef(pathname);

  const handleClose = useCallback(() => {
    setLogoutError(null);
    setIsLoggingOut(false);
    onClose();
  }, [onClose]);
  const handleCloseRef = useRef(handleClose);

  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      if (isOpen) {
        handleCloseRef.current();
      }
    }
  }, [pathname, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = triggerRef?.current || (document.activeElement as HTMLElement | null);

    const frameId = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const restoreFocus = () => {
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

      const mainContent = document.getElementById('main-content');
      if (mainContent && typeof mainContent.focus === 'function') {
        mainContent.focus();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseRef.current();
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
  }, [isOpen, triggerRef]);

  if (!isOpen) return null;

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
  const isTodayActive = pathname === '/today' || pathname.startsWith('/today/');
  const isAgendaActive = pathname === '/agenda' || pathname.startsWith('/agenda/');
  const isTasksActive = pathname === '/tasks' || pathname.startsWith('/tasks/');
  const isDeadlinesActive = pathname === '/deadlines' || pathname.startsWith('/deadlines/');
  const isSearchActive = pathname === '/search' || pathname.startsWith('/search/');
  const isMattersActive = pathname === '/matters' || pathname.startsWith('/matters/');
  const isPartiesActive = pathname === '/parties' || pathname.startsWith('/parties/');
  const isDocumentsActive = pathname === '/documents' || pathname.startsWith('/documents/');
  const isFinanceActive = pathname === '/finance' || pathname.startsWith('/finance/');
  const isSecurityActive = pathname === '/settings/security';
  const isReferenceActive = pathname === '/settings/reference';

  const navItemClass = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-1 ${
      active
        ? 'bg-[#E9F2F5] text-[#14566B] border-r-4 border-[#14566B] font-bold rounded-l-[4px]'
        : 'text-[#4D606A] hover:bg-[#F4F6F7] hover:text-[#172A35] font-medium rounded-[4px]'
    }`;

  return (
    <div className="fixed inset-0 z-50 lg:hidden flex justify-start">
      <div
        data-testid="drawer-backdrop"
        aria-hidden="true"
        onClick={handleClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
      />

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
          <div className="flex items-center justify-between pb-4 border-b border-[#D5DFE3] mb-4">
            <div className="flex items-center gap-2.5">
              <span
                className="w-8 h-8 rounded-[6px] bg-[#14566B] flex items-center justify-center text-white font-bold text-xs tracking-wider select-none"
                aria-hidden="true"
                dir="ltr"
              >
                LO
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

          <nav aria-label="التنقل الرئيسي" className="flex flex-col gap-1.5">
            <Link
              href="/"
              data-testid="nav-link-home"
              aria-current={isHomeActive ? 'page' : undefined}
              onNavigate={handleClose}
              className={navItemClass(isHomeActive)}
            >
              <IconDashboard className="w-5 h-5 shrink-0" />
              <span>الرئيسية</span>
            </Link>

            {!isMaintainer && (
              <>
                <Link
                  href="/today"
                  data-testid="nav-link-today"
                  aria-current={isTodayActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isTodayActive)}
                >
                  <IconToday className="w-5 h-5 shrink-0" />
                  <span>أجندة اليوم</span>
                </Link>

                <Link
                  href="/agenda"
                  data-testid="nav-link-agenda"
                  aria-current={isAgendaActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isAgendaActive)}
                >
                  <IconCalendar className="w-5 h-5 shrink-0" />
                  <span>جدول الجلسات والأجندة</span>
                </Link>

                <Link
                  href="/tasks"
                  data-testid="nav-link-tasks"
                  aria-current={isTasksActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isTasksActive)}
                >
                  <IconTask className="w-5 h-5 shrink-0" />
                  <span>المهام الإجرائية</span>
                </Link>

                <Link
                  href="/deadlines"
                  data-testid="nav-link-deadlines"
                  aria-current={isDeadlinesActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isDeadlinesActive)}
                >
                  <IconDeadline className="w-5 h-5 shrink-0" />
                  <span>المواعيد القانونية</span>
                </Link>

                <Link
                  href="/matters"
                  data-testid="nav-link-matters"
                  aria-current={isMattersActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isMattersActive)}
                >
                  <IconFolder className="w-5 h-5 shrink-0" />
                  <span>ملفات القضايا</span>
                </Link>

                <Link
                  href="/parties"
                  data-testid="nav-link-parties"
                  aria-current={isPartiesActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isPartiesActive)}
                >
                  <IconUsers className="w-5 h-5 shrink-0" />
                  <span>دليل الأطراف</span>
                </Link>

                <Link
                  href="/documents"
                  data-testid="nav-link-documents"
                  aria-current={isDocumentsActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isDocumentsActive)}
                >
                  <IconDocument className="w-5 h-5 shrink-0" />
                  <span>المستندات</span>
                </Link>

                <Link
                  href="/finance"
                  data-testid="nav-link-finance"
                  aria-current={isFinanceActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isFinanceActive)}
                >
                  <IconWallet className="w-5 h-5 shrink-0" />
                  <span>الحسابات</span>
                </Link>

                <Link
                  href="/settings/security"
                  data-testid="nav-link-security"
                  aria-current={isSecurityActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isSecurityActive)}
                >
                  <IconShield className="w-5 h-5 shrink-0" />
                  <span>إعدادات الأمان</span>
                </Link>

                <Link
                  href="/search"
                  data-testid="nav-link-search"
                  aria-current={isSearchActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isSearchActive)}
                >
                  <IconSearch className="w-5 h-5 shrink-0" />
                  <span>البحث الموحد</span>
                </Link>

                <Link
                  href="/settings/reference"
                  data-testid="nav-link-reference"
                  aria-current={isReferenceActive ? 'page' : undefined}
                  onNavigate={handleClose}
                  className={navItemClass(isReferenceActive)}
                >
                  <IconSettings className="w-5 h-5 shrink-0" />
                  <span>إعدادات المراجع</span>
                </Link>
              </>
            )}
          </nav>
        </div>

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
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[4px] text-sm font-medium text-[#A4262C] hover:bg-red-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#A4262C] focus:ring-offset-1 transition-colors min-h-[44px]"
          >
            <IconLogout className="w-5 h-5 shrink-0" />
            <span>{isLoggingOut ? 'جارٍ تسجيل الخروج...' : 'تسجيل الخروج'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
