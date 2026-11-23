import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { searchParties } from '@/modules/parties/service';
import { PartyKind } from '@/modules/parties/types';
import { PartyListClient } from '@/components/parties/party-list-client';

export const metadata = {
  title: 'دليل الأطراف والموكلين — LawOffice OS',
};

interface PartiesPageProps {
  searchParams?: Promise<{
    query?: string | string[];
    kind?: string | string[];
  }>;
}

export default async function PartiesPage({ searchParams }: PartiesPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/parties');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية للوصول إلى دليل الأطراف.</p>
        </div>
      );
    }
    throw error;
  }

  const validKind: PartyKind | undefined =
    params.kind === 'PERSON' || params.kind === 'ORGANIZATION'
      ? params.kind
      : undefined;

  if (params.query !== undefined) {
    redirect(validKind ? `/parties?kind=${validKind}` : '/parties');
  }

  let initialResult = null;
  let initialError: string | undefined;
  try {
    initialResult = await searchParties(actor, {
      kind: validKind,
      page: 1,
      limit: 20,
    });
  } catch {
    initialError = 'تعذر تحميل بيانات الأطراف. يرجى إعادة المحاولة.';
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PartyListClient
        initialResult={initialResult}
        initialError={initialError}
        initialKind={validKind}
      />
    </div>
  );
}
