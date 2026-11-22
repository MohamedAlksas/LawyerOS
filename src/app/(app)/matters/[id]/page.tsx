import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getMatter } from '@/modules/matters/matter-service';
import { NotFoundError } from '@/modules/matters/matter-types';
import { MatterDetailClient } from '@/components/matters/matter-detail-client';
import { EmptyStateContainer } from '@/components/presentation-state';

interface MatterDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata = { title: 'ملف القضية — LawOffice OS' };

export default async function MatterDetailPage({ params }: MatterDetailPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent(`/matters/${id}`));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent(`/matters/${id}`));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض هذا الملف.</p>
        </div>
      );
    }
    throw error;
  }

  let matter;
  try {
    matter = await getMatter(id, actor, true);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="max-w-3xl mx-auto py-12">
          <EmptyStateContainer
            icon="⚠️"
            title="ملف القضية غير موجود"
            description="لم يتم العثور على الملف المطلوب. قد يكون المعرف غير صحيح أو تم نقله."
            action={
              <Link
                href="/matters"
                className="px-4 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
              >
                العودة لدليل ملفات القضايا
              </Link>
            }
          />
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="py-2">
      <MatterDetailClient key={actor.id} ownerId={actor.id} initialMatter={matter} />
    </div>
  );
}

