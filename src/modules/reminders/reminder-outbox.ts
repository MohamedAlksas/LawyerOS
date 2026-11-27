import type { Prisma, ReminderEventType, ReminderRule } from '@prisma/client';
import { computeCairoReminderInstant } from '@/lib/cairo-date';

export const DEFAULT_REMINDER_RULE_SPECS: Record<
  ReminderEventType,
  Array<{ id: string; dayOffset: number; reminderTime: string }>
> = {
  HEARING: [
    { id: '00000000-0000-4000-8000-000000000101', dayOffset: 7, reminderTime: '09:00' },
    { id: '00000000-0000-4000-8000-000000000102', dayOffset: 3, reminderTime: '09:00' },
    { id: '00000000-0000-4000-8000-000000000103', dayOffset: 1, reminderTime: '09:00' },
  ],
  DEADLINE: [
    { id: '00000000-0000-4000-8000-000000000201', dayOffset: 7, reminderTime: '09:00' },
    { id: '00000000-0000-4000-8000-000000000202', dayOffset: 3, reminderTime: '09:00' },
    { id: '00000000-0000-4000-8000-000000000203', dayOffset: 1, reminderTime: '09:00' },
  ],
  TASK: [
    { id: '00000000-0000-4000-8000-000000000301', dayOffset: 1, reminderTime: '09:00' },
  ],
};

export function reminderEventTypeFromSourceType(sourceType: string): ReminderEventType | null {
  if (sourceType === 'Hearing') return 'HEARING';
  if (sourceType === 'Deadline') return 'DEADLINE';
  if (sourceType === 'Task') return 'TASK';
  return null;
}

/**
 * Seeds default IN_APP reminder rules idempotently only for event types that have
 * zero configured rules yet, preserving explicit user disable/enable preferences.
 */
export async function ensureDefaultReminderRules(
  tx: Prisma.TransactionClient,
  eventTypes: ReminderEventType[] = ['HEARING', 'DEADLINE', 'TASK']
): Promise<void> {
  const existingCounts = await tx.reminderRule.groupBy({
    by: ['eventType'],
    where: { eventType: { in: eventTypes } },
    _count: { _all: true },
  });
  const present = new Set(existingCounts.map((c) => c.eventType));

  const missingData: Prisma.ReminderRuleCreateManyInput[] = [];
  for (const eventType of eventTypes) {
    if (present.has(eventType)) continue;
    for (const spec of DEFAULT_REMINDER_RULE_SPECS[eventType]) {
      missingData.push({
        id: spec.id,
        eventType,
        dayOffset: spec.dayOffset,
        reminderTime: spec.reminderTime,
        channel: 'IN_APP',
        enabled: true,
        version: 1,
      });
    }
  }

  if (missingData.length > 0) {
    await tx.reminderRule.createMany({
      data: missingData,
      skipDuplicates: true,
    });
  }
}

export async function listEnabledRulesForEventType(
  tx: Prisma.TransactionClient,
  eventType: ReminderEventType
): Promise<ReminderRule[]> {
  await ensureDefaultReminderRules(tx, [eventType]);
  return tx.reminderRule.findMany({
    where: {
      eventType,
      channel: 'IN_APP',
      enabled: true,
    },
    orderBy: [{ dayOffset: 'desc' }, { reminderTime: 'asc' }],
  });
}

export interface EnqueueSourceReminderParams {
  sourceType: 'Hearing' | 'Deadline' | 'Task';
  sourceId: string;
  sourceVersion: number;
  eventDateYmd: string;
  deduplicationKey: string;
  payload: Prisma.InputJsonValue;
  maxAttempts?: number;
}

/**
 * Enqueues the primary durable JobRun inside the business transaction, anchored at
 * the earliest enabled ReminderRule Africa/Cairo instant. Returns null if all rules
 * for that event type are disabled.
 */
export async function enqueueSourceReminderJob(
  tx: Prisma.TransactionClient,
  params: EnqueueSourceReminderParams
): Promise<{ id: string; scheduledAt: Date } | null> {
  const eventType = reminderEventTypeFromSourceType(params.sourceType);
  if (!eventType) return null;

  const rules = await listEnabledRulesForEventType(tx, eventType);
  if (rules.length === 0) {
    return null;
  }

  const instants = rules.map((rule) =>
    computeCairoReminderInstant(params.eventDateYmd, rule.dayOffset, rule.reminderTime)
  );
  let earliestInstant = instants[0]!;
  for (const candidate of instants.slice(1)) {
    if (candidate.getTime() < earliestInstant.getTime()) {
      earliestInstant = candidate;
    }
  }

  const job = await tx.jobRun.create({
    data: {
      jobType: 'REMINDER_DELIVERY',
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      sourceVersion: params.sourceVersion,
      payloadVersion: 1,
      scheduledAt: earliestInstant,
      availableAt: earliestInstant,
      maxAttempts: params.maxAttempts ?? 5,
      status: 'PENDING',
      deduplicationKey: params.deduplicationKey,
      payload: params.payload,
    },
    select: {
      id: true,
      scheduledAt: true,
    },
  });

  return job;
}

