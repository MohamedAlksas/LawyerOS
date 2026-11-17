import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '@/lib/auth';
import { Actor } from '@/modules/identity/types';
import { assertAuthorized } from '@/modules/identity/authorize';
import { normalizeArabicText, normalizePhone } from '@/lib/normalization';
import {
  encryptPartyIdentity,
  decryptPartyIdentity,
} from '@/lib/crypto/party-identity';
import { recordAuditEvent } from '@/lib/audit';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from '@/lib/idempotency';
import {
  SavePartyInput,
  SavePartyResult,
  SearchPartiesParams,
  SearchPartiesResult,
  ClientProfileDTO,
  AddCommunicationNoteInput,
  CommunicationNoteSummaryDTO,
  SavePowerOfAttorneyInput,
  PoASummaryDTO,
  PartySummaryDTO,
  DuplicateWarningDTO,
} from './types';
import {
  savePartySchema,
  addCommunicationNoteSchema,
  savePowerOfAttorneySchema,
  validateInput,
} from './validation';

export class ConcurrencyConflictError extends Error {
  constructor(message = 'تعذر حفظ التعديلات نظراً لتعديل السجل بواسطة مستخدم آخر. يرجى إعادة التحميل والمحاولة مجدداً.') {
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

export interface ServiceExecutionOptions {
  prismaOverride?: PrismaClient;
  simulateAuditFailure?: boolean;
}

function mapPartySummary(
  party: Prisma.PartyGetPayload<{ include: { identities: true } }>
): PartySummaryDTO {
  const primaryIdentity = party.identities[0];
  return {
    id: party.id,
    kind: party.kind,
    name: party.name,
    primaryPhone: party.primaryPhone,
    additionalPhones: party.additionalPhones,
    email: party.email,
    address: party.address,
    notes: party.notes,
    version: party.version,
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
    identityMask: primaryIdentity
      ? {
          identificationType: primaryIdentity.identificationType,
          lastFour: primaryIdentity.lastFour,
        }
      : null,
  };
}

/**
 * Searches for potential duplicate parties by normalized name and phone.
 * Advisory warning only — does not block party creation.
 */
export async function findDuplicateWarnings(
  prisma: PrismaClient,
  name: string,
  primaryPhone?: string | null,
  excludePartyId?: string
): Promise<DuplicateWarningDTO[]> {
  const normalizedName = normalizeArabicText(name);
  const normalizedPhone = normalizePhone(primaryPhone);

  const orConditions: Prisma.PartyWhereInput[] = [];

  if (normalizedName) {
    orConditions.push({ nameNormalized: normalizedName });
  }

  if (normalizedPhone) {
    orConditions.push({ primaryPhoneNormalized: normalizedPhone });
  }

  if (orConditions.length === 0) {
    return [];
  }

  const matches = await prisma.party.findMany({
    where: {
      archivedAt: null,
      ...(excludePartyId ? { id: { not: excludePartyId } } : {}),
      OR: orConditions,
    },
    take: 10,
  });

  return matches.map((match) => {
    const nameMatches = match.nameNormalized === normalizedName;
    const phoneMatches = Boolean(
      normalizedPhone && match.primaryPhoneNormalized === normalizedPhone
    );

    let matchType: 'NAME' | 'PHONE' | 'BOTH' = 'NAME';
    if (nameMatches && phoneMatches) {
      matchType = 'BOTH';
    } else if (phoneMatches) {
      matchType = 'PHONE';
    }

    return {
      id: match.id,
      name: match.name,
      primaryPhone: match.primaryPhone,
      matchType,
    };
  });
}

/**
 * Saves a party record (Create or Update) within an atomic transaction.
 * Enforces server authorization, optimistic version checks, AES-256-GCM context-bound identity
 * encryption, immutable audit logging, and scoped idempotency.
 */
export async function saveParty(
  actor: Actor,
  rawInput: SavePartyInput,
  options: ServiceExecutionOptions = {}
): Promise<SavePartyResult> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');
  const input = validateInput(savePartySchema, rawInput);
  const prisma = options.prismaOverride ?? getPrismaClient();

  // Find duplicate advisory warnings upfront
  const duplicateWarnings = await findDuplicateWarnings(
    prisma,
    input.name,
    input.primaryPhone,
    input.id
  );

  return await prisma.$transaction(async (tx) => {
    // 1. Claim or verify idempotency token
    const claim = await claimIdempotencyKey(tx, {
      actorId: actor.id,
      commandType: 'saveParty',
      key: input.idempotencyKey,
      payload: input,
    });

    if (claim.isReplay) {
      const cached = claim.resultPayload as {
        party: PartySummaryDTO;
        duplicateWarnings: DuplicateWarningDTO[];
      };
      return {
        success: true,
        party: cached.party,
        duplicateWarnings: cached.duplicateWarnings,
        isReplay: true,
      };
    }

    const nameNormalized = normalizeArabicText(input.name);
    const primaryPhoneNormalized = normalizePhone(input.primaryPhone);

    let targetPartyId: string;
    let resultingParty: Prisma.PartyGetPayload<{ include: { identities: true } }>;

    if (input.id) {
      // UPDATE PATH
      const existing = await tx.party.findUnique({
        where: { id: input.id, archivedAt: null },
        include: { identities: true },
      });

      if (!existing) {
        throw new NotFoundError('الطرف المطلوب تعديله غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      targetPartyId = input.id;

      // Atomic optimistic concurrency control: condition on expectedVersion in the database UPDATE
      const updateResult = await tx.party.updateMany({
        where: {
          id: input.id,
          version: input.expectedVersion,
          archivedAt: null,
        },
        data: {
          kind: input.kind,
          name: input.name,
          nameNormalized,
          primaryPhone: input.primaryPhone,
          primaryPhoneNormalized,
          additionalPhones: input.additionalPhones ?? [],
          email: input.email,
          address: input.address,
          notes: input.notes,
          version: { increment: 1 },
          updatedById: actor.id,
        },
      });

      if (updateResult.count === 0) {
        const current = await tx.party.findUnique({
          where: { id: input.id, archivedAt: null },
        });
        if (!current) {
          throw new NotFoundError('الطرف المطلوب تعديله غير موجود.');
        }
        throw new ConcurrencyConflictError();
      }

      // Handle optional identity update
      if (input.identity) {
        const encrypted = encryptPartyIdentity({
          plaintext: input.identity.number,
          partyId: targetPartyId,
          identificationType: input.identity.identificationType,
        });

        if (existing.identities.length > 0) {
          await tx.partyIdentity.update({
            where: { id: existing.identities[0].id },
            data: {
              identificationType: input.identity.identificationType,
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              authTag: encrypted.authTag,
              keyId: encrypted.keyId,
              encryptionVersion: encrypted.encryptionVersion,
              lastFour: encrypted.lastFour,
            },
          });
        } else {
          await tx.partyIdentity.create({
            data: {
              partyId: targetPartyId,
              identificationType: input.identity.identificationType,
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              authTag: encrypted.authTag,
              keyId: encrypted.keyId,
              encryptionVersion: encrypted.encryptionVersion,
              lastFour: encrypted.lastFour,
              createdById: actor.id,
            },
          });
        }
      }

      resultingParty = (await tx.party.findUniqueOrThrow({
        where: { id: targetPartyId },
        include: { identities: true },
      })) as Prisma.PartyGetPayload<{ include: { identities: true } }>;

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'UPDATE_PARTY',
          entityType: 'Party',
          entityId: targetPartyId,
          changedFields: {
            kind: input.kind,
            name: input.name,
            primaryPhone: input.primaryPhone,
            email: input.email,
            version: resultingParty.version,
            ...(input.identity
              ? {
                  identity: {
                    identificationType: input.identity.identificationType,
                    lastFour: input.identity.number.slice(-4),
                  },
                }
              : {}),
          },
        },
        { simulateFailure: options.simulateAuditFailure }
      );
    } else {
      // CREATE PATH
      const created = await tx.party.create({
        data: {
          kind: input.kind,
          name: input.name,
          nameNormalized,
          primaryPhone: input.primaryPhone,
          primaryPhoneNormalized,
          additionalPhones: input.additionalPhones ?? [],
          email: input.email,
          address: input.address,
          notes: input.notes,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });

      targetPartyId = created.id;

      if (input.identity) {
        const encrypted = encryptPartyIdentity({
          plaintext: input.identity.number,
          partyId: targetPartyId,
          identificationType: input.identity.identificationType,
        });

        await tx.partyIdentity.create({
          data: {
            partyId: targetPartyId,
            identificationType: input.identity.identificationType,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyId: encrypted.keyId,
            encryptionVersion: encrypted.encryptionVersion,
            lastFour: encrypted.lastFour,
            createdById: actor.id,
          },
        });
      }

      resultingParty = (await tx.party.findUniqueOrThrow({
        where: { id: targetPartyId },
        include: { identities: true },
      })) as Prisma.PartyGetPayload<{ include: { identities: true } }>;

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'CREATE_PARTY',
          entityType: 'Party',
          entityId: targetPartyId,
          changedFields: {
            kind: input.kind,
            name: input.name,
            primaryPhone: input.primaryPhone,
            email: input.email,
            version: 1,
            ...(input.identity
              ? {
                  identity: {
                    identificationType: input.identity.identificationType,
                    lastFour: input.identity.number.slice(-4),
                  },
                }
              : {}),
          },
        },
        { simulateFailure: options.simulateAuditFailure }
      );
    }

    const partySummary = mapPartySummary(resultingParty);

    // Complete idempotency
    await completeIdempotencyKey(tx, {
      actorId: actor.id,
      commandType: 'saveParty',
      key: input.idempotencyKey,
      resultType: 'Party',
      resultId: targetPartyId,
      resultPayload: {
        party: partySummary,
        duplicateWarnings,
      },
    });

    return {
      success: true,
      party: partySummary,
      duplicateWarnings,
    };
  });
}

