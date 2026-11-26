import { getPrismaClient } from '@/lib/auth';
import type { Prisma } from '@prisma/client';
import type { Actor, Permission } from '@/modules/identity/types';
import { assertAuthorized, authorize } from '@/modules/identity/authorize';
import { recordAuditEvent } from '@/lib/audit';
import { validateOptionalCalendarTime } from '@/lib/cairo-date';
import { claimIdempotencyKey, completeIdempotencyKey, resolveConcurrentIdempotency, runWithIdempotencyRetry } from '@/lib/idempotency';
import { cancelSourceReminderJobs, enqueueSourceReminderJob } from '@/modules/reminders/reminder-outbox';
import { assertLinkableDocument } from '@/modules/documents/document-service';
import {
  LINKABLE_DOCUMENT_SELECT,
  mapLinkableDocumentSummary,
  type LinkableDocumentRow,
} from '@/modules/documents/document-types';
import {
  HearingDTO,
  HearingResultDTO,
  HearingResultSummaryDTO,
  HearingStatus,
  NextDateDisposition,
  TaskPriority,
  TaskStatus,
  TaskDTO,
  ScheduleHearingInput,
  RecordHearingResultInput,
  RecordHearingResultResult,
  RescheduleHearingInput,
  RescheduleHearingResult,
  CancelHearingInput,
  CorrectHearingResultInput,
  SchedulingValidationError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  UnauthorizedError,
  parseCalendarDateToUtc,
  validateAndNormalizeHearingTime,
  scheduleHearingSchema,
  recordHearingResultSchema,
  rescheduleHearingSchema,
  cancelHearingSchema,
  correctHearingResultSchema,
} from './hearing-types';

