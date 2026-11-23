import { readSchedulingFromRequest, writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { listReminderRules, updateReminderRule } from '@/modules/reminders/reminder-service';
import { reminderError } from '@/modules/reminders/reminder-errors';

export async function GET(request: Request) {
  return readSchedulingFromRequest(request, (actor) => listReminderRules(actor), reminderError);
}

export async function PATCH(request: Request) {
  return writeSchedulingFromRequest(request, updateReminderRule, { mapper: reminderError });
}