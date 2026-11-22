import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { unifiedSearch } from '@/modules/matters/matter-service';
import {
  UnifiedSearchResult,
  UnifiedSearchType,
  MatterValidationError,
} from '@/modules/matters/matter-types';
import { UnifiedSearchClient } from '@/components/search/unified-search-client';

export const metadata = {
  title: 'البحث الموحد — LawOffice OS',
};

interface SearchPageProps {
  searchParams?: Promise<{
    query?: string;
    type?: string;
    includeArchived?: string;
    page?: string;
    limit?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent('/search'));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent('/search'));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستخدام البحث الموحد.</p>
        </div>
      );
    }
    throw error;
  }

  const getSingleParam = (val: unknown): string | undefined => {
    if (typeof val === 'string') return val;
    if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
    return undefined;
  };

  const rawType = getSingleParam(params.type);
  const rawPage = getSingleParam(params.page);
  const rawLimit = getSingleParam(params.limit);
  const rawQuery = getSingleParam(params.query);
  const rawIncArch = getSingleParam(params.includeArchived);

  const validType: UnifiedSearchType =
    rawType && ['ALL', 'PARTY', 'MATTER', 'PROCEEDING'].includes(rawType)
      ? (rawType as UnifiedSearchType)
      : 'ALL';

  const requestedPage = Math.min(1000, Math.max(1, parseInt(rawPage || '1', 10) || 1));
  const effectiveLimit = Math.min(50, Math.max(1, parseInt(rawLimit || '20', 10) || 20));
  const includeArchived = rawIncArch === 'true';

  let initialResult: UnifiedSearchResult = {
    query: rawQuery || '',
    type: validType,
    includeArchived,
    page: requestedPage,
    limit: effectiveLimit,
    total: 0,
    totalPages: 1,
    items: [],
    counts: {
      all: 0,
      parties: 0,
      matters: 0,
      proceedings: 0,
    },
  };
  let initialError: string | undefined = undefined;

  try {
    initialResult = await unifiedSearch(
      {
        query: rawQuery,
        type: validType,
        includeArchived,
        page: requestedPage,
        limit: effectiveLimit,
      },
      actor
    );

    // Initial page recovery: if requested page is beyond totalPages but valid records exist, refetch the last valid page
    const totalPages = initialResult.totalPages ?? 1;
    if (requestedPage > totalPages && initialResult.total > 0) {
      initialResult = await unifiedSearch(
        {
          query: rawQuery,
          type: validType,
          includeArchived,
          page: totalPages,
          limit: effectiveLimit,
        },
        actor
      );
    }
  } catch (error) {
    if (error instanceof MatterValidationError) {
      initialError = error.message;
    } else {
      console.error('[Unified Search] Failed to load initial results');
      initialError = 'تعذر إجراء البحث من الخادم.';
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <UnifiedSearchClient
        initialResult={initialResult}
        initialQuery={rawQuery || ''}
        initialType={validType}
        initialIncludeArchived={includeArchived}
        initialPage={initialResult.page ?? requestedPage}
        initialLimit={effectiveLimit}
        initialError={initialError}
        sessionId={actor.sessionId}
      />
    </div>
  );
}
