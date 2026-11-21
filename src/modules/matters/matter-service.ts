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
  ArchiveMatterInput,
  ReopenMatterInput,
  ArchiveProceedingInput,
  ReopenProceedingInput,
  LifecycleCommandResult,
  SearchProceedingsParams,
  SearchProceedingsResult,
  UnifiedSearchParams,
  UnifiedSearchResult,
  UnifiedSearchResultItem,
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
  archiveMatterSchema,
  reopenMatterSchema,
  archiveProceedingSchema,
  reopenProceedingSchema,
  searchProceedingsParamsSchema,
  unifiedSearchParamsSchema,
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
  MatterArchivedError,
  ProceedingArchivedError,
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

function extractLifecycleResult(claim: { resultId?: string | null; resultPayload?: unknown }): LifecycleCommandResult | null {
  const payload = claim.resultPayload as Record<string, unknown> | null;
  if (!payload) return null;
  const id = (payload.id as string) || (payload.resourceId as string) || claim.resultId;
  if (!id || payload.version === undefined || !payload.status || !payload.updatedAt) {
    return null;
  }
  return {
    id,
    version: Number(payload.version),
    status: String(payload.status),
    archivedAt: (payload.archivedAt as string | null) ?? null,
    updatedAt: String(payload.updatedAt),
    operationVersion: Number(payload.operationVersion ?? payload.version),
  };
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

function resolveDefaultCapacityText(capacityText?: string | null, legalCapacity?: string | null): string {
  if (capacityText && capacityText.trim()) {
    return capacityText.trim().slice(0, 100);
  }
  switch (legalCapacity) {
    case 'PLAINTIFF': return 'مدعي';
    case 'DEFENDANT': return 'مدعى عليه';
    case 'APPELLANT': return 'مستأنف';
    case 'APPELLEE': return 'مستأنف ضده';
    case 'INTERVENOR': return 'متدخل';
    case 'OTHER': return 'صفة أخرى';
    default: return legalCapacity ? String(legalCapacity).slice(0, 100) : '';
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
    archivedAt: raw.archivedAt ? raw.archivedAt.toISOString() : null,
    archiveReason: raw.archiveReason ?? null,
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
      numberNormalized: pr.numberNormalized ?? null,
      yearNormalized: pr.yearNormalized ?? null,
      filingDate: pr.filingDate ? pr.filingDate.toISOString().slice(0, 10) : null,
      claimAmount: pr.claimAmount ?? null,
      status: pr.status,
      archivedAt: pr.archivedAt ? pr.archivedAt.toISOString() : null,
      archiveReason: pr.archiveReason ?? null,
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
    numberNormalized: proceeding.numberNormalized ?? null,
    yearNormalized: proceeding.yearNormalized ?? null,
    filingDate: proceeding.filingDate ? proceeding.filingDate.toISOString().slice(0, 10) : null,
    claimAmount: proceeding.claimAmount,
    status: proceeding.status,
    archivedAt: proceeding.archivedAt ? proceeding.archivedAt.toISOString() : null,
    archiveReason: proceeding.archiveReason ?? null,
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
        archivedAt: Date | null;
        practiceAreaId: string | null;
        paperLocationId: string | null;
      }>>`
        SELECT "id", "version", "status", "archivedAt", "practiceAreaId", "paperLocationId"
        FROM "matter"
        WHERE "id" = ${input.id}
        FOR UPDATE;
      `;

      if (!existing) {
        throw new NotFoundError('ملف القضية غير موجود.');
      }

      if (existing.status === 'ARCHIVED' || existing.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن تعديله. يرجى إلغاء الأرشفة أولاً.');
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
          operationVersion: extractOperationVersion(claim.resultPayload, createdParty.version),
          createdAt: createdParty.createdAt.toISOString(),
        };
      }

      // Lock parent matter row
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن إضافة أطراف إليه.');
      }

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
        operationVersion: created.version,
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
          operationVersion: extractOperationVersion(resolved.resultPayload, createdParty.version),
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
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن تعديل أطرافه.');
      }

      // Lock party row
      const [existing] = await tx.$queryRaw<Array<{
        id: string;
        matterId: string;
        partyId: string;
        role: string;
        isPrimaryContact: boolean;
        billingEnabled: boolean;
        notes: string | null;
        version: number;
      }>>`
        SELECT "id", "matterId", "partyId", "role", "isPrimaryContact", "billingEnabled", "notes", "version"
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
          isPrimaryContact: input.isPrimaryContact ?? existing.isPrimaryContact,
          billingEnabled: input.billingEnabled ?? existing.billingEnabled,
          notes: input.notes !== undefined ? (input.notes?.trim() ?? null) : existing.notes,
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

      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن حذف أطراف منه.');
      }

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
        const lockedProceedings = await tx.$queryRaw<Array<{
          id: string;
          version: number;
          archivedAt: Date | null;
        }>>`
          SELECT "id", "version", "archivedAt"
          FROM "proceeding"
          WHERE "id" IN (${Prisma.join(affectedProceedingIds)})
          ORDER BY "id" ASC
          FOR UPDATE;
        `;

        const hasArchivedProceeding = lockedProceedings.some((p) => p.archivedAt !== null);
        if (hasArchivedProceeding) {
          throw new ProceedingArchivedError(
            'لا يمكن إزالة طرف الملف لارتباطه بقيد قضائي مؤرشف. يجب إلغاء أرشفة القيد القضائي أولاً.'
          );
        }

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
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن إضافة قيود قضائية عليه.');
      }

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

      const normNumber = input.numberText?.trim() ? normalizeArabicDigits(input.numberText.trim()) : null;
      const normYear = input.yearLabel?.trim() ? normalizeArabicDigits(input.yearLabel.trim()) : null;

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
          numberNormalized: normNumber,
          yearNormalized: normYear,
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
          const capacityVal = resolveDefaultCapacityText(partyInput.capacityText, partyInput.legalCapacity);
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
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن تعديل القيود القضائية التابعة له.');
      }

      // Lock proceeding row
      const [existing] = await tx.$queryRaw<Array<{
        id: string;
        matterId: string;
        courtId: string;
        version: number;
        status: string;
        archivedAt: Date | null;
      }>>`
        SELECT "id", "matterId", "courtId", "version", "status", "archivedAt"
        FROM "proceeding"
        WHERE "id" = ${input.id}
        FOR UPDATE;
      `;
      if (!existing || existing.matterId !== input.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      if (existing.archivedAt !== null) {
        throw new ProceedingArchivedError('القيد القضائي مؤرشف ولا يمكن تعديله. يرجى إلغاء الأرشفة أولاً.');
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

      const normNumber = input.numberText?.trim() ? normalizeArabicDigits(input.numberText.trim()) : null;
      const normYear = input.yearLabel?.trim() ? normalizeArabicDigits(input.yearLabel.trim()) : null;

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
          numberNormalized: normNumber,
          yearNormalized: normYear,
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

      // Atomically reconcile proceeding-party membership. `parties: undefined`
      // means "leave membership unchanged"; an explicit array (including [])
      // is the desired set, so links omitted from it are removed with audit.
      if (input.parties !== undefined) {
        const desiredIds = new Set(input.parties.map((p) => p.matterPartyId));
        const existingLinks = await tx.proceedingParty.findMany({
          where: { proceedingId: input.id },
          select: { id: true, matterPartyId: true },
        });
        for (const link of existingLinks) {
          if (!desiredIds.has(link.matterPartyId)) {
            await tx.proceedingParty.delete({ where: { id: link.id } });
            await recordAuditEvent(tx, {
              userId: actor.id,
              action: 'UNLINK_PROCEEDING_PARTY',
              entityType: 'ProceedingParty',
              entityId: link.id,
              changedFields: {
                proceedingId: input.id,
                matterPartyId: link.matterPartyId,
              },
            });
          }
        }

        for (const partyInput of input.parties) {
          const matterParty = await tx.matterParty.findUnique({
            where: { id: partyInput.matterPartyId },
          });
          if (!matterParty) throw new NotFoundError('طرف الملف غير موجود.');
          if (matterParty.matterId !== input.matterId) {
            throw new CrossMatterLinkForbiddenError('لا يمكن ربط صفة تقاضي لطرف غير منضم لنفس ملف القضية.');
          }
          const capacityVal = resolveDefaultCapacityText(partyInput.capacityText, partyInput.legalCapacity);
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
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${procRef.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن تعديل القيود التابعة له.');
      }

      // 3. Lock proceeding row SECOND
      const [proceeding] = await tx.$queryRaw<Array<{ id: string; matterId: string; version: number; archivedAt: Date | null }>>`
        SELECT "id", "matterId", "version", "archivedAt" FROM "proceeding" WHERE "id" = ${input.proceedingId} FOR UPDATE;
      `;
      if (!proceeding || proceeding.matterId !== procRef.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      if (proceeding.archivedAt !== null) {
        throw new ProceedingArchivedError('القيد القضائي مؤرشف ولا يمكن إضافة صفات تقاضي إليه.');
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

      const capacityVal = resolveDefaultCapacityText(input.capacityText, input.legalCapacity);

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
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${procRef.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن تعديل القيود التابعة له.');
      }

      // 3. Lock proceeding row SECOND
      const [proceeding] = await tx.$queryRaw<Array<{ id: string; matterId: string; version: number; archivedAt: Date | null }>>`
        SELECT "id", "matterId", "version", "archivedAt" FROM "proceeding" WHERE "id" = ${input.proceedingId} FOR UPDATE;
      `;
      if (!proceeding || proceeding.matterId !== procRef.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      if (proceeding.archivedAt !== null) {
        throw new ProceedingArchivedError('القيد القضائي مؤرشف ولا يمكن حذف صفات تقاضي منه.');
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
        const dto = await getMatterAuthorizationDTO(tx, resourceId);
        return {
          ...dto,
          operationVersion: extractOperationVersion(claim.resultPayload, 1),
        };
      }

      // Lock parent matter row
      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن ربط توكيلات به.');
      }

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
        operationVersion: 1,
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
        const dto = await getMatterAuthorizationDTO(prisma, resourceId);
        return {
          ...dto,
          operationVersion: extractOperationVersion(resolved.resultPayload, 1),
        };
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

      const [matter] = await tx.$queryRaw<Array<{ id: string; version: number; status: string; archivedAt: Date | null }>>`
        SELECT "id", "version", "status", "archivedAt" FROM "matter" WHERE "id" = ${input.matterId} FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن إلغاء ربط توكيلات منه.');
      }

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
  if (params.practiceAreaId) where.practiceAreaId = params.practiceAreaId;

  if (params.status) {
    where.status = params.status;
  } else if (!params.includeArchived) {
    where.archivedAt = null;
    where.status = { not: 'ARCHIVED' };
  }

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

  if (params.incompleteData) {
    const incompleteClauses: Prisma.MatterWhereInput[] = [
      { status: 'ACTIVE', paperLocationId: null },
      { parties: { none: { role: 'CLIENT' } } },
      { proceedings: { some: { status: 'DRAFT' } } },
    ];
    if (where.AND) {
      if (Array.isArray(where.AND)) {
        where.AND.push({ OR: incompleteClauses });
      } else {
        where.AND = [where.AND, { OR: incompleteClauses }];
      }
    } else {
      where.AND = [{ OR: incompleteClauses }];
    }
  }

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = params.page ?? (params.offset ? Math.floor(params.offset / limit) + 1 : 1);
  const skip = (page - 1) * limit;

  const [matters, total] = await Promise.all([
    prisma.matter.findMany({
      where,
      select: {
        id: true,
        fileCode: true,
        title: true,
        kind: true,
        status: true,
        archivedAt: true,
        openingDate: true,
        practiceArea: { select: { name: true } },
        paperLocation: { select: { name: true } },
        parties: {
          where: { role: 'CLIENT' },
          orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { party: { select: { name: true } } },
        },
        _count: { select: { parties: { where: { role: 'CLIENT' } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip,
    }),
    prisma.matter.count({ where }),
  ]);

  return {
    matters: matters.map((matter) => ({
      id: matter.id,
      fileCode: matter.fileCode,
      title: matter.title,
      kind: matter.kind,
      status: matter.status,
      archivedAt: matter.archivedAt?.toISOString() ?? null,
      openingDate: matter.openingDate?.toISOString().slice(0, 10) ?? null,
      practiceAreaName: matter.practiceArea?.name ?? null,
      paperLocationName: matter.paperLocation?.name ?? null,
      primaryClientName: matter.parties[0]?.party.name ?? null,
      clientCount: matter._count.parties,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit) || 1,
    limit,
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
      select: {
        id: true,
        role: true,
        isPrimaryContact: true,
        matter: { select: { id: true, fileCode: true, title: true, status: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
    status: mp.matter.status,
    role: mp.role,
    isPrimaryContact: mp.isPrimaryContact,
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

  // Filter the normalized docket identity in SQL before the result limit. A
  // fixed "latest 100 rows, then filter in memory" window hides older matches
  // whenever the court has enough newer unrelated proceedings.
  const excludeClause = params.excludeProceedingId
    ? Prisma.sql`AND p."id" <> ${params.excludeProceedingId}`
    : Prisma.empty;

  // S6: prioritize exact year match in SQL before LIMIT 100 so older exact matches
  // are never hidden by 100+ newer entries in the same court with the same number but different years.
  const yearPriorityClause = normYear
    ? Prisma.sql`CASE WHEN trim(translate(COALESCE(p."yearLabel", ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')) = ${normYear} THEN 0 ELSE 1 END ASC,`
    : Prisma.empty;

  const proceedings = await prisma.$queryRaw<Array<{
    id: string;
    matterId: string;
    courtId: string;
    instance: string;
    numberText: string | null;
    yearLabel: string | null;
    status: string;
    fileCode: string;
    title: string;
    courtName: string;
  }>>`
    SELECT
      p."id", p."matterId", p."courtId", p."instance", p."numberText",
      p."yearLabel", p."status", m."fileCode", m."title", c."name" AS "courtName"
    FROM "proceeding" p
    JOIN "matter" m ON m."id" = p."matterId"
    JOIN "court" c ON c."id" = p."courtId"
    WHERE p."courtId" = ${params.courtId}
      AND p."numberText" IS NOT NULL
      AND trim(translate(p."numberText", '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')) = ${normNumber}
      ${excludeClause}
    ORDER BY
      ${yearPriorityClause}
      p."createdAt" DESC
    LIMIT 100
  `;

  const candidates: SimilarProceedingCandidateDTO[] = [];
  let hasDirectMatch = false;

  for (const proc of proceedings) {
    if (!proc.numberText) continue;
    const procNormYear = proc.yearLabel ? normalizeArabicDigits(proc.yearLabel.trim()) : null;

    let reason: string | null = null;
    if (normYear && procNormYear === normYear) {
      reason = 'تطابق تام في رقم الدعوى وسنة القيد في نفس المحكمة';
      hasDirectMatch = true;
    } else {
      reason = 'تطابق في رقم الدعوى في نفس المحكمة (سنة مختلفة أو غير محددة)';
    }

    candidates.push({
      id: proc.id,
      matterId: proc.matterId,
      matterFileCode: proc.fileCode,
      matterTitle: proc.title,
      courtId: proc.courtId,
      courtName: proc.courtName,
      instance: proc.instance as SimilarProceedingCandidateDTO['instance'],
      numberText: proc.numberText,
      yearLabel: proc.yearLabel,
      status: proc.status as SimilarProceedingCandidateDTO['status'],
      similarityReason: reason,
    });
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

export async function archiveMatter(
  actor: Actor,
  rawInput: ArchiveMatterInput,
  options: ServiceExecutionOptions = {}
): Promise<LifecycleCommandResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: ArchiveMatterInput;
  try {
    input = archiveMatterSchema.parse(rawInput);
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
        commandType: 'archiveMatter',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const replayResult = extractLifecycleResult(claim);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(claim);
        const m = await tx.matter.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (!m) throw new NotFoundError('ملف القضية غير موجود.');
        const opVersion = extractOperationVersion(claim.resultPayload, m.version);
        return {
          id: m.id,
          version: m.version,
          status: m.status,
          archivedAt: m.archivedAt?.toISOString() ?? null,
          updatedAt: m.updatedAt.toISOString(),
          operationVersion: opVersion,
        };
      }

      // Lock matter row
      const [matter] = await tx.$queryRaw<Array<{
        id: string;
        version: number;
        status: string;
        archivedAt: Date | null;
      }>>`
        SELECT "id", "version", "status", "archivedAt"
        FROM "matter"
        WHERE "id" = ${input.matterId}
        FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new UnsupportedTransitionError('ملف القضية مؤرشف بالفعل ولا يمكن إعادة أرشفته.');
      }

      // =========================================================================
      // CRITICAL OBLIGATION EXTENSION POINT (T08 / T09)
      // =========================================================================
      // In accordance with WORKFLOWS.md Section 11:
      // A SCHEDULED hearing or an open CONFIRMED legal deadline blocks archiving the matter.
      // In T07, Hearing and Deadline tables do not exist yet in Prisma schema.
      // When T08 introduces Hearing:
      //   const scheduledHearings = await tx.hearing.count({
      //     where: { proceeding: { matterId: input.matterId }, status: 'SCHEDULED' }
      //   });
      //   if (scheduledHearings > 0) throw new ActiveObligationError('لا يمكن أرشفة ملف القضية لوجود جلسات مجدولة قائمة.');
      // When T09 introduces Deadline:
      //   const openDeadlines = await tx.deadline.count({
      //     where: { matterId: input.matterId, status: 'CONFIRMED', completedAt: null }
      //   });
      //   if (openDeadlines > 0) throw new ActiveObligationError('لا يمكن أرشفة ملف القضية لوجود مواعيد قانونية مؤكدة غير مكتملة.');
      // =========================================================================

      const now = new Date();
      const nextVersion = matter.version + 1;

      const updated = await tx.matter.update({
        where: { id: input.matterId },
        data: {
          status: 'ARCHIVED',
          archivedAt: now,
          archiveReason: input.reason.trim(),
          version: nextVersion,
          updatedById: actor.id,
        },
        select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'ARCHIVE_MATTER',
        entityType: 'Matter',
        entityId: updated.id,
        changedFields: {
          previousStatus: matter.status,
          newStatus: 'ARCHIVED',
          archiveReason: input.reason.trim(),
          archivedAt: now.toISOString(),
        },
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'archiveMatter',
        key: input.idempotencyKey,
        resultType: 'LifecycleCommandResult',
        resultId: updated.id,
        resultPayload: {
          operation: 'ARCHIVE_MATTER',
          id: updated.id,
          resourceId: updated.id,
          version: updated.version,
          status: updated.status,
          archivedAt: updated.archivedAt?.toISOString() ?? null,
          updatedAt: updated.updatedAt.toISOString(),
          operationVersion: updated.version,
        },
      });

      return {
        id: updated.id,
        version: updated.version,
        status: updated.status,
        archivedAt: updated.archivedAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt.toISOString(),
        operationVersion: updated.version,
      };
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'archiveMatter',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        const replayResult = extractLifecycleResult(resolved);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(resolved);
        const m = await prisma.matter.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (m) {
          return {
            id: m.id,
            version: m.version,
            status: m.status,
            archivedAt: m.archivedAt?.toISOString() ?? null,
            updatedAt: m.updatedAt.toISOString(),
            operationVersion: extractOperationVersion(resolved.resultPayload, m.version),
          };
        }
      }
      return archiveMatter(actor, rawInput, options);
    }
    throw err;
  }
}

export async function reopenMatter(
  actor: Actor,
  rawInput: ReopenMatterInput,
  options: ServiceExecutionOptions = {}
): Promise<LifecycleCommandResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: ReopenMatterInput;
  try {
    input = reopenMatterSchema.parse(rawInput);
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
        commandType: 'reopenMatter',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const replayResult = extractLifecycleResult(claim);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(claim);
        const m = await tx.matter.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (!m) throw new NotFoundError('ملف القضية غير موجود.');
        const opVersion = extractOperationVersion(claim.resultPayload, m.version);
        return {
          id: m.id,
          version: m.version,
          status: m.status,
          archivedAt: m.archivedAt?.toISOString() ?? null,
          updatedAt: m.updatedAt.toISOString(),
          operationVersion: opVersion,
        };
      }

      // Lock matter row
      const [matter] = await tx.$queryRaw<Array<{
        id: string;
        version: number;
        status: string;
        archivedAt: Date | null;
      }>>`
        SELECT "id", "version", "status", "archivedAt"
        FROM "matter"
        WHERE "id" = ${input.matterId}
        FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      if (matter.status !== 'ARCHIVED' || matter.archivedAt === null) {
        throw new UnsupportedTransitionError('لا يمكن إلغاء أرشفة ملف قضية غير مؤرشف.');
      }

      // Check client presence to determine target status (ACTIVE if client present, else DRAFT)
      const clientCount = await tx.matterParty.count({
        where: { matterId: input.matterId, role: 'CLIENT' },
      });
      const restoredStatus = clientCount > 0 ? 'ACTIVE' : 'DRAFT';

      const nextVersion = matter.version + 1;

      const updated = await tx.matter.update({
        where: { id: input.matterId },
        data: {
          status: restoredStatus,
          archivedAt: null,
          archiveReason: null,
          version: nextVersion,
          updatedById: actor.id,
        },
        select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
      });

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'REOPEN_MATTER',
        entityType: 'Matter',
        entityId: updated.id,
        changedFields: {
          previousStatus: matter.status,
          newStatus: restoredStatus,
          reopenReason: input.reason.trim(),
        },
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'reopenMatter',
        key: input.idempotencyKey,
        resultType: 'LifecycleCommandResult',
        resultId: updated.id,
        resultPayload: {
          operation: 'REOPEN_MATTER',
          id: updated.id,
          resourceId: updated.id,
          version: updated.version,
          status: updated.status,
          archivedAt: null,
          updatedAt: updated.updatedAt.toISOString(),
          operationVersion: updated.version,
        },
      });

      return {
        id: updated.id,
        version: updated.version,
        status: updated.status,
        archivedAt: null,
        updatedAt: updated.updatedAt.toISOString(),
        operationVersion: updated.version,
      };
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'reopenMatter',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        const replayResult = extractLifecycleResult(resolved);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(resolved);
        const m = await prisma.matter.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (m) {
          return {
            id: m.id,
            version: m.version,
            status: m.status,
            archivedAt: m.archivedAt?.toISOString() ?? null,
            updatedAt: m.updatedAt.toISOString(),
            operationVersion: extractOperationVersion(resolved.resultPayload, m.version),
          };
        }
      }
      return reopenMatter(actor, rawInput, options);
    }
    throw err;
  }
}

export async function archiveProceeding(
  actor: Actor,
  rawInput: ArchiveProceedingInput,
  options: ServiceExecutionOptions = {}
): Promise<LifecycleCommandResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: ArchiveProceedingInput;
  try {
    input = archiveProceedingSchema.parse(rawInput);
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
        commandType: 'archiveProceeding',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const replayResult = extractLifecycleResult(claim);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(claim);
        const p = await tx.proceeding.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (!p) throw new NotFoundError('القيد القضائي غير موجود.');
        const opVersion = extractOperationVersion(claim.resultPayload, p.version);
        return {
          id: p.id,
          version: p.version,
          status: p.status,
          archivedAt: p.archivedAt?.toISOString() ?? null,
          updatedAt: p.updatedAt.toISOString(),
          operationVersion: opVersion,
        };
      }

      // Lock parent matter row FIRST
      const [matter] = await tx.$queryRaw<Array<{
        id: string;
        version: number;
        status: string;
        archivedAt: Date | null;
      }>>`
        SELECT "id", "version", "status", "archivedAt"
        FROM "matter"
        WHERE "id" = ${input.matterId}
        FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('ملف القضية مؤرشف ولا يمكن تعديل قيوده بشكل منفرد.');
      }

      // Lock proceeding row SECOND
      const [proceeding] = await tx.$queryRaw<Array<{
        id: string;
        matterId: string;
        version: number;
        status: string;
        archivedAt: Date | null;
      }>>`
        SELECT "id", "matterId", "version", "status", "archivedAt"
        FROM "proceeding"
        WHERE "id" = ${input.proceedingId}
        FOR UPDATE;
      `;
      if (!proceeding || proceeding.matterId !== input.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      if (proceeding.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      if (proceeding.archivedAt !== null) {
        throw new UnsupportedTransitionError('القيد القضائي مؤرشف بالفعل ولا يمكن إعادة أرشفته.');
      }

      // =========================================================================
      // CRITICAL OBLIGATION EXTENSION POINT (T08 / T09)
      // =========================================================================
      // In accordance with WORKFLOWS.md Section 11:
      // A SCHEDULED hearing or an open CONFIRMED legal deadline blocks archiving the proceeding.
      // In T07, Hearing and Deadline tables do not exist yet in Prisma schema.
      // When T08 introduces Hearing:
      //   const scheduledHearings = await tx.hearing.count({
      //     where: { proceedingId: input.proceedingId, status: 'SCHEDULED' }
      //   });
      //   if (scheduledHearings > 0) throw new ActiveObligationError('لا يمكن أرشفة القيد القضائي لوجود جلسات مجدولة قائمة.');
      // When T09 introduces Deadline:
      //   const openDeadlines = await tx.deadline.count({
      //     where: { proceedingId: input.proceedingId, status: 'CONFIRMED', completedAt: null }
      //   });
      //   if (openDeadlines > 0) throw new ActiveObligationError('لا يمكن أرشفة القيد القضائي لوجود مواعيد قانونية مؤكدة غير مكتملة.');
      // =========================================================================

      const now = new Date();
      const nextProceedingVersion = proceeding.version + 1;

      const updated = await tx.proceeding.update({
        where: { id: input.proceedingId },
        data: {
          archivedAt: now,
          archiveReason: input.reason.trim(),
          version: nextProceedingVersion,
          updatedById: actor.id,
        },
        select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
      });

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'ARCHIVE_PROCEEDING',
        entityType: 'Proceeding',
        entityId: updated.id,
        changedFields: {
          matterId: input.matterId,
          archiveReason: input.reason.trim(),
          archivedAt: now.toISOString(),
        },
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'archiveProceeding',
        key: input.idempotencyKey,
        resultType: 'LifecycleCommandResult',
        resultId: updated.id,
        resultPayload: {
          operation: 'ARCHIVE_PROCEEDING',
          id: updated.id,
          resourceId: updated.id,
          version: updated.version,
          status: updated.status,
          archivedAt: updated.archivedAt?.toISOString() ?? null,
          updatedAt: updated.updatedAt.toISOString(),
          operationVersion: updated.version,
        },
      });

      return {
        id: updated.id,
        version: updated.version,
        status: updated.status,
        archivedAt: updated.archivedAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt.toISOString(),
        operationVersion: updated.version,
      };
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'archiveProceeding',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        const replayResult = extractLifecycleResult(resolved);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(resolved);
        const p = await prisma.proceeding.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (p) {
          return {
            id: p.id,
            version: p.version,
            status: p.status,
            archivedAt: p.archivedAt?.toISOString() ?? null,
            updatedAt: p.updatedAt.toISOString(),
            operationVersion: extractOperationVersion(resolved.resultPayload, p.version),
          };
        }
      }
      return archiveProceeding(actor, rawInput, options);
    }
    throw err;
  }
}

export async function reopenProceeding(
  actor: Actor,
  rawInput: ReopenProceedingInput,
  options: ServiceExecutionOptions = {}
): Promise<LifecycleCommandResult> {
  assertActorAuthorized(actor, 'WRITE_CLIENT_DATA');

  let input: ReopenProceedingInput;
  try {
    input = reopenProceedingSchema.parse(rawInput);
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
        commandType: 'reopenProceeding',
        key: input.idempotencyKey,
        payload: input,
      });

      if (claim.isReplay) {
        const replayResult = extractLifecycleResult(claim);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(claim);
        const p = await tx.proceeding.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (!p) throw new NotFoundError('القيد القضائي غير موجود.');
        const opVersion = extractOperationVersion(claim.resultPayload, p.version);
        return {
          id: p.id,
          version: p.version,
          status: p.status,
          archivedAt: p.archivedAt?.toISOString() ?? null,
          updatedAt: p.updatedAt.toISOString(),
          operationVersion: opVersion,
        };
      }

      // Lock parent matter row FIRST
      const [matter] = await tx.$queryRaw<Array<{
        id: string;
        version: number;
        status: string;
        archivedAt: Date | null;
      }>>`
        SELECT "id", "version", "status", "archivedAt"
        FROM "matter"
        WHERE "id" = ${input.matterId}
        FOR UPDATE;
      `;
      if (!matter) throw new NotFoundError('ملف القضية غير موجود.');

      if (matter.status === 'ARCHIVED' || matter.archivedAt !== null) {
        throw new MatterArchivedError('لا يمكن إلغاء أرشفة قيد قضائي تابع لملف مؤرشف. يجب إلغاء أرشفة ملف القضية أولاً.');
      }

      // Lock proceeding row SECOND
      const [proceeding] = await tx.$queryRaw<Array<{
        id: string;
        matterId: string;
        version: number;
        status: string;
        archivedAt: Date | null;
      }>>`
        SELECT "id", "matterId", "version", "status", "archivedAt"
        FROM "proceeding"
        WHERE "id" = ${input.proceedingId}
        FOR UPDATE;
      `;
      if (!proceeding || proceeding.matterId !== input.matterId) {
        throw new NotFoundError('القيد القضائي غير موجود.');
      }

      if (proceeding.version !== input.expectedVersion) {
        throw new ConcurrencyConflictError();
      }

      if (proceeding.archivedAt === null) {
        throw new UnsupportedTransitionError('لا يمكن إلغاء أرشفة قيد قضائي غير مؤرشف.');
      }

      const nextProceedingVersion = proceeding.version + 1;

      const updated = await tx.proceeding.update({
        where: { id: input.proceedingId },
        data: {
          archivedAt: null,
          archiveReason: null,
          version: nextProceedingVersion,
          updatedById: actor.id,
        },
        select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
      });

      // Increment parent matter version
      await tx.$executeRaw`
        UPDATE "matter"
        SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.matterId};
      `;

      await recordAuditEvent(tx, {
        userId: actor.id,
        action: 'REOPEN_PROCEEDING',
        entityType: 'Proceeding',
        entityId: updated.id,
        changedFields: {
          matterId: input.matterId,
          reopenReason: input.reason.trim(),
        },
      });

      await completeIdempotencyKey(tx, {
        actorId: actor.id,
        commandType: 'reopenProceeding',
        key: input.idempotencyKey,
        resultType: 'LifecycleCommandResult',
        resultId: updated.id,
        resultPayload: {
          operation: 'REOPEN_PROCEEDING',
          id: updated.id,
          resourceId: updated.id,
          version: updated.version,
          status: updated.status,
          archivedAt: null,
          updatedAt: updated.updatedAt.toISOString(),
          operationVersion: updated.version,
        },
      });

      return {
        id: updated.id,
        version: updated.version,
        status: updated.status,
        archivedAt: null,
        updatedAt: updated.updatedAt.toISOString(),
        operationVersion: updated.version,
      };
    });
  } catch (err) {
    if (isIdempotencyUniqueConflict(err)) {
      const resolved = await resolveConcurrentIdempotency(prisma, {
        actorId: actor.id,
        commandType: 'reopenProceeding',
        key: input.idempotencyKey,
        payload: input,
      });
      if (resolved) {
        const replayResult = extractLifecycleResult(resolved);
        if (replayResult) {
          return replayResult;
        }
        const resourceId = extractResourceId(resolved);
        const p = await prisma.proceeding.findUnique({
          where: { id: resourceId },
          select: { id: true, version: true, status: true, archivedAt: true, updatedAt: true },
        });
        if (p) {
          return {
            id: p.id,
            version: p.version,
            status: p.status,
            archivedAt: p.archivedAt?.toISOString() ?? null,
            updatedAt: p.updatedAt.toISOString(),
            operationVersion: extractOperationVersion(resolved.resultPayload, p.version),
          };
        }
      }
      return reopenProceeding(actor, rawInput, options);
    }
    throw err;
  }
}

export async function searchProceedings(
  rawParams: SearchProceedingsParams = {},
  actor?: Actor
): Promise<SearchProceedingsResult> {
  if (!actor || !actor.id) {
    throw new UnauthorizedError('المستخدم غير مصرح له.');
  }
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  let params: SearchProceedingsParams;
  try {
    params = searchProceedingsParamsSchema.parse(rawParams);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = getPrismaClient();

  const where: Prisma.ProceedingWhereInput = {};

  if (params.courtId) where.courtId = params.courtId;
  if (params.matterId) where.matterId = params.matterId;
  if (params.status) where.status = params.status;
  if (params.instance) where.instance = params.instance;

  if (!params.includeArchived) {
    where.archivedAt = null;
    where.matter = { archivedAt: null, status: { not: 'ARCHIVED' } };
  }

  if (params.query && params.query.trim().length > 0) {
    const q = params.query.trim();
    const normDigits = normalizeArabicDigits(q);
    const normText = normalizeArabicText(q);
    const variants = expandSearchVariants(q);

    const orClauses: Prisma.ProceedingWhereInput[] = [
      { numberText: { contains: q, mode: 'insensitive' } },
      { numberNormalized: { contains: normDigits, mode: 'insensitive' } },
      { yearLabel: { contains: q, mode: 'insensitive' } },
      { yearNormalized: { contains: normDigits, mode: 'insensitive' } },
      { circuit: { contains: q, mode: 'insensitive' } },
      { registerType: { contains: q, mode: 'insensitive' } },
      { court: { name: { contains: q, mode: 'insensitive' } } },
      { matter: { title: { contains: q, mode: 'insensitive' } } },
      { matter: { fileCode: { contains: q, mode: 'insensitive' } } },
    ];

    if (normText) {
      orClauses.push({ court: { name: { contains: normText, mode: 'insensitive' } } });
      orClauses.push({ matter: { titleNormalized: { contains: normText, mode: 'insensitive' } } });
    }

    for (const v of variants) {
      orClauses.push({ numberText: { contains: v, mode: 'insensitive' } });
      orClauses.push({ circuit: { contains: v, mode: 'insensitive' } });
    }

    where.OR = orClauses;
  }

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const page = params.page ?? (params.offset ? Math.floor(params.offset / limit) + 1 : 1);
  const skip = (page - 1) * limit;

  const [proceedings, total] = await Promise.all([
    prisma.proceeding.findMany({
      where,
      select: {
        id: true,
        matterId: true,
        courtId: true,
        instance: true,
        registerType: true,
        circuit: true,
        numberText: true,
        yearLabel: true,
        status: true,
        archivedAt: true,
        updatedAt: true,
        court: { select: { name: true } },
        matter: { select: { title: true, fileCode: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip,
    }),
    prisma.proceeding.count({ where }),
  ]);

  return {
    proceedings: proceedings.map((p) => ({
      id: p.id,
      matterId: p.matterId,
      matterTitle: p.matter.title,
      matterFileCode: p.matter.fileCode,
      courtId: p.courtId,
      courtName: p.court.name,
      instance: p.instance,
      registerType: p.registerType,
      circuit: p.circuit,
      numberText: p.numberText,
      yearLabel: p.yearLabel,
      status: p.status,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      updatedAt: p.updatedAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit) || 1,
    limit,
  };
}

function mapPartyToUnifiedItem(p: {
  id: string;
  name: string;
  kind: string;
  primaryPhone: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
}): UnifiedSearchResultItem {
  const subtitle = p.primaryPhone ? p.primaryPhone : (p.kind === 'PERSON' ? 'شخص طبيعي' : 'جهة اعتبارية / منشأة');
  return {
    id: p.id,
    entityType: 'PARTY',
    title: p.name,
    subtitle: subtitle || 'طرف',
    badge: p.kind === 'PERSON' ? 'فرد' : 'جهة',
    href: `/parties/${p.id}`,
    isArchived: Boolean(p.archivedAt),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function mapMatterToUnifiedItem(m: {
  id: string;
  fileCode: string;
  title: string;
  kind: string;
  status: string;
  archivedAt: Date | null;
  updatedAt: Date;
  parties?: Array<{ party: { name: string } }>;
}): UnifiedSearchResultItem {
  const primaryClient = m.parties?.[0]?.party.name;
  return {
    id: m.id,
    entityType: 'MATTER',
    title: m.title,
    subtitle: `${m.fileCode}${primaryClient ? ` • ${primaryClient}` : ''}`,
    code: m.fileCode,
    badge: m.status === 'ARCHIVED' ? 'مؤرشف' : (m.status === 'ACTIVE' ? 'نشط' : 'مسودة'),
    href: `/matters/${m.id}`,
    isArchived: Boolean(m.archivedAt),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function mapProceedingToUnifiedItem(p: {
  id: string;
  matterId: string;
  courtId: string;
  instance: string;
  registerType: string | null;
  circuit: string | null;
  numberText: string | null;
  yearLabel: string | null;
  status: string;
  archivedAt: Date | null;
  updatedAt: Date;
  court: { name: string };
  matter: { title: string; fileCode: string };
}): UnifiedSearchResultItem {
  const docket = `${p.numberText ?? 'بدون رقم'}/${p.yearLabel ?? ''}`;
  return {
    id: p.id,
    entityType: 'PROCEEDING',
    title: `${p.court.name} - ${docket}`,
    subtitle: `${p.matter.fileCode} • ${p.matter.title}`,
    badge: p.archivedAt ? 'مؤرشف' : (p.status === 'ACTIVE' ? 'متداول' : p.status),
    href: `/matters/${p.matterId}/proceedings/${p.id}`,
    isArchived: Boolean(p.archivedAt),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function unifiedSearch(
  rawParams: UnifiedSearchParams = {},
  actor?: Actor
): Promise<UnifiedSearchResult> {
  if (!actor || !actor.id) {
    throw new UnauthorizedError('المستخدم غير مصرح له.');
  }
  assertActorAuthorized(actor, 'READ_CLIENT_DATA');

  let params: UnifiedSearchParams;
  try {
    params = unifiedSearchParamsSchema.parse(rawParams);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { message, fieldErrors } = formatZodError(err);
      throw new MatterValidationError(message, fieldErrors);
    }
    throw err;
  }

  const prisma = getPrismaClient();
  const query = params.query?.trim() ?? '';
  const searchType = params.type ?? 'ALL';
  const includeArchived = params.includeArchived ?? false;
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

  // 1. Party where clause
  const partyWhere: Prisma.PartyWhereInput = {};
  if (!includeArchived) {
    partyWhere.archivedAt = null;
  }
  if (query) {
    const qDigits = normalizeArabicDigits(query);
    const qText = normalizeArabicText(query);
    const variants = expandSearchVariants(query);

    const orClauses: Prisma.PartyWhereInput[] = [
      { name: { contains: query, mode: 'insensitive' } },
      { primaryPhone: { contains: query, mode: 'insensitive' } },
      { primaryPhone: { contains: qDigits, mode: 'insensitive' } },
      { primaryPhoneNormalized: { contains: qDigits, mode: 'insensitive' } },
    ];
    if (qText) {
      orClauses.push({ nameNormalized: { contains: qText, mode: 'insensitive' } });
    }
    for (const v of variants) {
      orClauses.push({ name: { contains: v, mode: 'insensitive' } });
    }
    partyWhere.OR = orClauses;
  }

  // 2. Matter where clause
  const matterWhere: Prisma.MatterWhereInput = {};
  if (!includeArchived) {
    matterWhere.archivedAt = null;
    matterWhere.status = { not: 'ARCHIVED' };
  }
  if (query) {
    const queryVariants = expandSearchVariants(query);
    const normQuery = normalizeArabicText(query);

    const orClauses: Prisma.MatterWhereInput[] = [];
    if (normQuery) {
      orClauses.push({ titleNormalized: { contains: normQuery, mode: 'insensitive' } });
    }
    for (const v of queryVariants) {
      orClauses.push({ title: { contains: v, mode: 'insensitive' } });
      orClauses.push({ fileCode: { contains: v, mode: 'insensitive' } });
    }
    matterWhere.OR = orClauses;
  }

  // 3. Proceeding where clause
  const procWhere: Prisma.ProceedingWhereInput = {};
  if (!includeArchived) {
    procWhere.archivedAt = null;
    procWhere.matter = { archivedAt: null, status: { not: 'ARCHIVED' } };
  }
  if (query) {
    const qDigits = normalizeArabicDigits(query);
    const normText = normalizeArabicText(query);
    const variants = expandSearchVariants(query);

    const orClauses: Prisma.ProceedingWhereInput[] = [
      { numberText: { contains: query, mode: 'insensitive' } },
      { numberNormalized: { contains: qDigits, mode: 'insensitive' } },
      { yearLabel: { contains: query, mode: 'insensitive' } },
      { yearNormalized: { contains: qDigits, mode: 'insensitive' } },
      { circuit: { contains: query, mode: 'insensitive' } },
      { registerType: { contains: query, mode: 'insensitive' } },
      { court: { name: { contains: query, mode: 'insensitive' } } },
      { matter: { title: { contains: query, mode: 'insensitive' } } },
      { matter: { fileCode: { contains: query, mode: 'insensitive' } } },
    ];

    if (normText) {
      orClauses.push({ court: { name: { contains: normText, mode: 'insensitive' } } });
      orClauses.push({ matter: { titleNormalized: { contains: normText, mode: 'insensitive' } } });
    }

    for (const v of variants) {
      orClauses.push({ numberText: { contains: v, mode: 'insensitive' } });
      orClauses.push({ circuit: { contains: v, mode: 'insensitive' } });
    }

    procWhere.OR = orClauses;
  }

  // Always compute accurate counts for all categories regardless of active tab
  const [partiesCount, mattersCount, proceedingsCount] = await Promise.all([
    prisma.party.count({ where: partyWhere }),
    prisma.matter.count({ where: matterWhere }),
    prisma.proceeding.count({ where: procWhere }),
  ]);
  const totalAll = mattersCount + proceedingsCount + partiesCount;

  const counts = {
    all: totalAll,
    parties: partiesCount,
    matters: mattersCount,
    proceedings: proceedingsCount,
  };

  let total: number;
  if (searchType === 'PARTY') total = partiesCount;
  else if (searchType === 'MATTER') total = mattersCount;
  else if (searchType === 'PROCEEDING') total = proceedingsCount;
  else total = totalAll;

  const totalPages = Math.ceil(total / limit) || 1;
  const page = Math.max(params.page ?? 1, 1);
  const skip = (page - 1) * limit;

  let items: UnifiedSearchResultItem[] = [];

  if (searchType === 'PARTY') {
    if (skip < partiesCount) {
      const parties = await prisma.party.findMany({
        where: partyWhere,
        select: {
          id: true,
          name: true,
          kind: true,
          primaryPhone: true,
          archivedAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      });
      items = parties.map(mapPartyToUnifiedItem);
    }
  } else if (searchType === 'MATTER') {
    if (skip < mattersCount) {
      const matters = await prisma.matter.findMany({
        where: matterWhere,
        select: {
          id: true,
          fileCode: true,
          title: true,
          kind: true,
          status: true,
          archivedAt: true,
          updatedAt: true,
          parties: {
            where: { role: 'CLIENT' },
            orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { party: { select: { name: true } } },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      });
      items = matters.map(mapMatterToUnifiedItem);
    }
  } else if (searchType === 'PROCEEDING') {
    if (skip < proceedingsCount) {
      const proceedings = await prisma.proceeding.findMany({
        where: procWhere,
        select: {
          id: true,
          matterId: true,
          courtId: true,
          instance: true,
          registerType: true,
          circuit: true,
          numberText: true,
          yearLabel: true,
          status: true,
          archivedAt: true,
          updatedAt: true,
          court: { select: { name: true } },
          matter: { select: { title: true, fileCode: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      });
      items = proceedings.map(mapProceedingToUnifiedItem);
    }
  } else {
    // searchType === 'ALL'
    if (skip < totalAll) {
      const s1 = mattersCount;
      const s2 = proceedingsCount;
      const s3 = partiesCount;

      let take1 = 0;
      let skip1 = 0;
      if (skip < s1) {
        skip1 = skip;
        take1 = Math.min(limit, s1 - skip1);
      }

      let take2 = 0;
      let skip2 = 0;
      const rem1 = limit - take1;
      if (rem1 > 0 && skip < s1 + s2) {
        skip2 = Math.max(0, skip - s1);
        take2 = Math.min(rem1, s2 - skip2);
      }

      let take3 = 0;
      let skip3 = 0;
      const rem2 = rem1 - take2;
      if (rem2 > 0 && skip < s1 + s2 + s3) {
        skip3 = Math.max(0, skip - (s1 + s2));
        take3 = Math.min(rem2, s3 - skip3);
      }

      const [matters, proceedings, parties] = await Promise.all([
        take1 > 0
          ? prisma.matter.findMany({
              where: matterWhere,
              select: {
                id: true,
                fileCode: true,
                title: true,
                kind: true,
                status: true,
                archivedAt: true,
                updatedAt: true,
                parties: {
                  where: { role: 'CLIENT' },
                  orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
                  take: 1,
                  select: { party: { select: { name: true } } },
                },
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: skip1,
              take: take1,
            })
          : [],
        take2 > 0
          ? prisma.proceeding.findMany({
              where: procWhere,
              select: {
                id: true,
                matterId: true,
                courtId: true,
                instance: true,
                registerType: true,
                circuit: true,
                numberText: true,
                yearLabel: true,
                status: true,
                archivedAt: true,
                updatedAt: true,
                court: { select: { name: true } },
                matter: { select: { title: true, fileCode: true } },
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: skip2,
              take: take2,
            })
          : [],
        take3 > 0
          ? prisma.party.findMany({
              where: partyWhere,
              select: {
                id: true,
                name: true,
                kind: true,
                primaryPhone: true,
                archivedAt: true,
                updatedAt: true,
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: skip3,
              take: take3,
            })
          : [],
      ]);

      items = [
        ...matters.map(mapMatterToUnifiedItem),
        ...proceedings.map(mapProceedingToUnifiedItem),
        ...parties.map(mapPartyToUnifiedItem),
      ];
    }
  }

  return {
    query,
    type: searchType,
    includeArchived,
    page,
    limit,
    total,
    totalPages,
    items,
    counts,
  };
}
