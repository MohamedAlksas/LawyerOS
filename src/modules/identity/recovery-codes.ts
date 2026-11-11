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

  const twoFactorRecord = await prisma.twoFactor.findFirst({
    where: { userId: actor.id },
  });

  if (!twoFactorRecord) {
    throw new AuthenticationError(
      'MFA_REQUIRED',
      'لم يتم العثور على إعدادات التحقق الثنائي لهذا الحساب.'
    );
  }

  const now = new Date();

  if (twoFactorRecord.lockedUntil && twoFactorRecord.lockedUntil > now) {
    const remainingMinutes = Math.ceil(
      (twoFactorRecord.lockedUntil.getTime() - now.getTime()) / (60 * 1000)
    );
    throw new AuthenticationError(
      'RATE_LIMITED',
      `تم تجاوز الحد الأقصى للمحاولات غير الصحيحة (${MAX_FAILED_ATTEMPTS} محاولات). الحساب مقفل مؤقتاً لمدة ${remainingMinutes} دقيقة.`
    );
  }

  const account = await prisma.account.findFirst({
    where: {
      userId: actor.id,
      providerId: 'credential',
    },
  });

  if (!account || !account.password) {
    throw new AuthenticationError('INVALID_CREDENTIALS', 'لا يمكن التحقق من بيانات الدخول.');
  }

  const isValid = await verifyPassword({
    hash: account.password,
    password: currentPassword,
  });

  if (!isValid) {
    const newCount = twoFactorRecord.failedVerificationCount + 1;
    const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
    const lockUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

    await prisma.twoFactor.update({
      where: { id: twoFactorRecord.id },
      data: {
        failedVerificationCount: newCount,
        lockedUntil: lockUntil,
      },
    });

    if (shouldLock) {
      throw new AuthenticationError(
        'RATE_LIMITED',
        `تم تجاوز الحد الأقصى للمحاولات غير الصحيحة (${MAX_FAILED_ATTEMPTS} محاولات). تم قفل الإجراء مؤقتاً لمدة 15 دقيقة.`
      );
    }

    throw new AuthenticationError(
      'INVALID_CREDENTIALS',
      `كلمة المرور الحالية غير صحيحة. المحاولات المتبقية: ${MAX_FAILED_ATTEMPTS - newCount}.`
    );
  }

  const freshBackupCodes: string[] = Array.from({ length: 10 }).map(() => {
    const raw = generateRandomString(10, 'a-z', '0-9', 'A-Z');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

  const encryptedBackupCodes = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: JSON.stringify(freshBackupCodes),
  });

  await prisma.twoFactor.update({
    where: { id: twoFactorRecord.id },
    data: {
      backupCodes: encryptedBackupCodes,
      failedVerificationCount: 0,
      lockedUntil: null,
    },
  });

  return freshBackupCodes;
}
