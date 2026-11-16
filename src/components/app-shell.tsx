'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { ConnectivityBanner } from './connectivity-banner';
import { SkipLink } from './skip-link';
import { AppHeader } from './app-header';
import { DesktopSidebar } from './desktop-sidebar';
import { TabletDrawer } from './tablet-drawer';
import { MobileBottomNav } from './mobile-bottom-nav';
import { SessionExpiredAlert } from './session-expired-alert';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Safely register public-only service worker
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Silently ignore if worker registration is disallowed by sandbox/context
      });
    }
  }, []);

  // For public auth and offline pages, omit the operational navigation shell
  const isPublicAuthPage =
    pathname.startsWith('/login') ||
    pathname.startsWith('/verify') ||
    pathname.startsWith('/offline');

  if (isPublicAuthPage) {
    return (
      <>
        <Suspense fallback={null}>
          <SessionExpiredAlert />
        </Suspense>
        <ConnectivityBanner />
        {children}
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F6F7] text-[#172A35]">
      {/* 1. Skip to Content Link */}
      <SkipLink />

      {/* 2. Disconnected Banner */}
      <ConnectivityBanner />

      {/* 3. Session Expiry Feedback if triggered */}
      <Suspense fallback={null}>
        <SessionExpiredAlert />
      </Suspense>

      {/* 4. Accessible Header */}
      <AppHeader
        onToggleDrawer={() => setIsDrawerOpen((prev) => !prev)}
        isDrawerOpen={isDrawerOpen}
        drawerTriggerRef={triggerRef}
      />

      {/* 5. Desktop Body: Sidebar + Main Content */}
      <div className="flex-1 flex flex-row">
        {/* Right Desktop Sidebar (232px) */}
        <DesktopSidebar />

        {/* Primary Main Landmark */}
        <main
          id="main-content"
          role="main"
          data-testid="main-content"
          className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 pb-20 sm:pb-8 overflow-x-hidden"
        >
          {children}
        </main>
      </div>

      {/* 6. Accessible Tablet/Mobile Drawer Modal */}
      <TabletDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        triggerRef={triggerRef}
      />

      {/* 7. Mobile Bottom Nav Bar */}
      <MobileBottomNav
        onOpenDrawer={() => setIsDrawerOpen(true)}
      />
    </div>
  );
}
