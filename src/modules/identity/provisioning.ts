import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { hashPassword, verifyPassword, symmetricEncrypt, symmetricDecrypt, generateRandomString } from 'better-auth/crypto';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { randomBytes, randomUUID } from 'crypto';
import { AuthenticationError, ProvisioningError } from './types';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface TwoFactorRow {
  id: string;
  userId: string;
  secret: string;
  backupCodes: string;
  failedVerificationCount: number;
  lockedUntil: Date | null;
  verified: boolean;
}

export interface ProvisionOwnerInput {
  name: string;
  email: string;
  password: string;
}

export interface ProvisionOwnerResult {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'OWNER';
  };
  totpSecret: string;
  totpURI: string;
  backupCodes: string[];
}

/**
 * Checks whether the office bootstrap is closed permanently.
 */
export async function isBootstrapClosed(): Promise<boolean> {
  const prisma = getPrismaClient();
  const bootstrap = await prisma.officeBootstrap.findUnique({ where: { id: 'singleton' } });
  return Boolean(bootstrap?.isClosed);
}

/**
 * Checks whether any completed OWNER account already exists in the system or bootstrap is closed.
 */
export async function hasAnyOwner(): Promise<boolean> {
  const prisma = getPrismaClient();
  const bootstrapClosed = await isBootstrapClosed();
  if (bootstrapClosed) {
    return true;
  }
  const count = await prisma.user.count({
    where: { role: 'OWNER' },
  });
  return count > 0;
}

/**
 * Controlled initial Owner provisioning without default/embedded credentials.
 * Fails closed if any completed owner account already exists or bootstrap was previously closed.
 * Allows controlled resumption if an uncompleted/pending owner setup exists and credentials match.
 * Uses PostgreSQL transaction advisory lock to guarantee race safety during concurrent bootstrap attempts.
 * Public sign-up remains strictly disabled.
 */
