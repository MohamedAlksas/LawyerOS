'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import Link from 'next/link';

type LeaveGuard = () => boolean;
const NavigationGuards = createContext<Set<LeaveGuard> | null>(null);
const FormDrafts = createContext<Map<string, unknown> | null>(null);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const [guards] = useState(() => new Set<LeaveGuard>());
  const [drafts] = useState(() => new Map<string, unknown>());
  return (
    <NavigationGuards value={guards}>
      <FormDrafts value={drafts}>{children}</FormDrafts>
    </NavigationGuards>
  );
}

// Same-document browser history can leave a form without invoking Link.onNavigate.
// Keep its draft inside the private shell, scoped to the authorized actor and URL.
export function useFormDraft<T>(ownerId: string, pathname: string) {
  const drafts = useContext(FormDrafts);
  const key = `${ownerId}:${pathname}`;
  const [restored] = useState(() => drafts?.get(key) as T | undefined);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return {
    restored,
    keep: (snapshot: T) => drafts?.set(key, snapshot),
    clear: () => drafts?.delete(key),
    isCurrent: () => mounted.current && window.location.pathname === pathname,
  };
}

export function useLeaveGuard(dirty: boolean, pending: boolean) {
  const guards = useContext(NavigationGuards);

  useEffect(() => {
    if (!dirty && !pending) return;

    const canLeave = () => {
      if (pending) {
        window.alert('انتظر نتيجة الحفظ أو أعد محاولة العملية الأصلية قبل مغادرة الصفحة.');
        return false;
      }
      return window.confirm('لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟');
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    guards?.add(canLeave);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      guards?.delete(canLeave);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, guards, pending]);
}

export function useCanLeavePage() {
  const guards = useContext(NavigationGuards);
  return () => !guards || Array.from(guards).every((canLeave) => canLeave());
}

export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const canLeavePage = useCanLeavePage();
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (!canLeavePage()) {
          event.preventDefault();
          return;
        }
        onNavigate?.(event);
      }}
    />
  );
}
