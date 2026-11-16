'use client';

import React from 'react';
import Link from 'next/link';
import { UserIdentityBadge } from './user-identity-badge';

interface AppHeaderProps {
  onToggleDrawer: () => void;
  isDrawerOpen: boolean;
  drawerTriggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export function AppHeader({ onToggleDrawer, isDrawerOpen, drawerTriggerRef }: AppHeaderProps) {
  return (
    <header
      role="banner"
      data-testid="app-header"
      className="sticky top-0 z-20 bg-white border-b border-[#D5DFE3] px-4 py-2.5 flex items-center justify-between gap-3 shadow-xs min-h-[56px]"
    >
      <div className="flex items-center gap-3">
        {/* Mobile / Tablet Drawer Toggle Button */}
        <button
          ref={drawerTriggerRef}
          type="button"
          aria-label="فتح القائمة"
          aria-expanded={isDrawerOpen}
          aria-controls="tablet-drawer"
          data-testid="drawer-toggle-button"
          onClick={onToggleDrawer}
          className="lg:hidden flex items-center justify-center w-11 h-11 rounded-[6px] border border-[#D5DFE3] text-[#172A35] hover:bg-[#E8EEF1] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px] transition-colors"
        >
          <span className="sr-only">فتح القائمة</span>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Office Branding */}
        <Link
          href="/"
          className="flex items-center gap-2 text-[#14566B] hover:text-[#0F4354] focus:outline-none focus:ring-2 focus:ring-[#14566B] rounded-[6px] p-1"
        >
          <div className="w-8 h-8 rounded-[6px] bg-[#14566B] flex items-center justify-center text-white font-bold text-sm select-none" aria-hidden="true">
            ⚖️
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-base sm:text-lg text-[#172A35] leading-tight">
              مكتب المحامي
            </span>
            <span className="text-[11px] text-[#4D606A] font-medium leading-tight tracking-wider" dir="ltr">
              LawOffice OS
            </span>
          </div>
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <UserIdentityBadge />
      </div>
    </header>
  );
}
