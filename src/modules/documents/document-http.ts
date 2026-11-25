import { NextResponse } from 'next/server';
import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import type { Actor, Permission } from '@/modules/identity/types';
import { documentError, documentStatusFromErrorCode } from './document-errors';
import { DocumentValidationError, MAX_DOCUMENT_BYTES } from './document-types';

export const DOCUMENT_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function documentHttpErrorResponse(error: unknown) {
  const problem = documentError(error);
  const code = !problem.success ? problem.code : 'INTERNAL_ERROR';
  return NextResponse.json(problem, {
    status: documentStatusFromErrorCode(code),
    headers: DOCUMENT_NO_STORE_HEADERS,
  });
}

function isCrossSiteRequest(request: Request): boolean {
  return request.headers.get('sec-fetch-site')?.trim().toLowerCase() === 'cross-site';
}

export function verifyDocumentReadOrigin(request: Request): NextResponse | null {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'غير مصرح بالوصول من مصدر خارجي.' },
      { status: 403, headers: DOCUMENT_NO_STORE_HEADERS }
    );
  }
  return null;
}

export function verifyDocumentMutationOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  if (
    !origin ||
    !getTrustedOrigins().has(origin) ||
    isCrossSiteRequest(request)
  ) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'مصدر الطلب غير موثوق.' },
      { status: 403, headers: DOCUMENT_NO_STORE_HEADERS }
    );
  }
  return null;
}

export async function requireDocumentActor(
  request: Request,
  requiredPermission: Permission
): Promise<Actor> {
  return await requireActor({
    headers: request.headers,
    requiredPermission,
  });
}

export async function parseJsonMutationBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new DocumentValidationError('صيغة البيانات غير صحيحة (يجب إرسال JSON).');
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DocumentValidationError('بيانات الطلب غير صالحة.');
  }
  return body as Record<string, unknown>;
}

export async function* readBoundedRequestBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number = MAX_DOCUMENT_BYTES
): AsyncGenerator<Uint8Array> {
  if (!body) {
    throw new DocumentValidationError('محتوى الملف فارغ (0 بايت).');
  }

  const reader = body.getReader();
  let totalBytes = 0;
  let receivedAnyBytes = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      receivedAnyBytes = true;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new DocumentValidationError(
          'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).',
          { file: 'حجم الملف يتجاوز 25 ميجابايت' },
          'PAYLOAD_TOO_LARGE'
        );
      }

      yield value;
    }

    if (!receivedAnyBytes || totalBytes === 0) {
      throw new DocumentValidationError('محتوى الملف فارغ (0 بايت).');
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore already released lock
    }
  }
}
