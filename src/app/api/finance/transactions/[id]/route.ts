import { NextResponse } from 'next/server';
import {
  FINANCE_NO_STORE_HEADERS,
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
    await updatePostedTransaction(actor, { transactionId: id });
    return NextResponse.json(
      { success: false, code: 'IMMUTABLE_POSTED_RECORD', error: 'السجلات المالية المرحلة غير قابلة للتعديل.' },
      { status: 409, headers: FINANCE_NO_STORE_HEADERS }
    );
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
    await deletePostedTransaction(actor, { transactionId: id });
    return NextResponse.json(
      { success: false, code: 'IMMUTABLE_POSTED_RECORD', error: 'السجلات المالية المرحلة غير قابلة للحذف.' },
      { status: 409, headers: FINANCE_NO_STORE_HEADERS }
    );
  } catch (error) {
    return financeHttpErrorResponse(error);
  }
}