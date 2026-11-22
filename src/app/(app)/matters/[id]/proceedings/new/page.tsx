import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
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

export async function generateMetadata({ params }: NewProceedingPageProps) {
  const { id } = await params;
  try {
    const actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
    const matter = await getMatter(id, actor);
    return {
      title: `إضافة قيد قضائي جديد — ${matter.fileCode} — LawOffice OS`,
    };
  } catch {
    return {
      title: 'إضافة قيد قضائي جديد — LawOffice OS',
    };
  }
}

export default async function NewProceedingPage({ params }: NewProceedingPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent(`/matters/${id}/proceedings/new`));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent(`/matters/${id}/proceedings/new`));
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
            icon="⚠️"
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
        key={actor.id}
        ownerId={actor.id}
        matter={matter}
        courts={courts.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))}
        lookupError={lookupError}
      />
    </div>
  );
}

