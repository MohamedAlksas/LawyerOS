import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  requireDocumentActor,
  verifyDocumentReadOrigin,
} from '@/modules/documents/document-http';
import { listDocuments } from '@/modules/documents/document-service';
import type { DocumentType } from '@/modules/documents/document-types';

export async function GET(request: Request) {
  const originRejection = verifyDocumentReadOrigin(request);
  if (originRejection) return originRejection;

  try {
    const actor = await requireDocumentActor(request, 'READ_CLIENT_DATA');
    const sp = new URL(request.url).searchParams;
    const rawPage = sp.get('page');
    const rawLimit = sp.get('limit');
    const parsedPage = rawPage ? Number(rawPage) : undefined;
    const parsedLimit = rawLimit ? Number(rawLimit) : undefined;

    const data = await listDocuments(actor, {
      ...(sp.get('matterId') ? { matterId: sp.get('matterId')! } : {}),
      ...(sp.get('partyId') ? { partyId: sp.get('partyId')! } : {}),
      ...(sp.get('proceedingId') ? { proceedingId: sp.get('proceedingId')! } : {}),
      ...(sp.get('hearingId') ? { hearingId: sp.get('hearingId')! } : {}),
      ...(sp.get('documentType') ? { documentType: sp.get('documentType') as DocumentType } : {}),
      ...(sp.get('q') ? { q: sp.get('q')! } : {}),
      ...(sp.get('includeArchived') === 'true' ? { includeArchived: true } : {}),
      ...(parsedPage !== undefined && Number.isFinite(parsedPage) ? { page: parsedPage } : {}),
      ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
    });

    return NextResponse.json({ success: true, data }, { headers: DOCUMENT_NO_STORE_HEADERS });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
