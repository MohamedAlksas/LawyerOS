'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useTransition, Suspense } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { clearSearchSessionStore } from '@/lib/search-session-store';
import type { UserRole } from '@/modules/identity/types';
import { ConnectivityBanner } from './connectivity-banner';
import { SkipLink } from './skip-link';
import { AppHeader } from './app-header';
import { DesktopSidebar } from './desktop-sidebar';
import { TabletDrawer } from './tablet-drawer';
import { MobileBottomNav } from './mobile-bottom-nav';
import { SessionExpiredAlert } from './session-expired-alert';
import { NavigationGuardProvider } from './navigation-guard';

interface AppShellProps {
  children: React.ReactNode;
}

type ViewSession = { actorId: string; sessionId: string; role: UserRole; name?: string; email?: string };

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'checking' | 'ready' | 'expired' | 'unavailable'>('checking');
  const [viewUser, setViewUser] = useState<{ name?: string; email?: string; role?: UserRole } | null>(null);
  const [refreshingSession, startSessionRefresh] = useTransition();
  const privateViewRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const sessionRef = useRef<ViewSession | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerOpenerRef = useRef<HTMLButtonElement | null>(null);

  // Safely register public-only service worker
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Silently ignore if worker registration is disallowed by sandbox/context
      });
    }
  }, []);

  // Reset drawer state when crossing into desktop breakpoint (>= 1024px)
  // to prevent hidden drawer leaving #app-shell-content permanently inert/aria-hidden (T04-R2-02)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleBreakpointChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setIsDrawerOpen(false);
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleBreakpointChange);
      return () => mediaQuery.removeEventListener('change', handleBreakpointChange);
    } else {
      mediaQuery.addListener(handleBreakpointChange);
      return () => mediaQuery.removeListener(handleBreakpointChange);
    }
  }, []);

  // For public auth and offline pages, omit the operational navigation shell
  const isPublicAuthPage =
    pathname.startsWith('/login') ||
    pathname.startsWith('/verify') ||
    pathname.startsWith('/offline');

  useLayoutEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return;

    const rootStyle = document.documentElement.style;
    const reserveSpace = () => rootStyle.setProperty('--mobile-nav-height', `${nav.offsetHeight}px`);
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(nav);
    return () => {
      observer.disconnect();
      rootStyle.removeProperty('--mobile-nav-height');
    };
  }, [isPublicAuthPage]);

  useLayoutEffect(() => {
    const topBar = topBarRef.current;
    if (!topBar) return;

    const rootStyle = document.documentElement.style;
    const reserveTop = () => rootStyle.setProperty('--shell-top-height', `${topBar.offsetHeight}px`);
    reserveTop();
    const observer = new ResizeObserver(reserveTop);
    observer.observe(topBar);
    return () => {
      observer.disconnect();
      rootStyle.removeProperty('--shell-top-height');
    };
  }, [isPublicAuthPage, sessionStatus]);

  useLayoutEffect(() => {
    // A return from the public auth screens needs a new check before the private shell paints.
    if (!isPublicAuthPage && privateViewRef.current) privateViewRef.current.hidden = true;
  }, [isPublicAuthPage]);

  useEffect(() => {
    if (isPublicAuthPage) return;

    let pending: AbortController | undefined;
    const conceal = () => {
      pending?.abort();
      pending = undefined;
      // Conceal synchronously so a browser's history snapshot cannot paint private content on resume.
      if (privateViewRef.current) privateViewRef.current.hidden = true;
      setSessionStatus('checking');
    };
    const checkSession = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      const request = new AbortController();
      pending = request;
      const timeout = window.setTimeout(() => {
        if (pending !== request) return;
        conceal();
        setSessionStatus('unavailable');
      }, 5_000);

      try {
        const response = await fetch('/api/auth/view-session', { cache: 'no-store', signal: request.signal });
        if (request.signal.aborted) return;
        if (response.status === 401) {
          clearSearchSessionStore();
          setViewUser(null);
          conceal();
          setSessionStatus('expired');
          return;
        }
        if (!response.ok) throw new Error('Session check unavailable');
        const session: ViewSession = await response.json();
        if (request.signal.aborted) return;
        setViewUser({ name: session.name, email: session.email, role: session.role });
        const previous = sessionRef.current;
        sessionRef.current = session;
        if (previous && (previous.actorId !== session.actorId || previous.role !== session.role || previous.sessionId !== session.sessionId)) {
          clearSearchSessionStore();
          conceal();
          if (previous.actorId !== session.actorId || previous.role !== session.role) {
            window.location.reload();
            return;
          }
          // Update session-scoped Server Component props while keeping same-actor drafts mounted.
          startSessionRefresh(() => {
            router.refresh();
            setSessionStatus('ready');
          });
          return;
        }
        if (privateViewRef.current) privateViewRef.current.hidden = false;
        setSessionStatus('ready');
      } catch {
        if (request.signal.aborted) return;
        conceal();
        setSessionStatus('unavailable');
      } finally {
        window.clearTimeout(timeout);
        if (pending === request) pending = undefined;
      }
    };

    const resume = () => {
      conceal();
      void checkSession();
    };

    void checkSession();
    const interval = window.setInterval(checkSession, 30_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pagehide', conceal);
    window.addEventListener('pageshow', resume);
    window.addEventListener('popstate', resume, true);
    window.addEventListener('lawoffice:recheck-session', resume);
    window.addEventListener('lawoffice:session-ended', conceal);
    return () => {
      pending?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pagehide', conceal);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('popstate', resume, true);
      window.removeEventListener('lawoffice:recheck-session', resume);
      window.removeEventListener('lawoffice:session-ended', conceal);
    };
  }, [isPublicAuthPage, router]);

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

  const viewLocked = sessionStatus !== 'ready' || refreshingSession;
  return (
    <>
      {viewLocked && (
        <main className="mx-auto max-w-xl space-y-3 p-6 text-[#172A35]" aria-live="polite" data-testid="protected-view-lock">
          {sessionStatus === 'expired' ? (
            <>
              <p role="alert">انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.</p>
              <a className="font-semibold underline" href="/login" target="_blank" rel="noopener noreferrer">
                فتح تسجيل الدخول في نافذة جديدة
              </a>
            </>
          ) : sessionStatus === 'unavailable' ? (
            <p role="alert">تعذر التحقق من الجلسة. تحقق من الاتصال ثم أعد المحاولة.</p>
          ) : (
            <p>جارٍ التحقق من الجلسة...</p>
          )}
          {(sessionStatus === 'expired' || sessionStatus === 'unavailable') && (
            <button type="button" className="block min-h-[44px] font-semibold underline"
              onClick={() => window.dispatchEvent(new Event('lawoffice:recheck-session'))}>
              إعادة التحقق من الجلسة
            </button>
          )}
        </main>
      )}
      <div ref={privateViewRef} hidden={viewLocked}>
    <NavigationGuardProvider>
      <div
        id="app-shell-content"
        inert={isDrawerOpen ? true : undefined}
        aria-hidden={isDrawerOpen ? true : undefined}
        className="min-h-screen flex flex-col bg-[#F4F6F7] text-[#172A35] overflow-x-hidden max-w-full"
      >
        {/* 1. Skip to Content Link */}
        <SkipLink />

        {/* 2-4. Sticky Top Bar (Connectivity Banner + Accessible Header) */}
        <div ref={topBarRef} className="sticky top-0 z-30">
          <ConnectivityBanner sticky={false} />

          {/* 3. Session Expiry Feedback if triggered */}
          <Suspense fallback={null}>
            <SessionExpiredAlert />
          </Suspense>

          <AppHeader
            onToggleDrawer={() => {
              drawerOpenerRef.current = triggerRef.current;
              setIsDrawerOpen((prev) => !prev);
            }}
            isDrawerOpen={isDrawerOpen}
            drawerTriggerRef={triggerRef}
            user={viewUser}
            showNotifications={sessionStatus === 'ready' && viewUser?.role !== 'MAINTAINER'}
          />
        </div>

        {/* 5. Desktop Body: Main Content + Sidebar */}
        <div className="flex-1 flex flex-row">
          {/* Primary Main Landmark */}
          <main
            id="main-content"
            role="main"
            dir="rtl"
            tabIndex={-1}
            data-testid="main-content"
            className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 pb-[max(5rem,calc(var(--mobile-nav-height,0px)+1rem))] sm:pb-8 overflow-x-hidden lg:mr-[232px] focus:outline-hidden"
          >
            {children}
          </main>

          {/* Right Desktop Sidebar (232px) */}
          <DesktopSidebar />
        </div>

        {/* 6. Mobile Bottom Nav Bar */}
        <MobileBottomNav
          navRef={mobileNavRef}
          onOpenDrawer={(opener) => {
            drawerOpenerRef.current = opener;
            setIsDrawerOpen(true);
          }}
        />
      </div>

      {/* 7. Accessible Tablet/Mobile Drawer Modal & Portal Target (outside #app-shell-content, inside auth-locked wrapper) */}
      <TabletDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        triggerRef={drawerOpenerRef}
      />
      <div id="app-shell-modal-root" />
    </NavigationGuardProvider>
      </div>
    </>
  );
}
