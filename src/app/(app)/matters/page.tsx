import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { searchMatters, searchMatterClients } from '@/modules/matters/matter-service';
import { listReferenceItems } from '@/modules/settings/reference-service';
import { getClientProfile } from '@/modules/parties/service';
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

  const getFirst = (val: unknown): string | undefined => {
    if (typeof val === 'string') return val;
    if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
    return undefined;
  };

  const rawKind = getFirst(params.kind);
  const rawStatusParam = getFirst(params.status);
  const rawCourtId = getFirst(params.courtId);
  const rawClientId = getFirst(params.clientId);
  const rawIncData = getFirst(params.incompleteData);
  const rawPage = getFirst(params.page);
  const rawLimit = getFirst(params.limit);
  const rawIncArch = getFirst(params.includeArchived);
  const rawQuery = getFirst(params.query);

  const validKind: MatterKind | undefined =
    rawKind && ['LITIGATION', 'CONSULTATION', 'CONTRACT', 'OTHER'].includes(rawKind)
      ? (rawKind as MatterKind)
      : undefined;

  const rawStatus = rawStatusParam === 'SUSPENDED' ? 'ON_HOLD' : rawStatusParam;
  const validStatus: MatterStatus | undefined =
    rawStatus && ['ACTIVE', 'DRAFT', 'ON_HOLD', 'CLOSED', 'ARCHIVED'].includes(rawStatus)
      ? (rawStatus as MatterStatus)
      : undefined;

  const validCourtId = rawCourtId && rawCourtId.trim() ? rawCourtId.trim() : undefined;
  const validClientId = rawClientId && rawClientId.trim() ? rawClientId.trim() : undefined;
  const isIncompleteData = rawIncData === 'true';

  const page = Math.max(1, parseInt(rawPage || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(rawLimit || '20', 10) || 20));
  const includeArchived = rawIncArch === 'true' || validStatus === 'ARCHIVED';

  const [courts, initialClientsRes, selectedClientProfile] = await Promise.all([
    listReferenceItems('COURT', false, actor).catch(() => []),
    searchMatterClients(actor, { limit: 50 }).catch(() => ({ clients: [], total: 0, page: 1, totalPages: 1, hasMore: false })),
    validClientId ? getClientProfile(actor, validClientId).catch(() => null) : Promise.resolve(null),
  ]);

  const clientsMap = new Map<string, { id: string; name: string }>();
  for (const cl of initialClientsRes.clients) {
    clientsMap.set(cl.id, { id: cl.id, name: cl.name });
  }
  if (selectedClientProfile && !clientsMap.has(selectedClientProfile.id)) {
    clientsMap.set(selectedClientProfile.id, { id: selectedClientProfile.id, name: selectedClientProfile.name });
  }
  const clients = Array.from(clientsMap.values());

  let initialResult: SearchMattersResult = { matters: [], total: 0, page: 1, totalPages: 1, limit };
  let initialError: string | undefined = undefined;
  try {
    initialResult = await searchMatters(
      {
        query: rawQuery,
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

    // Initial page recovery: if requested page is beyond totalPages but valid records exist, refetch the last valid page
    const totalPages = initialResult.totalPages ?? 1;
    if (page > totalPages && initialResult.total > 0) {
      initialResult = await searchMatters(
        {
          query: rawQuery,
          kind: validKind,
          status: validStatus,
          courtId: validCourtId,
          clientId: validClientId,
          incompleteData: isIncompleteData,
          includeArchived,
          page: totalPages,
          limit,
        },
        actor
      );
    }
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

