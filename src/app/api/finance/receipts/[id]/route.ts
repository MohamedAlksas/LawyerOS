import { readFinanceFromRequest } from '@/modules/finance/finance-http';
import { reprintReceipt } from '@/modules/finance/finance-service';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return readFinanceFromRequest(request, (actor) => reprintReceipt(actor, id));
}