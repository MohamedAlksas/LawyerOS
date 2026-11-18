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
import {
  ReferenceItemType,
  OfficeSettingsDTO,
  ReferenceItemDTO,
  UpdateOfficeSettingsInput,
  CreateReferenceItemInput,
  UpdateReferenceItemInput,
  ReferenceValidationError,
} from './reference-types';
import { ConcurrencyConflictError, NotFoundError } from '../matters/matter-types';

const SINGLETON_ID = 'singleton';

export async function getOfficeSettings(actor?: Actor): Promise<OfficeSettingsDTO> {
  if (actor) {
    assertAuthorized(actor, 'READ_CLIENT_DATA');
  }
  const prisma = getPrismaClient();
  let settings = await prisma.officeSettings.findUnique({
    where: { id: SINGLETON_ID },
  });

  if (!settings) {
    // Lazy initialize singleton if not yet created
    settings = await prisma.officeSettings.create({
      data: {
        id: SINGLETON_ID,
        officeName: 'مكتب المحاماة',
        currency: 'EGP',
        timeZone: 'Africa/Cairo',
        version: 1,
        updatedById: 'system',
      },
    });
  }

  return {
    id: settings.id,
    officeName: settings.officeName,
    lawyerName: settings.lawyerName,
    phone: settings.phone,
    email: settings.email,
    address: settings.address,
    taxNumber: settings.taxNumber,
    currency: settings.currency,
    timeZone: settings.timeZone,
    version: settings.version,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export async function updateOfficeSettings(
  actor: Actor,
  input: UpdateOfficeSettingsInput
): Promise<OfficeSettingsDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  if (!input.officeName || input.officeName.trim().length === 0) {
    throw new ReferenceValidationError('اسم المكتب مطلوب.', { officeName: 'اسم المكتب مطلوب.' });
  }
  if (input.officeName.length > 255) {
    throw new ReferenceValidationError('اسم المكتب لا يجب أن يتجاوز 255 حرفاً.', {
      officeName: 'الاسم طويل جداً.',
    });
  }

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Idempotency claim
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateOfficeSettings',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as OfficeSettingsDTO;
      }

      // 2. Lock and retrieve current settings
      const current = await tx.officeSettings.findUnique({
        where: { id: SINGLETON_ID },
      });

      if (current && input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      const nextVersion = current ? current.version + 1 : 1;

      const updated = await tx.officeSettings.upsert({
        where: { id: SINGLETON_ID },
        create: {
          id: SINGLETON_ID,
          officeName: input.officeName.trim(),
          lawyerName: input.lawyerName?.trim() ?? null,
          phone: input.phone?.trim() ?? null,
          email: input.email?.trim() ?? null,
          address: input.address?.trim() ?? null,
          taxNumber: input.taxNumber?.trim() ?? null,
          currency: 'EGP',
          timeZone: 'Africa/Cairo',
          version: nextVersion,
          updatedById: actor.id,
        },
        update: {
          officeName: input.officeName.trim(),
          lawyerName: input.lawyerName?.trim() ?? null,
          phone: input.phone?.trim() ?? null,
          email: input.email?.trim() ?? null,
          address: input.address?.trim() ?? null,
          taxNumber: input.taxNumber?.trim() ?? null,
          version: nextVersion,
          updatedById: actor.id,
        },
      });

      // 3. Record audit
      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UPDATE_OFFICE_SETTINGS',
        entityType: 'OfficeSettings',
        entityId: SINGLETON_ID,
        changedFields: {
          officeName: updated.officeName,
          lawyerName: updated.lawyerName,
          phone: updated.phone,
          email: updated.email,
        },
      });

      const resultDTO: OfficeSettingsDTO = {
        id: updated.id,
        officeName: updated.officeName,
        lawyerName: updated.lawyerName,
        phone: updated.phone,
        email: updated.email,
        address: updated.address,
        taxNumber: updated.taxNumber,
        currency: updated.currency,
        timeZone: updated.timeZone,
        version: updated.version,
        updatedAt: updated.updatedAt.toISOString(),
      };

      // 4. Complete idempotency
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateOfficeSettings',
        key: input.idempotencyKey,
        resultType: 'OfficeSettingsDTO',
        resultId: SINGLETON_ID,
        resultPayload: resultDTO,
      });

      return resultDTO;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'updateOfficeSettings',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as OfficeSettingsDTO;
      }
      return updateOfficeSettings(actor, input);
    }
    throw err;
  }
}

