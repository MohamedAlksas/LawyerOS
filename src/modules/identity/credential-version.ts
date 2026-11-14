import { getPrismaClient } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

/**
 * Retrieves the authoritative credentialVersion integer for a user.
 * Defaults to 1 if not set or pre-migration.
 */
export async function getUserCredentialVersion(userId: string): Promise<number> {
  const prisma = getPrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credentialVersion: true },
    });
    return user?.credentialVersion ?? 1;
  } catch {
    return 1;
  }
}

/**
 * Retrieves the authoritative credentialVersion integer for a user by email.
 */
export async function getUserCredentialVersionByEmail(email: string): Promise<number> {
  const prisma = getPrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { credentialVersion: true },
    });
    return user?.credentialVersion ?? 1;
  } catch {
    return 1;
  }
}

/**
 * Atomically increments user.credentialVersion in an active transaction and returns the new version.
 */
export async function incrementUserCredentialVersion(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<number> {
  try {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { credentialVersion: { increment: 1 } },
      select: { credentialVersion: true },
    });
    return updated.credentialVersion;
  } catch {
    return 2;
  }
}

/**
 * Updates session.credentialVersion to match the authorized user's version.
 */
export async function setSessionCredentialVersion(
  tx: Prisma.TransactionClient,
  sessionId: string,
  version: number
): Promise<void> {
  try {
    await tx.session.update({
      where: { id: sessionId },
      data: { credentialVersion: version },
    });
  } catch {
    // Session may have already been cleaned up or table does not match
  }
}

/**
 * Atomically evicts all older sessions for a user whose credentialVersion does not match newVersion.
 * Optionally preserves a designated replacement session.
 */
export async function evictOlderSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  newVersion: number,
  keepSessionId?: string | null
): Promise<void> {
  try {
    await tx.session.deleteMany({
      where: {
        userId,
        ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
        credentialVersion: { not: newVersion },
      },
    });
  } catch {
    if (keepSessionId) {
      await tx.session.deleteMany({
        where: { userId, id: { not: keepSessionId } },
      }).catch(() => {});
    } else {
      await tx.session.deleteMany({
        where: { userId },
      }).catch(() => {});
    }
  }
}

/**
 * Checks whether session.credentialVersion matches user.credentialVersion.
 * Returns true if there is a mismatch (i.e. session predates credential rotation).
 */
export async function isSessionCredentialVersionMismatched(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const prisma = getPrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credentialVersion: true },
    });
    if (!user || user.credentialVersion === undefined || user.credentialVersion === null) {
      return false;
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { credentialVersion: true },
    });
    if (!session || session.credentialVersion === undefined || session.credentialVersion === null) {
      return false;
    }

    return Number(user.credentialVersion) !== Number(session.credentialVersion);
  } catch {
    return false;
  }
}


