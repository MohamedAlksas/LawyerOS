import { writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { confirmDeadline } from '@/modules/scheduling/deadline-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return writeSchedulingFromRequest(request, confirmDeadline, {
    pathIdKey: 'deadlineId',
    pathIdValue: id,
  });
}