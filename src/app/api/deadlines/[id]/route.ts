import { readSchedulingFromRequest, writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { getDeadline, updateDeadlineDraft } from '@/modules/scheduling/deadline-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readSchedulingFromRequest(request, (actor) => getDeadline(actor, id));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return writeSchedulingFromRequest(request, updateDeadlineDraft, {
    pathIdKey: 'deadlineId',
    pathIdValue: id,
  });
}