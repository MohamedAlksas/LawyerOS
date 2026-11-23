import { writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { completeTask } from '@/modules/productivity/productivity-service';
import { productivityError } from '@/modules/productivity/productivity-errors';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return writeSchedulingFromRequest(request, completeTask, {
    pathIdKey: 'taskId',
    pathIdValue: id,
    mapper: productivityError,
  });
}