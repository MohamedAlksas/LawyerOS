import React from 'react';
import { GuardedLink as Link } from '@/components/navigation-guard';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { PartyForm } from '@/components/parties/party-form';

export const metadata = {
  title: 'إضافة طرف جديد — LawOffice OS',
};

export default async function NewPartyPage() {
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/parties/new');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-3xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لإضافة أطراف جديدة.</p>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header & Breadcrumb */}
      <div className="space-y-1 pb-4 border-b border-[#D5DFE3]">
        <nav aria-label="مسار التصفح" className="text-xs text-[#4D606A] flex items-center gap-1.5">
          <Link href="/parties" className="hover:text-[#14566B] hover:underline">
            دليل الأطراف
          </Link>
          <span aria-hidden="true">&gt;</span>
          <span className="text-[#172A35] font-medium">إضافة طرف جديد</span>
        </nav>
        <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
          إضافة طرف أو موكل جديد
        </h1>
        <p className="text-sm text-[#4D606A]">
          تسجيل بيانات أطراف الدعاوى، والموكلين، والشركات، وجهات الاتصال الرسمية
        </p>
      </div>

      {/* Main Party Form */}
      <PartyForm ownerId={actor.id} />
    </div>
  );
}
