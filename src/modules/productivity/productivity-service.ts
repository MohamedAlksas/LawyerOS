import type { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/lib/auth';
import type { Actor, Permission } from '@/modules/identity/types';
import { assertAuthorized } from '@/modules/identity/authorize';
import { recordAuditEvent } from '@/lib/audit';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  resolveConcurrentIdempotency,
  runWithIdempotencyRetry,
} from '@/lib/idempotency';
import {
  addCairoDays,
  formatCairoDateArabic,
  formatTimeOrUnspecified,
  formatUtcDateToIsoDate,
  getCairoMonthRange,
  getCairoTodayDateString,
  getCairoWeekRange,
  isCairoDateOverdue,
  parseCalendarDateToUtcDate,
  validateOptionalCalendarTime,
} from '@/lib/cairo-date';
import {
  AgendaDeadlineItemDTO,
  AgendaDTO,
  AgendaHearingItemDTO,
  AgendaTaskItemDTO,
  AgendaView,
  CancelTaskInput,
  CompleteTaskInput,
  CourtConflictWarningDTO,
  CreateTaskInput,
  ListAgendaParams,
  ListTasksParams,
  ProductivityValidationError,
  CrossMatterLinkForbiddenError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  UnauthorizedError,
  SelectableMatterOptionDTO,
  TaskItemDTO,
  TaskStatus,
  TodayOverviewDTO,
  UpdateTaskInput,
  cancelTaskSchema,
  completeTaskSchema,
  createTaskSchema,
  listAgendaSchema,
  listTasksSchema,
  updateTaskSchema,
} from './productivity-types';

const prisma = new Proxy({} as ReturnType<typeof getPrismaClient>, {
  get(_target, prop) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export interface ProductivityServiceOptions {
  now?: Date;
  _faultInject?: 'audit';
}

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
      const key = issue.path.map((s) => String(s)).join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new ProductivityValidationError(fallbackMessage, fieldErrors);
  }
  return parsed.data;
}

function buildProceedingLabel(
  proceeding:
    | {
        court?: { name: string } | null;
        numberText?: string | null;
        yearLabel?: string | null;
      }
    | null
    | undefined
): string | null {
  if (!proceeding) return null;
  const court = proceeding.court?.name ?? 'محكمة غير محددة';
  const docket = proceeding.numberText
    ? `${proceeding.numberText}${proceeding.yearLabel ? ` / ${proceeding.yearLabel}` : ''}`
    : 'الرقم غير مستكمل';
  return `${court} — ${docket}`;
}

interface TaskWithRelations {
  id: string;
  matterId: string | null;
  proceedingId: string | null;
  hearingId: string | null;
  deadlineId: string | null;
  title: string;
  details: string | null;
  dueDate: Date | null;
  dueTime: string | null;
  priority: TaskItemDTO['priority'];
  status: TaskStatus;
  completedAt: Date | null;
  completedById: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  matter?: {
    fileCode: string;
    title: string;
    paperLocation?: { name: string } | null;
    parties?: Array<{ party: { name: string } }>;
  } | null;
  proceeding?: {
    id: string;
    courtId: string;
    numberText: string | null;
    yearLabel: string | null;
    court?: { id: string; name: string } | null;
  } | null;
  hearing?: {
    id: string;
    hearingDate: Date;
    proceeding?: {
      courtId: string;
      court?: { id: string; name: string } | null;
    } | null;
  } | null;
  deadline?: {
    id: string;
    title: string;
    proceeding?: {
      courtId: string;
      court?: { id: string; name: string } | null;
    } | null;
  } | null;
}

