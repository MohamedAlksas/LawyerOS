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
  formatUtcDateToIsoDate,
  formatTimeOrUnspecified,
  getCairoTodayDateString,
  isCairoDateOverdue,
  parseCalendarDateToUtcDate,
  validateOptionalCalendarTime,
} from '@/lib/cairo-date';
import {
  DeadlineDTO,
  DeadlineStatus,
  CreateDeadlineInput,
  UpdateDeadlineDraftInput,
  ConfirmDeadlineInput,
  ChangeDeadlineDateInput,
  CompleteDeadlineInput,
  CancelDeadlineInput,
  ListDeadlinesParams,
  createDeadlineSchema,
  updateDeadlineDraftSchema,
  confirmDeadlineSchema,
  changeDeadlineDateSchema,
  completeDeadlineSchema,
  cancelDeadlineSchema,
  listDeadlinesSchema,
  CrossMatterLinkForbiddenError,
  SchedulingValidationError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  UnauthorizedError,
} from './deadline-types';

const prisma = new Proxy({} as ReturnType<typeof getPrismaClient>, {
  get(_target, prop) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export interface DeadlineServiceOptions {
  now?: Date;
  _faultInject?: 'audit' | 'outbox';
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
      const key = issue.path.map((segment) => String(segment)).join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new SchedulingValidationError(fallbackMessage, fieldErrors);
  }
  return parsed.data;
}

function rejectDeferredDocumentLink(
  docId: string | null | undefined,
  field: 'sourceDocumentId' | 'evidenceDocumentId'
): void {
  if (docId !== undefined && docId !== null && docId.trim() !== '') {
    throw new SchedulingValidationError(
      'ربط المستندات بالمواعيد القانونية غير متاح قبل تنفيذ وحدة المستندات (T12).',
      { [field]: 'ربط المستندات مؤجل حتى تنفيذ T12' }
    );
  }
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

interface DeadlineWithRelations {
  id: string;
  matterId: string;
  proceedingId: string | null;
  title: string;
  dueDate: Date | null;
  dueTime: string | null;
  source: string | null;
  basisNotes: string | null;
  sourceDocumentId: string | null;
  status: DeadlineStatus;
  confirmedAt: Date | null;
  confirmedById: string | null;
  confirmedByName: string | null;
  dateChangeReason: string | null;
  completionDescription: string | null;
  completedDate: Date | null;
  completedAt: Date | null;
  completedById: string | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  matter: {
    fileCode: string;
    title: string;
  };
  proceeding?: {
    id: string;
    courtId: string;
    numberText: string | null;
    yearLabel: string | null;
    court?: { id: string; name: string } | null;
  } | null;
}

function mapDeadlineToDTO(
  row: DeadlineWithRelations,
  pendingReminderCount: number,
  cairoToday: string
): DeadlineDTO {
  const dueDate = formatUtcDateToIsoDate(row.dueDate);
  const completedDate = formatUtcDateToIsoDate(row.completedDate);
  const isOverdue = row.status === 'CONFIRMED' && isCairoDateOverdue(dueDate, cairoToday);

  return {
    id: row.id,
    matterId: row.matterId,
    matterFileCode: row.matter.fileCode,
    matterTitle: row.matter.title,
    proceedingId: row.proceedingId ?? null,
    proceedingLabel: buildProceedingLabel(row.proceeding),
    courtId: row.proceeding?.court?.id ?? row.proceeding?.courtId ?? null,
    courtName: row.proceeding?.court?.name ?? null,
    title: row.title,
    dueDate,
    dueTime: row.dueTime ?? null,
    timeLabel: formatTimeOrUnspecified(row.dueTime),
    source: row.source ?? null,
    basisNotes: row.basisNotes ?? null,
    sourceDocumentId: row.sourceDocumentId ?? null,
    status: row.status,
    isOverdue,
    needsReview: row.status === 'DRAFT',
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    confirmedById: row.confirmedById ?? null,
    confirmedByName: row.confirmedByName ?? null,
    reviewedByName: row.confirmedByName ?? null,
    dateChangeReason: row.dateChangeReason ?? null,
    completionDescription: row.completionDescription ?? null,
    completedDate,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completedById: row.completedById ?? null,
    cancellationReason: row.cancellationReason ?? null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    pendingReminderCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface DeadlineAcknowledgment {
  id: string;
  version: number;
  status: DeadlineStatus;
  dueDate: string | null;
  dueTime: string | null;
  confirmedAt: string | null;
  confirmedById: string | null;
  completedDate: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

function buildDeadlineAck(dto: DeadlineDTO): DeadlineAcknowledgment {
  return {
    id: dto.id,
    version: dto.version,
    status: dto.status,
    dueDate: dto.dueDate,
    dueTime: dto.dueTime,
    confirmedAt: dto.confirmedAt,
    confirmedById: dto.confirmedById,
    completedDate: dto.completedDate,
    completedAt: dto.completedAt,
    cancelledAt: dto.cancelledAt,
    updatedAt: dto.updatedAt,
  };
}

async function replayDeadline(
  tx: Prisma.TransactionClient,
  ack: DeadlineAcknowledgment,
  cairoToday: string
): Promise<DeadlineDTO> {
  const row = await tx.deadline.findUniqueOrThrow({
    where: { id: ack.id },
    include: {
      matter: { select: { fileCode: true, title: true } },
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
  });
  const pendingReminderCount = await tx.jobRun.count({
    where: { sourceType: 'Deadline', sourceId: row.id, status: 'PENDING' },
  });
  const baseDto = mapDeadlineToDTO(row, pendingReminderCount, cairoToday);
  const isOverdue = ack.status === 'CONFIRMED' && isCairoDateOverdue(ack.dueDate, cairoToday);
  return {
    ...baseDto,
    version: ack.version,
    status: ack.status,
    dueDate: ack.dueDate,
    dueTime: ack.dueTime,
    timeLabel: formatTimeOrUnspecified(ack.dueTime),
    isOverdue,
    needsReview: ack.status === 'DRAFT',
    confirmedAt: ack.confirmedAt,
    confirmedById: ack.confirmedById,
    confirmedByName: ack.status === 'DRAFT' ? null : baseDto.confirmedByName,
    reviewedByName: ack.status === 'DRAFT' ? null : baseDto.reviewedByName,
    completedDate: ack.completedDate,
    completedAt: ack.completedAt,
    cancelledAt: ack.cancelledAt,
    updatedAt: ack.updatedAt,
  };
}

/**
 * Acquires parent locks in canonical Matter -> Proceeding order before evaluating archive state.
 * Matches archiveMatter, archiveProceeding, and hearing-service lock ordering.
 */
async function lockDeadlineParents(
  tx: Prisma.TransactionClient,
  matterId: string,
  proceedingIds: Array<string | null | undefined>
): Promise<void> {
  const [matter] = await tx.$queryRaw<Array<{ id: string; status: string; archivedAt: Date | null }>>`
    SELECT "id", "status", "archivedAt"
    FROM "matter"
    WHERE "id" = ${matterId}
    FOR UPDATE
  `;
  if (!matter) {
    throw new NotFoundError('ملف القضية المطلوب غير موجود.');
  }

  const uniqueProceedingIds = Array.from(
    new Set(proceedingIds.filter((id): id is string => Boolean(id)))
  ).sort((a, b) => a.localeCompare(b));

  const lockedProceedings: Array<{ id: string; matterId: string; archivedAt: Date | null }> = [];
  for (const proceedingId of uniqueProceedingIds) {
    const rows = await tx.$queryRaw<Array<{ id: string; matterId: string; archivedAt: Date | null }>>`
      SELECT "id", "matterId", "archivedAt"
      FROM "proceeding"
      WHERE "id" = ${proceedingId}
      FOR UPDATE
    `;
    const proceeding = rows[0];
    if (!proceeding) {
      throw new NotFoundError('القيد القضائي المطلوب غير موجود.');
    }
    if (proceeding.matterId !== matterId) {
      throw new CrossMatterLinkForbiddenError('لا يمكن ربط الموعد القانوني بقيد قضائي تابع لملف آخر.');
    }
    lockedProceedings.push(proceeding);
  }

  if (matter.archivedAt !== null || matter.status === 'ARCHIVED') {
    throw new MatterArchivedError();
  }
  for (const proceeding of lockedProceedings) {
    if (proceeding.archivedAt !== null) {
      throw new ProceedingArchivedError();
    }
  }
}

async function lockDeadlineForMutation(
  tx: Prisma.TransactionClient,
  deadlineId: string,
  expectedVersion: number,
  extraProceedingId?: string | null
) {
  const ref = await tx.deadline.findUnique({
    where: { id: deadlineId },
    select: { id: true, matterId: true, proceedingId: true },
  });
  if (!ref) {
    throw new NotFoundError('الموعد القانوني المطلوب غير موجود.');
  }

  await lockDeadlineParents(tx, ref.matterId, [ref.proceedingId, extraProceedingId]);

  const [locked] = await tx.$queryRaw<
    Array<{
      id: string;
      matter_id: string;
      proceeding_id: string | null;
      status: DeadlineStatus;
      version: number;
      due_date: Date | null;
      due_time: string | null;
    }>
  >`
    SELECT "id", "matter_id", "proceeding_id", "status", "version", "due_date", "due_time"
    FROM "deadline"
    WHERE "id" = ${deadlineId}
    FOR UPDATE
  `;

  if (!locked) {
    throw new NotFoundError('الموعد القانوني المطلوب غير موجود.');
  }

  if (locked.version !== expectedVersion) {
    throw new ConcurrencyConflictError('تم تعديل الموعد القانوني بواسطة مستخدم آخر. يرجى التحديث والمحاولة مجدداً.');
  }

  return locked;
}

async function deadlineCommand<T>(
  actor: Actor,
  commandType: string,
  key: string,
  payload: unknown,
  write: (
    tx: Prisma.TransactionClient
  ) => Promise<{ value: T; resultId: string; acknowledgment: DeadlineAcknowledgment }>,
  replay: (tx: Prisma.TransactionClient, ack: DeadlineAcknowledgment) => Promise<T>
): Promise<T> {
  const params = { actorId: actor.id, commandType, key, payload };
  const execute = () =>
    prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, params);
      if (claim.isReplay && claim.resultId) {
        return replay(tx, claim.resultPayload as DeadlineAcknowledgment);
      }
      const { value, resultId, acknowledgment } = await write(tx);
      await completeIdempotencyKey(tx, {
        ...params,
        resultType: 'DeadlineOperation',
        resultId,
        resultPayload: acknowledgment,
      });
      return value;
    });

  return runWithIdempotencyRetry(execute, async () => {
    const claim = await resolveConcurrentIdempotency(prisma, params);
    if (!claim?.resultId) return { resolved: false };
    const value = await prisma.$transaction((tx) =>
      replay(tx, claim.resultPayload as DeadlineAcknowledgment)
    );
    return { resolved: true, value };
  });
}

async function loadDeadlineDTO(
  tx: Prisma.TransactionClient,
  id: string,
  cairoToday: string
): Promise<DeadlineDTO> {
  const row = await tx.deadline.findUniqueOrThrow({
    where: { id },
    include: {
      matter: { select: { fileCode: true, title: true } },
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
  });
  const pendingReminderCount = await tx.jobRun.count({
    where: { sourceType: 'Deadline', sourceId: id, status: 'PENDING' },
  });
  return mapDeadlineToDTO(row, pendingReminderCount, cairoToday);
}

function shouldInjectFault(opts: DeadlineServiceOptions | undefined, target: 'audit' | 'outbox'): boolean {
  return process.env.NODE_ENV === 'test' && opts?._faultInject === target;
}

export async function createDeadline(
  actor: Actor,
  rawInput: CreateDeadlineInput,
  opts?: DeadlineServiceOptions
): Promise<DeadlineDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(createDeadlineSchema, rawInput, 'بيانات الموعد القانوني غير صالحة.');
  rejectDeferredDocumentLink(input.sourceDocumentId, 'sourceDocumentId');

  const dueDateStr = input.dueDate ? input.dueDate.trim() : null;
  const dueDateUtc = parseCalendarDateToUtcDate(dueDateStr);
  const normTime = validateOptionalCalendarTime(dueDateStr, input.dueTime, 'dueTime');
  const source = input.source?.trim() || null;
  const basisNotes = input.basisNotes?.trim() || null;
  const proceedingId = input.proceedingId ?? null;
  const cairoToday = getCairoTodayDateString(opts?.now);

  const intent = {
    matterId: input.matterId,
    proceedingId,
    title: input.title,
    dueDate: dueDateStr,
    dueTime: normTime,
    source,
    basisNotes,
  };

  return deadlineCommand(
    actor,
    'createDeadline',
    input.idempotencyKey,
    intent,
    async (tx) => {
      await lockDeadlineParents(tx, input.matterId, [proceedingId]);

      const created = await tx.deadline.create({
        data: {
          matterId: input.matterId,
          proceedingId,
          title: input.title,
          dueDate: dueDateUtc,
          dueTime: normTime,
          source,
          basisNotes,
          status: 'DRAFT',
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'CREATE_DEADLINE',
          entityType: 'Deadline',
          entityId: created.id,
          changedFields: {
            matterId: input.matterId,
            proceedingId,
            status: 'DRAFT',
            dueDate: dueDateStr,
            dueTime: normTime,
          },
        },
        { simulateFailure: shouldInjectFault(opts, 'audit') }
      );

      const dto = await loadDeadlineDTO(tx, created.id, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildDeadlineAck(dto) };
    },
    (tx, ack) => replayDeadline(tx, ack, cairoToday)
  );
}

export async function updateDeadlineDraft(
  actor: Actor,
  rawInput: UpdateDeadlineDraftInput,
  opts?: DeadlineServiceOptions
): Promise<DeadlineDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(updateDeadlineDraftSchema, rawInput, 'بيانات تحديث مسودة الموعد غير صالحة.');
  rejectDeferredDocumentLink(input.sourceDocumentId, 'sourceDocumentId');

  const cairoToday = getCairoTodayDateString(opts?.now);
  const intent = {
    deadlineId: input.deadlineId,
    expectedVersion: input.expectedVersion,
    proceedingId: input.proceedingId,
    title: input.title,
    dueDate: input.dueDate,
    dueTime: input.dueTime,
    source: input.source,
    basisNotes: input.basisNotes,
  };

  return deadlineCommand(
    actor,
    'updateDeadlineDraft',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockDeadlineForMutation(
        tx,
        input.deadlineId,
        input.expectedVersion,
        input.proceedingId === undefined ? undefined : input.proceedingId
      );

      if (locked.status !== 'DRAFT') {
        throw new UnsupportedTransitionError(
          'يمكن تعديل بيانات المسودة فقط قبل اعتمادها. لتغيير تاريخ موعد مؤكد استخدم إجراء تعديل الموعد.'
        );
      }

      const nextDueDateStr =
        input.dueDate !== undefined ? input.dueDate : formatUtcDateToIsoDate(locked.due_date);
      const nextDueDateUtc = parseCalendarDateToUtcDate(nextDueDateStr);
      const nextDueTimeRaw =
        input.dueTime !== undefined ? input.dueTime : input.dueDate === null ? null : locked.due_time;
      const normTime = validateOptionalCalendarTime(nextDueDateStr, nextDueTimeRaw, 'dueTime');

      const updateData: Prisma.DeadlineUncheckedUpdateManyInput = {
        version: locked.version + 1,
        updatedById: actor.id,
      };
      if (input.title !== undefined) updateData.title = input.title;
      if (input.proceedingId !== undefined) updateData.proceedingId = input.proceedingId;
      if (input.dueDate !== undefined || input.dueTime !== undefined) {
        updateData.dueDate = nextDueDateUtc;
        updateData.dueTime = normTime;
      }
      if (input.source !== undefined) updateData.source = input.source?.trim() || null;
      if (input.basisNotes !== undefined) updateData.basisNotes = input.basisNotes?.trim() || null;

      const updated = await tx.deadline.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: 'DRAFT' },
        data: updateData,
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'UPDATE_DEADLINE_DRAFT',
          entityType: 'Deadline',
          entityId: locked.id,
          changedFields: {
            version: locked.version + 1,
            dueDate: nextDueDateStr,
            dueTime: normTime,
          },
        },
        { simulateFailure: shouldInjectFault(opts, 'audit') }
      );

      const dto = await loadDeadlineDTO(tx, locked.id, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildDeadlineAck(dto) };
    },
    (tx, ack) => replayDeadline(tx, ack, cairoToday)
  );
}

