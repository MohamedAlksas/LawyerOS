import React from 'react';
import Link from 'next/link';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { authorize } from '@/modules/identity/authorize';
import { getPrismaClient } from '@/lib/auth';
import { listDocuments } from '@/modules/documents/document-service';
import { getClientProfile, NotFoundError } from '@/modules/parties/service';
import type { LinkableDocumentSummary } from '@/modules/parties/types';
import { PartyProfileClient } from '@/components/parties/party-profile-client';
import { EmptyStateContainer } from '@/components/presentation-state';

interface PartyDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata = { title: 'ملف الطرف — LawOffice OS' };

export default async function PartyDetailPage({ params }: PartyDetailPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/parties/${id}`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض ملف هذا الطرف.</p>
        </div>
      );
    }
    throw error;
  }

  let party;
  try {
    party = await getClientProfile(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="max-w-3xl mx-auto py-12">
          <EmptyStateContainer
            icon=""
            title="الطرف غير موجود"
            description="لم يتم العثور على الطرف المطلوب. قد يكون تم حذفه أو أن المعرف غير صحيح."
            action={
              <Link
                href="/parties"
                className="px-4 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
              >
                العودة لدليل الأطراف
              </Link>
            }
          />
        </div>
      );
    }
    throw error;
  }

  let availablePoaDocuments: LinkableDocumentSummary[] = [];
  if (!party.archivedAt && authorize(actor, 'READ_DOCUMENTS')) {
    try {
      const prisma = getPrismaClient();
      const [partyDocsRes, clientMatters] = await Promise.all([
        listDocuments(actor, { partyId: party.id, limit: 100 }),
        prisma.matterParty.findMany({
          where: {
            partyId: party.id,
            role: 'CLIENT',
            matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
          },
          select: { matterId: true },
          take: 50,
        }),
      ]);
      const matterDocsResults = await Promise.all(
        clientMatters.map((m) =>
          listDocuments(actor, { matterId: m.matterId, limit: 100 }).catch(() => null)
        )
      );
      const seen = new Set<string>();
      const allDocs = [
        ...partyDocsRes.documents,
        ...matterDocsResults.flatMap((res) => res?.documents ?? []),
      ];
      for (const doc of allDocs) {
        if (seen.has(doc.id)) continue;
        if (doc.archivedAt || !doc.currentVersionId || !doc.currentVersion?.isReady) continue;
        seen.add(doc.id);
        availablePoaDocuments.push({
          id: doc.id,
          title: doc.title,
          documentType: doc.documentType,
          currentVersionId: doc.currentVersionId,
          scanStatusLabel: doc.currentVersion.scanStatusLabel,
        });
      }
    } catch {
      availablePoaDocuments = [];
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PartyProfileClient
        key={`${actor.id}:${party.id}`}
        party={party}
        ownerId={actor.id}
        availablePoaDocuments={availablePoaDocuments}
      />
    </div>
  );
}
