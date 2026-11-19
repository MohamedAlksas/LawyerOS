import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getPrismaClient } from '@/lib/auth';
import { Actor, Permission } from '@/modules/identity/types';
import { assertAuthorized } from '@/modules/identity/authorize';
import { recordAuditEvent } from '@/lib/audit';
import { normalizeArabicDigits, normalizeArabicText } from '@/lib/normalization';
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
  DuplicateCourtWarningDTO,
  PartyMatterAssociationDTO,
  PartyMatterAssociationsResult,
  GetPartyMatterAssociationsParams,
  FindSimilarProceedingsParams,
  SimilarProceedingCandidateDTO,
  FindSimilarProceedingsResult,
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
  openMatterSchema,
  updateMatterSchema,
  linkMatterPartySchema,
  updateMatterPartySchema,
  unlinkMatterPartySchema,
  addProceedingSchema,
  updateProceedingSchema,
  linkProceedingPartySchema,
  unlinkProceedingPartySchema,
  linkMatterAuthorizationSchema,
  unlinkMatterAuthorizationSchema,
  searchMattersParamsSchema,
  getPartyMatterAssociationsSchema,
  findSimilarProceedingsSchema,
  parseCalendarDateToUtc,
  UnauthorizedError,
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

function extractOperationVersion(payload: unknown, fallback: number): number {
  if (payload && typeof payload === 'object' && 'version' in payload) {
    const v = (payload as { version?: unknown }).version;
    if (typeof v === 'number' && Number.isInteger(v)) {
      return v;
    }
  }
  return fallback;
}

export interface ServiceExecutionOptions {
  prismaOverride?: PrismaClient;
}

interface MinimalIdempotencyPayload {
  operation?: string;
  resourceId?: string;
  version?: number;
  fileCode?: string;
  acknowledgedAt?: string;
}

function extractResourceId(claim: { resultId?: string | null; resultPayload?: unknown }): string {
  const resourceId = claim.resultId || (claim.resultPayload as MinimalIdempotencyPayload | null)?.resourceId;
  return resourceId ?? '';
}

function formatZodError(err: z.ZodError): { message: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.');
    if (!fieldErrors[path]) {
      fieldErrors[path] = issue.message;
    }
  }
  const message = err.issues[0]?.message || 'بيانات الإدخال غير صالحة.';
  return { message, fieldErrors };
}

function assertActorAuthorized(actor: Actor | undefined | null, permission: Permission): Actor {
  if (!actor || !actor.id || !actor.role) {
    throw new UnauthorizedError('غير مصرح. يرجى تسجيل الدخول أولاً.');
  }
  assertAuthorized(actor, permission);
  return actor;
}

/**
 * Validates that a reference item is active for assignment under a row-level lock.
 * Preserves unchanged historical links during updates.
 */
