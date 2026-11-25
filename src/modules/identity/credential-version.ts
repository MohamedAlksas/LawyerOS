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
 * Returns null if the user is missing (allowing provider authentication to handle invalid credentials).
 * Throws if a database error occurs so caller fails closed.
 */
export async function getUserCredentialVersionByEmail(email: string): Promise<number | null> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    return null;
  }
  const prisma = getPrismaClient();
  const user = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: { credentialVersion: true },
  });
  if (!user) {
    return null;
  }
  return user.credentialVersion ?? 1;
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
 * Extracts raw session / 2FA token and candidate verification identifiers from a Cookie or Set-Cookie entry.
 * Strips cookie attributes before parsing signature dots and fails closed on malformed percent-encoding.
 */
export function extractRawTokens(cookiePart: string): {
  rawToken: string;
  candidateIdentifiers: string[];
} {
  const pair = cookiePart.split(';', 1)[0]?.trim() ?? '';
  const eqIdx = pair.indexOf('=');
  const cookieVal = eqIdx !== -1 ? pair.slice(eqIdx + 1).trim() : '';

  let decodedVal: string;
  try {
    decodedVal = decodeURIComponent(cookieVal);
  } catch {
    return { rawToken: '', candidateIdentifiers: [] };
  }

  const withoutPrefix = decodedVal.startsWith('s:') ? decodedVal.slice(2) : decodedVal;
  const dotIdx = withoutPrefix.lastIndexOf('.');
  const rawToken = dotIdx !== -1 ? withoutPrefix.substring(0, dotIdx) : withoutPrefix.split('.')[0];
  const bareToken = rawToken.startsWith('2fa-') ? rawToken.slice(4) : rawToken;

  const candidateIdentifiers = Array.from(
    new Set(
      [
        rawToken,
        bareToken,
        `2fa-${rawToken}`,
        `2fa-${bareToken}`,
        `two-factor-${rawToken}`,
        `two-factor-${bareToken}`,
        decodedVal,
        withoutPrefix,
        cookieVal,
      ].filter(Boolean)
    )
  );

  return { rawToken: bareToken || rawToken, candidateIdentifiers };
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