export async function listReferenceItems(
  type?: ReferenceItemType,
  includeInactive = false,
  actor?: Actor
): Promise<ReferenceItemDTO[]> {
  if (actor) {
    assertAuthorized(actor, 'READ_CLIENT_DATA');
  }
  const prisma = getPrismaClient();
  const results: ReferenceItemDTO[] = [];

  if (!type || type === 'COURT') {
    const courts = await prisma.court.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
    });
    for (const c of courts) {
      results.push({
        id: c.id,
        type: 'COURT',
        name: c.name,
        code: c.code,
        circuitTypes: c.circuitTypes,
        notes: c.notes,
        isActive: c.isActive,
        version: c.version,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      });
    }
  }

  if (!type || type === 'PRACTICE_AREA') {
    const areas = await prisma.practiceArea.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
    });
    for (const a of areas) {
      results.push({
        id: a.id,
        type: 'PRACTICE_AREA',
        name: a.name,
        code: a.code,
        notes: a.notes,
        isActive: a.isActive,
        version: a.version,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      });
    }
  }

  if (!type || type === 'STORAGE_LOCATION') {
    const locations = await prisma.storageLocation.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
    });
    for (const l of locations) {
      results.push({
        id: l.id,
        type: 'STORAGE_LOCATION',
        name: l.name,
        code: l.code,
        notes: l.notes,
        isActive: l.isActive,
        version: l.version,
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      });
    }
  }

  return results;
}

