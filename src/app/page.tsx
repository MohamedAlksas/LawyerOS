import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError } from '@/modules/identity/types';
import { DashboardStatus } from '@/components/dashboard-status';

export default async function HomePage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error);
    }
    throw error;
  }

  // Format current Cairo time in Egyptian Arabic
  const todayFormatted = new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Dashboard Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#D5DFE3]">
        <div>
          <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
            مكتب المحامي — لوحة المتابعة
          </h1>
          <p className="text-sm text-[#4D606A] mt-1 break-words">
            أهلاً بك، <span className="font-semibold text-[#172A35] break-words">{actor.name}</span>
          </p>
        </div>
        <div className="text-xs font-medium text-[#4D606A] bg-white border border-[#D5DFE3] px-3 py-1.5 rounded-[6px] self-start sm:self-auto shadow-xs">
          <time dateTime={new Date().toISOString()}>
            <bdi dir="rtl">{todayFormatted}</bdi>
          </time>
        </div>
      </div>

      <DashboardStatus actorEmail={actor.email} />
    </div>
  );
}
