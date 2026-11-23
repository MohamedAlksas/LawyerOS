'use server';

import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError, Actor, Permission } from '@/modules/identity/types';
import { getTrustedOrigins } from '@/lib/auth';
import {
  openMatter,
  updateMatter,
  linkMatterParty,
  updateMatterParty,
  unlinkMatterParty,
  addProceeding,
  updateProceeding,
  linkProceedingParty,
  unlinkProceedingParty,
  linkMatterAuthorization,
  unlinkMatterAuthorization,
  getMatter,
  searchMatters,
  getPartyMatterAssociations,
  findSimilarProceedings,
  archiveMatter,
  reopenMatter,
  archiveProceeding,
  reopenProceeding,
  searchProceedings,
  unifiedSearch,
  searchMatterClients,
  listMatterAuthorizationOptions,
  type SearchMatterClientsResult,
} from './matter-service';
import {
  MatterDTO,
  MatterPartySummaryDTO,
  ProceedingSummaryDTO,
  ProceedingPartySummaryDTO,
  MatterAuthorizationSummaryDTO,
  PartyMatterAssociationsResult,
  GetPartyMatterAssociationsParams,
  FindSimilarProceedingsParams,
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
  ActiveObligationError,
} from './matter-types';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyConcurrentConflictError,
} from '@/lib/idempotency';

export type ActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      code?: string;
      fieldErrors?: Record<string, string>;
    };

function handleActionError(error: unknown): ActionResult<never> {
  if (error instanceof MatterValidationError) {
    return {
      success: false,
      error: error.message,
      code: 'VALIDATION_ERROR',
      fieldErrors: error.fieldErrors,
    };
  }

  if (error instanceof LastClientRequiredError) {
    return {
      success: false,
      error: error.message,
      code: 'LAST_CLIENT_REQUIRED',
    };
  }

  if (error instanceof PrimaryContactConflictError) {
    return {
      success: false,
      error: error.message,
      code: 'PRIMARY_CONTACT_CONFLICT',
    };
  }

  if (error instanceof CrossMatterLinkForbiddenError) {
    return {
      success: false,
      error: error.message,
      code: 'CROSS_MATTER_LINK_FORBIDDEN',
    };
  }

  if (error instanceof ProceedingCycleDetectedError) {
    return {
      success: false,
      error: error.message,
      code: 'PROCEEDING_CYCLE_DETECTED',
    };
  }

  if (error instanceof ClientPoaDependencyError) {
    return {
      success: false,
      error: error.message,
      code: 'CLIENT_POA_DEPENDENCY_ERROR',
    };
  }

  if (error instanceof InactiveReferenceSelectedError) {
    return {
      success: false,
      error: error.message,
      code: 'INACTIVE_REFERENCE_SELECTED',
    };
  }

  if (error instanceof ConcurrencyConflictError) {
    return {
      success: false,
      error: error.message,
      code: 'CONCURRENCY_CONFLICT',
    };
  }

  if (error instanceof NotFoundError) {
    return {
      success: false,
      error: error.message,
      code: 'NOT_FOUND',
    };
  }

  if (error instanceof UnsupportedTransitionError) {
    return {
      success: false,
      error: error.message,
      code: 'UNSUPPORTED_TRANSITION',
    };
  }

  if (error instanceof MatterArchivedError) {
    return {
      success: false,
      error: error.message,
      code: 'MATTER_ARCHIVED',
    };
  }

  if (error instanceof ProceedingArchivedError) {
    return {
      success: false,
      error: error.message,
      code: 'PROCEEDING_ARCHIVED',
    };
  }

  if (error instanceof ActiveObligationError) {
    return {
      success: false,
      error: error.message,
      code: 'ACTIVE_OBLIGATION',
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      success: false,
      error: 'غير مصرح للقيام بهذه العملية.',
      code: 'FORBIDDEN',
    };
  }

  if (error instanceof IdempotencyPayloadMismatchError) {
    return {
      success: false,
      error: error.message,
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
    };
  }

  if (error instanceof IdempotencyConcurrentConflictError) {
    return {
      success: false,
      error: error.message,
      code: 'IDEMPOTENCY_CONCURRENT_CONFLICT',
    };
  }

  return {
    success: false,
    error: 'حدث خطأ غير متوقع أثناء معالجة الطلب. يرجى المحاولة مرة أخرى.',
    code: 'INTERNAL_ERROR',
  };
}

async function verifyActionSecurity(options: { requiredPermission?: Permission } = {}): Promise<Actor> {
  try {
    const { headers: nextHeaders } = await import('next/headers');
    const reqHeaders = await nextHeaders();
    const origin = reqHeaders?.get('origin');
    if (origin) {
      const trusted = getTrustedOrigins();
      if (!trusted.has(origin)) {
        throw new AuthorizationError('غير مصرح بالوصول من هذا المصدر.');
      }
    }
  } catch (err) {
    if (err instanceof AuthorizationError) {
      throw err;
    }
  }

  return await requireActor(options);
}

