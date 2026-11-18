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
}

export interface UpdateOfficeSettingsInput {
  officeName: string;
  lawyerName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  expectedVersion?: number;
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

export class ReferenceValidationError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.fieldErrors = fieldErrors;
  }
}