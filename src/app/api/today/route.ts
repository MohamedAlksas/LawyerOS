import { readSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { getTodayOverview } from '@/modules/productivity/productivity-service';
import { productivityError } from '@/modules/productivity/productivity-errors';

export async function GET(request: Request) {
  return readSchedulingFromRequest(request, (actor) => getTodayOverview(actor), productivityError);
}