const prisma = new Proxy({} as ReturnType<typeof getPrismaClient>, {
  get(_target, prop) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

function toDateString(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function assertActorAuthorized(actor: Actor | undefined | null, permission: Permission): Actor {
  if (!actor || !actor.id || !actor.role) {
    throw new UnauthorizedError('غير مصرح. يرجى تسجيل الدخول أولاً.');
  }
  assertAuthorized(actor, permission);
  return actor;
}

interface HearingRecord {
  id: string;
  proceedingId: string;
  matterId?: string;
  proceeding?: {
    matterId?: string;
    circuit?: string | null;
    court?: { name?: string | null } | null;
  } | null;
  hearingDate: Date;
  hearingTime?: string | null;
  courtHall?: string | null;
  purpose?: string | null;
  rollNumber?: string | null;
  status: HearingStatus;
  version: number;
  rescheduleReason?: string | null;
  cancellationReason?: string | null;
  supersedesHearingId?: string | null;
  results?: Array<{
    id: string;
    decisionText: string;
    summary?: string | null;
    attendance?: string | null;
    notes?: string | null;
    correctionReason?: string | null;
    nextDateDisposition: NextDateDisposition;
    decisionDocumentId?: string | null;
    decisionDocument?: LinkableDocumentRow | null;
    recordedAt: Date;
    revision: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

interface HearingResultRecord {
  id: string;
  hearingId: string;
  decisionText: string;
  summary?: string | null;
  attendance?: string | null;
  notes?: string | null;
  correctionReason?: string | null;
  nextDateDisposition: NextDateDisposition;
  decisionDocumentId?: string | null;
  decisionDocument?: LinkableDocumentRow | null;
  recordedAt: Date;
  revision: number;
  supersedesResultId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DECISION_DOCUMENT_INCLUDE = {
  select: LINKABLE_DOCUMENT_SELECT,
} as const;

interface TaskRecord {
  id: string;
  matterId: string | null;
  proceedingId?: string | null;
  hearingId?: string | null;
  title: string;
  dueDate?: Date | null;
  dueTime?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function mapHearingToDTO(
  raw: HearingRecord,
  duplicateWarning = false,
  canReadDocuments = true
): HearingDTO {
  const latestResultRaw = raw.results && raw.results.length > 0 ? raw.results[0] : null;
  const latestResult: HearingResultSummaryDTO | null = latestResultRaw
    ? {
        id: latestResultRaw.id,
        courtDecision: latestResultRaw.decisionText,
        decisionText: latestResultRaw.decisionText,
        summary: latestResultRaw.summary ?? null,
        attendance: latestResultRaw.attendance ?? null,
        notes: latestResultRaw.notes ?? null,
        correctionReason: latestResultRaw.correctionReason ?? null,
        nextDateDisposition: latestResultRaw.nextDateDisposition,
        decisionDocumentId: canReadDocuments ? (latestResultRaw.decisionDocumentId ?? null) : null,
        decisionDocument: canReadDocuments
          ? mapLinkableDocumentSummary(latestResultRaw.decisionDocument)
          : null,
        recordedAt: latestResultRaw.recordedAt.toISOString(),
        revision: latestResultRaw.revision,
      }
    : null;

  return {
    id: raw.id,
    proceedingId: raw.proceedingId,
    matterId: raw.proceeding?.matterId ?? raw.matterId ?? '',
    courtName: raw.proceeding?.court?.name ?? null,
    circuit: raw.proceeding?.circuit ?? null,
    hearingDate: toDateString(raw.hearingDate),
    hearingTime: raw.hearingTime ?? null,
    courtHall: raw.courtHall ?? null,
    locationRoom: raw.courtHall ?? null,
    purpose: raw.purpose ?? null,
    rollNumber: raw.rollNumber ?? null,
    status: raw.status,
    version: raw.version,
    rescheduleReason: raw.rescheduleReason ?? null,
    cancellationReason: raw.cancellationReason ?? null,
    supersedesHearingId: raw.supersedesHearingId ?? null,
    duplicateDateWarning: duplicateWarning,
    latestResult,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}

function mapHearingResultToDTO(raw: HearingResultRecord, canReadDocuments = true): HearingResultDTO {
  return {
    id: raw.id,
    hearingId: raw.hearingId,
    courtDecision: raw.decisionText,
    decisionText: raw.decisionText,
    decision: raw.decisionText,
    summary: raw.summary ?? null,
    attendance: raw.attendance ?? null,
    notes: raw.notes ?? null,
    correctionReason: raw.correctionReason ?? null,
    nextDateDisposition: raw.nextDateDisposition,
    decisionDocumentId: canReadDocuments ? (raw.decisionDocumentId ?? null) : null,
    decisionDocument: canReadDocuments ? mapLinkableDocumentSummary(raw.decisionDocument) : null,
    recordedAt: raw.recordedAt.toISOString(),
    revision: raw.revision,
    supersedesResultId: raw.supersedesResultId ?? null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}

function mapTaskToDTO(raw: TaskRecord): TaskDTO {
  return {
    id: raw.id,
    matterId: raw.matterId,
    proceedingId: raw.proceedingId ?? null,
    hearingId: raw.hearingId ?? null,
    title: raw.title,
    dueDate: raw.dueDate ? toDateString(raw.dueDate) : null,
    dueTime: raw.dueTime ?? null,
    priority: raw.priority,
    status: raw.status,
    version: raw.version,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}

async function lockHearingParents(
  tx: Prisma.TransactionClient,
  proceedingId: string
): Promise<{ matterId: string; proceedingId: string }> {
  const proceeding = await tx.proceeding.findUnique({ where: { id: proceedingId }, select: { matterId: true } });
  if (!proceeding) throw new NotFoundError('القيد القضائي المطلوب غير موجود.');
  const [matter] = await tx.$queryRaw<{ status: string; archivedAt: Date | null }[]>`
    SELECT "status", "archivedAt" FROM "matter" WHERE "id" = ${proceeding.matterId} FOR UPDATE
  `;
  const [parent] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT "archivedAt" FROM "proceeding" WHERE "id" = ${proceedingId} FOR UPDATE
  `;
  if (!matter || !parent) throw new NotFoundError('القيد القضائي المطلوب غير موجود.');
  if (matter.archivedAt || matter.status === 'ARCHIVED') throw new MatterArchivedError('ملف القضية مؤرشف.');
  if (parent.archivedAt) throw new ProceedingArchivedError('القيد القضائي مؤرشف.');
  return { matterId: proceeding.matterId, proceedingId };
}

async function lockHearing(
  tx: Prisma.TransactionClient,
  id: string
): Promise<{ matterId: string; proceedingId: string }> {
  const hearing = await tx.hearing.findUnique({ where: { id }, select: { proceedingId: true } });
  if (!hearing) throw new NotFoundError('الجلسة المطلوبة غير موجودة.');
  return lockHearingParents(tx, hearing.proceedingId);
}

function hearingAcknowledgment(hearing: HearingDTO) {
  const { id, version, status, updatedAt, duplicateDateWarning } = hearing;
  return { id, version, status, updatedAt, duplicateDateWarning };
}

type HearingAcknowledgment = ReturnType<typeof hearingAcknowledgment>;

async function replayHearing(
  tx: Prisma.TransactionClient,
  ack: HearingAcknowledgment,
  resultId?: string,
  canReadDocuments = true
) {
  const record = await tx.hearing.findUniqueOrThrow({
    where: { id: ack.id },
    include: {
      proceeding: { include: { court: true } },
      results: {
        where: { id: resultId ?? '' },
        ...(canReadDocuments ? { include: { decisionDocument: DECISION_DOCUMENT_INCLUDE } } : {}),
      },
    },
  });
  return mapHearingToDTO(
    {
      ...record, version: ack.version, status: ack.status, updatedAt: new Date(ack.updatedAt),
      rescheduleReason: ack.status === 'RESCHEDULED' ? record.rescheduleReason : null,
      cancellationReason: ack.status === 'CANCELLED' ? record.cancellationReason : null,
    },
    ack.duplicateDateWarning,
    canReadDocuments
  );
}

function resultAcknowledgment(value: RecordHearingResultResult) {
  return {
    resultId: value.resultId,
    hearing: hearingAcknowledgment(value.hearing),
    next: value.nextHearing ? hearingAcknowledgment(value.nextHearing) : null,
    tasks: value.tasks?.map(({ id, hearingId, dueDate, dueTime, status, version, updatedAt }) => ({
      id,
      hearingId,
      dueDate,
      dueTime: dueTime ?? null,
      status,
      version,
      updatedAt,
    })) ?? [],
  };
}

async function replayResult(
  tx: Prisma.TransactionClient,
  raw: unknown,
  canReadDocuments = true
): Promise<RecordHearingResultResult> {
  const ack = raw as ReturnType<typeof resultAcknowledgment>;
  const result = mapHearingResultToDTO(
    await tx.hearingResult.findUniqueOrThrow({
      where: { id: ack.resultId },
      ...(canReadDocuments ? { include: { decisionDocument: DECISION_DOCUMENT_INCLUDE } } : {}),
    }),
    canReadDocuments
  );
  const hearing = await replayHearing(tx, ack.hearing, ack.resultId, canReadDocuments);
  const nextHearing = ack.next ? await replayHearing(tx, ack.next, undefined, canReadDocuments) : null;
  const tasks = await Promise.all(ack.tasks.map(async (snapshot) => ({
    ...mapTaskToDTO(await tx.task.findUniqueOrThrow({ where: { id: snapshot.id } })), ...snapshot,
  })));
  return { resultId: result.id, result, hearing, nextHearing, tasks, taskIds: tasks.map((task) => task.id) };
}

async function hearingCommand<T>(
  actor: Actor, commandType: string, key: string, payload: unknown,
  write: (tx: Prisma.TransactionClient) => Promise<{ value: T; resultId: string; acknowledgment: unknown }>,
  replay: (tx: Prisma.TransactionClient, payload: unknown, resultId: string) => Promise<T>,
): Promise<T> {
  const params = { actorId: actor.id, commandType, key, payload };
  const execute = () => prisma.$transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, params);
    if (claim.isReplay && claim.resultId) return replay(tx, claim.resultPayload, claim.resultId);
    const { value, resultId, acknowledgment } = await write(tx);
    await completeIdempotencyKey(tx, { ...params, resultType: 'HearingOperation', resultId, resultPayload: acknowledgment });
    return value;
  });
  return runWithIdempotencyRetry(execute, async () => {
    const claim = await resolveConcurrentIdempotency(prisma, params);
    if (!claim?.resultId) return { resolved: false };
    const value = await prisma.$transaction((tx) => replay(tx, claim.resultPayload, claim.resultId!));
    return { resolved: true, value };
  });
}

export async function scheduleHearing(
  actor: Actor,
  rawInput: ScheduleHearingInput
): Promise<HearingDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const parsed = scheduleHearingSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new SchedulingValidationError('بيانات الجلسة غير صالحة.', fieldErrors);
  }
  const input = parsed.data;

  const hearingDateUtc = parseCalendarDateToUtc(input.hearingDate);
  if (!hearingDateUtc) {
    throw new SchedulingValidationError('تاريخ الجلسة مطلوب وتنسيقه غير صالح.');
  }

  const normTime = validateAndNormalizeHearingTime(input.hearingTime);
  const purpose = input.purpose || input.hearingPurpose || null;
  const courtHall = input.courtHall || input.locationRoom || null;
  const rollNumber = input.rollNumber || null;
  const intent = {
    proceedingId: input.proceedingId, hearingDate: input.hearingDate, hearingTime: normTime, courtHall, purpose, rollNumber,
  };

  return hearingCommand(actor, 'scheduleHearing', input.idempotencyKey, intent, async (tx) => {
    await lockHearingParents(tx, input.proceedingId);

    // Check same-day scheduled conflict warning
    const existingSameDay = await tx.hearing.findFirst({
      where: {
        proceedingId: input.proceedingId,
        hearingDate: hearingDateUtc,
        status: 'SCHEDULED',
      },
    });
    const duplicateWarning = Boolean(existingSameDay);

    // Create Hearing row
    const hearing = await tx.hearing.create({
      data: {
        proceedingId: input.proceedingId,
        hearingDate: hearingDateUtc,
        hearingTime: normTime,
        courtHall,
        purpose,
        rollNumber,
        status: 'SCHEDULED',
        version: 1,
        createdById: actor.id,
        updatedById: actor.id,
      },
      include: {
        proceeding: {
          include: {
            court: true,
          },
        },
        results: true,
      },
    });

    // Create durable reminder work in outbox (JobRun)
    await enqueueSourceReminderJob(tx, {
      sourceType: 'Hearing',
      sourceId: hearing.id,
      sourceVersion: hearing.version,
      eventDateYmd: input.hearingDate,
      deduplicationKey: `hearing_reminder_${hearing.id}`,
      payload: {
        hearingId: hearing.id,
        proceedingId: input.proceedingId,
        hearingDate: input.hearingDate,
        hearingTime: normTime,
        sourceVersion: hearing.version,
        recipientUserId: actor.id,
      },
    });

    // Record Audit Event
    await recordAuditEvent(tx, {
      userId: actor.id,
      action: 'SCHEDULE_HEARING',
      entityType: 'Hearing',
      entityId: hearing.id,
      changedFields: {
        proceedingId: input.proceedingId,
        hearingDate: input.hearingDate,
        hearingTime: normTime,
        status: 'SCHEDULED',
      },
    });

    const dto = mapHearingToDTO(hearing, duplicateWarning);

    return { value: dto, resultId: dto.id, acknowledgment: hearingAcknowledgment(dto) };
  }, (tx, ack) => replayHearing(tx, ack as HearingAcknowledgment));
}

export async function recordHearingResult(
  actor: Actor,
  rawInput: RecordHearingResultInput
): Promise<RecordHearingResultResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const parsed = recordHearingResultSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new SchedulingValidationError('بيانات تسجيل النتيجة غير صالحة.', fieldErrors);
  }
  const input = parsed.data;

  const decision = (input.decision || input.decisionText || input.courtDecision || '').trim();
  if (!decision) {
    throw new SchedulingValidationError('منطوق قرار الجلسة مطلوب ولا يمكن تركه فارغاً.');
  }

  const nextDateStr = input.nextHearing?.hearingDate || input.nextHearingDate || null;
  const nextTimeStr = input.nextHearing?.hearingTime || input.nextHearingTime || null;

  if (input.nextDateDisposition === 'KNOWN' && !nextDateStr) {
    throw new SchedulingValidationError('يجب تحديد موعد الجلسة القادمة عند اختيار موعد محدد.');
  }

  if (input.nextDateDisposition !== 'KNOWN' && (nextDateStr || nextTimeStr)) {
    throw new SchedulingValidationError('حدد موقف موعد الجلسة القادم بما يطابق البيانات.');
  }

  const normNextTime = validateAndNormalizeHearingTime(nextTimeStr);
  const nextCourtHall = input.nextHearing?.courtHall || input.nextHearing?.locationRoom || null;
  const nextPurpose = input.nextHearing?.purpose || null;
  const nextRoll = input.nextHearing?.rollNumber || null;
  const tasks = (input.tasks ?? []).map(({ title, dueDate, dueTime, priority }) => {
    const normDueDate = dueDate ?? null;
    const normDueTime = validateOptionalCalendarTime(normDueDate, dueTime, 'dueTime');
    return {
      title,
      dueDate: normDueDate,
      dueTime: normDueTime,
      priority: priority ?? 'NORMAL',
    };
  });
  const intent = {
    hearingId: input.hearingId, expectedVersion: input.expectedVersion, decision,
    summary: input.summary || null, attendance: input.attendance || null, notes: input.notes || null,
    decisionDocumentId: input.decisionDocumentId ?? null,
    nextDateDisposition: input.nextDateDisposition,
    nextHearing: nextDateStr ? {
      date: nextDateStr, time: normNextTime, courtHall: nextCourtHall, purpose: nextPurpose, rollNumber: nextRoll,
    } : null,
    tasks,
  };

  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');
  if (input.decisionDocumentId) {
    assertAuthorized(actor, 'READ_DOCUMENTS');
  }

  return hearingCommand(actor, 'recordHearingResult', input.idempotencyKey, intent, async (tx) => {
    await lockHearing(tx, input.hearingId);

    // 1. Lock and load original hearing
    const hearing = await tx.hearing.findUnique({
      where: { id: input.hearingId },
      include: {
        proceeding: {
          include: {
            court: true,
            matter: true,
          },
        },
        results: {
          orderBy: { revision: 'desc' },
          take: 1,
        },
      },
    });

    if (!hearing) {
      throw new NotFoundError('الجلسة المطلوبة غير موجودة.');
    }

    if (hearing.version !== input.expectedVersion) {
      throw new ConcurrencyConflictError('تم تعديل الجلسة بواسطة مستخدم آخر.');
    }

    if (hearing.status !== 'SCHEDULED') {
      throw new UnsupportedTransitionError(`لا يمكن تسجيل نتيجة لجلسة غير مجدولة (الحالة الحالية: ${hearing.status}).`);
    }

    if (input.decisionDocumentId) {
      await assertLinkableDocument(tx, input.decisionDocumentId, {
        kind: 'MATTER',
        matterId: hearing.proceeding.matterId,
        proceedingId: hearing.proceedingId,
        hearingId: hearing.id,
      });
    }

    // 2. Mark hearing COMPLETED
    const nextHearingVersion = hearing.version + 1;
    if (nextDateStr && nextDateStr < toDateString(hearing.hearingDate)) {
      throw new SchedulingValidationError('تاريخ الجلسة التالية لا يمكن أن يسبق الجلسة الحالية.');
    }
    const completed = await tx.hearing.update({
      where: { id: hearing.id, version: input.expectedVersion, status: 'SCHEDULED' },
      data: {
        status: 'COMPLETED',
        version: nextHearingVersion,
        updatedById: actor.id,
      },
    });

    // 3. Create HearingResult
    const recordedAt = new Date();
    const hearingResult = await tx.hearingResult.create({
      data: {
        hearingId: hearing.id,
        decisionDocumentId: input.decisionDocumentId ?? null,
        decisionText: decision,
        summary: intent.summary,
        attendance: intent.attendance,
        notes: intent.notes,
        nextDateDisposition: input.nextDateDisposition,
        recordedAt,
        revision: 1,
        createdById: actor.id,
        updatedById: actor.id,
      },
      ...(canReadDocuments
        ? {
            include: {
              decisionDocument: DECISION_DOCUMENT_INCLUDE,
            },
          }
        : {}),
    });

    // 4. Invalidate obsolete reminder work for the completed hearing
    await cancelSourceReminderJobs(tx, 'Hearing', hearing.id, recordedAt);

    // 5. If adjournment next date is KNOWN, create linked next hearing & reminder outbox
    let nextHearingDTO: HearingDTO | null = null;
    if (input.nextDateDisposition === 'KNOWN' && nextDateStr) {
      const nextDateUtc = parseCalendarDateToUtc(nextDateStr);
      if (!nextDateUtc) {
        throw new SchedulingValidationError('تاريخ الجلسة القادمة غير صالح.');
      }
      const nextHearing = await tx.hearing.create({
        data: {
          proceedingId: hearing.proceedingId,
          hearingDate: nextDateUtc,
          hearingTime: normNextTime,
          courtHall: nextCourtHall ?? hearing.courtHall,
          purpose: nextPurpose,
          rollNumber: nextRoll ?? hearing.rollNumber,
          status: 'SCHEDULED',
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: {
          proceeding: {
            include: { court: true },
          },
        },
      });

      // Link hearings with ADJOURNED_TO
      await tx.hearingLink.create({
        data: {
          fromHearingId: hearing.id,
          toHearingId: nextHearing.id,
          relation: 'ADJOURNED_TO',
          createdById: actor.id,
        },
      });

      // Create durable reminder JobRun for next hearing
      await enqueueSourceReminderJob(tx, {
        sourceType: 'Hearing',
        sourceId: nextHearing.id,
        sourceVersion: nextHearing.version,
        eventDateYmd: nextDateStr,
        deduplicationKey: `hearing_reminder_${nextHearing.id}`,
        payload: {
          hearingId: nextHearing.id,
          proceedingId: hearing.proceedingId,
          hearingDate: nextDateStr,
          hearingTime: normNextTime,
          sourceVersion: nextHearing.version,
          recipientUserId: actor.id,
        },
      });

      nextHearingDTO = mapHearingToDTO(nextHearing);
    }

    // 6. Create selected follow-up tasks
    const createdTasksDTO: TaskDTO[] = [];
    const taskIds: string[] = [];
    if (tasks.length > 0) {
      for (const { title, dueDate, dueTime, priority } of tasks) {
        const taskDueDate = parseCalendarDateToUtc(dueDate);
        const task = await tx.task.create({
          data: {
            matterId: hearing.proceeding.matterId,
            proceedingId: hearing.proceedingId,
            hearingId: hearing.id,
            title,
            dueDate: taskDueDate,
            dueTime,
            priority,
            status: 'OPEN',
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        taskIds.push(task.id);
        if (dueDate) {
          await enqueueSourceReminderJob(tx, {
            sourceType: 'Task',
            sourceId: task.id,
            sourceVersion: task.version,
            eventDateYmd: dueDate,
            deduplicationKey: `task_reminder_${task.id}_v${task.version}`,
            payload: {
              taskId: task.id,
              matterId: hearing.proceeding.matterId,
              proceedingId: hearing.proceedingId,
              hearingId: hearing.id,
              dueDate,
              dueTime,
              sourceVersion: task.version,
              recipientUserId: actor.id,
            },
          });
        }
        createdTasksDTO.push(mapTaskToDTO(task));
      }
    }

    // 8. Record immutable Audit Event
    await recordAuditEvent(tx, {
      userId: actor.id,
      action: 'RECORD_HEARING_RESULT',
      entityType: 'Hearing',
      entityId: hearing.id,
      changedFields: {
        resultId: hearingResult.id,
        decisionDocumentId: hearingResult.decisionDocumentId,
        nextDateDisposition: input.nextDateDisposition,
        nextHearingId: nextHearingDTO?.id ?? null,
        createdTaskIds: taskIds,
      },
    });

    const resultDTO = mapHearingResultToDTO(hearingResult, canReadDocuments);
    const completedHearingDTO = mapHearingToDTO(
      {
        ...hearing,
        ...completed,
        results: [hearingResult],
      },
      false,
      canReadDocuments
    );

    const finalResult: RecordHearingResultResult = {
      resultId: resultDTO.id,
      result: resultDTO,
      hearing: completedHearingDTO,
      nextHearing: nextHearingDTO,
      taskIds,
      tasks: createdTasksDTO,
    };

    return { value: finalResult, resultId: resultDTO.id, acknowledgment: resultAcknowledgment(finalResult) };
  }, (tx, raw) => replayResult(tx, raw, canReadDocuments));
}

export async function correctHearingResult(
  actor: Actor,
  rawInput: CorrectHearingResultInput
): Promise<HearingResultDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const parsed = correctHearingResultSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new SchedulingValidationError('بيانات تصحيح النتيجة غير صالحة.', fieldErrors);
  }
  const input = parsed.data;

  const reason = (input.reason || input.correctionReason || '').trim();
  if (!reason) {
    throw new SchedulingValidationError('سبب تصحيح النتيجة مطلوب وإلزامي.');
  }

  const decision = (input.decision || input.decisionText || input.courtDecision || '').trim();
  if (!decision) {
    throw new SchedulingValidationError('منطوق القرار المصحح مطلوب.');
  }

  const nextHearingTime = validateAndNormalizeHearingTime(input.nextHearingTime);
  const intent = {
    hearingId: input.hearingId, expectedVersion: input.expectedVersion, currentResultId: input.currentResultId,
    reason, decision, summary: input.summary === '' ? null : input.summary,
    attendance: input.attendance === '' ? null : input.attendance, notes: input.notes === '' ? null : input.notes,
    decisionDocumentId: input.decisionDocumentId,
    nextDateDisposition: input.nextDateDisposition, nextHearingDate: input.nextHearingDate ?? null, nextHearingTime,
  };
  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');
  if (input.decisionDocumentId) {
    assertAuthorized(actor, 'READ_DOCUMENTS');
  }
  return hearingCommand(actor, 'correctHearingResult', input.idempotencyKey, intent, async (tx) => {
    const { matterId, proceedingId } = await lockHearing(tx, input.hearingId);
    // 1. Find latest result for hearing
    const latestResult = await tx.hearingResult.findFirst({
      where: { hearingId: input.hearingId },
      orderBy: { revision: 'desc' },
    });

    if (!latestResult) {
      throw new NotFoundError('لا توجد نتيجة مسجلة لهذه الجلسة لتصحيحها.');
    }

    if (input.expectedVersion === undefined && !input.currentResultId) {
      throw new SchedulingValidationError('يلزم تحديد إصدار النتيجة المعروضة قبل التصحيح.');
    }

    if (input.expectedVersion !== undefined && latestResult.revision !== input.expectedVersion) {
      throw new ConcurrencyConflictError('تم تعديل نتيجة الجلسة بواسطة مستخدم آخر.');
    }

    if (input.currentResultId && latestResult.id !== input.currentResultId) {
      throw new ConcurrencyConflictError('معرف النتيجة المسجلة لا يطابق أحدث نتيجة.');
    }

    if (input.nextDateDisposition && input.nextDateDisposition !== latestResult.nextDateDisposition) {
      throw new SchedulingValidationError('تغيير موعد الجلسة التالية يحتاج إجراءً منفصلاً.');
    }
    if (input.nextHearingDate || nextHearingTime) {
      const link = await tx.hearingLink.findFirst({
        where: { fromHearingId: input.hearingId, relation: 'ADJOURNED_TO' }, include: { toHearing: true },
      });
      if (!link || (input.nextHearingDate && input.nextHearingDate !== toDateString(link.toHearing.hearingDate)) ||
          (nextHearingTime && nextHearingTime !== link.toHearing.hearingTime)) {
        throw new SchedulingValidationError('تغيير موعد الجلسة التالية يحتاج إجراءً منفصلاً.');
      }
    }

    if (input.decisionDocumentId) {
      await assertLinkableDocument(tx, input.decisionDocumentId, {
        kind: 'MATTER',
        matterId,
        proceedingId,
        hearingId: input.hearingId,
      });
    }

    const nextDecisionDocumentId =
      input.decisionDocumentId === undefined ? latestResult.decisionDocumentId : input.decisionDocumentId;

    // 3. Create new Revision of HearingResult preserving history
    const nextRevision = latestResult.revision + 1;
    const newResult = await tx.hearingResult.create({
      data: {
        hearingId: input.hearingId,
        decisionDocumentId: nextDecisionDocumentId,
        decisionText: decision,
        summary: intent.summary === undefined ? latestResult.summary : intent.summary,
        attendance: intent.attendance === undefined ? latestResult.attendance : intent.attendance,
        notes: intent.notes === undefined ? latestResult.notes : intent.notes,
        correctionReason: reason,
        nextDateDisposition: latestResult.nextDateDisposition,
        recordedAt: new Date(),
        revision: nextRevision,
        supersedesResultId: latestResult.id,
        createdById: actor.id,
        updatedById: actor.id,
      },
      ...(canReadDocuments
        ? {
            include: {
              decisionDocument: DECISION_DOCUMENT_INCLUDE,
            },
          }
        : {}),
    });

    // 4. Audit Event
    await recordAuditEvent(tx, {
      userId: actor.id,
      action: 'CORRECT_HEARING_RESULT',
      entityType: 'HearingResult',
      entityId: newResult.id,
      reason,
      changedFields: {
        hearingId: input.hearingId,
        previousResultId: latestResult.id,
        previousRevision: latestResult.revision,
        newRevision: nextRevision,
        decisionDocumentId: newResult.decisionDocumentId,
        decisionChanged: latestResult.decisionText !== decision,
      },
    });

    const dto = mapHearingResultToDTO(newResult, canReadDocuments);

    return { value: dto, resultId: dto.id, acknowledgment: null };
  }, async (tx, _ack, id) => mapHearingResultToDTO(await tx.hearingResult.findUniqueOrThrow({
    where: { id },
    ...(canReadDocuments ? { include: { decisionDocument: DECISION_DOCUMENT_INCLUDE } } : {}),
  }), canReadDocuments));
}

export async function rescheduleHearing(
  actor: Actor,
  rawInput: RescheduleHearingInput
): Promise<RescheduleHearingResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const parsed = rescheduleHearingSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new SchedulingValidationError('بيانات إعادة الجدولة غير صالحة.', fieldErrors);
  }
  const input = parsed.data;

  const newDateUtc = parseCalendarDateToUtc(input.newHearingDate);
  if (!newDateUtc) {
    throw new SchedulingValidationError('تاريخ الجلسة الجديد غير صالح.');
  }

  const normTime = validateAndNormalizeHearingTime(input.newHearingTime);
  const reason = input.reason.trim();
  const hasCourtHall = input.courtHall !== undefined || input.locationRoom !== undefined;
  const courtHall = hasCourtHall ? (input.courtHall || input.locationRoom || null) : undefined;
  const hasPurpose = input.purpose !== undefined;
  const purpose = hasPurpose ? (input.purpose || null) : undefined;
  const hasRollNumber = input.rollNumber !== undefined;
  const rollNumber = hasRollNumber ? (input.rollNumber || null) : undefined;
  const taskChanges = (input.taskChanges ?? []).toSorted((left, right) => left.taskId.localeCompare(right.taskId));
  const intent = {
    hearingId: input.hearingId, expectedVersion: input.expectedVersion, newHearingDate: input.newHearingDate,
    newHearingTime: normTime, reason,
    ...(hasCourtHall ? { courtHall } : {}),
    ...(hasPurpose ? { purpose } : {}),
    ...(hasRollNumber ? { rollNumber } : {}),
    taskChanges,
  };

  return hearingCommand(actor, 'rescheduleHearing', input.idempotencyKey, intent, async (tx) => {
    await lockHearing(tx, input.hearingId);
    // 1. Load hearing
    const hearing = await tx.hearing.findUnique({
      where: { id: input.hearingId },
      include: {
        proceeding: {
          include: { court: true },
        },
      },
    });

    if (!hearing) {
      throw new NotFoundError('الجلسة المطلوبة غير موجودة.');
    }

    if (hearing.version !== input.expectedVersion) {
      throw new ConcurrencyConflictError('تم تعديل الجلسة بواسطة مستخدم آخر.');
    }

    if (hearing.status !== 'SCHEDULED') {
      throw new UnsupportedTransitionError(`لا يمكن إعادة جدولة جلسة غير مجدولة (الحالة الحالية: ${hearing.status}).`);
    }

    // 2. Mark original RESCHEDULED
    const updatedOriginal = await tx.hearing.update({
      where: { id: hearing.id, version: input.expectedVersion, status: 'SCHEDULED' },
      data: {
        status: 'RESCHEDULED',
        version: hearing.version + 1,
        rescheduleReason: reason,
        updatedById: actor.id,
      },
      include: {
        proceeding: {
          include: { court: true },
        },
      },
    });

    // 3. Create replacement Hearing
    const replacementCourtHall = hasCourtHall ? (courtHall ?? null) : hearing.courtHall;
    const replacementPurpose = hasPurpose ? (purpose ?? null) : hearing.purpose;
    const replacementRoll = hasRollNumber ? (rollNumber ?? null) : hearing.rollNumber;

    const replacementHearing = await tx.hearing.create({
      data: {
        proceedingId: hearing.proceedingId,
        hearingDate: newDateUtc,
        hearingTime: normTime,
        courtHall: replacementCourtHall,
        purpose: replacementPurpose,
        rollNumber: replacementRoll,
        status: 'SCHEDULED',
        version: 1,
        supersedesHearingId: hearing.id,
        createdById: actor.id,
        updatedById: actor.id,
      },
      include: {
        proceeding: {
          include: { court: true },
        },
      },
    });

    // 4. Link with RESCHEDULED_TO
    await tx.hearingLink.create({
      data: {
        fromHearingId: hearing.id,
        toHearingId: replacementHearing.id,
        relation: 'RESCHEDULED_TO',
        createdById: actor.id,
      },
    });

    const taskSources = [hearing.id];
    if (taskChanges.length) {
      const rescheduleChain = new Set<string>([hearing.id]);
      let frontier = [hearing.id];
      for (let hop = 0; hop < 50 && frontier.length > 0; hop++) {
        const reschedules = await tx.hearingLink.findMany({
          where: { toHearingId: { in: frontier }, relation: 'RESCHEDULED_TO' },
          select: { fromHearingId: true },
        });
        frontier = [];
        for (const { fromHearingId } of reschedules) {
          if (!rescheduleChain.has(fromHearingId)) {
            rescheduleChain.add(fromHearingId);
            taskSources.push(fromHearingId);
            frontier.push(fromHearingId);
          }
        }
      }
      const seen = new Set(rescheduleChain);
      const adjournments = await tx.hearingLink.findMany({
        where: { toHearingId: { in: Array.from(rescheduleChain) }, relation: 'ADJOURNED_TO' },
        select: { fromHearingId: true },
      });
      for (const { fromHearingId } of adjournments) {
        if (!seen.has(fromHearingId)) {
          seen.add(fromHearingId);
          taskSources.push(fromHearingId);
        }
      }
    }
    for (const task of taskChanges) {
      const updated = await tx.task.updateMany({
        where: { id: task.taskId, proceedingId: hearing.proceedingId, hearingId: { in: taskSources }, status: { in: ['OPEN', 'IN_PROGRESS'] }, version: task.expectedVersion },
        data: {
          hearingId: replacementHearing.id,
          dueDate: parseCalendarDateToUtc(task.dueDate),
          ...(task.dueDate === null ? { dueTime: null } : {}),
          version: { increment: 1 },
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) throw new ConcurrencyConflictError('تم تغيير إحدى مهام الجلسة. أعد فتح النموذج.');
      await cancelSourceReminderJobs(tx, 'Task', task.taskId);
      if (task.dueDate) {
        const updatedTask = await tx.task.findUniqueOrThrow({
          where: { id: task.taskId },
          select: { matterId: true, dueTime: true, version: true },
        });
        await enqueueSourceReminderJob(tx, {
          sourceType: 'Task',
          sourceId: task.taskId,
          sourceVersion: updatedTask.version,
          eventDateYmd: task.dueDate,
          deduplicationKey: `task_reminder_${task.taskId}_v${updatedTask.version}`,
          payload: {
            taskId: task.taskId,
            matterId: updatedTask.matterId,
            proceedingId: hearing.proceedingId,
            hearingId: replacementHearing.id,
            dueDate: task.dueDate,
            dueTime: updatedTask.dueTime ?? null,
            sourceVersion: updatedTask.version,
            recipientUserId: actor.id,
          },
        });
      }
    }

    // 5. Invalidate old reminders & create new for replacement
    await cancelSourceReminderJobs(tx, 'Hearing', hearing.id);

    await enqueueSourceReminderJob(tx, {
      sourceType: 'Hearing',
      sourceId: replacementHearing.id,
      sourceVersion: replacementHearing.version,
      eventDateYmd: input.newHearingDate,
      deduplicationKey: `hearing_reminder_${replacementHearing.id}`,
      payload: {
        hearingId: replacementHearing.id,
        proceedingId: hearing.proceedingId,
        hearingDate: input.newHearingDate,
        hearingTime: normTime,
        sourceVersion: replacementHearing.version,
        recipientUserId: actor.id,
      },
    });

    // 6. Audit
    await recordAuditEvent(tx, {
      userId: actor.id,
      action: 'RESCHEDULE_HEARING',
      entityType: 'Hearing',
      entityId: hearing.id,
      reason,
      changedFields: {
        replacementHearingId: replacementHearing.id,
        newHearingDate: input.newHearingDate,
        newHearingTime: normTime,
      },
    });

    const originalDTO = mapHearingToDTO(updatedOriginal);
    const replacementDTO = mapHearingToDTO(replacementHearing);

    const result: RescheduleHearingResult = {
      originalHearing: originalDTO,
      replacementHearing: replacementDTO,
      newHearing: replacementDTO,
    };

    return { value: result, resultId: replacementHearing.id, acknowledgment: {
      original: hearingAcknowledgment(originalDTO), replacement: hearingAcknowledgment(replacementDTO),
    } };
  }, async (tx, raw) => {
    const ack = raw as { original: HearingAcknowledgment; replacement: HearingAcknowledgment };
    const originalHearing = await replayHearing(tx, ack.original);
    const replacementHearing = await replayHearing(tx, ack.replacement);
    return { originalHearing, replacementHearing, newHearing: replacementHearing };
  });
}

export async function cancelHearing(
  actor: Actor,
  rawInput: CancelHearingInput
): Promise<HearingDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  const parsed = cancelHearingSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'input';
      fieldErrors[key] = issue.message;
    }
    throw new SchedulingValidationError('بيانات إلغاء الجلسة غير صالحة.', fieldErrors);
  }
  const input = parsed.data;
  const reason = input.reason.trim();

  const intent = { hearingId: input.hearingId, expectedVersion: input.expectedVersion, reason };
  return hearingCommand(actor, 'cancelHearing', input.idempotencyKey, intent, async (tx) => {
    await lockHearing(tx, input.hearingId);
    const hearing = await tx.hearing.findUnique({
      where: { id: input.hearingId },
      include: {
        proceeding: {
          include: { court: true },
        },
      },
    });

    if (!hearing) {
      throw new NotFoundError('الجلسة المطلوبة غير موجودة.');
    }

    if (hearing.version !== input.expectedVersion) {
      throw new ConcurrencyConflictError('تم تعديل الجلسة بواسطة مستخدم آخر.');
    }

    if (hearing.status !== 'SCHEDULED') {
      throw new UnsupportedTransitionError(`لا يمكن إلغاء جلسة غير مجدولة (الحالة الحالية: ${hearing.status}).`);
    }

    // Update hearing to CANCELLED
    const cancelled = await tx.hearing.update({
      where: { id: hearing.id, version: input.expectedVersion, status: 'SCHEDULED' },
      data: {
        status: 'CANCELLED',
        version: hearing.version + 1,
        cancellationReason: reason,
        updatedById: actor.id,
      },
      include: {
        proceeding: {
          include: { court: true },
        },
      },
    });

    // Invalidate reminders
    await cancelSourceReminderJobs(tx, 'Hearing', hearing.id);

    // Audit
    await recordAuditEvent(tx, {
      userId: actor.id,
      action: 'CANCEL_HEARING',
      entityType: 'Hearing',
      entityId: hearing.id,
      reason,
    });

    const dto = mapHearingToDTO(cancelled);

    return { value: dto, resultId: dto.id, acknowledgment: hearingAcknowledgment(dto) };
  }, (tx, ack) => replayHearing(tx, ack as HearingAcknowledgment));
}

export async function getHearing(
  actor: Actor,
  hearingId: string
): Promise<HearingDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');
  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');

  const hearing = await prisma.hearing.findUnique({
    where: { id: hearingId },
    include: {
      proceeding: {
        include: {
          court: true,
          matter: true,
        },
      },
      results: {
        orderBy: { revision: 'desc' },
        ...(canReadDocuments ? { include: { decisionDocument: DECISION_DOCUMENT_INCLUDE } } : {}),
      },
    },
  });

  if (!hearing) {
    throw new NotFoundError('الجلسة المطلوبة غير موجودة.');
  }

  return mapHearingToDTO(hearing, false, canReadDocuments);
}

export async function listHearingsForProceeding(
  actor: Actor,
  proceedingId: string
): Promise<HearingDTO[]> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');
  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');

  const hearings = await prisma.hearing.findMany({
    where: { proceedingId },
    include: {
      proceeding: {
        include: { court: true },
      },
      results: {
        orderBy: { revision: 'desc' },
        take: 1,
        ...(canReadDocuments ? { include: { decisionDocument: DECISION_DOCUMENT_INCLUDE } } : {}),
      },
      tasks: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'asc' }, take: 200 },
      linksTo: {
        where: { relation: { in: ['ADJOURNED_TO', 'RESCHEDULED_TO'] } },
        select: { fromHearingId: true, relation: true },
      },
    },
    orderBy: [
      { hearingDate: 'asc' },
      { id: 'asc' },
    ],
    take: 500,
  });

  const byId = new Map(hearings.map((hearing) => [hearing.id, hearing]));

  const collectAncestorTasks = (rootId: string): TaskDTO[] => {
    const rescheduleChain: string[] = [rootId];
    const visited = new Set<string>([rootId]);

    for (let i = 0; i < rescheduleChain.length && rescheduleChain.length < 50; i++) {
      const current = byId.get(rescheduleChain[i]);
      if (!current) continue;
      for (const link of current.linksTo) {
        if (link.relation === 'RESCHEDULED_TO' && !visited.has(link.fromHearingId)) {
          visited.add(link.fromHearingId);
          rescheduleChain.push(link.fromHearingId);
          if (rescheduleChain.length >= 50) break;
        }
      }
    }

    const sourceIds = [...rescheduleChain];
    for (const id of rescheduleChain) {
      const node = byId.get(id);
      if (!node) continue;
      for (const link of node.linksTo) {
        if (link.relation === 'ADJOURNED_TO' && !visited.has(link.fromHearingId)) {
          visited.add(link.fromHearingId);
          sourceIds.push(link.fromHearingId);
        }
      }
    }

    const tasks: typeof hearings[number]['tasks'] = [];
    const seenTaskIds = new Set<string>();
    for (const id of sourceIds) {
      const node = byId.get(id);
      if (!node) continue;
      for (const task of node.tasks) {
        if (!seenTaskIds.has(task.id)) {
          seenTaskIds.add(task.id);
          tasks.push(task);
        }
      }
    }

    return tasks.map(mapTaskToDTO);
  };

  return hearings.map((hearing) => ({
    ...mapHearingToDTO(hearing, false, canReadDocuments),
    followUpTasks: collectAncestorTasks(hearing.id),
  }));
}
