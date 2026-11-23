import { readSchedulingFromRequest, writeSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { createDeadline, listDeadlines } from '@/modules/scheduling/deadline-service';
import type { DeadlineStatus } from '@/modules/scheduling/deadline-types';

export async function GET(request: Request) {
  return readSchedulingFromRequest(request, (actor) => {
    const sp = new URL(request.url).searchParams;
    return listDeadlines(actor, {
      ...(sp.get('matterId') ? { matterId: sp.get('matterId')! } : {}),
      ...(sp.get('proceedingId') ? { proceedingId: sp.get('proceedingId')! } : {}),
      ...(sp.get('status') ? { status: sp.get('status') as DeadlineStatus } : {}),
      ...(sp.get('needsReviewOnly') === 'true' ? { needsReviewOnly: true } : {}),
      ...(sp.get('overdueOnly') === 'true' ? { overdueOnly: true } : {}),
      ...(sp.get('includeClosed') === 'true' ? { includeClosed: true } : {}),
    });
  });
}

export async function POST(request: Request) {
  return writeSchedulingFromRequest(request, createDeadline);
}