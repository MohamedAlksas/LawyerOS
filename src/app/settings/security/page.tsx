import React from 'react';
import SecurityClient from './security-client';
import { getSecurityOverview } from './actions';
import { redirect } from 'next/navigation';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';

export const metadata = {
  title: 'الأمان وإدارة الجلسات — LawOffice OS',
};

export default async function SecuritySettingsPage() {
  let overview;
  try {
    overview = await getSecurityOverview();
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
    if (error instanceof AuthorizationError) {
      return (
        <main className="min-h-screen bg-[#F4F6F7] p-6" dir="rtl" lang="ar-EG">
          <div className="max-w-4xl mx-auto bg-white p-6 rounded border border-red-200 text-[#A4262C]">
            <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
            <p>لا تمتلك الصلاحيات الكافية لإدارة إعدادات الأمان والجلسات.</p>
          </div>
        </main>
      );
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-[#F4F6F7] p-4 sm:p-8 overflow-x-hidden" dir="rtl" lang="ar-EG">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <nav className="text-xs text-[#4D606A] mb-1">الإعدادات &gt; الأمان</nav>
          <h1 className="text-2xl font-bold text-[#172A35]">الأمان وإدارة الجلسات (S14)</h1>
          <p className="text-sm text-[#4D606A] mt-1">
            إدارة مفاتيح التحقق الثنائي ومراجعة وإنهاء الجلسات والأجهزة النشطة لمكتب المحاماة.
          </p>
        </div>

        <SecurityClient
          initialSessions={overview.sessions}
          actor={overview.actor}
        />
      </div>
    </div>
  );
}