import { writeFinanceFromRequest } from '@/modules/finance/finance-http';
import { saveFeeAgreementDraft } from '@/modules/finance/finance-service';

export async function POST(request: Request) {
  return writeFinanceFromRequest(request, saveFeeAgreementDraft);
}