export async function confirmDeadline(
  actor: Actor,
  rawInput: ConfirmDeadlineInput,
  opts?: DeadlineServiceOptions
): Promise<DeadlineDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(confirmDeadlineSchema, rawInput, 'بيانات اعتماد الموعد القانوني غير مكتملة.');
  rejectDeferredDocumentLink(input.sourceDocumentId, 'sourceDocumentId');

  const dueDateUtc = parseCalendarDateToUtcDate(input.dueDate);
  if (!dueDateUtc) {
    throw new SchedulingValidationError('تاريخ الموعد القانوني مطلوب للاعتماد.');
  }
  const normTime = validateOptionalCalendarTime(input.dueDate, input.dueTime, 'dueTime');
  const now = opts?.now ?? new Date();
  const cairoToday = getCairoTodayDateString(now);

  const intent = {
    deadlineId: input.deadlineId,
    expectedVersion: input.expectedVersion,
    dueDate: input.dueDate,
    dueTime: normTime,
    source: input.source,
    basisNotes: input.basisNotes,
    confirmed: true,
  };

  return deadlineCommand(
    actor,
    'confirmDeadline',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockDeadlineForMutation(tx, input.deadlineId, input.expectedVersion);

      if (locked.status !== 'DRAFT') {
        throw new UnsupportedTransitionError(
          `لا يمكن اعتماد موعد إلا من حالة المسودة (الحالة الحالية: ${locked.status}).`
        );
      }

      const nextVersion = locked.version + 1;
      const updated = await tx.deadline.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: 'DRAFT' },
        data: {
          dueDate: dueDateUtc,
          dueTime: normTime,
          source: input.source,
          basisNotes: input.basisNotes,
          status: 'CONFIRMED',
          confirmedAt: now,
          confirmedById: actor.id,
          confirmedByName: actor.name,
          dateChangeReason: null,
          version: nextVersion,
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      await tx.jobRun.updateMany({
        where: { sourceType: 'Deadline', sourceId: locked.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      if (shouldInjectFault(opts, 'outbox')) {
        throw new Error('SIMULATED_OUTBOX_TRANSACTION_FAILURE');
      }

      await tx.jobRun.create({
        data: {
          jobType: 'REMINDER_DELIVERY',
          sourceType: 'Deadline',
          sourceId: locked.id,
          scheduledAt: dueDateUtc,
          status: 'PENDING',
          deduplicationKey: `deadline_reminder_${locked.id}_v${nextVersion}`,
          payload: {
            deadlineId: locked.id,
            matterId: locked.matter_id,
            proceedingId: locked.proceeding_id,
            dueDate: input.dueDate,
            dueTime: normTime,
            version: nextVersion,
          },
        },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'CONFIRM_DEADLINE',
          entityType: 'Deadline',
          entityId: locked.id,
          changedFields: {
            previousStatus: 'DRAFT',
            newStatus: 'CONFIRMED',
            dueDate: input.dueDate,
            dueTime: normTime,
            source: input.source,
            confirmedAt: now.toISOString(),
            confirmedById: actor.id,
            version: nextVersion,
          },
        },
        { simulateFailure: shouldInjectFault(opts, 'audit') }
      );

      const dto = await loadDeadlineDTO(tx, locked.id, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildDeadlineAck(dto) };
    },
    (tx, ack) => replayDeadline(tx, ack, cairoToday)
  );
}

export async function changeDeadlineDate(
  actor: Actor,
  rawInput: ChangeDeadlineDateInput,
  opts?: DeadlineServiceOptions
): Promise<DeadlineDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(changeDeadlineDateSchema, rawInput, 'بيانات تعديل تاريخ الموعد غير صالحة.');
  const dueDateStr = input.dueDate ?? null;
  const dueDateUtc = parseCalendarDateToUtcDate(dueDateStr);
  const normTime = validateOptionalCalendarTime(dueDateStr, input.dueTime, 'dueTime');
  const reason = input.reason?.trim() || null;
  const cairoToday = getCairoTodayDateString(opts?.now);

  const intent = {
    deadlineId: input.deadlineId,
    expectedVersion: input.expectedVersion,
    dueDate: dueDateStr,
    dueTime: normTime,
    reason,
  };

  return deadlineCommand(
    actor,
    'changeDeadlineDate',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockDeadlineForMutation(tx, input.deadlineId, input.expectedVersion);

      if (locked.status !== 'DRAFT' && locked.status !== 'CONFIRMED') {
        throw new UnsupportedTransitionError(
          `لا يمكن تغيير تاريخ موعد قانوني في الحالة (${locked.status}).`
        );
      }

      if (locked.status === 'CONFIRMED' && !reason) {
        throw new SchedulingValidationError(
          'يجب توثيق سبب تغيير تاريخ الموعد القانوني المؤكد لإعادته إلى حالة المسودة والمراجعة.',
          { reason: 'سبب تغيير الموعد المؤكد مطلوب' }
        );
      }

      const nextVersion = locked.version + 1;
      const updated = await tx.deadline.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: locked.status },
        data: {
          dueDate: dueDateUtc,
          dueTime: normTime,
          status: 'DRAFT',
          confirmedAt: null,
          confirmedById: null,
          confirmedByName: null,
          dateChangeReason: reason,
          version: nextVersion,
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      if (shouldInjectFault(opts, 'outbox')) {
        throw new Error('SIMULATED_OUTBOX_TRANSACTION_FAILURE');
      }

      await tx.jobRun.updateMany({
        where: { sourceType: 'Deadline', sourceId: locked.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'CHANGE_DEADLINE_DATE',
          entityType: 'Deadline',
          entityId: locked.id,
          reason,
          changedFields: {
            previousStatus: locked.status,
            newStatus: 'DRAFT',
            previousDueDate: formatUtcDateToIsoDate(locked.due_date),
            newDueDate: dueDateStr,
            previousDueTime: locked.due_time,
            newDueTime: normTime,
            confirmationCleared: locked.status === 'CONFIRMED',
            version: nextVersion,
          },
        },
        { simulateFailure: shouldInjectFault(opts, 'audit') }
      );

      const dto = await loadDeadlineDTO(tx, locked.id, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildDeadlineAck(dto) };
    },
    (tx, ack) => replayDeadline(tx, ack, cairoToday)
  );
}

