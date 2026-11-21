import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { searchMatters } from '@/modules/matters/matter-service';
import { listReferenceItems } from '@/modules/settings/reference-service';
import { searchParties } from '@/modules/parties/service';
import { MatterKind, MatterStatus, MatterValidationError, SearchMattersResult } from '@/modules/matters/matter-types';
import { MatterListClient } from '@/components/matters/matter-list-client';

export const metadata = {
  title: 'ملفات القضايا والخدمات القانونية — LawOffice OS',
};

interface MattersPageProps {
  searchParams?: Promise<{
    query?: string;
    kind?: string;
    status?: string;
    courtId?: string;
    clientId?: string;
    incompleteData?: string;
    page?: string;
    limit?: string;
    includeArchived?: string;
  }>;
}

export default async function MattersPage({ searchParams }: MattersPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
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

  const rawStatus = params.status === 'SUSPENDED' ? 'ON_HOLD' : params.status;
  const validStatus: MatterStatus | undefined =
    rawStatus && ['ACTIVE', 'DRAFT', 'ON_HOLD', 'CLOSED', 'ARCHIVED'].includes(rawStatus)
      ? (rawStatus as MatterStatus)
      : undefined;

  const validCourtId = params.courtId && params.courtId.trim() ? params.courtId.trim() : undefined;
  const validClientId = params.clientId && params.clientId.trim() ? params.clientId.trim() : undefined;
  const isIncompleteData = params.incompleteData === 'true';

  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10) || 20));
  const includeArchived = params.includeArchived === 'true' || validStatus === 'ARCHIVED';

  const [courts, clientsRes] = await Promise.all([
    listReferenceItems('COURT', false, actor).catch(() => []),
    searchParties(actor, { limit: 100 }).catch(() => ({ parties: [] })),
  ]);
  const clients = (clientsRes?.parties || []).map((p) => ({ id: p.id, name: p.name }));

  let initialResult: SearchMattersResult = { matters: [], total: 0, page: 1, totalPages: 1, limit };
  let initialError: string | undefined = undefined;
  try {
    initialResult = await searchMatters(
      {
        query: params.query,
        kind: validKind,
        status: validStatus,
        courtId: validCourtId,
        clientId: validClientId,
        incompleteData: isIncompleteData,
        includeArchived,
        page,
        limit,
      },
      actor
    );
  } catch (error) {
    if (error instanceof MatterValidationError) {
      initialError = error.message;
    } else {
      console.error('[Matter list] Failed to load the initial results');
      initialError = 'تعذر تحميل ملفات القضايا من الخادم.';
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <MatterListClient
        initialMatters={initialResult.matters}
        initialTotal={initialResult.total}
        initialPage={initialResult.page ?? page}
        initialTotalPages={initialResult.totalPages ?? 1}
        initialLimit={limit}
        initialQuery={params.query || ''}
        initialKind={validKind}
        initialStatus={validStatus}
        initialCourtId={validCourtId}
        initialClientId={validClientId}
        initialIncompleteData={isIncompleteData}
        initialIncludeArchived={includeArchived}
        initialError={initialError}
        courts={courts.map((c) => ({ id: c.id, name: c.name }))}
        clients={clients}
      />
    </div>
  );
}

