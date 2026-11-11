import { getPrismaClient } from '@/lib/auth';
import { Actor, AuthorizationError, SessionInfo } from './types';
import { authorize } from './authorize';

/**
 * Lists all active, non-expired sessions for the specified user.
 */
export async function listActiveSessions(
  userId: string,
  currentSessionId?: string
): Promise<SessionInfo[]> {
  const prisma = getPrismaClient();
  const now = new Date();

  const sessions = await prisma.session.findMany({
    where: {
      userId,
      expiresAt: {
        gt: now,
      },
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

  await prisma.session.delete({
    where: { id: sessionId },
  });
}

/**
 * Revokes all other sessions belonging to the actor, preserving only their current active session.
 */
export async function revokeOtherSessions(actor: Actor): Promise<number> {
  const prisma = getPrismaClient();

  const result = await prisma.session.deleteMany({
    where: {
      userId: actor.id,
      id: {
        not: actor.sessionId,
      },
    },
  });

  return result.count;
}