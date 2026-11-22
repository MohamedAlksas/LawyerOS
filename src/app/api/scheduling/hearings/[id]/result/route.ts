import { writeHearingFromRequest } from '@/modules/scheduling/hearing-http';
import { recordHearingResult } from '@/modules/scheduling/hearing-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return writeHearingFromRequest(request, id, recordHearingResult);
}
