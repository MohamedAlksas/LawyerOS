import { z } from 'zod';
import {
  TaskPriority,
  TaskStatus,
  HearingStatus,
  DeadlineStatus,
} from '@prisma/client';
import {
  CrossMatterLinkForbiddenError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  UnauthorizedError,
} from '@/modules/matters/matter-types';
import { strictDateSchema, type ActionResult } from '@/modules/scheduling/hearing-types';
import type { DeadlineDTO } from '@/modules/scheduling/deadline-types';
import type { WorkerHealthState } from '@/modules/reminders/reminder-types';

export {
  TaskPriority,
  TaskStatus,
  HearingStatus,
  DeadlineStatus,
  CrossMatterLinkForbiddenError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  UnauthorizedError,
  type ActionResult,
};

export class ProductivityValidationError extends Error {
  fieldErrors?: Record<string, string>;

  constructor(message = 'بيانات المهمة أو الأجندة غير صالحة.', fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ProductivityValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export type AgendaView = 'today' | 'day' | 'week' | 'month' | 'list';
export type AgendaItemType = 'HEARING' | 'DEADLINE' | 'TASK';

export interface TaskItemDTO {
  id: string;
  matterId: string | null;
  matterFileCode: string | null;
  matterTitle: string | null;
  proceedingId: string | null;
  proceedingLabel: string | null;
  courtId: string | null;
  courtName: string | null;
  hearingId: string | null;
  hearingDate: string | null;
  deadlineId: string | null;
  deadlineTitle: string | null;
  title: string;
  details: string | null;
  dueDate: string | null;
  dueTime: string | null;
  timeLabel: string;
  priority: TaskPriority;
  status: TaskStatus;
  isOverdue: boolean;
  completedAt: string | null;
  completedById: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SelectableMatterOptionDTO {
  id: string;
  fileCode: string;
  title: string;
  status: string;
  proceedings: Array<{
    id: string;
    label: string;
    courtId: string;
    courtName: string;
  }>;
}

export interface AgendaHearingItemDTO {
  itemType: 'HEARING';
  id: string;
  matterId: string;
  matterFileCode: string;
  matterTitle: string;
  clientNames: string[];
  paperLocationName: string | null;
  proceedingId: string;
  proceedingLabel: string;
  courtId: string;
  courtName: string;
  circuit: string | null;
  hearingDate: string;
  hearingTime: string | null;
  timeLabel: string;
  courtHall: string | null;
  purpose: string | null;
  rollNumber: string | null;
  status: HearingStatus;
  isOverdue: boolean;
  version: number;
}

export interface AgendaDeadlineItemDTO extends DeadlineDTO {
  itemType: 'DEADLINE';
  clientNames: string[];
  paperLocationName: string | null;
}

export interface AgendaTaskItemDTO extends TaskItemDTO {
  itemType: 'TASK';
  clientNames: string[];
  paperLocationName: string | null;
}

export interface CourtConflictWarningDTO {
  date: string;
  courtIds: string[];
  courtNames: string[];
  hearingIds: string[];
  message: string;
}

export interface AgendaDTO {
  view: AgendaView;
  anchorDate: string;
  cairoToday: string;
  rangeStart: string;
  rangeEnd: string;
  hearings: AgendaHearingItemDTO[];
  timedHearings: AgendaHearingItemDTO[];
  untimedHearings: AgendaHearingItemDTO[];
  confirmedDeadlines: AgendaDeadlineItemDTO[];
  draftDeadlines: AgendaDeadlineItemDTO[];
  overdueDeadlines: AgendaDeadlineItemDTO[];
  datedTasks: AgendaTaskItemDTO[];
  overdueTasks: AgendaTaskItemDTO[];
  undatedTasks: AgendaTaskItemDTO[];
  sameDayCourtConflicts: CourtConflictWarningDTO[];
  availableCourts: Array<{ id: string; name: string }>;
}

export interface TodayOverviewDTO {
  cairoToday: string;
  cairoTodayFormatted: string;
  agenda: AgendaDTO;
  operatingAlerts: {
    draftDeadlinesCount: number;
    overdueDeadlinesCount: number;
    overdueTasksCount: number;
    sameDayCourtConflictsCount: number;
    unreadRemindersCount: number;
    failedRemindersCount: number;
    workerStatus: WorkerHealthState;
    notes: string[];
    workerStatusNote: string;
  };
  weeklySummary: {
    startDate: string;
    endDate: string;
    hearingsCount: number;
    confirmedDeadlinesCount: number;
    tasksCount: number;
  };
}

export interface CreateTaskInput {
  title: string;
  details?: string | null;
  matterId?: string | null;
  proceedingId?: string | null;
  hearingId?: string | null;
  deadlineId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  idempotencyKey: string;
}

export interface UpdateTaskInput {
  taskId: string;
  expectedVersion: number;
  title?: string;
  details?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  status?: 'OPEN' | 'IN_PROGRESS';
  idempotencyKey: string;
}

export interface CompleteTaskInput {
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface CancelTaskInput {
  taskId: string;
  expectedVersion: number;
  reason?: string | null;
  idempotencyKey: string;
}

export interface ListTasksParams {
  status?: TaskStatus;
  matterId?: string;
  deadlineId?: string;
  overdueOnly?: boolean;
  undatedOnly?: boolean;
  priority?: TaskPriority;
  includeCompleted?: boolean;
  page?: number;
  limit?: number;
}

export interface ListAgendaParams {
  view?: AgendaView;
  anchorDate?: string;
  courtId?: string;
  types?: AgendaItemType[];
  includeCompleted?: boolean;
}

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'عنوان المهمة مطلوب.').max(200, 'عنوان المهمة لا يتجاوز 200 حرف.'),
    details: z.string().trim().max(2000, 'تفاصيل المهمة لا تتجاوز 2000 حرف.').nullable().optional(),
    matterId: z.string().uuid('معرف ملف القضية غير صالح.').nullable().optional(),
    proceedingId: z.string().uuid('معرف القيد القضائي غير صالح.').nullable().optional(),
    hearingId: z.string().uuid('معرف الجلسة غير صالح.').nullable().optional(),
    deadlineId: z.string().uuid('معرف الموعد القانوني غير صالح.').nullable().optional(),
    dueDate: strictDateSchema.nullable().optional(),
    dueTime: z.string().nullable().optional(),
    priority: z.nativeEnum(TaskPriority, { message: 'أولوية المهمة غير صالحة.' }).optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    taskId: z.string().uuid('معرف المهمة غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    title: z.string().trim().min(1, 'عنوان المهمة مطلوب.').max(200, 'عنوان المهمة لا يتجاوز 200 حرف.').optional(),
    details: z.string().trim().max(2000, 'تفاصيل المهمة لا تتجاوز 2000 حرف.').nullable().optional(),
    dueDate: strictDateSchema.nullable().optional(),
    dueTime: z.string().nullable().optional(),
    priority: z.nativeEnum(TaskPriority, { message: 'أولوية المهمة غير صالحة.' }).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS'], { message: 'حالة المهمة غير صالحة للتحديث.' }).optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const completeTaskSchema = z
  .object({
    taskId: z.string().uuid('معرف المهمة غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const cancelTaskSchema = z
  .object({
    taskId: z.string().uuid('معرف المهمة غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    reason: z.string().trim().max(500, 'سبب الإلغاء لا يتجاوز 500 حرف.').nullable().optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const listTasksSchema = z
  .object({
    status: z.nativeEnum(TaskStatus).optional(),
    matterId: z.string().uuid().optional(),
    deadlineId: z.string().uuid().optional(),
    overdueOnly: z.boolean().optional(),
    undatedOnly: z.boolean().optional(),
    priority: z.nativeEnum(TaskPriority).optional(),
    includeCompleted: z.boolean().optional(),
    page: z.number().int().min(1).max(1000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export const listAgendaSchema = z
  .object({
    view: z.enum(['today', 'day', 'week', 'month', 'list']).optional().default('list'),
    anchorDate: strictDateSchema.optional(),
    courtId: z.string().uuid('معرف المحكمة غير صالح.').optional(),
    types: z.array(z.enum(['HEARING', 'DEADLINE', 'TASK'])).min(1).max(3).optional(),
    includeCompleted: z.boolean().optional().default(false),
  })
  .strict();
