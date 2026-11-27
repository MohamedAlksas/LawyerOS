import {
  parseFinanceIntegerParam,
  readFinanceFromRequest,
} from '@/modules/finance/finance-http';
import { listFinanceOverview } from '@/modules/finance/finance-service';

export async function GET(request: Request) {
  return readFinanceFromRequest(request, (actor) => {
    const sp = new URL(request.url).searchParams;
    const page = parseFinanceIntegerParam(sp, 'page');
    const limit = parseFinanceIntegerParam(sp, 'limit');

    return listFinanceOverview(actor, {
      ...(sp.get('matterId') ? { matterId: sp.get('matterId')! } : {}),
      ...(sp.get('q') ? { q: sp.get('q')! } : {}),
      ...(page !== undefined ? { page } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  });
}