export async function createReferenceItem(
  actor: Actor,
  input: CreateReferenceItemInput
): Promise<ReferenceItemDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  if (!input.name || input.name.trim().length === 0) {
    throw new ReferenceValidationError('الاسم مطلوب.', { name: 'الاسم مطلوب.' });
  }

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: `createReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as ReferenceItemDTO;
      }

      let createdDTO: ReferenceItemDTO;

      if (input.type === 'COURT') {
        const item = await tx.court.create({
          data: {
            name: input.name.trim(),
            code: input.code?.trim() ?? null,
            circuitTypes: input.circuitTypes ?? [],
            notes: input.notes?.trim() ?? null,
            isActive: true,
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        createdDTO = {
          id: item.id,
          type: 'COURT',
          name: item.name,
          code: item.code,
          circuitTypes: item.circuitTypes,
          notes: item.notes,
          isActive: item.isActive,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        };
      } else if (input.type === 'PRACTICE_AREA') {
        const item = await tx.practiceArea.create({
          data: {
            name: input.name.trim(),
            code: input.code?.trim() ?? null,
            notes: input.notes?.trim() ?? null,
            isActive: true,
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        createdDTO = {
          id: item.id,
          type: 'PRACTICE_AREA',
          name: item.name,
          code: item.code,
          notes: item.notes,
          isActive: item.isActive,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        };
      } else if (input.type === 'STORAGE_LOCATION') {
        const item = await tx.storageLocation.create({
          data: {
            name: input.name.trim(),
            code: input.code?.trim() ?? null,
            notes: input.notes?.trim() ?? null,
            isActive: true,
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        createdDTO = {
          id: item.id,
          type: 'STORAGE_LOCATION',
          name: item.name,
          code: item.code,
          notes: item.notes,
          isActive: item.isActive,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        };
      } else {
        throw new ReferenceValidationError('نوع العنصر المرجعي غير صالح.');
      }

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: `CREATE_${input.type}`,
        entityType: input.type,
        entityId: createdDTO.id,
        changedFields: { name: createdDTO.name, code: createdDTO.code },
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: `createReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        resultType: 'ReferenceItemDTO',
        resultId: createdDTO.id,
        resultPayload: createdDTO,
      });

      return createdDTO;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: `createReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as ReferenceItemDTO;
      }
      return createReferenceItem(actor, input);
    }
    throw err;
  }
}

export async function updateReferenceItem(
  actor: Actor,
  input: UpdateReferenceItemInput
): Promise<ReferenceItemDTO> {
  assertAuthorized(actor, 'WRITE_CLIENT_DATA');

  if (!input.name || input.name.trim().length === 0) {
    throw new ReferenceValidationError('الاسم مطلوب.', { name: 'الاسم مطلوب.' });
  }

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: `updateReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        return claim.resultPayload as ReferenceItemDTO;
      }

      let updatedDTO: ReferenceItemDTO;

      if (input.type === 'COURT') {
        const existing = await tx.court.findUnique({ where: { id: input.id } });
        if (!existing) throw new NotFoundError();
        if (existing.version !== input.expectedVersion) throw new ConcurrencyConflictError();

        const item = await tx.court.update({
          where: { id: input.id },
          data: {
            name: input.name.trim(),
            code: input.code?.trim() ?? null,
            circuitTypes: input.circuitTypes ?? existing.circuitTypes,
            notes: input.notes?.trim() ?? null,
            isActive: input.isActive,
            version: existing.version + 1,
            updatedById: actor.id,
          },
        });
        updatedDTO = {
          id: item.id,
          type: 'COURT',
          name: item.name,
          code: item.code,
          circuitTypes: item.circuitTypes,
          notes: item.notes,
          isActive: item.isActive,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        };
      } else if (input.type === 'PRACTICE_AREA') {
        const existing = await tx.practiceArea.findUnique({ where: { id: input.id } });
        if (!existing) throw new NotFoundError();
        if (existing.version !== input.expectedVersion) throw new ConcurrencyConflictError();

        const item = await tx.practiceArea.update({
          where: { id: input.id },
          data: {
            name: input.name.trim(),
            code: input.code?.trim() ?? null,
            notes: input.notes?.trim() ?? null,
            isActive: input.isActive,
            version: existing.version + 1,
            updatedById: actor.id,
          },
        });
        updatedDTO = {
          id: item.id,
          type: 'PRACTICE_AREA',
          name: item.name,
          code: item.code,
          notes: item.notes,
          isActive: item.isActive,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        };
      } else if (input.type === 'STORAGE_LOCATION') {
        const existing = await tx.storageLocation.findUnique({ where: { id: input.id } });
        if (!existing) throw new NotFoundError();
        if (existing.version !== input.expectedVersion) throw new ConcurrencyConflictError();

        const item = await tx.storageLocation.update({
          where: { id: input.id },
          data: {
            name: input.name.trim(),
            code: input.code?.trim() ?? null,
            notes: input.notes?.trim() ?? null,
            isActive: input.isActive,
            version: existing.version + 1,
            updatedById: actor.id,
          },
        });
        updatedDTO = {
          id: item.id,
          type: 'STORAGE_LOCATION',
          name: item.name,
          code: item.code,
          notes: item.notes,
          isActive: item.isActive,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        };
      } else {
        throw new ReferenceValidationError('نوع العنصر المرجعي غير صالح.');
      }

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: `UPDATE_${input.type}`,
        entityType: input.type,
        entityId: updatedDTO.id,
        changedFields: { name: updatedDTO.name, isActive: updatedDTO.isActive },
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: `updateReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        resultType: 'ReferenceItemDTO',
        resultId: updatedDTO.id,
        resultPayload: updatedDTO,
      });

      return updatedDTO;
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: `updateReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        return resolved.resultPayload as ReferenceItemDTO;
      }
      return updateReferenceItem(actor, input);
    }
    throw err;
  }
}