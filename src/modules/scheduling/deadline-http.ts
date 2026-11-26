import { NextResponse } from 'next/server';
import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import type { Actor } from '@/modules/identity/types';
import { hearingError } from './hearing-errors';
import { SchedulingValidationError, type ActionResult } from './deadline-types';

const PRIVATE_NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export function statusFromErrorCode(code: string | undefined): number {
  if (code === 'FORBIDDEN' || code === 'CROSS_MATTER_LINK_FORBIDDEN') return 403;
  if (['UNAUTHENTICATED', 'MFA_REQUIRED', 'SESSION_EXPIRED', 'SESSION_INACTIVE'].includes(code ?? '')) {
    return 401;
  }
  if (
    [
      'CONCURRENCY_CONFLICT',
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      'IDEMPOTENCY_CONCURRENT_CONFLICT',
      'DOCUMENT_NOT_READY',
    ].includes(code ?? '')
  ) {
    return 409;
  }
  if (code === 'NOT_FOUND') return 404;
  if (code === 'INTERNAL_ERROR') return 500;
  return 400;
}

export function schedulingHttpErrorResponse(error: unknown, mapper: (err: unknown) => ActionResult<never> = hearingError) {
  const problem = mapper(error);
  const code = !problem.success ? problem.code : 'INTERNAL_ERROR';
  return NextResponse.json(problem, {
    status: statusFromErrorCode(code),
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export function isCrossSiteRequest(request: Request): boolean {
  return request.headers.get('sec-fetch-site')?.trim().toLowerCase() === 'cross-site';
}

export function parseQueryIntegerParam(sp: URLSearchParams, name: string): number | undefined {
  const raw = sp.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!/^\d{1,9}$/.test(trimmed)) {
    throw new SchedulingValidationError('معاملات البحث أو العرض غير صالحة.', {
      [name]: 'يجب أن تكون القيمة رقماً صحيحاً.',
    });
  }
  return Number(trimmed);
}

export function parseQueryBooleanParam(sp: URLSearchParams, name: string): boolean | undefined {
  const raw = sp.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  throw new SchedulingValidationError('معاملات البحث أو العرض غير صالحة.', {
    [name]: 'القيمة يجب أن تكون true أو false.',
  });
}

export async function readSchedulingFromRequest<R>(
  request: Request,
  query: (actor: Actor) => Promise<R>,
  mapper: (err: unknown) => ActionResult<never> = hearingError
) {
  try {
    if (isCrossSiteRequest(request)) {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'غير مصرح بالوصول من مصدر خارجي.' },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }
    const actor = await requireActor({
      headers: request.headers,
      requiredPermission: 'READ_CLIENT_DATA',
    });
    const data = await query(actor);
    return NextResponse.json({ success: true, data }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    return schedulingHttpErrorResponse(error, mapper);
  }
}

export async function writeSchedulingFromRequest<T, R>(
  request: Request,
  command: (actor: Actor, input: T) => Promise<R>,
  options: {
    pathIdKey?: string;
    pathIdValue?: string;
    mapper?: (err: unknown) => ActionResult<never>;
  } = {}
) {
  const mapper = options.mapper ?? hearingError;
  try {
    const origin = request.headers.get('origin');
    if (
      !origin ||
      !getTrustedOrigins().has(origin) ||
      isCrossSiteRequest(request)
    ) {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'مصدر الطلب غير موثوق.' },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

    const actor = await requireActor({
      headers: request.headers,
      requiredPermission: 'WRITE_CLIENT_DATA',
    });

    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new SchedulingValidationError('صيغة البيانات غير صحيحة (يجب إرسال JSON).');
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new SchedulingValidationError('بيانات الطلب غير صالحة.');
    }

    const payload: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    if (options.pathIdKey && options.pathIdValue) {
      if (options.pathIdKey in payload && payload[options.pathIdKey] !== options.pathIdValue) {
        throw new SchedulingValidationError('معرف السجل في الطلب لا يطابق المسار.');
      }
      payload[options.pathIdKey] = options.pathIdValue;
    }

    const data = await command(actor, payload as T);
    return NextResponse.json({ success: true, data }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    return schedulingHttpErrorResponse(error, mapper);
  }
}
