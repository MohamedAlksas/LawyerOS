import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { listDeadlines } from '@/modules/scheduling';
import type { DeadlineDTO } from '@/modules/scheduling/deadline-types';
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
        <div className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض المواعيد القانونية.</p>
        </div>
      );
    }
    throw error;
  }

  const reviewId = readParam(params, 'review') || undefined;

  let initialDeadlines: DeadlineDTO[] = [];
  let selectableMatters: SelectableMatterOptionDTO[] = [];
  let initialError: string | undefined;

  try {
    const [deadlines, matters] = await Promise.all([
      listDeadlines(actor, { includeClosed: true }),
      listSelectableMatters(actor),
    ]);
    initialDeadlines = deadlines;
    selectableMatters = matters;
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
        initialError={initialError}
        initialReviewDeadlineId={reviewId}
      />
    </div>
  );
}
