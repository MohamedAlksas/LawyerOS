import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/lib/auth';
import { Actor } from '@/modules/identity/types';
import { assertAuthorized } from '@/modules/identity/authorize';
import { recordAuditEvent } from '@/lib/audit';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  resolveConcurrentIdempotency,
  isIdempotencyUniqueConflict,
} from '@/lib/idempotency';
import { allocateFileCode } from './file-code-allocator';
import {
  MatterDTO,
  MatterPartySummaryDTO,
  ProceedingSummaryDTO,
  ProceedingPartySummaryDTO,
  MatterAuthorizationSummaryDTO,
  OpenMatterInput,
  OpenMatterResult,
  UpdateMatterInput,
  UpdateMatterResult,
  LinkMatterPartyInput,
  UpdateMatterPartyInput,
  UnlinkMatterPartyInput,
  AddProceedingInput,
  UpdateProceedingInput,
  LinkProceedingPartyInput,
  UnlinkProceedingPartyInput,
  LinkMatterAuthorizationInput,
  UnlinkMatterAuthorizationInput,
  SearchMattersParams,
  SearchMattersResult,
  MatterValidationError,
  LastClientRequiredError,
  PrimaryContactConflictError,
  CrossMatterLinkForbiddenError,
  ProceedingCycleDetectedError,
  ClientPoaDependencyError,
  InactiveReferenceSelectedError,
  ConcurrencyConflictError,
  NotFoundError,
  UnsupportedTransitionError,
} from './matter-types';

/**
 * Validates that an optional referenced item is active for assignment.
 */
async function assertActiveReference(
  tx: Prisma.TransactionClient,
  opts: {
    practiceAreaId?: string | null;
    paperLocationId?: string | null;
    courtId?: string | null;
  }
): Promise<void> {
  if (opts.practiceAreaId) {
    const area = await tx.practiceArea.findUnique({
      where: { id: opts.practiceAreaId },
      select: { isActive: true },
    });
    if (!area || !area.isActive) {
      throw new InactiveReferenceSelectedError('دائرة التخصص القانوني المحددة غير نشطة.');
    }
  }

  if (opts.paperLocationId) {
    const loc = await tx.storageLocation.findUnique({
      where: { id: opts.paperLocationId },
      select: { isActive: true },
    });
    if (!loc || !loc.isActive) {
      throw new InactiveReferenceSelectedError('مكان الحفظ الورقي المحدد غير نشط.');
    }
  }

  if (opts.courtId) {
    const court = await tx.court.findUnique({
      where: { id: opts.courtId },
      select: { isActive: true },
    });
    if (!court || !court.isActive) {
      throw new InactiveReferenceSelectedError('المحكمة المحددة غير نشطة.');
    }
  }
}

/**
 * Validates that parent proceeding does not form cycles and belongs to the same matter.
 */
async function assertNoProceedingCycle(
  tx: Prisma.TransactionClient,
  childId: string | null,
  parentId: string | null,
  matterId: string
): Promise<void> {
  if (!parentId) return;

  if (childId && childId === parentId) {
    throw new ProceedingCycleDetectedError('لا يمكن ربط القيد القضائي بنفسه.');
  }

  // Lock parent and child in deterministic order to prevent deadlocks (T06-05)
  const idsToLock = childId ? [childId, parentId].sort() : [parentId];
  for (const id of idsToLock) {
    await tx.$executeRaw`SELECT id FROM proceeding WHERE id = ${id} FOR UPDATE`;
  }

  const parent = await tx.proceeding.findUnique({
    where: { id: parentId },
    select: { id: true, matterId: true, parentProceedingId: true },
  });

  if (!parent) {
    throw new NotFoundError('القيد القضائي الأصلي غير موجود.');
  }

  if (parent.matterId !== matterId) {
    throw new CrossMatterLinkForbiddenError('لا يمكن ربط قيد قضائي بقيد تابع لملف آخر.');
  }

  // Traverse ancestor chain to prevent cycles
  let currentParentId: string | null = parent.parentProceedingId;
  const visited = new Set<string>([parentId]);
  if (childId) visited.add(childId);

  let depth = 0;
  while (currentParentId && depth < 25) {
    depth++;
    if (childId && currentParentId === childId) {
      throw new ProceedingCycleDetectedError();
    }
    if (visited.has(currentParentId)) {
      throw new ProceedingCycleDetectedError();
    }
    visited.add(currentParentId);

    const ancestor = await tx.proceeding.findUnique({
      where: { id: currentParentId },
      select: { parentProceedingId: true },
    });
    currentParentId = ancestor?.parentProceedingId ?? null;
  }
}

