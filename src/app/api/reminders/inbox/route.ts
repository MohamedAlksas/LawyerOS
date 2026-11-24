import { readSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { listInbox } from '@/modules/reminders/reminder-service';
import { reminderError } from '@/modules/reminders/reminder-errors';

export async function GET(request: Request) {
  return readSchedulingFromRequest(
    request,
    (actor) => {
      const sp = new URL(request.url).searchParams;
      const unreadOnly = sp.get('unreadOnly') === 'true';
      const limitParam = sp.get('limit');
      const parsedLimit = limitParam ? Number(limitParam) : undefined;
      return listInbox(actor, {
        unreadOnly,
        ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
      });
    },
    reminderError
  );
}