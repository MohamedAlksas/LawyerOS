import crypto from 'node:crypto';
import type { Prisma, PrismaClient, ReminderEventType } from '@prisma/client';
import { getPrismaClient } from '@/lib/auth';
import { isWorkerDispatchDisabled, redactErrorMessage } from '@/lib/env';
import {
  computeCairoReminderInstant,
  formatCairoDateArabic,
  formatTimeOrUnspecified,
  formatUtcDateToIsoDate,
} from '@/lib/cairo-date';
import {
  ensureDefaultReminderRules,
  listEnabledRulesForEventType,
  reminderEventTypeFromSourceType,
} from '@/modules/reminders/reminder-outbox';

export interface ClaimedReminderJob {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  payloadVersion: number;
  scheduledAt: Date;
  availableAt: Date;
  attemptCount: number;
  maxAttempts: number;
  leaseUntil: Date;
  lockedBy: string;
  payload: Record<string, unknown>;
}

export interface WorkerTickOptions {
  now?: Date;
  workerId?: string;
  leaseDurationMs?: number;
  pollLimit?: number;
  restoreMode?: boolean;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  prismaClient?: PrismaClient;
  _faultInject?: 'beforeCommit' | 'afterCommit';
  _faultErrorMessage?: string;
}

export interface WorkerTickResult {
  workerId: string;
  restoreMode: boolean;
  claimedCount: number;
  deliveredCount: number;
  cancelledCount: number;
  skippedCount: number;
  failedCount: number;
  terminalFailedCount: number;
  processedJobIds: string[];
  deliveredIds: string[];
}

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_POLL_LIMIT = 50;
const DEFAULT_BASE_BACKOFF_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;

export function computeRetryBackoffMs(
  attemptCount: number,
  baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS
): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(baseBackoffMs * Math.pow(2, exponent), maxBackoffMs);
}

function asPayloadObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

