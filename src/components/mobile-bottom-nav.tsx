'use client';

import React from 'react';
import { GuardedLink as Link } from './navigation-guard';
import { usePathname } from 'next/navigation';

interface MobileBottomNavProps {
  navRef: React.Ref<HTMLElement>;
  onOpenDrawer: (opener: HTMLButtonElement) => void;
}

export function MobileBottomNav({ navRef, onOpenDrawer }: MobileBottomNavProps) {
  const pathname = usePathname();

  const isHomeActive = pathname === '/';
  const isSearchActive = pathname === '/search' || pathname.startsWith('/search');
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
      {/* Home Link */}
      <Link
        href="/"
        data-testid="nav-link-home"
        aria-label="الرئيسية"
        aria-current={isHomeActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isHomeActive ? 'text-[#14566B] font-bold' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <span aria-hidden="true" className="text-lg">📅</span>
        <span className="text-xs leading-tight mt-0.5">الرئيسية</span>
      </Link>

      {/* Search Link */}
      <Link
        href="/search"
        data-testid="nav-link-search-mobile"
        aria-label="البحث"
        aria-current={isSearchActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isSearchActive ? 'text-[#14566B] font-bold' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <span aria-hidden="true" className="text-lg">🔍</span>
        <span className="text-xs leading-tight mt-0.5">البحث</span>
      </Link>

      {/* Matters Link */}
      <Link
        href="/matters"
        data-testid="nav-link-matters"
        aria-label="الملفات القضائية"
        aria-current={isMattersActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isMattersActive ? 'text-[#14566B] font-bold' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <span aria-hidden="true" className="text-lg">📁</span>
        <span className="text-xs leading-tight mt-0.5">الملفات</span>
      </Link>

      {/* Parties Link */}
      <Link
        href="/parties"
        data-testid="nav-link-parties"
        aria-label="الأطراف"
        aria-current={isPartiesActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isPartiesActive ? 'text-[#14566B] font-bold' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <span aria-hidden="true" className="text-lg">👥</span>
        <span className="text-xs leading-tight mt-0.5">الأطراف</span>
      </Link>

      {/* Security Link */}
      <Link
        href="/settings/security"
        data-testid="nav-link-security"
        aria-label="إعدادات الأمان"
        aria-current={isSecurityActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isSecurityActive ? 'text-[#14566B] font-bold' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <span aria-hidden="true" className="text-lg">🛡️</span>
        <span className="text-xs leading-tight mt-0.5">الأمان</span>
      </Link>

      {/* Menu / Drawer Toggle */}
      <button
        type="button"
        aria-label="المزيد: فتح القائمة الكاملة"
        data-testid="mobile-nav-menu"
        onClick={(event) => onOpenDrawer(event.currentTarget)}
        className="flex flex-col items-center justify-center flex-[1_0_auto] py-1 px-[4px] min-h-[44px] min-w-[44px] rounded-[6px] text-[#4D606A] hover:text-[#172A35] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B]"
      >
        <span aria-hidden="true" className="text-lg">☰</span>
        <span className="text-xs leading-tight mt-0.5">المزيد</span>
      </button>
    </nav>
  );
}