export async function provisionOwner(input: ProvisionOwnerInput): Promise<ProvisionOwnerResult> {
  const prisma = getPrismaClient();
  const env = getEnv();

  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  const password = input.password;

  if (!name || name.length < 2) {
    throw new ProvisioningError('INVALID_INPUT', 'الاسم يجب أن يحتوي على حرفين على الأقل.');
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProvisioningError('INVALID_INPUT', 'صيغة البريد الإلكتروني غير صالحة.');
  }

  if (!password || password.length < 8) {
    throw new ProvisioningError('INVALID_INPUT', 'كلمة المرور يجب أن لا تقل عن 8 أحرف.');
  }

  // Pre-check before transaction
  const bootstrapClosed = await isBootstrapClosed();
  if (bootstrapClosed) {
    throw new ProvisioningError(
      'BOOTSTRAP_ALREADY_CLOSED',
      'تم إغلاق مرحلة التهيئة الأولية للنظام مسبقاً وبشكل دائم. لا يمكن إعادة تهيئة المالك.'
    );
  }

  const existingOwner = await prisma.user.findFirst({
    where: { role: 'OWNER' },
    include: {
      accounts: { where: { providerId: 'credential' } },
      twoFactors: true,
    },
  });

  if (existingOwner) {
    const isCompleted = existingOwner.twoFactors[0]?.verified === true;
    if (isCompleted) {
      throw new ProvisioningError(
        'OWNER_ALREADY_EXISTS',
        'حساب المالك مهيأ بالفعل في النظام. لا يُسمح بإنشاء حساب مالك إضافي.'
      );
    }

    // Owner exists but is pending verification: Controlled resumption path
    if (existingOwner.email !== email) {
      throw new ProvisioningError(
        'OWNER_ALREADY_EXISTS',
        'يوجد بالفعل حساب مالك قيد الإعداد ببريد إلكتروني مختلف. لا يُسمح بإنشاء حساب مالك إضافي.'
      );
    }

    const credentialAccount = existingOwner.accounts[0];
    if (!credentialAccount?.password) {
      throw new ProvisioningError(
        'INVALID_INPUT',
        'بيانات حساب المالك المعلق غير مكتملة.'
      );
    }

    type ResumeTxResult =
      | { status: 'LOCKED' }
      | { status: 'NO_RECORD' }
      | { status: 'INVALID_PASSWORD'; shouldLock: boolean; remainingAttempts: number }
      | { status: 'SUCCESS'; result: ProvisionOwnerResult };

    const outcome = await prisma.$transaction(async (tx): Promise<ResumeTxResult> => {
      // Row lock on twoFactor record to serialize concurrent resumption attempts
      const rows = await tx.$queryRawUnsafe<TwoFactorRow[]>(
        `SELECT id, "userId", secret, "backupCodes", "failedVerificationCount", "lockedUntil", verified
         FROM "twoFactor"
         WHERE "userId" = $1
         FOR UPDATE`,
        existingOwner.id
      );

      const twoFactorRecord = rows[0];
      if (!twoFactorRecord || !twoFactorRecord.secret) {
        return { status: 'NO_RECORD' };
      }

      const now = new Date();
      if (twoFactorRecord.lockedUntil && new Date(twoFactorRecord.lockedUntil) > now) {
        return { status: 'LOCKED' };
      }

      const isPasswordValid = await verifyPassword({
        hash: credentialAccount.password!,
        password,
      });

      if (!isPasswordValid) {
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

      // Valid password: reset failure counter if previously elevated
      if (twoFactorRecord.failedVerificationCount > 0 || twoFactorRecord.lockedUntil) {
        await tx.twoFactor.update({
          where: { id: twoFactorRecord.id },
          data: {
            failedVerificationCount: 0,
            lockedUntil: null,
          },
        });
      }

      const decryptedSecret = await symmetricDecrypt({
        key: env.BETTER_AUTH_SECRET,
        data: twoFactorRecord.secret,
      });
      const rawBase32 = decryptedSecret.startsWith('base32:')
        ? decryptedSecret.slice(7)
        : decryptedSecret;
      const totpURI = `otpauth://totp/LawOffice%20OS:${encodeURIComponent(email)}?secret=${rawBase32}&issuer=LawOffice%20OS&digits=6&period=30`;

      let backupCodes: string[] = [];
      if (twoFactorRecord.backupCodes) {
        const decryptedBackup = await symmetricDecrypt({
          key: env.BETTER_AUTH_SECRET,
          data: twoFactorRecord.backupCodes,
        });
        backupCodes = JSON.parse(decryptedBackup);
      }

      return {
        status: 'SUCCESS',
        result: {
          user: {
            id: existingOwner.id,
            name: existingOwner.name,
            email: existingOwner.email,
            role: 'OWNER',
          },
          totpSecret: rawBase32,
          totpURI,
          backupCodes,
        },
      };
    });

    if (outcome.status === 'LOCKED') {
      throw new ProvisioningError(
        'ACCOUNT_LOCKED',
        'تم قفل محاولات استئناف الإعداد مؤقتاً لتجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). يرجى المحاولة بعد انتهاء مدة الحظر.'
      );
    }

    if (outcome.status === 'NO_RECORD') {
      throw new ProvisioningError(
        'INVALID_INPUT',
        'سجل المصادقة الثنائية غير موجود لحساب المالك المعلق.'
      );
    }

    if (outcome.status === 'INVALID_PASSWORD') {
      throw new ProvisioningError(
        outcome.shouldLock ? 'ACCOUNT_LOCKED' : 'INVALID_INPUT',
        outcome.shouldLock
          ? 'تم تجاوز الحد الأقصى لمحاولات كلمة المرور الخاطئة (5 محاولات). تم قفل الحساب لمدة 15 دقيقة.'
          : `كلمة المرور غير صحيحة لاستئناف إعداد حساب المالك المعلق. المحاولات المتبقية: ${outcome.remainingAttempts}.`
      );
    }

    return outcome.result;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });
  if (existingUser) {
    throw new ProvisioningError(
      'OWNER_ALREADY_EXISTS',
      'البريد الإلكتروني مسجل بالفعل لمستخدم آخر.'
    );
  }

  // Hash password using Better Auth standard password hashing
  const hashedPassword = await hashPassword(password);

  // Generate Base32 TOTP secret for authenticator apps (20 random bytes)
  const rawSecretBytes = randomBytes(20);
  const totpSecret = base32.encode(rawSecretBytes);
  const totpURI = `otpauth://totp/LawOffice%20OS:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=LawOffice%20OS&digits=6&period=30`;

  // Generate 10 single-use recovery backup codes
  const backupCodes: string[] = Array.from({ length: 10 }).map(() => {
    const raw = generateRandomString(10, 'a-z', '0-9', 'A-Z');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

  // Encrypt secrets using BETTER_AUTH_SECRET.
  // Prefix TOTP secret with "base32:" to match Better Auth's decryptTOTPSecret decoding behavior (R01).
  const encryptedTotpSecret = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: `base32:${totpSecret}`,
  });

  const encryptedBackupCodes = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: JSON.stringify(backupCodes),
  });

  const userId = randomUUID();

  // Every single owner reservation universally starts unverified with bootstrap open.
  // Genuine proof of possession via valid RFC 6238 TOTP code is strictly required to complete enrollment.
  const isVerified = false;

  // Execute inside transaction with advisory lock for strict atomicity and race prevention (R06)
  const createdUser = await prisma.$transaction(async (tx) => {
    // Acquire transaction-scoped advisory lock (released automatically on commit/rollback)
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(742910481234912);');

    // Re-verify bootstrap state inside the lock
    const lockedBootstrap = await tx.officeBootstrap.findUnique({ where: { id: 'singleton' } });
    if (lockedBootstrap?.isClosed) {
      throw new ProvisioningError(
        'BOOTSTRAP_ALREADY_CLOSED',
        'تم إغلاق مرحلة التهيئة الأولية للنظام مسبقاً وبشكل دائم. لا يمكن إعادة تهيئة المالك.'
      );
    }

    const checkInside = await tx.user.findFirst({ where: { role: 'OWNER' } });
    if (checkInside) {
      throw new ProvisioningError(
        'OWNER_ALREADY_EXISTS',
        'حساب المالك مهيأ بالفعل في النظام. لا يُسمح بإنشاء حساب مالك إضافي.'
      );
    }

    const user = await tx.user.create({
      data: {
        id: userId,
        name,
        email,
        emailVerified: true,
        role: 'OWNER',
        twoFactorEnabled: true,
      },
    });

    await tx.account.create({
      data: {
        id: randomUUID(),
        userId,
        providerId: 'credential',
        accountId: userId,
        password: hashedPassword,
      },
    });

    await tx.twoFactor.create({
      data: {
        id: randomUUID(),
        userId,
        secret: encryptedTotpSecret,
        backupCodes: encryptedBackupCodes,
        verified: isVerified,
      },
    });

    // Record bootstrap singleton row
    await tx.officeBootstrap.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        isClosed: isVerified,
        closedAt: new Date(),
        ownerId: userId,
      },
      update: {
        isClosed: isVerified,
        closedAt: new Date(),
        ownerId: userId,
      },
    });

    return user;
  });

  return {
    user: {
      id: createdUser.id,
      name: createdUser.name,
      email: createdUser.email,
      role: 'OWNER',
    },
    totpSecret,
    totpURI,
    backupCodes,
  };
}

