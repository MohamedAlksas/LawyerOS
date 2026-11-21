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

  const validType: UnifiedSearchType =
    params.type && ['ALL', 'PARTY', 'MATTER', 'PROCEEDING'].includes(params.type)
      ? (params.type as UnifiedSearchType)
      : 'ALL';

  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.limit || '20', 10) || 20));
  const includeArchived = params.includeArchived === 'true';

  let initialResult: UnifiedSearchResult = {
    query: params.query || '',
    type: validType,
    includeArchived,
    page,
    limit,
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
        query: params.query,
        type: validType,
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
      console.error('[Unified Search] Failed to load initial results');
      initialError = 'تعذر إجراء البحث من الخادم.';
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <UnifiedSearchClient
        initialResult={initialResult}
        initialQuery={params.query || ''}
        initialType={validType}
        initialIncludeArchived={includeArchived}
        initialPage={page}
        initialError={initialError}
      />
    </div>
  );
}