function mapTaskToItemDTO(row: TaskWithRelations, cairoToday: string): TaskItemDTO {
  const dueDate = formatUtcDateToIsoDate(row.dueDate);
  const isActive = row.status === 'OPEN' || row.status === 'IN_PROGRESS';
  const isOverdue = isActive && isCairoDateOverdue(dueDate, cairoToday);
  const court =
    row.proceeding?.court ??
    row.hearing?.proceeding?.court ??
    row.deadline?.proceeding?.court ??
    null;

  return {
    id: row.id,
    matterId: row.matterId ?? null,
    matterFileCode: row.matter?.fileCode ?? null,
    matterTitle: row.matter?.title ?? null,
    proceedingId: row.proceedingId ?? null,
    proceedingLabel: buildProceedingLabel(row.proceeding),
    courtId: court?.id ?? row.proceeding?.courtId ?? null,
    courtName: court?.name ?? null,
    hearingId: row.hearingId ?? null,
    hearingDate: formatUtcDateToIsoDate(row.hearing?.hearingDate),
    deadlineId: row.deadlineId ?? null,
    deadlineTitle: row.deadline?.title ?? null,
    title: row.title,
    details: row.details ?? null,
    dueDate,
    dueTime: row.dueTime ?? null,
    timeLabel: formatTimeOrUnspecified(row.dueTime),
    priority: row.priority,
    status: row.status,
    isOverdue,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completedById: row.completedById ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const taskIncludeConfig = {
  matter: {
    select: {
      fileCode: true,
      title: true,
      paperLocation: { select: { name: true } },
      parties: {
        where: { role: 'CLIENT' as const },
        select: { party: { select: { name: true } } },
        orderBy: { isPrimaryContact: 'desc' as const },
      },
    },
  },
  proceeding: {
    select: {
      id: true,
      courtId: true,
      numberText: true,
      yearLabel: true,
      court: { select: { id: true, name: true } },
    },
  },
  hearing: {
    select: {
      id: true,
      hearingDate: true,
      proceeding: {
        select: {
          courtId: true,
          court: { select: { id: true, name: true } },
        },
      },
    },
  },
  deadline: {
    select: {
      id: true,
      title: true,
      proceeding: {
        select: {
          courtId: true,
          court: { select: { id: true, name: true } },
        },
      },
    },
  },
};

interface TaskAcknowledgment {
  id: string;
  version: number;
  status: TaskStatus;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  completedById: string | null;
  updatedAt: string;
}

function buildTaskAck(dto: TaskItemDTO): TaskAcknowledgment {
  return {
    id: dto.id,
    version: dto.version,
    status: dto.status,
    dueDate: dto.dueDate,
    dueTime: dto.dueTime,
    completedAt: dto.completedAt,
    completedById: dto.completedById,
    updatedAt: dto.updatedAt,
  };
}

async function replayTask(
  tx: Prisma.TransactionClient,
  ack: TaskAcknowledgment,
  cairoToday: string
): Promise<TaskItemDTO> {
  const row = await tx.task.findUniqueOrThrow({
    where: { id: ack.id },
    include: taskIncludeConfig,
  });
  const base = mapTaskToItemDTO(row, cairoToday);
  const isActive = ack.status === 'OPEN' || ack.status === 'IN_PROGRESS';
  return {
    ...base,
    version: ack.version,
    status: ack.status,
    dueDate: ack.dueDate,
    dueTime: ack.dueTime,
    timeLabel: formatTimeOrUnspecified(ack.dueTime),
    isOverdue: isActive && isCairoDateOverdue(ack.dueDate, cairoToday),
    completedAt: ack.completedAt,
    completedById: ack.completedById,
    updatedAt: ack.updatedAt,
  };
}

async function lockTaskParents(
  tx: Prisma.TransactionClient,
  matterId: string | null | undefined,
  proceedingId: string | null | undefined
): Promise<void> {
  if (!matterId) return;

  const [matter] = await tx.$queryRaw<Array<{ id: string; status: string; archivedAt: Date | null }>>`
    SELECT "id", "status", "archivedAt"
    FROM "matter"
    WHERE "id" = ${matterId}
    FOR UPDATE
  `;
  if (!matter) {
    throw new NotFoundError('ملف القضية المطلوب غير موجود.');
  }

  let proceeding: { id: string; matterId: string; archivedAt: Date | null } | undefined;
  if (proceedingId) {
    const rows = await tx.$queryRaw<Array<{ id: string; matterId: string; archivedAt: Date | null }>>`
      SELECT "id", "matterId", "archivedAt"
      FROM "proceeding"
      WHERE "id" = ${proceedingId}
      FOR UPDATE
    `;
    proceeding = rows[0];
    if (!proceeding) {
      throw new NotFoundError('القيد القضائي المطلوب غير موجود.');
    }
    if (proceeding.matterId !== matterId) {
      throw new CrossMatterLinkForbiddenError('لا يمكن ربط المهمة بقيد قضائي تابع لملف آخر.');
    }
  }

  if (matter.archivedAt !== null || matter.status === 'ARCHIVED') {
    throw new MatterArchivedError();
  }
  if (proceeding && proceeding.archivedAt !== null) {
    throw new ProceedingArchivedError();
  }
}

async function lockTaskForMutation(
  tx: Prisma.TransactionClient,
  taskId: string,
  expectedVersion: number
) {
  const ref = await tx.task.findUnique({
    where: { id: taskId },
    select: { id: true, matterId: true, proceedingId: true },
  });
  if (!ref) {
    throw new NotFoundError('المهمة المطلوبة غير موجودة.');
  }

  await lockTaskParents(tx, ref.matterId, ref.proceedingId);

  const [locked] = await tx.$queryRaw<
    Array<{
      id: string;
      matter_id: string | null;
      proceeding_id: string | null;
      deadline_id: string | null;
      status: TaskStatus;
      version: number;
      due_date: Date | null;
      due_time: string | null;
    }>
  >`
    SELECT "id", "matter_id", "proceeding_id", "deadline_id", "status", "version", "due_date", "due_time"
    FROM "task"
    WHERE "id" = ${taskId}
    FOR UPDATE
  `;
  if (!locked) {
    throw new NotFoundError('المهمة المطلوبة غير موجودة.');
  }
  if (locked.version !== expectedVersion) {
    throw new ConcurrencyConflictError('تم تعديل المهمة بواسطة مستخدم آخر. يرجى التحديث والمحاولة مجدداً.');
  }
  return locked;
}

async function taskCommand<T>(
  actor: Actor,
  commandType: string,
  key: string,
  payload: unknown,
  write: (
    tx: Prisma.TransactionClient
  ) => Promise<{ value: T; resultId: string; acknowledgment: TaskAcknowledgment }>,
  replay: (tx: Prisma.TransactionClient, ack: TaskAcknowledgment) => Promise<T>
): Promise<T> {
  const params = { actorId: actor.id, commandType, key, payload };
  const execute = () =>
    prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, params);
      if (claim.isReplay && claim.resultId) {
        return replay(tx, claim.resultPayload as TaskAcknowledgment);
      }
      const { value, resultId, acknowledgment } = await write(tx);
      await completeIdempotencyKey(tx, {
        ...params,
        resultType: 'TaskOperation',
        resultId,
        resultPayload: acknowledgment,
      });
      return value;
    });

  return runWithIdempotencyRetry(execute, async () => {
    const claim = await resolveConcurrentIdempotency(prisma, params);
    if (!claim?.resultId) return { resolved: false };
    const value = await prisma.$transaction((tx) =>
      replay(tx, claim.resultPayload as TaskAcknowledgment)
    );
    return { resolved: true, value };
  });
}

