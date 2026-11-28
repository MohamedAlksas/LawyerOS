import { NextResponse } from 'next/server';
import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import type { Actor } from '@/modules/identity/types';
import { financeError } from './finance-errors';
import { FinanceValidationError } from './finance-types';

export const FINANCE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export const MAX_FINANCE_JSON_BYTES = 128 * 1024;
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

export function statusFromFinanceErrorCode(code: string | undefined): number {
  if (code === 'PAYLOAD_TOO_LARGE') return 413;
  if (code === 'FORBIDDEN' || code === 'CROSS_MATTER_LINK_FORBIDDEN') return 403;
  if (['UNAUTHENTICATED', 'MFA_REQUIRED', 'SESSION_EXPIRED', 'SESSION_INACTIVE'].includes(code ?? '')) {
    return 401;
  }
  if (
    [
      'CONCURRENCY_CONFLICT',
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      'IDEMPOTENCY_CONCURRENT_CONFLICT',
      'IMMUTABLE_POSTED_RECORD',
      'EXCESS_OVERPAYMENT',
      'ALREADY_POSTED',
      'MATTER_ARCHIVED',
      'UNSUPPORTED_TRANSITION',
      'DOCUMENT_NOT_READY',
    ].includes(code ?? '')
  ) {
    return 409;
  }
  if (code === 'NOT_FOUND') return 404;
  if (code === 'INTERNAL_ERROR') return 500;
  return 400;
}

export function financeHttpErrorResponse(error: unknown) {
  const problem = financeError(error);
  const code = !problem.success ? problem.code : 'INTERNAL_ERROR';
  return NextResponse.json(problem, {
    status: statusFromFinanceErrorCode(code),
    headers: FINANCE_NO_STORE_HEADERS,
  });
}

export function isCrossSiteRequest(request: Request): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  return Boolean(secFetchSite && !ALLOWED_FETCH_SITES.has(secFetchSite));
}

export function verifyFinanceReadOrigin(request: Request): NextResponse | null {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'غير مصرح بالوصول من مصدر خارجي.' },
      { status: 403, headers: FINANCE_NO_STORE_HEADERS }
    );
  }
  const origin = request.headers.get('origin');
  if (origin !== null && !getTrustedOrigins().has(origin)) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'مصدر الطلب غير موثوق.' },
      { status: 403, headers: FINANCE_NO_STORE_HEADERS }
    );
  }
  return null;
}

export function verifyFinanceMutationOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  if (!origin || !getTrustedOrigins().has(origin) || isCrossSiteRequest(request)) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'مصدر الطلب غير موثوق.' },
      { status: 403, headers: FINANCE_NO_STORE_HEADERS }
    );
  }
  return null;
}

export function parseFinanceIntegerParam(sp: URLSearchParams, name: string): number | undefined {
  const raw = sp.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!/^\d{1,9}$/.test(trimmed)) {
    throw new FinanceValidationError('معاملات البحث أو العرض غير صالحة.', {
      [name]: 'يجب أن تكون القيمة رقماً صحيحاً.',
    });
  }
  return Number(trimmed);
}

export async function readFinanceFromRequest<R>(
  request: Request,
  query: (actor: Actor) => Promise<R>
) {
  try {
    const originRejection = verifyFinanceReadOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireActor({
      headers: request.headers,
      requiredPermission: 'READ_FINANCE',
    });
    const data = await query(actor);
    return NextResponse.json({ success: true, data }, { headers: FINANCE_NO_STORE_HEADERS });
  } catch (error) {
    return financeHttpErrorResponse(error);
  }
}

async function readJsonBodyWithLimit(request: Request, maxBytes: number): Promise<unknown> {
  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new FinanceValidationError(
        'حجم بيانات الطلب المالي كبير جداً.',
        undefined,
        'PAYLOAD_TOO_LARGE'
      );
    }
  }

  let rawText: string;
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new FinanceValidationError(
            'حجم بيانات الطلب المالي كبير جداً.',
            undefined,
            'PAYLOAD_TOO_LARGE'
          );
        }
        chunks.push(value);
      }
    }
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    rawText = new TextDecoder('utf-8').decode(combined);
  } else {
    rawText = await request.text();
    if (Buffer.byteLength(rawText, 'utf8') > maxBytes) {
      throw new FinanceValidationError(
        'حجم بيانات الطلب المالي كبير جداً.',
        undefined,
        'PAYLOAD_TOO_LARGE'
      );
    }
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
}

export async function writeFinanceFromRequest<T, R>(
  request: Request,
  command: (actor: Actor, input: T) => Promise<R>,
  options: {
    pathIdKey?: string;
    pathIdValue?: string;
  } = {}
) {
  try {
    const originRejection = verifyFinanceMutationOrigin(request);
    if (originRejection) return originRejection;

    const actor = await requireActor({
      headers: request.headers,
      requiredPermission: 'WRITE_FINANCE',
    });

    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new FinanceValidationError('صيغة البيانات غير صحيحة (يجب إرسال JSON).');
    }

    const body = await readJsonBodyWithLimit(request, MAX_FINANCE_JSON_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new FinanceValidationError('بيانات الطلب غير صالحة.');
    }

    const payload: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    if (options.pathIdKey && options.pathIdValue) {
      if (options.pathIdKey in payload && payload[options.pathIdKey] !== options.pathIdValue) {
        throw new FinanceValidationError('معرف السجل في الطلب لا يطابق المسار.');
      }
      payload[options.pathIdKey] = options.pathIdValue;
    }

    const data = await command(actor, payload as T);
    return NextResponse.json({ success: true, data }, { headers: FINANCE_NO_STORE_HEADERS });
  } catch (error) {
    return financeHttpErrorResponse(error);
  }
}