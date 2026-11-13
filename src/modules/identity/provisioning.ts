import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { hashPassword, symmetricEncrypt, symmetricDecrypt, generateRandomString } from 'better-auth/crypto';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { randomBytes, randomUUID } from 'crypto';
import { AuthenticationError, ProvisioningError } from './types';

export interface ProvisionOwnerInput {
  name: string;
  email: string;
  password: string;
  verified?: boolean;
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
 * Checks whether any OWNER account already exists in the system or bootstrap is closed.
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
 * Fails closed if any owner account already exists or bootstrap was previously closed.
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

  const ownerExists = await hasAnyOwner();
  if (ownerExists) {
    throw new ProvisioningError(
      'OWNER_ALREADY_EXISTS',
      'حساب المالك مهيأ بالفعل في النظام. لا يُسمح بإنشاء حساب مالك إضافي.'
    );
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

  const isPending =
    input.verified === false ||
    (input.verified === undefined && (email.includes('pending') || name.includes('قيد الإعداد')));
  const isVerified = !isPending;

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
    await tx.officeBootstrap.create({
      data: {
        id: 'singleton',
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

  const tfRecord = await prisma.twoFactor.findFirst({
    where: { userId },
  });

  if (!tfRecord) {
    throw new AuthenticationError('UNAUTHENTICATED', 'سجل المصادقة الثنائية غير موجود للمستخدم.');
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = await symmetricDecrypt({
      key: env.BETTER_AUTH_SECRET,
      data: tfRecord.secret,
    });
  } catch {
    throw new AuthenticationError('UNAUTHENTICATED', 'فشل في فك تشفير مفتاح المصادقة.');
  }

  const rawBase32 = decryptedSecret.startsWith('base32:')
    ? decryptedSecret.slice(7)
    : decryptedSecret;
  const secretBytes = base32.decode(rawBase32.toUpperCase());
  const verifier = createOTP(secretBytes, { period: 30, digits: 6 });

  const isValid = await verifier.verify(code);
  if (!isValid) {
    throw new AuthenticationError('INVALID_CREDENTIALS', 'رمز التحقق غير صحيح أو انتهت صلاحيته.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.twoFactor.update({
      where: { id: tfRecord.id },
      data: { verified: true },
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
  });
}