type MatterWithRelations = Prisma.MatterGetPayload<{
  include: {
    practiceArea: true;
    paperLocation: true;
    parties: { include: { party: true } };
    proceedings: {
      include: {
        court: true;
        parentProceeding: { include: { court: true } };
        parties: { include: { matterParty: { include: { party: true } } } };
      };
    };
    authorizations: { include: { powerOfAttorney: { include: { party: true } } } };
  };
}>;

/**
 * Maps raw database Matter entity to standard MatterDTO.
 */
function mapMatterToDTO(raw: MatterWithRelations): MatterDTO {
  return {
    id: raw.id,
    fileCode: raw.fileCode,
    title: raw.title,
    kind: raw.kind,
    status: raw.status,
    practiceAreaId: raw.practiceAreaId ?? null,
    practiceAreaName: raw.practiceArea?.name ?? null,
    openingDate: raw.openingDate ? raw.openingDate.toISOString().slice(0, 10) : null,
    closingDate: raw.closingDate ? raw.closingDate.toISOString().slice(0, 10) : null,
    summary: raw.summary ?? null,
    notes: raw.notes ?? null,
    paperLocationId: raw.paperLocationId ?? null,
    paperLocationName: raw.paperLocation?.name ?? null,
    version: raw.version,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
    parties: raw.parties?.map((p) => ({
      id: p.id,
      matterId: p.matterId,
      partyId: p.partyId,
      partyName: p.party?.name ?? '',
      role: p.role,
      isPrimaryContact: p.isPrimaryContact,
      billingEnabled: p.billingEnabled,
      notes: p.notes ?? null,
      version: p.version,
      createdAt: p.createdAt.toISOString(),
    })),
    proceedings: raw.proceedings?.map((pr) => ({
      id: pr.id,
      matterId: pr.matterId,
      courtId: pr.courtId,
      courtName: pr.court?.name ?? '',
      instance: pr.instance,
      parentProceedingId: pr.parentProceedingId ?? null,
      parentProceedingSummary: pr.parentProceeding ? `${pr.parentProceeding.court?.name ?? ''} - ${pr.parentProceeding.numberText ?? ''}/${pr.parentProceeding.yearLabel ?? ''}` : null,
      registerType: pr.registerType ?? null,
      circuit: pr.circuit ?? null,
      numberText: pr.numberText ?? null,
      yearLabel: pr.yearLabel ?? null,
      filingDate: pr.filingDate ? pr.filingDate.toISOString().slice(0, 10) : null,
      claimAmount: pr.claimAmount ?? null,
      status: pr.status,
      version: pr.version,
      createdAt: pr.createdAt.toISOString(),
      parties: pr.parties?.map((pp) => ({
        id: pp.id,
        proceedingId: pp.proceedingId,
        matterPartyId: pp.matterPartyId,
        partyName: pp.matterParty?.party?.name ?? '',
        legalCapacity: pp.legalCapacity,
        notes: pp.notes ?? null,
      })),
    })),
    authorizations: raw.authorizations?.map((a) => ({
      id: a.id,
      matterId: a.matterId,
      powerOfAttorneyId: a.powerOfAttorneyId,
      poaNumberText: a.powerOfAttorney?.poaNumberText ?? '',
      poaYearLabel: a.powerOfAttorney?.poaYearLabel ?? '',
      notarizationOffice: a.powerOfAttorney?.notarizationOffice ?? '',
      poaType: a.powerOfAttorney?.poaType ?? '',
      humanReviewStatus: a.powerOfAttorney?.humanReviewStatus ?? '',
      partyId: a.powerOfAttorney?.partyId ?? '',
      partyName: a.powerOfAttorney?.party?.name ?? '',
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function openMatter(
  actor: Actor,
  input: OpenMatterInput
): Promise<OpenMatterResult> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  if (!input.title || input.title.trim().length === 0) {
    throw new MatterValidationError('عنوان الملف مطلوب.', { title: 'عنوان الملف مطلوب.' });
  }
  if (input.title.length > 255) {
    throw new MatterValidationError('عنوان الملف لا يجب أن يتجاوز 255 حرفاً.', { title: 'العنوان طويل جداً.' });
  }

  const targetStatus = input.status ?? 'DRAFT';
  if (targetStatus === 'ACTIVE' && !input.initialClientId) {
    throw new LastClientRequiredError('لا يمكن فتح ملف نشط دون تحديد موكل أساسي على الأقل.');
  }

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Idempotency claim
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'openMatter',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as OpenMatterResult;
      }

      // 2. Validate references
      await assertActiveReference(tx, {
        practiceAreaId: input.practiceAreaId,
        paperLocationId: input.paperLocationId,
      });

      // 3. Validate initial client if provided
      if (input.initialClientId) {
        const party = await tx.party.findUnique({
          where: { id: input.initialClientId },
          select: { id: true, archivedAt: true },
        });
        if (!party || party.archivedAt !== null) {
          throw new MatterValidationError('الموكل المحدد غير موجود أو مؤرشف.');
        }
      }

      // 4. Atomically allocate fileCode (Cairo year sequence with SELECT ... FOR UPDATE)
      const fileCode = await allocateFileCode(tx);

      // Parse openingDate
      let openingDateVal: Date | null = null;
      if (input.openingDate) {
        const parts = input.openingDate.split('-');
        if (parts.length === 3) {
          openingDateVal = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        }
      }

      // 5. Create Matter
      const matter = await tx.matter.create({
        data: {
          fileCode,
          title: input.title.trim(),
          kind: input.kind,
          status: targetStatus,
          practiceAreaId: input.practiceAreaId ?? null,
          openingDate: openingDateVal,
          summary: input.summary?.trim() ?? null,
          notes: input.notes?.trim() ?? null,
          paperLocationId: input.paperLocationId ?? null,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });

      // 6. Link initial client if provided
      if (input.initialClientId) {
        await tx.matterParty.create({
          data: {
            matterId: matter.id,
            partyId: input.initialClientId,
            role: 'CLIENT',
            isPrimaryContact: true,
            billingEnabled: true,
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });

        await recordAuditEvent(tx, {
          userId: actor.id,
          action: 'LINK_MATTER_PARTY',
          entityType: 'MatterParty',
          entityId: `${matter.id}:${input.initialClientId}`,
          changedFields: { role: 'CLIENT', isPrimaryContact: true },
        });
      }

      // 7. Audit creation
      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'CREATE_MATTER',
        entityType: 'Matter',
        entityId: matter.id,
        changedFields: { fileCode: matter.fileCode, title: matter.title, status: matter.status },
      });

      // 8. Fetch complete created Matter DTO
      const fullMatter = await tx.matter.findUnique({
        where: { id: matter.id },
        include: {
          practiceArea: true,
          paperLocation: true,
          parties: { include: { party: true } },
          proceedings: { include: { court: true, parentProceeding: { include: { court: true } }, parties: { include: { matterParty: { include: { party: true } } } } } },
          authorizations: { include: { powerOfAttorney: { include: { party: true } } } },
        },
      });

      if (!fullMatter) {
        throw new NotFoundError('ملف القضية غير موجود.');
      }

      const matterDTO = mapMatterToDTO(fullMatter);
      const result: OpenMatterResult = {
        matter: matterDTO,
        fileCode,
        operationVersion: 1,
      };

      // 9. Complete idempotency
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'openMatter',
        key: input.idempotencyKey,
        resultType: 'OpenMatterResult',
        resultId: matter.id,
        resultPayload: result,
      });

      return result;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'openMatter',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as OpenMatterResult;
      }
      return openMatter(actor, input);
    }
    throw err;
  }
}

