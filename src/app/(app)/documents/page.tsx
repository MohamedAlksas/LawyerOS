import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { listDocuments } from '@/modules/documents/document-service';
import { DocumentType, type DocumentDTO } from '@/modules/documents/document-types';
import { listSelectableMatters } from '@/modules/productivity';
import type { SelectableMatterOptionDTO } from '@/modules/productivity/productivity-types';
import { searchParties } from '@/modules/parties/service';
import { readParam } from '@/lib/search-params';
import { DocumentsView } from '@/components/documents/documents-view';
import type { SelectablePartyOption } from '@/components/documents/document-ui-helpers';

export const metadata = {
  title: 'المستندات — LawOffice OS',
};

const UUID_REGEX = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

interface DocumentsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/documents');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div
          data-testid="documents-forbidden"
          className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]"
        >
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض أرشيف المستندات.</p>
        </div>
      );
    }
    throw error;
  }

  const rawMatterId = readParam(params, 'matterId')?.trim();
  const rawPartyId = readParam(params, 'partyId')?.trim();
  const rawDocType = readParam(params, 'documentType')?.trim();
  const rawQ = readParam(params, 'q')?.trim();

  const matterId = rawMatterId && UUID_REGEX.test(rawMatterId) ? rawMatterId : undefined;
  const partyId = rawPartyId && UUID_REGEX.test(rawPartyId) ? rawPartyId : undefined;
  const documentType =
    rawDocType && (Object.values(DocumentType) as string[]).includes(rawDocType)
      ? (rawDocType as DocumentType)
      : undefined;
  const q = rawQ ? rawQ.slice(0, 200) : undefined;

  let initialDocuments: DocumentDTO[] = [];
  let initialTotal = 0;
  let selectableMatters: SelectableMatterOptionDTO[] = [];
  let selectableParties: SelectablePartyOption[] = [];
  let initialError: string | undefined;

  try {
    const [docsResult, matters, partiesResult] = await Promise.all([
      listDocuments(actor, {
        ...(matterId ? { matterId } : {}),
        ...(partyId ? { partyId } : {}),
        ...(documentType ? { documentType } : {}),
        ...(q ? { q } : {}),
        limit: 50,
      }),
      listSelectableMatters(actor),
      searchParties(actor, { limit: 100 }),
    ]);

    initialDocuments = docsResult.documents;
    initialTotal = docsResult.total;
    selectableMatters = matters;
    selectableParties = partiesResult.parties.map((party) => ({
      id: party.id,
      name: party.name,
      kind: party.kind,
    }));
  } catch {
    console.error('[Documents page] Failed to load documents workspace');
    initialError = 'تعذر تحميل قائمة المستندات من الخادم.';
  }

  return (
    <div className="max-w-5xl mx-auto">
      <DocumentsView
        key={actor.sessionId}
        initialDocuments={initialDocuments}
        initialTotal={initialTotal}
        selectableMatters={selectableMatters}
        selectableParties={selectableParties}
        initialFilters={{
          matterId,
          partyId,
          documentType,
          q,
        }}
        initialError={initialError}
      />
    </div>
  );
}