/**
 * Searches active parties by normalized query across name and phone.
 * Strictly avoids searching or indexing national identity numbers.
 */
export async function searchParties(
  actor: Actor,
  params: SearchPartiesParams,
  options: ServiceExecutionOptions = {}
): Promise<SearchPartiesResult> {
  assertAuthorized(actor, 'READ_CLIENT_DATA');
  const prisma = options.prismaOverride ?? getPrismaClient();

  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.PartyWhereInput = {
    archivedAt: null,
  };

  if (params.kind) {
    where.kind = params.kind;
  }

  const rawQuery = params.query?.trim();
  if (rawQuery) {
    const textNorm = normalizeArabicText(rawQuery);
    const phoneNorm = normalizePhone(rawQuery);

    const orClauses: Prisma.PartyWhereInput[] = [];
    if (textNorm) {
      orClauses.push({ nameNormalized: { contains: textNorm } });
    }
    if (phoneNorm) {
      orClauses.push({ primaryPhoneNormalized: { contains: phoneNorm } });
    }

    if (orClauses.length > 0) {
      where.OR = orClauses;
    }
  }

  const [totalCount, records] = await Promise.all([
    prisma.party.count({ where }),
    prisma.party.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { identities: true },
    }),
  ]);

  return {
    parties: records.map(mapPartySummary),
    totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit) || 1,
  };
}

