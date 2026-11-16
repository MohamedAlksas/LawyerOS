'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getSession } from '@/lib/auth-client';

interface UserInfo {
  name?: string;
  email?: string;
}

export function UserIdentityBadge() {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    getSession().then((res) => {
      if (res?.data?.user) {
        setUser({
          name: res.data.user.name,
          email: res.data.user.email,
        });
      }
    }).catch(() => {
      // Ignored
    });
  }, []);

  const name = user?.name || 'الأستاذ المحامي';
  const email = user?.email || '';
  const initial = name.trim().charAt(0) || 'م';

  return (
    <Link
      href="/settings/security"
      data-testid="user-identity-badge"
      aria-label="حساب المستخدم"
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-[6px] border border-[#D5DFE3] bg-white hover:bg-[#E8EEF1] text-[#172A35] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] shrink-0"
    >
      <span
        className="w-8 h-8 rounded-full bg-[#14566B] text-white flex items-center justify-center font-bold text-xs shrink-0 select-none"
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="flex flex-col text-right justify-center">
        <span className="text-xs font-semibold text-[#172A35] leading-tight line-clamp-1">
          {name}
        </span>
        {email ? (
          <bdi dir="ltr" className="text-[11px] text-[#4D606A] font-mono leading-tight truncate max-w-[140px] sm:max-w-[180px]">
            {email}
          </bdi>
        ) : (
          <span className="text-[11px] text-[#4D606A] leading-tight">إدارة الحساب</span>
        )}
      </div>
    </Link>
  );
}