export async function completeDeadline(
  actor: Actor,
  rawInput: CompleteDeadlineInput,
  opts?: DeadlineServiceOptions
): Promise<DeadlineDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(completeDeadlineSchema, rawInput, 'بيانات إتمام الموعد القانوني غير مكتملة.');
  rejectDeferredDocumentLink(input.evidenceDocumentId, 'evidenceDocumentId');

  const completedDateUtc = parseCalendarDateToUtcDate(input.completionDate);
  if (!completedDateUtc) {
    throw new SchedulingValidationError('تاريخ تنفيذ الإجراء القانوني مطلوب.');
  }
  const now = opts?.now ?? new Date();
  const cairoToday = getCairoTodayDateString(now);

  const intent = {
    deadlineId: input.deadlineId,
    expectedVersion: input.expectedVersion,
    completionDescription: input.completionDescription,
    completionDate: input.completionDate,
  };

  return deadlineCommand(
    actor,
    'completeDeadline',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockDeadlineForMutation(tx, input.deadlineId, input.expectedVersion);

      if (locked.status !== 'CONFIRMED') {
        throw new UnsupportedTransitionError(
          locked.status === 'DRAFT'
            ? 'لا يمكن تسجيل إتمام موعد قانوني قبل مراجعته واعتماده أولاً.'
            : `لا يمكن إتمام موعد قانوني في الحالة (${locked.status}).`
        );
      }

      const nextVersion = locked.version + 1;
      const updated = await tx.deadline.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: 'CONFIRMED' },
        data: {
          status: 'COMPLETED',
          completionDescription: input.completionDescription,
          completedDate: completedDateUtc,
          completedAt: now,
          completedById: actor.id,
          version: nextVersion,
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      if (shouldInjectFault(opts, 'outbox')) {
        throw new Error('SIMULATED_OUTBOX_TRANSACTION_FAILURE');
      }

      await tx.jobRun.updateMany({
        where: { sourceType: 'Deadline', sourceId: locked.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'COMPLETE_DEADLINE',
          entityType: 'Deadline',
          entityId: locked.id,
          changedFields: {
            previousStatus: 'CONFIRMED',
            newStatus: 'COMPLETED',
            completedDate: input.completionDate,
            completedAt: now.toISOString(),
            completedById: actor.id,
            version: nextVersion,
          },
        },
        { simulateFailure: shouldInjectFault(opts, 'audit') }
      );

      const dto = await loadDeadlineDTO(tx, locked.id, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildDeadlineAck(dto) };
    },
    (tx, ack) => replayDeadline(tx, ack, cairoToday)
  );
}

