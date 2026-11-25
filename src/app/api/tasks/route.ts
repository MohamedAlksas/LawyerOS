import {
  parseQueryBooleanParam,
  parseQueryIntegerParam,
  readSchedulingFromRequest,
  writeSchedulingFromRequest,
} from '@/modules/scheduling/deadline-http';
import { createTask, listTasks } from '@/modules/productivity/productivity-service';
import { productivityError } from '@/modules/productivity/productivity-errors';
import type { TaskPriority, TaskStatus } from '@/modules/productivity/productivity-types';

export async function GET(request: Request) {
  return readSchedulingFromRequest(
    request,
    (actor) => {
      const url = new URL(request.url);
      const sp = url.searchParams;
      const overdueOnly = parseQueryBooleanParam(sp, 'overdueOnly');
      const undatedOnly = parseQueryBooleanParam(sp, 'undatedOnly');
      const includeCompleted = parseQueryBooleanParam(sp, 'includeCompleted');
      const page = parseQueryIntegerParam(sp, 'page');
      const limit = parseQueryIntegerParam(sp, 'limit');

      return listTasks(actor, {
        ...(sp.get('status') ? { status: sp.get('status') as TaskStatus } : {}),
        ...(sp.get('matterId') ? { matterId: sp.get('matterId')! } : {}),
        ...(sp.get('deadlineId') ? { deadlineId: sp.get('deadlineId')! } : {}),
        ...(sp.get('priority') ? { priority: sp.get('priority') as TaskPriority } : {}),
        ...(overdueOnly !== undefined ? { overdueOnly } : {}),
        ...(undatedOnly !== undefined ? { undatedOnly } : {}),
        ...(includeCompleted !== undefined ? { includeCompleted } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
    },
    productivityError
  );
}

export async function POST(request: Request) {
  return writeSchedulingFromRequest(request, createTask, { mapper: productivityError });
}