export interface EnqueueSourceReminderBatchItem {
  sourceId: string;
  sourceVersion: number;
  eventDateYmd: string;
  deduplicationKey: string;
  payload: Prisma.InputJsonValue;
  maxAttempts?: number;
}

/**
 * Batch-enqueues missing reminder jobs for active sources without active PENDING/RUNNING
 * jobs, skipping rules already delivered (IN_APP SENT) for each source version.
 */
export async function enqueueMissingSourceReminderJobsBatch(
  tx: Prisma.TransactionClient,
  sourceType: 'Hearing' | 'Deadline' | 'Task',
  items: EnqueueSourceReminderBatchItem[]
): Promise<void> {
  if (items.length === 0) return;

  const eventType = reminderEventTypeFromSourceType(sourceType);
  if (!eventType) return;

  const rules = await listEnabledRulesForEventType(tx, eventType);
  if (rules.length === 0) return;

  const sourceIds = Array.from(new Set(items.map((item) => item.sourceId)));
  const activeJobs = await tx.jobRun.findMany({
    where: {
      jobType: 'REMINDER_DELIVERY',
      sourceType,
      sourceId: { in: sourceIds },
      status: { in: ['PENDING', 'RUNNING'] },
    },
    select: { sourceId: true },
  });
  const activeSourceIds = new Set(activeJobs.map((j) => j.sourceId));

  const eligibleItems = items.filter((item) => !activeSourceIds.has(item.sourceId));
  if (eligibleItems.length === 0) return;

  const eligibleSourceIds = Array.from(new Set(eligibleItems.map((item) => item.sourceId)));
  const sentDeliveries = await tx.reminderDelivery.findMany({
    where: {
      sourceType,
      sourceId: { in: eligibleSourceIds },
      channel: 'IN_APP',
      status: 'SENT',
    },
    select: {
      sourceId: true,
      sourceVersion: true,
      ruleKey: true,
    },
  });

  const deliveredRuleKeysBySourceVer = new Map<string, Set<string>>();
  for (const delivery of sentDeliveries) {
    const key = `${delivery.sourceId}:${delivery.sourceVersion}`;
    let set = deliveredRuleKeysBySourceVer.get(key);
    if (!set) {
      set = new Set<string>();
      deliveredRuleKeysBySourceVer.set(key, set);
    }
    set.add(delivery.ruleKey);
  }

  for (const item of eligibleItems) {
    if (activeSourceIds.has(item.sourceId)) continue;

    const deliveredKeys = deliveredRuleKeysBySourceVer.get(
      `${item.sourceId}:${item.sourceVersion}`
    );
    const pendingRules = deliveredKeys
      ? rules.filter((rule) => !deliveredKeys.has(`offset_${rule.dayOffset}`))
      : rules;
    if (pendingRules.length === 0) continue;

    let earliestInstant = computeCairoReminderInstant(
      item.eventDateYmd,
      pendingRules[0]!.dayOffset,
      pendingRules[0]!.reminderTime
    );
    for (const rule of pendingRules.slice(1)) {
      const candidate = computeCairoReminderInstant(
        item.eventDateYmd,
        rule.dayOffset,
        rule.reminderTime
      );
      if (candidate.getTime() < earliestInstant.getTime()) {
        earliestInstant = candidate;
      }
    }

    await tx.jobRun.create({
      data: {
        jobType: 'REMINDER_DELIVERY',
        sourceType,
        sourceId: item.sourceId,
        sourceVersion: item.sourceVersion,
        payloadVersion: 1,
        scheduledAt: earliestInstant,
        availableAt: earliestInstant,
        maxAttempts: item.maxAttempts ?? 5,
        status: 'PENDING',
        deduplicationKey: item.deduplicationKey,
        payload: item.payload,
      },
    });
    activeSourceIds.add(item.sourceId);
  }
}

/**
 * Cancels all pending/running/failed outbox jobs and pending/processing deliveries
 * for one or more source records inside the business mutation transaction.
 */
export async function cancelSourceReminderJobsBatch(
  tx: Prisma.TransactionClient,
  sourceType: 'Hearing' | 'Deadline' | 'Task',
  sourceIds: string[],
  now: Date = new Date()
): Promise<void> {
  if (sourceIds.length === 0) return;

  await tx.jobRun.updateMany({
    where: {
      sourceType,
      sourceId: { in: sourceIds },
      status: { in: ['PENDING', 'RUNNING', 'FAILED'] },
    },
    data: {
      status: 'CANCELLED',
      completedAt: now,
      leaseUntil: null,
      lockedBy: null,
    },
  });

  await tx.reminderDelivery.updateMany({
    where: {
      sourceType,
      sourceId: { in: sourceIds },
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    data: {
      status: 'CANCELLED',
    },
  });
}

/**
 * Cancels all pending/running outbox jobs and pending/processing deliveries
 * for a source record inside the business mutation transaction.
 */
export async function cancelSourceReminderJobs(
  tx: Prisma.TransactionClient,
  sourceType: 'Hearing' | 'Deadline' | 'Task',
  sourceId: string,
  now: Date = new Date()
): Promise<void> {
  await cancelSourceReminderJobsBatch(tx, sourceType, [sourceId], now);
}