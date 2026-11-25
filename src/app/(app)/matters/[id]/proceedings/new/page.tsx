import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getMatter } from '@/modules/matters/matter-service';
import { NotFoundError } from '@/modules/matters/matter-types';
import { listReferenceItems } from '@/modules/settings/reference-service';
import { ProceedingForm } from '@/components/proceedings/proceeding-form';
import { EmptyStateContainer } from '@/components/presentation-state';

interface NewProceedingPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata = { title: 'إضافة قيد قضائي جديد — LawOffice OS' };

export default async function NewProceedingPage({ params }: NewProceedingPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/matters/${id}/proceedings/new`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لإضافة قيد قضائي.</p>
        </div>
      );
    }
    throw error;
  }

  let matter;
  try {
    matter = await getMatter(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="max-w-3xl mx-auto py-12">
          <EmptyStateContainer
            icon=""
            title="الملف غير موجود"
            description="لم يتم العثور على الملف المراد إضافة قيد قضائي له."
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

  if (matter.status === 'ARCHIVED' || matter.archivedAt) {
    redirect(`/matters/${matter.id}`);
  }

  let courts: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let lookupError = false;

  try {
    courts = await listReferenceItems('COURT', false, actor);
  } catch {
    lookupError = true;
  }

  return (
    <div className="py-2">
      <ProceedingForm
        key={`${actor.sessionId}:${matter.id}`}
        ownerId={actor.id}
        matter={matter}
        courts={courts.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))}
        lookupError={lookupError}
      />
    </div>
  );
}

