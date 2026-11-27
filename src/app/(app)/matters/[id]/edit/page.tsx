import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getMatter } from '@/modules/matters/matter-service';
import { NotFoundError } from '@/modules/matters/matter-types';
import { listReferenceItems } from '@/modules/settings/reference-service';
import { MatterForm } from '@/components/matters/matter-form';
import { EmptyStateContainer } from '@/components/presentation-state';

interface MatterEditPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata = { title: 'تعديل الملف — LawOffice OS' };

const UUID_REGEX = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export default async function MatterEditPage({ params }: MatterEditPageProps) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    notFound();
  }
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/matters/${id}/edit`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لتعديل هذا الملف.</p>
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
            description="لم يتم العثور على الملف المطلوب تعديله."
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

  let practiceAreas: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let storageLocations: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let lookupError = false;

  try {
    const [paRes, slRes] = await Promise.all([
      listReferenceItems('PRACTICE_AREA', true, actor),
      listReferenceItems('STORAGE_LOCATION', true, actor),
    ]);
    practiceAreas = paRes;
    storageLocations = slRes;
  } catch {
    lookupError = true;
  }

  return (
    <div className="py-2">
      <MatterForm
        key={`${actor.id}:${matter.id}`}
        ownerId={actor.id}
        initialMatter={matter}
        practiceAreas={practiceAreas.map((pa) => ({ id: pa.id, name: pa.name, isActive: pa.isActive }))}
        storageLocations={storageLocations.map((sl) => ({ id: sl.id, name: sl.name, isActive: sl.isActive }))}
        lookupError={lookupError}
      />
    </div>
  );
}