function shouldInjectAuditFault(opts: ProductivityServiceOptions | undefined): boolean {
  return process.env.NODE_ENV === 'test' && opts?._faultInject === 'audit';
}

export async function createTask(
  actor: Actor,
  rawInput: CreateTaskInput,
  opts?: ProductivityServiceOptions
): Promise<TaskItemDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(createTaskSchema, rawInput, 'بيانات المهمة غير صالحة.');
  const dueDateStr = input.dueDate ? input.dueDate.trim() : null;
  const dueDateUtc = parseCalendarDateToUtcDate(dueDateStr);
  const normTime = validateOptionalCalendarTime(dueDateStr, input.dueTime, 'dueTime');
  const details = input.details?.trim() || null;
  const priority = input.priority ?? 'NORMAL';
  const cairoToday = getCairoTodayDateString(opts?.now);

  const intent = {
    title: input.title,
    details,
    matterId: input.matterId ?? null,
    proceedingId: input.proceedingId ?? null,
    hearingId: input.hearingId ?? null,
    deadlineId: input.deadlineId ?? null,
    dueDate: dueDateStr,
    dueTime: normTime,
    priority,
  };

  return taskCommand(
    actor,
    'createTask',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const proceedingRef = input.proceedingId
        ? await tx.proceeding.findUnique({
            where: { id: input.proceedingId },
            select: { id: true, matterId: true },
          })
        : null;
      if (input.proceedingId && !proceedingRef) {
        throw new NotFoundError('القيد القضائي المطلوب غير موجود.');
      }

      const hearingRef = input.hearingId
        ? await tx.hearing.findUnique({
            where: { id: input.hearingId },
            select: { id: true, proceedingId: true, proceeding: { select: { matterId: true } } },
          })
        : null;
      if (input.hearingId && !hearingRef) {
        throw new NotFoundError('الجلسة المطلوبة غير موجودة.');
      }

      const deadlineRef = input.deadlineId
        ? await tx.deadline.findUnique({
            where: { id: input.deadlineId },
            select: { id: true, matterId: true, proceedingId: true },
          })
        : null;
      if (input.deadlineId && !deadlineRef) {
        throw new NotFoundError('الموعد القانوني المطلوب غير موجود.');
      }

      const matterIds = new Set<string>();
      if (input.matterId) matterIds.add(input.matterId);
      if (proceedingRef) matterIds.add(proceedingRef.matterId);
      if (hearingRef) matterIds.add(hearingRef.proceeding.matterId);
      if (deadlineRef) matterIds.add(deadlineRef.matterId);

      if (matterIds.size > 1) {
        throw new CrossMatterLinkForbiddenError('لا يمكن ربط المهمة بعناصر تابعة لأكثر من ملف قضية.');
      }

      const proceedingIds = new Set<string>();
      if (input.proceedingId) proceedingIds.add(input.proceedingId);
      if (hearingRef) proceedingIds.add(hearingRef.proceedingId);
      if (deadlineRef?.proceedingId) proceedingIds.add(deadlineRef.proceedingId);

      if (proceedingIds.size > 1) {
        throw new CrossMatterLinkForbiddenError('العناصر المرتبطة بالمهمة تتبع قيوداً قضائية مختلفة.');
      }

      const effectiveMatterId = matterIds.size === 1 ? Array.from(matterIds)[0] : null;
      const effectiveProceedingId =
        proceedingIds.size === 1 ? Array.from(proceedingIds)[0] : null;

      await lockTaskParents(tx, effectiveMatterId, effectiveProceedingId);

      const created = await tx.task.create({
        data: {
          matterId: effectiveMatterId,
          proceedingId: effectiveProceedingId,
          hearingId: input.hearingId ?? null,
          deadlineId: input.deadlineId ?? null,
          title: input.title,
          details,
          dueDate: dueDateUtc,
          dueTime: normTime,
          priority,
          status: 'OPEN',
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: taskIncludeConfig,
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'CREATE_TASK',
          entityType: 'Task',
          entityId: created.id,
          changedFields: {
            matterId: effectiveMatterId,
            proceedingId: effectiveProceedingId,
            hearingId: input.hearingId ?? null,
            deadlineId: input.deadlineId ?? null,
            dueDate: dueDateStr,
            dueTime: normTime,
            priority,
            status: 'OPEN',
          },
        },
        { simulateFailure: shouldInjectAuditFault(opts) }
      );

      const dto = mapTaskToItemDTO(created, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildTaskAck(dto) };
    },
    (tx, ack) => replayTask(tx, ack, cairoToday)
  );
}

