import { getPrismaClient } from '@/lib/auth';
import type { Actor, Permission } from '@/modules/identity/types';
import { assertAuthorized } from '@/modules/identity/authorize';
import { recordAuditEvent } from '@/lib/audit';
import { claimIdempotencyKey, completeIdempotencyKey } from '@/lib/idempotency';
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
  recordedAt: Date;
  revision: number;
  supersedesResultId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TaskRecord {
  id: string;
  matterId: string;
  proceedingId?: string | null;
  hearingId?: string | null;
  title: string;
  dueDate?: Date | null;
  priority: TaskPriority;
  status: TaskStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function mapHearingToDTO(
  raw: HearingRecord,
  duplicateWarning = false
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

function mapHearingResultToDTO(raw: HearingResultRecord): HearingResultDTO {
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
    priority: raw.priority,
    status: raw.status,
    version: raw.version,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
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

  return await prisma.$transaction(async (tx) => {
    // Check proceeding & parent matter status
    const proceeding = await tx.proceeding.findUnique({
      where: { id: input.proceedingId },
      include: {
        matter: true,
        court: true,
      },
    });

    if (!proceeding) {
      throw new NotFoundError('القيد القضائي المطلوب غير موجود.');
    }

    if (proceeding.matter.archivedAt != null || proceeding.matter.status === 'ARCHIVED') {
      throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن إضافة جلسات إليه.');
    }

    if (proceeding.archivedAt != null) {
      throw new ProceedingArchivedError('القيد القضائي مؤرشف ولا يمكن جدولة جلسات عليه.');
    }

    // Check same-day scheduled conflict warning
    const existingSameDay = await tx.hearing.findFirst({
      where: {
        proceedingId: input.proceedingId,
        hearingDate: hearingDateUtc,
        status: 'SCHEDULED',
      },
    });
    const duplicateWarning = Boolean(existingSameDay);

    // Idempotency check if key supplied
    if (input.idempotencyKey) {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'scheduleHearing',
        key: input.idempotencyKey,
        payload: {
          proceedingId: input.proceedingId,
          hearingDate: input.hearingDate,
          hearingTime: normTime,
          purpose,
          courtHall,
          rollNumber: input.rollNumber ?? null,
        },
      });

      if (claim.isReplay && claim.resultPayload) {
        return claim.resultPayload as HearingDTO;
      }
    }

    // Create Hearing row
    const hearing = await tx.hearing.create({
      data: {
        proceedingId: input.proceedingId,
        hearingDate: hearingDateUtc,
        hearingTime: normTime,
        courtHall,
        purpose,
        rollNumber: input.rollNumber?.trim() || null,
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
    await tx.jobRun.create({
      data: {
        jobType: 'REMINDER_DELIVERY',
        sourceType: 'Hearing',
        sourceId: hearing.id,
        scheduledAt: hearingDateUtc,
        status: 'PENDING',
        deduplicationKey: `hearing_reminder_${hearing.id}`,
        payload: {
          hearingId: hearing.id,
          proceedingId: input.proceedingId,
          hearingDate: input.hearingDate,
          hearingTime: normTime,
        },
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

    if (input.idempotencyKey) {
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'scheduleHearing',
        key: input.idempotencyKey,
        resultType: 'Hearing',
        resultId: hearing.id,
        resultPayload: dto,
      });
    }

    return dto;
  });
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

  // Validate tasks if present
  if (input.tasks) {
    for (const t of input.tasks) {
      if (!t.title || !t.title.trim()) {
        throw new SchedulingValidationError('عنوان المهمة لا يمكن أن يكون فارغاً.');
      }
    }
  }

  // Idempotency token check and processing
  const idempotencyPayload = {
    hearingId: input.hearingId,
    expectedVersion: input.expectedVersion,
    decision,
    summary: input.summary ?? null,
    attendance: input.attendance ?? null,
    notes: input.notes ?? null,
    nextDateDisposition: input.nextDateDisposition,
    nextDateStr,
    nextTimeStr,
    tasks: input.tasks ?? [],
    decisionDocumentId: input.decisionDocumentId ?? null,
    proceedingStatusUpdate: input.proceedingStatusUpdate ?? null,
  };

  return await prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'recordHearingResult',
        key: input.idempotencyKey,
        payload: idempotencyPayload,
      });

      if (claim.isReplay && claim.resultPayload) {
        return claim.resultPayload as RecordHearingResultResult;
      }
    }

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

    // 2. Mark hearing COMPLETED
    const nextHearingVersion = hearing.version + 1;
    await tx.hearing.update({
      where: { id: hearing.id },
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
        decisionText: decision,
        summary: input.summary?.trim() || null,
        attendance: input.attendance?.trim() || null,
        notes: input.notes?.trim() || null,
        nextDateDisposition: input.nextDateDisposition,
        recordedAt,
        revision: 1,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });

    // 4. Invalidate obsolete reminder work for the completed hearing
    await tx.jobRun.updateMany({
      where: {
        sourceType: 'Hearing',
        sourceId: hearing.id,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
      },
    });

    // 5. If adjournment next date is KNOWN, create linked next hearing & reminder outbox
    let nextHearingDTO: HearingDTO | null = null;
    if (input.nextDateDisposition === 'KNOWN' && nextDateStr) {
      const nextDateUtc = parseCalendarDateToUtc(nextDateStr);
      if (!nextDateUtc) {
        throw new SchedulingValidationError('تاريخ الجلسة القادمة غير صالح.');
      }
      const normNextTime = validateAndNormalizeHearingTime(nextTimeStr);
      const nextCourtHall = input.nextHearing?.courtHall || input.nextHearing?.locationRoom || hearing.courtHall;
      const nextPurpose = input.nextHearing?.purpose || null;
      const nextRoll = input.nextHearing?.rollNumber || hearing.rollNumber;

      const nextHearing = await tx.hearing.create({
        data: {
          proceedingId: hearing.proceedingId,
          hearingDate: nextDateUtc,
          hearingTime: normNextTime,
          courtHall: nextCourtHall,
          purpose: nextPurpose,
          rollNumber: nextRoll,
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
      await tx.jobRun.create({
        data: {
          jobType: 'REMINDER_DELIVERY',
          sourceType: 'Hearing',
          sourceId: nextHearing.id,
          scheduledAt: nextDateUtc,
          status: 'PENDING',
          deduplicationKey: `hearing_reminder_${nextHearing.id}`,
          payload: {
            hearingId: nextHearing.id,
            proceedingId: hearing.proceedingId,
            hearingDate: nextDateStr,
            hearingTime: normNextTime,
          },
        },
      });

      nextHearingDTO = mapHearingToDTO(nextHearing);
    }

    // 6. Create selected follow-up tasks
    const createdTasksDTO: TaskDTO[] = [];
    const taskIds: string[] = [];
    if (input.tasks && input.tasks.length > 0) {
      for (const t of input.tasks) {
        const trimmedTitle = t.title.trim();
        if (!trimmedTitle) {
          throw new SchedulingValidationError('عنوان المهمة لا يمكن أن يكون فارغاً.');
        }
        const taskDueDate = parseCalendarDateToUtc(t.dueDate);
        const task = await tx.task.create({
          data: {
            matterId: hearing.proceeding.matterId,
            proceedingId: hearing.proceedingId,
            hearingId: hearing.id,
            title: trimmedTitle,
            dueDate: taskDueDate,
            priority: t.priority ?? 'NORMAL',
            status: 'OPEN',
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        taskIds.push(task.id);
        createdTasksDTO.push(mapTaskToDTO(task));
      }
    }

    // 7. Optional proceeding status transition
    if (input.proceedingStatusUpdate) {
      await tx.proceeding.update({
        where: { id: hearing.proceedingId },
        data: {
          status: input.proceedingStatusUpdate,
          updatedById: actor.id,
        },
      });
    }

    // 8. Record immutable Audit Event
    await recordAuditEvent(tx, {
      userId: actor.id,
      action: 'RECORD_HEARING_RESULT',
      entityType: 'Hearing',
      entityId: hearing.id,
      changedFields: {
        decision,
        nextDateDisposition: input.nextDateDisposition,
        nextHearingId: nextHearingDTO?.id ?? null,
        createdTaskIds: taskIds,
      },
    });

    const resultDTO = mapHearingResultToDTO(hearingResult);
    const completedHearingDTO = mapHearingToDTO({
      ...hearing,
      status: 'COMPLETED',
      version: nextHearingVersion,
      results: [hearingResult],
    });

    const finalResult: RecordHearingResultResult = {
      resultId: resultDTO.id,
      result: resultDTO,
      hearing: completedHearingDTO,
      nextHearing: nextHearingDTO,
      taskIds,
      tasks: createdTasksDTO,
    };

    if (input.idempotencyKey) {
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'recordHearingResult',
        key: input.idempotencyKey,
        resultType: 'HearingResult',
        resultId: resultDTO.id,
        resultPayload: finalResult,
      });
    }

    return finalResult;
  });
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

  return await prisma.$transaction(async (tx) => {
    // 1. Find latest result for hearing
    const latestResult = await tx.hearingResult.findFirst({
      where: { hearingId: input.hearingId },
      orderBy: { revision: 'desc' },
    });

    if (!latestResult) {
      throw new NotFoundError('لا توجد نتيجة مسجلة لهذه الجلسة لتصحيحها.');
    }

    if (input.expectedVersion !== undefined && latestResult.revision !== input.expectedVersion) {
      throw new ConcurrencyConflictError('تم تعديل نتيجة الجلسة بواسطة مستخدم آخر.');
    }

    if (input.currentResultId && latestResult.id !== input.currentResultId) {
      throw new ConcurrencyConflictError('معرف النتيجة المسجلة لا يطابق أحدث نتيجة.');
    }

    // 2. Idempotency check if key provided
    if (input.idempotencyKey) {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'correctHearingResult',
        key: input.idempotencyKey,
        payload: {
          hearingId: input.hearingId,
          decision,
          reason,
          revision: latestResult.revision + 1,
        },
      });

      if (claim.isReplay && claim.resultPayload) {
        return claim.resultPayload as HearingResultDTO;
      }
    }

    // 3. Create new Revision of HearingResult preserving history
    const nextRevision = latestResult.revision + 1;
    const newResult = await tx.hearingResult.create({
      data: {
        hearingId: input.hearingId,
        decisionText: decision,
        summary: input.summary !== undefined ? input.summary?.trim() || null : latestResult.summary,
        attendance: input.attendance !== undefined ? input.attendance?.trim() || null : latestResult.attendance,
        notes: input.notes !== undefined ? input.notes?.trim() || null : latestResult.notes,
        correctionReason: reason,
        nextDateDisposition: input.nextDateDisposition ?? latestResult.nextDateDisposition,
        recordedAt: new Date(),
        revision: nextRevision,
        supersedesResultId: latestResult.id,
        createdById: actor.id,
        updatedById: actor.id,
      },
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
        decision,
      },
    });

    const dto = mapHearingResultToDTO(newResult);

    if (input.idempotencyKey) {
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'correctHearingResult',
        key: input.idempotencyKey,
        resultType: 'HearingResult',
        resultId: newResult.id,
        resultPayload: dto,
      });
    }

    return dto;
  });
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

  return await prisma.$transaction(async (tx) => {
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

    // Idempotency check
    if (input.idempotencyKey) {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'rescheduleHearing',
        key: input.idempotencyKey,
        payload: {
          hearingId: input.hearingId,
          expectedVersion: input.expectedVersion,
          newHearingDate: input.newHearingDate,
          newHearingTime: normTime,
          reason,
        },
      });

      if (claim.isReplay && claim.resultPayload) {
        return claim.resultPayload as RescheduleHearingResult;
      }
    }

    // 2. Mark original RESCHEDULED
    const updatedOriginal = await tx.hearing.update({
      where: { id: hearing.id },
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
    const replacementCourtHall = input.courtHall || input.locationRoom || hearing.courtHall;
    const replacementPurpose = input.purpose || hearing.purpose;
    const replacementRoll = input.rollNumber || hearing.rollNumber;

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

    // 5. Invalidate old reminders & create new for replacement
    await tx.jobRun.updateMany({
      where: {
        sourceType: 'Hearing',
        sourceId: hearing.id,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
      },
    });

    await tx.jobRun.create({
      data: {
        jobType: 'REMINDER_DELIVERY',
        sourceType: 'Hearing',
        sourceId: replacementHearing.id,
        scheduledAt: newDateUtc,
        status: 'PENDING',
        deduplicationKey: `hearing_reminder_${replacementHearing.id}`,
        payload: {
          hearingId: replacementHearing.id,
          proceedingId: hearing.proceedingId,
          hearingDate: input.newHearingDate,
          hearingTime: normTime,
        },
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

    if (input.idempotencyKey) {
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'rescheduleHearing',
        key: input.idempotencyKey,
        resultType: 'Hearing',
        resultId: replacementHearing.id,
        resultPayload: result,
      });
    }

    return result;
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

  return await prisma.$transaction(async (tx) => {
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

    if (input.idempotencyKey) {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'cancelHearing',
        key: input.idempotencyKey,
        payload: {
          hearingId: input.hearingId,
          expectedVersion: input.expectedVersion,
          reason,
        },
      });

      if (claim.isReplay && claim.resultPayload) {
        return claim.resultPayload as HearingDTO;
      }
    }

    // Update hearing to CANCELLED
    const cancelled = await tx.hearing.update({
      where: { id: hearing.id },
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
    await tx.jobRun.updateMany({
      where: {
        sourceType: 'Hearing',
        sourceId: hearing.id,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
      },
    });

    // Audit
    await recordAuditEvent(tx, {
      userId: actor.id,
      action: 'CANCEL_HEARING',
      entityType: 'Hearing',
      entityId: hearing.id,
      reason,
    });

    const dto = mapHearingToDTO(cancelled);

    if (input.idempotencyKey) {
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'cancelHearing',
        key: input.idempotencyKey,
        resultType: 'Hearing',
        resultId: hearing.id,
        resultPayload: dto,
      });
    }

    return dto;
  });
}

export async function getHearing(
  actor: Actor,
  hearingId: string
): Promise<HearingDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

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
      },
    },
  });

  if (!hearing) {
    throw new NotFoundError('الجلسة المطلوبة غير موجودة.');
  }

  return mapHearingToDTO(hearing);
}

export async function listHearingsForProceeding(
  actor: Actor,
  proceedingId: string
): Promise<HearingDTO[]> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  const hearings = await prisma.hearing.findMany({
    where: { proceedingId },
    include: {
      proceeding: {
        include: { court: true },
      },
      results: {
        orderBy: { revision: 'desc' },
        take: 1,
      },
    },
    orderBy: [
      { hearingDate: 'asc' },
      { id: 'asc' },
    ],
  });

  return hearings.map((h) => mapHearingToDTO(h));
}