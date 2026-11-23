'use server';

import { verifyActionSecurity } from '@/modules/identity/action-security';
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
