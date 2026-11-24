import { z } from 'zod';
import {
  JobRunStatus,
  ReminderChannel,
  ReminderDeliveryStatus,
  ReminderEventType,
} from '@prisma/client';
import {
  ConcurrencyConflictError,
  NotFoundError,
  UnauthorizedError,
  UnsupportedTransitionError,
  type ActionResult,
} from '@/modules/scheduling/hearing-types';

export {
  JobRunStatus,
  ReminderChannel,
  ReminderDeliveryStatus,
  ReminderEventType,
  ConcurrencyConflictError,
  NotFoundError,
  UnauthorizedError,
  UnsupportedTransitionError,
  type ActionResult,
};

export class ReminderValidationError extends Error {
  fieldErrors?: Record<string, string>;

  constructor(message = 'بيانات التذكير أو الإشعار غير صالحة.', fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ReminderValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export const INBOX_DELIVERY_LIMITS_NOTICE =
  'التنبيهات داخل التطبيق فقط عند فتحه وتوافر الاتصال وتشغيل عامل التذكيرات؛ ولا يضمن النظام وصول التنبيهات عند إغلاق التطبيق أو انقطاع الاتصال بالإنترنت، كما أن قراءة التنبيه لا تُغير حالة أي مهمة أو موعد قانوني.';

export type WorkerHealthState =
  | 'HEALTHY'
  | 'FAILED'
  | 'RESTORE_MODE'
  | 'STALE'
  | 'NOT_STARTED';

export interface ReminderRuleDTO {
  id: string;
  eventType: ReminderEventType;
  dayOffset: number;
  reminderTime: string;
  channel: ReminderChannel;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InboxItemDTO {
  id: string;
  sourceType: 'Hearing' | 'Deadline' | 'Task' | string;
  sourceId: string;
  sourceVersion: number;
  ruleKey: string;
  scheduledAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  isRead: boolean;
  status: ReminderDeliveryStatus;
  title: string;
  body: string;
  matterId: string | null;
  matterFileCode: string | null;
  matterTitle: string | null;
  eventDate: string | null;
  eventTime: string | null;
  timeLabel: string;
  isOverdue: boolean;
  isMissed: boolean;
  sourceStatus: string | null;
  targetHref: string | null;
  jobRunId: string | null;
}

export interface FailedReminderJobDTO {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  scheduledAt: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string;
  completedAt: string | null;
  updatedAt: string;
  sourceLabel: string;
  matterId: string | null;
  matterFileCode: string | null;
  targetHref: string | null;
}

export interface WorkerHealthDTO {
  status: WorkerHealthState;
  workerId: string | null;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  restoreMode: boolean;
  lastRefreshedAt: string;
}

export interface InboxOverviewDTO {
  cairoToday: string;
  cairoTodayFormatted: string;
  items: InboxItemDTO[];
  failedJobs: FailedReminderJobDTO[];
  rules: ReminderRuleDTO[];
  unreadCount: number;
  failedCount: number;
  overdueCount: number;
  workerHealth: WorkerHealthDTO;
  deliveryLimitsNotice: string;
}

export interface RetryReminderJobResultDTO {
  id: string;
  status: JobRunStatus;
  attemptCount: number;
  availableAt: string;
}

export interface ListInboxParams {
  unreadOnly?: boolean;
  limit?: number;
}

export interface MarkReminderReadInput {
  deliveryId: string;
  idempotencyKey?: string;
}

export interface RetryFailedReminderJobInput {
  jobRunId: string;
  idempotencyKey: string;
}

export interface UpdateReminderRuleInput {
  ruleId: string;
  expectedVersion: number;
  dayOffset?: number;
  reminderTime?: string;
  enabled?: boolean;
  idempotencyKey: string;
}

export const listInboxSchema = z
  .object({
    unreadOnly: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(100),
  })
  .strict();

export const markReminderReadSchema = z
  .object({
    deliveryId: z.string().uuid('معرف التنبيه غير صالح.'),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const retryFailedReminderJobSchema = z
  .object({
    jobRunId: z.string().uuid('معرف مهمة التذكير غير صالح.'),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const updateReminderRuleSchema = z
  .object({
    ruleId: z.string().uuid('معرف سياسة التذكير غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    dayOffset: z
      .number()
      .int('عدد الأيام يجب أن يكون رقماً صحيحاً.')
      .min(0, 'عدد الأيام لا يقل عن 0.')
      .max(365, 'عدد الأيام لا يتجاوز 365.')
      .optional(),
    reminderTime: z
      .string()
      .trim()
      .regex(/^(\d{1,2}):(\d{2})$/, 'صيغة وقت التذكير يجب أن تكون HH:mm.')
      .optional(),
    enabled: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict()
  .refine(
    (data) =>
      data.dayOffset !== undefined || data.reminderTime !== undefined || data.enabled !== undefined,
    {
      message: 'يجب تحديد حقل واحد على الأقل لتحديث سياسة التذكير.',
      path: ['input'],
    }
  );