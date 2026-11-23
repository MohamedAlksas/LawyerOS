'use server';

import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthorizationError, type Actor, type Permission } from '@/modules/identity/types';
import { productivityError } from './productivity-errors';
import {
  createTask,
  updateTask,
  completeTask,
  cancelTask,
  getTask,
  listTasks,
  listAgenda,
  getTodayOverview,
  listSelectableMatters,
} from './productivity-service';
import type {
  ActionResult,
  TaskItemDTO,
  AgendaDTO,
  TodayOverviewDTO,
  SelectableMatterOptionDTO,
  CreateTaskInput,
  UpdateTaskInput,
  CompleteTaskInput,
  CancelTaskInput,
  ListTasksParams,
  ListAgendaParams,
} from './productivity-types';

async function verifyActionSecurity(requiredPermission: Permission): Promise<Actor> {
  try {
    const { headers: nextHeaders } = await import('next/headers');
    const reqHeaders = await nextHeaders();
    const origin = reqHeaders?.get('origin');
    if (origin && !getTrustedOrigins().has(origin)) {
      throw new AuthorizationError('غير مصرح بالوصول من هذا المصدر.');
    }
    if (reqHeaders?.get('sec-fetch-site') === 'cross-site') {
      throw new AuthorizationError('غير مصرح بالوصول من مصدر خارجي.');
    }
  } catch (err) {
    if (err instanceof AuthorizationError) {
      throw err;
    }
  }

  return await requireActor({ requiredPermission });
}

export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult<TaskItemDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await createTask(actor, input) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function updateTaskAction(input: UpdateTaskInput): Promise<ActionResult<TaskItemDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await updateTask(actor, input) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function completeTaskAction(
  input: CompleteTaskInput
): Promise<ActionResult<TaskItemDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await completeTask(actor, input) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function cancelTaskAction(input: CancelTaskInput): Promise<ActionResult<TaskItemDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await cancelTask(actor, input) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function getTaskAction(taskId: string): Promise<ActionResult<TaskItemDTO>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await getTask(actor, taskId) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function listTasksAction(
  params?: ListTasksParams
): Promise<ActionResult<TaskItemDTO[]>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await listTasks(actor, params) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function listAgendaAction(
  params?: ListAgendaParams
): Promise<ActionResult<AgendaDTO>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await listAgenda(actor, params) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function getTodayOverviewAction(): Promise<ActionResult<TodayOverviewDTO>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await getTodayOverview(actor) };
  } catch (error) {
    return productivityError(error);
  }
}

export async function listSelectableMattersAction(): Promise<
  ActionResult<SelectableMatterOptionDTO[]>
> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await listSelectableMatters(actor) };
  } catch (error) {
    return productivityError(error);
  }
}
