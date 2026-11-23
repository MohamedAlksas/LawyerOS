import { readSchedulingFromRequest, writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { getTask, updateTask } from '@/modules/productivity/productivity-service';
import { productivityError } from '@/modules/productivity/productivity-errors';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readSchedulingFromRequest(request, (actor) => getTask(actor, id), productivityError);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return writeSchedulingFromRequest(request, updateTask, {
    pathIdKey: 'taskId',
    pathIdValue: id,
    mapper: productivityError,
  });
}