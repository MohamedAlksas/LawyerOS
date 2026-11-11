'use server';

import { requireActor } from '@/modules/identity/require-actor';
import {
  listActiveSessions,
  revokeSession,
  revokeOtherSessions,
  regenerateRecoveryCodes,
} from '@/modules/identity';

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
  const freshBackupCodes = await regenerateRecoveryCodes(actor, currentPassword);

  return {
    success: true,
    backupCodes: freshBackupCodes,
  };
}