export async function updateTask(
  actor: Actor,
  rawInput: UpdateTaskInput,
  opts?: ProductivityServiceOptions
): Promise<TaskItemDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(updateTaskSchema, rawInput, 'بيانات تحديث المهمة غير صالحة.');
  const cairoToday = getCairoTodayDateString(opts?.now);

  const intent = {
    taskId: input.taskId,
    expectedVersion: input.expectedVersion,
    title: input.title,
    details: input.details,
    dueDate: input.dueDate,
    dueTime: input.dueTime,
    priority: input.priority,
    status: input.status,
  };

  return taskCommand(
    actor,
    'updateTask',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockTaskForMutation(tx, input.taskId, input.expectedVersion);

      if (locked.status !== 'OPEN' && locked.status !== 'IN_PROGRESS') {
        throw new UnsupportedTransitionError(
          `لا يمكن تعديل مهمة في الحالة (${locked.status}).`
        );
      }

      const nextDueDateStr =
        input.dueDate !== undefined ? input.dueDate : formatUtcDateToIsoDate(locked.due_date);
      const nextDueDateUtc = parseCalendarDateToUtcDate(nextDueDateStr);
      const nextDueTimeRaw =
        input.dueTime !== undefined
          ? input.dueTime
          : input.dueDate === null
            ? null
            : locked.due_time;
      const normTime = validateOptionalCalendarTime(nextDueDateStr, nextDueTimeRaw, 'dueTime');

      const updateData: Prisma.TaskUncheckedUpdateManyInput = {
        version: locked.version + 1,
        updatedById: actor.id,
      };
      if (input.title !== undefined) updateData.title = input.title;
      if (input.details !== undefined) updateData.details = input.details?.trim() || null;
      if (input.dueDate !== undefined || input.dueTime !== undefined) {
        updateData.dueDate = nextDueDateUtc;
        updateData.dueTime = normTime;
      }
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.status !== undefined) updateData.status = input.status;

      const updated = await tx.task.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: locked.status },
        data: updateData,
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'UPDATE_TASK',
          entityType: 'Task',
          entityId: locked.id,
          changedFields: {
            previousStatus: locked.status,
            newStatus: input.status ?? locked.status,
            dueDate: nextDueDateStr,
            dueTime: normTime,
            version: locked.version + 1,
          },
        },
        { simulateFailure: shouldInjectAuditFault(opts) }
      );

      const reloaded = await tx.task.findUniqueOrThrow({
        where: { id: locked.id },
        include: taskIncludeConfig,
      });
      const dto = mapTaskToItemDTO(reloaded, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildTaskAck(dto) };
    },
    (tx, ack) => replayTask(tx, ack, cairoToday)
  );
}

export async function completeTask(
  actor: Actor,
  rawInput: CompleteTaskInput,
  opts?: ProductivityServiceOptions
): Promise<TaskItemDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(completeTaskSchema, rawInput, 'بيانات إتمام المهمة غير صالحة.');
  const now = opts?.now ?? new Date();
  const cairoToday = getCairoTodayDateString(now);

  const intent = {
    taskId: input.taskId,
    expectedVersion: input.expectedVersion,
  };

  return taskCommand(
    actor,
    'completeTask',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockTaskForMutation(tx, input.taskId, input.expectedVersion);

      if (locked.status !== 'OPEN' && locked.status !== 'IN_PROGRESS') {
        throw new UnsupportedTransitionError(
          `لا يمكن إتمام مهمة في الحالة (${locked.status}).`
        );
      }

      const nextVersion = locked.version + 1;
      const updated = await tx.task.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: locked.status },
        data: {
          status: 'DONE',
          completedAt: now,
          completedById: actor.id,
          version: nextVersion,
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      // Note: Completing a task MUST NOT alter any linked Deadline or Hearing state.
      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'COMPLETE_TASK',
          entityType: 'Task',
          entityId: locked.id,
          changedFields: {
            previousStatus: locked.status,
            newStatus: 'DONE',
            completedAt: now.toISOString(),
            deadlineId: locked.deadline_id,
            version: nextVersion,
          },
        },
        { simulateFailure: shouldInjectAuditFault(opts) }
      );

      const reloaded = await tx.task.findUniqueOrThrow({
        where: { id: locked.id },
        include: taskIncludeConfig,
      });
      const dto = mapTaskToItemDTO(reloaded, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildTaskAck(dto) };
    },
    (tx, ack) => replayTask(tx, ack, cairoToday)
  );
}

