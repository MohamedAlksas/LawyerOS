import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { searchParties } from '@/modules/parties/service';
import { PartyKind } from '@/modules/parties/types';
import { PartyListClient } from '@/components/parties/party-list-client';

export const metadata = {
  title: 'دليل الأطراف والموكلين — LawOffice OS',
};

interface PartiesPageProps {
  searchParams?: Promise<{
    query?: string;
    kind?: string;
  }>;
}

export default async function PartiesPage({ searchParams }: PartiesPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent('/parties'));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent('/parties'));
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

  let initialResult = null;
  try {
    initialResult = await searchParties(actor, {
      query: params.query,
      kind: validKind,
      page: 1,
      limit: 20,
    });
  } catch {
    // Graceful fallback to client loading if query parsing errors
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PartyListClient
        initialResult={initialResult}
        initialQuery={params.query || ''}
        initialKind={validKind}
      />
    </div>
  );
}
