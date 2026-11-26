import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { authorize } from '@/modules/identity/authorize';
import { getPrismaClient } from '@/lib/auth';
import { listDocuments } from '@/modules/documents/document-service';
import {
  LINKABLE_DOCUMENT_SELECT,
  type LinkableDocumentRow,
} from '@/modules/documents/document-types';
import { mapLinkableDocumentSummary, type LinkableDocumentSummary } from '@/modules/scheduling/hearing-types';
import { HearingResultClient } from './hearing-result-client';

const UUID_REGEX = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

interface HearingResultPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata = { title: 'تسجيل نتيجة الجلسة — LawOffice OS' };

export default async function HearingResultPage({ params }: HearingResultPageProps) {
  const { id } = await params;

  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/hearings/${id}/result`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]" dir="rtl">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لتسجيل نتيجة هذه الجلسة.</p>
        </div>
      );
    }
    throw error;
  }

  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');
  const prisma = getPrismaClient();
  const hearing = await prisma.hearing.findUnique({
    where: { id },
    include: {
      proceeding: {
        include: {
          court: true,
          matter: true,
        },
      },
      results: {
        orderBy: { revision: 'desc' },
        ...(canReadDocuments
          ? {
              include: {
                decisionDocument: {
                  select: LINKABLE_DOCUMENT_SELECT,
                },
              },
            }
          : {}),
      },
      linksFrom: {
        where: { relation: 'ADJOURNED_TO' },
        select: { toHearing: { select: { id: true, hearingDate: true, status: true } } },
      },
    },
  });

  if (!hearing) {
    notFound();
  }
  if (hearing.proceeding.archivedAt || hearing.proceeding.matter.archivedAt || hearing.proceeding.matter.status === 'ARCHIVED') {
    redirect(`/hearings/${id}`);
  }

  const latestResult = hearing.results[0] || null;
  const rawDecisionDoc =
    canReadDocuments && latestResult && 'decisionDocument' in latestResult
      ? (latestResult.decisionDocument as LinkableDocumentRow | null | undefined)
      : null;
  const dateIso = hearing.hearingDate.toISOString().slice(0, 10);
  let nextHearing = hearing.linksFrom[0]?.toHearing;
  const visited = new Set<string>();
  while (nextHearing?.status === 'RESCHEDULED' && !visited.has(nextHearing.id)) {
    visited.add(nextHearing.id);
    const replacement = await prisma.hearing.findFirst({
      where: { supersedesHearingId: nextHearing.id, proceedingId: hearing.proceedingId },
      select: { id: true, hearingDate: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!replacement) break;
    nextHearing = replacement;
  }

  let availableDocuments: LinkableDocumentSummary[] = [];
  let documentsLoadError: string | undefined;
  if (canReadDocuments) {
    try {
      const docsRes = await listDocuments(actor, {
        matterId: hearing.proceeding.matterId,
        limit: 100,
      });
      availableDocuments = docsRes.documents
        .filter(
          (d) =>
            !d.archivedAt &&
            d.currentVersionId &&
            d.currentVersion?.isReady &&
            (!d.proceedingId || d.proceedingId === hearing.proceedingId) &&
            (!d.hearingId || d.hearingId === hearing.id)
        )
        .map((d) => ({
          id: d.id,
          title: d.title,
          documentType: d.documentType,
          currentVersionId: d.currentVersionId,
          scanStatusLabel: d.currentVersion!.scanStatusLabel,
          proceedingId: d.proceedingId,
          hearingId: d.hearingId,
        }));
    } catch {
      availableDocuments = [];
      documentsLoadError = 'تعذر تحميل مستندات الملف الجاهزة من الخادم.';
    }
  }

  return (
    <HearingResultClient
      key={`${actor.id}:${hearing.id}`}
      actorId={actor.id}
      hearingId={hearing.id}
      initialVersion={hearing.version}
      hearingDate={dateIso}
      hearingTime={hearing.hearingTime}
      status={hearing.status}
      purpose={hearing.purpose}
      courtName={hearing.proceeding.court.name}
      circuit={hearing.proceeding.circuit}
      matterId={hearing.proceeding.matterId}
      matterFileCode={hearing.proceeding.matter.fileCode}
      proceedingId={hearing.proceedingId}
      canReadDocuments={canReadDocuments}
      availableDocuments={availableDocuments}
      documentsLoadError={documentsLoadError}
      history={hearing.results.map(({ revision, decisionText, correctionReason }) => ({ revision, decisionText, correctionReason }))}
      nextHearing={nextHearing && {
        id: nextHearing.id, date: nextHearing.hearingDate.toISOString().slice(0, 10), status: nextHearing.status,
      }}
      latestResult={
        latestResult
          ? {
              id: latestResult.id,
              decisionText: latestResult.decisionText,
              revision: latestResult.revision,
              correctionReason: latestResult.correctionReason,
              recordedAt: latestResult.recordedAt.toISOString(),
              decisionDocumentId: canReadDocuments ? (latestResult.decisionDocumentId ?? null) : null,
              decisionDocument: canReadDocuments ? mapLinkableDocumentSummary(rawDecisionDoc) : null,
            }
          : null
      }
    />
  );
}
