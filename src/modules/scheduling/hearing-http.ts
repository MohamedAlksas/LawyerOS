import { NextResponse } from 'next/server';
import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import type { Actor } from '@/modules/identity/types';
import { hearingError } from './hearing-errors';
import { isCrossSiteRequest, statusFromErrorCode } from './deadline-http';
import { SchedulingValidationError } from './hearing-types';

const headers = { 'Cache-Control': 'private, no-store' };

export async function writeHearingFromRequest<T extends { hearingId: string }, R>(
  request: Request, id: string, command: (actor: Actor, input: T) => Promise<R>,
) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || !getTrustedOrigins().has(origin) || isCrossSiteRequest(request)) {
      return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'مصدر الطلب غير موثوق.' }, { status: 403, headers });
    }
    const actor = await requireActor({ headers: request.headers, requiredPermission: 'WRITE_CLIENT_DATA' });
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      throw new SchedulingValidationError('صيغة البيانات غير صحيحة.');
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || ('hearingId' in body && body.hearingId !== id)) {
      throw new SchedulingValidationError('بيانات الجلسة لا تطابق الطلب.');
    }
    const data = await command(actor, { ...body, hearingId: id } as T);
    return NextResponse.json({ success: true, data }, { headers });
  } catch (error) {
    const problem = hearingError(error);
    const code = !problem.success ? problem.code : 'INTERNAL_ERROR';
    return NextResponse.json(problem, { status: statusFromErrorCode(code), headers });
  }
}
