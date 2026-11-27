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

  const [identities, notes, poas, documents, uploadAttempts] = await Promise.all([
    prisma.partyIdentity.findMany({ where: { partyId: { in: validIds } }, select: { id: true } }),
    prisma.communicationNote.findMany({ where: { partyId: { in: validIds } }, select: { id: true } }),
    prisma.powerOfAttorney.findMany({ where: { partyId: { in: validIds } }, select: { id: true } }),
    prisma.document.findMany({ where: { partyId: { in: validIds } }, select: { id: true } }),
    prisma.uploadAttempt.findMany({ where: { partyId: { in: validIds } }, select: { id: true } }),
  ]);

  const poaIds = poas.map((r) => r.id);
  const authorizations =
    poaIds.length > 0
      ? await prisma.matterAuthorization.findMany({
          where: { powerOfAttorneyId: { in: poaIds } },
          select: { id: true },
        })
      : [];

  const uploadAttemptIds = uploadAttempts.map((r) => r.id);
  if (uploadAttemptIds.length > 0) {
    await prisma.uploadAttempt.deleteMany({ where: { id: { in: uploadAttemptIds } } });
  }

  const documentIds = documents.map((r) => r.id);
  let versionIds: string[] = [];
  if (documentIds.length > 0) {
    const versions = await prisma.documentVersion.findMany({
      where: { documentId: { in: documentIds } },
      select: { id: true },
    });
    versionIds = versions.map((v) => v.id);
    if (versionIds.length > 0) {
      await prisma.backupFilePin.deleteMany({
        where: { documentVersionId: { in: versionIds } },
      });
    }
    await prisma.document.updateMany({
      where: { id: { in: documentIds } },
      data: { currentVersionId: null },
    });
    await prisma.documentVersion.deleteMany({
      where: { documentId: { in: documentIds } },
    });
    await prisma.document.deleteMany({
      where: { id: { in: documentIds } },
    });
  }

  // Deleting party cascades to identities, notes, and poas via onDelete: Cascade
  await prisma.party.deleteMany({
    where: { id: { in: validIds } },
  });

  const allEntityIds = Array.from(
    new Set([
      ...validIds,
      ...identities.map((r) => r.id),
      ...notes.map((r) => r.id),
      ...poaIds,
      ...authorizations.map((r) => r.id),
      ...documentIds,
      ...versionIds,
      ...uploadAttemptIds,
    ])
  );

  // Clean up associated audit and idempotency records for test cleanliness
  await prisma.auditEvent.deleteMany({
    where: {
      entityType: {
        in: [
          'Party',
          'PARTY',
          'PartyIdentity',
          'CommunicationNote',
          'PowerOfAttorney',
          'MatterAuthorization',
          'Document',
          'DOCUMENT',
          'DocumentVersion',
          'UploadAttempt',
          'BackupFilePin',
        ],
      },
      entityId: { in: allEntityIds },
    },
  });

  await prisma.idempotencyRecord.deleteMany({
    where: {
      resultId: { in: allEntityIds },
    },
  });
}

