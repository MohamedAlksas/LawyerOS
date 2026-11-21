'use client';

import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import Link from 'next/link';

type LeaveGuard = () => boolean;
const NavigationGuards = createContext<Set<LeaveGuard> | null>(null);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const [guards] = useState(() => new Set<LeaveGuard>());
  return <NavigationGuards value={guards}>{children}</NavigationGuards>;
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
      return window.confirm('لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة وفقدانها؟');
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