export async function updateMatter(
  actor: Actor,
  input: UpdateMatterInput
): Promise<UpdateMatterResult> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  if (!input.title || input.title.trim().length === 0) {
    throw new MatterValidationError('عنوان الملف مطلوب.', { title: 'عنوان الملف مطلوب.' });
  }

  const statusStr = String(input.status);
  if (statusStr === 'ARCHIVED' || statusStr === 'DELETED') {
    throw new UnsupportedTransitionError();
  }

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateMatter',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as UpdateMatterResult;
      }

      // Lock matter row
      await tx.$executeRaw`SELECT id FROM matter WHERE id = ${input.id} FOR UPDATE`;

      const existing = await tx.matter.findUnique({
        where: { id: input.id },
      });

      if (!existing) {
        throw new NotFoundError('ملف القضية غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      // Validate references if changed
      if (input.practiceAreaId && input.practiceAreaId !== existing.practiceAreaId) {
        await assertActiveReference(tx, { practiceAreaId: input.practiceAreaId });
      }
      if (input.paperLocationId && input.paperLocationId !== existing.paperLocationId) {
        await assertActiveReference(tx, { paperLocationId: input.paperLocationId });
      }

      // If transitioning to ACTIVE, enforce last client check
      if (input.status === 'ACTIVE') {
        const clientCount = await tx.matterParty.count({
          where: { matterId: input.id, role: 'CLIENT' },
        });
        if (clientCount === 0) {
          throw new LastClientRequiredError('لا يمكن تفعيل الملف بدون وجود موكل نشط واحد على الأقل.');
        }
      }

      let openingDateVal: Date | null = null;
      if (input.openingDate) {
        const parts = input.openingDate.split('-');
        if (parts.length === 3) {
          openingDateVal = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        }
      }

      let closingDateVal: Date | null = null;
      if (input.closingDate) {
        const parts = input.closingDate.split('-');
        if (parts.length === 3) {
          closingDateVal = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        }
      }

      const nextVersion = existing.version + 1;

      await tx.matter.update({
        where: { id: input.id },
        data: {
          title: input.title.trim(),
          kind: input.kind,
          status: input.status,
          practiceAreaId: input.practiceAreaId ?? null,
          openingDate: openingDateVal,
          closingDate: closingDateVal,
          summary: input.summary?.trim() ?? null,
          notes: input.notes?.trim() ?? null,
          paperLocationId: input.paperLocationId ?? null,
          version: nextVersion,
          updatedById: actor.id,
        },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UPDATE_MATTER',
        entityType: 'Matter',
        entityId: input.id,
        changedFields: { title: input.title, status: input.status, kind: input.kind },
      });

      const fullMatter = await tx.matter.findUnique({
        where: { id: input.id },
        include: {
          practiceArea: true,
          paperLocation: true,
          parties: { include: { party: true } },
          proceedings: { include: { court: true, parentProceeding: { include: { court: true } }, parties: { include: { matterParty: { include: { party: true } } } } } },
          authorizations: { include: { powerOfAttorney: { include: { party: true } } } },
        },
      });

      if (!fullMatter) {
        throw new NotFoundError('ملف القضية غير موجود.');
      }

      const matterDTO = mapMatterToDTO(fullMatter);
      const result: UpdateMatterResult = {
        matter: matterDTO,
        operationVersion: nextVersion,
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateMatter',
        key: input.idempotencyKey,
        resultType: 'UpdateMatterResult',
        resultId: input.id,
        resultPayload: result,
      });

      return result;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'updateMatter',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as UpdateMatterResult;
      }
      return updateMatter(actor, input);
    }
    throw err;
  }
}

