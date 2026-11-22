import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
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

  const filters = matterSearchFilters((name) => readParam(params, name));
  const includeArchived = filters.includeArchived || filters.status === 'ARCHIVED';
  const [courts, clients] = await Promise.all([
    listReferenceItems('COURT', false, actor).catch(() => []),
    searchMatterClients(actor, { limit: 10, includeArchived }).then((result) => result.clients).catch(() => []),
  ]);

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

