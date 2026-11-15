import { getPrismaClient } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

/**
 * Retrieves the authoritative credentialVersion integer for a user.
 * Throws if the user is missing or database error occurs.
 */
export async function getUserCredentialVersion(userId: string): Promise<number> {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credentialVersion: true },
  });
  if (!user || user.credentialVersion === null || user.credentialVersion === undefined) {
    throw new Error(`User with id ${userId} not found or missing credentialVersion`);
  }
  return user.credentialVersion;
}

/**
 * Retrieves the authoritative credentialVersion integer for a user by email.
 * Throws if the user is missing or database error occurs.
 */
export async function getUserCredentialVersionByEmail(email: string): Promise<number> {
  const prisma = getPrismaClient();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { credentialVersion: true },
  });
  if (!user || user.credentialVersion === null || user.credentialVersion === undefined) {
    throw new Error(`User with email ${email} not found or missing credentialVersion`);
  }
  return user.credentialVersion;
}

/**
 * Atomically increments user.credentialVersion in an active transaction and returns the new version.
 * Throws on error so the active transaction fails closed.
 */
export async function incrementUserCredentialVersion(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<number> {
  const updated = await tx.user.update({
    where: { id: userId },
    data: { credentialVersion: { increment: 1 } },
    select: { credentialVersion: true },
  });
  return updated.credentialVersion;
}

/**
 * Updates session.credentialVersion to match the authorized user's version.
 * Throws on error so caller fails closed.
 */
export async function setSessionCredentialVersion(
  tx: Prisma.TransactionClient,
  sessionId: string,
  version: number
): Promise<void> {
  await tx.session.update({
    where: { id: sessionId },
    data: { credentialVersion: version },
  });
}

/**
 * Atomically evicts all older sessions for a user whose credentialVersion does not match newVersion.
 * Optionally preserves a designated replacement session.
 * Throws on error so caller fails closed.
 */
export async function evictOlderSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  newVersion: number,
  keepSessionId?: string | null
): Promise<void> {
  await tx.session.deleteMany({
    where: {
      userId,
      ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
      credentialVersion: { not: newVersion },
    },
  });
}

/**
 * Checks whether session.credentialVersion matches user.credentialVersion.
 * Returns true if there is a mismatch, or if user or session is missing / unversioned (fail-closed).
 * Throws on database failure so caller fails closed.
 */
export async function isSessionCredentialVersionMismatched(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credentialVersion: true },
  });
  if (!user || user.credentialVersion === undefined || user.credentialVersion === null) {
    return true;
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { credentialVersion: true },
  });
  if (!session || session.credentialVersion === undefined || session.credentialVersion === null) {
    return true;
  }

  return Number(user.credentialVersion) !== Number(session.credentialVersion);
}



