import { writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { retryFailedReminderJob } from '@/modules/reminders/reminder-service';
import { reminderError } from '@/modules/reminders/reminder-errors';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return writeSchedulingFromRequest(request, retryFailedReminderJob, {
    pathIdKey: 'jobRunId',
    pathIdValue: id,
    mapper: reminderError,
  });
}