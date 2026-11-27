import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  requireDocumentActor,
  verifyDocumentReadOrigin,
} from '@/modules/documents/document-http';
import { getUploadAttempt } from '@/modules/documents/document-service';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  try {
    const originRejection = verifyDocumentReadOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireDocumentActor(request, 'READ_DOCUMENTS');
    const { attemptId } = await params;
    const data = await getUploadAttempt(actor, attemptId);
    return NextResponse.json({ success: true, data }, { headers: DOCUMENT_NO_STORE_HEADERS });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
