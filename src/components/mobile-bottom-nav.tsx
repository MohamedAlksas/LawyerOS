'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface MobileBottomNavProps {
  onOpenDrawer: () => void;
}

export function MobileBottomNav({ onOpenDrawer }: MobileBottomNavProps) {
  const pathname = usePathname();

  const isHomeActive = pathname === '/';
  const isMattersActive = pathname === '/matters' || pathname.startsWith('/matters/');
  const isPartiesActive = pathname === '/parties' || pathname.startsWith('/parties/');
  const isSecurityActive = pathname === '/settings/security';

  return (
    <nav
      role="navigation"
      aria-label="التنقل السفلي"
      data-testid="mobile-bottom-nav"
      className="sm:hidden fixed bottom-0 inset-x-0 h-16 bg-white border-t border-[#D5DFE3] z-30 flex items-center justify-around px-2 shadow-lg"
    >
      {/* Home Link */}
      <Link
        href="/"
        data-testid="nav-link-home"
        aria-label="الرئيسية"
        aria-current={isHomeActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-1 py-1 min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isHomeActive ? 'text-[#14566B] font-bold' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <span aria-hidden="true" className="text-lg">📅</span>
        <span className="text-xs leading-tight mt-0.5">الرئيسية</span>
      </Link>

      {/* Matters Link */}
      <Link
        href="/matters"
        data-testid="nav-link-matters"
        aria-label="ملفات القضايا"
        aria-current={isMattersActive ? 'page' : undefined}
        className={`flex flex-col items-center justify-center flex-1 py-1 min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
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
        className={`flex flex-col items-center justify-center flex-1 py-1 min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
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
        className={`flex flex-col items-center justify-center flex-1 py-1 min-h-[44px] min-w-[44px] rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
          isSecurityActive ? 'text-[#14566B] font-bold' : 'text-[#4D606A] hover:text-[#172A35]'
        }`}
      >
        <span aria-hidden="true" className="text-lg">🛡️</span>
        <span className="text-xs leading-tight mt-0.5">الأمان</span>
      </Link>

      {/* Menu / Drawer Toggle */}
      <button
        type="button"
        aria-label="فتح القائمة الكاملة"
        data-testid="mobile-nav-menu"
        onClick={onOpenDrawer}
        className="flex flex-col items-center justify-center flex-1 py-1 min-h-[44px] min-w-[44px] rounded-[6px] text-[#4D606A] hover:text-[#172A35] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B]"
      >
        <span aria-hidden="true" className="text-lg">☰</span>
        <span className="text-xs leading-tight mt-0.5">المزيد</span>
      </button>
    </nav>
  );
}
