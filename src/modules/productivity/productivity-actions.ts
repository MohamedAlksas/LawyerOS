'use server';

import { verifyActionSecurity } from '@/modules/identity/action-security';
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