export async function linkMatterParty(
  actor: Actor,
  input: LinkMatterPartyInput
): Promise<MatterPartySummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as MatterPartySummaryDTO;
      }

      // Lock matter row
      await tx.$executeRaw`SELECT id FROM matter WHERE id = ${input.matterId} FOR UPDATE`;

      const matter = await tx.matter.findUnique({
        where: { id: input.matterId },
      });
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      const party = await tx.party.findUnique({
        where: { id: input.partyId },
      });
      if (!party) throw new NotFoundError('الطرف غير موجود.');

      // Check unique triple (matterId, partyId, role)
      const existingTriple = await tx.matterParty.findUnique({
        where: {
          matterId_partyId_role: {
            matterId: input.matterId,
            partyId: input.partyId,
            role: input.role,
          },
        },
      });
      if (existingTriple) {
        throw new MatterValidationError('هذا الطرف مضاف بالفعل بهذه الصفة في الملف.');
      }

      // Primary contact check
      if (input.isPrimaryContact) {
        const existingPrimary = await tx.matterParty.findFirst({
          where: { matterId: input.matterId, isPrimaryContact: true },
        });
        if (existingPrimary) {
          throw new PrimaryContactConflictError();
        }
      }

      const created = await tx.matterParty.create({
        data: {
          matterId: input.matterId,
          partyId: input.partyId,
          role: input.role,
          isPrimaryContact: Boolean(input.isPrimaryContact),
          billingEnabled: Boolean(input.billingEnabled),
          notes: input.notes?.trim() ?? null,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: { party: true },
      });

      // Touch parent matter version
      await tx.matter.update({
        where: { id: input.matterId },
        data: { version: { increment: 1 } },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'LINK_MATTER_PARTY',
        entityType: 'MatterParty',
        entityId: created.id,
        changedFields: { role: input.role, isPrimaryContact: input.isPrimaryContact },
      });

      const dto: MatterPartySummaryDTO = {
        id: created.id,
        matterId: created.matterId,
        partyId: created.partyId,
        partyName: created.party.name,
        role: created.role,
        isPrimaryContact: created.isPrimaryContact,
        billingEnabled: created.billingEnabled,
        notes: created.notes,
        version: created.version,
        createdAt: created.createdAt.toISOString(),
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkMatterParty',
        key: input.idempotencyKey,
        resultType: 'MatterPartySummaryDTO',
        resultId: created.id,
        resultPayload: dto,
      });

      return dto;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'linkMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as MatterPartySummaryDTO;
      }
      return linkMatterParty(actor, input);
    }
    throw err;
  }
}