async function validateActiveReferenceUnderLock(
  tx: Prisma.TransactionClient,
  type: 'COURT' | 'PRACTICE_AREA' | 'STORAGE_LOCATION',
  id: string | null | undefined,
  existingId?: string | null | undefined
): Promise<void> {
  if (!id) return;
  // Preserve historical unchanged references
  if (existingId && id === existingId) return;

  let isActive: boolean | null = null;
  if (type === 'COURT') {
    const rows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
      SELECT "isActive" FROM "court" WHERE "id" = ${id} FOR UPDATE;
    `;
    isActive = rows[0]?.isActive ?? null;
  } else if (type === 'PRACTICE_AREA') {
    const rows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
      SELECT "isActive" FROM "practice_area" WHERE "id" = ${id} FOR UPDATE;
    `;
    isActive = rows[0]?.isActive ?? null;
  } else if (type === 'STORAGE_LOCATION') {
    const rows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
      SELECT "isActive" FROM "storage_location" WHERE "id" = ${id} FOR UPDATE;
    `;
    isActive = rows[0]?.isActive ?? null;
  }

  if (isActive === null) {
    throw new NotFoundError('العنصر المرجعي المختار غير موجود.');
  }
  if (!isActive) {
    throw new InactiveReferenceSelectedError('العنصر المرجعي المختار غير نشط ولا يمكن استخدامه لقيود جديدة.');
  }
}

/**
 * Validates proceeding hierarchy to prevent cycles, self-linking, and cross-matter parenting.
 * Traverses up to 100 ancestors safely.
 */
async function validateProceedingHierarchy(
  tx: Prisma.TransactionClient,
  matterId: string,
  proceedingId: string | null,
  parentProceedingId: string | null
): Promise<void> {
  if (!parentProceedingId) return;

  if (proceedingId && parentProceedingId === proceedingId) {
    throw new ProceedingCycleDetectedError('لا يمكن ربط القيد القضائي بنفسه.');
  }

  const parent = await tx.proceeding.findUnique({
    where: { id: parentProceedingId },
    select: { id: true, matterId: true, parentProceedingId: true },
  });

  if (!parent) {
    throw new NotFoundError('القيد القضائي الأصلي غير موجود.');
  }

  if (parent.matterId !== matterId) {
    throw new CrossMatterLinkForbiddenError('لا يمكن ربط قيد قضائي بقيد تابع لملف آخر.');
  }

  let currentId: string | null = parentProceedingId;
  let depth = 0;
  const MAX_DEPTH = 100;
  const visited = new Set<string>();
  if (proceedingId) visited.add(proceedingId);

  while (currentId) {
    if (visited.has(currentId)) {
      throw new ProceedingCycleDetectedError('تعذر حفظ القيد: تم اكتشاف حلقة تسلسل غير صالحة في درجات التقاضي.');
    }
    visited.add(currentId);
    depth++;
    if (depth > MAX_DEPTH) {
      throw new ProceedingCycleDetectedError('تجاوز الحد الأقصى المسموح به لعمق تسلسل القيود القضائية (100).');
    }

    const ancestor: { parentProceedingId: string | null } | null = await tx.proceeding.findUnique({
      where: { id: currentId },
      select: { parentProceedingId: true },
    });
    currentId = ancestor?.parentProceedingId ?? null;
  }
}

/**
 * Validates that an ACTIVE proceeding has all mandatory registration details.
 */
function validateProceedingCompleteness(
  status: string | undefined,
  numberText?: string | null,
  yearLabel?: string | null,
  registerType?: string | null,
  courtId?: string | null
): void {
  if (status === 'ACTIVE') {
    const hasNumber = Boolean(numberText && numberText.trim().length > 0);
    const hasYear = Boolean(yearLabel && yearLabel.trim().length > 0);
    const hasRegister = Boolean(registerType && registerType.trim().length > 0);
    const hasCourt = Boolean(courtId && courtId.trim().length > 0);

    if (!hasNumber || !hasYear || !hasRegister || !hasCourt) {
      throw new MatterValidationError(
        'لا يمكن تفعيل القيد القضائي بدون استكمال رقم الدعوى وسنة القيد ونوع الجدول والمحكمة.'
      );
    }
  }
}

/**
 * Advisory check for similar court registration identities.
 * Does not block creation or updates.
 */
async function checkProceedingCourtDuplicate(
  tx: Prisma.TransactionClient,
  matterId: string,
  courtId: string,
  registerType?: string | null,
  numberText?: string | null,
  yearLabel?: string | null,
  excludeProceedingId?: string
): Promise<DuplicateCourtWarningDTO | null> {
  if (!courtId || !numberText || !yearLabel) return null;

  const normNumber = normalizeArabicDigits(numberText.trim());
  const normYear = normalizeArabicDigits(yearLabel.trim());

  const candidates = await tx.proceeding.findMany({
    where: {
      courtId,
      ...(excludeProceedingId ? { id: { not: excludeProceedingId } } : {}),
    },
    select: {
      id: true,
      matterId: true,
      registerType: true,
      numberText: true,
      yearLabel: true,
    },
  });

  for (const c of candidates) {
    if (c.numberText && c.yearLabel) {
      const cNumber = normalizeArabicDigits(c.numberText.trim());
      const cYear = normalizeArabicDigits(c.yearLabel.trim());
      if (cNumber === normNumber && cYear === normYear) {
        return {
          detected: true,
          message: `تنبيه: يوجد قيد قضائي آخر بنفس الرقم (${c.numberText}/${c.yearLabel}) في نفس المحكمة.`,
          existingProceedingId: c.id,
          existingNumberText: c.numberText,
          existingYearLabel: c.yearLabel,
        };
      }
    }
  }
  return null;
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
      parentProceedingSummary: pr.parentProceeding
        ? `${pr.parentProceeding.court?.name ?? ''} - ${pr.parentProceeding.numberText ?? ''}/${pr.parentProceeding.yearLabel ?? ''}`
        : null,
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
        capacityText: pp.capacityText,
        legalCapacity: pp.legalCapacity ?? null,
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

async function getMatterInternal(
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  matterId: string
): Promise<MatterDTO> {
  const matter = await prismaOrTx.matter.findUnique({
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
          parties: { include: { matterParty: { include: { party: true } } }, orderBy: { createdAt: 'asc' } },
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

function toEasternArabicDigits(str: string): string {
  return str.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + parseInt(d, 10)));
}

function normalizeArabicLetters(str: string): string {
  return str
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[\u064B-\u065F]/g, '');
}

function expandSearchVariants(query: string): string[] {
  const q = query.trim();
  const variants = new Set<string>([q]);

  const asciiDigits = normalizeArabicDigits(q);
  variants.add(asciiDigits);
  const easternDigits = toEasternArabicDigits(asciiDigits);
  variants.add(easternDigits);

  for (const base of [q, asciiDigits, easternDigits]) {
    variants.add(normalizeArabicLetters(base));
    const words = base.split(/\s+/);
    const alefVariants = ['ا', 'أ', 'إ', 'آ'];
    for (const alef of alefVariants) {
      const replaced = words.map((w) => w.replace(/^[اأإآٱ]/, alef)).join(' ');
      variants.add(replaced);
    }
    const toTaa = words.map((w) => w.replace(/ه$/, 'ة')).join(' ');
    variants.add(toTaa);
    const toHaa = words.map((w) => w.replace(/ة$/, 'ه')).join(' ');
    variants.add(toHaa);
    const toAlefMaqsura = words.map((w) => w.replace(/ي$/, 'ى')).join(' ');
    variants.add(toAlefMaqsura);
    const toYaa = words.map((w) => w.replace(/ى$/, 'ي')).join(' ');
    variants.add(toYaa);
  }

  return Array.from(variants).filter(Boolean);
}

async function getProceedingDTO(
  tx: PrismaClient | Prisma.TransactionClient,
  proceedingId: string
): Promise<ProceedingSummaryDTO> {
  const proceeding = await tx.proceeding.findUnique({
    where: { id: proceedingId },
    include: {
      court: true,
      parentProceeding: { include: { court: true } },
      parties: { include: { matterParty: { include: { party: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!proceeding) throw new NotFoundError('القيد القضائي غير موجود.');
  return {
    id: proceeding.id,
    matterId: proceeding.matterId,
    courtId: proceeding.courtId,
    courtName: proceeding.court.name,
    instance: proceeding.instance,
    parentProceedingId: proceeding.parentProceedingId,
    parentProceedingSummary: proceeding.parentProceeding
      ? `${proceeding.parentProceeding.court.name} - ${proceeding.parentProceeding.numberText ?? ''}/${proceeding.parentProceeding.yearLabel ?? ''}`
      : null,
    registerType: proceeding.registerType,
    circuit: proceeding.circuit,
    numberText: proceeding.numberText,
    yearLabel: proceeding.yearLabel,
    filingDate: proceeding.filingDate ? proceeding.filingDate.toISOString().slice(0, 10) : null,
    claimAmount: proceeding.claimAmount,
    status: proceeding.status,
    version: proceeding.version,
    createdAt: proceeding.createdAt.toISOString(),
    parties: proceeding.parties.map((pp) => ({
      id: pp.id,
      proceedingId: pp.proceedingId,
      matterPartyId: pp.matterPartyId,
      partyName: pp.matterParty.party.name,
      capacityText: pp.capacityText,
      legalCapacity: pp.legalCapacity,
      notes: pp.notes,
    })),
  };
}

async function getProceedingPartyDTO(
  tx: PrismaClient | Prisma.TransactionClient,
  id: string
): Promise<ProceedingPartySummaryDTO> {
  const pp = await tx.proceedingParty.findUnique({
    where: { id },
    include: {
      matterParty: { include: { party: true } },
    },
  });
  if (!pp) throw new NotFoundError('صفة التقاضي غير موجودة.');
  return {
    id: pp.id,
    proceedingId: pp.proceedingId,
    matterPartyId: pp.matterPartyId,
    partyName: pp.matterParty.party.name,
    capacityText: pp.capacityText,
    legalCapacity: pp.legalCapacity,
    notes: pp.notes,
  };
}

async function getMatterAuthorizationDTO(
  tx: PrismaClient | Prisma.TransactionClient,
  authId: string
): Promise<MatterAuthorizationSummaryDTO> {
  const auth = await tx.matterAuthorization.findUnique({
    where: { id: authId },
    include: {
      powerOfAttorney: { include: { party: true } },
    },
  });
  if (!auth) throw new NotFoundError('ارتباط التوكيل غير موجود.');
  return {
    id: auth.id,
    matterId: auth.matterId,
    powerOfAttorneyId: auth.powerOfAttorneyId,
    poaNumberText: auth.powerOfAttorney.poaNumberText,
    poaYearLabel: auth.powerOfAttorney.poaYearLabel,
    notarizationOffice: auth.powerOfAttorney.notarizationOffice,
    poaType: auth.powerOfAttorney.poaType,
    humanReviewStatus: auth.powerOfAttorney.humanReviewStatus,
    partyId: auth.powerOfAttorney.partyId,
    partyName: auth.powerOfAttorney.party.name,
    createdAt: auth.createdAt.toISOString(),
  };
}

export async function openMatter(
  actor: Actor,
  rawInput: OpenMatterInput,
  options: ServiceExecutionOptions = {}
): Promise<OpenMatterResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: OpenMatterInput;
  try {
    input = openMatterSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const rawStatus = (rawInput as unknown as Record<string, unknown>).status;
  if (rawStatus === 'ARCHIVED' || (input.status as string) === 'ARCHIVED') {
    throw new MatterValidationError('لا يمكن إنشاء ملف جديد بحالة مؤرشفة.');
  }

  const targetStatus = input.status ?? 'DRAFT';
  if (targetStatus === 'ACTIVE' && !input.initialClientId) {
    throw new LastClientRequiredError('لا يمكن فتح ملف نشط دون تحديد موكل أساسي على الأقل.');
  }

  const prisma = options.prismaOverride ?? getPrismaClient();

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
        const resourceId = extractResourceId(claim);
        const currentMatter = await getMatterInternal(tx, resourceId);
        const opVersion = extractOperationVersion(claim.resultPayload, 1);
        return {
          matter: currentMatter,
          fileCode: currentMatter.fileCode,
          operationVersion: opVersion,
        };
      }

      // 2. Validate references under lock
      await validateActiveReferenceUnderLock(tx, 'PRACTICE_AREA', input.practiceAreaId);
      await validateActiveReferenceUnderLock(tx, 'STORAGE_LOCATION', input.paperLocationId);

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

      // Parse openingDate safely using strict calendar parsing
      const openingDateVal = parseCalendarDateToUtc(input.openingDate);

      // 5. Create Matter
      const matter = await tx.matter.create({
        data: {
          fileCode,
          title: input.title.trim(),
          titleNormalized: normalizeArabicText(input.title),
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
      const matterDTO = await getMatterInternal(tx, matter.id);
      const result: OpenMatterResult = {
        matter: matterDTO,
        fileCode,
        operationVersion: 1,
      };

      // 9. Complete idempotency with minimal safe metadata (zero confidential notes or party secrets)
      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'openMatter',
        key: input.idempotencyKey,
        resultType: 'OpenMatterResult',
        resultId: matter.id,
        resultPayload: {
          operation: 'OPEN_MATTER',
          resourceId: matter.id,
          fileCode,
          version: 1,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const resourceId = extractResourceId(resolved);
        const currentMatter = await getMatterInternal(prisma, resourceId);
        const opVersion = extractOperationVersion(resolved.resultPayload, 1);
        return {
          matter: currentMatter,
          fileCode: currentMatter.fileCode,
          operationVersion: opVersion,
        };
      }
      return openMatter(actor, rawInput, options);
    }
    throw err;
  }
}

export async function updateMatter(
  actor: Actor,
  rawInput: UpdateMatterInput,
  options: ServiceExecutionOptions = {}
): Promise<UpdateMatterResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UpdateMatterInput;
  try {
    input = updateMatterSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const statusStr = String(input.status);
  if (statusStr === 'ARCHIVED' || statusStr === 'DELETED') {
    throw new UnsupportedTransitionError('الانتقال إلى الأرشفة أو الحذف غير مدعوم في هذا الإصدار.');
  }

  const prisma = options.prismaOverride ?? getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateMatter',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const resourceId = extractResourceId(claim);
        const currentMatter = await getMatterInternal(tx, resourceId);
        const opVersion = extractOperationVersion(claim.resultPayload, currentMatter.version);
        return {
          matter: currentMatter,
          operationVersion: opVersion,
        };
      }

      // Lock matter row
      const [existing] = await tx.$queryRaw<Array<{
        id: string;
        version: number;
        status: string;
        practiceAreaId: string | null;
        paperLocationId: string | null;
      }>>`
        SELECT "id", "version", "status", "practiceAreaId", "paperLocationId"
        FROM "matter"
        WHERE "id" = ${input.id}
        FOR UPDATE;
      `;

      if (!existing) {
        throw new NotFoundError('ملف القضية غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      // Validate references under lock (preserving historical unchanged values)
      await validateActiveReferenceUnderLock(tx, 'PRACTICE_AREA', input.practiceAreaId, existing.practiceAreaId);
      await validateActiveReferenceUnderLock(tx, 'STORAGE_LOCATION', input.paperLocationId, existing.paperLocationId);

      // If transitioning to ACTIVE, enforce client check
      if (input.status === 'ACTIVE') {
        const clientCount = await tx.matterParty.count({
          where: { matterId: input.id, role: 'CLIENT' },
        });
        if (clientCount === 0) {
          throw new LastClientRequiredError('لا يمكن تفعيل الملف بدون وجود موكل نشط واحد على الأقل.');
        }
      }

      const openingDateVal = parseCalendarDateToUtc(input.openingDate);
      const closingDateVal = parseCalendarDateToUtc(input.closingDate);

      const nextVersion = existing.version + 1;

      await tx.matter.update({
        where: { id: input.id },
        data: {
          title: input.title.trim(),
          titleNormalized: normalizeArabicText(input.title),
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

      const matterDTO = await getMatterInternal(tx, input.id);
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
        resultPayload: {
          operation: 'UPDATE_MATTER',
          resourceId: input.id,
          version: nextVersion,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const resourceId = extractResourceId(resolved);
        const currentMatter = await getMatterInternal(prisma, resourceId);
        const opVersion = extractOperationVersion(resolved.resultPayload, currentMatter.version);
        return {
          matter: currentMatter,
          operationVersion: opVersion,
        };
      }
      return updateMatter(actor, rawInput, options);
    }
    throw err;
  }
}

export async function linkMatterParty(
  actor: Actor,
  rawInput: LinkMatterPartyInput,
  options: ServiceExecutionOptions = {}
): Promise<MatterPartySummaryDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: LinkMatterPartyInput;
  try {
    input = linkMatterPartySchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = options.prismaOverride ?? getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const partyId = extractResourceId(claim);
        const createdParty = await tx.matterParty.findUnique({
          where: { id: partyId },
          include: { party: true },
        });
        if (!createdParty) throw new NotFoundError('طرف الملف غير موجود.');
        return {
          id: createdParty.id,
          matterId: createdParty.matterId,
          partyId: createdParty.partyId,
          partyName: createdParty.party.name,
          role: createdParty.role,
          isPrimaryContact: createdParty.isPrimaryContact,
          billingEnabled: createdParty.billingEnabled,
          notes: createdParty.notes,
          version: createdParty.version,
          createdAt: createdParty.createdAt.toISOString(),
        };
      }

      // Lock parent matter row
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT "id", "version" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
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

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

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
        resultPayload: {
          operation: 'LINK_MATTER_PARTY',
          resourceId: created.id,
          version: 1,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const partyId = extractResourceId(resolved);
        const createdParty = await prisma.matterParty.findUnique({
          where: { id: partyId },
          include: { party: true },
        });
        if (!createdParty) throw new NotFoundError('طرف الملف غير موجود.');
        return {
          id: createdParty.id,
          matterId: createdParty.matterId,
          partyId: createdParty.partyId,
          partyName: createdParty.party.name,
          role: createdParty.role,
          isPrimaryContact: createdParty.isPrimaryContact,
          billingEnabled: createdParty.billingEnabled,
          notes: createdParty.notes,
          version: createdParty.version,
          createdAt: createdParty.createdAt.toISOString(),
        };
      }
      return linkMatterParty(actor, rawInput, options);
    }
    throw err;
  }
}

export async function updateMatterParty(
  actor: Actor,
  rawInput: UpdateMatterPartyInput,
  options: ServiceExecutionOptions = {}
): Promise<MatterPartySummaryDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UpdateMatterPartyInput;
  try {
    input = updateMatterPartySchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = options.prismaOverride ?? getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateMatterParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const partyId = extractResourceId(claim);
        const currentParty = await tx.matterParty.findUnique({
          where: { id: partyId },
          include: { party: true },
        });
        if (!currentParty) throw new NotFoundError('طرف الملف غير موجود.');
        const opVersion = extractOperationVersion(claim.resultPayload, currentParty.version);
        return {
          id: currentParty.id,
          matterId: currentParty.matterId,
          partyId: currentParty.partyId,
          partyName: currentParty.party.name,
          role: currentParty.role,
          isPrimaryContact: currentParty.isPrimaryContact,
          billingEnabled: currentParty.billingEnabled,
          notes: currentParty.notes,
          version: currentParty.version,
          operationVersion: opVersion,
          createdAt: currentParty.createdAt.toISOString(),
        };
      }

      // Lock parent matter row
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string }>>`
        SELECT "id", "version", "status" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      // Lock party row
      const [existing] = await tx.$queryRaw<Array<{
        id: string;
        matterId: string;
        partyId: string;
        role: string;
        isPrimaryContact: boolean;
        version: number;
      }>>`
        SELECT "id", "matterId", "partyId", "role", "isPrimaryContact", "version"
        FROM "matter_party"
        WHERE "id" = ${input.id}
        FOR UPDATE;
      `;

      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('طرف الملف غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      // If demoting from CLIENT
      if (existing.role === 'CLIENT' && input.role !== 'CLIENT') {
        // Check POA dependencies under lock first
        const linkedPoas = await tx.matterAuthorization.findFirst({
          where: {
            matterId: input.matterId,
            powerOfAttorney: { partyId: existing.partyId },
          },
        });
        if (linkedPoas) {
          throw new ClientPoaDependencyError('لا يمكن تغيير صفة الموكل لوجود توكيلات مرتبطة بهذا الملف.');
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

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

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
        operationVersion: nextVersion,
        createdAt: updated.createdAt.toISOString(),
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateMatterParty',
        key: input.idempotencyKey,
        resultType: 'MatterPartySummaryDTO',
        resultId: updated.id,
        resultPayload: {
          operation: 'UPDATE_MATTER_PARTY',
          resourceId: updated.id,
          version: nextVersion,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const partyId = extractResourceId(resolved);
        const currentParty = await prisma.matterParty.findUnique({
          where: { id: partyId },
          include: { party: true },
        });
        if (!currentParty) throw new NotFoundError('طرف الملف غير موجود.');
        const opVersion = extractOperationVersion(resolved.resultPayload, currentParty.version);
        return {
          id: currentParty.id,
          matterId: currentParty.matterId,
          partyId: currentParty.partyId,
          partyName: currentParty.party.name,
          role: currentParty.role,
          isPrimaryContact: currentParty.isPrimaryContact,
          billingEnabled: currentParty.billingEnabled,
          notes: currentParty.notes,
          version: currentParty.version,
          operationVersion: opVersion,
          createdAt: currentParty.createdAt.toISOString(),
        };
      }
      return updateMatterParty(actor, rawInput, options);
    }
    throw err;
  }
}

export async function unlinkMatterParty(
  actor: Actor,
  rawInput: UnlinkMatterPartyInput
): Promise<void> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UnlinkMatterPartyInput;
  try {
    input = unlinkMatterPartySchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

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

      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string }>>`
        SELECT "id", "version", "status" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      const [existing] = await tx.$queryRaw<Array<{
        id: string;
        matterId: string;
        partyId: string;
        role: string;
        version: number;
      }>>`
        SELECT "id", "matterId", "partyId", "role", "version"
        FROM "matter_party"
        WHERE "id" = ${input.id}
        FOR UPDATE;
      `;
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
          throw new ClientPoaDependencyError('لا يمكن إزالة الموكل لوجود توكيلات مرتبطة بهذا الملف.');
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

      // C02: Cascade removal of linked ProceedingParty records with deterministic Proceeding lock order & version bumps
      const linkedProceedingParties = await tx.proceedingParty.findMany({
        where: { matterPartyId: input.id },
        select: {
          id: true,
          proceedingId: true,
          capacityText: true,
          legalCapacity: true,
        },
      });

      if (linkedProceedingParties.length > 0) {
        const affectedProceedingIds = Array.from(
          new Set(linkedProceedingParties.map((p) => p.proceedingId))
        ).sort();

        // Lock proceedings in deterministic order
        await tx.$queryRaw`
          SELECT "id", "version"
          FROM "proceeding"
          WHERE "id" IN (${Prisma.join(affectedProceedingIds)})
          ORDER BY "id" ASC
          FOR UPDATE;
        `;

        // Advance each affected proceeding's version
        await tx.$executeRaw`
          UPDATE "proceeding"
          SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" IN (${Prisma.join(affectedProceedingIds)});
        `;

        // Record audit events for each cascaded removal
        for (const pp of linkedProceedingParties) {
          await recordAuditEvent(tx, {
            userId: actor.id,
            action: 'PROCEEDING_PARTY_CASCADE_REMOVED',
            entityType: 'ProceedingParty',
            entityId: pp.id,
            changedFields: {
              proceedingId: pp.proceedingId,
              matterPartyId: input.id,
              capacityText: pp.capacityText,
              legalCapacity: pp.legalCapacity,
              reason: 'MATTER_PARTY_UNLINKED',
            },
          });
        }
      }

      await tx.matterParty.delete({
        where: { id: input.id },
      });

      const nextMatterVersion = matter.version + 1;
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = ${nextMatterVersion}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

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
        resultPayload: {
          operation: 'UNLINK_MATTER_PARTY',
          resourceId: input.id,
          version: nextMatterVersion,
          acknowledgedAt: new Date().toISOString(),
        },
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
      return unlinkMatterParty(actor, rawInput);
    }
    throw err;
  }
}

export async function addProceeding(
  actor: Actor,
  rawInput: AddProceedingInput,
  options: ServiceExecutionOptions = {}
): Promise<ProceedingSummaryDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: AddProceedingInput;
  try {
    input = addProceedingSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = options.prismaOverride ?? getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'addProceeding',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const resourceId = extractResourceId(claim);
        const dto = await getProceedingDTO(tx, resourceId);
        const opVersion = extractOperationVersion(claim.resultPayload, dto.version);
        return { ...dto, operationVersion: opVersion };
      }

      // Lock parent matter row
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT "id", "version" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      // Check active court under lock
      await validateActiveReferenceUnderLock(tx, 'COURT', input.courtId, null);

      // Check parent proceeding cycles and cross-matter boundary
      if (input.parentProceedingId) {
        await validateProceedingHierarchy(tx, input.matterId, null, input.parentProceedingId);
      }

      // Check completeness if status is ACTIVE
      const proceedingStatus = input.status ?? 'DRAFT';
      validateProceedingCompleteness(
        proceedingStatus,
        input.numberText,
        input.yearLabel,
        input.registerType,
        input.courtId
      );

      // Check advisory duplicate
      const duplicateWarning = await checkProceedingCourtDuplicate(
        tx,
        input.matterId,
        input.courtId,
        input.registerType,
        input.numberText,
        input.yearLabel
      );

      const filingDateVal = parseCalendarDateToUtc(input.filingDate);

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
          status: proceedingStatus,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: {
          court: true,
          parentProceeding: { include: { court: true } },
          parties: { include: { matterParty: { include: { party: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });

      // Atomically link initial parties/capacities if provided
      if (input.parties && input.parties.length > 0) {
        for (const partyInput of input.parties) {
          const matterParty = await tx.matterParty.findUnique({
            where: { id: partyInput.matterPartyId },
          });
          if (!matterParty) throw new NotFoundError('طرف الملف غير موجود.');
          if (matterParty.matterId !== input.matterId) {
            throw new CrossMatterLinkForbiddenError('لا يمكن ربط صفة تقاضي لطرف غير منضم لنفس ملف القضية.');
          }
          const capacityVal = (partyInput.capacityText?.trim() || (partyInput.legalCapacity ? String(partyInput.legalCapacity) : '')).slice(0, 100);
          if (!capacityVal) {
            throw new MatterValidationError('الصفة القضائية مطلوبة للطرف في القيد القضائي.');
          }
          const createdParty = await tx.proceedingParty.create({
            data: {
              proceedingId: proceeding.id,
              matterPartyId: partyInput.matterPartyId,
              capacityText: capacityVal,
              legalCapacity: partyInput.legalCapacity ?? null,
              notes: partyInput.notes?.trim() ?? null,
              createdById: actor.id,
            },
          });
          await recordAuditEvent(tx, {
            userId: actor.id,
            action: 'LINK_PROCEEDING_PARTY',
            entityType: 'ProceedingParty',
            entityId: createdParty.id,
            changedFields: {
              proceedingId: proceeding.id,
              matterPartyId: partyInput.matterPartyId,
              capacityText: capacityVal,
              legalCapacity: partyInput.legalCapacity ?? null,
              ...(partyInput.notes ? { hasNotes: true } : {}),
            },
          });
        }
      }

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'ADD_PROCEEDING',
        entityType: 'Proceeding',
        entityId: proceeding.id,
        changedFields: { courtId: input.courtId, instance: input.instance, numberText: input.numberText },
      });

      const dto = await getProceedingDTO(tx, proceeding.id);
      dto.duplicateWarning = duplicateWarning;
      dto.operationVersion = 1;

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'addProceeding',
        key: input.idempotencyKey,
        resultType: 'ProceedingSummaryDTO',
        resultId: proceeding.id,
        resultPayload: {
          operation: 'ADD_PROCEEDING',
          resourceId: proceeding.id,
          version: 1,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const resourceId = extractResourceId(resolved);
        const dto = await getProceedingDTO(prisma, resourceId);
        const opVersion = extractOperationVersion(resolved.resultPayload, dto.version);
        return { ...dto, operationVersion: opVersion };
      }
      return addProceeding(actor, rawInput, options);
    }
    throw err;
  }
}

export async function updateProceeding(
  actor: Actor,
  rawInput: UpdateProceedingInput,
  options: ServiceExecutionOptions = {}
): Promise<ProceedingSummaryDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UpdateProceedingInput;
  try {
    input = updateProceedingSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = options.prismaOverride ?? getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateProceeding',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const resourceId = extractResourceId(claim);
        const dto = await getProceedingDTO(tx, resourceId);
        const opVersion = extractOperationVersion(claim.resultPayload, dto.version);
        return { ...dto, operationVersion: opVersion };
      }

      // Lock parent matter row
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT "id", "version" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      // Lock proceeding row
      const [existing] = await tx.$queryRaw<Array<{
        id: string;
        matterId: string;
        courtId: string;
        version: number;
        status: string;
      }>>`
        SELECT "id", "matterId", "courtId", "version", "status"
        FROM "proceeding"
        WHERE "id" = ${input.id}
        FOR UPDATE;
      `;
      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      if (existing.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      // Validate court reference under lock
      await validateActiveReferenceUnderLock(tx, 'COURT', input.courtId, existing.courtId);

      // Validate cycle
      if (input.parentProceedingId) {
        await validateProceedingHierarchy(tx, input.matterId, input.id, input.parentProceedingId);
      }

      // Validate completeness if status is ACTIVE
      validateProceedingCompleteness(
        input.status,
        input.numberText,
        input.yearLabel,
        input.registerType,
        input.courtId
      );

      // Check advisory duplicate
      const duplicateWarning = await checkProceedingCourtDuplicate(
        tx,
        input.matterId,
        input.courtId,
        input.registerType,
        input.numberText,
        input.yearLabel,
        input.id
      );

      const filingDateVal = parseCalendarDateToUtc(input.filingDate);

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
          parties: { include: { matterParty: { include: { party: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });

      // Atomically link / update parties and capacities if provided
      if (input.parties && input.parties.length > 0) {
        for (const partyInput of input.parties) {
          const matterParty = await tx.matterParty.findUnique({
            where: { id: partyInput.matterPartyId },
          });
          if (!matterParty) throw new NotFoundError('طرف الملف غير موجود.');
          if (matterParty.matterId !== input.matterId) {
            throw new CrossMatterLinkForbiddenError('لا يمكن ربط صفة تقاضي لطرف غير منضم لنفس ملف القضية.');
          }
          const capacityVal = (partyInput.capacityText?.trim() || (partyInput.legalCapacity ? String(partyInput.legalCapacity) : '')).slice(0, 100);
          if (!capacityVal) {
            throw new MatterValidationError('الصفة القضائية مطلوبة للطرف في القيد القضائي.');
          }
          const existingParty = await tx.proceedingParty.findUnique({
            where: {
              proceedingId_matterPartyId: {
                proceedingId: input.id,
                matterPartyId: partyInput.matterPartyId,
              },
            },
          });
          if (existingParty) {
            const updatedParty = await tx.proceedingParty.update({
              where: { id: existingParty.id },
              data: {
                capacityText: capacityVal,
                legalCapacity: partyInput.legalCapacity ?? null,
                notes: partyInput.notes !== undefined ? (partyInput.notes?.trim() ?? null) : existingParty.notes,
              },
            });
            await recordAuditEvent(tx, {
              userId: actor.id,
              action: 'UPDATE_PROCEEDING_PARTY',
              entityType: 'ProceedingParty',
              entityId: updatedParty.id,
              changedFields: {
                capacityText: capacityVal,
                legalCapacity: partyInput.legalCapacity ?? null,
                ...(partyInput.notes !== undefined ? { hasNotes: Boolean(partyInput.notes?.trim()) } : {}),
              },
            });
          } else {
            const createdParty = await tx.proceedingParty.create({
              data: {
                proceedingId: input.id,
                matterPartyId: partyInput.matterPartyId,
                capacityText: capacityVal,
                legalCapacity: partyInput.legalCapacity ?? null,
                notes: partyInput.notes?.trim() ?? null,
                createdById: actor.id,
              },
            });
            await recordAuditEvent(tx, {
              userId: actor.id,
              action: 'LINK_PROCEEDING_PARTY',
              entityType: 'ProceedingParty',
              entityId: createdParty.id,
              changedFields: {
                proceedingId: input.id,
                matterPartyId: partyInput.matterPartyId,
                capacityText: capacityVal,
                legalCapacity: partyInput.legalCapacity ?? null,
                ...(partyInput.notes ? { hasNotes: true } : {}),
              },
            });
          }
        }
      }

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'UPDATE_PROCEEDING',
        entityType: 'Proceeding',
        entityId: updated.id,
        changedFields: { numberText: updated.numberText, status: updated.status },
      });

      const dto = await getProceedingDTO(tx, updated.id);
      dto.duplicateWarning = duplicateWarning;
      dto.operationVersion = nextVersion;

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'updateProceeding',
        key: input.idempotencyKey,
        resultType: 'ProceedingSummaryDTO',
        resultId: updated.id,
        resultPayload: {
          operation: 'UPDATE_PROCEEDING',
          resourceId: updated.id,
          version: nextVersion,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const resourceId = extractResourceId(resolved);
        const dto = await getProceedingDTO(prisma, resourceId);
        const opVersion = extractOperationVersion(resolved.resultPayload, dto.version);
        return { ...dto, operationVersion: opVersion };
      }
      return updateProceeding(actor, rawInput, options);
    }
    throw err;
  }
}

export async function linkProceedingParty(
  actor: Actor,
  rawInput: LinkProceedingPartyInput,
  options: ServiceExecutionOptions = {}
): Promise<ProceedingPartySummaryDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: LinkProceedingPartyInput;
  try {
    input = linkProceedingPartySchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = options.prismaOverride ?? getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkProceedingParty',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const resourceId = extractResourceId(claim);
        const dto = await getProceedingPartyDTO(tx, resourceId);
        const opVersion = extractOperationVersion(claim.resultPayload, dto.version ?? 1);
        return { ...dto, operationVersion: opVersion };
      }

      // 1. Look up proceeding to get parent matterId
      const procRef = await tx.proceeding.findUnique({
        where: { id: input.proceedingId },
        select: { id: true, matterId: true },
      });
      if (!procRef) throw new NotFoundError('القيد القضائي غير موجود.');

      // 2. Lock parent matter row FIRST
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT "id", "version" FROM "matter" WHERE "id" = ${procRef.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      // 3. Lock proceeding row SECOND
      const [proceeding] = await tx.$queryRaw<Array<{ id: string; matterId: string; version: number }>>`
        SELECT "id", "matterId", "version" FROM "proceeding" WHERE "id" = ${input.proceedingId} FOR UPDATE;
      `;
      if (!proceeding || proceeding.matterId !== procRef.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      // 4. Validate expectedVersion unconditionally (C01)
      if (proceeding.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError('رقم نسخة القيد القضائي غير متطابق.');
      }

      const matterParty = await tx.matterParty.findUnique({
        where: { id: input.matterPartyId },
        include: { party: true },
      });
      if (!matterParty) throw new NotFoundError('طرف الملف غير موجود.');

      if (proceeding.matterId !== matterParty.matterId) {
        throw new CrossMatterLinkForbiddenError('لا يمكن ربط صفة تقاضي لطرف غير منضم لنفس ملف القضية.');
      }

      const capacityVal = (input.capacityText?.trim() || (input.legalCapacity ? String(input.legalCapacity) : '')).slice(0, 100);

      const existing = await tx.proceedingParty.findUnique({
        where: {
          proceedingId_matterPartyId: {
            proceedingId: input.proceedingId,
            matterPartyId: input.matterPartyId,
          },
        },
      });

      let partyRecord;
      let auditAction: 'LINK_PROCEEDING_PARTY' | 'UPDATE_PROCEEDING_PARTY';

      if (existing) {
        partyRecord = await tx.proceedingParty.update({
          where: { id: existing.id },
          data: {
            capacityText: capacityVal,
            legalCapacity: input.legalCapacity ?? null,
            notes: input.notes !== undefined ? (input.notes?.trim() ?? null) : existing.notes,
          },
        });
        auditAction = 'UPDATE_PROCEEDING_PARTY';
      } else {
        partyRecord = await tx.proceedingParty.create({
          data: {
            proceedingId: input.proceedingId,
            matterPartyId: input.matterPartyId,
            capacityText: capacityVal,
            legalCapacity: input.legalCapacity ?? null,
            notes: input.notes?.trim() ?? null,
            createdById: actor.id,
          },
        });
        auditAction = 'LINK_PROCEEDING_PARTY';
      }

      const nextProceedingVersion = proceeding.version + 1;

      // Increment proceeding version
      await tx.$executeRaw`
        UPDATE "proceeding"
        SET "version" = ${nextProceedingVersion}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${proceeding.id};
      `;

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${proceeding.matterId};
      `;

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: auditAction,
        entityType: 'ProceedingParty',
        entityId: partyRecord.id,
        changedFields: {
          capacityText: capacityVal,
          legalCapacity: input.legalCapacity,
          ...(input.notes !== undefined ? { hasNotes: Boolean(input.notes?.trim()) } : {}),
        },
      });

      const dto: ProceedingPartySummaryDTO = {
        id: partyRecord.id,
        proceedingId: partyRecord.proceedingId,
        matterPartyId: partyRecord.matterPartyId,
        partyName: matterParty.party.name,
        capacityText: partyRecord.capacityText,
        legalCapacity: partyRecord.legalCapacity,
        notes: partyRecord.notes,
        operationVersion: nextProceedingVersion,
      };

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'linkProceedingParty',
        key: input.idempotencyKey,
        resultType: 'ProceedingPartySummaryDTO',
        resultId: partyRecord.id,
        resultPayload: {
          operation: auditAction,
          resourceId: partyRecord.id,
          version: nextProceedingVersion,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const resourceId = extractResourceId(resolved);
        const dto = await getProceedingPartyDTO(prisma, resourceId);
        const opVersion = extractOperationVersion(resolved.resultPayload, dto.version ?? 1);
        return { ...dto, operationVersion: opVersion };
      }
      return linkProceedingParty(actor, rawInput, options);
    }
    throw err;
  }
}

