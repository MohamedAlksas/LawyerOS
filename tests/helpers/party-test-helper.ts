import { PrismaClient } from '@prisma/client';
import { Actor } from '@/modules/identity/types';

export const SYNTHETIC_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const SYNTHETIC_KEY_ID = 'k2026_01';

export function setupTestEncryptionKeys(): void {
  process.env.PARTY_IDENTITY_ENCRYPTION_KEY = SYNTHETIC_ENCRYPTION_KEY;
  process.env.PARTY_IDENTITY_KEY_ID = SYNTHETIC_KEY_ID;
}

export function createSyntheticActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: overrides.id ?? 'synthetic-owner-uuid-001',
    name: overrides.name ?? 'الأستاذ أحمد المحامي',
    email: overrides.email ?? 'owner@lawoffice.test',
    role: overrides.role ?? 'OWNER',
    sessionId: overrides.sessionId ?? 'session-synthetic-001',
    twoFactorVerified: overrides.twoFactorVerified ?? true,
    ...overrides,
  };
}

export function createSyntheticMaintainer(overrides: Partial<Actor> = {}): Actor {
  return {
    id: overrides.id ?? 'synthetic-maintainer-uuid-001',
    name: overrides.name ?? 'مسؤول الصيانة التقنية',
    email: overrides.email ?? 'maintainer@lawoffice.test',
    role: overrides.role ?? 'MAINTAINER',
    sessionId: overrides.sessionId ?? 'session-maintainer-001',
    twoFactorVerified: overrides.twoFactorVerified ?? false,
    ...overrides,
  };
}

export async function cleanupPartyFixtures(
  prisma: PrismaClient,
  partyIds: string[]
): Promise<void> {
  if (!partyIds || partyIds.length === 0) return;

  const validIds = partyIds.filter(Boolean);
  if (validIds.length === 0) return;

  // Deleting party cascades to identities, notes, and poas via onDelete: Cascade
  await prisma.party.deleteMany({
    where: { id: { in: validIds } },
  });

  // Clean up associated audit and idempotency records for test cleanliness
  await prisma.auditEvent.deleteMany({
    where: {
      entityType: 'Party',
      entityId: { in: validIds },
    },
  });

  await prisma.idempotencyRecord.deleteMany({
    where: {
      resultId: { in: validIds },
    },
  });
}

