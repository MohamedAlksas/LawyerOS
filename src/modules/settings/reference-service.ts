import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '@/lib/auth';
import { Actor, Permission } from '@/modules/identity/types';
import { assertAuthorized } from '@/modules/identity/authorize';
import { recordAuditEvent } from '@/lib/audit';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  resolveConcurrentIdempotency,
  runWithIdempotencyRetry,
} from '@/lib/idempotency';
import {
  ReferenceItemType,
  OfficeSettingsDTO,
  ReferenceItemDTO,
  UpdateOfficeSettingsInput,
  CreateReferenceItemInput,
  UpdateReferenceItemInput,
  ReferenceValidationError,
  UnauthorizedError,
  ConcurrencyConflictError,
  NotFoundError,
  updateOfficeSettingsSchema,
  createReferenceItemSchema,
  updateReferenceItemSchema,
  listReferenceItemsSchema,
  formatZodError,
} from './reference-types';

const SINGLETON_ID = 'singleton';

interface MinimalReferenceIdempotencyPayload {
  operation?: string;
  resourceId?: string;
  version?: number;
  acknowledgedAt?: string;
}

function extractResourceId(claim: { resultId?: string | null; resultPayload?: unknown }): string {
  const resourceId = claim.resultId || (claim.resultPayload as MinimalReferenceIdempotencyPayload | null)?.resourceId;
  return resourceId ?? '';
}

function extractOperationVersion(payload: unknown, fallback: number): number {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'version' in payload &&
    typeof (payload as { version?: unknown }).version === 'number'
  ) {
    return (payload as { version: number }).version;
  }
  return fallback;
}

function assertActorAuthorized(actor: Actor | undefined | null, permission: Permission): void {
  if (!actor || !actor.id || !actor.role) {
    throw new UnauthorizedError('غير مصرح. يرجى تسجيل الدخول أولاً.');
  }
  assertAuthorized(actor, permission);
}

function mapOfficeSettingsToDTO(settings: {
  id: string;
  officeName: string;
  lawyerName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  currency: string;
  timeZone: string;
  version: number;
  updatedAt: Date;
}): OfficeSettingsDTO {
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

async function getOfficeSettingsInternal(
  prismaOrTx: PrismaClient | Prisma.TransactionClient
): Promise<OfficeSettingsDTO> {
  try {
    const settings = await prismaOrTx.officeSettings.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        officeName: 'مكتب المحاماة',
        currency: 'EGP',
        timeZone: 'Africa/Cairo',
        version: 1,
        updatedById: 'system',
      },
      update: {},
    });
    return mapOfficeSettingsToDTO(settings);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const existing = await prismaOrTx.officeSettings.findUniqueOrThrow({
        where: { id: SINGLETON_ID },
      });
      return mapOfficeSettingsToDTO(existing);
    }
    throw err;
  }
}

export async function getOfficeSettings(
  actor?: Actor,
  options?: { prisma?: PrismaClient }
): Promise<OfficeSettingsDTO> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');
  const prisma = options?.prisma || getPrismaClient();
  return await getOfficeSettingsInternal(prisma);
}

