import { z } from 'zod';
import {
  HearingStatus,
  NextDateDisposition,
  HearingLinkRelation,
  TaskPriority,
  TaskStatus,
  JobType,
  JobRunStatus,
  ProceedingStatus,
} from '@prisma/client';
import {
  validateStrictCalendarDate,
  parseCalendarDateToUtc,
  strictDateSchema,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  ActiveObligationError,
  UnauthorizedError,
} from '@/modules/matters/matter-types';

export {
  HearingStatus,
  NextDateDisposition,
  HearingLinkRelation,
  TaskPriority,
  TaskStatus,
  JobType,
  JobRunStatus,
  ProceedingStatus,
  validateStrictCalendarDate,
  parseCalendarDateToUtc,
  strictDateSchema,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  ActiveObligationError,
  UnauthorizedError,
};

export class SchedulingValidationError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message = 'بيانات الجلسة غير صالحة.', fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'SchedulingValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Validates and normalizes hearing time string (e.g. "10:30", "9:00").
 * Returns normalized "HH:mm" or null.
 * Rejects invalid hours (0-23) or minutes (0-59).
 */
export function validateAndNormalizeHearingTime(val: string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const trimmed = val.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new SchedulingValidationError('صيغة وقت الجلسة غير صالحة (يجب أن تكون بصيغة HH:mm مثل 10:30).', {
      hearingTime: 'صيغة الوقت يجب أن تكون بالساعات والدقائق HH:mm',
    });
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new SchedulingValidationError('قيمة وقت الجلسة غير صالحة (الساعات 00-23 والدقائق 00-59).', {
      hearingTime: 'قيمة الوقت خارج النطاق المسموح',
    });
  }

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export interface HearingDTO {
  id: string;
  proceedingId: string;
  matterId: string;
  courtName?: string | null;
  circuit?: string | null;
  hearingDate: string; // YYYY-MM-DD
  hearingTime?: string | null; // HH:mm
  courtHall?: string | null;
  locationRoom?: string | null; // alias for courtHall
  purpose?: string | null;
  rollNumber?: string | null;
  status: HearingStatus;
  version: number;
  rescheduleReason?: string | null;
  cancellationReason?: string | null;
  supersedesHearingId?: string | null;
  duplicateDateWarning?: boolean;
  nextHearing?: { id: string; hearingDate: string; hearingTime: string | null };
  followUpTasks?: TaskDTO[];
  latestResult?: HearingResultSummaryDTO | null;
  createdAt: string;
  updatedAt: string;
}

