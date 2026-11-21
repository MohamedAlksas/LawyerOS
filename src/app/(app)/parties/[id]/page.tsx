import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getClientProfile, NotFoundError } from '@/modules/parties/service';
import { PartyProfileClient } from '@/components/parties/party-profile-client';
import { EmptyStateContainer } from '@/components/presentation-state';

interface PartyDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({ params }: PartyDetailPageProps) {
  const { id } = await params;
  try {
    const actor = await requireActor();
    const party = await getClientProfile(actor, id);
    return {
      title: `${party.name} — ملف الطرف — LawOffice OS`,
    };
  } catch {
    return {
      title: 'ملف الطرف — LawOffice OS',
    };
  }
}

export default async function PartyDetailPage({ params }: PartyDetailPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent(`/parties/${id}`));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent(`/parties/${id}`));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض ملف هذا الطرف.</p>
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
            description="لم يتم العثور على الطرف المطلوب. قد يكون تم حذفه أو أن المعرف غير صحيح."
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
    <div className="max-w-5xl mx-auto space-y-6">
      <PartyProfileClient key={actor.id} party={party} ownerId={actor.id} />
    </div>
  );
}
