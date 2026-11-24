import {
  parseQueryBooleanParam,
  parseQueryIntegerParam,
  readSchedulingFromRequest,
} from '@/modules/scheduling/deadline-http';
import { listInbox } from '@/modules/reminders/reminder-service';
import { reminderError } from '@/modules/reminders/reminder-errors';

export async function GET(request: Request) {
  return readSchedulingFromRequest(
    request,
    (actor) => {
      const sp = new URL(request.url).searchParams;
      const unreadOnly = parseQueryBooleanParam(sp, 'unreadOnly');
      const limit = parseQueryIntegerParam(sp, 'limit');
      return listInbox(actor, {
        ...(unreadOnly !== undefined ? { unreadOnly } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
    },
    reminderError
  );
}