/**
 * Retrieves the full client profile including masked identity, communication notes timeline,
 * and powers of attorney list.
 */
export async function getClientProfile(
  actor: Actor,
  partyId: string,
  options: ServiceExecutionOptions = {}
): Promise<ClientProfileDTO> {
  assertAuthorized(actor, 'READ_CLIENT_DATA');
  const prisma = options.prismaOverride ?? getPrismaClient();

  const party = await prisma.party.findUnique({
    where: { id: partyId, archivedAt: null },
    include: {
      identities: true,
      communicationNotes: {
        orderBy: { communicationAt: 'desc' },
      },
      powersOfAttorney: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!party) {
    throw new NotFoundError('الطرف المطلوب غير موجود.');
  }

  const primaryIdentity = party.identities[0];

  return {
    id: party.id,
    kind: party.kind,
    name: party.name,
    primaryPhone: party.primaryPhone,
    additionalPhones: party.additionalPhones,
    email: party.email,
    address: party.address,
    notes: party.notes,
    version: party.version,
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
    identityMask: primaryIdentity
      ? {
          identificationType: primaryIdentity.identificationType,
          lastFour: primaryIdentity.lastFour,
        }
      : null,
    communicationNotes: party.communicationNotes.map((note) => ({
      id: note.id,
      partyId: note.partyId,
      matterId: note.matterId,
      communicationAt: note.communicationAt.toISOString(),
      channel: note.channel,
      summary: note.summary,
      followUpRequired: note.followUpRequired,
      followUpDate: note.followUpDate ? note.followUpDate.toISOString().slice(0, 10) : null,
      createdAt: note.createdAt.toISOString(),
      createdById: note.createdById,
    })),
    powersOfAttorney: party.powersOfAttorney.map((poa) => ({
      id: poa.id,
      partyId: poa.partyId,
      poaNumberText: poa.poaNumberText,
      poaYearLabel: poa.poaYearLabel,
      notarizationOffice: poa.notarizationOffice,
      poaType: poa.poaType,
      issueDate: poa.issueDate ? poa.issueDate.toISOString().slice(0, 10) : null,
      humanReviewStatus: poa.humanReviewStatus,
      humanReviewedAt: poa.humanReviewedAt ? poa.humanReviewedAt.toISOString() : null,
      humanReviewedById: poa.humanReviewedById,
      notes: poa.notes,
      version: poa.version,
      createdAt: poa.createdAt.toISOString(),
      updatedAt: poa.updatedAt.toISOString(),
    })),
  };
}

/**
 * Records a new communication note for a party.
 */
export async function addCommunicationNote(
  actor: Actor,
  rawInput: AddCommunicationNoteInput,
  options: ServiceExecutionOptions = {}
): Promise<CommunicationNoteSummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');
  const input = validateInput(addCommunicationNoteSchema, rawInput);
  const prisma = options.prismaOverride ?? getPrismaClient();

  return await prisma.$transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      actorId: actor.id,
      commandType: 'addCommunicationNote',
      key: input.idempotencyKey,
      payload: input,
    });

    if (claim.isReplay) {
      return claim.resultPayload as CommunicationNoteSummaryDTO;
    }

    const party = await tx.party.findUnique({
      where: { id: input.partyId, archivedAt: null },
    });

    if (!party) {
      throw new NotFoundError('الطرف المحدد لتسجيل الملاحظة غير موجود.');
    }

    const note = await tx.communicationNote.create({
      data: {
        partyId: input.partyId,
        communicationAt: new Date(input.communicationAt),
        channel: input.channel,
        summary: input.summary,
        followUpRequired: input.followUpRequired ?? false,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : null,
        createdById: actor.id,
      },
    });

    const result: CommunicationNoteSummaryDTO = {
      id: note.id,
      partyId: note.partyId,
      matterId: note.matterId,
      communicationAt: note.communicationAt.toISOString(),
      channel: note.channel,
      summary: note.summary,
      followUpRequired: note.followUpRequired,
      followUpDate: note.followUpDate ? note.followUpDate.toISOString().slice(0, 10) : null,
      createdAt: note.createdAt.toISOString(),
      createdById: note.createdById,
    };

    await recordAuditEvent(
      tx,
      {
        userId: actor.id,
        action: 'RECORD_COMMUNICATION',
        entityType: 'CommunicationNote',
        entityId: note.id,
        changedFields: {
          partyId: note.partyId,
          channel: note.channel,
          communicationAt: note.communicationAt.toISOString(),
        },
      },
      { simulateFailure: options.simulateAuditFailure }
    );

    await completeIdempotencyKey(tx, {
      actorId: actor.id,
      commandType: 'addCommunicationNote',
      key: input.idempotencyKey,
      resultType: 'CommunicationNote',
      resultId: note.id,
      resultPayload: result,
    });

    return result;
  });
}

