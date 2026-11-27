import { readFinanceFromRequest } from '@/modules/finance/finance-http';
import { getClientStatement } from '@/modules/finance/finance-service';

export async function GET(request: Request) {
  return readFinanceFromRequest(request, (actor) => {
    const sp = new URL(request.url).searchParams;
    return getClientStatement(actor, {
      ...(sp.get('matterId') ? { matterId: sp.get('matterId')! } : {}),
      ...(sp.get('partyId') ? { partyId: sp.get('partyId')! } : {}),
      ...(sp.get('clientMatterPartyId')
        ? { clientMatterPartyId: sp.get('clientMatterPartyId')! }
        : {}),
    });
  });
}