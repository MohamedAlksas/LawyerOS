import { z } from 'zod';
import { DeadlineStatus } from '@prisma/client';
import { CrossMatterLinkForbiddenError } from '@/modules/matters/matter-types';
import {
  strictDateSchema,
  SchedulingValidationError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  ActiveObligationError,
  UnauthorizedError,
  type LinkableDocumentRow,
  type LinkableDocumentSummary,
  type ActionResult,
} from './hearing-types';

export {
  DeadlineStatus,
  CrossMatterLinkForbiddenError,
  SchedulingValidationError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
  MatterArchivedError,
  ProceedingArchivedError,
  ActiveObligationError,
  UnauthorizedError,
  type LinkableDocumentRow,
  type LinkableDocumentSummary,
  type ActionResult,
};

export interface DeadlineDTO {
  id: string;
  matterId: string;
  matterFileCode: string;
  matterTitle: string;
  proceedingId: string | null;
  proceedingLabel: string | null;
  courtId: string | null;
  courtName: string | null;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  timeLabel: string;
  source: string | null;
  basisNotes: string | null;
  sourceDocumentId: string | null;
  sourceDocument?: LinkableDocumentSummary | null;
  status: DeadlineStatus;
  isOverdue: boolean;
  needsReview: boolean;
  confirmedAt: string | null;
  confirmedById: string | null;
  confirmedByName: string | null;
  reviewedByName: string | null;
  dateChangeReason: string | null;
  completionDescription: string | null;
  completedDate: string | null;
  completedAt: string | null;
  completedById: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  pendingReminderCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeadlineInput {
  matterId: string;
  proceedingId?: string | null;
  title: string;
  dueDate?: string | null;
  dueTime?: string | null;
  source?: string | null;
  basisNotes?: string | null;
  sourceDocumentId?: string | null;
  idempotencyKey: string;
}

export interface UpdateDeadlineDraftInput {
  deadlineId: string;
  expectedVersion: number;
  proceedingId?: string | null;
  title?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  source?: string | null;
  basisNotes?: string | null;
  sourceDocumentId?: string | null;
  idempotencyKey: string;
}

export interface ConfirmDeadlineInput {
  deadlineId: string;
  expectedVersion: number;
  dueDate: string;
  dueTime?: string | null;
  source: string;
  basisNotes: string;
  sourceDocumentId?: string | null;
  lawyerReviewed?: boolean;
  confirmationAccepted?: boolean;
  idempotencyKey: string;
}

export interface ChangeDeadlineDateInput {
  deadlineId: string;
  expectedVersion: number;
  dueDate: string | null;
  dueTime?: string | null;
  reason?: string | null;
  idempotencyKey: string;
}

export interface CompleteDeadlineInput {
  deadlineId: string;
  expectedVersion: number;
  completionDescription: string;
  completionDate: string;
  evidenceDocumentId?: string | null;
  idempotencyKey: string;
}

export interface CancelDeadlineInput {
  deadlineId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
}

export interface ListDeadlinesParams {
  matterId?: string;
  proceedingId?: string;
  status?: DeadlineStatus;
  needsReviewOnly?: boolean;
  overdueOnly?: boolean;
  includeClosed?: boolean;
  page?: number;
  limit?: number;
}

export const createDeadlineSchema = z
  .object({
    matterId: z.string().uuid('معرف ملف القضية غير صالح.'),
    proceedingId: z.string().uuid('معرف القيد القضائي غير صالح.').nullable().optional(),
    title: z.string().trim().min(1, 'عنوان الموعد القانوني مطلوب.').max(250, 'عنوان الموعد لا يتجاوز 250 حرفاً.'),
    dueDate: strictDateSchema.nullable().optional(),
    dueTime: z.string().nullable().optional(),
    source: z.string().trim().max(200, 'مصدر الموعد لا يتجاوز 200 حرف.').nullable().optional(),
    basisNotes: z.string().trim().max(2000, 'سند الموعد وملاحظاته لا تتجاوز 2000 حرف.').nullable().optional(),
    sourceDocumentId: z.string().uuid('معرف المستند المصدري غير صالح.').nullable().optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const updateDeadlineDraftSchema = z
  .object({
    deadlineId: z.string().uuid('معرف الموعد القانوني غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    proceedingId: z.string().uuid('معرف القيد القضائي غير صالح.').nullable().optional(),
    title: z.string().trim().min(1, 'عنوان الموعد القانوني مطلوب.').max(250, 'عنوان الموعد لا يتجاوز 250 حرفاً.').optional(),
    dueDate: strictDateSchema.nullable().optional(),
    dueTime: z.string().nullable().optional(),
    source: z.string().trim().max(200, 'مصدر الموعد لا يتجاوز 200 حرف.').nullable().optional(),
    basisNotes: z.string().trim().max(2000, 'سند الموعد وملاحظاته لا تتجاوز 2000 حرف.').nullable().optional(),
    sourceDocumentId: z.string().uuid('معرف المستند المصدري غير صالح.').nullable().optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const confirmDeadlineSchema = z
  .object({
    deadlineId: z.string().uuid('معرف الموعد القانوني غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    dueDate: strictDateSchema,
    dueTime: z.string().nullable().optional(),
    source: z.string().trim().min(1, 'مصدر الموعد القانوني مطلوب للاعتماد.').max(200, 'مصدر الموعد لا يتجاوز 200 حرف.'),
    basisNotes: z.string().trim().min(1, 'سند الاحتساب أو ملاحظات المراجعة مطلوبة للاعتماد.').max(2000, 'سند الموعد لا يتجاوز 2000 حرف.'),
    sourceDocumentId: z.string().uuid('معرف المستند المصدري غير صالح.').nullable().optional(),
    lawyerReviewed: z.boolean().optional(),
    confirmationAccepted: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict()
  .refine((data) => data.lawyerReviewed === true || data.confirmationAccepted === true, {
    message: 'يلزم إقرار المحامي بمراجعة الموعد واعتماده («راجعت الموعد واعتمدته»).',
    path: ['confirmationAccepted'],
  });

export const changeDeadlineDateSchema = z
  .object({
    deadlineId: z.string().uuid('معرف الموعد القانوني غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    dueDate: strictDateSchema.nullable(),
    dueTime: z.string().nullable().optional(),
    reason: z.string().trim().max(500, 'سبب تعديل الموعد لا يتجاوز 500 حرف.').nullable().optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const completeDeadlineSchema = z
  .object({
    deadlineId: z.string().uuid('معرف الموعد القانوني غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    completionDescription: z.string().trim().min(1, 'وصف الإجراء التنفيذي المطلوب للإتمام إلزامي.').max(2000, 'وصف الإتمام لا يتجاوز 2000 حرف.'),
    completionDate: strictDateSchema,
    evidenceDocumentId: z.string().nullable().optional(),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const cancelDeadlineSchema = z
  .object({
    deadlineId: z.string().uuid('معرف الموعد القانوني غير صالح.'),
    expectedVersion: z.number().int().min(1, 'رقم الإصدار المتوقع غير صالح.'),
    reason: z.string().trim().min(1, 'سبب إلغاء الموعد القانوني مطلوب.').max(500, 'سبب الإلغاء لا يتجاوز 500 حرف.'),
    idempotencyKey: z.string().trim().min(1, 'مفتاح منع التكرار مطلوب.').max(128),
  })
  .strict();

export const listDeadlinesSchema = z
  .object({
    matterId: z.string().uuid().optional(),
    proceedingId: z.string().uuid().optional(),
    status: z.nativeEnum(DeadlineStatus).optional(),
    needsReviewOnly: z.boolean().optional(),
    overdueOnly: z.boolean().optional(),
    includeClosed: z.boolean().optional(),
    page: z.number().int().min(1).max(1000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();