export async function cancelTask(
  actor: Actor,
  rawInput: CancelTaskInput,
  opts?: ProductivityServiceOptions
): Promise<TaskItemDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(cancelTaskSchema, rawInput, 'بيانات إلغاء المهمة غير صالحة.');
  const reason = input.reason?.trim() || null;
  const cairoToday = getCairoTodayDateString(opts?.now);

  const intent = {
    taskId: input.taskId,
    expectedVersion: input.expectedVersion,
    reason,
  };

  return taskCommand(
    actor,
    'cancelTask',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockTaskForMutation(tx, input.taskId, input.expectedVersion);

      if (locked.status !== 'OPEN' && locked.status !== 'IN_PROGRESS') {
        throw new UnsupportedTransitionError(
          `لا يمكن إلغاء مهمة في الحالة (${locked.status}).`
        );
      }

      const nextVersion = locked.version + 1;
      const updated = await tx.task.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: locked.status },
        data: {
          status: 'CANCELLED',
          version: nextVersion,
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'CANCEL_TASK',
          entityType: 'Task',
          entityId: locked.id,
          reason,
          changedFields: {
            previousStatus: locked.status,
            newStatus: 'CANCELLED',
            version: nextVersion,
          },
        },
        { simulateFailure: shouldInjectAuditFault(opts) }
      );

      const reloaded = await tx.task.findUniqueOrThrow({
        where: { id: locked.id },
        include: taskIncludeConfig,
      });
      const dto = mapTaskToItemDTO(reloaded, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildTaskAck(dto) };
    },
    (tx, ack) => replayTask(tx, ack, cairoToday)
  );
}

export async function getTask(
  actor: Actor,
  taskId: string,
  opts?: { now?: Date }
): Promise<TaskItemDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const row = await prisma.task.findUnique({
    where: { id: taskId },
    include: taskIncludeConfig,
  });
  if (!row) {
    throw new NotFoundError('المهمة المطلوبة غير موجودة.');
  }
  return mapTaskToItemDTO(row, getCairoTodayDateString(opts?.now));
}

