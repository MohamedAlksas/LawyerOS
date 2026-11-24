import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import {
  documentHttpErrorResponse,
  requireDocumentActor,
  verifyDocumentReadOrigin,
} from '@/modules/documents/document-http';
import { authorizeDownload } from '@/modules/documents/document-service';
import { DocumentValidationError } from '@/modules/documents/document-types';

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function sanitizeRequestId(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return REQUEST_ID_RE.test(trimmed) ? trimmed : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originRejection = verifyDocumentReadOrigin(request);
  if (originRejection) return originRejection;

  try {
    const actor = await requireDocumentActor(request, 'READ_CLIENT_DATA');
    const { id } = await params;
    const sp = new URL(request.url).searchParams;

    const rawDisposition = sp.get('disposition');
    let disposition: 'inline' | 'attachment' = 'attachment';
    if (rawDisposition !== null) {
      if (rawDisposition !== 'inline' && rawDisposition !== 'attachment') {
        throw new DocumentValidationError('معامل طريقة العرض (disposition) غير صالح.');
      }
      disposition = rawDisposition;
    }

    const versionId = sp.get('versionId') || undefined;
    const authorized = await authorizeDownload(actor, id, versionId, {
      disposition,
      requestId: sanitizeRequestId(request.headers.get('x-request-id')),
    });

    const nodeStream = await authorized.openStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
      status: 200,
      headers: authorized.headers,
    });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}

// HEAD must not run the download audit or open a file stream.
export function HEAD() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: 'GET', 'Cache-Control': 'private, no-store' },
  });
}
