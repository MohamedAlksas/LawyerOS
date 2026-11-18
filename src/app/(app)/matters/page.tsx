import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { searchMatters } from '@/modules/matters/matter-service';
import { MatterKind, MatterStatus, SearchMattersResult } from '@/modules/matters/matter-types';
import { MatterListClient } from '@/components/matters/matter-list-client';

export const metadata = {
  title: 'ملفات القضايا والخدمات القانونية — LawOffice OS',
};

interface MattersPageProps {
  searchParams?: Promise<{
    query?: string;
    kind?: string;
    status?: string;
  }>;
}

export default async function MattersPage({ searchParams }: MattersPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent('/matters'));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent('/matters'));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية للوصول إلى ملفات القضايا.</p>
        </div>
      );
    }
    throw error;
  }

  const validKind: MatterKind | undefined =
    params.kind && ['LITIGATION', 'CONSULTATION', 'CONTRACT', 'OTHER'].includes(params.kind)
      ? (params.kind as MatterKind)
      : undefined;

  const validStatus: MatterStatus | undefined =
    params.status && ['ACTIVE', 'DRAFT', 'SUSPENDED', 'CLOSED'].includes(params.status)
      ? (params.status as MatterStatus)
      : undefined;

  let initialResult: SearchMattersResult = { matters: [], total: 0 };
  try {
    initialResult = await searchMatters(
      {
        query: params.query,
        kind: validKind,
        status: validStatus,
        limit: 50,
        offset: 0,
      },
      actor
    );
  } catch {
    // Graceful fallback to client loading
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <MatterListClient
        initialMatters={initialResult.matters}
        initialTotal={initialResult.total}
        initialQuery={params.query || ''}
        initialKind={validKind}
        initialStatus={validStatus}
      />
    </div>
  );
}