export async function updateMatterParty(
  actor: Actor,
  input: UpdateMatterPartyInput
): Promise<MatterPartySummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as MatterPartySummaryDTO;
      }

      // Lock parent matter
      await tx.$executeRaw`SELECT id FROM matter WHERE id = ${input.matterId} FOR UPDATE`;

      const matter = await tx.matter.findUnique({
        where: { id: input.matterId },
      });
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      const existing = await tx.matterParty.findUnique({
        where: { id: input.id },
        include: { party: true },
      });
      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('طرف الملف غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      // If demoting from CLIENT
      if (existing.role === 'CLIENT' && input.role !== 'CLIENT') {
        // Check POA dependencies first
        const linkedPoas = await tx.matterAuthorization.findFirst({
          where: {
            matterId: input.matterId,
            powerOfAttorney: { partyId: existing.partyId },
          },
        });
        if (linkedPoas) {
          throw new ClientPoaDependencyError();
        }

        if (matter.status === 'ACTIVE') {
          const otherClients = await tx.matterParty.count({
            where: { matterId: input.matterId, role: 'CLIENT', id: { not: input.id } },
          });
          if (otherClients === 0) {
            throw new LastClientRequiredError();
          }
        }
      }

      // Primary contact check
      if (input.isPrimaryContact && !existing.isPrimaryContact) {
        const existingPrimary = await tx.matterParty.findFirst({
          where: { matterId: input.matterId, isPrimaryContact: true, id: { not: input.id } },
        });
        if (existingPrimary) {
          throw new PrimaryContactConflictError();
        }
      }

      const nextVersion = existing.version + 1;

      const updated = await tx.matterParty.update({
        where: { id: input.id },
        data: {
          role: input.role,
          isPrimaryContact: Boolean(input.isPrimaryContact),
          billingEnabled: Boolean(input.billingEnabled),
          notes: input.notes?.trim() ?? null,
          version: nextVersion,
          updatedById: actor.id,
        },
        include: { party: true },
      });

      await tx.matter.update({
        where: { id: input.matterId },
        data: { version: { increment: 1 } },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UPDATE_MATTER_PARTY',
        entityType: 'MatterParty',
        entityId: updated.id,
        changedFields: { role: input.role, isPrimaryContact: input.isPrimaryContact },
      });

      const dto: MatterPartySummaryDTO = {
        id: updated.id,
        matterId: updated.matterId,
        partyId: updated.partyId,
        partyName: updated.party.name,
        role: updated.role,
        isPrimaryContact: updated.isPrimaryContact,
        billingEnabled: updated.billingEnabled,
        notes: updated.notes,
        version: updated.version,
        createdAt: updated.createdAt.toISOString(),
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateMatterParty',
        key: input.idempotencyKey,
        resultType: 'MatterPartySummaryDTO',
        resultId: updated.id,
        resultPayload: dto,
      });

      return dto;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'updateMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as MatterPartySummaryDTO;
      }
      return updateMatterParty(actor, input);
    }
    throw err;
  }
}

export async function unlinkMatterParty(
  actor: Actor,
  input: UnlinkMatterPartyInput
): Promise<void> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'unlinkMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return;
      }

      await tx.$executeRaw`SELECT id FROM matter WHERE id = ${input.matterId} FOR UPDATE`;

      const matter = await tx.matter.findUnique({
        where: { id: input.matterId },
      });
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      const existing = await tx.matterParty.findUnique({
        where: { id: input.id },
      });
      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('طرف الملف غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      if (existing.role === 'CLIENT') {
        const linkedPoas = await tx.matterAuthorization.findFirst({
          where: {
            matterId: input.matterId,
            powerOfAttorney: { partyId: existing.partyId },
          },
        });
        if (linkedPoas) {
          throw new ClientPoaDependencyError();
        }

        if (matter.status === 'ACTIVE') {
          const otherClients = await tx.matterParty.count({
            where: { matterId: input.matterId, role: 'CLIENT', id: { not: input.id } },
          });
          if (otherClients === 0) {
            throw new LastClientRequiredError();
          }
        }
      }

      await tx.matterParty.delete({
        where: { id: input.id },
      });

      await tx.matter.update({
        where: { id: input.matterId },
        data: { version: { increment: 1 } },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UNLINK_MATTER_PARTY',
        entityType: 'MatterParty',
        entityId: input.id,
        changedFields: { unlinkedPartyId: existing.partyId, role: existing.role },
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'unlinkMatterParty',
        key: input.idempotencyKey,
        resultType: 'void',
        resultId: input.id,
        resultPayload: { unlinked: true },
      });
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'unlinkMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return;
      }
      return unlinkMatterParty(actor, input);
    }
    throw err;
  }
}

