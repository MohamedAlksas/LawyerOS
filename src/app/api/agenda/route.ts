import { readSchedulingFromRequest } from '@/modules/scheduling/deadline-http';
import { listAgenda } from '@/modules/productivity/productivity-service';
import { productivityError } from '@/modules/productivity/productivity-errors';
import type { AgendaItemType, AgendaView } from '@/modules/productivity/productivity-types';

export async function GET(request: Request) {
  return readSchedulingFromRequest(
    request,
    (actor) => {
      const sp = new URL(request.url).searchParams;
      const rawTypes = sp.getAll('types').flatMap((v) => v.split(',')).filter(Boolean);
      return listAgenda(actor, {
        ...(sp.get('view') ? { view: sp.get('view') as AgendaView } : {}),
        ...(sp.get('anchorDate') ? { anchorDate: sp.get('anchorDate')! } : {}),
        ...(sp.get('courtId') ? { courtId: sp.get('courtId')! } : {}),
        ...(rawTypes.length > 0 ? { types: rawTypes as AgendaItemType[] } : {}),
        ...(sp.get('includeCompleted') === 'true' ? { includeCompleted: true } : {}),
      });
    },
    productivityError
  );
}