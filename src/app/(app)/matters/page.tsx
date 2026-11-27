import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { searchMatters, searchMatterClients } from '@/modules/matters/matter-service';
import { listReferenceItems } from '@/modules/settings/reference-service';
import { matterSearchFilters, readParam } from '@/lib/search-params';
import { MatterValidationError, SearchMattersResult } from '@/modules/matters/matter-types';
import { MatterListClient } from '@/components/matters/matter-list-client';

export const metadata = {
  title: 'ملفات القضايا والخدمات القانونية — LawOffice OS',
};

interface MattersPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MattersPage({ searchParams }: MattersPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/matters');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية للوصول إلى ملفات القضايا.</p>
        </div>
      );
    }
    throw error;
  }

  const filters = matterSearchFilters((name) => readParam(params, name));
  const includeArchived = filters.includeArchived || filters.status === 'ARCHIVED';

  const [courtsResult, clientsResult] = await Promise.allSettled([
    listReferenceItems('COURT', false, actor),
    searchMatterClients(actor, { limit: 10, includeArchived }).then((res) => res.clients),
  ]);

  const courts = courtsResult.status === 'fulfilled' ? courtsResult.value : [];
  const clients = clientsResult.status === 'fulfilled' ? clientsResult.value : [];

  let referenceLookupWarning: string | null = null;
  if (courtsResult.status === 'rejected' && clientsResult.status === 'rejected') {
    referenceLookupWarning = 'تعذر تحميل بيانات المحاكم والموكلين المرجعية من الخادم.';
  } else if (courtsResult.status === 'rejected') {
    referenceLookupWarning = 'تعذر تحميل قائمة المحاكم المرجعية من الخادم.';
  } else if (clientsResult.status === 'rejected') {
    referenceLookupWarning = 'تعذر تحميل قائمة الموكلين من الخادم.';
  }

  let initialResult: SearchMattersResult | undefined;
  let initialError: string | undefined = undefined;
  try {
    initialResult = await searchMatters(filters, actor);
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
      {referenceLookupWarning && (
        <div
          role="alert"
          data-testid="matters-reference-lookup-warning"
          className="p-3 bg-amber-50 border border-amber-300 text-[#7A4A00] rounded-[6px] text-sm font-medium"
        >
          {referenceLookupWarning} يمكنك الاستمرار في البحث والتصفح.
        </div>
      )}
      <MatterListClient
        key={actor.sessionId}
        initialMatters={initialResult?.matters}
        initialTotal={initialResult?.total}
        initialPage={initialResult?.page ?? filters.page}
        initialTotalPages={initialResult?.totalPages}
        initialLimit={filters.limit}
        initialKind={filters.kind}
        initialStatus={filters.status}
        initialCourtId={filters.courtId}
        initialIncompleteData={filters.incompleteData}
        initialIncludeArchived={filters.includeArchived}
        initialError={initialError}
        courts={courts.map((c) => ({ id: c.id, name: c.name }))}
        clients={clients}
        sessionId={actor.sessionId}
      />
    </div>
  );
}