export async function cancelDeadline(
  actor: Actor,
  rawInput: CancelDeadlineInput,
  opts?: DeadlineServiceOptions
): Promise<DeadlineDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const input = parseOrThrow(cancelDeadlineSchema, rawInput, 'بيانات إلغاء الموعد القانوني غير صالحة.');
  const now = opts?.now ?? new Date();
  const cairoToday = getCairoTodayDateString(now);

  const intent = {
    deadlineId: input.deadlineId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
  };

  return deadlineCommand(
    actor,
    'cancelDeadline',
    input.idempotencyKey,
    intent,
    async (tx) => {
      const locked = await lockDeadlineForMutation(tx, input.deadlineId, input.expectedVersion);

      if (locked.status !== 'DRAFT' && locked.status !== 'CONFIRMED') {
        throw new UnsupportedTransitionError(
          `لا يمكن إلغاء موعد قانوني في الحالة (${locked.status}).`
        );
      }

      const nextVersion = locked.version + 1;
      const updated = await tx.deadline.updateMany({
        where: { id: locked.id, version: input.expectedVersion, status: locked.status },
        data: {
          status: 'CANCELLED',
          cancellationReason: input.reason,
          cancelledAt: now,
          version: nextVersion,
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflictError();
      }

      if (shouldInjectFault(opts, 'outbox')) {
        throw new Error('SIMULATED_OUTBOX_TRANSACTION_FAILURE');
      }

      await tx.jobRun.updateMany({
        where: { sourceType: 'Deadline', sourceId: locked.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'CANCEL_DEADLINE',
          entityType: 'Deadline',
          entityId: locked.id,
          reason: input.reason,
          changedFields: {
            previousStatus: locked.status,
            newStatus: 'CANCELLED',
            cancelledAt: now.toISOString(),
            version: nextVersion,
          },
        },
        { simulateFailure: shouldInjectFault(opts, 'audit') }
      );

      const dto = await loadDeadlineDTO(tx, locked.id, cairoToday);
      return { value: dto, resultId: dto.id, acknowledgment: buildDeadlineAck(dto) };
    },
    (tx, ack) => replayDeadline(tx, ack, cairoToday)
  );
}

export async function getDeadline(
  actor: Actor,
  deadlineId: string,
  opts?: { now?: Date }
): Promise<DeadlineDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const row = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    include: {
      matter: { select: { fileCode: true, title: true } },
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
  });
  if (!row) {
    throw new NotFoundError('الموعد القانوني المطلوب غير موجود.');
  }

  const pendingReminderCount = await prisma.jobRun.count({
    where: { sourceType: 'Deadline', sourceId: row.id, status: 'PENDING' },
  });
  return mapDeadlineToDTO(row, pendingReminderCount, getCairoTodayDateString(opts?.now));
}