export async function unlinkProceedingParty(
  actor: Actor,
  rawInput: UnlinkProceedingPartyInput
): Promise<void> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UnlinkProceedingPartyInput;
  try {
    input = unlinkProceedingPartySchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

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

      // 1. Look up proceeding to get parent matterId
      const procRef = await tx.proceeding.findUnique({
        where: { id: input.proceedingId },
        select: { id: true, matterId: true },
      });
      if (!procRef) throw new NotFoundError('القيد القضائي غير موجود.');

      // 2. Lock parent matter row FIRST
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT "id", "version" FROM "matter" WHERE "id" = ${procRef.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      // 3. Lock proceeding row SECOND
      const [proceeding] = await tx.$queryRaw<Array<{ id: string; matterId: string; version: number }>>`
        SELECT "id", "matterId", "version" FROM "proceeding" WHERE "id" = ${input.proceedingId} FOR UPDATE;
      `;
      if (!proceeding || proceeding.matterId !== procRef.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      // 4. Validate expectedVersion unconditionally (C01)
      if (proceeding.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError('رقم نسخة القيد القضائي غير متطابق.');
      }

      const existing = await tx.proceedingParty.findUnique({
        where: { id: input.id },
      });
      if (!existing || existing.proceedingId !== input.proceedingId) {
        throw new NotFoundError('صفة التقاضي غير موجودة.');
      }

      await tx.proceedingParty.delete({
        where: { id: input.id },
      });

      const nextProceedingVersion = proceeding.version + 1;

      // Increment proceeding version
      await tx.$executeRaw`
        UPDATE "proceeding"
        SET "version" = ${nextProceedingVersion}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${proceeding.id};
      `;

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${proceeding.matterId};
      `;

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
        resultPayload: {
          operation: 'UNLINK_PROCEEDING_PARTY',
          resourceId: input.id,
          version: nextProceedingVersion,
          acknowledgedAt: new Date().toISOString(),
        },
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
      return unlinkProceedingParty(actor, rawInput);
    }
    throw err;
  }
}

export async function linkMatterAuthorization(
  actor: Actor,
  rawInput: LinkMatterAuthorizationInput
): Promise<MatterAuthorizationSummaryDTO> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: LinkMatterAuthorizationInput;
  try {
    input = linkMatterAuthorizationSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

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
        const resourceId = extractResourceId(claim);
        return await getMatterAuthorizationDTO(tx, resourceId);
      }

      // Lock parent matter row
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT "id", "version" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      const poa = await tx.powerOfAttorney.findUnique({
        where: { id: input.powerOfAttorneyId },
        include: { party: true },
      });
      if (!poa) throw new NotFoundError('سند التوكيل غير موجود.');

      // Invariant: POA party must be a CLIENT in MatterParty for this matter under the lock
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

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

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
        resultPayload: {
          operation: 'LINK_MATTER_AUTHORIZATION',
          resourceId: auth.id,
          version: 1,
          acknowledgedAt: new Date().toISOString(),
        },
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
        const resourceId = extractResourceId(resolved);
        return await getMatterAuthorizationDTO(prisma, resourceId);
      }
      return linkMatterAuthorization(actor, rawInput);
    }
    throw err;
  }
}

export async function unlinkMatterAuthorization(
  actor: Actor,
  rawInput: UnlinkMatterAuthorizationInput
): Promise<void> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: UnlinkMatterAuthorizationInput;
  try {
    input = unlinkMatterAuthorizationSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

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

      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT "id", "version" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      const existing = await tx.matterAuthorization.findUnique({
        where: { id: input.id },
      });
      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('ارتباط التوكيل غير موجود.');
      }

      await tx.matterAuthorization.delete({
        where: { id: input.id },
      });

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

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
        resultPayload: {
          operation: 'UNLINK_MATTER_AUTHORIZATION',
          resourceId: input.id,
          acknowledgedAt: new Date().toISOString(),
        },
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
      return unlinkMatterAuthorization(actor, rawInput);
    }
    throw err;
  }
}

export async function getMatter(matterId: string, actor?: Actor): Promise<MatterDTO> {
  if (!actor || !actor.id) {
    throw new UnauthorizedError('المستخدم غير مصرح له.');
  }
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

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
          parties: { include: { matterParty: { include: { party: true } } }, orderBy: { createdAt: 'asc' } },
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
  rawParams: SearchMattersParams = {},
  actor?: Actor
): Promise<SearchMattersResult> {
  if (!actor || !actor.id) {
    throw new UnauthorizedError('المستخدم غير مصرح له.');
  }
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  let params: SearchMattersParams;
  try {
    params = searchMattersParamsSchema.parse(rawParams);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = getPrismaClient();

  const where: Prisma.MatterWhereInput = {};

  if (params.kind) where.kind = params.kind;
  if (params.status) where.status = params.status;
  if (params.practiceAreaId) where.practiceAreaId = params.practiceAreaId;

  if (params.partyId) {
    where.parties = {
      some: {
        partyId: params.partyId,
        ...(params.role ? { role: params.role } : {}),
      },
    };
  } else if (params.clientId) {
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
    const queryVariants = expandSearchVariants(params.query);
    const normQuery = normalizeArabicText(params.query);

    const orClauses: Prisma.MatterWhereInput[] = [];
    if (normQuery) {
      orClauses.push({ titleNormalized: { contains: normQuery, mode: 'insensitive' } });
    }
    for (const v of queryVariants) {
      orClauses.push({ title: { contains: v, mode: 'insensitive' } });
      orClauses.push({ fileCode: { contains: v, mode: 'insensitive' } });
    }
    where.OR = orClauses;
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
            parties: { include: { matterParty: { include: { party: true } } }, orderBy: { createdAt: 'asc' } },
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

export async function getPartyMatterAssociations(
  actor: Actor,
  rawParams: GetPartyMatterAssociationsParams
): Promise<PartyMatterAssociationsResult> {
  if (!actor || !actor.id) {
    throw new UnauthorizedError('المستخدم غير مصرح له.');
  }
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  let params: GetPartyMatterAssociationsParams;
  try {
    params = getPartyMatterAssociationsSchema.parse(rawParams);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = getPrismaClient();

  const where: Prisma.MatterPartyWhereInput = {
    partyId: params.partyId,
    ...(params.role ? { role: params.role } : {}),
  };

  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const [associations, total] = await Promise.all([
    prisma.matterParty.findMany({
      where,
      include: {
        matter: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.matterParty.count({ where }),
  ]);

  const dtos: PartyMatterAssociationDTO[] = associations.map((mp) => ({
    matterPartyId: mp.id,
    matterId: mp.matter.id,
    fileCode: mp.matter.fileCode,
    title: mp.matter.title,
    kind: mp.matter.kind,
    status: mp.matter.status,
    role: mp.role,
    isPrimaryContact: mp.isPrimaryContact,
    billingEnabled: mp.billingEnabled,
    notes: mp.notes,
    openingDate: mp.matter.openingDate ? mp.matter.openingDate.toISOString().slice(0, 10) : null,
    closingDate: mp.matter.closingDate ? mp.matter.closingDate.toISOString().slice(0, 10) : null,
    createdAt: mp.createdAt.toISOString(),
  }));

  return {
    associations: dtos,
    total,
  };
}

export async function findSimilarProceedings(
  actor: Actor,
  rawParams: FindSimilarProceedingsParams
): Promise<FindSimilarProceedingsResult> {
  if (!actor || !actor.id) {
    throw new UnauthorizedError('المستخدم غير مصرح له.');
  }
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  let params: FindSimilarProceedingsParams;
  try {
    params = findSimilarProceedingsSchema.parse(rawParams);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = getPrismaClient();

  const normNumber = normalizeArabicDigits(params.numberText.trim());
  const normYear = params.yearLabel ? normalizeArabicDigits(params.yearLabel.trim()) : null;

  const where: Prisma.ProceedingWhereInput = {
    courtId: params.courtId,
    ...(params.excludeProceedingId ? { id: { not: params.excludeProceedingId } } : {}),
  };

  const proceedings = await prisma.proceeding.findMany({
    where,
    include: {
      court: true,
      matter: {
        select: { id: true, fileCode: true, title: true },
      },
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
  });

  const candidates: SimilarProceedingCandidateDTO[] = [];
  let hasDirectMatch = false;

  for (const proc of proceedings) {
    if (!proc.numberText) continue;
    const procNormNumber = normalizeArabicDigits(proc.numberText.trim());
    const procNormYear = proc.yearLabel ? normalizeArabicDigits(proc.yearLabel.trim()) : null;

    let reason: string | null = null;
    if (procNormNumber === normNumber && normYear && procNormYear === normYear) {
      reason = 'تطابق تام في رقم الدعوى وسنة القيد في نفس المحكمة';
      hasDirectMatch = true;
    } else if (procNormNumber === normNumber) {
      reason = 'تطابق في رقم الدعوى في نفس المحكمة (سنة مختلفة أو غير محددة)';
    }

    if (reason) {
      candidates.push({
        id: proc.id,
        matterId: proc.matter.id,
        matterFileCode: proc.matter.fileCode,
        matterTitle: proc.matter.title,
        courtId: proc.court.id,
        courtName: proc.court.name,
        instance: proc.instance,
        numberText: proc.numberText,
        yearLabel: proc.yearLabel,
        status: proc.status,
        similarityReason: reason,
      });
    }
  }

  // Sort direct matches first
  candidates.sort((a, b) => {
    const aDirect = a.similarityReason.startsWith('تطابق تام');
    const bDirect = b.similarityReason.startsWith('تطابق تام');
    if (aDirect && !bDirect) return -1;
    if (!aDirect && bDirect) return 1;
    return 0;
  });

  const limit = params.limit ?? 10;
  return {
    candidates: candidates.slice(0, limit),
    hasDirectMatch,
  };
}
