import { PrismaClient } from '@prisma/client';

export async function cleanupMatterFixtures(
  prisma: PrismaClient,
  matterIds: string[]
): Promise<void> {
  if (!matterIds || matterIds.length === 0) return;
  const validIds = matterIds.filter(Boolean);
  if (validIds.length === 0) return;

  const [matterParties, proceedings, authorizations, tasks, deadlines, documents, uploadAttempts] =
    await Promise.all([
      prisma.matterParty.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
      prisma.proceeding.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
      prisma.matterAuthorization.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
      prisma.task.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
      prisma.deadline.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
      prisma.document.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
      prisma.uploadAttempt.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
    ]);

  const matterPartyIds = matterParties.map((r) => r.id);
  const proceedingIds = proceedings.map((r) => r.id);
  const taskIds = new Set(tasks.map((r) => r.id));
  const deadlineIds = new Set(deadlines.map((r) => r.id));

  const [proceedingParties, hearings, proceedingTasks, proceedingDeadlines] = await Promise.all([
    proceedingIds.length > 0 || matterPartyIds.length > 0
      ? prisma.proceedingParty.findMany({
          where: {
            OR: [
              ...(proceedingIds.length > 0 ? [{ proceedingId: { in: proceedingIds } }] : []),
              ...(matterPartyIds.length > 0 ? [{ matterPartyId: { in: matterPartyIds } }] : []),
            ],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    proceedingIds.length > 0
      ? prisma.hearing.findMany({ where: { proceedingId: { in: proceedingIds } }, select: { id: true } })
      : Promise.resolve([]),
    proceedingIds.length > 0
      ? prisma.task.findMany({ where: { proceedingId: { in: proceedingIds } }, select: { id: true } })
      : Promise.resolve([]),
    proceedingIds.length > 0
      ? prisma.deadline.findMany({ where: { proceedingId: { in: proceedingIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  for (const row of proceedingTasks) taskIds.add(row.id);
  for (const row of proceedingDeadlines) deadlineIds.add(row.id);

  const hearingIds = hearings.map((r) => r.id);
  const [hearingResults, hearingTasks] = await Promise.all([
    hearingIds.length > 0
      ? prisma.hearingResult.findMany({ where: { hearingId: { in: hearingIds } }, select: { id: true } })
      : Promise.resolve([]),
    hearingIds.length > 0
      ? prisma.task.findMany({ where: { hearingId: { in: hearingIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  for (const row of hearingTasks) taskIds.add(row.id);

  const uploadAttemptIds = uploadAttempts.map((r) => r.id);
  if (uploadAttemptIds.length > 0) {
    await prisma.uploadAttempt.deleteMany({ where: { id: { in: uploadAttemptIds } } });
  }

  const taskIdList = Array.from(taskIds);
  const deadlineIdList = Array.from(deadlineIds);
  const jobRunFilters: Array<{ sourceType: string; sourceId: { in: string[] } }> = [];
  if (hearingIds.length > 0) jobRunFilters.push({ sourceType: 'Hearing', sourceId: { in: hearingIds } });
  if (taskIdList.length > 0) jobRunFilters.push({ sourceType: 'Task', sourceId: { in: taskIdList } });
  if (deadlineIdList.length > 0) jobRunFilters.push({ sourceType: 'Deadline', sourceId: { in: deadlineIdList } });

  if (jobRunFilters.length > 0) {
    const jobRuns = await prisma.jobRun.findMany({ where: { OR: jobRunFilters }, select: { id: true } });
    const jobRunIds = jobRuns.map((r) => r.id);
    if (jobRunIds.length > 0) {
      await prisma.reminderDelivery.deleteMany({ where: { jobRunId: { in: jobRunIds } } });
      await prisma.jobRun.deleteMany({ where: { id: { in: jobRunIds } } });
    }
  }
  await prisma.reminderDelivery.deleteMany({ where: { matterId: { in: validIds } } });

  // Deleting matter cascades to matter_party, proceeding, proceeding_party, matter_authorization, hearing, task, deadline, document
  await prisma.matter.deleteMany({
    where: { id: { in: validIds } },
  });

  const allEntityIds = Array.from(
    new Set([
      ...validIds,
      ...matterPartyIds,
      ...proceedingIds,
      ...proceedingParties.map((r) => r.id),
      ...authorizations.map((r) => r.id),
      ...hearingIds,
      ...hearingResults.map((r) => r.id),
      ...taskIdList,
      ...deadlineIdList,
      ...documents.map((r) => r.id),
      ...uploadAttemptIds,
    ])
  );

  await prisma.auditEvent.deleteMany({
    where: {
      entityType: {
        in: [
          'Matter',
          'MATTER',
          'MatterParty',
          'Proceeding',
          'PROCEEDING',
          'ProceedingParty',
          'MatterAuthorization',
          'Hearing',
          'HearingResult',
          'Task',
          'Deadline',
          'Document',
          'UploadAttempt',
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