export async function openMatterAction(
  input: OpenMatterInput
): Promise<ActionResult<OpenMatterResult>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await openMatter(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function updateMatterAction(
  input: UpdateMatterInput
): Promise<ActionResult<UpdateMatterResult>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await updateMatter(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function linkMatterPartyAction(
  input: LinkMatterPartyInput
): Promise<ActionResult<MatterPartySummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await linkMatterParty(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function updateMatterPartyAction(
  input: UpdateMatterPartyInput
): Promise<ActionResult<MatterPartySummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await updateMatterParty(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function unlinkMatterPartyAction(
  input: UnlinkMatterPartyInput
): Promise<ActionResult<{ success: true }>> {
  try {
    const actor = await verifyActionSecurity();
    await unlinkMatterParty(actor, input);
    return { success: true, data: { success: true } };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function addProceedingAction(
  input: AddProceedingInput
): Promise<ActionResult<ProceedingSummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await addProceeding(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function updateProceedingAction(
  input: UpdateProceedingInput
): Promise<ActionResult<ProceedingSummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await updateProceeding(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function linkProceedingPartyAction(
  input: LinkProceedingPartyInput
): Promise<ActionResult<ProceedingPartySummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await linkProceedingParty(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function unlinkProceedingPartyAction(
  input: UnlinkProceedingPartyInput
): Promise<ActionResult<{ success: true }>> {
  try {
    const actor = await verifyActionSecurity();
    await unlinkProceedingParty(actor, input);
    return { success: true, data: { success: true } };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function linkMatterAuthorizationAction(
  input: LinkMatterAuthorizationInput
): Promise<ActionResult<MatterAuthorizationSummaryDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await linkMatterAuthorization(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function unlinkMatterAuthorizationAction(
  input: UnlinkMatterAuthorizationInput
): Promise<ActionResult<{ success: true }>> {
  try {
    const actor = await verifyActionSecurity();
    await unlinkMatterAuthorization(actor, input);
    return { success: true, data: { success: true } };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function getMatterAction(
  matterId: string
): Promise<ActionResult<MatterDTO>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await getMatter(matterId, actor);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function listMatterAuthorizationOptionsAction(matterId: string): Promise<ActionResult<Awaited<ReturnType<typeof listMatterAuthorizationOptions>>>> {
  try {
    const actor = await verifyActionSecurity({ requiredPermission: 'READ_CLIENT_DATA' });
    return { success: true, data: await listMatterAuthorizationOptions(matterId, actor) };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function searchMattersAction(
  params: SearchMattersParams
): Promise<ActionResult<SearchMattersResult>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await searchMatters(params, actor);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function getPartyMatterAssociationsAction(
  params: GetPartyMatterAssociationsParams
): Promise<ActionResult<PartyMatterAssociationsResult>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await getPartyMatterAssociations(actor, params);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function findSimilarProceedingsAction(
  params: FindSimilarProceedingsParams
): Promise<ActionResult<FindSimilarProceedingsResult>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await findSimilarProceedings(actor, params);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

async function verifyLifecycleActor(originatingActorId: string): Promise<Actor> {
  const actor = await verifyActionSecurity({ requiredPermission: 'WRITE_CLIENT_DATA' });
  if (actor.id !== originatingActorId) {
    throw new AuthorizationError();
  }
  return actor;
}

export async function archiveMatterAction(
  input: ArchiveMatterInput,
  originatingActorId: string
): Promise<ActionResult<LifecycleCommandResult>> {
  try {
    const actor = await verifyLifecycleActor(originatingActorId);
    const data = await archiveMatter(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function reopenMatterAction(
  input: ReopenMatterInput,
  originatingActorId: string
): Promise<ActionResult<LifecycleCommandResult>> {
  try {
    const actor = await verifyLifecycleActor(originatingActorId);
    const data = await reopenMatter(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function archiveProceedingAction(
  input: ArchiveProceedingInput,
  originatingActorId: string
): Promise<ActionResult<LifecycleCommandResult>> {
  try {
    const actor = await verifyLifecycleActor(originatingActorId);
    const data = await archiveProceeding(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function reopenProceedingAction(
  input: ReopenProceedingInput,
  originatingActorId: string
): Promise<ActionResult<LifecycleCommandResult>> {
  try {
    const actor = await verifyLifecycleActor(originatingActorId);
    const data = await reopenProceeding(actor, input);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function searchProceedingsAction(
  params: SearchProceedingsParams
): Promise<ActionResult<SearchProceedingsResult>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await searchProceedings(params, actor);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function unifiedSearchAction(
  params: UnifiedSearchParams
): Promise<ActionResult<UnifiedSearchResult>> {
  try {
    const actor = await verifyActionSecurity();
    const data = await unifiedSearch(params, actor);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

export async function searchMatterClientsAction(
  rawParams: unknown = {}
): Promise<ActionResult<SearchMatterClientsResult>> {
  try {
    const actor = await verifyActionSecurity({ requiredPermission: 'READ_CLIENT_DATA' });
    const data = await searchMatterClients(actor, rawParams);
    return { success: true, data };
  } catch (error) {
    return handleActionError(error);
  }
}

