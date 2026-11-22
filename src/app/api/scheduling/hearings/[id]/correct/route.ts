import { NextRequest, NextResponse } from 'next/server';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { correctHearingResult } from '@/modules/scheduling/hearing-service';
import {
  ConcurrencyConflictError,
  NotFoundError,
  SchedulingValidationError,
  CorrectHearingResultInput,
} from '@/modules/scheduling/hearing-types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ success: false, error: 'غير مسجل الدخول' }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
    }
    return NextResponse.json({ success: false, error: 'خطأ في المصادقة' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة البيانات غير صحيحة' }, { status: 400 });
  }

  body.hearingId = id;

  try {
    const result = await correctHearingResult(actor, body as unknown as CorrectHearingResultInput);
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ConcurrencyConflictError) {
      return NextResponse.json(
        {
          success: false,
          error: 'تم تعديل هذا السجل بواسطة مستخدم آخر، يرجى تحديث الصفحة',
          code: 'CONCURRENCY_CONFLICT',
        },
        { status: 409 }
      );
    }

    if (error instanceof SchedulingValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          fieldErrors: error.fieldErrors,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    if (error instanceof NotFoundError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: 'NOT_FOUND',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'تعذر تصحيح نتيجة الجلسة',
      },
      { status: 500 }
    );
  }
}