export async function listTasks(
  actor: Actor,
  rawParams: ListTasksParams = {},
  opts?: { now?: Date }
): Promise<TaskItemDTO[]> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const params = parseOrThrow(listTasksSchema, rawParams, 'معاملات تصفية المهام غير صالحة.');
  const cairoToday = getCairoTodayDateString(opts?.now);
  const todayUtc = parseCalendarDateToUtcDate(cairoToday)!;

  const andClauses: Prisma.TaskWhereInput[] = [];
  if (params.matterId) {
    andClauses.push({ matterId: params.matterId });
  } else {
    andClauses.push({
      OR: [
        { matterId: null },
        { matter: { archivedAt: null, status: { not: 'ARCHIVED' } } },
      ],
    });
    andClauses.push({
      OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }],
    });
  }

  if (params.deadlineId) andClauses.push({ deadlineId: params.deadlineId });
  if (params.priority) andClauses.push({ priority: params.priority });

  if (params.overdueOnly) {
    andClauses.push({ status: { in: ['OPEN', 'IN_PROGRESS'] } });
    andClauses.push({ dueDate: { lt: todayUtc } });
  } else if (params.undatedOnly) {
    andClauses.push({ dueDate: null });
    if (params.status) {
      andClauses.push({ status: params.status });
    } else if (!params.includeCompleted) {
      andClauses.push({ status: { in: ['OPEN', 'IN_PROGRESS'] } });
    }
  } else if (params.status) {
    andClauses.push({ status: params.status });
  } else if (!params.includeCompleted) {
    andClauses.push({ status: { in: ['OPEN', 'IN_PROGRESS'] } });
  }

  const limit = params.limit ?? 100;
  const page = params.page ?? 1;

  const rows = await prisma.task.findMany({
    where: { AND: andClauses },
    include: taskIncludeConfig,
    orderBy: [{ dueDate: 'asc' }, { dueTime: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * limit,
    take: limit,
  });

  return rows.map((row) => mapTaskToItemDTO(row, cairoToday));
}

function getDateWindow(view: AgendaView, anchorDate: string): { rangeStart: string; rangeEnd: string } {
  if (view === 'today' || view === 'day') {
    return { rangeStart: anchorDate, rangeEnd: anchorDate };
  }
  if (view === 'week') {
    const { startDate, endDate } = getCairoWeekRange(anchorDate);
    return { rangeStart: startDate, rangeEnd: endDate };
  }
  if (view === 'month') {
    const { startDate, endDate } = getCairoMonthRange(anchorDate);
    return { rangeStart: startDate, rangeEnd: endDate };
  }
  return { rangeStart: anchorDate, rangeEnd: addCairoDays(anchorDate, 30) };
}

function buildCourtConflictWarnings(hearings: AgendaHearingItemDTO[]): CourtConflictWarningDTO[] {
  const byDate = new Map<string, AgendaHearingItemDTO[]>();
  for (const h of hearings) {
    if (h.status !== 'SCHEDULED') continue;
    const list = byDate.get(h.hearingDate) ?? [];
    list.push(h);
    byDate.set(h.hearingDate, list);
  }

  const warnings: CourtConflictWarningDTO[] = [];
  for (const [date, items] of byDate.entries()) {
    const courts = new Map<string, string>();
    for (const item of items) {
      courts.set(item.courtId, item.courtName);
    }
    if (courts.size >= 2) {
      const courtIds = Array.from(courts.keys());
      const courtNames = Array.from(courts.values());
      warnings.push({
        date,
        courtIds,
        courtNames,
        hearingIds: items.map((i) => i.id),
        message: `تنبيه تعارض جلسات في نفس اليوم (${date}) أمام أكثر من محكمة: ${courtNames.join('، ')}.`,
      });
    }
  }
  return warnings.sort((a, b) => a.date.localeCompare(b.date));
}

export async function listAgenda(
  actor: Actor,
  rawParams: ListAgendaParams = {},
  opts?: { now?: Date }
): Promise<AgendaDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const params = parseOrThrow(listAgendaSchema, rawParams, 'معاملات عرض الأجندة غير صالحة.');
  const cairoToday = getCairoTodayDateString(opts?.now);
  const anchorDate = params.anchorDate ?? cairoToday;
  const view: AgendaView = params.view ?? 'list';
  const { rangeStart, rangeEnd } = getDateWindow(view, anchorDate);

  const rangeStartUtc = parseCalendarDateToUtcDate(rangeStart)!;
  const rangeEndUtc = parseCalendarDateToUtcDate(rangeEnd)!;

  const includeTypes = new Set(params.types ?? ['HEARING', 'DEADLINE', 'TASK']);
  const includeHearings = includeTypes.has('HEARING');
  const includeDeadlines = includeTypes.has('DEADLINE');
  const includeTasks = includeTypes.has('TASK');
  const includeCompleted = Boolean(params.includeCompleted);
  const courtFilterId = params.courtId;

  const [availableCourts, rawHearings, rawDeadlines, rawTasks] = await Promise.all([
    prisma.court.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    includeHearings
      ? prisma.hearing.findMany({
          where: {
            status: includeCompleted ? { in: ['SCHEDULED', 'COMPLETED'] } : 'SCHEDULED',
            hearingDate:
              view === 'list'
                ? { gte: rangeStartUtc }
                : { gte: rangeStartUtc, lte: rangeEndUtc },
            proceeding: {
              archivedAt: null,
              ...(courtFilterId ? { courtId: courtFilterId } : {}),
              matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
            },
          },
          include: {
            proceeding: {
              select: {
                id: true,
                courtId: true,
                circuit: true,
                numberText: true,
                yearLabel: true,
                court: { select: { id: true, name: true } },
                matter: {
                  select: {
                    id: true,
                    fileCode: true,
                    title: true,
                    paperLocation: { select: { name: true } },
                    parties: {
                      where: { role: 'CLIENT' },
                      select: { party: { select: { name: true } } },
                      orderBy: { isPrimaryContact: 'desc' },
                    },
                  },
                },
              },
            },
          },
          orderBy: [{ hearingDate: 'asc' }, { hearingTime: 'asc' }, { id: 'asc' }],
          take: 200,
        })
      : Promise.resolve([]),
    includeDeadlines
      ? prisma.deadline.findMany({
          where: {
            status: includeCompleted
              ? { in: ['DRAFT', 'CONFIRMED', 'COMPLETED'] }
              : { in: ['DRAFT', 'CONFIRMED'] },
            matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
            AND: [
              { OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }] },
              ...(courtFilterId ? [{ proceeding: { courtId: courtFilterId } }] : []),
            ],
          },
          include: {
            matter: {
              select: {
                fileCode: true,
                title: true,
                paperLocation: { select: { name: true } },
                parties: {
                  where: { role: 'CLIENT' },
                  select: { party: { select: { name: true } } },
                  orderBy: { isPrimaryContact: 'desc' },
                },
              },
            },
            proceeding: {
              select: {
                id: true,
                courtId: true,
                numberText: true,
                yearLabel: true,
                court: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ dueDate: 'asc' }, { dueTime: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
          take: 250,
        })
      : Promise.resolve([]),
    includeTasks
      ? prisma.task.findMany({
          where: {
            status: includeCompleted ? { in: ['OPEN', 'IN_PROGRESS', 'DONE'] } : { in: ['OPEN', 'IN_PROGRESS'] },
            AND: [
              {
                OR: [
                  { matterId: null },
                  { matter: { archivedAt: null, status: { not: 'ARCHIVED' } } },
                ],
              },
              { OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }] },
              ...(courtFilterId
                ? [
                    {
                      OR: [
                        { proceeding: { courtId: courtFilterId } },
                        { hearing: { proceeding: { courtId: courtFilterId } } },
                        { deadline: { proceeding: { courtId: courtFilterId } } },
                      ],
                    },
                  ]
                : []),
            ],
          },
          include: taskIncludeConfig,
          orderBy: [{ dueDate: 'asc' }, { dueTime: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
          take: 250,
        })
      : Promise.resolve([]),
  ]);

  const hearings: AgendaHearingItemDTO[] = rawHearings.map((h) => {
    const hearingDate = formatUtcDateToIsoDate(h.hearingDate)!;
    return {
      itemType: 'HEARING',
      id: h.id,
      matterId: h.proceeding.matter.id,
      matterFileCode: h.proceeding.matter.fileCode,
      matterTitle: h.proceeding.matter.title,
      clientNames: h.proceeding.matter.parties.map((p) => p.party.name),
      paperLocationName: h.proceeding.matter.paperLocation?.name ?? null,
      proceedingId: h.proceeding.id,
      proceedingLabel: buildProceedingLabel(h.proceeding)!,
      courtId: h.proceeding.court.id,
      courtName: h.proceeding.court.name,
      circuit: h.proceeding.circuit ?? null,
      hearingDate,
      hearingTime: h.hearingTime ?? null,
      timeLabel: formatTimeOrUnspecified(h.hearingTime),
      courtHall: h.courtHall ?? null,
      purpose: h.purpose ?? null,
      rollNumber: h.rollNumber ?? null,
      status: h.status,
      isOverdue: h.status === 'SCHEDULED' && isCairoDateOverdue(hearingDate, cairoToday),
      version: h.version,
    };
  });

  const timedHearings = hearings.filter((h) => Boolean(h.hearingTime));
  const untimedHearings = hearings.filter((h) => !h.hearingTime);
  const sameDayCourtConflicts = buildCourtConflictWarnings(hearings);

  // Pending reminder counts for deadlines
  const pendingCountMap = new Map<string, number>();
  if (rawDeadlines.length > 0) {
    const counts = await prisma.jobRun.groupBy({
      by: ['sourceId'],
      where: {
        sourceType: 'Deadline',
        sourceId: { in: rawDeadlines.map((d) => d.id) },
        status: 'PENDING',
      },
      _count: { _all: true },
    });
    for (const c of counts) {
      pendingCountMap.set(c.sourceId, c._count._all);
    }
  }

  const confirmedDeadlines: AgendaDeadlineItemDTO[] = [];
  const draftDeadlines: AgendaDeadlineItemDTO[] = [];
  const overdueDeadlines: AgendaDeadlineItemDTO[] = [];

  for (const d of rawDeadlines) {
    const dueDate = formatUtcDateToIsoDate(d.dueDate);
    const completedDate = formatUtcDateToIsoDate(d.completedDate);
    const isOverdue = d.status === 'CONFIRMED' && isCairoDateOverdue(dueDate, cairoToday);
    const item: AgendaDeadlineItemDTO = {
      itemType: 'DEADLINE',
      id: d.id,
      matterId: d.matterId,
      matterFileCode: d.matter.fileCode,
      matterTitle: d.matter.title,
      clientNames: d.matter.parties.map((p) => p.party.name),
      paperLocationName: d.matter.paperLocation?.name ?? null,
      proceedingId: d.proceedingId ?? null,
      proceedingLabel: buildProceedingLabel(d.proceeding),
      courtId: d.proceeding?.court?.id ?? d.proceeding?.courtId ?? null,
      courtName: d.proceeding?.court?.name ?? null,
      title: d.title,
      dueDate,
      dueTime: d.dueTime ?? null,
      timeLabel: formatTimeOrUnspecified(d.dueTime),
      source: d.source ?? null,
      basisNotes: d.basisNotes ?? null,
      sourceDocumentId: d.sourceDocumentId ?? null,
      status: d.status,
      isOverdue,
      needsReview: d.status === 'DRAFT',
      confirmedAt: d.confirmedAt ? d.confirmedAt.toISOString() : null,
      confirmedById: d.confirmedById ?? null,
      confirmedByName: d.confirmedByName ?? null,
      reviewedByName: d.confirmedByName ?? null,
      dateChangeReason: d.dateChangeReason ?? null,
      completionDescription: d.completionDescription ?? null,
      completedDate,
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
      completedById: d.completedById ?? null,
      cancellationReason: d.cancellationReason ?? null,
      cancelledAt: d.cancelledAt ? d.cancelledAt.toISOString() : null,
      pendingReminderCount: pendingCountMap.get(d.id) ?? 0,
      version: d.version,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };

    if (d.status === 'DRAFT') {
      if (
        view === 'today' ||
        view === 'list' ||
        dueDate === null ||
        (dueDate >= rangeStart && dueDate <= rangeEnd)
      ) {
        draftDeadlines.push(item);
      }
      continue;
    }

    if (isOverdue) {
      overdueDeadlines.push(item);
    }

    if (dueDate) {
      const inWindow =
        view === 'list' ? dueDate >= rangeStart : dueDate >= rangeStart && dueDate <= rangeEnd;
      if (inWindow) {
        confirmedDeadlines.push(item);
      }
    }
  }

  const datedTasks: AgendaTaskItemDTO[] = [];
  const overdueTasks: AgendaTaskItemDTO[] = [];
  const undatedTasks: AgendaTaskItemDTO[] = [];

  for (const t of rawTasks) {
    const base = mapTaskToItemDTO(t, cairoToday);
    const item: AgendaTaskItemDTO = {
      ...base,
      itemType: 'TASK',
      clientNames: t.matter?.parties?.map((p) => p.party.name) ?? [],
      paperLocationName: t.matter?.paperLocation?.name ?? null,
    };

    if (item.dueDate === null) {
      if (item.status === 'OPEN' || item.status === 'IN_PROGRESS') {
        undatedTasks.push(item);
      }
      continue;
    }

    if (item.isOverdue) {
      overdueTasks.push(item);
    }

    const inWindow =
      view === 'list'
        ? item.dueDate >= rangeStart
        : item.dueDate >= rangeStart && item.dueDate <= rangeEnd;
    if (inWindow) {
      datedTasks.push(item);
    }
  }

  let effectiveRangeEnd = rangeEnd;
  if (view === 'list') {
    for (const h of hearings) {
      if (h.hearingDate > effectiveRangeEnd) effectiveRangeEnd = h.hearingDate;
    }
    for (const d of confirmedDeadlines) {
      if (d.dueDate && d.dueDate > effectiveRangeEnd) effectiveRangeEnd = d.dueDate;
    }
    for (const t of datedTasks) {
      if (t.dueDate && t.dueDate > effectiveRangeEnd) effectiveRangeEnd = t.dueDate;
    }
  }

  return {
    view,
    anchorDate,
    cairoToday,
    rangeStart,
    rangeEnd: effectiveRangeEnd,
    hearings,
    timedHearings,
    untimedHearings,
    confirmedDeadlines,
    draftDeadlines,
    overdueDeadlines,
    datedTasks,
    overdueTasks,
    undatedTasks,
    sameDayCourtConflicts,
    availableCourts,
  };
}

export async function getTodayOverview(
  actor: Actor,
  opts?: { now?: Date }
): Promise<TodayOverviewDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const now = opts?.now ?? new Date();
  const cairoToday = getCairoTodayDateString(now);
  const weekRange = getCairoWeekRange(cairoToday);
  const weekStartUtc = parseCalendarDateToUtcDate(weekRange.startDate)!;
  const weekEndUtc = parseCalendarDateToUtcDate(weekRange.endDate)!;

  const [agenda, hearingsCount, confirmedDeadlinesCount, tasksCount] = await Promise.all([
    listAgenda(actor, { view: 'today', anchorDate: cairoToday }, { now }),
    prisma.hearing.count({
      where: {
        status: 'SCHEDULED',
        hearingDate: { gte: weekStartUtc, lte: weekEndUtc },
        proceeding: {
          archivedAt: null,
          matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
        },
      },
    }),
    prisma.deadline.count({
      where: {
        status: 'CONFIRMED',
        dueDate: { gte: weekStartUtc, lte: weekEndUtc },
        matter: { archivedAt: null, status: { not: 'ARCHIVED' } },
        OR: [{ proceedingId: null }, { proceeding: { archivedAt: null } }],
      },
    }),
    prisma.task.count({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueDate: { gte: weekStartUtc, lte: weekEndUtc },
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
    }),
  ]);

  const draftDeadlinesCount = agenda.draftDeadlines.length;
  const overdueDeadlinesCount = agenda.overdueDeadlines.length;
  const overdueTasksCount = agenda.overdueTasks.length;
  const sameDayCourtConflictsCount = agenda.sameDayCourtConflicts.length;

  const notes: string[] = [];
  if (draftDeadlinesCount > 0) {
    notes.push(`يوجد ${draftDeadlinesCount} موعداً قانونياً في حالة مسودة تحتاج مراجعة واعتماداً يدوياً.`);
  }
  if (overdueDeadlinesCount > 0) {
    notes.push(`يوجد ${overdueDeadlinesCount} موعداً قانونياً مؤكداً متأخراً عن تاريخ اليوم.`);
  }
  if (overdueTasksCount > 0) {
    notes.push(`يوجد ${overdueTasksCount} مهمة متأخرة عن تاريخ استحقاقها.`);
  }
  if (sameDayCourtConflictsCount > 0) {
    notes.push(`تنبيه: يوجد تعارض جلسات في نفس اليوم أمام محاكم متعددة.`);
  }

  return {
    cairoToday,
    cairoTodayFormatted: formatCairoDateArabic(cairoToday),
    agenda,
    operatingAlerts: {
      draftDeadlinesCount,
      overdueDeadlinesCount,
      overdueTasksCount,
      sameDayCourtConflictsCount,
      notes,
      workerStatusNote:
        'تنبيه: خدمة إرسال التذكيرات التلقائية في الخلفية (T10) وفحص حالة النسخ الاحتياطي (T19) غير مفعّلين في هذا الإصدار بعد؛ اعتمد على مراجعة هذه القائمة وطباعة الأجندة.',
    },
    weeklySummary: {
      startDate: weekRange.startDate,
      endDate: weekRange.endDate,
      hearingsCount,
      confirmedDeadlinesCount,
      tasksCount,
    },
  };
}

export async function listSelectableMatters(actor: Actor): Promise<SelectableMatterOptionDTO[]> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const matters = await prisma.matter.findMany({
    where: {
      archivedAt: null,
      status: { not: 'ARCHIVED' },
    },
    select: {
      id: true,
      fileCode: true,
      title: true,
      status: true,
      proceedings: {
        where: { archivedAt: null },
        select: {
          id: true,
          courtId: true,
          numberText: true,
          yearLabel: true,
          court: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { fileCode: 'asc' }],
    take: 200,
  });

  return matters.map((m) => ({
    id: m.id,
    fileCode: m.fileCode,
    title: m.title,
    status: m.status,
    proceedings: m.proceedings.map((p) => ({
      id: p.id,
      label: buildProceedingLabel(p)!,
      courtId: p.courtId,
      courtName: p.court.name,
    })),
  }));
}