/**
 * Saves a power of attorney record (Create or Update).
 * Preserves leading zeros in poaNumberText and manages optimistic version concurrency.
 */
export async function savePowerOfAttorney(
  actor: Actor,
  rawInput: SavePowerOfAttorneyInput,
  options: ServiceExecutionOptions = {}
): Promise<PoASummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');
  const input = validateInput(savePowerOfAttorneySchema, rawInput);
  const prisma = options.prismaOverride ?? getPrismaClient();

  return await prisma.$transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, {
      actorId: actor.id,
      commandType: 'savePowerOfAttorney',
      key: input.idempotencyKey,
      payload: input,
    });

    if (claim.isReplay) {
      return claim.resultPayload as PoASummaryDTO;
    }

    const party = await tx.party.findUnique({
      where: { id: input.partyId, archivedAt: null },
    });

    if (!party) {
      throw new NotFoundError('الطرف المحدد لإصدار التوكيل غير موجود.');
    }

    let poaRecord;

    if (input.id) {
      const existing = await tx.powerOfAttorney.findUnique({
        where: { id: input.id, partyId: input.partyId },
      });

      if (!existing) {
        throw new NotFoundError('التوكيل المطلوب تعديله غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError('تعذر تعديل التوكيل نظراً لتعديله بواسطة مستخدم آخر.');
      }

      const isStatusChanged =
        input.humanReviewStatus && input.humanReviewStatus !== existing.humanReviewStatus;

      const updateResult = await tx.powerOfAttorney.updateMany({
        where: {
          id: input.id,
          partyId: input.partyId,
          version: input.expectedVersion,
        },
        data: {
          poaNumberText: input.poaNumberText,
          poaYearLabel: input.poaYearLabel,
          notarizationOffice: input.notarizationOffice,
          poaType: input.poaType,
          issueDate: input.issueDate ? new Date(input.issueDate) : null,
          humanReviewStatus: input.humanReviewStatus ?? existing.humanReviewStatus,
          humanReviewedAt: isStatusChanged ? new Date() : existing.humanReviewedAt,
          humanReviewedById: isStatusChanged ? actor.id : existing.humanReviewedById,
          notes: input.notes,
          version: { increment: 1 },
          updatedById: actor.id,
        },
      });

      if (updateResult.count === 0) {
        const current = await tx.powerOfAttorney.findUnique({
          where: { id: input.id, partyId: input.partyId },
        });
        if (!current) {
          throw new NotFoundError('التوكيل المطلوب تعديله غير موجود.');
        }
        throw new ConcurrencyConflictError('تعذر تعديل التوكيل نظراً لتعديله بواسطة مستخدم آخر.');
      }

      poaRecord = await tx.powerOfAttorney.findUniqueOrThrow({
        where: { id: input.id },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'UPDATE_POA',
          entityType: 'PowerOfAttorney',
          entityId: poaRecord.id,
          changedFields: {
            poaNumberText: poaRecord.poaNumberText,
            poaYearLabel: poaRecord.poaYearLabel,
            humanReviewStatus: poaRecord.humanReviewStatus,
            version: poaRecord.version,
          },
        },
        { simulateFailure: options.simulateAuditFailure }
      );
    } else {
      const isReviewed = input.humanReviewStatus && input.humanReviewStatus !== 'UNREVIEWED';

      poaRecord = await tx.powerOfAttorney.create({
        data: {
          partyId: input.partyId,
          poaNumberText: input.poaNumberText,
          poaYearLabel: input.poaYearLabel,
          notarizationOffice: input.notarizationOffice,
          poaType: input.poaType,
          issueDate: input.issueDate ? new Date(input.issueDate) : null,
          humanReviewStatus: input.humanReviewStatus ?? 'UNREVIEWED',
          humanReviewedAt: isReviewed ? new Date() : null,
          humanReviewedById: isReviewed ? actor.id : null,
          notes: input.notes,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });

      await recordAuditEvent(
        tx,
        {
          userId: actor.id,
          action: 'RECORD_POA',
          entityType: 'PowerOfAttorney',
          entityId: poaRecord.id,
          changedFields: {
            poaNumberText: poaRecord.poaNumberText,
            poaYearLabel: poaRecord.poaYearLabel,
            humanReviewStatus: poaRecord.humanReviewStatus,
            version: 1,
          },
        },
        { simulateFailure: options.simulateAuditFailure }
      );
    }

    const result: PoASummaryDTO = {
      id: poaRecord.id,
      partyId: poaRecord.partyId,
      poaNumberText: poaRecord.poaNumberText,
      poaYearLabel: poaRecord.poaYearLabel,
      notarizationOffice: poaRecord.notarizationOffice,
      poaType: poaRecord.poaType,
      issueDate: poaRecord.issueDate ? poaRecord.issueDate.toISOString().slice(0, 10) : null,
      humanReviewStatus: poaRecord.humanReviewStatus,
      humanReviewedAt: poaRecord.humanReviewedAt ? poaRecord.humanReviewedAt.toISOString() : null,
      humanReviewedById: poaRecord.humanReviewedById,
      notes: poaRecord.notes,
      version: poaRecord.version,
      createdAt: poaRecord.createdAt.toISOString(),
      updatedAt: poaRecord.updatedAt.toISOString(),
    };

    await completeIdempotencyKey(tx, {
      actorId: actor.id,
      commandType: 'savePowerOfAttorney',
      key: input.idempotencyKey,
      resultType: 'PowerOfAttorney',
      resultId: poaRecord.id,
      resultPayload: result,
    });

    return result;
  });
}