export async function addProceeding(
  actor: Actor,
  input: AddProceedingInput
): Promise<ProceedingSummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  if (!input.courtId) {
    throw new MatterValidationError('المحكمة مطلوبة لإضافة قيد قضائي.', { courtId: 'المحكمة مطلوبة.' });
  }

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'addProceeding',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as ProceedingSummaryDTO;
      }

      // Check matter exists
      const matter = await tx.matter.findUnique({
        where: { id: input.matterId },
      });
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      // Check active court
      await assertActiveReference(tx, { courtId: input.courtId });

      // Check parent proceeding cycles and cross-matter boundary
      if (input.parentProceedingId) {
        await assertNoProceedingCycle(tx, null, input.parentProceedingId, input.matterId);
      }

      // Determine initial proceeding status
      let initialStatus = input.status ?? 'DRAFT';
      const hasCompleteData = Boolean(input.numberText && input.yearLabel && input.registerType);
      if (initialStatus === 'ACTIVE' && !hasCompleteData) {
        initialStatus = 'DRAFT'; // "الرقم غير مستكمل"
      }

      let filingDateVal: Date | null = null;
      if (input.filingDate) {
        const parts = input.filingDate.split('-');
        if (parts.length === 3) {
          filingDateVal = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        }
      }

      const proceeding = await tx.proceeding.create({
        data: {
          matterId: input.matterId,
          courtId: input.courtId,
          instance: input.instance,
          parentProceedingId: input.parentProceedingId ?? null,
          registerType: input.registerType?.trim() ?? null,
          circuit: input.circuit?.trim() ?? null,
          numberText: input.numberText?.trim() ?? null,
          yearLabel: input.yearLabel?.trim() ?? null,
          filingDate: filingDateVal,
          claimAmount: input.claimAmount?.trim() ?? null,
          status: initialStatus,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: {
          court: true,
          parentProceeding: { include: { court: true } },
          parties: { include: { matterParty: { include: { party: true } } } },
        },
      });

      await tx.matter.update({
        where: { id: input.matterId },
        data: { version: { increment: 1 } },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'ADD_PROCEEDING',
        entityType: 'Proceeding',
        entityId: proceeding.id,
        changedFields: { courtId: input.courtId, instance: input.instance, numberText: input.numberText },
      });

      const dto: ProceedingSummaryDTO = {
        id: proceeding.id,
        matterId: proceeding.matterId,
        courtId: proceeding.courtId,
        courtName: proceeding.court.name,
        instance: proceeding.instance,
        parentProceedingId: proceeding.parentProceedingId,
        parentProceedingSummary: proceeding.parentProceeding ? `${proceeding.parentProceeding.court.name} - ${proceeding.parentProceeding.numberText ?? ''}/${proceeding.parentProceeding.yearLabel ?? ''}` : null,
        registerType: proceeding.registerType,
        circuit: proceeding.circuit,
        numberText: proceeding.numberText,
        yearLabel: proceeding.yearLabel,
        filingDate: proceeding.filingDate ? proceeding.filingDate.toISOString().slice(0, 10) : null,
        claimAmount: proceeding.claimAmount,
        status: proceeding.status,
        version: proceeding.version,
        createdAt: proceeding.createdAt.toISOString(),
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'addProceeding',
        key: input.idempotencyKey,
        resultType: 'ProceedingSummaryDTO',
        resultId: proceeding.id,
        resultPayload: dto,
      });

      return dto;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'addProceeding',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as ProceedingSummaryDTO;
      }
      return addProceeding(actor, input);
    }
    throw err;
  }
}

export async function updateProceeding(
  actor: Actor,
  input: UpdateProceedingInput
): Promise<ProceedingSummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateProceeding',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as ProceedingSummaryDTO;
      }

      const existing = await tx.proceeding.findUnique({
        where: { id: input.id },
      });
      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      if (input.courtId !== existing.courtId) {
        await assertActiveReference(tx, { courtId: input.courtId });
      }

      if (input.parentProceedingId) {
        await assertNoProceedingCycle(tx, input.id, input.parentProceedingId, input.matterId);
      }

      let filingDateVal: Date | null = null;
      if (input.filingDate) {
        const parts = input.filingDate.split('-');
        if (parts.length === 3) {
          filingDateVal = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        }
      }

      const nextVersion = existing.version + 1;

      const updated = await tx.proceeding.update({
        where: { id: input.id },
        data: {
          courtId: input.courtId,
          instance: input.instance,
          parentProceedingId: input.parentProceedingId ?? null,
          registerType: input.registerType?.trim() ?? null,
          circuit: input.circuit?.trim() ?? null,
          numberText: input.numberText?.trim() ?? null,
          yearLabel: input.yearLabel?.trim() ?? null,
          filingDate: filingDateVal,
          claimAmount: input.claimAmount?.trim() ?? null,
          status: input.status,
          version: nextVersion,
          updatedById: actor.id,
        },
        include: {
          court: true,
          parentProceeding: { include: { court: true } },
          parties: { include: { matterParty: { include: { party: true } } } },
        },
      });

      await tx.matter.update({
        where: { id: input.matterId },
        data: { version: { increment: 1 } },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UPDATE_PROCEEDING',
        entityType: 'Proceeding',
        entityId: updated.id,
        changedFields: { numberText: updated.numberText, status: updated.status },
      });

      const dto: ProceedingSummaryDTO = {
        id: updated.id,
        matterId: updated.matterId,
        courtId: updated.courtId,
        courtName: updated.court.name,
        instance: updated.instance,
        parentProceedingId: updated.parentProceedingId,
        parentProceedingSummary: updated.parentProceeding ? `${updated.parentProceeding.court.name} - ${updated.parentProceeding.numberText ?? ''}/${updated.parentProceeding.yearLabel ?? ''}` : null,
        registerType: updated.registerType,
        circuit: updated.circuit,
        numberText: updated.numberText,
        yearLabel: updated.yearLabel,
        filingDate: updated.filingDate ? updated.filingDate.toISOString().slice(0, 10) : null,
        claimAmount: updated.claimAmount,
        status: updated.status,
        version: updated.version,
        createdAt: updated.createdAt.toISOString(),
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateProceeding',
        key: input.idempotencyKey,
        resultType: 'ProceedingSummaryDTO',
        resultId: updated.id,
        resultPayload: dto,
      });

      return dto;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'updateProceeding',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as ProceedingSummaryDTO;
      }
      return updateProceeding(actor, input);
    }
    throw err;
  }
}

