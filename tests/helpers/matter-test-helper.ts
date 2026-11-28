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

  const [hasFinanceTx, hasFinanceAg, hasFinanceAcct, hasFinanceLine, hasFinanceCharge] =
    await Promise.all([
      prisma.moneyTransaction.count({ where: { matterId: { in: validIds } } }),
      prisma.feeAgreement.count({ where: { matterId: { in: validIds } } }),
      prisma.moneyAccount.count({ where: { matterId: { in: validIds } } }),
      prisma.moneyLine.count({ where: { matterId: { in: validIds } } }),
      prisma.feeCharge.count({ where: { matterId: { in: validIds } } }),
    ]);

  let financeEntityIds: string[] = [];
  if (hasFinanceTx + hasFinanceAg + hasFinanceAcct + hasFinanceLine + hasFinanceCharge > 0) {
    financeEntityIds = await prisma.$transaction(
      async (tx) => {
        const [agreements, charges, txs] = await Promise.all([
          tx.feeAgreement.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
          tx.feeCharge.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
          tx.moneyTransaction.findMany({ where: { matterId: { in: validIds } }, select: { id: true } }),
        ]);
        const txIds = txs.map((r) => r.id);
        const lines = await tx.moneyLine.findMany({
          where: {
            OR: [
              { matterId: { in: validIds } },
              ...(txIds.length > 0 ? [{ transactionId: { in: txIds } }] : []),
            ],
          },
          select: { id: true },
        });
        const lineIds = lines.map((r) => r.id);
        const [receipts, allocs] = await Promise.all([
          txIds.length > 0
            ? tx.receipt.findMany({ where: { transactionId: { in: txIds } }, select: { id: true } })
            : Promise.resolve([]),
          lineIds.length > 0 || txIds.length > 0
            ? tx.moneyAllocation.findMany({
                where: {
                  OR: [
                    ...(lineIds.length > 0
                      ? [{ receivableLineId: { in: lineIds } }, { settlementLineId: { in: lineIds } }]
                      : []),
                    ...(txIds.length > 0 ? [{ adjustmentTransactionId: { in: txIds } }] : []),
                  ],
                },
                select: { id: true },
              })
            : Promise.resolve([]),
        ]);

        await tx.$executeRawUnsafe('ALTER TABLE public."receipt" DISABLE TRIGGER trg_receipt_immutable');
        await tx.$executeRawUnsafe(
          'ALTER TABLE public."money_allocation" DISABLE TRIGGER trg_money_allocation_immutable'
        );
        await tx.$executeRawUnsafe('ALTER TABLE public."fee_charge" DISABLE TRIGGER trg_fee_charge_immutable');
        await tx.$executeRawUnsafe('ALTER TABLE public."money_line" DISABLE TRIGGER trg_money_line_immutable');
        await tx.$executeRawUnsafe(
          'ALTER TABLE public."fee_agreement" DISABLE TRIGGER trg_fee_agreement_approved_immutable'
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE public."money_transaction" DISABLE TRIGGER trg_money_transaction_immutable'
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE public."money_account" DISABLE TRIGGER trg_money_account_immutable'
        );
        await tx.$executeRawUnsafe('ALTER TABLE public."money_line" DISABLE TRIGGER trg_money_line_balanced');
        await tx.$executeRawUnsafe(
          'ALTER TABLE public."money_transaction" DISABLE TRIGGER trg_money_transaction_balanced'
        );

        try {
          if (receipts.length > 0) {
            await tx.receipt.deleteMany({ where: { id: { in: receipts.map((r) => r.id) } } });
          }
          if (allocs.length > 0) {
            await tx.moneyAllocation.deleteMany({ where: { id: { in: allocs.map((r) => r.id) } } });
          }
          if (charges.length > 0) {
            await tx.feeCharge.deleteMany({ where: { id: { in: charges.map((r) => r.id) } } });
          }
          if (agreements.length > 0) {
            await tx.feeAgreement.deleteMany({ where: { id: { in: agreements.map((r) => r.id) } } });
          }
          await tx.$executeRaw`
            DELETE FROM public."money_line"
            WHERE "matter_id" = ANY(${validIds}::text[])
               OR "transaction_id" IN (SELECT "id" FROM public."money_transaction" WHERE "matter_id" = ANY(${validIds}::text[]))
          `;
          if (txIds.length > 0) {
            await tx.moneyTransaction.deleteMany({ where: { id: { in: txIds } } });
          }
          await tx.moneyAccount.deleteMany({ where: { matterId: { in: validIds } } });
          await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        } finally {
          await tx.$executeRawUnsafe(
            'ALTER TABLE public."money_transaction" ENABLE TRIGGER trg_money_transaction_balanced'
          );
          await tx.$executeRawUnsafe('ALTER TABLE public."money_line" ENABLE TRIGGER trg_money_line_balanced');
          await tx.$executeRawUnsafe(
            'ALTER TABLE public."money_account" ENABLE TRIGGER trg_money_account_immutable'
          );
          await tx.$executeRawUnsafe(
            'ALTER TABLE public."money_transaction" ENABLE TRIGGER trg_money_transaction_immutable'
          );
          await tx.$executeRawUnsafe(
            'ALTER TABLE public."fee_agreement" ENABLE TRIGGER trg_fee_agreement_approved_immutable'
          );
          await tx.$executeRawUnsafe('ALTER TABLE public."money_line" ENABLE TRIGGER trg_money_line_immutable');
          await tx.$executeRawUnsafe('ALTER TABLE public."fee_charge" ENABLE TRIGGER trg_fee_charge_immutable');
          await tx.$executeRawUnsafe(
            'ALTER TABLE public."money_allocation" ENABLE TRIGGER trg_money_allocation_immutable'
          );
          await tx.$executeRawUnsafe('ALTER TABLE public."receipt" ENABLE TRIGGER trg_receipt_immutable');
        }

        return [
          ...agreements.map((r) => r.id),
          ...charges.map((r) => r.id),
          ...txIds,
          ...lineIds,
          ...allocs.map((r) => r.id),
          ...receipts.map((r) => r.id),
        ];
      },
      { timeout: 15000 }
    );
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

  // Deleting matter cascades to matter_party, proceeding, proceeding_party, matter_authorization, hearing, task, deadline
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
      ...documentIds,
      ...versionIds,
      ...uploadAttemptIds,
      ...financeEntityIds,
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
          'DOCUMENT',
          'DocumentVersion',
          'UploadAttempt',
          'BackupFilePin',
          'FeeAgreement',
          'FeeCharge',
          'MoneyTransaction',
          'MoneyAllocation',
          'Receipt',
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
  const allRefIds = [
    ...(opts.courtIds || []),
    ...(opts.practiceAreaIds || []),
    ...(opts.storageLocationIds || []),
  ];

  if (allRefIds.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: {
        entityId: { in: allRefIds },
      },
    });

    await prisma.idempotencyRecord.deleteMany({
      where: {
        resultId: { in: allRefIds },
      },
    });
  }

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
