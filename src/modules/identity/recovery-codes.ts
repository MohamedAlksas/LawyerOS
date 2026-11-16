import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { verifyPassword, symmetricEncrypt, generateRandomString } from 'better-auth/crypto';
import { Actor, AuthenticationError } from './types';
import { assertAuthorized } from './authorize';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function regenerateRecoveryCodes(
  actor: Actor,
  currentPassword: string
): Promise<string[]> {
  if (!currentPassword || typeof currentPassword !== 'string' || currentPassword.trim().length === 0) {
    throw new AuthenticationError('INVALID_CREDENTIALS', 'كلمة المرور الحالية مطلوبة لتأكيد الهوية.');
  }

  assertAuthorized(actor, 'MANAGE_SECURITY');

  const prisma = getPrismaClient();
  const env = getEnv();

  interface TwoFactorRow {
    id: string;
    userId: string;
    secret: string;
    backupCodes: string;
    failedVerificationCount: number;
    lockedUntil: Date | null;
  }

  type TxResult =
    | { status: 'NO_MFA' }
    | { status: 'LOCKED' }
    | { status: 'NO_ACCOUNT' }
    | { status: 'INVALID_PASSWORD'; shouldLock: boolean; remainingAttempts: number }
    | { status: 'SUCCESS'; freshBackupCodes: string[] };

  const outcome = await prisma.$transaction(async (tx): Promise<TxResult> => {
    // Acquire row-level lock on twoFactor record to serialize concurrent attempts (R09)
    const rows = await tx.$queryRawUnsafe<TwoFactorRow[]>(
      `SELECT id, "userId", secret, "backupCodes", "failedVerificationCount", "lockedUntil"
       FROM "twoFactor"
       WHERE "userId" = $1
       FOR UPDATE`,
      actor.id
    );

    const twoFactorRecord = rows[0];
    if (!twoFactorRecord) {
      return { status: 'NO_MFA' };
    }

    const now = new Date();
    if (twoFactorRecord.lockedUntil && new Date(twoFactorRecord.lockedUntil) > now) {
      return { status: 'LOCKED' };
    }

    const account = await tx.account.findFirst({
      where: {
        userId: actor.id,
        providerId: 'credential',
      },
    });

    if (!account || !account.password) {
      return { status: 'NO_ACCOUNT' };
    }

    const isValid = await verifyPassword({
      hash: account.password,
      password: currentPassword,
    });

    if (!isValid) {
      const currentCount = Number(twoFactorRecord.failedVerificationCount) || 0;
      const newCount = currentCount + 1;
      const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
      const lockUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

      await tx.twoFactor.update({
        where: { id: twoFactorRecord.id },
        data: {
          failedVerificationCount: newCount,
          lockedUntil: lockUntil,
        },
      });

      return {
        status: 'INVALID_PASSWORD',
        shouldLock,
        remainingAttempts: MAX_FAILED_ATTEMPTS - newCount,
      };
    }

    const freshBackupCodes: string[] = Array.from({ length: 10 }).map(() => {
      const raw = generateRandomString(10, 'a-z', '0-9', 'A-Z');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });

    const encryptedBackupCodes = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: JSON.stringify(freshBackupCodes),
    });

    await tx.twoFactor.update({
      where: { id: twoFactorRecord.id },
      data: {
        backupCodes: encryptedBackupCodes,
        failedVerificationCount: 0,
        lockedUntil: null,
      },
    });

    return {
      status: 'SUCCESS',
      freshBackupCodes,
    };
  });

  if (outcome.status === 'NO_MFA') {
    throw new AuthenticationError(
      'MFA_REQUIRED',
      'لم يتم العثور على إعدادات التحقق الثنائي لهذا الحساب.'
    );
  }

  if (outcome.status === 'LOCKED') {
    throw new AuthenticationError(
      'RATE_LIMITED',
      `تم تجاوز الحد الأقصى للمحاولات غير الصحيحة (${MAX_FAILED_ATTEMPTS} محاولات). تم قفل الإجراء مؤقتاً لمدة 15 دقيقة.`
    );
  }

  if (outcome.status === 'NO_ACCOUNT') {
    throw new AuthenticationError('INVALID_CREDENTIALS', 'لا يمكن التحقق من بيانات الدخول.');
  }

  if (outcome.status === 'INVALID_PASSWORD') {
    if (outcome.shouldLock) {
      throw new AuthenticationError(
        'RATE_LIMITED',
        `تم تجاوز الحد الأقصى للمحاولات غير الصحيحة (${MAX_FAILED_ATTEMPTS} محاولات). تم قفل الإجراء مؤقتاً لمدة 15 دقيقة.`
      );
    }

    throw new AuthenticationError(
      'INVALID_CREDENTIALS',
      `كلمة المرور الحالية غير صحيحة. المحاولات المتبقية: ${outcome.remainingAttempts}.`
    );
  }

  return outcome.freshBackupCodes;
}
