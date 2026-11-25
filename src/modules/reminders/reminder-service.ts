import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/lib/auth';
import { isWorkerDispatchDisabled, redactErrorMessage } from '@/lib/env';
import { recordAuditEvent } from '@/lib/audit';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  resolveConcurrentIdempotency,
  runWithIdempotencyRetry,
} from '@/lib/idempotency';
import {
  computeCairoReminderInstant,
  formatCairoDateArabic,
  formatTimeOrUnspecified,
  formatUtcDateToIsoDate,
  getCairoTodayDateString,
  isCairoDateOverdue,
} from '@/lib/cairo-date';
import { assertAuthorized } from '@/modules/identity/authorize';
import type { Actor, Permission } from '@/modules/identity/types';
import { ensureDefaultReminderRules } from './reminder-outbox';
import {
  ConcurrencyConflictError,
  FailedReminderJobDTO,
  INBOX_DELIVERY_LIMITS_NOTICE,
  InboxItemDTO,
  InboxOverviewDTO,
  ListInboxParams,
  MarkReminderReadInput,
  NotFoundError,
  ReminderRuleDTO,
  ReminderValidationError,
  RetryFailedReminderJobInput,
  RetryReminderJobResultDTO,
  UnauthorizedError,
  UnsupportedTransitionError,
  UpdateReminderRuleInput,
  WorkerHealthDTO,
  WorkerHealthState,
  listInboxSchema,
  markReminderReadSchema,
  retryFailedReminderJobSchema,
  updateReminderRuleSchema,
} from './reminder-types';

const prisma = new Proxy({} as ReturnType<typeof getPrismaClient>, {
  get(_target, prop) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

const STALE_HEARTBEAT_MS = 5 * 60_000;
const MISSED_DELIVERY_GRACE_MS = 5 * 60_000;

function assertActorAuthorized(actor: Actor | undefined | null, permission: Permission): Actor {
  if (!actor || !actor.id || !actor.role) {
    throw new UnauthorizedError('غير مصرح. يرجى تسجيل الدخول أولاً.');
  }
  assertAuthorized(actor, permission);
  return actor;
}

function parseOrThrow<T>(
  schema: {
    safeParse: (v: unknown) =>
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  },
  raw: unknown,
  fallbackMessage: string
): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map((segment) => String(segment)).join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new ReminderValidationError(fallbackMessage, fieldErrors);
  }
  return parsed.data;
}