export interface HearingResultDTO {
  id: string;
  hearingId: string;
  courtDecision: string;
  decisionText: string; // alias
  decision: string; // alias
  summary?: string | null;
  attendance?: string | null;
  notes?: string | null;
  correctionReason?: string | null;
  nextDateDisposition: NextDateDisposition;
  recordedAt: string;
  revision: number;
  supersedesResultId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HearingResultSummaryDTO {
  id: string;
  courtDecision: string;
  decisionText: string; // alias
  summary?: string | null;
  attendance?: string | null;
  notes?: string | null;
  correctionReason?: string | null;
  nextDateDisposition: NextDateDisposition;
  recordedAt: string;
  revision: number;
}

export interface TaskDTO {
  id: string;
  matterId: string | null;
  proceedingId?: string | null;
  hearingId?: string | null;
  title: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleHearingInput {
  proceedingId: string;
  hearingDate: string; // YYYY-MM-DD
  hearingTime?: string | null;
  courtHall?: string | null;
  locationRoom?: string | null;
  purpose?: string | null;
  hearingPurpose?: string | null;
  rollNumber?: string | null;
  courtName?: string | null;
  circuit?: string | null;
  idempotencyKey?: string;
}

export interface RecordHearingResultTaskInput {
  title: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
}

export interface RecordHearingResultNextHearingInput {
  hearingDate: string;
  hearingTime?: string | null;
  courtHall?: string | null;
  locationRoom?: string | null;
  courtName?: string | null;
  circuit?: string | null;
  purpose?: string | null;
  rollNumber?: string | null;
}

export interface RecordHearingResultInput {
  hearingId: string;
  expectedVersion: number;
  decision?: string;
  decisionText?: string;
  courtDecision?: string;
  summary?: string | null;
  attendance?: string | null;
  notes?: string | null;
  nextDateDisposition: NextDateDisposition;
  nextHearing?: RecordHearingResultNextHearingInput | null;
  nextHearingDate?: string | null;
  nextHearingTime?: string | null;
  tasks?: RecordHearingResultTaskInput[];
  decisionDocumentId?: string | null;
  proceedingStatusUpdate?: ProceedingStatus | null;
  idempotencyKey?: string;
}

export interface RecordHearingResultResult {
  resultId: string;
  result: HearingResultDTO;
  hearing: HearingDTO;
  nextHearing?: HearingDTO | null;
  taskIds: string[];
  tasks?: TaskDTO[];
}

export interface RescheduleHearingInput {
  hearingId: string;
  expectedVersion: number;
  newHearingDate: string;
  newHearingTime?: string | null;
  reason: string;
  courtHall?: string | null;
  locationRoom?: string | null;
  courtName?: string | null;
  circuit?: string | null;
  purpose?: string | null;
  rollNumber?: string | null;
  taskChanges?: { taskId: string; expectedVersion: number; dueDate: string | null }[];
  idempotencyKey?: string;
}

export interface RescheduleHearingResult {
  originalHearing: HearingDTO;
  replacementHearing: HearingDTO;
  newHearing: HearingDTO;
}

export interface CancelHearingInput {
  hearingId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey?: string;
}

export interface CorrectHearingResultInput {
  hearingId: string;
  expectedVersion?: number;
  currentResultId?: string;
  reason?: string;
  correctionReason?: string;
  decision?: string;
  decisionText?: string;
  courtDecision?: string;
  summary?: string | null;
  attendance?: string | null;
  notes?: string | null;
  nextDateDisposition?: NextDateDisposition;
  nextHearingDate?: string | null;
  nextHearingTime?: string | null;
  idempotencyKey?: string;
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; fieldErrors?: Record<string, string> };

// Zod Validation Schemas
export const scheduleHearingSchema = z.object({
  proceedingId: z.string().uuid('معرف القيد القضائي غير صالح'),
  hearingDate: strictDateSchema,
  hearingTime: z.string().nullable().optional(),
  courtHall: z.string().trim().max(100, 'اسم القاعة لا يتجاوز 100 حرف').nullable().optional(),
  locationRoom: z.string().trim().max(100, 'اسم القاعة لا يتجاوز 100 حرف').nullable().optional(),
  purpose: z.string().trim().max(200, 'الغرض من الجلسة لا يتجاوز 200 حرف').nullable().optional(),
  hearingPurpose: z.string().trim().max(200, 'الغرض من الجلسة لا يتجاوز 200 حرف').nullable().optional(),
  rollNumber: z.string().trim().max(50, 'رقم الرول لا يتجاوز 50 حرف').nullable().optional(),
  courtName: z.string().nullable().optional(),
  circuit: z.string().nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(100),
}).strict();

export const recordHearingResultTaskSchema = z.object({
  title: z.string().trim().min(1, 'عنوان المهمة مطلوب').max(200, 'عنوان المهمة لا يتجاوز 200 حرف'),
  dueDate: strictDateSchema.nullable().optional(),
  dueTime: z.string().nullable().optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
}).strict();

export const recordHearingResultNextHearingSchema = z.object({
  hearingDate: strictDateSchema,
  hearingTime: z.string().nullable().optional(),
  courtHall: z.string().trim().max(100).nullable().optional(),
  locationRoom: z.string().trim().max(100).nullable().optional(),
  courtName: z.string().nullable().optional(),
  circuit: z.string().nullable().optional(),
  purpose: z.string().trim().max(200).nullable().optional(),
  rollNumber: z.string().trim().max(50).nullable().optional(),
}).strict();

export const recordHearingResultSchema = z.object({
  hearingId: z.string().uuid('معرف الجلسة غير صالح'),
  expectedVersion: z.number().int().min(1, 'رقم الإصدار غير صالح'),
  decision: z.string().trim().optional(),
  decisionText: z.string().trim().optional(),
  courtDecision: z.string().trim().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  attendance: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  nextDateDisposition: z.nativeEnum(NextDateDisposition, { message: 'موقف الموعد القادم غير صالح' }),
  nextHearing: recordHearingResultNextHearingSchema.nullable().optional(),
  nextHearingDate: strictDateSchema.nullable().optional(),
  nextHearingTime: z.string().nullable().optional(),
  tasks: z.array(recordHearingResultTaskSchema).max(50, 'الحد الأقصى لمهام المتابعة في الجلسة الواحدة 50 مهمة').optional(),
  proceedingStatusUpdate: z.null().optional(),
  idempotencyKey: z.string().trim().min(1).max(100),
}).strict().refine(data => {
  const dec = (data.decision || data.decisionText || data.courtDecision || '').trim();
  return dec.length > 0;
}, {
  message: 'منطوق قرار المحكمة مطلوب ولا يمكن أن يكون فارغاً',
  path: ['courtDecision'],
});

export const rescheduleHearingSchema = z.object({
  hearingId: z.string().uuid('معرف الجلسة غير صالح'),
  expectedVersion: z.number().int().min(1, 'رقم الإصدار غير صالح'),
  newHearingDate: strictDateSchema,
  newHearingTime: z.string().nullable().optional(),
  reason: z.string().trim().min(1, 'سبب إعادة الجدولة مطلوب').max(500, 'السبب لا يتجاوز 500 حرف'),
  courtHall: z.string().trim().max(100).nullable().optional(),
  locationRoom: z.string().trim().max(100).nullable().optional(),
  courtName: z.string().nullable().optional(),
  circuit: z.string().nullable().optional(),
  purpose: z.string().trim().max(200).nullable().optional(),
  rollNumber: z.string().trim().max(50).nullable().optional(),
  taskChanges: z
    .array(
      z
        .object({
          taskId: z.uuid(),
          expectedVersion: z.number().int().min(1),
          dueDate: strictDateSchema.nullable(),
        })
        .strict()
    )
    .max(50)
    .refine((items) => new Set(items.map((item) => item.taskId)).size === items.length, {
      message: 'لا يمكن تكرار نفس المهمة في طلب تعديل موعد الجلسة.',
    })
    .optional(),
  idempotencyKey: z.string().trim().min(1).max(100),
}).strict();

export const cancelHearingSchema = z.object({
  hearingId: z.string().uuid('معرف الجلسة غير صالح'),
  expectedVersion: z.number().int().min(1, 'رقم الإصدار غير صالح'),
  reason: z.string().trim().min(1, 'سبب الإلغاء مطلوب').max(500, 'السبب لا يتجاوز 500 حرف'),
  idempotencyKey: z.string().trim().min(1).max(100),
}).strict();

export const correctHearingResultSchema = z.object({
  hearingId: z.string().uuid('معرف الجلسة غير صالح'),
  expectedVersion: z.number().int().min(1).optional(),
  currentResultId: z.string().uuid().optional(),
  reason: z.string().trim().optional(),
  correctionReason: z.string().trim().optional(),
  decision: z.string().trim().optional(),
  decisionText: z.string().trim().optional(),
  courtDecision: z.string().trim().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  attendance: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  nextDateDisposition: z.nativeEnum(NextDateDisposition).optional(),
  nextHearingDate: strictDateSchema.nullable().optional(),
  nextHearingTime: z.string().nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(100),
}).strict()
.refine(data => data.expectedVersion !== undefined || Boolean(data.currentResultId), {
  message: 'يلزم تحديد إصدار النتيجة المعروضة قبل التصحيح', path: ['expectedVersion'],
})
.refine(data => {
  const reason = (data.reason || data.correctionReason || '').trim();
  return reason.length > 0;
}, {
  message: 'سبب تصويب القرار مطلوب',
  path: ['reason'],
})
.refine(data => {
  const dec = (data.decision || data.decisionText || data.courtDecision || '').trim();
  return dec.length > 0;
}, {
  message: 'منطوق القرار المصوب مطلوب',
  path: ['decision'],
});
