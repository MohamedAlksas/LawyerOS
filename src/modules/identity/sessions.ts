import { getPrismaClient } from '@/lib/auth';
import { Actor, AuthorizationError, SessionInfo } from './types';
import { authorize } from './authorize';
import { recordAuditEvent } from '@/lib/audit';
import { INACTIVITY_TIMEOUT_MS, MAX_SESSION_LIFETIME_MS } from './session-limits';

/**
 * Lists all active, non-expired sessions for the specified user.
 */
export async function listActiveSessions(
  userId: string,
  currentSessionId?: string
): Promise<SessionInfo[]> {
  const prisma = getPrismaClient();
  const now = new Date();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { credentialVersion: true } });
  if (!user) return [];

  const sessions = await prisma.session.findMany({
    where: {
      userId,
      credentialVersion: user.credentialVersion,
      expiresAt: { gt: now },
      createdAt: { gte: new Date(now.getTime() - MAX_SESSION_LIFETIME_MS) },
      updatedAt: { gte: new Date(now.getTime() - INACTIVITY_TIMEOUT_MS) },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  return sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    expiresAt: s.expiresAt,
    isCurrent: s.id === currentSessionId,
  }));
}

/**
 * Revokes an individual session by its identifier.
 * Ensures the actor is either the owner of the session or an administrative OWNER.
 */
export async function revokeSession(sessionId: string, actor: Actor): Promise<void> {
  const prisma = getPrismaClient();
  const target = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!target) {
    return;
  }

  const isSelf = target.userId === actor.id;
  const isSecurityAdmin = authorize(actor, 'MANAGE_SECURITY');

  if (!isSelf && !isSecurityAdmin) {
    throw new AuthorizationError('غير مصرح لك بإنهاء جلسات تابعة لمستخدم آخر.');
  }

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { id: sessionId, userId: target.userId } });
    if (count > 0) {
      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'REVOKE_SESSION',
        entityType: 'User',
        entityId: target.userId,
      });
    }
  });
}

/**
 * Revokes all other sessions belonging to the actor, preserving only their current active session.
 */
export async function revokeOtherSessions(actor: Actor): Promise<number> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({
      where: { userId: actor.id, id: { not: actor.sessionId } },
    });
    if (count > 0) {
      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'REVOKE_OTHER_SESSIONS',
        entityType: 'User',
        entityId: actor.id,
        changedFields: { revokedCount: count },
      });
    }
    return count;
  });
}