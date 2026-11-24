'use client';

import React from 'react';
import { GuardedLink as Link } from './navigation-guard';
import { UserIdentityBadge } from './user-identity-badge';
import { HeaderNotificationsMenu } from './reminders/header-notifications-menu';

interface AppHeaderProps {
  onToggleDrawer: () => void;
  isDrawerOpen: boolean;
  drawerTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  user?: { name?: string; email?: string } | null;
  showNotifications?: boolean;
}

export function AppHeader({
  onToggleDrawer,
  isDrawerOpen,
  drawerTriggerRef,
  user,
  showNotifications = false,
}: AppHeaderProps) {
  return (
    <header
      role="banner"
      data-testid="app-header"
      className="relative z-20 bg-white border-b border-[#D5DFE3] px-[12px] sm:px-6 py-2 flex items-center justify-between gap-[8px] sm:gap-4 min-h-[64px] max-w-full overflow-visible"
    >
      <div className="flex flex-1 items-center gap-[8px] sm:gap-3 min-w-0">
        {/* Mobile / Tablet Drawer Toggle Button */}
        <button
          ref={drawerTriggerRef}
          type="button"
          aria-label="فتح القائمة"
          aria-expanded={isDrawerOpen}
          aria-controls="tablet-drawer"
          data-testid="drawer-toggle-button"
          onClick={onToggleDrawer}
          className="lg:hidden flex shrink-0 items-center justify-center w-[44px] h-[44px] rounded-[6px] border border-[#D5DFE3] text-[#172A35] hover:bg-[#E8EEF1] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 transition-colors"
        >
          <span className="sr-only">فتح القائمة</span>
          <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Office Branding — Stitch LO Monogram & Wordmark */}
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 text-[#14566B] hover:text-[#0F4354] focus:outline-none focus:ring-2 focus:ring-[#14566B] rounded-[6px] p-1"
        >
          <div
            className="w-8 h-8 shrink-0 rounded-[6px] bg-[#14566B] flex items-center justify-center text-white font-bold text-xs tracking-wider select-none"
            aria-hidden="true"
            dir="ltr"
          >
            LO
          </div>
          <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]" data-testid="office-wordmark">
            <span className="font-bold text-sm sm:text-base text-[#172A35] leading-tight">
              مكتب المحامي
            </span>
            <span className="text-[11px] text-[#4D606A] font-mono leading-tight tracking-tight mt-0.5" dir="ltr">
              LawOffice OS
            </span>
          </div>
        </Link>
      </div>

      <div className="flex min-w-0 max-w-[52%] sm:max-w-none items-center gap-1.5 sm:gap-2">
        <HeaderNotificationsMenu enabled={Boolean(showNotifications)} />
        <UserIdentityBadge user={user} />
      </div>
    </header>
  );
}
