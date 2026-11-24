import { NextResponse } from 'next/server';
import {
  DOCUMENT_NO_STORE_HEADERS,
  documentHttpErrorResponse,
  readBoundedRequestBody,
  requireDocumentActor,
  verifyDocumentMutationOrigin,
} from '@/modules/documents/document-http';
import { uploadAttemptBytes } from '@/modules/documents/document-service';
import { DocumentValidationError, MAX_DOCUMENT_BYTES } from '@/modules/documents/document-types';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  const originRejection = verifyDocumentMutationOrigin(request);
  if (originRejection) return originRejection;

  try {
    const actor = await requireDocumentActor(request, 'WRITE_CLIENT_DATA');
    const { attemptId } = await params;

    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (
      contentType === 'multipart/form-data' ||
      contentType === 'application/x-www-form-urlencoded'
    ) {
      throw new DocumentValidationError(
        'يجب إرسال محتوى الملف الخام مباشرة (وليس عبر نموذج متعدد الأجزاء).'
      );
    }

    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader !== null) {
      const parsedLength = Number(contentLengthHeader.trim());
      if (!Number.isInteger(parsedLength) || parsedLength < 0) {
        throw new DocumentValidationError('ترويسة طول المحتوى (Content-Length) غير صالحة.');
      }
      if (parsedLength === 0) {
        throw new DocumentValidationError('محتوى الملف فارغ (0 بايت).');
      }
      if (parsedLength > MAX_DOCUMENT_BYTES) {
        throw new DocumentValidationError(
          'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).',
          { file: 'حجم الملف يتجاوز 25 ميجابايت' },
          'PAYLOAD_TOO_LARGE'
        );
      }
    }

    const boundedStream = readBoundedRequestBody(request.body, MAX_DOCUMENT_BYTES);
    const data = await uploadAttemptBytes(actor, attemptId, boundedStream);

    return NextResponse.json({ success: true, data }, { headers: DOCUMENT_NO_STORE_HEADERS });
  } catch (error) {
    return documentHttpErrorResponse(error);
  }
}
