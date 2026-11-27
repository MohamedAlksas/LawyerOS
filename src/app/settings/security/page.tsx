import React from 'react';
import SecurityClient from './security-client';
import { requireActor } from '@/modules/identity/require-actor';
import { listActiveSessions } from '@/modules/identity/sessions';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';

export const metadata = {
  title: 'الأمان وإدارة الجلسات — LawOffice OS',
};

export default async function SecuritySettingsPage() {
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/settings/security');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="p-4 sm:p-6" dir="rtl" lang="ar-EG">
          <div role="alert" className="max-w-4xl mx-auto bg-white p-6 rounded border border-red-200 text-[#A4262C]">
            <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
            <p>لا تمتلك الصلاحيات الكافية لإدارة إعدادات الأمان والجلسات.</p>
          </div>
        </div>
      );
    }
    throw error;
  }

  const activeSessions = await listActiveSessions(actor.id, actor.sessionId);
  const sessions = activeSessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress || 'غير معروف',
    userAgent: s.userAgent || 'متصفح غير معروف',
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    isCurrent: s.isCurrent,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6" dir="rtl" lang="ar-EG">
      <div>
        <nav className="text-xs text-[#4D606A] mb-1">الإعدادات &gt; الأمان</nav>
        <h1 className="text-2xl font-bold text-[#172A35]">الأمان وإدارة الجلسات</h1>
        <p className="text-sm text-[#4D606A] mt-1">
          إدارة مفاتيح التحقق الثنائي ومراجعة وإنهاء الجلسات والأجهزة النشطة لمكتب المحاماة.
        </p>
      </div>

      <SecurityClient
        key={`${actor.id}:${sessions.map((s) => `${s.id}-${s.createdAt}`).join(':')}`}
        initialSessions={sessions}
        actor={{
          name: actor.name,
          email: actor.email,
          role: actor.role,
          twoFactorVerified: actor.twoFactorVerified,
        }}
      />
    </div>
  );
}
