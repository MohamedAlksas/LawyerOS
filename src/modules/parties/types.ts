import type { LinkableDocumentSummary } from '@/modules/documents/document-types';

export type { LinkableDocumentSummary };

export type PartyKind = 'PERSON' | 'ORGANIZATION';

export type IdentificationType =
  | 'NATIONAL_ID'
  | 'PASSPORT'
  | 'COMMERCIAL_REG'
  | 'TAX_CARD'
  | 'OTHER';

export type CommunicationChannel =
  | 'PHONE'
  | 'IN_PERSON'
  | 'WHATSAPP'
  | 'EMAIL'
  | 'OTHER';

export type PoAType =
  | 'GENERAL'
  | 'SPECIAL'
  | 'LITIGATION'
  | 'COMMERCIAL'
  | 'OTHER';

export type PoAReviewStatus =
  | 'UNREVIEWED'
  | 'VALID'
  | 'EXPIRED'
  | 'REVOKED'
  | 'DEFECTIVE';

export interface IdentityInput {
  identificationType: IdentificationType;
  number: string;
}

export interface SavePartyInput {
  id?: string;
  kind: PartyKind;
  name: string;
  primaryPhone?: string | null;
  additionalPhones?: string[];
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  identity?: IdentityInput | null;
  expectedVersion?: number;
  idempotencyKey: string;
}

export interface DuplicateWarningDTO {
  id: string;
  name: string;
  primaryPhone: string | null;
  matchType: 'NAME' | 'PHONE' | 'BOTH';
}

export interface PartySummaryDTO {
  id: string;
  kind: PartyKind;
  name: string;
  primaryPhone: string | null;
  additionalPhones: string[];
  email: string | null;
  address: string | null;
  notes: string | null;
  version: number;
  createdAt: string; // ISO string
  updatedAt: string;
  identityMask: {
    identificationType: IdentificationType;
    lastFour: string;
  } | null;
}

export interface SavePartyResult {
  success: true;
  party: PartySummaryDTO;
  duplicateWarnings: DuplicateWarningDTO[];
  isReplay?: boolean;
  operationVersion?: number;
  currentVersion?: number;
}

export interface SearchPartiesParams {
  query?: string;
  kind?: PartyKind;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
}

export interface SearchPartiesResult {
  parties: Pick<PartySummaryDTO, 'id' | 'kind' | 'name' | 'primaryPhone' | 'createdAt' | 'identityMask'>[];
  totalCount: number;
  page: number;
  totalPages: number;
}

export interface CommunicationNoteSummaryDTO {
  id: string;
  partyId: string;
  matterId: string | null;
  communicationAt: string; // ISO string
  channel: CommunicationChannel;
  summary: string;
  followUpRequired: boolean;
  followUpDate: string | null; // YYYY-MM-DD
  createdAt: string;
  createdById: string;
  isReplay?: boolean;
}

export interface AddCommunicationNoteInput {
  partyId: string;
  communicationAt: string;
  channel: CommunicationChannel;
  summary: string;
  followUpRequired?: boolean;
  followUpDate?: string | null;
  idempotencyKey: string;
}

export interface PoASummaryDTO {
  id: string;
  partyId: string;
  documentId: string | null;
  linkedDocument: LinkableDocumentSummary | null;
  poaNumberText: string;
  poaYearLabel: string;
  notarizationOffice: string;
  poaType: PoAType;
  issueDate: string | null; // YYYY-MM-DD
  humanReviewStatus: PoAReviewStatus;
  humanReviewedAt: string | null;
  humanReviewedById: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  isReplay?: boolean;
  operationVersion?: number;
  currentVersion?: number;
}

export type PowerOfAttorneyDTO = PoASummaryDTO;

export interface SavePowerOfAttorneyInput {
  id?: string;
  partyId: string;
  documentId?: string | null;
  poaNumberText: string;
  poaYearLabel: string;
  notarizationOffice: string;
  poaType: PoAType;
  issueDate?: string | null;
  humanReviewStatus?: PoAReviewStatus;
  notes?: string | null;
  expectedVersion?: number;
  idempotencyKey: string;
}

export interface ClientProfileDTO {
  id: string;
  kind: PartyKind;
  name: string;
  primaryPhone: string | null;
  additionalPhones: string[];
  email: string | null;
  address: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  identityMask: {
    identificationType: IdentificationType;
    lastFour: string;
  } | null;
  communicationNotes: CommunicationNoteSummaryDTO[];
  powersOfAttorney: PoASummaryDTO[];
}

