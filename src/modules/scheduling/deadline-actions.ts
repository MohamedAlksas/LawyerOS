'use server';

import { verifyActionSecurity } from '@/modules/identity/action-security';
import { hearingError } from './hearing-errors';
import {
  createDeadline,
  updateDeadlineDraft,
  confirmDeadline,
  changeDeadlineDate,
  completeDeadline,
  cancelDeadline,
  getDeadline,
  listDeadlines,
} from './deadline-service';
import type {
  ActionResult,
  DeadlineDTO,
  CreateDeadlineInput,
  UpdateDeadlineDraftInput,
  ConfirmDeadlineInput,
  ChangeDeadlineDateInput,
  CompleteDeadlineInput,
  CancelDeadlineInput,
  ListDeadlinesParams,
} from './deadline-types';

export async function createDeadlineAction(
  input: CreateDeadlineInput
): Promise<ActionResult<DeadlineDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await createDeadline(actor, input) };
  } catch (error) {
    return hearingError(error);
  }
}

export async function updateDeadlineDraftAction(
  input: UpdateDeadlineDraftInput
): Promise<ActionResult<DeadlineDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await updateDeadlineDraft(actor, input) };
  } catch (error) {
    return hearingError(error);
  }
}

export async function confirmDeadlineAction(
  input: ConfirmDeadlineInput
): Promise<ActionResult<DeadlineDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await confirmDeadline(actor, input) };
  } catch (error) {
    return hearingError(error);
  }
}

export async function changeDeadlineDateAction(
  input: ChangeDeadlineDateInput
): Promise<ActionResult<DeadlineDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await changeDeadlineDate(actor, input) };
  } catch (error) {
    return hearingError(error);
  }
}

export async function completeDeadlineAction(
  input: CompleteDeadlineInput
): Promise<ActionResult<DeadlineDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await completeDeadline(actor, input) };
  } catch (error) {
    return hearingError(error);
  }
}

export async function cancelDeadlineAction(
  input: CancelDeadlineInput
): Promise<ActionResult<DeadlineDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await cancelDeadline(actor, input) };
  } catch (error) {
    return hearingError(error);
  }
}

export async function getDeadlineAction(deadlineId: string): Promise<ActionResult<DeadlineDTO>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await getDeadline(actor, deadlineId) };
  } catch (error) {
    return hearingError(error);
  }
}

export async function listDeadlinesAction(
  params?: ListDeadlinesParams
): Promise<ActionResult<DeadlineDTO[]>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await listDeadlines(actor, params) };
  } catch (error) {
    return hearingError(error);
  }
}
