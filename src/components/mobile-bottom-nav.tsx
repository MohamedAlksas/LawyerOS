'use client';

import React from 'react';
import type { UserRole } from '@/modules/identity/types';
import { GuardedLink as Link } from './navigation-guard';
import { usePathname } from 'next/navigation';
import { IconDashboard, IconFolder, IconSearch, IconShield, IconUsers } from './stitch-icons';

interface MobileBottomNavProps {
  navRef: React.Ref<HTMLElement>;
  isDrawerOpen: boolean;
  onOpenDrawer: (opener: HTMLButtonElement) => void;
  userRole?: UserRole;
}

export function MobileBottomNav({ navRef, isDrawerOpen, onOpenDrawer, userRole }: MobileBottomNavProps) {
  const pathname = usePathname();
  const isMaintainer = userRole === 'MAINTAINER';

  const isHomeActive = pathname === '/';
  const isSearchActive = pathname === '/search' || pathname.startsWith('/search/');
  const isMattersActive = pathname === '/matters' || pathname.startsWith('/matters/');
  const isPartiesActive = pathname === '/parties' || pathname.startsWith('/parties/');
  const isSecurityActive = pathname === '/settings/security';

  return (
    <nav
      ref={navRef}
      role="navigation"
      aria-label="التنقل السفلي"
      data-testid="mobile-bottom-nav"
      className="sm:hidden fixed bottom-0 inset-x-0 min-h-16 bg-white border-t border-[#D5DFE3] z-30 flex flex-wrap items-stretch px-[8px] shadow-lg"
    >
      <Link
        href="/"
        data-testid="nav-link-home"
        aria-label="الرئيسية"
        aria-current={isHomeActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isHomeActive ? 'text-[#14566B] font-bold bg-[#E9F2F5]/60' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <IconDashboard className="w-5 h-5" />
        <span className="text-xs leading-tight mt-0.5">الرئيسية</span>
      </Link>

      {!isMaintainer && (
        <>
          <Link
            href="/search"
            data-testid="nav-link-search-mobile"
            aria-label="البحث"
            aria-current={isSearchActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
              isSearchActive ? 'text-[#14566B] font-bold bg-[#E9F2F5]/60' : 'text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            <IconSearch className="w-5 h-5" />
            <span className="text-xs leading-tight mt-0.5">البحث</span>
          </Link>

          <Link
            href="/matters"
            data-testid="nav-link-matters"
            aria-label="الملفات القضائية"
            aria-current={isMattersActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
              isMattersActive ? 'text-[#14566B] font-bold bg-[#E9F2F5]/60' : 'text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            <IconFolder className="w-5 h-5" />
            <span className="text-xs leading-tight mt-0.5">الملفات</span>
          </Link>

          <Link
            href="/parties"
            data-testid="nav-link-parties"
            aria-label="الأطراف"
            aria-current={isPartiesActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
              isPartiesActive ? 'text-[#14566B] font-bold bg-[#E9F2F5]/60' : 'text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            <IconUsers className="w-5 h-5" />
            <span className="text-xs leading-tight mt-0.5">الأطراف</span>
          </Link>

          <Link
            href="/settings/security"
            data-testid="nav-link-security"
            aria-label="إعدادات الأمان"
            aria-current={isSecurityActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
              isSecurityActive ? 'text-[#14566B] font-bold bg-[#E9F2F5]/60' : 'text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            <IconShield className="w-5 h-5" />
            <span className="text-xs leading-tight mt-0.5">الأمان</span>
          </Link>
        </>
      )}

      <button
        type="button"
        aria-label="المزيد: فتح القائمة الكاملة"
        aria-expanded={isDrawerOpen}
        aria-controls="tablet-drawer"
        data-testid="mobile-nav-menu"
        onClick={(event) => onOpenDrawer(event.currentTarget)}
        className="flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] text-[#4D606A] hover:text-[#172A35] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B]"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="text-xs leading-tight mt-0.5">المزيد</span>
      </button>
    </nav>
  );
}
