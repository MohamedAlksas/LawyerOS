'use server';

import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthorizationError, type Actor, type Permission } from '@/modules/identity/types';
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
