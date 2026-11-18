import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getClientProfile, NotFoundError } from '@/modules/parties/service';
import { PartyForm } from '@/components/parties/party-form';
import { EmptyStateContainer } from '@/components/presentation-state';

interface PartyEditPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({ params }: PartyEditPageProps) {
  const { id } = await params;
  try {
    const actor = await requireActor();
    const party = await getClientProfile(actor, id);
    return {
      title: `تعديل: ${party.name} — LawOffice OS`,
    };
  } catch {
    return {
      title: 'تعديل بيانات الطرف — LawOffice OS',
    };
  }
}

export default async function PartyEditPage({ params }: PartyEditPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent(`/parties/${id}/edit`));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent(`/parties/${id}/edit`));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لتعديل بيانات هذا الطرف.</p>
        </div>
      );
    }
    throw error;
  }

  let party;
  try {
    party = await getClientProfile(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="max-w-3xl mx-auto py-12">
          <EmptyStateContainer
            icon="⚠️"
            title="الطرف غير موجود"
            description="لم يتم العثور على الطرف المطلوب لتعديله."
            action={
              <Link
                href="/parties"
                className="px-4 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
              >
                العودة لدليل الأطراف
              </Link>
            }
          />
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
          <Link href={`/parties/${party.id}`} className="hover:text-[#14566B] hover:underline">
            {party.name}
          </Link>
          <span aria-hidden="true">&gt;</span>
          <span className="text-[#172A35] font-medium">تعديل البيانات</span>
        </nav>
        <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
          تعديل بيانات: {party.name}
        </h1>
        <p className="text-sm text-[#4D606A]">
          تحديث معلومات الاتصال، أو العنوان، أو الملاحظات مع الحماية ضد التضارب المتزامن
        </p>
      </div>

      {/* Main Party Form in Edit Mode */}
      <PartyForm party={party} />
    </div>
  );
}
