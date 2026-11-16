'use client';

import React, { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

function getServerSnapshot() {
  return true;
}

export function ConnectivityBanner() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connectivity-banner"
      className="bg-[#7A4A00] text-white text-sm font-semibold py-2.5 px-4 text-center sticky top-0 z-50 shadow-md flex items-center justify-center gap-2 min-h-[44px]"
    >
      <span aria-hidden="true" className="text-base">⚠️</span>
      <span>النت مقطوع. التعديلات مش محفوظة</span>
    </div>
  );
}
