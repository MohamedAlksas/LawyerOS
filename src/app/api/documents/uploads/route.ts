import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  parseJsonMutationBody,
  requireDocumentActor,
  verifyDocumentMutationOrigin,
} from '@/modules/documents/document-http';
import { beginUpload } from '@/modules/documents/document-service';
import type { BeginUploadInput } from '@/modules/documents/document-types';

export async function POST(request: Request) {
  try {
    const originRejection = verifyDocumentMutationOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireDocumentActor(request, 'WRITE_DOCUMENTS');
    const body = await parseJsonMutationBody(request);
    const data = await beginUpload(actor, body as unknown as BeginUploadInput);
    return NextResponse.json(
      { success: true, data },
      { status: 201, headers: DOCUMENT_NO_STORE_HEADERS }
    );
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