export async function linkProceedingParty(
  actor: Actor,
  input: LinkProceedingPartyInput
): Promise<ProceedingPartySummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkProceedingParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as ProceedingPartySummaryDTO;
      }

      const proceeding = await tx.proceeding.findUnique({
        where: { id: input.proceedingId },
      });
      if (!proceeding) throw new NotFoundError('القيد القضائي غير موجود.');

      const matterParty = await tx.matterParty.findUnique({
        where: { id: input.matterPartyId },
        include: { party: true },
      });
      if (!matterParty) throw new NotFoundError('طرف الملف غير موجود.');

      if (proceeding.matterId !== matterParty.matterId) {
        throw new CrossMatterLinkForbiddenError('لا يمكن ربط صفة تقاضي لطرف غير منضم لنفس ملف القضية.');
      }

      const created = await tx.proceedingParty.create({
        data: {
          proceedingId: input.proceedingId,
          matterPartyId: input.matterPartyId,
          legalCapacity: input.legalCapacity,
          notes: input.notes?.trim() ?? null,
          createdById: actor.id,
        },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'LINK_PROCEEDING_PARTY',
        entityType: 'ProceedingParty',
        entityId: created.id,
        changedFields: { legalCapacity: input.legalCapacity },
      });

      const dto: ProceedingPartySummaryDTO = {
        id: created.id,
        proceedingId: created.proceedingId,
        matterPartyId: created.matterPartyId,
        partyName: matterParty.party.name,
        legalCapacity: created.legalCapacity,
        notes: created.notes,
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkProceedingParty',
        key: input.idempotencyKey,
        resultType: 'ProceedingPartySummaryDTO',
        resultId: created.id,
        resultPayload: dto,
      });

      return dto;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'linkProceedingParty',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as ProceedingPartySummaryDTO;
      }
      return linkProceedingParty(actor, input);
    }
    throw err;
  }
}

export async function unlinkProceedingParty(
  actor: Actor,
  input: UnlinkProceedingPartyInput
): Promise<void> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'unlinkProceedingParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) return;

      const existing = await tx.proceedingParty.findUnique({
        where: { id: input.id },
      });
      if (!existing || existing.proceedingId !== input.proceedingId) {
        throw new NotFoundError('صفة التقاضي غير موجودة.');
      }

      await tx.proceedingParty.delete({
        where: { id: input.id },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UNLINK_PROCEEDING_PARTY',
        entityType: 'ProceedingParty',
        entityId: input.id,
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'unlinkProceedingParty',
        key: input.idempotencyKey,
        resultType: 'void',
        resultId: input.id,
        resultPayload: { unlinked: true },
      });
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'unlinkProceedingParty',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) return;
      return unlinkProceedingParty(actor, input);
    }
    throw err;
  }
}