async function resolveRecipientUserId(
  tx: Prisma.TransactionClient,
  payload: Record<string, unknown>,
  sourceOwnerId: string | null | undefined
): Promise<string> {
  if (typeof payload.recipientUserId === 'string' && payload.recipientUserId.trim().length > 0) {
    return payload.recipientUserId.trim();
  }
  if (sourceOwnerId && sourceOwnerId.trim().length > 0) {
    return sourceOwnerId.trim();
  }
  const bootstrap = await tx.officeBootstrap.findUnique({
    where: { id: 'singleton' },
    select: { ownerId: true },
  });
  if (bootstrap?.ownerId) {
    return bootstrap.ownerId;
  }
  const owner = await tx.user.findFirst({
    where: { role: 'OWNER' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (owner?.id) {
    return owner.id;
  }
  throw new Error('NO_OWNER_RECIPIENT_AVAILABLE');
}

const MAX_EXPIRED_LEASE_RETIRES_PER_TICK = 25;
const EXPIRED_LEASE_TERMINAL_ERROR =
  'انتهت مهلة القفل بعد استنفاد الحد الأقصى لمحاولات التشغيل.';

type ClaimOrRetireAttempt =
  | { kind: 'empty' }
  | { kind: 'retired_failed'; jobId: string; error: string }
  | { kind: 'claimed'; job: ClaimedReminderJob };

async function claimOrRetireNextReminderJob(
  prisma: PrismaClient,
  options: {
    now?: Date;
    workerId: string;
    leaseDurationMs?: number;
  }
): Promise<ClaimOrRetireAttempt> {
  const now = options.now ?? new Date();
  const leaseDurationMs = Math.max(1000, options.leaseDurationMs ?? DEFAULT_LEASE_MS);
  const leaseUntil = new Date(now.getTime() + leaseDurationMs);

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<
      Array<{
        id: string;
        source_type: string;
        source_id: string;
        source_version: number;
        payload_version: number;
        scheduled_at: Date;
        available_at: Date;
        attempt_count: number;
        max_attempts: number;
        status: string;
        payload: unknown;
      }>
    >`
      SELECT
        "id",
        "source_type",
        "source_id",
        "source_version",
        "payload_version",
        "scheduled_at",
        "available_at",
        "attempt_count",
        "max_attempts",
        "status"::text AS "status",
        "payload"
      FROM "job_run"
      WHERE "job_type" = 'REMINDER_DELIVERY'
        AND (
          (
            "status" = 'PENDING'
            AND "available_at" <= ${now}
            AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
          )
          OR
          (
            "status" = 'RUNNING'
            AND "lease_until" IS NOT NULL
            AND "lease_until" <= ${now}
          )
        )
      ORDER BY "available_at" ASC, "created_at" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const row = candidates[0];
    if (!row) {
      return { kind: 'empty' as const };
    }

    // If an expired RUNNING job had already reached max_attempts, move directly to terminal FAILED
    if (row.status === 'RUNNING' && row.attempt_count >= row.max_attempts) {
      await tx.jobRun.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          completedAt: now,
          leaseUntil: null,
          lockedBy: null,
          lastError: EXPIRED_LEASE_TERMINAL_ERROR,
        },
      });
      return {
        kind: 'retired_failed' as const,
        jobId: row.id,
        error: EXPIRED_LEASE_TERMINAL_ERROR,
      };
    }

    const nextAttempt = row.attempt_count + 1;
    await tx.jobRun.update({
      where: { id: row.id },
      data: {
        status: 'RUNNING',
        lockedBy: options.workerId,
        leaseUntil,
        attemptCount: nextAttempt,
      },
    });

    return {
      kind: 'claimed' as const,
      job: {
        id: row.id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceVersion: row.source_version,
        payloadVersion: row.payload_version,
        scheduledAt: row.scheduled_at,
        availableAt: row.available_at,
        attemptCount: nextAttempt,
        maxAttempts: row.max_attempts,
        leaseUntil,
        lockedBy: options.workerId,
        payload: asPayloadObject(row.payload),
      },
    };
  });
}

/**
 * Atomically claims at most one due or lease-expired REMINDER_DELIVERY JobRun
 * using FOR UPDATE SKIP LOCKED. Retires any expired max-attempt poison-pill jobs
 * encountered along a bounded scan, returning null if no eligible job is ready.
 */
export async function claimNextReminderJob(
  prisma: PrismaClient,
  options: {
    now?: Date;
    workerId: string;
    leaseDurationMs?: number;
  }
): Promise<ClaimedReminderJob | null> {
  for (let scan = 0; scan < MAX_EXPIRED_LEASE_RETIRES_PER_TICK; scan++) {
    const attempt = await claimOrRetireNextReminderJob(prisma, options);
    if (attempt.kind === 'claimed') {
      return attempt.job;
    }
    if (attempt.kind === 'empty') {
      return null;
    }
  }
  return null;
}

interface SourceEligibilityResult {
  eligible: boolean;
  eventType?: ReminderEventType;
  eventDateYmd?: string;
  matterId?: string | null;
  sourceOwnerId?: string;
  title?: string;
  body?: string;
}

async function evaluateLiveSourceEligibility(
  tx: Prisma.TransactionClient,
  job: {
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    payload: Record<string, unknown>;
  }
): Promise<SourceEligibilityResult> {
  if (job.sourceType === 'Hearing') {
    const hearing = await tx.hearing.findUnique({
      where: { id: job.sourceId },
      include: {
        proceeding: {
          select: {
            archivedAt: true,
            court: { select: { name: true } },
            matter: {
              select: {
                id: true,
                fileCode: true,
                title: true,
                status: true,
                archivedAt: true,
              },
            },
          },
        },
      },
    });

    if (!hearing || hearing.status !== 'SCHEDULED') {
      return { eligible: false };
    }
    if (
      hearing.proceeding.archivedAt !== null ||
      hearing.proceeding.matter.archivedAt !== null ||
      hearing.proceeding.matter.status === 'ARCHIVED'
    ) {
      return { eligible: false };
    }
    if (
      typeof job.payload.sourceVersion === 'number' &&
      hearing.version !== job.payload.sourceVersion
    ) {
      return { eligible: false };
    }

    const eventDateYmd = formatUtcDateToIsoDate(hearing.hearingDate);
    if (!eventDateYmd) {
      return { eligible: false };
    }
    if (
      typeof job.payload.hearingDate === 'string' &&
      job.payload.hearingDate !== eventDateYmd
    ) {
      return { eligible: false };
    }

    const matter = hearing.proceeding.matter;
    return {
      eligible: true,
      eventType: 'HEARING',
      eventDateYmd,
      matterId: matter.id,
      sourceOwnerId: hearing.updatedById || hearing.createdById,
      title: `تذكير بجلسة قضائية — ${matter.fileCode}`,
      body: `${matter.title} • ${hearing.proceeding.court.name} • ${formatCairoDateArabic(eventDateYmd)} (${formatTimeOrUnspecified(hearing.hearingTime)})`,
    };
  }

  if (job.sourceType === 'Deadline') {
    const deadline = await tx.deadline.findUnique({
      where: { id: job.sourceId },
      include: {
        matter: {
          select: {
            id: true,
            fileCode: true,
            title: true,
            status: true,
            archivedAt: true,
          },
        },
        proceeding: {
          select: { archivedAt: true },
        },
      },
    });

    if (!deadline || deadline.status !== 'CONFIRMED' || !deadline.dueDate) {
      return { eligible: false };
    }
    if (deadline.version !== job.sourceVersion) {
      return { eligible: false };
    }
    if (
      typeof job.payload.version === 'number' &&
      deadline.version !== job.payload.version
    ) {
      return { eligible: false };
    }
    if (
      deadline.matter.archivedAt !== null ||
      deadline.matter.status === 'ARCHIVED' ||
      (deadline.proceeding && deadline.proceeding.archivedAt !== null)
    ) {
      return { eligible: false };
    }

    const eventDateYmd = formatUtcDateToIsoDate(deadline.dueDate);
    if (!eventDateYmd) {
      return { eligible: false };
    }
    if (typeof job.payload.dueDate === 'string' && job.payload.dueDate !== eventDateYmd) {
      return { eligible: false };
    }

    return {
      eligible: true,
      eventType: 'DEADLINE',
      eventDateYmd,
      matterId: deadline.matter.id,
      sourceOwnerId:
        deadline.confirmedById || deadline.updatedById || deadline.createdById,
      title: `تذكير بموعد قانوني مؤكد — ${deadline.matter.fileCode}`,
      body: `${deadline.title} • ${deadline.matter.title} • ${formatCairoDateArabic(eventDateYmd)} (${formatTimeOrUnspecified(deadline.dueTime)})`,
    };
  }

  if (job.sourceType === 'Task') {
    const task = await tx.task.findUnique({
      where: { id: job.sourceId },
      include: {
        matter: {
          select: {
            id: true,
            fileCode: true,
            title: true,
            status: true,
            archivedAt: true,
          },
        },
        proceeding: {
          select: { archivedAt: true },
        },
      },
    });

    if (
      !task ||
      (task.status !== 'OPEN' && task.status !== 'IN_PROGRESS') ||
      !task.dueDate
    ) {
      return { eligible: false };
    }
    if (
      (task.matter &&
        (task.matter.archivedAt !== null || task.matter.status === 'ARCHIVED')) ||
      (task.proceeding && task.proceeding.archivedAt !== null)
    ) {
      return { eligible: false };
    }

    // Non-date edits (e.g. OPEN -> IN_PROGRESS, title, priority, dueTime) increment task.version
    // without replacing the active reminder JobRun. Only supersede if a newer Task reminder version exists.
    const newerTaskJob = await tx.jobRun.findFirst({
      where: {
        jobType: 'REMINDER_DELIVERY',
        sourceType: 'Task',
        sourceId: task.id,
        sourceVersion: { gt: job.sourceVersion },
      },
      select: { id: true },
    });
    if (newerTaskJob) {
      return { eligible: false };
    }

    const eventDateYmd = formatUtcDateToIsoDate(task.dueDate);
    if (!eventDateYmd) {
      return { eligible: false };
    }
    if (typeof job.payload.dueDate === 'string' && job.payload.dueDate !== eventDateYmd) {
      return { eligible: false };
    }

    return {
      eligible: true,
      eventType: 'TASK',
      eventDateYmd,
      matterId: task.matter?.id ?? null,
      sourceOwnerId: task.updatedById || task.createdById,
      title: `تذكير بمهمة إجرائية${task.matter ? ` — ${task.matter.fileCode}` : ''}`,
      body: `${task.title}${task.matter ? ` • ${task.matter.title}` : ''} • ${formatCairoDateArabic(eventDateYmd)} (${formatTimeOrUnspecified(task.dueTime)})`,
    };
  }

  return { eligible: false };
}

export async function processClaimedReminderJob(
  prisma: PrismaClient,
  claimed: ClaimedReminderJob,
  options: {
    now?: Date;
    _faultInject?: 'beforeCommit' | 'afterCommit';
    _faultErrorMessage?: string;
  } = {}
): Promise<{
  outcome: 'succeeded' | 'cancelled' | 'skipped';
  deliveredIds: string[];
}> {
  const now = options.now ?? new Date();

  const txResult = await prisma.$transaction(async (tx) => {
    const [lockedJob] = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        locked_by: string | null;
        source_type: string;
        source_id: string;
        source_version: number;
        max_attempts: number;
        payload: unknown;
      }>
    >`
      SELECT
        "id",
        "status"::text AS "status",
        "locked_by",
        "source_type",
        "source_id",
        "source_version",
        "max_attempts",
        "payload"
      FROM "job_run"
      WHERE "id" = ${claimed.id}
      FOR UPDATE
    `;

    // Fence stale or cancelled workers before touching deliveries
    if (
      !lockedJob ||
      lockedJob.status !== 'RUNNING' ||
      lockedJob.locked_by !== claimed.lockedBy
    ) {
      return { outcome: 'skipped' as const, deliveredIds: [] as string[] };
    }

    const payloadObj = asPayloadObject(lockedJob.payload);
    const live = await evaluateLiveSourceEligibility(tx, {
      sourceType: lockedJob.source_type,
      sourceId: lockedJob.source_id,
      sourceVersion: lockedJob.source_version,
      payload: payloadObj,
    });

    if (!live.eligible || !live.eventType || !live.eventDateYmd) {
      await tx.jobRun.update({
        where: { id: lockedJob.id },
        data: {
          status: 'CANCELLED',
          completedAt: now,
          leaseUntil: null,
          lockedBy: null,
        },
      });
      await tx.reminderDelivery.updateMany({
        where: {
          sourceType: lockedJob.source_type,
          sourceId: lockedJob.source_id,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: { status: 'CANCELLED' },
      });
      return { outcome: 'cancelled' as const, deliveredIds: [] as string[] };
    }

    const eventType =
      reminderEventTypeFromSourceType(lockedJob.source_type) ?? live.eventType;
    await ensureDefaultReminderRules(tx, [eventType]);
    const enabledRules = await listEnabledRulesForEventType(tx, eventType);

    const rulesWithInstants = enabledRules
      .map((rule) => ({
        rule,
        instant: computeCairoReminderInstant(
          live.eventDateYmd!,
          rule.dayOffset,
          rule.reminderTime
        ),
      }))
      .sort((a, b) => a.instant.getTime() - b.instant.getTime());

    const dueRules = rulesWithInstants.filter(
      (entry) => entry.instant.getTime() <= now.getTime()
    );
    const futureRules = rulesWithInstants.filter(
      (entry) => entry.instant.getTime() > now.getTime()
    );

    const recipientUserId = await resolveRecipientUserId(
      tx,
      payloadObj,
      live.sourceOwnerId
    );

    const deliveredIds: string[] = [];
    for (const { rule, instant } of dueRules) {
      const ruleKey = `offset_${rule.dayOffset}`;
      const existing = await tx.reminderDelivery.findUnique({
        where: {
          sourceType_sourceId_sourceVersion_ruleKey_channel_recipientUserId: {
            sourceType: lockedJob.source_type,
            sourceId: lockedJob.source_id,
            sourceVersion: lockedJob.source_version,
            ruleKey,
            channel: 'IN_APP',
            recipientUserId,
          },
        },
      });

      if (!existing) {
        const created = await tx.reminderDelivery.create({
          data: {
            sourceType: lockedJob.source_type,
            sourceId: lockedJob.source_id,
            sourceVersion: lockedJob.source_version,
            ruleId: rule.id,
            ruleKey,
            scheduledAt: instant,
            channel: 'IN_APP',
            recipientUserId,
            status: 'SENT',
            title: live.title!,
            body: live.body!,
            matterId: live.matterId ?? null,
            deliveredAt: now,
            readAt: null,
            jobRunId: lockedJob.id,
          },
          select: { id: true },
        });
        deliveredIds.push(created.id);
      } else if (existing.status === 'PENDING' || existing.status === 'PROCESSING') {
        await tx.reminderDelivery.update({
          where: { id: existing.id },
          data: {
            status: 'SENT',
            deliveredAt: now,
            jobRunId: lockedJob.id,
          },
        });
        deliveredIds.push(existing.id);
      }
      // If existing is already SENT/FAILED/CANCELLED, preserve idempotently without mutating payload
    }

    if (process.env.NODE_ENV === 'test' && options._faultInject === 'beforeCommit') {
      throw new Error(options._faultErrorMessage ?? 'SIMULATED_WORKER_PRE_COMMIT_FAILURE');
    }

    await tx.jobRun.update({
      where: { id: lockedJob.id },
      data: {
        status: 'SUCCEEDED',
        completedAt: now,
        leaseUntil: null,
        lockedBy: null,
        lastError: null,
      },
    });

    // Chain the next future enabled rule that has not yet been delivered
    for (const { rule, instant } of futureRules) {
      const ruleKey = `offset_${rule.dayOffset}`;
      const alreadySent = await tx.reminderDelivery.findUnique({
        where: {
          sourceType_sourceId_sourceVersion_ruleKey_channel_recipientUserId: {
            sourceType: lockedJob.source_type,
            sourceId: lockedJob.source_id,
            sourceVersion: lockedJob.source_version,
            ruleKey,
            channel: 'IN_APP',
            recipientUserId,
          },
        },
        select: { id: true },
      });
      if (alreadySent) continue;

      const nextDedupKey = `reminder_${lockedJob.source_type}_${lockedJob.source_id}_v${lockedJob.source_version}_r${rule.dayOffset}`;
      const existingNextJob = await tx.jobRun.findUnique({
        where: { deduplicationKey: nextDedupKey },
        select: { id: true },
      });
      if (!existingNextJob) {
        await tx.jobRun.create({
          data: {
            jobType: 'REMINDER_DELIVERY',
            sourceType: lockedJob.source_type,
            sourceId: lockedJob.source_id,
            sourceVersion: lockedJob.source_version,
            payloadVersion: 1,
            scheduledAt: instant,
            availableAt: instant,
            maxAttempts: lockedJob.max_attempts,
            status: 'PENDING',
            deduplicationKey: nextDedupKey,
            payload: (lockedJob.payload ?? {}) as Prisma.InputJsonValue,
          },
        });
      }
      break;
    }

    return { outcome: 'succeeded' as const, deliveredIds };
  });

  if (
    process.env.NODE_ENV === 'test' &&
    options._faultInject === 'afterCommit' &&
    txResult.outcome === 'succeeded'
  ) {
    throw new Error(options._faultErrorMessage ?? 'SIMULATED_WORKER_POST_COMMIT_CRASH');
  }

  return txResult;
}

export async function recordWorkerJobFailure(
  prisma: PrismaClient,
  params: {
    jobId: string;
    workerId: string;
    attemptCount: number;
    maxAttempts: number;
    error: unknown;
    now: Date;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
  }
): Promise<{ terminal: boolean; redactedError: string }> {
  const redactedError = redactErrorMessage(params.error);
  const terminal = params.attemptCount >= params.maxAttempts;

  if (terminal) {
    await prisma.jobRun.updateMany({
      where: {
        id: params.jobId,
        status: 'RUNNING',
        lockedBy: params.workerId,
      },
      data: {
        status: 'FAILED',
        completedAt: params.now,
        leaseUntil: null,
        lockedBy: null,
        lastError: redactedError,
      },
    });
  } else {
    const delayMs = computeRetryBackoffMs(
      params.attemptCount,
      params.baseBackoffMs,
      params.maxBackoffMs
    );
    const nextAttemptAt = new Date(params.now.getTime() + delayMs);
    await prisma.jobRun.updateMany({
      where: {
        id: params.jobId,
        status: 'RUNNING',
        lockedBy: params.workerId,
      },
      data: {
        status: 'PENDING',
        nextAttemptAt,
        leaseUntil: null,
        lockedBy: null,
        lastError: redactedError,
      },
    });
  }

  return { terminal, redactedError };
}

async function upsertHeartbeat(
  prisma: PrismaClient,
  data: {
    workerId: string;
    lastPollAt: Date;
    lastSuccessAt?: Date;
    lastErrorAt?: Date;
    lastError?: string;
    restoreMode: boolean;
  }
): Promise<void> {
  await prisma.workerHeartbeat.upsert({
    where: { id: 'reminder-worker' },
    create: {
      id: 'reminder-worker',
      workerId: data.workerId,
      lastPollAt: data.lastPollAt,
      lastSuccessAt: data.lastSuccessAt ?? null,
      lastErrorAt: data.lastErrorAt ?? null,
      lastError: data.lastError ?? null,
      restoreMode: data.restoreMode,
    },
    update: {
      workerId: data.workerId,
      lastPollAt: data.lastPollAt,
      restoreMode: data.restoreMode,
      ...(data.lastSuccessAt !== undefined ? { lastSuccessAt: data.lastSuccessAt } : {}),
      ...(data.lastErrorAt !== undefined ? { lastErrorAt: data.lastErrorAt } : {}),
      ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
    },
  });
}

/**
 * Executes one bounded polling tick for durable reminder delivery.
 * In RESTORE_MODE / REMINDER_DISPATCH_DISABLED, records heartbeat with restoreMode=true
 * and exits without claiming or delivering any job.
 */
export async function runReminderWorkerTick(
  options: WorkerTickOptions = {}
): Promise<WorkerTickResult> {
  const prisma = options.prismaClient ?? getPrismaClient();
  const now = options.now ?? new Date();
  const workerId =
    options.workerId ?? `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const pollLimit = Math.max(1, options.pollLimit ?? DEFAULT_POLL_LIMIT);
  const restoreMode = Boolean(options.restoreMode) || isWorkerDispatchDisabled();

  if (restoreMode) {
    await upsertHeartbeat(prisma, {
      workerId,
      lastPollAt: now,
      restoreMode: true,
    });
    return {
      workerId,
      restoreMode: true,
      claimedCount: 0,
      deliveredCount: 0,
      cancelledCount: 0,
      skippedCount: 0,
      failedCount: 0,
      terminalFailedCount: 0,
      processedJobIds: [],
      deliveredIds: [],
    };
  }

  let claimedCount = 0;
  let deliveredCount = 0;
  let cancelledCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let terminalFailedCount = 0;
  const processedJobIds: string[] = [];
  const deliveredIds: string[] = [];
  let lastRedactedError: string | undefined;

  const maxScans = pollLimit + MAX_EXPIRED_LEASE_RETIRES_PER_TICK;
  for (let scan = 0; scan < maxScans && claimedCount < pollLimit; scan++) {
    const attempt = await claimOrRetireNextReminderJob(prisma, {
      now,
      workerId,
      leaseDurationMs: options.leaseDurationMs,
    });

    if (attempt.kind === 'empty') {
      break;
    }

    if (attempt.kind === 'retired_failed') {
      failedCount += 1;
      terminalFailedCount += 1;
      processedJobIds.push(attempt.jobId);
      lastRedactedError = attempt.error;
      continue;
    }

    const claimed = attempt.job;
    claimedCount += 1;
    processedJobIds.push(claimed.id);

    try {
      const outcome = await processClaimedReminderJob(prisma, claimed, {
        now,
        _faultInject: options._faultInject,
        _faultErrorMessage: options._faultErrorMessage,
      });

      if (outcome.outcome === 'succeeded') {
        deliveredCount += outcome.deliveredIds.length;
        deliveredIds.push(...outcome.deliveredIds);
      } else if (outcome.outcome === 'cancelled') {
        cancelledCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      if (
        process.env.NODE_ENV === 'test' &&
        options._faultInject === 'afterCommit'
      ) {
        await upsertHeartbeat(prisma, {
          workerId,
          lastPollAt: now,
          lastSuccessAt: now,
          restoreMode: false,
        });
        throw error;
      }

      const failure = await recordWorkerJobFailure(prisma, {
        jobId: claimed.id,
        workerId,
        attemptCount: claimed.attemptCount,
        maxAttempts: claimed.maxAttempts,
        error,
        now,
        baseBackoffMs: options.baseBackoffMs,
        maxBackoffMs: options.maxBackoffMs,
      });
      failedCount += 1;
      if (failure.terminal) {
        terminalFailedCount += 1;
      }
      lastRedactedError = failure.redactedError;
    }
  }

  if (failedCount > 0) {
    await upsertHeartbeat(prisma, {
      workerId,
      lastPollAt: now,
      lastErrorAt: now,
      lastError: lastRedactedError ?? 'Reminder delivery job failed',
      restoreMode: false,
    });
  } else {
    await upsertHeartbeat(prisma, {
      workerId,
      lastPollAt: now,
      lastSuccessAt: now,
      restoreMode: false,
    });
  }

  return {
    workerId,
    restoreMode: false,
    claimedCount,
    deliveredCount,
    cancelledCount,
    skippedCount,
    failedCount,
    terminalFailedCount,
    processedJobIds,
    deliveredIds,
  };
}