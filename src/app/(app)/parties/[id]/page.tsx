import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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

const UUID_REGEX = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export default async function PartyDetailPage({ params }: PartyDetailPageProps) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    notFound();
  }
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/parties/${id}`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
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

  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');
  let availablePoaDocuments: LinkableDocumentSummary[] = [];
  let poaDocumentsError: string | undefined;
  if (!party.archivedAt && canReadDocuments) {
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
      const matterDocsSettled = await Promise.allSettled(
        clientMatters.map((m) => listDocuments(actor, { matterId: m.matterId, limit: 100 }))
      );
      if (matterDocsSettled.some((res) => res.status === 'rejected')) {
        poaDocumentsError = 'تعذر تحميل بعض مستندات القضايا المرتبطة بالطرف من الخادم.';
      }
      const seen = new Set<string>();
      const allDocs = [
        ...partyDocsRes.documents,
        ...matterDocsSettled.flatMap((res) =>
          res.status === 'fulfilled' ? res.value.documents : []
        ),
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
          scanStatus: doc.currentVersion.scanStatus,
          scanStatusLabel: doc.currentVersion.scanStatusLabel,
          proceedingId: doc.proceedingId,
          hearingId: doc.hearingId,
        });
      }
    } catch {
      availablePoaDocuments = [];
      poaDocumentsError = 'تعذر تحميل المستندات المتاحة للربط بالتوكيل من الخادم.';
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PartyProfileClient
        key={`${actor.id}:${party.id}`}
        party={party}
        ownerId={actor.id}
        canReadDocuments={canReadDocuments}
        availablePoaDocuments={availablePoaDocuments}
        poaDocumentsError={poaDocumentsError}
      />
    </div>
  );
}
