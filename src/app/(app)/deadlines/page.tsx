import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { authorize } from '@/modules/identity/authorize';
import { listDocuments } from '@/modules/documents/document-service';
import { listDeadlines } from '@/modules/scheduling';
import type { DeadlineDTO, LinkableDocumentSummary } from '@/modules/scheduling/deadline-types';
import { listSelectableMatters } from '@/modules/productivity';
import type { SelectableMatterOptionDTO } from '@/modules/productivity/productivity-types';
import { readParam } from '@/lib/search-params';
import { DeadlinesView } from '@/components/deadlines/deadlines-view';

export const metadata = {
  title: 'المواعيد القانونية — LawOffice OS',
};

interface DeadlinesPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DeadlinesPage({ searchParams }: DeadlinesPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/deadlines');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض المواعيد القانونية.</p>
        </div>
      );
    }
    throw error;
  }

  const reviewId = readParam(params, 'review') || undefined;
  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');

  let initialDeadlines: DeadlineDTO[] = [];
  let selectableMatters: SelectableMatterOptionDTO[] = [];
  let initialDocumentsByMatter: Record<string, LinkableDocumentSummary[]> | undefined;
  let documentsLoadError: string | undefined;
  let initialError: string | undefined;

  try {
    const [deadlines, matters] = await Promise.all([
      listDeadlines(actor, { includeClosed: true }),
      listSelectableMatters(actor),
    ]);
    initialDeadlines = deadlines;
    selectableMatters = matters;

    const reviewTarget = reviewId
      ? deadlines.find((d) => d.id === reviewId && d.status === 'DRAFT')
      : undefined;
    if (reviewTarget && canReadDocuments) {
      try {
        const docsRes = await listDocuments(actor, { matterId: reviewTarget.matterId, limit: 100 });
        initialDocumentsByMatter = {
          [reviewTarget.matterId]: docsRes.documents
            .filter((d) => !d.archivedAt && d.currentVersionId && d.currentVersion?.isReady)
            .map((d) => ({
              id: d.id,
              title: d.title,
              documentType: d.documentType,
              currentVersionId: d.currentVersionId,
              scanStatusLabel: d.currentVersion!.scanStatusLabel,
              proceedingId: d.proceedingId,
              hearingId: d.hearingId,
            })),
        };
      } catch {
        initialDocumentsByMatter = undefined;
        documentsLoadError = 'تعذر تحميل مستندات الملف من الخادم.';
      }
    }
  } catch {
    console.error('[Deadlines page] Failed to load deadlines');
    initialError = 'تعذر تحميل المواعيد القانونية من الخادم.';
  }

  return (
    <div className="max-w-5xl mx-auto">
      <DeadlinesView
        key={actor.id}
        actorId={actor.id}
        initialDeadlines={initialDeadlines}
        selectableMatters={selectableMatters}
        canReadDocuments={canReadDocuments}
        initialDocumentsByMatter={initialDocumentsByMatter}
        documentsLoadError={documentsLoadError}
        initialError={initialError}
        initialReviewDeadlineId={reviewId}
      />
    </div>
  );
}
