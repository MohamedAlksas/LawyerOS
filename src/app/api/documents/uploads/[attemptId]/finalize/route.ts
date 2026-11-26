import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  parseJsonMutationBody,
  requireDocumentActor,
  verifyDocumentMutationOrigin,
} from '@/modules/documents/document-http';
import { finalizeUpload } from '@/modules/documents/document-service';
import { DocumentValidationError, type FinalizeUploadInput } from '@/modules/documents/document-types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const originRejection = verifyDocumentMutationOrigin(request);
  if (originRejection) return originRejection;

  try {
    const actor = await requireDocumentActor(request, 'WRITE_DOCUMENTS');
    const { attemptId } = await params;

    const rawContentType = request.headers.get('content-type');
    let body: Record<string, unknown> = {};
    if (rawContentType) {
      body = await parseJsonMutationBody(request);
      if ('attemptId' in body && body.attemptId !== attemptId) {
        throw new DocumentValidationError('معرف محاولة الرفع لا يطابق المسار.');
      }
    }

    const input: FinalizeUploadInput = {
      ...(body as Omit<FinalizeUploadInput, 'attemptId'>),
      attemptId,
    };

    const data = await finalizeUpload(actor, input);
    return NextResponse.json({ success: true, data }, { headers: DOCUMENT_NO_STORE_HEADERS });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
