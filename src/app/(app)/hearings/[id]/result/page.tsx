import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getPrismaClient } from '@/lib/auth';
import { HearingResultClient } from './hearing-result-client';

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
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent(`/hearings/${id}/result`));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent(`/hearings/${id}/result`));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]" dir="rtl">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لتسجيل نتيجة هذه الجلسة.</p>
        </div>
      );
    }
    throw error;
  }

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
      },
      linksFrom: { where: { relation: 'ADJOURNED_TO' }, select: { toHearing: { select: { id: true, hearingDate: true } } } },
    },
  });

  if (!hearing) {
    notFound();
  }
  if (hearing.proceeding.archivedAt || hearing.proceeding.matter.archivedAt || hearing.proceeding.matter.status === 'ARCHIVED') {
    redirect(`/hearings/${id}`);
  }

  const latestResult = hearing.results[0] || null;
  const dateIso = hearing.hearingDate.toISOString().slice(0, 10);

  return (
    <HearingResultClient
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
      history={hearing.results.map(({ revision, decisionText, correctionReason }) => ({ revision, decisionText, correctionReason }))}
      nextHearing={hearing.linksFrom.map(({ toHearing }) => ({ id: toHearing.id, date: toHearing.hearingDate.toISOString().slice(0, 10) }))[0]}
      latestResult={
        latestResult
          ? {
              id: latestResult.id,
              decisionText: latestResult.decisionText,
              revision: latestResult.revision,
              correctionReason: latestResult.correctionReason,
              recordedAt: latestResult.recordedAt.toISOString(),
            }
          : null
      }
    />
  );
}
