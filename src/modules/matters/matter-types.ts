import {
  MatterKind,
  MatterStatus,
  MatterPartyRole,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
} from '@prisma/client';

export {
  MatterKind,
  MatterStatus,
  MatterPartyRole,
  ProceedingInstance,
  ProceedingStatus,
  ProceedingLegalCapacity,
};

export interface MatterPartySummaryDTO {
  id: string;
  matterId: string;
  partyId: string;
  partyName: string;
  role: MatterPartyRole;
  isPrimaryContact: boolean;
  billingEnabled: boolean;
  notes?: string | null;
  version: number;
  createdAt: string;
}

export interface ProceedingPartySummaryDTO {
  id: string;
  proceedingId: string;
  matterPartyId: string;
  partyName: string;
  legalCapacity: ProceedingLegalCapacity;
  notes?: string | null;
}

export interface ProceedingSummaryDTO {
  id: string;
  matterId: string;
  courtId: string;
  courtName: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  parentProceedingSummary?: string | null;
  registerType?: string | null;
  circuit?: string | null;
  numberText?: string | null;
  yearLabel?: string | null;
  filingDate?: string | null;
  claimAmount?: string | null;
  status: ProceedingStatus;
  version: number;
  createdAt: string;
  parties?: ProceedingPartySummaryDTO[];
}

export interface MatterAuthorizationSummaryDTO {
  id: string;
  matterId: string;
  powerOfAttorneyId: string;
  poaNumberText: string;
  poaYearLabel: string;
  notarizationOffice: string;
  poaType: string;
  humanReviewStatus: string;
  partyId: string;
  partyName: string;
  createdAt: string;
}

export interface MatterDTO {
  id: string;
  fileCode: string;
  title: string;
  kind: MatterKind;
  status: MatterStatus;
  practiceAreaId?: string | null;
  practiceAreaName?: string | null;
  openingDate?: string | null;
  closingDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  paperLocationId?: string | null;
  paperLocationName?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  parties?: MatterPartySummaryDTO[];
  proceedings?: ProceedingSummaryDTO[];
  authorizations?: MatterAuthorizationSummaryDTO[];
}

export interface OpenMatterInput {
  title: string;
  kind: MatterKind;
  status?: MatterStatus;
  practiceAreaId?: string | null;
  openingDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  paperLocationId?: string | null;
  initialClientId?: string | null;
  idempotencyKey: string;
}

export interface OpenMatterResult {
  matter: MatterDTO;
  fileCode: string;
  operationVersion: number;
}

export interface UpdateMatterInput {
  id: string;
  expectedVersion: number;
  title: string;
  kind: MatterKind;
  status: MatterStatus;
  practiceAreaId?: string | null;
  openingDate?: string | null;
  closingDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  paperLocationId?: string | null;
  idempotencyKey: string;
}

export interface UpdateMatterResult {
  matter: MatterDTO;
  operationVersion: number;
}

export interface LinkMatterPartyInput {
  matterId: string;
  partyId: string;
  role: MatterPartyRole;
  isPrimaryContact?: boolean;
  billingEnabled?: boolean;
  notes?: string | null;
  idempotencyKey: string;
}

export interface UpdateMatterPartyInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  role: MatterPartyRole;
  isPrimaryContact?: boolean;
  billingEnabled?: boolean;
  notes?: string | null;
  idempotencyKey: string;
}

export interface UnlinkMatterPartyInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface AddProceedingInput {
  matterId: string;
  courtId: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  registerType?: string | null;
  circuit?: string | null;
  numberText?: string | null;
  yearLabel?: string | null;
  filingDate?: string | null;
  claimAmount?: string | null;
  status?: ProceedingStatus;
  idempotencyKey: string;
}

export interface UpdateProceedingInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  courtId: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  registerType?: string | null;
  circuit?: string | null;
  numberText?: string | null;
  yearLabel?: string | null;
  filingDate?: string | null;
  claimAmount?: string | null;
  status: ProceedingStatus;
  idempotencyKey: string;
}

export interface LinkProceedingPartyInput {
  proceedingId: string;
  matterPartyId: string;
  legalCapacity: ProceedingLegalCapacity;
  notes?: string | null;
  idempotencyKey: string;
}

export interface UnlinkProceedingPartyInput {
  id: string;
  proceedingId: string;
  idempotencyKey: string;
}

export interface LinkMatterAuthorizationInput {
  matterId: string;
  powerOfAttorneyId: string;
  idempotencyKey: string;
}

export interface UnlinkMatterAuthorizationInput {
  id: string;
  matterId: string;
  idempotencyKey: string;
}

export interface SearchMattersParams {
  query?: string;
  kind?: MatterKind;
  status?: MatterStatus;
  clientId?: string;
  courtId?: string;
  practiceAreaId?: string;
  limit?: number;
  offset?: number;
}

export interface SearchMattersResult {
  matters: MatterDTO[];
  total: number;
}

// Error classes
export class MatterValidationError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'MatterValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class LastClientRequiredError extends Error {
  constructor(message = 'لا يمكن إلغاء أو تغيير صفة الموكل الأخير في ملف نشط.') {
    super(message);
    this.name = 'LastClientRequiredError';
  }
}

export class PrimaryContactConflictError extends Error {
  constructor(message = 'يوجد بالفعل جهة اتصال رئيسية محددة لهذا الملف.') {
    super(message);
    this.name = 'PrimaryContactConflictError';
  }
}

export class CrossMatterLinkForbiddenError extends Error {
  constructor(message = 'لا يمكن ربط قيد قضائي بقيد تابع لملف آخر.') {
    super(message);
    this.name = 'CrossMatterLinkForbiddenError';
  }
}

export class ProceedingCycleDetectedError extends Error {
  constructor(message = 'تعذر حفظ القيد: تم اكتشاف حلقة تسلسل غير صالحة في درجات التقاضي.') {
    super(message);
    this.name = 'ProceedingCycleDetectedError';
  }
}

export class ClientPoaDependencyError extends Error {
  constructor(message = 'لا يمكن إزالة صفة الموكل لوجود توكيلات مرتبطة بهذا الملف.') {
    super(message);
    this.name = 'ClientPoaDependencyError';
  }
}

export class InactiveReferenceSelectedError extends Error {
  constructor(message = 'العنصر المرجعي المختار غير نشط ولا يمكن استخدامه لقيود جديدة.') {
    super(message);
    this.name = 'InactiveReferenceSelectedError';
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

export class UnsupportedTransitionError extends Error {
  constructor(message = 'الانتقال إلى هذه الحالة غير مدعوم في هذا الإصدار.') {
    super(message);
    this.name = 'UnsupportedTransitionError';
  }
}