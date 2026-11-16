import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError } from '@/modules/identity/types';

export default async function HomePage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify');
      }
      if (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_INACTIVE') {
        redirect('/login?error=session_expired');
      }
      redirect('/login');
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

      {/* S02 Genuine Empty State Container */}
      <div
        data-testid="dashboard-empty-state"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 sm:p-12 text-center shadow-xs space-y-6"
      >
        <div
          className="w-16 h-16 mx-auto rounded-full bg-[#F4F6F7] border border-[#D5DFE3] flex items-center justify-center text-3xl select-none"
          aria-hidden="true"
        >
          📂
        </div>

        <div className="max-w-md mx-auto space-y-2">
          <h2 className="text-lg font-bold text-[#172A35]">
            لا توجد قضايا أو جلسات مسجلة حالياً
          </h2>
          <p className="text-sm text-[#4D606A] leading-relaxed">
            نظام إدارة المكتب في مرحلته التشغيلية الأولى (<bdi dir="ltr">M1</bdi>). سيتم تفعيل وحدات إدارة ملفات القضايا والجلسات ومواعيد المحاكم في المراحل التالية وفق خطة العمل المعتمدة.
          </p>
        </div>

        {/* Primary Action */}
        <div className="pt-2">
          <Link
            href="/settings/security"
            data-testid="empty-state-security-action"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px]"
          >
            <span aria-hidden="true">🛡️</span>
            <span>مراجعة إعدادات الأمان</span>
          </Link>
        </div>

        {/* Real Session Identity Note */}
        <div className="pt-4 border-t border-[#D5DFE3] text-xs text-[#4D606A] flex flex-wrap items-center justify-center gap-1 sm:gap-2">
          <span>الحساب التشغيلي:</span>
          <bdi dir="ltr" className="font-mono text-[#172A35] font-medium">
            {actor.email}
          </bdi>
          <span className="text-slate-300">•</span>
          <span>الدور: {actor.role === 'OWNER' ? 'مدير المكتب (المالك)' : 'مستخدم'}</span>
        </div>
      </div>
    </div>
  );
}
