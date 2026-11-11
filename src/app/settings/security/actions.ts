'use server';

import { requireActor } from '@/modules/identity/require-actor';
import { listActiveSessions, revokeSession, revokeOtherSessions } from '@/modules/identity/sessions';
import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { verifyPassword, symmetricEncrypt, generateRandomString } from 'better-auth/crypto';

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

export async function revokeSessionAction(sessionId: string) {
  const actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
  await revokeSession(sessionId, actor);
  return { success: true };
}

export async function revokeOtherSessionsAction() {
  const actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
  const count = await revokeOtherSessions(actor);
  return { success: true, count };
}

export async function regenerateBackupCodesAction(currentPassword: string) {
  const actor = await requireActor({ requiredPermission: 'MANAGE_SECURITY' });
  const prisma = getPrismaClient();
  const env = getEnv();

  // Re-authentication check: password verification required before rotating recovery secrets
  const account = await prisma.account.findFirst({
    where: {
      userId: actor.id,
      providerId: 'credential',
    },
  });

  if (!account || !account.password) {
    throw new Error('لا يمكن التحقق من كلمة المرور.');
  }

  const isValid = await verifyPassword({
    hash: account.password,
    password: currentPassword,
  });

  if (!isValid) {
    throw new Error('كلمة المرور الحالية غير صحيحة.');
  }

  // Generate 10 fresh single-use backup codes
  const freshBackupCodes: string[] = Array.from({ length: 10 }).map(() => {
    const raw = generateRandomString(10, 'a-z', '0-9', 'A-Z');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

  const encryptedBackupCodes = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: JSON.stringify(freshBackupCodes),
  });

  await prisma.twoFactor.updateMany({
    where: { userId: actor.id },
    data: {
      backupCodes: encryptedBackupCodes,
    },
  });

  return {
    success: true,
    backupCodes: freshBackupCodes,
  };
}