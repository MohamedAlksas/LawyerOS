import {
  parseQueryBooleanParam,
  parseQueryIntegerParam,
  readSchedulingFromRequest,
  writeSchedulingFromRequest,
} from '@/modules/scheduling/deadline-http';
import { createDeadline, listDeadlines } from '@/modules/scheduling/deadline-service';
import type { DeadlineStatus } from '@/modules/scheduling/deadline-types';

export async function GET(request: Request) {
  return readSchedulingFromRequest(request, (actor) => {
    const sp = new URL(request.url).searchParams;
    const needsReviewOnly = parseQueryBooleanParam(sp, 'needsReviewOnly');
    const overdueOnly = parseQueryBooleanParam(sp, 'overdueOnly');
    const includeClosed = parseQueryBooleanParam(sp, 'includeClosed');
    const page = parseQueryIntegerParam(sp, 'page');
    const limit = parseQueryIntegerParam(sp, 'limit');

    return listDeadlines(actor, {
      ...(sp.get('matterId') ? { matterId: sp.get('matterId')! } : {}),
      ...(sp.get('proceedingId') ? { proceedingId: sp.get('proceedingId')! } : {}),
      ...(sp.get('status') ? { status: sp.get('status') as DeadlineStatus } : {}),
      ...(needsReviewOnly !== undefined ? { needsReviewOnly } : {}),
      ...(overdueOnly !== undefined ? { overdueOnly } : {}),
      ...(includeClosed !== undefined ? { includeClosed } : {}),
      ...(page !== undefined ? { page } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  });
}

export async function POST(request: Request) {
  return writeSchedulingFromRequest(request, createDeadline);
}