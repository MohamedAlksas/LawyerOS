import {
  financeHttpErrorResponse,
  verifyFinanceMutationOrigin,
} from '@/modules/finance/finance-http';
import {
  deletePostedTransaction,
  updatePostedTransaction,
} from '@/modules/finance/finance-service';
import { requireActor } from '@/modules/identity/require-actor';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const originRejection = verifyFinanceMutationOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireActor({
      headers: request.headers,
      requiredPermission: 'WRITE_FINANCE',
    });
    const { id } = await params;
    return await updatePostedTransaction(actor, { transactionId: id });
  } catch (error) {
    return financeHttpErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const originRejection = verifyFinanceMutationOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireActor({
      headers: request.headers,
      requiredPermission: 'WRITE_FINANCE',
    });
    const { id } = await params;
    return await deletePostedTransaction(actor, { transactionId: id });
  } catch (error) {
    return financeHttpErrorResponse(error);
  }
}