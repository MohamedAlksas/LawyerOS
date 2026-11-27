import { writeFinanceFromRequest } from '@/modules/finance/finance-http';
import { postTransaction } from '@/modules/finance/finance-service';

export async function POST(request: Request) {
  return writeFinanceFromRequest(request, postTransaction);
}