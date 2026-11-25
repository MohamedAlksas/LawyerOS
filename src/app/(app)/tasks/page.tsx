import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { listSelectableMatters, listTasks, ProductivityValidationError } from '@/modules/productivity';
import type { SelectableMatterOptionDTO, TaskItemDTO } from '@/modules/productivity/productivity-types';
import { TasksView } from '@/components/productivity/tasks-view';

export const metadata = {
  title: 'المهام — LawOffice OS',
};

export default async function TasksPage() {
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/tasks');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض المهام.</p>
        </div>
      );
    }
    throw error;
  }

  let initialTasks: TaskItemDTO[] = [];
  let selectableMatters: SelectableMatterOptionDTO[] = [];
  let initialError: string | undefined;

  try {
    const [tasks, matters] = await Promise.all([
      listTasks(actor, { includeCompleted: true }),
      listSelectableMatters(actor),
    ]);
    initialTasks = tasks;
    selectableMatters = matters;
  } catch (error) {
    if (error instanceof ProductivityValidationError) {
      initialError = error.message;
    } else {
      console.error('[Tasks page] Failed to load tasks');
      initialError = 'تعذر تحميل قائمة المهام من الخادم.';
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <TasksView
        key={actor.id}
        actorId={actor.id}
        initialTasks={initialTasks}
        selectableMatters={selectableMatters}
        initialError={initialError}
      />
    </div>
  );
}