export async function updateOfficeSettings(
  actor: Actor,
  rawInput: UpdateOfficeSettingsInput,
  options?: { prisma?: PrismaClient }
): Promise<OfficeSettingsDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UpdateOfficeSettingsInput;
  try {
    input = updateOfficeSettingsSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new ReferenceValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = options?.prisma || getPrismaClient();

  return runWithIdempotencyRetry(
    () =>
      prisma.$transaction(async (tx) => {
        // 1. Idempotency claim
        const claim = await claimIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'updateOfficeSettings',
          key: input.idempotencyKey,
          payload: input,
        });

        if (claim.isReplay) {
          const dto = await getOfficeSettingsInternal(tx);
          const opVersion = extractOperationVersion(claim.resultPayload, dto.version);
          return { ...dto, operationVersion: opVersion };
        }

        // 2. Initialize the singleton before locking. SELECT ... FOR UPDATE cannot
        // lock a row that does not exist, so two first writers would both choose
        // version 1 and overwrite each other. ON CONFLICT makes initialization
        // serializable: the second writer blocks until the first commits, then
        // observes the committed version under the normal version comparison.
        await tx.$executeRaw`
          INSERT INTO "office_settings"
            ("id", "officeName", "currency", "timeZone", "version", "updatedById", "updatedAt")
          VALUES
            (${SINGLETON_ID}, 'مكتب المحاماة', 'EGP', 'Africa/Cairo', 1, 'system', CURRENT_TIMESTAMP)
          ON CONFLICT ("id") DO NOTHING;
        `;

        // 3. Lock and retrieve current settings
        const [current] = await tx.$queryRaw<Array<{
          id: string;
          version: number;
        }>>`
          SELECT "id", "version"
          FROM "office_settings"
          WHERE "id" = ${SINGLETON_ID}
          FOR UPDATE;
        `;

        if (!current) {
          throw new ConcurrencyConflictError();
        }

        if (current.version !== input.expectedVersion) {
          throw new ConcurrencyConflictError();
        }

        const nextVersion = current.version + 1;

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
            ...(input.lawyerName !== undefined ? { lawyerName: input.lawyerName?.trim() ?? null } : {}),
            ...(input.phone !== undefined ? { phone: input.phone?.trim() ?? null } : {}),
            ...(input.email !== undefined ? { email: input.email?.trim() ?? null } : {}),
            ...(input.address !== undefined ? { address: input.address?.trim() ?? null } : {}),
            ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber?.trim() ?? null } : {}),
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

        const resultDTO = mapOfficeSettingsToDTO(updated);
        resultDTO.operationVersion = nextVersion;

        // 4. Complete idempotency with minimal safe metadata
        await completeIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: 'updateOfficeSettings',
          key: input.idempotencyKey,
          resultType: 'OfficeSettingsDTO',
          resultId: SINGLETON_ID,
          resultPayload: {
            operation: 'UPDATE_OFFICE_SETTINGS',
            resourceId: SINGLETON_ID,
            version: nextVersion,
            acknowledgedAt: new Date().toISOString(),
          },
        });

        return resultDTO;
      }),
    async () => {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'updateOfficeSettings',
        key: input.idempotencyKey,
        payload: input,
      });
      if (!resolved) return { resolved: false };
      const dto = await getOfficeSettingsInternal(prisma);
      const opVersion = extractOperationVersion(resolved.resultPayload, dto.version);
      return { resolved: true, value: { ...dto, operationVersion: opVersion } };
    }
  );
}

