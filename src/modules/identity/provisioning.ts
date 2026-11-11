import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { hashPassword, symmetricEncrypt, generateRandomString } from 'better-auth/crypto';
import { base32 } from '@better-auth/utils/base32';
import { randomBytes, randomUUID } from 'crypto';
import { ProvisioningError } from './types';

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
 * Checks whether any OWNER account already exists in the system.
 */
export async function hasAnyOwner(): Promise<boolean> {
  const prisma = getPrismaClient();
  const count = await prisma.user.count({
    where: { role: 'OWNER' },
  });
  return count > 0;
}

/**
 * Controlled initial Owner provisioning without default/embedded credentials.
 * Fails closed if any owner account already exists.
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

  // Fail closed if any owner already exists in the database
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

  // Generate Base32 TOTP secret for authenticator apps
  const totpSecret = base32.encode(randomBytes(20));
  const totpURI = `otpauth://totp/LawOffice%20OS:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=LawOffice%20OS&digits=6&period=30`;

  // Generate 10 single-use recovery backup codes
  const backupCodes: string[] = Array.from({ length: 10 }).map(() => {
    const raw = generateRandomString(10, 'a-z', '0-9', 'A-Z');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

  // Encrypt secrets using BETTER_AUTH_SECRET
  const encryptedTotpSecret = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: totpSecret,
  });

  const encryptedBackupCodes = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: JSON.stringify(backupCodes),
  });

  const userId = randomUUID();

  // Execute inside transaction for strict atomicity and race prevention
  const createdUser = await prisma.$transaction(async (tx) => {
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
        verified: true,
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