import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { unifiedSearch } from '@/modules/matters/matter-service';
import { readParam, unifiedSearchFilters } from '@/lib/search-params';
import {
  UnifiedSearchResult,
  MatterValidationError,
} from '@/modules/matters/matter-types';
import { UnifiedSearchClient } from '@/components/search/unified-search-client';

export const metadata = {
  title: 'البحث الموحد — LawOffice OS',
};

interface SearchPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/search');
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

  const filters = unifiedSearchFilters((name) => readParam(params, name));
  let initialResult: UnifiedSearchResult | undefined;
  let initialError: string | undefined = undefined;

  try {
    initialResult = await unifiedSearch(filters, actor);
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
        key={actor.sessionId}
        initialResult={initialResult}
        initialType={filters.type}
        initialIncludeArchived={filters.includeArchived}
        initialPage={initialResult?.page ?? filters.page}
        initialLimit={filters.limit}
        initialError={initialError}
        sessionId={actor.sessionId}
      />
    </div>
  );
}