export async function listDeadlines(
  actor: Actor,
  rawParams: ListDeadlinesParams = {},
  opts?: { now?: Date }
): Promise<DeadlineDTO[]> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const params = parseOrThrow(listDeadlinesSchema, rawParams, 'معاملات تصفية المواعيد غير صالحة.');
  const cairoToday = getCairoTodayDateString(opts?.now);
  const todayUtc = parseCalendarDateToUtcDate(cairoToday)!;

  const where: Prisma.DeadlineWhereInput = {};
  if (params.matterId) where.matterId = params.matterId;
  if (params.proceedingId) where.proceedingId = params.proceedingId;

  if (!params.matterId) {
    where.matter = { archivedAt: null, status: { not: 'ARCHIVED' } };
    if (!params.proceedingId) {
      where.OR = [{ proceedingId: null }, { proceeding: { archivedAt: null } }];
    }
  }

  if (params.needsReviewOnly) {
    where.status = 'DRAFT';
  } else if (params.overdueOnly) {
    where.status = 'CONFIRMED';
    where.dueDate = { lt: todayUtc };
  } else if (params.status) {
    where.status = params.status;
  } else if (!params.includeClosed) {
    where.status = { in: ['DRAFT', 'CONFIRMED'] };
  }

  const limit = params.limit ?? 100;
  const page = params.page ?? 1;

  const rows = await prisma.deadline.findMany({
    where,
    include: {
      matter: { select: { fileCode: true, title: true } },
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
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * limit,
    take: limit,
  });

  if (rows.length === 0) return [];

  const pendingCounts = await prisma.jobRun.groupBy({
    by: ['sourceId'],
    where: {
      sourceType: 'Deadline',
      sourceId: { in: rows.map((r) => r.id) },
      status: 'PENDING',
    },
    _count: { _all: true },
  });
  const pendingMap = new Map(pendingCounts.map((c) => [c.sourceId, c._count._all]));

  return rows.map((row) => mapDeadlineToDTO(row, pendingMap.get(row.id) ?? 0, cairoToday));
}
