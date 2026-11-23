'use server';

import { verifyActionSecurity } from '@/modules/identity/action-security';
import { reminderError } from './reminder-errors';
import {
  listInbox,
  listReminderRules,
  markReminderRead,
  retryFailedReminderJob,
  updateReminderRule,
} from './reminder-service';
import type {
  ActionResult,
  InboxItemDTO,
  InboxOverviewDTO,
  ListInboxParams,
  MarkReminderReadInput,
  ReminderRuleDTO,
  RetryFailedReminderJobInput,
  RetryReminderJobResultDTO,
  UpdateReminderRuleInput,
} from './reminder-types';

export async function getInboxAction(
  params?: ListInboxParams
): Promise<ActionResult<InboxOverviewDTO>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await listInbox(actor, params) };
  } catch (error) {
    return reminderError(error);
  }
}

export async function markReminderReadAction(
  input: MarkReminderReadInput
): Promise<ActionResult<InboxItemDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await markReminderRead(actor, input) };
  } catch (error) {
    return reminderError(error);
  }
}

export async function retryFailedReminderJobAction(
  input: RetryFailedReminderJobInput
): Promise<ActionResult<RetryReminderJobResultDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await retryFailedReminderJob(actor, input) };
  } catch (error) {
    return reminderError(error);
  }
}

export async function listReminderRulesAction(): Promise<ActionResult<ReminderRuleDTO[]>> {
  try {
    const actor = await verifyActionSecurity('READ_CLIENT_DATA');
    return { success: true, data: await listReminderRules(actor) };
  } catch (error) {
    return reminderError(error);
  }
}

export async function updateReminderRuleAction(
  input: UpdateReminderRuleInput
): Promise<ActionResult<ReminderRuleDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    return { success: true, data: await updateReminderRule(actor, input) };
  } catch (error) {
    return reminderError(error);
  }
}