function normalizeReminderTime(raw: string): string {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new ReminderValidationError('صيغة وقت التذكير غير صالحة (HH:mm).', {
      reminderTime: 'صيغة الوقت يجب أن تكون HH:mm',
    });
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new ReminderValidationError('قيمة وقت التذكير خارج النطاق المسموح (00:00 إلى 23:59).', {
      reminderTime: 'قيمة الوقت خارج النطاق المسموح',
    });
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function mapRuleToDTO(rule: {
  id: string;
  eventType: ReminderRuleDTO['eventType'];
  dayOffset: number;
  reminderTime: string;
  channel: ReminderRuleDTO['channel'];
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): ReminderRuleDTO {
  return {
    id: rule.id,
    eventType: rule.eventType,
    dayOffset: rule.dayOffset,
    reminderTime: rule.reminderTime,
    channel: rule.channel,
    enabled: rule.enabled,
    version: rule.version,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

interface SourceSummary {
  matterId: string | null;
  matterFileCode: string | null;
  matterTitle: string | null;
  eventDate: string | null;
  eventTime: string | null;
  status: string | null;
  isActive: boolean;
  label: string;
  targetHref: string | null;
}

async function loadSourceSummaries(
  sources: Array<{ sourceType: string; sourceId: string }>
): Promise<Map<string, SourceSummary>> {
  const hearingIds: string[] = [];
  const deadlineIds: string[] = [];
  const taskIds: string[] = [];

  for (const s of sources) {
    if (s.sourceType === 'Hearing') hearingIds.push(s.sourceId);
    else if (s.sourceType === 'Deadline') deadlineIds.push(s.sourceId);
    else if (s.sourceType === 'Task') taskIds.push(s.sourceId);
  }

  const [hearings, deadlines, tasks] = await Promise.all([
    hearingIds.length > 0
      ? prisma.hearing.findMany({
          where: { id: { in: Array.from(new Set(hearingIds)) } },
          select: {
            id: true,
            hearingDate: true,
            hearingTime: true,
            status: true,
            proceeding: {
              select: {
                court: { select: { name: true } },
                matter: { select: { id: true, fileCode: true, title: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    deadlineIds.length > 0
      ? prisma.deadline.findMany({
          where: { id: { in: Array.from(new Set(deadlineIds)) } },
          select: {
            id: true,
            title: true,
            dueDate: true,
            dueTime: true,
            status: true,
            matter: { select: { id: true, fileCode: true, title: true } },
          },
        })
      : Promise.resolve([]),
    taskIds.length > 0
      ? prisma.task.findMany({
          where: { id: { in: Array.from(new Set(taskIds)) } },
          select: {
            id: true,
            title: true,
            dueDate: true,
            dueTime: true,
            status: true,
            matter: { select: { id: true, fileCode: true, title: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const map = new Map<string, SourceSummary>();

  for (const h of hearings) {
    const matter = h.proceeding.matter;
    map.set(`Hearing:${h.id}`, {
      matterId: matter.id,
      matterFileCode: matter.fileCode,
      matterTitle: matter.title,
      eventDate: formatUtcDateToIsoDate(h.hearingDate),
      eventTime: h.hearingTime ?? null,
      status: h.status,
      isActive: h.status === 'SCHEDULED',
      label: `جلسة قضائية — ${h.proceeding.court.name}`,
      targetHref: `/hearings/${h.id}`,
    });
  }

  for (const d of deadlines) {
    map.set(`Deadline:${d.id}`, {
      matterId: d.matter.id,
      matterFileCode: d.matter.fileCode,
      matterTitle: d.matter.title,
      eventDate: formatUtcDateToIsoDate(d.dueDate),
      eventTime: d.dueTime ?? null,
      status: d.status,
      isActive: d.status === 'CONFIRMED',
      label: `موعد قانوني — ${d.title}`,
      targetHref: d.status === 'DRAFT' ? `/deadlines?review=${d.id}` : '/deadlines',
    });
  }

  for (const t of tasks) {
    map.set(`Task:${t.id}`, {
      matterId: t.matter?.id ?? null,
      matterFileCode: t.matter?.fileCode ?? null,
      matterTitle: t.matter?.title ?? null,
      eventDate: formatUtcDateToIsoDate(t.dueDate),
      eventTime: t.dueTime ?? null,
      status: t.status,
      isActive: t.status === 'OPEN' || t.status === 'IN_PROGRESS',
      label: `مهمة إجرائية — ${t.title}`,
      targetHref: '/tasks',
    });
  }

  return map;
}

function enrichDeliveryRow(
  delivery: {
    id: string;
    sourceType: string;
    sourceId: string;
    sourceVersion: number;
    ruleKey: string;
    scheduledAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
    status: InboxItemDTO['status'];
    title: string;
    body: string;
    matterId: string | null;
    jobRunId: string | null;
    matter?: { fileCode: string; title: string } | null;
  },
  summary: SourceSummary | undefined,
  cairoToday: string
): InboxItemDTO {
  const eventDate = summary?.eventDate ?? null;
  const eventTime = summary?.eventTime ?? null;
  const isOverdue = Boolean(summary?.isActive && isCairoDateOverdue(eventDate, cairoToday));
  const isMissed =
    isOverdue ||
    Boolean(
      delivery.deliveredAt &&
        delivery.deliveredAt.getTime() - delivery.scheduledAt.getTime() > MISSED_DELIVERY_GRACE_MS
    );

  return {
    id: delivery.id,
    sourceType: delivery.sourceType,
    sourceId: delivery.sourceId,
    sourceVersion: delivery.sourceVersion,
    ruleKey: delivery.ruleKey,
    scheduledAt: delivery.scheduledAt.toISOString(),
    deliveredAt: delivery.deliveredAt ? delivery.deliveredAt.toISOString() : null,
    readAt: delivery.readAt ? delivery.readAt.toISOString() : null,
    isRead: delivery.readAt !== null,
    status: delivery.status,
    title: delivery.title,
    body: delivery.body,
    matterId: delivery.matterId ?? summary?.matterId ?? null,
    matterFileCode: delivery.matter?.fileCode ?? summary?.matterFileCode ?? null,
    matterTitle: delivery.matter?.title ?? summary?.matterTitle ?? null,
    eventDate,
    eventTime,
    timeLabel: formatTimeOrUnspecified(eventTime),
    isOverdue,
    isMissed,
    sourceStatus: summary?.status ?? null,
    targetHref: summary?.targetHref ?? null,
    jobRunId: delivery.jobRunId ?? null,
  };
}

export function computeWorkerHealth(
  heartbeat: {
    workerId: string;
    lastPollAt: Date;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
    restoreMode: boolean;
  } | null,
  failedCount: number,
  now: Date
): WorkerHealthDTO {
  const restoreMode = isWorkerDispatchDisabled() || Boolean(heartbeat?.restoreMode);
  const hasNewerError = Boolean(
    heartbeat?.lastErrorAt &&
      (!heartbeat.lastSuccessAt || heartbeat.lastErrorAt.getTime() > heartbeat.lastSuccessAt.getTime())
  );

  let status: WorkerHealthState;
  if (restoreMode) {
    status = 'RESTORE_MODE';
  } else if (failedCount > 0 || hasNewerError) {
    status = 'FAILED';
  } else if (!heartbeat) {
    status = 'NOT_STARTED';
  } else if (now.getTime() - heartbeat.lastPollAt.getTime() > STALE_HEARTBEAT_MS) {
    status = 'STALE';
  } else {
    status = 'HEALTHY';
  }

  return {
    status,
    workerId: heartbeat?.workerId ?? null,
    lastPollAt: heartbeat?.lastPollAt ? heartbeat.lastPollAt.toISOString() : null,
    lastSuccessAt: heartbeat?.lastSuccessAt ? heartbeat.lastSuccessAt.toISOString() : null,
    lastErrorAt: heartbeat?.lastErrorAt ? heartbeat.lastErrorAt.toISOString() : null,
    lastError: heartbeat?.lastError ? redactErrorMessage(heartbeat.lastError) : null,
    restoreMode,
    lastRefreshedAt: now.toISOString(),
  };
}

export async function listInbox(
  actor: Actor,
  rawParams: ListInboxParams = {},
  opts?: { now?: Date }
): Promise<InboxOverviewDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const params = parseOrThrow(listInboxSchema, rawParams, 'معاملات عرض صندوق التنبيهات غير صالحة.');
  const now = opts?.now ?? new Date();
  const cairoToday = getCairoTodayDateString(now);

  const ruleCount = await prisma.reminderRule.count();
  if (ruleCount === 0) {
    await prisma.$transaction((tx) => ensureDefaultReminderRules(tx));
  }

  const [deliveries, failedJobRows, heartbeat, rules, unreadCount, failedCount] = await Promise.all([
    prisma.reminderDelivery.findMany({
      where: {
        recipientUserId: actor.id,
        status: 'SENT',
        ...(params.unreadOnly ? { readAt: null } : {}),
      },
      include: {
        matter: { select: { fileCode: true, title: true } },
      },
      orderBy: [
        { readAt: { sort: 'asc', nulls: 'first' } },
        { deliveredAt: 'desc' },
        { scheduledAt: 'desc' },
        { id: 'asc' },
      ],
      take: params.limit,
    }),
    prisma.jobRun.findMany({
      where: {
        jobType: 'REMINDER_DELIVERY',
        status: 'FAILED',
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 50,
    }),
    prisma.workerHeartbeat.findUnique({
      where: { id: 'reminder-worker' },
    }),
    prisma.reminderRule.findMany({
      orderBy: [{ eventType: 'asc' }, { dayOffset: 'desc' }],
    }),
    prisma.reminderDelivery.count({
      where: {
        recipientUserId: actor.id,
        status: 'SENT',
        readAt: null,
      },
    }),
    prisma.jobRun.count({
      where: {
        jobType: 'REMINDER_DELIVERY',
        status: 'FAILED',
      },
    }),
  ]);

  const summaries = await loadSourceSummaries([
    ...deliveries.map((d) => ({ sourceType: d.sourceType, sourceId: d.sourceId })),
    ...failedJobRows.map((j) => ({ sourceType: j.sourceType, sourceId: j.sourceId })),
  ]);

  const items = deliveries
    .map((d) => enrichDeliveryRow(d, summaries.get(`${d.sourceType}:${d.sourceId}`), cairoToday))
    .sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      const aTime = a.deliveredAt ?? a.scheduledAt;
      const bTime = b.deliveredAt ?? b.scheduledAt;
      return bTime.localeCompare(aTime);
    });

  const failedJobs: FailedReminderJobDTO[] = failedJobRows.map((job) => {
    const summary = summaries.get(`${job.sourceType}:${job.sourceId}`);
    const fallbackLabel =
      job.sourceType === 'Hearing'
        ? 'تذكير جلسة قضائية'
        : job.sourceType === 'Deadline'
          ? 'تذكير موعد قانوني'
          : 'تذكير مهمة إجرائية';
    return {
      id: job.id,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      sourceVersion: job.sourceVersion,
      scheduledAt: job.scheduledAt.toISOString(),
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      lastError: redactErrorMessage(job.lastError ?? 'تعذر تسليم التذكير.'),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      updatedAt: job.updatedAt.toISOString(),
      sourceLabel: summary?.label ?? fallbackLabel,
      matterId: summary?.matterId ?? null,
      matterFileCode: summary?.matterFileCode ?? null,
      targetHref: summary?.targetHref ?? null,
    };
  });

  const overdueCount = items.filter((item) => item.isOverdue || item.isMissed).length;

  return {
    cairoToday,
    cairoTodayFormatted: formatCairoDateArabic(cairoToday),
    items,
    failedJobs,
    rules: rules.map(mapRuleToDTO),
    unreadCount,
    failedCount,
    overdueCount,
    workerHealth: computeWorkerHealth(heartbeat, failedCount, now),
    deliveryLimitsNotice: INBOX_DELIVERY_LIMITS_NOTICE,
  };
}

export async function markReminderRead(
  actor: Actor,
  rawInput: MarkReminderReadInput,
  opts?: { now?: Date }
): Promise<InboxItemDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(markReminderReadSchema, rawInput, 'بيانات تأشير التنبيه غير صالحة.');
  const now = opts?.now ?? new Date();
  const cairoToday = getCairoTodayDateString(now);

  const updated = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<
      Array<{
        id: string;
        recipient_user_id: string;
        status: InboxItemDTO['status'];
        read_at: Date | null;
        source_type: string;
        source_id: string;
      }>
    >`
      SELECT "id", "recipient_user_id", "status", "read_at", "source_type", "source_id"
      FROM "reminder_delivery"
      WHERE "id" = ${input.deliveryId}
      FOR UPDATE
    `;

    if (!locked || locked.recipient_user_id !== actor.id) {
      throw new NotFoundError('التنبيه المطلوب غير موجود.');
    }

    if (locked.status !== 'SENT') {
      throw new UnsupportedTransitionError('لا يمكن تأشير التنبيه كمقروء في حالته الحالية.');
    }

    if (locked.read_at === null) {
      // Only marks readAt on ReminderDelivery; status remains SENT and linked Task/Deadline is untouched.
      await tx.reminderDelivery.update({
        where: { id: locked.id },
        data: { readAt: now },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'MARK_REMINDER_READ',
        entityType: 'ReminderDelivery',
        entityId: locked.id,
        changedFields: {
          sourceType: locked.source_type,
          sourceId: locked.source_id,
          readAt: now.toISOString(),
        },
      });
    }

    return tx.reminderDelivery.findUniqueOrThrow({
      where: { id: locked.id },
      include: {
        matter: { select: { fileCode: true, title: true } },
      },
    });
  });

  const summaries = await loadSourceSummaries([
    { sourceType: updated.sourceType, sourceId: updated.sourceId },
  ]);
  return enrichDeliveryRow(
    updated,
    summaries.get(`${updated.sourceType}:${updated.sourceId}`),
    cairoToday
  );
}

export async function retryFailedReminderJob(
  actor: Actor,
  rawInput: RetryFailedReminderJobInput,
  opts?: { now?: Date }
): Promise<RetryReminderJobResultDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(
    retryFailedReminderJobSchema,
    rawInput,
    'بيانات إعادة تشغيل مهمة التذكير غير صالحة.'
  );
  const now = opts?.now ?? new Date();
  const params = {
    actorId: actor.id,
    commandType: 'retryFailedReminderJob',
    key: input.idempotencyKey,
    payload: { jobRunId: input.jobRunId },
  };

  const execute = () =>
    prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, params);
      if (claim.isReplay && claim.resultPayload) {
        return claim.resultPayload as RetryReminderJobResultDTO;
      }

      const [locked] = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          source_type: string;
          source_id: string;
        }>
      >`
        SELECT "id", "status", "source_type", "source_id"
        FROM "job_run"
        WHERE "id" = ${input.jobRunId}
        FOR UPDATE
      `;

      if (!locked) {
        throw new NotFoundError('مهمة التذكير المطلوبة غير موجودة.');
      }
      if (locked.status !== 'FAILED') {
        throw new UnsupportedTransitionError(
          'لا يمكن إعادة تشغيل إلا مهام التذكير التي وصلت إلى حالة الفشل النهائي.'
        );
      }

      const updated = await tx.jobRun.update({
        where: { id: locked.id },
        data: {
          status: 'PENDING',
          attemptCount: 0,
          availableAt: now,
          nextAttemptAt: now,
          leaseUntil: null,
          lockedBy: null,
          completedAt: null,
          lastError: null,
        },
        select: {
          id: true,
          status: true,
          attemptCount: true,
          availableAt: true,
        },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'RETRY_REMINDER_JOB',
        entityType: 'JobRun',
        entityId: locked.id,
        changedFields: {
          previousStatus: 'FAILED',
          newStatus: 'PENDING',
          sourceType: locked.source_type,
          sourceId: locked.source_id,
        },
      });

      const result: RetryReminderJobResultDTO = {
        id: updated.id,
        status: updated.status,
        attemptCount: updated.attemptCount,
        availableAt: updated.availableAt.toISOString(),
      };

      await completeIdempotencyKey(tx, {
        ...params,
        resultType: 'ReminderJobRetry',
        resultId: updated.id,
        resultPayload: result,
      });

      return result;
    });

  return runWithIdempotencyRetry(execute, async () => {
    const claim = await resolveConcurrentIdempotency(prisma, params);
    if (!claim?.resultPayload) return { resolved: false };
    return { resolved: true, value: claim.resultPayload as RetryReminderJobResultDTO };
  });
}

export async function listReminderRules(actor: Actor): Promise<ReminderRuleDTO[]> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const count = await prisma.reminderRule.count();
  if (count === 0) {
    await prisma.$transaction((tx) => ensureDefaultReminderRules(tx));
  }

  const rules = await prisma.reminderRule.findMany({
    orderBy: [{ eventType: 'asc' }, { dayOffset: 'desc' }],
  });
  return rules.map(mapRuleToDTO);
}

const CHAINED_REMINDER_KEY_RE = /^reminder_.+_v\d+_r\d+(?:_(?:resched|chain)_.+)?$/;

function asJobPayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

async function loadActiveSourceEventDates(
  tx: Prisma.TransactionClient,
  sourceType: 'Hearing' | 'Deadline' | 'Task',
  sourceIds: string[]
): Promise<{
  byId: Map<string, { eventDateYmd: string; version: number }>;
  maxTaskJobVersionById: Map<string, number>;
}> {
  const byId = new Map<string, { eventDateYmd: string; version: number }>();
  const maxTaskJobVersionById = new Map<string, number>();
  if (sourceIds.length === 0) {
    return { byId, maxTaskJobVersionById };
  }

  if (sourceType === 'Hearing') {
    const hearings = await tx.hearing.findMany({
      where: {
        id: { in: sourceIds },
        status: 'SCHEDULED',
        proceeding: {
          archivedAt: null,
          matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
        },
      },
      select: { id: true, hearingDate: true, version: true },
    });
    for (const h of hearings) {
      const ymd = formatUtcDateToIsoDate(h.hearingDate);
      if (ymd) byId.set(h.id, { eventDateYmd: ymd, version: h.version });
    }
    return { byId, maxTaskJobVersionById };
  }

  if (sourceType === 'Deadline') {
    const deadlines = await tx.deadline.findMany({
      where: {
        id: { in: sourceIds },
        status: 'CONFIRMED',
        dueDate: { not: null },
        matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
        OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }],
      },
      select: { id: true, dueDate: true, version: true },
    });
    for (const d of deadlines) {
      const ymd = formatUtcDateToIsoDate(d.dueDate);
      if (ymd) byId.set(d.id, { eventDateYmd: ymd, version: d.version });
    }
    return { byId, maxTaskJobVersionById };
  }

  const [tasks, maxTaskVersions] = await Promise.all([
    tx.task.findMany({
      where: {
        id: { in: sourceIds },
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueDate: { not: null },
        AND: [
          {
            OR: [
              { matterId: null },
              { matter: { archivedAt: null, status: { not: 'ARCHIVED' } } },
            ],
          },
          { OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }] },
        ],
      },
      select: { id: true, dueDate: true, version: true },
    }),
    tx.jobRun.groupBy({
      by: ['sourceId'],
      where: {
        jobType: 'REMINDER_DELIVERY',
        sourceType: 'Task',
        sourceId: { in: sourceIds },
      },
      _max: { sourceVersion: true },
    }),
  ]);
  for (const t of tasks) {
    const ymd = formatUtcDateToIsoDate(t.dueDate);
    if (ymd) byId.set(t.id, { eventDateYmd: ymd, version: t.version });
  }
  for (const row of maxTaskVersions) {
    if (row._max.sourceVersion !== null) {
      maxTaskJobVersionById.set(row.sourceId, row._max.sourceVersion);
    }
  }
  return { byId, maxTaskJobVersionById };
}

/**
 * Atomically updates a PENDING reminder job's schedule (and optional deduplicationKey),
 * clearing nextAttemptAt only while live attemptCount === 0 so concurrent retry backoffs
 * set by a worker after an unlocked read are never wiped out.
 */
async function updatePendingReminderJobSchedule(
  tx: Prisma.TransactionClient,
  jobId: string,
  scheduledAt: Date,
  deduplicationKey?: string
): Promise<number> {
  const baseData = {
    ...(deduplicationKey !== undefined ? { deduplicationKey } : {}),
    scheduledAt,
    availableAt: scheduledAt,
  };
  const zeroAttemptResult = await tx.jobRun.updateMany({
    where: { id: jobId, status: 'PENDING', attemptCount: 0 },
    data: { ...baseData, nextAttemptAt: null },
  });
  if (zeroAttemptResult.count > 0) {
    return zeroAttemptResult.count;
  }
  const retriedResult = await tx.jobRun.updateMany({
    where: { id: jobId, status: 'PENDING', attemptCount: { not: 0 } },
    data: baseData,
  });
  return retriedResult.count;
}

/**
 * Recomputes scheduledAt/availableAt (and chained deduplication keys safely) for active PENDING
 * reminder jobs after a ReminderRule update so schedule shifts take effect without recreating jobs.
 */
async function reschedulePendingReminderJobs(
  tx: Prisma.TransactionClient,
  eventType: ReminderRuleDTO['eventType'],
  now: Date
): Promise<void> {
  const sourceType: 'Hearing' | 'Deadline' | 'Task' =
    eventType === 'HEARING' ? 'Hearing' : eventType === 'DEADLINE' ? 'Deadline' : 'Task';

  const enabledRules = await tx.reminderRule.findMany({
    where: {
      eventType,
      channel: 'IN_APP',
      enabled: true,
    },
    orderBy: [{ dayOffset: 'desc' }, { reminderTime: 'asc' }],
  });
  if (enabledRules.length === 0) {
    return;
  }

  let cursorId: string | undefined;
  while (true) {
    const batch = await tx.jobRun.findMany({
      where: {
        jobType: 'REMINDER_DELIVERY',
        sourceType,
        status: 'PENDING',
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 500,
    });
    if (batch.length === 0) break;
    cursorId = batch[batch.length - 1]!.id;

    const sourceIds = Array.from(new Set(batch.map((j) => j.sourceId)));
    const [{ byId: activeSources, maxTaskJobVersionById }, existingDeliveries] = await Promise.all([
      loadActiveSourceEventDates(tx, sourceType, sourceIds),
      tx.reminderDelivery.findMany({
        where: {
          sourceType,
          sourceId: { in: sourceIds },
          channel: 'IN_APP',
        },
        select: {
          sourceId: true,
          sourceVersion: true,
          ruleKey: true,
        },
      }),
    ]);

    const deliveredRuleKeysBySourceVer = new Map<string, Set<string>>();
    for (const del of existingDeliveries) {
      const k = `${del.sourceId}:${del.sourceVersion}`;
      let set = deliveredRuleKeysBySourceVer.get(k);
      if (!set) {
        set = new Set<string>();
        deliveredRuleKeysBySourceVer.set(k, set);
      }
      set.add(del.ruleKey);
    }

    for (const job of batch) {
      const source = activeSources.get(job.sourceId);
      if (!source) continue;

      const payload = asJobPayload(job.payload);
      if (sourceType === 'Hearing') {
        if (typeof payload.sourceVersion === 'number' && source.version !== payload.sourceVersion) {
          continue;
        }
        if (typeof payload.hearingDate === 'string' && payload.hearingDate !== source.eventDateYmd) {
          continue;
        }
      } else if (sourceType === 'Deadline') {
        if (source.version !== job.sourceVersion) continue;
        if (typeof payload.version === 'number' && source.version !== payload.version) continue;
        if (typeof payload.dueDate === 'string' && payload.dueDate !== source.eventDateYmd) continue;
      } else {
        const maxVer = maxTaskJobVersionById.get(job.sourceId);
        if (maxVer !== undefined && job.sourceVersion < maxVer) continue;
        if (typeof payload.dueDate === 'string' && payload.dueDate !== source.eventDateYmd) continue;
      }

      const deliveredKeys =
        deliveredRuleKeysBySourceVer.get(`${job.sourceId}:${job.sourceVersion}`) ?? new Set<string>();

      const candidates = enabledRules
        .filter((r) => !deliveredKeys.has(`offset_${r.dayOffset}`))
        .map((r) => ({
          rule: r,
          instant: computeCairoReminderInstant(source.eventDateYmd, r.dayOffset, r.reminderTime),
        }))
        .sort((a, b) => a.instant.getTime() - b.instant.getTime());

      const nextCandidate = candidates[0];
      if (!nextCandidate) continue;

      const nextInstant = nextCandidate.instant;
      const isChained = CHAINED_REMINDER_KEY_RE.test(job.deduplicationKey);
      const nextChainedKey = isChained
        ? `reminder_${job.sourceType}_${job.sourceId}_v${job.sourceVersion}_r${nextCandidate.rule.dayOffset}`
        : job.deduplicationKey;

      if (isChained && nextChainedKey !== job.deduplicationKey) {
        const collision = await tx.jobRun.findUnique({
          where: { deduplicationKey: nextChainedKey },
          select: { id: true, status: true },
        });
        let handled = false;
        if (!collision) {
          await tx.$executeRaw`SAVEPOINT sp_resched_dedup`;
          try {
            await updatePendingReminderJobSchedule(tx, job.id, nextInstant, nextChainedKey);
            await tx.$executeRaw`RELEASE SAVEPOINT sp_resched_dedup`;
            handled = true;
          } catch (err) {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
              throw err;
            }
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT sp_resched_dedup`;
            await tx.$executeRaw`RELEASE SAVEPOINT sp_resched_dedup`;
          }
        } else if (collision.status === 'PENDING') {
          const updatedCollisionCount = await updatePendingReminderJobSchedule(
            tx,
            collision.id,
            nextInstant
          );
          if (updatedCollisionCount === 1) {
            await tx.jobRun.updateMany({
              where: { id: job.id, status: 'PENDING' },
              data: {
                status: 'CANCELLED',
                completedAt: now,
                leaseUntil: null,
                lockedBy: null,
              },
            });
            handled = true;
          }
        }
        if (!handled) {
          // Never leave a pulled-forward job holding a future rule's canonical deduplicationKey,
          // otherwise ReminderWorker will later see this job as SUCCEEDED on that key and skip the future rule.
          const fallbackKey = `${nextChainedKey}_resched_${job.id}`;
          if (fallbackKey !== job.deduplicationKey) {
            await updatePendingReminderJobSchedule(tx, job.id, nextInstant, fallbackKey);
          } else if (
            job.scheduledAt.getTime() !== nextInstant.getTime() ||
            job.availableAt.getTime() !== nextInstant.getTime()
          ) {
            await updatePendingReminderJobSchedule(tx, job.id, nextInstant);
          }
        }
        continue;
      }

      if (
        job.scheduledAt.getTime() !== nextInstant.getTime() ||
        job.availableAt.getTime() !== nextInstant.getTime()
      ) {
        await updatePendingReminderJobSchedule(tx, job.id, nextInstant);
      }
    }
  }
}

export async function updateReminderRule(
  actor: Actor,
  rawInput: UpdateReminderRuleInput
): Promise<ReminderRuleDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(
    updateReminderRuleSchema,
    rawInput,
    'بيانات تحديث سياسة التذكير غير صالحة.'
  );
  const normTime =
    input.reminderTime !== undefined ? normalizeReminderTime(input.reminderTime) : undefined;

  const params = {
    actorId: actor.id,
    commandType: 'updateReminderRule',
    key: input.idempotencyKey,
    payload: {
      ruleId: input.ruleId,
      expectedVersion: input.expectedVersion,
      dayOffset: input.dayOffset,
      reminderTime: normTime,
      enabled: input.enabled,
    },
  };

  const execute = () =>
    prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, params);
      if (claim.isReplay && claim.resultPayload) {
        return claim.resultPayload as ReminderRuleDTO;
      }

      const target = await tx.reminderRule.findUnique({
        where: { id: input.ruleId },
        select: { id: true, eventType: true },
      });

      if (!target) {
        throw new NotFoundError('سياسة التذكير المطلوبة غير موجودة.');
      }

      const lockedRules = await tx.$queryRaw<
        Array<{
          id: string;
          event_type: ReminderRuleDTO['eventType'];
          day_offset: number;
          reminder_time: string;
          channel: ReminderRuleDTO['channel'];
          enabled: boolean;
          version: number;
        }>
      >`
        SELECT "id", "event_type", "day_offset", "reminder_time", "channel", "enabled", "version"
        FROM "reminder_rule"
        WHERE "event_type" = ${target.eventType}::"ReminderEventType"
        ORDER BY "id" ASC
        FOR UPDATE
      `;

      const locked = lockedRules.find((r) => r.id === input.ruleId);

      if (!locked) {
        throw new NotFoundError('سياسة التذكير المطلوبة غير موجودة.');
      }

      if (locked.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError(
          'تم تعديل سياسة التذكير بواسطة مستخدم آخر. يرجى التحديث والمحاولة مجدداً.'
        );
      }

      const nextDayOffset = input.dayOffset ?? locked.day_offset;
      const nextTime = normTime ?? locked.reminder_time;
      const nextEnabled = input.enabled ?? locked.enabled;

      if (nextDayOffset !== locked.day_offset) {
        const duplicate = await tx.reminderRule.findFirst({
          where: {
            id: { not: locked.id },
            eventType: locked.event_type,
            dayOffset: nextDayOffset,
            channel: locked.channel,
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ReminderValidationError(
            'توجد سياسة تذكير أخرى بنفس عدد الأيام المسبق لهذا النوع من المواعيد.',
            { dayOffset: 'عدد الأيام مكرر لهذا النوع' }
          );
        }
      }

      const nextVersion = locked.version + 1;
      const updated = await tx.reminderRule.updateMany({
        where: { id: locked.id, version: input.expectedVersion },
        data: {
          dayOffset: nextDayOffset,
          reminderTime: nextTime,
          enabled: nextEnabled,
          version: nextVersion,
        },
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      if (
        nextDayOffset !== locked.day_offset ||
        nextTime !== locked.reminder_time ||
        nextEnabled !== locked.enabled
      ) {
        await reschedulePendingReminderJobs(tx, locked.event_type, new Date());
      }

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UPDATE_REMINDER_RULE',
        entityType: 'ReminderRule',
        entityId: locked.id,
        changedFields: {
          eventType: locked.event_type,
          previousDayOffset: locked.day_offset,
          newDayOffset: nextDayOffset,
          previousReminderTime: locked.reminder_time,
          newReminderTime: nextTime,
          previousEnabled: locked.enabled,
          newEnabled: nextEnabled,
          version: nextVersion,
        },
      });

      const reloaded = await tx.reminderRule.findUniqueOrThrow({ where: { id: locked.id } });
      const dto = mapRuleToDTO(reloaded);

      await completeIdempotencyKey(tx, {
        ...params,
        resultType: 'ReminderRuleUpdate',
        resultId: dto.id,
        resultPayload: dto as unknown as Prisma.InputJsonValue,
      });

      return dto;
    });

  return runWithIdempotencyRetry(execute, async () => {
    const claim = await resolveConcurrentIdempotency(prisma, params);
    if (!claim?.resultPayload) return { resolved: false };
    return { resolved: true, value: claim.resultPayload as ReminderRuleDTO };
  });
}