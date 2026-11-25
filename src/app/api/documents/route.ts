import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  requireDocumentActor,
  verifyDocumentReadOrigin,
} from '@/modules/documents/document-http';
import { listDocuments } from '@/modules/documents/document-service';
import { DocumentValidationError, type DocumentType } from '@/modules/documents/document-types';

/** Absent/blank -> undefined; anything but a plain non-negative integer is rejected (range is enforced by the list schema). */
function parseIntegerParam(sp: URLSearchParams, name: 'page' | 'limit'): number | undefined {
  const raw = sp.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!/^\d{1,9}$/.test(trimmed)) {
    throw new DocumentValidationError('معايير البحث في المستندات غير صالحة.', {
      [name]: 'يجب أن تكون القيمة رقماً صحيحاً.',
    });
  }
  return Number(trimmed);
}

function parseBooleanParam(sp: URLSearchParams, name: 'includeArchived'): boolean | undefined {
  const raw = sp.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  throw new DocumentValidationError('معايير البحث في المستندات غير صالحة.', {
    [name]: 'القيمة يجب أن تكون true أو false.',
  });
}

export async function GET(request: Request) {
  const originRejection = verifyDocumentReadOrigin(request);
  if (originRejection) return originRejection;

  try {
    const actor = await requireDocumentActor(request, 'READ_CLIENT_DATA');
    const sp = new URL(request.url).searchParams;
    const page = parseIntegerParam(sp, 'page');
    const limit = parseIntegerParam(sp, 'limit');
    const includeArchived = parseBooleanParam(sp, 'includeArchived');

    const data = await listDocuments(actor, {
      ...(sp.get('matterId') ? { matterId: sp.get('matterId')! } : {}),
      ...(sp.get('partyId') ? { partyId: sp.get('partyId')! } : {}),
      ...(sp.get('proceedingId') ? { proceedingId: sp.get('proceedingId')! } : {}),
      ...(sp.get('hearingId') ? { hearingId: sp.get('hearingId')! } : {}),
      ...(sp.get('documentType') ? { documentType: sp.get('documentType') as DocumentType } : {}),
      ...(sp.get('q') ? { q: sp.get('q')! } : {}),
      ...(includeArchived !== undefined ? { includeArchived } : {}),
      ...(page !== undefined ? { page } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    return NextResponse.json({ success: true, data }, { headers: DOCUMENT_NO_STORE_HEADERS });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