/**
 * Confirms initial owner provisioning by verifying proof of possession of the authenticator key.
 * Upon valid RFC 6238 code verification, transitions twoFactor.verified to true and permanently closes bootstrap.
 */
export async function confirmOwnerProvisioning(userId: string, totpCode: string): Promise<void> {
  const prisma = getPrismaClient();
  const env = getEnv();

  const code = totpCode?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    throw new AuthenticationError('INVALID_CREDENTIALS', 'رمز التحقق يجب أن يتكون من 6 أرقام.');
  }

  type ConfirmTxResult =
    | { status: 'LOCKED' }
    | { status: 'NO_RECORD' }
    | { status: 'DECRYPT_FAIL' }
    | { status: 'INVALID_TOTP'; shouldLock: boolean; remainingAttempts: number }
    | { status: 'SUCCESS' };

  const outcome = await prisma.$transaction(async (tx): Promise<ConfirmTxResult> => {
    // Row lock on twoFactor record to serialize concurrent confirmation attempts
    const rows = await tx.$queryRawUnsafe<TwoFactorRow[]>(
      `SELECT id, "userId", secret, "backupCodes", "failedVerificationCount", "lockedUntil", verified
       FROM "twoFactor"
       WHERE "userId" = $1
       FOR UPDATE`,
      userId
    );

    const tfRecord = rows[0];
    if (!tfRecord) {
      return { status: 'NO_RECORD' };
    }

    const now = new Date();
    if (tfRecord.lockedUntil && new Date(tfRecord.lockedUntil) > now) {
      return { status: 'LOCKED' };
    }

    let decryptedSecret: string;
    try {
      decryptedSecret = await symmetricDecrypt({
        key: env.BETTER_AUTH_SECRET,
        data: tfRecord.secret,
      });
    } catch {
      return { status: 'DECRYPT_FAIL' };
    }

    const rawBase32 = decryptedSecret.startsWith('base32:')
      ? decryptedSecret.slice(7)
      : decryptedSecret;
    const secretBytes = base32.decode(rawBase32.toUpperCase());
    const verifier = createOTP(secretBytes, { period: 30, digits: 6 });

    const isValid = await verifier.verify(code);
    if (!isValid) {
      const currentCount = Number(tfRecord.failedVerificationCount) || 0;
      const newCount = currentCount + 1;
      const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
      const lockUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

      await tx.twoFactor.update({
        where: { id: tfRecord.id },
        data: {
          failedVerificationCount: newCount,
          lockedUntil: lockUntil,
        },
      });

      return {
        status: 'INVALID_TOTP',
        shouldLock,
        remainingAttempts: MAX_FAILED_ATTEMPTS - newCount,
      };
    }

    await tx.twoFactor.update({
      where: { id: tfRecord.id },
      data: {
        verified: true,
        failedVerificationCount: 0,
        lockedUntil: null,
      },
    });

    await tx.officeBootstrap.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        isClosed: true,
        closedAt: new Date(),
        ownerId: userId,
      },
      update: {
        isClosed: true,
        closedAt: new Date(),
        ownerId: userId,
      },
    });

    return { status: 'SUCCESS' };
  });

  if (outcome.status === 'LOCKED') {
    throw new AuthenticationError(
      'ACCOUNT_LOCKED',
      'تم قفل تأكيد المصادقة مؤقتاً لتجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). يرجى المحاولة بعد انتهاء مدة الحظر.'
    );
  }

  if (outcome.status === 'NO_RECORD') {
    throw new AuthenticationError('UNAUTHENTICATED', 'سجل المصادقة الثنائية غير موجود للمستخدم.');
  }

  if (outcome.status === 'DECRYPT_FAIL') {
    throw new AuthenticationError('UNAUTHENTICATED', 'فشل في فك تشفير مفتاح المصادقة.');
  }

  if (outcome.status === 'INVALID_TOTP') {
    throw new AuthenticationError(
      outcome.shouldLock ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
      outcome.shouldLock
        ? 'تم تجاوز الحد الأقصى لمحاولات رمز التحقق الخاطئة (5 محاولات). تم قفل الحساب لمدة 15 دقيقة.'
        : `رمز التحقق غير صحيح أو انتهت صلاحيته. المحاولات المتبقية: ${outcome.remainingAttempts}.`
    );
  }
}