export async function linkMatterAuthorization(
  actor: Actor,
  input: LinkMatterAuthorizationInput
): Promise<MatterAuthorizationSummaryDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkMatterAuthorization',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as MatterAuthorizationSummaryDTO;
      }

      const matter = await tx.matter.findUnique({
        where: { id: input.matterId },
      });
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      const poa = await tx.powerOfAttorney.findUnique({
        where: { id: input.powerOfAttorneyId },
        include: { party: true },
      });
      if (!poa) throw new NotFoundError('سند التوكيل غير موجود.');

      // Invariant: POA party must be a CLIENT in MatterParty for this matter
      const clientRelation = await tx.matterParty.findFirst({
        where: {
          matterId: input.matterId,
          partyId: poa.partyId,
          role: 'CLIENT',
        },
      });

      if (!clientRelation) {
        throw new ClientPoaDependencyError('لا يمكن ربط التوكيل إلا إذا كان صاحبه موكلاً في هذا الملف.');
      }

      const auth = await tx.matterAuthorization.create({
        data: {
          matterId: input.matterId,
          powerOfAttorneyId: input.powerOfAttorneyId,
          createdById: actor.id,
        },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'LINK_MATTER_AUTHORIZATION',
        entityType: 'MatterAuthorization',
        entityId: auth.id,
        changedFields: { powerOfAttorneyId: input.powerOfAttorneyId },
      });

      const dto: MatterAuthorizationSummaryDTO = {
        id: auth.id,
        matterId: auth.matterId,
        powerOfAttorneyId: auth.powerOfAttorneyId,
        poaNumberText: poa.poaNumberText,
        poaYearLabel: poa.poaYearLabel,
        notarizationOffice: poa.notarizationOffice,
        poaType: poa.poaType,
        humanReviewStatus: poa.humanReviewStatus,
        partyId: poa.partyId,
        partyName: poa.party.name,
        createdAt: auth.createdAt.toISOString(),
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkMatterAuthorization',
        key: input.idempotencyKey,
        resultType: 'MatterAuthorizationSummaryDTO',
        resultId: auth.id,
        resultPayload: dto,
      });

      return dto;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'linkMatterAuthorization',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as MatterAuthorizationSummaryDTO;
      }
      return linkMatterAuthorization(actor, input);
    }
    throw err;
  }
}

export async function unlinkMatterAuthorization(
  actor: Actor,
  input: UnlinkMatterAuthorizationInput
): Promise<void> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'unlinkMatterAuthorization',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) return;

      const existing = await tx.matterAuthorization.findUnique({
        where: { id: input.id },
      });
      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('ارتباط التوكيل غير موجود.');
      }

      await tx.matterAuthorization.delete({
        where: { id: input.id },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UNLINK_MATTER_AUTHORIZATION',
        entityType: 'MatterAuthorization',
        entityId: input.id,
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'unlinkMatterAuthorization',
        key: input.idempotencyKey,
        resultType: 'void',
        resultId: input.id,
        resultPayload: { unlinked: true },
      });
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'unlinkMatterAuthorization',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) return;
      return unlinkMatterAuthorization(actor, input);
    }
    throw err;
  }
}

export async function getMatter(matterId: string, actor?: Actor): Promise<MatterDTO> {
  if (actor) {
    assertAuthorized(actor, 'READ_CLIENT_DATA');
  }
  const prisma = getPrismaClient();

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    include: {
      practiceArea: true,
      paperLocation: true,
      parties: {
        include: { party: true },
        orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
      },
      proceedings: {
        include: {
          court: true,
          parentProceeding: { include: { court: true } },
          parties: { include: { matterParty: { include: { party: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      },
      authorizations: {
        include: { powerOfAttorney: { include: { party: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!matter) {
    throw new NotFoundError('ملف القضية غير موجود.');
  }

  return mapMatterToDTO(matter);
}

export async function searchMatters(
  params: SearchMattersParams = {},
  actor?: Actor
): Promise<SearchMattersResult> {
  if (actor) {
    assertAuthorized(actor, 'READ_CLIENT_DATA');
  }
  const prisma = getPrismaClient();

  const where: Prisma.MatterWhereInput = {};

  if (params.kind) where.kind = params.kind;
  if (params.status) where.status = params.status;
  if (params.practiceAreaId) where.practiceAreaId = params.practiceAreaId;

  if (params.clientId) {
    where.parties = {
      some: {
        partyId: params.clientId,
        role: 'CLIENT',
      },
    };
  }

  if (params.courtId) {
    where.proceedings = {
      some: {
        courtId: params.courtId,
      },
    };
  }

  if (params.query && params.query.trim().length > 0) {
    const q = params.query.trim();
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { fileCode: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [matters, total] = await Promise.all([
    prisma.matter.findMany({
      where,
      include: {
        practiceArea: true,
        paperLocation: true,
        parties: { include: { party: true } },
        proceedings: {
          include: {
            court: true,
            parentProceeding: { include: { court: true } },
            parties: { include: { matterParty: { include: { party: true } } } },
          },
        },
        authorizations: {
          include: { powerOfAttorney: { include: { party: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    }),
    prisma.matter.count({ where }),
  ]);

  return {
    matters: matters.map(mapMatterToDTO),
    total,
  };
}
