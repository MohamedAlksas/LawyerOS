import { z } from 'zod';
import { ReferenceItemType } from '@prisma/client';

export { ReferenceItemType };

export interface OfficeSettingsDTO {
  id: string;
  officeName: string;
  lawyerName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  currency: string;
  timeZone: string;
  version: number;
  updatedAt: string;
  operationVersion?: number;
}

export interface ReferenceItemDTO {
  id: string;
  type: ReferenceItemType;
  name: string;
  code?: string | null;
  circuitTypes?: string[];
  notes?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  operationVersion?: number;
}

export interface UpdateOfficeSettingsInput {
  officeName: string;
  lawyerName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface CreateReferenceItemInput {
  type: ReferenceItemType;
  name: string;
  code?: string | null;
  circuitTypes?: string[];
  notes?: string | null;
  idempotencyKey: string;
}

export interface UpdateReferenceItemInput {
  type: ReferenceItemType;
  id: string;
  expectedVersion: number;
  name: string;
  code?: string | null;
  circuitTypes?: string[];
  notes?: string | null;
  isActive: boolean;
  idempotencyKey: string;
}

export interface ListReferenceItemsParams {
  type?: ReferenceItemType;
  includeInactive?: boolean;
}

// ==========================================
// Strict Zod Schemas (.strict())
// ==========================================
export const updateOfficeSettingsSchema = z
  .object({
    officeName: z.string().trim().min(1, 'اسم المكتب مطلوب').max(200, 'اسم المكتب لا يتجاوز 200 حرف'),
    lawyerName: z.string().max(200).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    email: z.string().email('البريد الإلكتروني غير صالح').max(200).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    taxNumber: z.string().max(50).nullable().optional(),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة مطلوب لتحديث إعدادات المكتب'),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const createReferenceItemSchema = z
  .object({
    type: z.nativeEnum(ReferenceItemType, { message: 'نوع الجدول المرجعي غير صالح' }),
    name: z.string().trim().min(1, 'اسم العنصر المرجعي مطلوب').max(200, 'الاسم لا يتجاوز 200 حرف'),
    code: z.string().max(50).nullable().optional(),
    circuitTypes: z.array(z.string().max(100)).max(50, 'الحد الأقصى لأنواع الدوائر هو 50 نوعاً').optional(),
    notes: z.string().max(1000).nullable().optional(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const updateReferenceItemSchema = z
  .object({
    type: z.nativeEnum(ReferenceItemType, { message: 'نوع الجدول المرجعي غير صالح' }),
    id: z.string().uuid('معرف العنصر المرجعي غير صالح'),
    expectedVersion: z.number().int().positive('رقم النسخة المتوقعة مطلوب'),
    name: z.string().trim().min(1, 'اسم العنصر المرجعي مطلوب').max(200, 'الاسم لا يتجاوز 200 حرف'),
    code: z.string().max(50).nullable().optional(),
    circuitTypes: z.array(z.string().max(100)).max(50, 'الحد الأقصى لأنواع الدوائر هو 50 نوعاً').optional(),
    notes: z.string().max(1000).nullable().optional(),
    isActive: z.boolean(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const listReferenceItemsSchema = z
  .object({
    type: z.nativeEnum(ReferenceItemType).optional(),
    includeInactive: z.boolean().optional(),
  })
  .strict();

export function formatZodError(err: z.ZodError): { message: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.');
    if (!fieldErrors[path]) {
      fieldErrors[path] = issue.message;
    }
  }
  return {
    message: err.issues[0]?.message ?? 'بيانات غير صالحة',
    fieldErrors,
  };
}

// ==========================================
// Error Classes
// ==========================================
export class ReferenceValidationError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(message = 'تم تعديل هذا السجل بواسطة مستخدم آخر. يرجى تحديث الصفحة والمحاولة مجدداً.') {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'السجل المطلوب غير موجود.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'غير مصرح. يرجى تسجيل الدخول أولاً.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}