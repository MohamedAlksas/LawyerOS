import { writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { completeDeadline } from '@/modules/scheduling/deadline-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return writeSchedulingFromRequest(request, completeDeadline, {
    pathIdKey: 'deadlineId',
    pathIdValue: id,
  });
}