import { PrismaClient } from '@prisma/client';

export async function cleanupMatterFixtures(
  prisma: PrismaClient,
  matterIds: string[]
): Promise<void> {
  if (!matterIds || matterIds.length === 0) return;
  const validIds = matterIds.filter(Boolean);
  if (validIds.length === 0) return;

  // Deleting matter cascades to matter_party, proceeding, proceeding_party, matter_authorization
  await prisma.matter.deleteMany({
    where: { id: { in: validIds } },
  });

  await prisma.auditEvent.deleteMany({
    where: {
      entityType: { in: ['Matter', 'MatterParty', 'Proceeding', 'ProceedingParty', 'MatterAuthorization'] },
      entityId: { in: validIds },
    },
  });

  await prisma.idempotencyRecord.deleteMany({
    where: {
      resultId: { in: validIds },
    },
  });
}

export async function cleanupReferenceFixtures(
  prisma: PrismaClient,
  opts: {
    courtIds?: string[];
    practiceAreaIds?: string[];
    storageLocationIds?: string[];
  }
): Promise<void> {
  if (opts.courtIds && opts.courtIds.length > 0) {
    await prisma.court.deleteMany({
      where: { id: { in: opts.courtIds } },
    });
  }
  if (opts.practiceAreaIds && opts.practiceAreaIds.length > 0) {
    await prisma.practiceArea.deleteMany({
      where: { id: { in: opts.practiceAreaIds } },
    });
  }
  if (opts.storageLocationIds && opts.storageLocationIds.length > 0) {
    await prisma.storageLocation.deleteMany({
      where: { id: { in: opts.storageLocationIds } },
    });
  }
}