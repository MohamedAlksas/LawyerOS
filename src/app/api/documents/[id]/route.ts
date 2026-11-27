import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  parseJsonMutationBody,
  requireDocumentActor,
  verifyDocumentMutationOrigin,
  verifyDocumentReadOrigin,
} from '@/modules/documents/document-http';
import { getDocumentDetail, updateDocumentMetadata } from '@/modules/documents/document-service';
import {
  DocumentValidationError,
  type UpdateDocumentMetadataInput,
} from '@/modules/documents/document-types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const originRejection = verifyDocumentReadOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireDocumentActor(request, 'READ_DOCUMENTS');
    const { id } = await params;
    const data = await getDocumentDetail(actor, id);
    return NextResponse.json({ success: true, data }, { headers: DOCUMENT_NO_STORE_HEADERS });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const originRejection = verifyDocumentMutationOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireDocumentActor(request, 'WRITE_DOCUMENTS');
    const { id } = await params;
    const body = await parseJsonMutationBody(request);
    if ('documentId' in body && body.documentId !== id) {
      throw new DocumentValidationError('معرف المستند لا يطابق المسار.');
    }

    const input: UpdateDocumentMetadataInput = {
      ...(body as Omit<UpdateDocumentMetadataInput, 'documentId'>),
      documentId: id,
    };
    const data = await updateDocumentMetadata(actor, input);
    return NextResponse.json({ success: true, data }, { headers: DOCUMENT_NO_STORE_HEADERS });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
