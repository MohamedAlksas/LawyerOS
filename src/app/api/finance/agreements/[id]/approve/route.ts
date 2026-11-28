import { writeFinanceFromRequest } from '@/modules/finance/finance-http';
import { approveFeeAgreement } from '@/modules/finance/finance-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return writeFinanceFromRequest(request, approveFeeAgreement, {
    pathIdKey: 'feeAgreementId',
    pathIdValue: id,
  });
}