export async function listReferenceItems(
  type?: ReferenceItemType,
  includeInactive = false,
  actor?: Actor
): Promise<ReferenceItemDTO[]> {
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  try {
    listReferenceItemsSchema.parse({ type, includeInactive });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new ReferenceValidationError(message, fieldErrors);
    }
    throw err;
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

async function getReferenceItemDTO(
  tx: PrismaClient | Prisma.TransactionClient,
  type: ReferenceItemType,
  id: string
): Promise<ReferenceItemDTO> {
  if (type === 'COURT') {
    const item = await tx.court.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('المحكمة غير موجودة.');
    return {
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
  } else if (type === 'PRACTICE_AREA') {
    const item = await tx.practiceArea.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('تصنيف العمل غير موجود.');
    return {
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
  } else if (type === 'STORAGE_LOCATION') {
    const item = await tx.storageLocation.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('مكان الحفظ غير موجود.');
    return {
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
  }
  throw new ReferenceValidationError('نوع العنصر المرجعي غير صالح.');
}

export async function createReferenceItem(
  actor: Actor,
  rawInput: CreateReferenceItemInput
): Promise<ReferenceItemDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: CreateReferenceItemInput;
  try {
    input = createReferenceItemSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new ReferenceValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = getPrismaClient();

  return runWithIdempotencyRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: `createReferenceItem:${input.type}`,
          key: input.idempotencyKey,
          payload: input,
        });

        if (claim.isReplay) {
          const resourceId = extractResourceId(claim);
          const dto = await getReferenceItemDTO(tx, input.type, resourceId);
          const opVersion = extractOperationVersion(claim.resultPayload, 1);
          return { ...dto, operationVersion: opVersion };
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
          resultPayload: {
            operation: `CREATE_${input.type}`,
            resourceId: createdDTO.id,
            version: 1,
            acknowledgedAt: new Date().toISOString(),
          },
        });

        createdDTO.operationVersion = 1;
        return createdDTO;
      }),
    async () => {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: `createReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        payload: input,
      });
      if (!resolved) return { resolved: false };
      const resourceId = extractResourceId(resolved);
      const dto = await getReferenceItemDTO(prisma, input.type, resourceId);
      const opVersion = extractOperationVersion(resolved.resultPayload, 1);
      return { resolved: true, value: { ...dto, operationVersion: opVersion } };
    }
  );
}

export async function updateReferenceItem(
  actor: Actor,
  rawInput: UpdateReferenceItemInput
): Promise<ReferenceItemDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UpdateReferenceItemInput;
  try {
    input = updateReferenceItemSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new ReferenceValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = getPrismaClient();

  return runWithIdempotencyRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          actorId: actor.id,
          commandType: `updateReferenceItem:${input.type}`,
          key: input.idempotencyKey,
          payload: input,
        });

        if (claim.isReplay) {
          const resourceId = extractResourceId(claim);
          const dto = await getReferenceItemDTO(tx, input.type, resourceId);
          const opVersion = extractOperationVersion(claim.resultPayload, 1);
          return { ...dto, operationVersion: opVersion };
        }

        let updatedDTO: ReferenceItemDTO;
        const optionalFields = {
          ...(input.code !== undefined ? { code: input.code?.trim() ?? null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() ?? null } : {}),
        };

        if (input.type === 'COURT') {
          const [existing] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
            SELECT "id", "version" FROM "court" WHERE "id" = ${input.id} FOR UPDATE;
          `;
          if (!existing) throw new NotFoundError('المحكمة غير موجودة.');
          if (existing.version !== input.expectedVersion) throw new ConcurrencyConflictError();

          const item = await tx.court.update({
            where: { id: input.id },
            data: {
              name: input.name.trim(),
              ...optionalFields,
              circuitTypes: input.circuitTypes ?? undefined,
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
          const [existing] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
            SELECT "id", "version" FROM "practice_area" WHERE "id" = ${input.id} FOR UPDATE;
          `;
          if (!existing) throw new NotFoundError('تصنيف العمل غير موجود.');
          if (existing.version !== input.expectedVersion) throw new ConcurrencyConflictError();

          const item = await tx.practiceArea.update({
            where: { id: input.id },
            data: {
              name: input.name.trim(),
              ...optionalFields,
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
          const [existing] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
            SELECT "id", "version" FROM "storage_location" WHERE "id" = ${input.id} FOR UPDATE;
          `;
          if (!existing) throw new NotFoundError('مكان الحفظ غير موجود.');
          if (existing.version !== input.expectedVersion) throw new ConcurrencyConflictError();

          const item = await tx.storageLocation.update({
            where: { id: input.id },
            data: {
              name: input.name.trim(),
              ...optionalFields,
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
          resultPayload: {
            operation: `UPDATE_${input.type}`,
            resourceId: updatedDTO.id,
            version: updatedDTO.version,
            acknowledgedAt: new Date().toISOString(),
          },
        });

        updatedDTO.operationVersion = updatedDTO.version;
        return updatedDTO;
      }),
    async () => {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: `updateReferenceItem:${input.type}`,
        key: input.idempotencyKey,
        payload: input,
      });
      if (!resolved) return { resolved: false };
      const resourceId = extractResourceId(resolved);
      const dto = await getReferenceItemDTO(prisma, input.type, resourceId);
      const opVersion = extractOperationVersion(resolved.resultPayload, dto.version);
      return { resolved: true, value: { ...dto, operationVersion: opVersion } };
    }
  );
}
