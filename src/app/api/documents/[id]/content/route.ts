import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import {
  documentHttpErrorResponse,
  requireDocumentActor,
  verifyDocumentReadOrigin,
} from '@/modules/documents/document-http';
import { authorizeDownload } from '@/modules/documents/document-service';
import { DocumentValidationError } from '@/modules/documents/document-types';

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
      requestId: request.headers.get('x-request-id'),
    });

    const nodeStream = authorized.openStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
      status: 200,
      headers: authorized.headers,
    });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
