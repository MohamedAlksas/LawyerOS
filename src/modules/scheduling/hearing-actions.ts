'use server';

import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthorizationError, type Actor, type Permission } from '@/modules/identity/types';
import { hearingError } from './hearing-errors';
import {
  scheduleHearing,
  recordHearingResult,
  rescheduleHearing,
  cancelHearing,
  correctHearingResult,
} from './hearing-service';
import {
  HearingDTO,
  HearingResultDTO,
  RecordHearingResultResult,
  RescheduleHearingResult,
  ScheduleHearingInput,
  RecordHearingResultInput,
  RescheduleHearingInput,
  CancelHearingInput,
  CorrectHearingResultInput,
  ActionResult,
} from './hearing-types';

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

export async function scheduleHearingAction(
  input: ScheduleHearingInput
): Promise<ActionResult<HearingDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    const data = await scheduleHearing(actor, input);
    return { success: true, data };
  } catch (error) {
    return hearingError(error);
  }
}

export async function recordHearingResultAction(
  input: RecordHearingResultInput
): Promise<ActionResult<RecordHearingResultResult>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    const data = await recordHearingResult(actor, input);
    return { success: true, data };
  } catch (error) {
    return hearingError(error);
  }
}

export async function rescheduleHearingAction(
  input: RescheduleHearingInput
): Promise<ActionResult<RescheduleHearingResult>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    const data = await rescheduleHearing(actor, input);
    return { success: true, data };
  } catch (error) {
    return hearingError(error);
  }
}

export async function cancelHearingAction(
  input: CancelHearingInput
): Promise<ActionResult<HearingDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    const data = await cancelHearing(actor, input);
    return { success: true, data };
  } catch (error) {
    return hearingError(error);
  }
}

export async function correctHearingResultAction(
  input: CorrectHearingResultInput
): Promise<ActionResult<HearingResultDTO>> {
  try {
    const actor = await verifyActionSecurity('WRITE_CLIENT_DATA');
    const data = await correctHearingResult(actor, input);
    return { success: true, data };
  } catch (error) {
    return hearingError(error);
  }
}
