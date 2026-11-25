import React from 'react';
import Link from 'next/link';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getMatter } from '@/modules/matters/matter-service';
import { NotFoundError } from '@/modules/matters/matter-types';
import { MatterDetailClient } from '@/components/matters/matter-detail-client';
import { EmptyStateContainer } from '@/components/presentation-state';
import { listTasks, ProductivityValidationError } from '@/modules/productivity';
import type { TaskItemDTO } from '@/modules/productivity/productivity-types';
import { listDeadlines } from '@/modules/scheduling';
import type { DeadlineDTO } from '@/modules/scheduling/deadline-types';

interface MatterDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata = { title: 'ملف القضية — LawOffice OS' };

export default async function MatterDetailPage({ params }: MatterDetailPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/matters/${id}`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض هذا الملف.</p>
        </div>
      );
    }
    throw error;
  }

  let matter;
  try {
    matter = await getMatter(id, actor, true);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="max-w-3xl mx-auto py-12">
          <EmptyStateContainer
            icon=""
            title="ملف القضية غير موجود"
            description="لم يتم العثور على الملف المطلوب. قد يكون المعرف غير صحيح أو تم نقله."
            action={
              <Link
                href="/matters"
                className="px-4 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
              >
                العودة لدليل ملفات القضايا
              </Link>
            }
          />
        </div>
      );
    }
    throw error;
  }

  const [tasksResult, deadlinesResult] = await Promise.allSettled([
    listTasks(actor, { matterId: id, includeCompleted: true }),
    listDeadlines(actor, { matterId: id, includeClosed: true }),
  ]);

  const initialTasks = tasksResult.status === 'fulfilled' ? tasksResult.value : ([] as TaskItemDTO[]);
  const initialDeadlines = deadlinesResult.status === 'fulfilled' ? deadlinesResult.value : ([] as DeadlineDTO[]);
  const tasksError =
    tasksResult.status === 'rejected'
      ? tasksResult.reason instanceof ProductivityValidationError
        ? tasksResult.reason.message
        : 'تعذر تحميل قائمة المهام من الخادم.'
      : undefined;
  const deadlinesError =
    deadlinesResult.status === 'rejected'
      ? 'تعذر تحميل المواعيد القانونية من الخادم.'
      : undefined;

  return (
    <div className="py-2">
      <MatterDetailClient
        key={`${actor.id}:${matter.id}`}
        ownerId={actor.id}
        initialMatter={matter}
        initialTasks={initialTasks}
        initialDeadlines={initialDeadlines}
        tasksError={tasksError}
        deadlinesError={deadlinesError}
      />
    </div>
  );
}

