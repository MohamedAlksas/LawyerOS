'use client';

import React, { useState } from 'react';
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

export function DesktopSidebar({ userRole }: { userRole?: UserRole }) {
  const pathname = usePathname();
  const canLeavePage = useCanLeavePage();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const isMaintainer = userRole === 'MAINTAINER';

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
  const isSecurityActive = pathname === '/settings/security';
  const isReferenceActive = pathname === '/settings/reference';

  const navItemClass = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-1 ${
      active
        ? 'bg-[#E9F2F5] text-[#14566B] border-r-4 border-[#14566B] font-bold rounded-l-[4px]'
        : 'text-[#4D606A] hover:bg-[#F4F6F7] hover:text-[#172A35] font-medium rounded-[4px]'
    }`;

  return (
    <aside
      data-testid="desktop-sidebar"
      className="hidden lg:flex flex-col justify-between w-[232px] shrink-0 fixed top-[var(--shell-top-height,4rem)] right-0 bottom-0 overflow-y-auto bg-white border-l border-[#D5DFE3] select-none z-10"
    >
      <div className="p-3 space-y-5">
        <nav aria-label="التنقل الرئيسي" data-testid="desktop-nav" className="flex flex-col gap-1">
          <Link
            href="/"
            data-testid="nav-link-home"
            aria-current={isHomeActive ? 'page' : undefined}
            className={navItemClass(isHomeActive)}
          >
            <IconDashboard className={`w-5 h-5 shrink-0 ${isHomeActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
            <span>الرئيسية</span>
          </Link>

          {!isMaintainer && (
            <>
              <Link
                href="/today"
                data-testid="nav-link-today"
                aria-current={isTodayActive ? 'page' : undefined}
                className={navItemClass(isTodayActive)}
              >
                <IconToday className={`w-5 h-5 shrink-0 ${isTodayActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>أجندة اليوم</span>
              </Link>

              <Link
                href="/agenda"
                data-testid="nav-link-agenda"
                aria-current={isAgendaActive ? 'page' : undefined}
                className={navItemClass(isAgendaActive)}
              >
                <IconCalendar className={`w-5 h-5 shrink-0 ${isAgendaActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>جدول الجلسات والأجندة</span>
              </Link>

              <Link
                href="/tasks"
                data-testid="nav-link-tasks"
                aria-current={isTasksActive ? 'page' : undefined}
                className={navItemClass(isTasksActive)}
              >
                <IconTask className={`w-5 h-5 shrink-0 ${isTasksActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>المهام الإجرائية</span>
              </Link>

              <Link
                href="/deadlines"
                data-testid="nav-link-deadlines"
                aria-current={isDeadlinesActive ? 'page' : undefined}
                className={navItemClass(isDeadlinesActive)}
              >
                <IconDeadline className={`w-5 h-5 shrink-0 ${isDeadlinesActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>المواعيد القانونية</span>
              </Link>

              <Link
                href="/matters"
                data-testid="nav-link-matters"
                aria-current={isMattersActive ? 'page' : undefined}
                className={navItemClass(isMattersActive)}
              >
                <IconFolder className={`w-5 h-5 shrink-0 ${isMattersActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>ملفات القضايا</span>
              </Link>

              <Link
                href="/parties"
                data-testid="nav-link-parties"
                aria-current={isPartiesActive ? 'page' : undefined}
                className={navItemClass(isPartiesActive)}
              >
                <IconUsers className={`w-5 h-5 shrink-0 ${isPartiesActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>دليل الأطراف</span>
              </Link>

              <Link
                href="/documents"
                data-testid="nav-link-documents"
                aria-current={isDocumentsActive ? 'page' : undefined}
                className={navItemClass(isDocumentsActive)}
              >
                <IconDocument className={`w-5 h-5 shrink-0 ${isDocumentsActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>المستندات</span>
              </Link>

              <Link
                href="/settings/security"
                data-testid="nav-link-security"
                aria-current={isSecurityActive ? 'page' : undefined}
                className={navItemClass(isSecurityActive)}
              >
                <IconShield className={`w-5 h-5 shrink-0 ${isSecurityActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>إعدادات الأمان</span>
              </Link>

              <Link
                href="/search"
                data-testid="nav-link-search"
                aria-current={isSearchActive ? 'page' : undefined}
                className={navItemClass(isSearchActive)}
              >
                <IconSearch className={`w-5 h-5 shrink-0 ${isSearchActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>البحث الموحد</span>
              </Link>

              <Link
                href="/settings/reference"
                data-testid="nav-link-reference"
                aria-current={isReferenceActive ? 'page' : undefined}
                className={navItemClass(isReferenceActive)}
              >
                <IconSettings className={`w-5 h-5 shrink-0 ${isReferenceActive ? 'text-[#14566B]' : 'text-[#4D606A]'}`} />
                <span>إعدادات المراجع</span>
              </Link>
            </>
          )}

          {/* Future Modules Indicator Section */}
          <div className="pt-3 mt-2 border-t border-[#D5DFE3]">
            <span className="block px-3 text-xs font-semibold text-[#4D606A] mb-1.5">
              الوحدات القادمة
            </span>
            <div className="space-y-1">
              <div
                className="flex items-center justify-between px-3 py-2 rounded-[4px] text-xs font-medium text-[#4D606A] bg-[#F8FAFB] border border-[#E5ECEE] opacity-80 cursor-not-allowed select-none min-h-[40px]"
              >
                <div className="flex items-center gap-2">
                  <IconWallet className="w-4 h-4 text-[#4D606A]" />
                  <span>حسابات الموكلين</span>
                </div>
                <span className="text-[10px] bg-[#E9F2F5] text-[#14566B] border border-[#C2D9E2] px-1.5 py-0.5 rounded font-semibold">
                  قريباً
                </span>
              </div>
            </div>
          </div>
        </nav>
      </div>

      {/* Stitch Sidebar Footer / Practitioner Indicator & Logout */}
      <div className="p-3 border-t border-[#D5DFE3] bg-[#F8FAFB] space-y-2">
        <div className="flex items-center justify-between text-xs text-[#4D606A] px-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#14566B]" aria-hidden="true" />
            <span>يتطلب الاتصال بالنظام</span>
          </span>
        </div>
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
    </aside>
  );
}