/**
 * Authoritative, audited revelation of party identity number.
 * Decrypts identity number via context-bound AES-256-GCM.
 * Emits an immutable audit event recording the viewing actor and reason.
 */
export async function revealPartyIdentity(
  actor: Actor,
  partyId: string,
  reason?: string,
  options: ServiceExecutionOptions = {}
): Promise<{ identificationType: string; number: string }> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA'); // Requires full OWNER permission
  const prisma = options.prismaOverride ?? getPrismaClient();

  const party = await prisma.party.findUnique({
    where: { id: partyId, archivedAt: null },
    include: { identities: true },
  });

  if (!party || party.identities.length === 0) {
    throw new NotFoundError('لا توجد بيانات هوية مسجلة لهذا الطرف.');
  }

  const identity = party.identities[0];

  const decryptedNumber = decryptPartyIdentity({
    ciphertext: identity.ciphertext,
    iv: identity.iv,
    authTag: identity.authTag,
    partyId: party.id,
    identificationType: identity.identificationType,
    keyId: identity.keyId,
    encryptionVersion: identity.encryptionVersion,
  });

  await recordAuditEvent(
    prisma,
    {
      userId: actor.id,
      action: 'REVEAL_IDENTITY',
      entityType: 'PartyIdentity',
      entityId: identity.id,
      changedFields: {
        partyId: party.id,
        identificationType: identity.identificationType,
        lastFour: identity.lastFour,
      },
      reason: reason ?? 'Authoritative identity view',
    },
    { simulateFailure: options.simulateAuditFailure }
  );

  return {
    identificationType: identity.identificationType,
    number: decryptedNumber,
  };
}

