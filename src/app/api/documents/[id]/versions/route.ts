import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  parseJsonMutationBody,
  requireDocumentActor,
  verifyDocumentMutationOrigin,
} from '@/modules/documents/document-http';
import { beginVersionUpload } from '@/modules/documents/document-service';
import { DocumentValidationError, type BeginVersionUploadInput } from '@/modules/documents/document-types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originRejection = verifyDocumentMutationOrigin(request);
  if (originRejection) return originRejection;

  try {
    const actor = await requireDocumentActor(request, 'WRITE_DOCUMENTS');
    const { id } = await params;
    const body = await parseJsonMutationBody(request);
    if ('documentId' in body && body.documentId !== id) {
      throw new DocumentValidationError('معرف المستند لا يطابق المسار.');
    }

    const input: BeginVersionUploadInput = {
      ...(body as Omit<BeginVersionUploadInput, 'documentId'>),
      documentId: id,
    };
    const data = await beginVersionUpload(actor, input);
    return NextResponse.json(
      { success: true, data },
      { status: 201, headers: DOCUMENT_NO_STORE_HEADERS }
    );
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
