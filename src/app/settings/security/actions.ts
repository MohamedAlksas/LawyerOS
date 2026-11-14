'use server';

import { requireActor } from '@/modules/identity/require-actor';
import {
  listActiveSessions,
  revokeSession,
  revokeOtherSessions,
  regenerateRecoveryCodes,
} from '@/modules/identity';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';

export type SecurityActionErrorCode =
  | 'INVALID_PASSWORD'
  | 'LOCKED'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ERROR';

export type RevokeSessionResult =
  | { success: true }
  | { success: false; code: SecurityActionErrorCode; message: string };

export type RevokeOtherSessionsResult =
  | { success: true; count: number }
  | { success: false; code: SecurityActionErrorCode; message: string };

export type RegenerateBackupCodesResult =
  | { success: true; backupCodes: string[] }
  | {
      success: false;
      code: SecurityActionErrorCode;
      message: string;
      remainingAttempts?: number;
    };

export async function getSecurityOverview() {
  const actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
  const sessions = await listActiveSessions(actor.id, actor.sessionId);

  return {
    actor: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      role: actor.role,
      twoFactorVerified: actor.twoFactorVerified,
    },
    sessions: sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress || 'غير معروف',
      userAgent: s.userAgent || 'متصفح غير معروف',
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      isCurrent: s.isCurrent,
    })),
  };
}

export async function revokeSessionAction(
  sessionId: string
): Promise<RevokeSessionResult> {
  try {
    if (!sessionId || typeof sessionId !== 'string') {
      return {
        success: false,
        code: 'ERROR',
        message: 'معرّف الجلسة غير صالح.',
      };
    }

    const actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
    await revokeSession(sessionId, actor);
    return { success: true };
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return {
        success: false,
        code: 'UNAUTHENTICATED',
        message: err.message || 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول.',
      };
    }
    if (err instanceof AuthorizationError) {
      return {
        success: false,
        code: 'FORBIDDEN',
        message: err.message || 'غير مصرح للقيام بهذه العملية.',
      };
    }
    return {
      success: false,
      code: 'ERROR',
      message: 'حدث خطأ أثناء إنهاء الجلسة. يرجى المحاولة لاحقاً.',
    };
  }
}

export async function revokeOtherSessionsAction(): Promise<RevokeOtherSessionsResult> {
  try {
    const actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
    const count = await revokeOtherSessions(actor);
    return { success: true, count };
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return {
        success: false,
        code: 'UNAUTHENTICATED',
        message: err.message || 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول.',
      };
    }
    if (err instanceof AuthorizationError) {
      return {
        success: false,
        code: 'FORBIDDEN',
        message: err.message || 'غير مصرح للقيام بهذه العملية.',
      };
    }
    return {
      success: false,
      code: 'ERROR',
      message: 'حدث خطأ أثناء إنهاء الجلسات الأخرى. يرجى المحاولة لاحقاً.',
    };
  }
}

export async function regenerateBackupCodesAction(
  currentPassword: string
): Promise<RegenerateBackupCodesResult> {
  try {
    if (!currentPassword || typeof currentPassword !== 'string' || currentPassword.trim().length === 0) {
      return {
        success: false,
        code: 'INVALID_PASSWORD',
        message: 'كلمة المرور الحالية مطلوبة لتأكيد الهوية.',
      };
    }

    const actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
    const freshBackupCodes = await regenerateRecoveryCodes(actor, currentPassword);

    return {
      success: true,
      backupCodes: freshBackupCodes,
    };
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      if (err.code === 'RATE_LIMITED' || err.code === 'ACCOUNT_LOCKED') {
        return {
          success: false,
          code: 'LOCKED',
          message:
            err.message ||
            'تم تجاوز الحد الأقصى للمحاولات غير الصحيحة. تم قفل الإجراء مؤقتاً لمدة 15 دقيقة.',
        };
      }
      if (err.code === 'INVALID_CREDENTIALS') {
        const match = err.message.match(/المحاولات المتبقية:\s*(\d+)/);
        const remainingAttempts = match ? parseInt(match[1], 10) : undefined;
        return {
          success: false,
          code: 'INVALID_PASSWORD',
          message: err.message || 'كلمة المرور الحالية غير صحيحة.',
          remainingAttempts,
        };
      }
      if (
        err.code === 'UNAUTHENTICATED' ||
        err.code === 'SESSION_EXPIRED' ||
        err.code === 'SESSION_INACTIVE'
      ) {
        return {
          success: false,
          code: 'UNAUTHENTICATED',
          message: err.message || 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول.',
        };
      }
      return {
        success: false,
        code: 'ERROR',
        message: err.message,
      };
    }

    if (err instanceof AuthorizationError) {
      return {
        success: false,
        code: 'FORBIDDEN',
        message: err.message || 'غير مصرح لك بإدارة إعدادات الأمان.',
      };
    }

    return {
      success: false,
      code: 'ERROR',
      message: 'حدث خطأ غير متوقع أثناء إعادة توليد الرموز. يرجى المحاولة لاحقاً.',
    };
  }
}